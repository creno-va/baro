import { z } from "zod";
import { opaqueIdSchema } from "../../contracts";
import {
  positionMatchesProbe,
  type V2Derivative,
  type V2FileObservation,
  v2DerivativeSchema,
  v2FileObservationSchema,
  v2FileProbeSchema,
  v2FileSchema,
} from "../../contracts/v2";
import {
  type Actor,
  actorSchema,
  aliveWorkspace,
  guardSchema,
  hashSchema,
  parse,
  safe,
  sqlClaim,
  type V2Core,
  type WorkspaceGuard,
} from "./v2-core";
import { completeLeaseStatements, type JobLease, leasePredicate } from "./v2-workspace";

const metadataSchema = z.strictObject({
  name: v2FileSchema.shape.name,
  declaredMediaType: v2FileSchema.shape.declaredMediaType,
  probe: v2FileProbeSchema.nullable(),
});
type FileRow = {
  id: string;
  revision: number;
  workspace_id: string;
  operation_id: string;
  state: string;
  encrypted_payload: string;
  manifest_snapshot_id: string | null;
  coverage_snapshot_id: string | null;
  current_job_id: string | null;
};
export function createV2FileStagingRepository(core: V2Core) {
  const fileFor = (actor: Actor, id: string) =>
    core
      .statement(
        `SELECT f.* FROM v2_files f JOIN v2_workspaces w ON w.id=f.workspace_id WHERE f.id=? AND w.owner_id=? AND ${aliveWorkspace} AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id)`,
        [id, actor.ownerId],
      )
      .first<FileRow>();
  return {
    stagePage(
      g: WorkspaceGuard,
      input: {
        fileId: string;
        fileRevision: number;
        coverageSnapshotId: string;
        observationOrdinal: number;
        observations: readonly V2FileObservation[];
        derivativeOrdinal: number;
        derivatives: readonly { value: V2Derivative; blobId: string }[];
      },
      lease: JobLease,
    ) {
      return safe(async () => {
        g = parse(guardSchema, g);
        parse(opaqueIdSchema, input.coverageSnapshotId);
        parse(z.number().int().min(0).max(10000), input.observationOrdinal);
        parse(z.number().int().min(0).max(20000), input.derivativeOrdinal);
        const observations = parse(z.array(v2FileObservationSchema).max(4), input.observations);
        const derivatives = parse(
          z.array(z.strictObject({ value: v2DerivativeSchema, blobId: opaqueIdSchema })).max(4),
          input.derivatives,
        );
        if (
          input.observationOrdinal + observations.length > 10000 ||
          input.derivativeOrdinal + derivatives.length > 20000
        )
          return false;
        const file = await fileFor(g, input.fileId);
        if (
          !file ||
          file.workspace_id !== g.workspaceId ||
          file.revision !== input.fileRevision ||
          file.current_job_id !== lease.jobId
        )
          return false;
        const metadata = await core.decrypt(
          "v2_files",
          file.id,
          g.ownerId,
          file.revision,
          file.encrypted_payload,
          metadataSchema,
        );
        if (
          !metadata.probe ||
          observations.some((o) => !positionMatchesProbe(o.position, metadata.probe)) ||
          derivatives.some(
            (d) =>
              d.value.sourcePosition !== null &&
              !positionMatchesProbe(d.value.sourcePosition, metadata.probe),
          )
        )
          return false;
        const revision = file.revision + 1;
        const execution = leasePredicate(lease, file.id, file.revision, g.now);
        const claimId = crypto.randomUUID();
        const statements = [
          core.claim(
            g,
            claimId,
            `${execution.sql} AND EXISTS(SELECT 1 FROM v2_private_snapshots s WHERE s.id=? AND s.owner_id=w.owner_id AND s.workspace_id=w.id AND s.workspace_revision=w.revision AND s.target_id=? AND s.revision=? AND s.purpose='file_coverage' AND s.state IN ('staging','sealed') AND s.lease_job_id=? AND s.lease_fencing=?) AND EXISTS(SELECT 1 FROM v2_files f WHERE f.id=? AND f.revision=? AND f.current_job_id=?) AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=?)`,
            [
              ...execution.values,
              input.coverageSnapshotId,
              file.id,
              revision,
              lease.jobId,
              lease.fencing,
              file.id,
              file.revision,
              lease.jobId,
              file.id,
            ],
          ),
        ];
        for (const [offset, value] of observations.entries()) {
          const ordinal = input.observationOrdinal + offset;
          const old = await core
            .statement(
              "SELECT id,encrypted_payload,snapshot_id FROM v2_file_observations WHERE file_id=? AND file_revision=? AND ordinal=?",
              [file.id, revision, ordinal],
            )
            .first<{ id: string; encrypted_payload: string; snapshot_id: string }>();
          if (old) {
            if (
              old.snapshot_id !== input.coverageSnapshotId ||
              JSON.stringify(
                await core.decrypt(
                  "v2_file_observations",
                  old.id,
                  g.ownerId,
                  revision,
                  old.encrypted_payload,
                  v2FileObservationSchema,
                ),
              ) !== JSON.stringify(value)
            )
              return false;
            continue;
          }
          const id = crypto.randomUUID();
          const encrypted = await core.encrypt(
            "v2_file_observations",
            id,
            g.ownerId,
            revision,
            value,
          );
          statements.push(
            core.statement(
              `INSERT INTO v2_file_observations(id,entity_id,file_id,revision,file_revision,ordinal,encrypted_payload,snapshot_id) SELECT ?,?,?,?,?,?,?,? WHERE ${sqlClaim}`,
              [
                id,
                value.id,
                file.id,
                revision,
                revision,
                ordinal,
                encrypted,
                input.coverageSnapshotId,
                claimId,
              ],
            ),
          );
        }
        for (const [offset, item] of derivatives.entries()) {
          const ordinal = input.derivativeOrdinal + offset;
          const old = await core
            .statement(
              "SELECT id,encrypted_payload,snapshot_id,blob_id FROM v2_file_derivatives WHERE file_id=? AND file_revision=? AND ordinal=?",
              [file.id, revision, ordinal],
            )
            .first<{
              id: string;
              encrypted_payload: string;
              snapshot_id: string;
              blob_id: string;
            }>();
          if (old) {
            if (
              old.snapshot_id !== input.coverageSnapshotId ||
              old.blob_id !== item.blobId ||
              JSON.stringify(
                await core.decrypt(
                  "v2_file_derivatives",
                  old.id,
                  g.ownerId,
                  revision,
                  old.encrypted_payload,
                  v2DerivativeSchema,
                ),
              ) !== JSON.stringify(item.value)
            )
              return false;
            continue;
          }
          const blob = await core
            .statement(
              "SELECT b.encrypted_payload FROM v2_blobs b JOIN v2_storage_reservations r ON r.id=b.reservation_id JOIN v2_billing_principals p ON p.id=b.principal_id WHERE b.id=? AND p.owner_id=? AND r.workspace_id=? AND r.entity_id=? AND r.operation_id=? AND b.state='stored' AND b.kind='derivative' AND b.visibility='private' AND b.logical_bytes=?",
              [
                item.blobId,
                g.ownerId,
                g.workspaceId,
                file.id,
                file.operation_id,
                item.value.byteLength,
              ],
            )
            .first<{ encrypted_payload: string }>();
          if (!blob) return false;
          const actual = await core.decrypt(
            "v2_blobs",
            item.blobId,
            g.ownerId,
            1,
            blob.encrypted_payload,
            z.strictObject({ contentHash: hashSchema }),
          );
          if (actual.contentHash !== item.value.contentHash) return false;
          const id = crypto.randomUUID();
          const encrypted = await core.encrypt(
            "v2_file_derivatives",
            id,
            g.ownerId,
            revision,
            item.value,
          );
          statements.push(
            core.statement(
              `INSERT INTO v2_file_derivatives(id,entity_id,file_id,file_revision,kind,blob_id,ordinal,encrypted_payload,snapshot_id) SELECT ?,?,?,?,?,b.id,?,?,? FROM v2_blobs b JOIN v2_storage_reservations r ON r.id=b.reservation_id JOIN v2_billing_principals p ON p.id=b.principal_id WHERE b.id=? AND p.owner_id=? AND r.entity_id=? AND r.operation_id=? AND b.state='stored' AND b.visibility='private' AND b.kind='derivative' AND b.encrypted_payload=? AND ${sqlClaim}`,
              [
                id,
                item.value.id,
                file.id,
                revision,
                item.value.kind,
                ordinal,
                encrypted,
                input.coverageSnapshotId,
                item.blobId,
                g.ownerId,
                file.id,
                file.operation_id,
                blob.encrypted_payload,
                claimId,
              ],
            ),
          );
        }
        statements.push(
          core.statement(
            "UPDATE v2_mutation_claims SET verified=CASE WHEN (SELECT count(*) FROM v2_file_observations WHERE snapshot_id=? AND ordinal>=? AND ordinal<?)=? AND (SELECT count(*) FROM v2_file_derivatives WHERE snapshot_id=? AND ordinal>=? AND ordinal<?)=? THEN 1 ELSE 0 END WHERE id=?",
            [
              input.coverageSnapshotId,
              input.observationOrdinal,
              input.observationOrdinal + observations.length,
              observations.length,
              input.coverageSnapshotId,
              input.derivativeOrdinal,
              input.derivativeOrdinal + derivatives.length,
              derivatives.length,
              claimId,
            ],
          ),
          core.finish(claimId),
        );
        return core.changed(statements);
      });
    },
    // The file processor seals a fully typed, complete coverage stream before this atomic publication.
    publish(
      g: WorkspaceGuard,
      input: {
        fileId: string;
        fileRevision: number;
        coverageSnapshotId: string;
        observationCount: number;
        derivativeCount: number;
      },
      lease: JobLease,
    ) {
      return safe(async () => {
        g = parse(guardSchema, g);
        parse(z.number().int().min(0).max(10000), input.observationCount);
        parse(z.number().int().min(0).max(20000), input.derivativeCount);
        const file = await fileFor(g, input.fileId);
        if (
          !file ||
          file.workspace_id !== g.workspaceId ||
          file.revision !== input.fileRevision ||
          !file.manifest_snapshot_id ||
          file.current_job_id !== lease.jobId
        )
          return false;
        const metadata = await core.decrypt(
          "v2_files",
          file.id,
          g.ownerId,
          file.revision,
          file.encrypted_payload,
          metadataSchema,
        );
        if (!metadata.probe) return false;
        const revision = file.revision + 1;
        const encrypted = await core.encrypt("v2_files", file.id, g.ownerId, revision, metadata);
        const execution = leasePredicate(lease, file.id, file.revision, g.now);
        const claimId = crypto.randomUUID();
        return core.changed([
          core.claim(
            g,
            claimId,
            `${execution.sql} AND EXISTS(SELECT 1 FROM v2_files f WHERE f.id=? AND f.revision=? AND f.current_job_id=? AND f.state IN ('queued','processing') AND f.encrypted_payload=? AND f.manifest_snapshot_id=?) AND EXISTS(SELECT 1 FROM v2_private_snapshots s WHERE s.id=? AND s.owner_id=w.owner_id AND s.workspace_id=w.id AND s.workspace_revision=w.revision AND s.target_id=? AND s.revision=? AND s.purpose='file_coverage' AND s.state='sealed' AND s.lease_job_id=? AND s.lease_fencing=?) AND (SELECT count(*) FROM v2_file_observations WHERE snapshot_id=?)=? AND (SELECT count(*) FROM v2_file_derivatives WHERE snapshot_id=?)=? AND (?=0 OR (SELECT min(ordinal) FROM v2_file_observations WHERE snapshot_id=?)=0 AND (SELECT max(ordinal) FROM v2_file_observations WHERE snapshot_id=?)=?-1) AND (?=0 OR (SELECT min(ordinal) FROM v2_file_derivatives WHERE snapshot_id=?)=0 AND (SELECT max(ordinal) FROM v2_file_derivatives WHERE snapshot_id=?)=?-1) AND NOT EXISTS(SELECT 1 FROM v2_file_derivatives d JOIN v2_blobs b ON b.id=d.blob_id WHERE d.snapshot_id=? AND b.state!='stored') AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=?)`,
            [
              ...execution.values,
              file.id,
              file.revision,
              lease.jobId,
              file.encrypted_payload,
              file.manifest_snapshot_id,
              input.coverageSnapshotId,
              file.id,
              revision,
              lease.jobId,
              lease.fencing,
              input.coverageSnapshotId,
              input.observationCount,
              input.coverageSnapshotId,
              input.derivativeCount,
              input.observationCount,
              input.coverageSnapshotId,
              input.coverageSnapshotId,
              input.observationCount,
              input.derivativeCount,
              input.coverageSnapshotId,
              input.coverageSnapshotId,
              input.derivativeCount,
              input.coverageSnapshotId,
              file.id,
            ],
          ),
          core.statement(
            `UPDATE v2_private_snapshots SET state='published' WHERE id=? AND ${sqlClaim}`,
            [input.coverageSnapshotId, claimId],
          ),
          core.statement(
            `UPDATE v2_files SET revision=?,state='ready',probe_kind=?,coverage_snapshot_id=?,current_job_id=NULL,failure_code=NULL,encrypted_payload=?,updated_at=? WHERE id=? AND ${sqlClaim}`,
            [
              revision,
              metadata.probe.category,
              input.coverageSnapshotId,
              encrypted,
              g.now,
              file.id,
              claimId,
            ],
          ),
          ...completeLeaseStatements(core, lease, claimId, g.now),
          core.bump(g, claimId),
          core.finish(claimId),
        ]);
      });
    },
    observations(actor: Actor, fileId: string, afterOrdinal = -1, limit = 4) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(z.number().int().min(-1).max(9999), afterOrdinal);
        parse(z.number().int().min(1).max(4), limit);
        const file = await fileFor(actor, fileId);
        if (file?.state !== "ready") return [];
        const rows = await core
          .statement(
            "SELECT id,ordinal,revision,encrypted_payload FROM v2_file_observations WHERE file_id=? AND file_revision=? AND ordinal>? ORDER BY ordinal LIMIT ?",
            [fileId, file.revision, afterOrdinal, limit],
          )
          .all<{ id: string; ordinal: number; revision: number; encrypted_payload: string }>();
        const values = [];
        for (const row of rows.results)
          values.push({
            ordinal: row.ordinal,
            value: await core.decrypt(
              "v2_file_observations",
              row.id,
              actor.ownerId,
              row.revision,
              row.encrypted_payload,
              v2FileObservationSchema,
            ),
          });
        const final = await fileFor(actor, fileId);
        return final?.revision === file.revision ? values : [];
      });
    },
    derivatives(actor: Actor, fileId: string, afterOrdinal = -1, limit = 4) {
      return safe(async () => {
        actor = parse(actorSchema, { ownerId: actor.ownerId, now: actor.now });
        parse(z.number().int().min(-1).max(19999), afterOrdinal);
        parse(z.number().int().min(1).max(4), limit);
        const file = await fileFor(actor, fileId);
        if (file?.state !== "ready") return [];
        const rows = await core
          .statement(
            "SELECT id,ordinal,encrypted_payload FROM v2_file_derivatives WHERE file_id=? AND file_revision=? AND ordinal>? ORDER BY ordinal LIMIT ?",
            [fileId, file.revision, afterOrdinal, limit],
          )
          .all<{ id: string; ordinal: number; encrypted_payload: string }>();
        const values = [];
        for (const row of rows.results)
          values.push({
            ordinal: row.ordinal,
            value: await core.decrypt(
              "v2_file_derivatives",
              row.id,
              actor.ownerId,
              file.revision,
              row.encrypted_payload,
              v2DerivativeSchema,
            ),
          });
        const final = await fileFor(actor, fileId);
        return final?.revision === file.revision ? values : [];
      });
    },
  };
}
