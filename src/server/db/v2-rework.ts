import { z } from "zod";
import { opaqueIdSchema, revisionSchema } from "../../contracts/common";
import { CURRENT_POLICY_VERSIONS } from "../../contracts/consent";
import { v2SummaryReconciliationSchema } from "../../contracts/v2/rework";
import {
  type Actor,
  actorSchema,
  aliveWorkspace,
  fragmentText,
  guardSchema,
  hashSchema,
  parse,
  safe,
  snapshotChain,
  sqlClaim,
  utf8Bytes,
  type V2Core,
  V2RepositoryError,
  type WorkspaceGuard,
} from "./v2-core";
import { type JobLease, leasePredicate } from "./v2-workspace";

export const reworkRecordKindSchema = z.enum([
  "context",
  "reconciliation",
  "analysis",
  "resolution",
  "task",
  "action_receipt",
  "checkpoint",
]);
export type ReworkRecordKind = z.infer<typeof reworkRecordKindSchema>;
export type ReworkRecord<T> = { id: string; revision: number; workspaceRevision: number; value: T };
export type ReworkWriteGuard = { sql: string; values: unknown[] };
export type ReworkCancellation = Readonly<{ jobId: string; requestId: string }>;
const cancellations = new WeakMap<
  ReworkCancellation,
  {
    core: V2Core;
    guard: WorkspaceGuard;
    recordRevision: number;
    fence: ReworkWriteGuard;
  }
>();
const MAX_BYTES = 4 * 1024 * 1024;
export const reworkManifestSchema = z.strictObject({
  id: opaqueIdSchema,
  workspaceId: opaqueIdSchema,
  entityId: opaqueIdSchema,
  kind: reworkRecordKindSchema,
  revision: revisionSchema,
  partCount: z.number().int().min(1).max(64),
  byteLength: z.number().int().min(1).max(MAX_BYTES),
  digest: hashSchema,
});
type Row = {
  id: string;
  owner_id: string;
  workspace_id: string;
  entity_id: string;
  kind: ReworkRecordKind;
  revision: number;
  workspace_revision: number;
  part_count: number;
  byte_length: number;
  encrypted_payload: string;
  state: string;
};

/** Same live policy fence for every write, including staging and final publication. */
export function reworkConsentGuard(ownerId: string): ReworkWriteGuard {
  return {
    sql: "EXISTS(SELECT 1 FROM user_consents WHERE user_id=? AND terms_version=? AND privacy_version=? AND ai_notice_version=?)",
    values: [
      ownerId,
      CURRENT_POLICY_VERSIONS.termsVersion,
      CURRENT_POLICY_VERSIONS.privacyVersion,
      CURRENT_POLICY_VERSIONS.aiNoticeVersion,
    ],
  };
}
export function createV2ReworkRepository(core: V2Core, options: { clock?: () => string } = {}) {
  const row = async (
    actor: Actor,
    workspaceId: string,
    kind: ReworkRecordKind,
    entityId: string,
    recordId?: string,
  ) => {
    actorSchema.parse({ ownerId: actor.ownerId, now: actor.now });
    opaqueIdSchema.parse(workspaceId);
    reworkRecordKindSchema.parse(kind);
    opaqueIdSchema.parse(entityId);
    if (recordId) opaqueIdSchema.parse(recordId);
    return core
      .statement(
        `SELECT r.* FROM v2_rework_records r JOIN v2_workspaces w ON w.id=r.workspace_id
      WHERE r.workspace_id=? AND r.owner_id=? AND w.owner_id=r.owner_id AND r.kind=? AND r.entity_id=? AND r.state='published' AND ${aliveWorkspace}
      ${recordId ? "AND r.id=?" : ""} ORDER BY r.revision DESC LIMIT 1`,
        [workspaceId, actor.ownerId, kind, entityId, ...(recordId ? [recordId] : [])],
      )
      .first<Row>();
  };
  const read = async <T>(
    actor: Actor,
    workspaceId: string,
    kind: ReworkRecordKind,
    entityId: string,
    schema: z.ZodType<T>,
    recordId?: string,
  ): Promise<ReworkRecord<T> | null> =>
    safe(async () => {
      const header = await row(actor, workspaceId, kind, entityId, recordId);
      if (!header) return null;
      if (header.byte_length > MAX_BYTES || header.part_count > 64)
        throw new V2RepositoryError("SNAPSHOT_STREAM_REQUIRED");
      const manifest = await core.decrypt(
        "v2_rework_records",
        header.id,
        actor.ownerId,
        header.revision,
        header.encrypted_payload,
        reworkManifestSchema,
      );
      if (
        manifest.id !== header.id ||
        manifest.workspaceId !== workspaceId ||
        manifest.entityId !== entityId ||
        manifest.kind !== kind ||
        manifest.revision !== header.revision ||
        manifest.partCount !== header.part_count ||
        manifest.byteLength !== header.byte_length
      )
        throw new V2RepositoryError("SNAPSHOT_INVALID");
      const parts = (
        await core
          .statement(
            "SELECT id,part_index,byte_length,encrypted_payload FROM v2_rework_parts WHERE record_id=? ORDER BY part_index",
            [header.id],
          )
          .all<{ id: string; part_index: number; byte_length: number; encrypted_payload: string }>()
      ).results;
      if (parts.length !== manifest.partCount) throw new V2RepositoryError("SNAPSHOT_INVALID");
      let digest = "0".repeat(64),
        bytes = 0;
      const texts: string[] = [];
      for (const [index, part] of parts.entries()) {
        if (part.part_index !== index) throw new V2RepositoryError("SNAPSHOT_INVALID");
        const text = await core.cipher.decrypt(part.encrypted_payload, {
          table: "v2_rework_parts",
          column: "encrypted_payload",
          rowId: part.id,
          userId: actor.ownerId,
          revision: header.revision,
        });
        if (utf8Bytes(text) !== part.byte_length) throw new V2RepositoryError("SNAPSHOT_INVALID");
        bytes += part.byte_length;
        digest = await snapshotChain(digest, index, text);
        texts.push(text);
      }
      if (bytes !== manifest.byteLength || digest !== manifest.digest)
        throw new V2RepositoryError("SNAPSHOT_INVALID");
      const value = parse(schema, JSON.parse(texts.join("")));
      // A revoked/deleted or replaced record cannot escape after decrypting its fragments.
      const current = await row(actor, workspaceId, kind, entityId, recordId);
      if (
        !current ||
        current.id !== header.id ||
        current.encrypted_payload !== header.encrypted_payload
      )
        return null;
      return {
        id: header.id,
        revision: header.revision,
        workspaceRevision: header.workspace_revision,
        value,
      };
    });
  return {
    read,
    /** Owner cancellation can fence a worker in another isolate. The capability
     * is issued only after decrypting this case's current reconciliation; it is
     * never reconstructed from a browser token or an in-memory worker lease. */
    prepareCancellation: async (g: WorkspaceGuard, requestId: string) => {
      g = parse(guardSchema, g);
      opaqueIdSchema.parse(requestId);
      const record = await read(
        g,
        g.workspaceId,
        "reconciliation",
        g.workspaceId,
        z.object({
          format: z.literal("summary-reconciliation-v1"),
          state: v2SummaryReconciliationSchema,
        }),
      );
      if (
        !record ||
        record.value.state.request?.id !== requestId ||
        !["pending", "running"].includes(record.value.state.status) ||
        !record.value.state.currentJobId
      )
        return null;
      const jobId = record.value.state.currentJobId;
      const job = await core
        .statement(
          `SELECT j.fencing,j.lease_token,j.target_revision FROM v2_jobs j JOIN v2_workspaces w ON w.id=j.workspace_id JOIN v2_operations o ON o.id=j.operation_id WHERE w.id=? AND w.owner_id=? AND w.revision=? AND ${aliveWorkspace} AND w.current_job_id=j.id AND j.id=? AND j.target_kind='workspace' AND j.target_id=w.id AND j.target_revision<=w.revision AND j.kind='chat_response' AND j.status IN ('queued','running','validating') AND o.owner_id=w.owner_id`,
          [g.workspaceId, g.ownerId, g.expectedRevision, jobId],
        )
        .first<{ fencing: number; lease_token: string | null; target_revision: number }>();
      if (!job || job.target_revision !== record.value.state.request.input.expectedRevision + 1)
        return null;
      const capability = Object.freeze({ jobId, requestId });
      cancellations.set(capability, {
        core,
        guard: g,
        recordRevision: record.revision,
        fence: {
          sql: "w.current_job_id=? AND EXISTS(SELECT 1 FROM v2_jobs j WHERE j.id=w.current_job_id AND j.target_revision=? AND j.fencing=? AND j.lease_token IS ? AND j.status IN ('queued','running','validating'))",
          values: [jobId, job.target_revision, job.fencing, job.lease_token],
        },
      });
      return capability;
    },
    /** Opaque publication identity distinguishes no record from a read race. */
    head: async (actor: Actor, workspaceId: string, kind: ReworkRecordKind, entityId: string) => {
      const value = await row(actor, workspaceId, kind, entityId);
      return value
        ? { id: value.id, revision: value.revision, workspaceRevision: value.workspace_revision }
        : null;
    },
    /** Immutable history; staged rows never become visible without the final CAS/source fence. */
    write<T>(
      g: WorkspaceGuard,
      input: {
        kind: ReworkRecordKind;
        entityId?: string;
        expectedVersion: number;
        value: T;
        schema: z.ZodType<T>;
        lease?: JobLease;
        cancellation?: ReworkCancellation;
        /** Owner-requested UI receipts/continuations may accompany an existing
         * job. This capability cannot change facts, jobs or workspace revisions. */
        metadataJobId?: string;
        authority?: ReworkWriteGuard | ((now: string) => ReworkWriteGuard);
        bumpWorkspace?: boolean;
        /** Existing operation/receipt writes share the exact final publication claim. */
        statements?: (claimId: string, recordId: string, revision: number) => D1PreparedStatement[];
      },
    ): Promise<ReworkRecord<T> | null> {
      return safe(async () => {
        g = parse(guardSchema, g);
        reworkRecordKindSchema.parse(input.kind);
        const entityId = opaqueIdSchema.parse(input.entityId ?? g.workspaceId);
        parse(
          z
            .number()
            .int()
            .min(0)
            .max(Number.MAX_SAFE_INTEGER - 1),
          input.expectedVersion,
        );
        const value = parse(input.schema, input.value),
          text = JSON.stringify(value),
          bytes = utf8Bytes(text);
        if (!bytes || bytes > MAX_BYTES) throw new V2RepositoryError("SNAPSHOT_STREAM_REQUIRED");
        const parts = fragmentText(text),
          id = crypto.randomUUID(),
          revision = input.expectedVersion + 1;
        const cancellation = input.cancellation ? cancellations.get(input.cancellation) : undefined;
        if (input.cancellation) {
          const state = z.object({ state: v2SummaryReconciliationSchema }).safeParse(value);
          if (
            !cancellation ||
            cancellation.core !== core ||
            cancellation.guard.ownerId !== g.ownerId ||
            cancellation.guard.workspaceId !== g.workspaceId ||
            cancellation.guard.expectedRevision !== g.expectedRevision ||
            cancellation.recordRevision !== input.expectedVersion ||
            input.kind !== "reconciliation" ||
            entityId !== g.workspaceId ||
            !input.bumpWorkspace ||
            input.lease ||
            input.metadataJobId ||
            !state.success ||
            state.data.state.status !== "cancelled" ||
            state.data.state.currentJobId !== null ||
            state.data.state.request?.id !== input.cancellation.requestId
          )
            throw new V2RepositoryError("REPOSITORY_INPUT_INVALID");
        }
        if (input.metadataJobId !== undefined) {
          opaqueIdSchema.parse(input.metadataJobId);
          if (
            input.lease ||
            input.bumpWorkspace ||
            input.statements ||
            !["checkpoint", "action_receipt"].includes(input.kind)
          )
            throw new V2RepositoryError("REPOSITORY_INPUT_INVALID");
        }
        const consent = reworkConsentGuard(g.ownerId);
        const lease = (now: string) =>
          cancellation
            ? cancellation.fence
            : input.lease
              ? leasePredicate(input.lease, g.workspaceId, g.expectedRevision, now)
              : input.metadataJobId
                ? {
                    sql: "w.current_job_id=? AND EXISTS(SELECT 1 FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id WHERE j.id=w.current_job_id AND j.workspace_id=w.id AND j.target_kind='workspace' AND j.target_id=w.id AND j.target_revision=w.revision AND j.status IN ('queued','running','validating') AND o.owner_id=w.owner_id)",
                    values: [input.metadataJobId],
                  }
                : { sql: "w.current_job_id IS NULL", values: [] };
        const version =
          "coalesce((SELECT max(revision) FROM v2_rework_records WHERE workspace_id=w.id AND kind=? AND entity_id=? AND state='published'),0)=?";
        const fence = () => {
          const now = (options.clock ?? (() => new Date().toISOString()))();
          const l = lease(now);
          return {
            now,
            sql: `${consent.sql} AND ${l.sql} AND ${version}`,
            values: [...consent.values, ...l.values, input.kind, entityId, input.expectedVersion],
          };
        };
        let digest = "0".repeat(64);
        for (const [index, part] of parts.entries())
          digest = await snapshotChain(digest, index, part);
        const manifest = {
          id,
          workspaceId: g.workspaceId,
          entityId,
          kind: input.kind,
          revision,
          partCount: parts.length,
          byteLength: bytes,
          digest,
        };
        const payload = await core.encrypt("v2_rework_records", id, g.ownerId, revision, manifest);
        const beginClaim = crypto.randomUUID();
        const begin = fence();
        if (
          !(await core.changed([
            core.claim(g, beginClaim, begin.sql, begin.values),
            core.statement(
              `INSERT INTO v2_rework_records(id,owner_id,workspace_id,kind,entity_id,revision,workspace_revision,state,part_count,byte_length,encrypted_payload,created_at) SELECT ?,?,?,?,?,?,?,'staging',?,?,?,? WHERE ${sqlClaim}`,
              [
                id,
                g.ownerId,
                g.workspaceId,
                input.kind,
                entityId,
                revision,
                g.expectedRevision,
                parts.length,
                bytes,
                payload,
                g.now,
                beginClaim,
              ],
            ),
            core.finish(beginClaim),
          ]))
        )
          return null;
        for (let offset = 0; offset < parts.length; offset += 4) {
          const claimId = crypto.randomUUID();
          const stage = fence();
          const statements = [
            core.claim(
              g,
              claimId,
              `${stage.sql} AND EXISTS(SELECT 1 FROM v2_rework_records WHERE id=? AND state='staging')`,
              [...stage.values, id],
            ),
          ];
          for (const [partOffset, text] of parts.slice(offset, offset + 4).entries()) {
            const partId = crypto.randomUUID(),
              index = offset + partOffset;
            const encrypted = await core.cipher.encrypt(text, {
              table: "v2_rework_parts",
              column: "encrypted_payload",
              rowId: partId,
              userId: g.ownerId,
              revision,
            });
            statements.push(
              core.statement(
                `INSERT INTO v2_rework_parts(id,record_id,part_index,byte_length,encrypted_payload) SELECT ?,?,?,?,? WHERE ${sqlClaim}`,
                [partId, id, index, utf8Bytes(text), encrypted, claimId],
              ),
            );
          }
          statements.push(core.finish(claimId));
          if (!(await core.changed(statements))) return null;
        }
        const final = fence();
        const claimId = crypto.randomUUID(),
          authority = (typeof input.authority === "function"
            ? input.authority(final.now)
            : input.authority) ?? { sql: "1", values: [] };
        const statements = [
          core.claim(
            g,
            claimId,
            `${final.sql} AND (${authority.sql}) AND EXISTS(SELECT 1 FROM v2_rework_records r WHERE r.id=? AND r.state='staging' AND r.encrypted_payload=? AND (SELECT count(*) FROM v2_rework_parts WHERE record_id=r.id)=r.part_count AND (SELECT sum(byte_length) FROM v2_rework_parts WHERE record_id=r.id)=r.byte_length)`,
            [...final.values, ...authority.values, id, payload],
          ),
          core.statement(
            `UPDATE v2_rework_records SET state='published',workspace_revision=? WHERE id=? AND ${sqlClaim}`,
            [g.expectedRevision + (input.bumpWorkspace ? 1 : 0), id, claimId],
          ),
          ...(input.cancellation
            ? [
                core.statement(
                  `UPDATE v2_jobs SET status='cancelled',failure_code=NULL,retryable=0,lease_token=NULL,lease_until=NULL,fencing=fencing+1,updated_at=? WHERE id=? AND ${sqlClaim}`,
                  [final.now, input.cancellation.jobId, claimId],
                ),
                // Existing cancellation triggers release the visible quota and retain
                // ambiguous cost observations. Never delete an unsettled execution hold.
                core.statement(
                  `UPDATE v2_operations SET state='cancelled' WHERE id=(SELECT operation_id FROM v2_jobs WHERE id=?) AND ${sqlClaim}`,
                  [input.cancellation.jobId, claimId],
                ),
                core.statement(
                  `UPDATE v2_workspaces SET current_job_id=NULL WHERE id=? AND current_job_id=? AND ${sqlClaim}`,
                  [g.workspaceId, input.cancellation.jobId, claimId],
                ),
              ]
            : []),
          ...(input.statements?.(claimId, id, revision) ?? []),
          ...(input.bumpWorkspace ? [core.bump(g, claimId)] : []),
          core.finish(claimId),
        ];
        if (!(await core.changed(statements))) return null;
        return {
          id,
          revision,
          workspaceRevision: g.expectedRevision + (input.bumpWorkspace ? 1 : 0),
          value,
        };
      });
    },
  };
}
