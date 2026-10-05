import { z } from "zod";
import { opaqueIdSchema, revisionSchema } from "../../contracts";
import { V2_SNAPSHOT_PURPOSES } from "../crypto";
import {
  type Actor,
  actorSchema,
  aliveWorkspace,
  guardSchema,
  hashSchema,
  MAX_REHYDRATE_BYTES,
  parse,
  SNAPSHOT_FRAGMENT_BYTES,
  type SnapshotPurpose,
  safe,
  snapshotChain,
  sqlClaim,
  utf8Bytes,
  type V2Core,
  V2RepositoryError,
  type WorkspaceGuard,
} from "./v2-core";
import { jobAlive } from "./v2-jobs";
import type { JobLease } from "./v2-workspace";

const integritySchema = z.strictObject({
  format: z.literal("chain_v1"),
  digest: hashSchema,
  purpose: z.enum(V2_SNAPSHOT_PURPOSES),
  targetId: opaqueIdSchema,
  partCount: z.number().int().positive(),
});
const zero = "0".repeat(64);

type Header = {
  id: string;
  owner_id: string;
  workspace_id: string;
  workspace_revision: number;
  target_id: string;
  purpose: SnapshotPurpose;
  revision: number;
  part_count: number;
  byte_length: number;
  written_parts: number;
  written_bytes: number;
  state: string;
  encrypted_payload: string;
  lease_job_id: string | null;
  lease_fencing: number | null;
};
export function createV2StagingRepository(core: V2Core) {
  const find = (actor: Actor, id: string, state?: string) =>
    core
      .statement(
        `SELECT s.* FROM v2_private_snapshots s JOIN v2_workspaces w ON w.id=s.workspace_id WHERE s.id=? AND s.owner_id=? AND w.owner_id=s.owner_id AND ${aliveWorkspace} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind IN ('file','profile','report') AND target_id=s.target_id)${state ? " AND s.state=?" : ""}`,
        [id, actor.ownerId, ...(state ? [state] : [])],
      )
      .first<Header>();
  const stageClaim = (
    g: WorkspaceGuard,
    id: string,
    claimId: string,
    extra: string,
    values: unknown[],
    lease?: JobLease,
  ) => {
    // File/report stages carry their own target lease and still bind the workspace revision.
    const stageLease = lease
      ? `s.lease_job_id=? AND s.lease_fencing=? AND EXISTS(SELECT 1 FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id WHERE ${jobAlive} AND j.id=s.lease_job_id AND j.lease_token=? AND j.fencing=s.lease_fencing AND j.lease_until>? AND j.status IN ('running','validating'))`
      : "s.lease_job_id IS NULL";
    return core.claim(
      g,
      claimId,
      `EXISTS(SELECT 1 FROM v2_private_snapshots s WHERE s.id=? AND s.owner_id=w.owner_id AND s.workspace_id=w.id AND s.workspace_revision=w.revision AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind IN ('file','report','profile') AND target_id=s.target_id) AND ${stageLease} AND ${extra})`,
      [id, ...(lease ? [lease.jobId, lease.fencing, lease.token, g.now] : []), ...values],
    );
  };
  const replayGuard = async (g: WorkspaceGuard, header: Header, lease?: JobLease) =>
    Boolean(
      await core
        .statement(
          `SELECT s.id FROM v2_private_snapshots s JOIN v2_workspaces w ON w.id=s.workspace_id WHERE s.id=? AND s.owner_id=? AND w.owner_id=s.owner_id AND w.id=? AND w.revision=? AND s.workspace_revision=w.revision AND ${aliveWorkspace} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind IN ('file','profile','report') AND target_id=s.target_id) AND ${lease ? `s.lease_job_id=? AND s.lease_fencing=? AND EXISTS(SELECT 1 FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id WHERE ${jobAlive} AND j.id=s.lease_job_id AND j.lease_token=? AND j.fencing=s.lease_fencing AND j.lease_until>? AND j.status IN ('running','validating'))` : "s.lease_job_id IS NULL AND w.current_job_id IS NULL"}`,
          [
            header.id,
            g.ownerId,
            g.workspaceId,
            g.expectedRevision,
            ...(lease ? [lease.jobId, lease.fencing, lease.token, g.now] : []),
          ],
        )
        .first(),
    );
  return {
    begin(
      g: WorkspaceGuard,
      input: {
        id: string;
        purpose: SnapshotPurpose;
        targetId: string;
        revision: number;
        partCount: number;
        byteLength: number;
      },
      lease?: JobLease,
    ) {
      return safe(async () => {
        g = parse(guardSchema, g);
        parse(opaqueIdSchema, input.id);
        parse(opaqueIdSchema, input.targetId);
        parse(revisionSchema, input.revision);
        parse(z.enum(V2_SNAPSHOT_PURPOSES), input.purpose);
        parse(z.number().int().min(1).max(100000), input.partCount);
        parse(z.number().int().min(1).max(104857600), input.byteLength);
        const old = await find(g, input.id);
        if (old)
          return (
            old.state === "staging" &&
            old.purpose === input.purpose &&
            old.target_id === input.targetId &&
            old.revision === input.revision &&
            old.part_count === input.partCount &&
            old.byte_length === input.byteLength &&
            (await replayGuard(g, old, lease))
          );
        const claimId = crypto.randomUUID();
        const payload = await core.encrypt(
          "v2_private_snapshots",
          input.id,
          g.ownerId,
          input.revision,
          {
            format: "chain_v1",
            digest: zero,
            purpose: input.purpose,
            targetId: input.targetId,
            partCount: input.partCount,
          },
        );
        const execution = lease
          ? `EXISTS(SELECT 1 FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id WHERE j.id=? AND j.lease_token=? AND j.fencing=? AND j.lease_until>? AND j.status IN ('running','validating') AND o.owner_id=w.owner_id AND j.workspace_id=w.id AND j.target_id=? AND ${jobAlive})`
          : "w.current_job_id IS NULL";
        return core.changed([
          core.claim(
            g,
            claimId,
            `${execution} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind IN ('file','report','profile') AND target_id=?)`,
            [
              ...(lease ? [lease.jobId, lease.token, lease.fencing, g.now, input.targetId] : []),
              input.targetId,
            ],
          ),
          core.statement(
            `INSERT INTO v2_private_snapshots(id,owner_id,workspace_id,purpose,target_id,revision,part_count,byte_length,encrypted_payload,created_at,state,workspace_revision,lease_job_id,lease_fencing) SELECT ?,?,?,?,?,?,?,?,?,?,'staging',?,?,? WHERE ${sqlClaim}`,
            [
              input.id,
              g.ownerId,
              g.workspaceId,
              input.purpose,
              input.targetId,
              input.revision,
              input.partCount,
              input.byteLength,
              payload,
              g.now,
              g.expectedRevision,
              lease?.jobId ?? null,
              lease?.fencing ?? null,
              claimId,
            ],
          ),
          core.finish(claimId),
        ]);
      });
    },
    append(g: WorkspaceGuard, id: string, index: number, text: string, lease?: JobLease) {
      return safe(async () => {
        g = parse(guardSchema, g);
        parse(opaqueIdSchema, id);
        parse(z.number().int().min(0).max(99999), index);
        if (utf8Bytes(text) < 1 || utf8Bytes(text) > SNAPSHOT_FRAGMENT_BYTES) return false;
        const header = await find(g, id, "staging");
        if (!header || index >= header.part_count) return false;
        if (index < header.written_parts) {
          if (!(await replayGuard(g, header, lease))) return false;
          const row = await core
            .statement("SELECT * FROM v2_private_parts WHERE snapshot_id=? AND part_index=?", [
              id,
              index,
            ])
            .first<{ id: string; encrypted_payload: string }>();
          return row
            ? (await core.cipher.decrypt(row.encrypted_payload, {
                table: "v2_private_parts",
                column: "encrypted_payload",
                rowId: row.id,
                userId: g.ownerId,
                revision: header.revision,
                targetId: header.target_id,
                purpose: header.purpose,
                part: index,
              })) === text && (await replayGuard(g, header, lease))
            : false;
        }
        if (
          index !== header.written_parts ||
          header.written_bytes + utf8Bytes(text) > header.byte_length
        )
          return false;
        const integrity = await core.decrypt(
          "v2_private_snapshots",
          id,
          g.ownerId,
          header.revision,
          header.encrypted_payload,
          integritySchema,
        );
        const nextDigest = await snapshotChain(integrity.digest, index, text);
        const rowId = crypto.randomUUID();
        const payload = await core.cipher.encrypt(text, {
          table: "v2_private_parts",
          column: "encrypted_payload",
          rowId,
          userId: g.ownerId,
          revision: header.revision,
          targetId: header.target_id,
          purpose: header.purpose,
          part: index,
        });
        const nextIntegrity = await core.encrypt(
          "v2_private_snapshots",
          id,
          g.ownerId,
          header.revision,
          { ...integrity, digest: nextDigest },
        );
        const claimId = crypto.randomUUID();
        return core.changed([
          stageClaim(
            g,
            id,
            claimId,
            "s.state='staging' AND s.written_parts=? AND s.written_bytes=?",
            [index, header.written_bytes],
            lease,
          ),
          core.statement(
            `INSERT INTO v2_private_parts(id,snapshot_id,part_index,byte_length,encrypted_payload) SELECT ?,?,?,?,? WHERE ${sqlClaim}`,
            [rowId, id, index, utf8Bytes(text), payload, claimId],
          ),
          core.statement(
            `UPDATE v2_private_snapshots SET written_parts=written_parts+1,written_bytes=written_bytes+?,encrypted_payload=? WHERE id=? AND ${sqlClaim}`,
            [utf8Bytes(text), nextIntegrity, id, claimId],
          ),
          core.finish(claimId),
        ]);
      });
    },
    seal(
      g: WorkspaceGuard,
      id: string,
      validation: {
        schemaVersion: "2";
        purpose: SnapshotPurpose;
        targetId: string;
        revision: number;
      },
      lease?: JobLease,
    ) {
      return safe(async () => {
        g = parse(guardSchema, g);
        parse(
          z.strictObject({
            schemaVersion: z.literal("2"),
            purpose: z.enum(V2_SNAPSHOT_PURPOSES),
            targetId: opaqueIdSchema,
            revision: revisionSchema,
          }),
          validation,
        );
        const claimId = crypto.randomUUID();
        return core.changed([
          stageClaim(
            g,
            id,
            claimId,
            "s.state='staging' AND s.purpose=? AND s.target_id=? AND s.revision=? AND s.written_parts=s.part_count AND s.written_bytes=s.byte_length AND (SELECT count(*) FROM v2_private_parts WHERE snapshot_id=s.id)=s.part_count AND (SELECT min(part_index) FROM v2_private_parts WHERE snapshot_id=s.id)=0 AND (SELECT max(part_index) FROM v2_private_parts WHERE snapshot_id=s.id)=s.part_count-1",
            [validation.purpose, validation.targetId, validation.revision],
            lease,
          ),
          core.statement(
            `UPDATE v2_private_snapshots SET state='sealed' WHERE id=? AND ${sqlClaim}`,
            [id, claimId],
          ),
          core.finish(claimId),
        ]);
      });
    },
    publish(g: WorkspaceGuard, id: string, lease?: JobLease) {
      return safe(async () => {
        g = parse(guardSchema, g);
        const claimId = crypto.randomUUID();
        return core.changed([
          stageClaim(g, id, claimId, "s.state='sealed'", [], lease),
          core.statement(
            `UPDATE v2_private_snapshots SET state='published' WHERE id=? AND ${sqlClaim}`,
            [id, claimId],
          ),
          core.finish(claimId),
        ]);
      });
    },
    abandon(g: WorkspaceGuard, id: string) {
      return safe(async () => {
        g = parse(guardSchema, g);
        parse(opaqueIdSchema, id);
        return Boolean(
          await core
            .statement(
              `DELETE FROM v2_private_snapshots WHERE id=? AND owner_id=? AND workspace_id=? AND state IN ('staging','sealed','abandoned') AND EXISTS(SELECT 1 FROM v2_workspaces w WHERE w.id=v2_private_snapshots.workspace_id AND w.owner_id=? AND w.revision=? AND ${aliveWorkspace}) AND (lease_job_id IS NULL OR NOT EXISTS(SELECT 1 FROM v2_jobs WHERE id=lease_job_id AND status IN ('queued','running','validating'))) RETURNING id`,
              [id, g.ownerId, g.workspaceId, g.ownerId, g.expectedRevision],
            )
            .first(),
        );
      });
    },
    async *fragments(
      actor: Actor,
      id: string,
    ): AsyncGenerator<{ index: number; text: string; complete: boolean }> {
      try {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(opaqueIdSchema, id);
        const header = await find(actor, id, "published");
        if (!header) return;
        const integrity = await core.decrypt(
          "v2_private_snapshots",
          id,
          actor.ownerId,
          header.revision,
          header.encrypted_payload,
          integritySchema,
        );
        let digest = zero;
        let bytes = 0;
        for (let index = 0; index < header.part_count; index++) {
          const current = await find(actor, id, "published");
          if (!current || current.encrypted_payload !== header.encrypted_payload) return;
          const part = await core
            .statement("SELECT * FROM v2_private_parts WHERE snapshot_id=? AND part_index=?", [
              id,
              index,
            ])
            .first<{ id: string; byte_length: number; encrypted_payload: string }>();
          if (!part) throw new V2RepositoryError("SNAPSHOT_INVALID");
          const text = await core.cipher.decrypt(part.encrypted_payload, {
            table: "v2_private_parts",
            column: "encrypted_payload",
            rowId: part.id,
            userId: actor.ownerId,
            revision: header.revision,
            targetId: header.target_id,
            purpose: header.purpose,
            part: index,
          });
          if (utf8Bytes(text) !== part.byte_length) throw new V2RepositoryError("SNAPSHOT_INVALID");
          bytes += part.byte_length;
          digest = await snapshotChain(digest, index, text);
          if (!(await find(actor, id, "published"))) return;
          const complete = index === header.part_count - 1;
          if (complete && (digest !== integrity.digest || bytes !== header.byte_length))
            throw new V2RepositoryError("SNAPSHOT_INVALID");
          yield { index, text, complete };
        }
      } catch (error) {
        if (error instanceof V2RepositoryError) throw error;
        throw new V2RepositoryError("DB_OPERATION_FAILED");
      }
    },
    async assembleSmall<T>(actor: Actor, id: string, schema: z.ZodType<T>): Promise<T | null> {
      return safe(async () => {
        const header = await find(actor, id, "published");
        if (!header) return null;
        if (header.byte_length > MAX_REHYDRATE_BYTES)
          throw new V2RepositoryError("SNAPSHOT_STREAM_REQUIRED");
        let text = "";
        let complete = false;
        for await (const part of this.fragments(actor, id)) {
          text += part.text;
          complete = part.complete;
        }
        return complete ? parse(schema, JSON.parse(text)) : null;
      });
    },
  };
}
