import { z } from "zod";
import { opaqueIdSchema, revisionSchema, timestampSchema } from "../../contracts";
import {
  type Actor,
  actorSchema,
  aliveWorkspace,
  parse,
  safe,
  sqlClaim,
  type V2Core,
} from "./v2-core";
import { isPreparedPaidHold, type PreparedPaidHold } from "./v2-paid-statements";
import { type JobLease, leaseSchema } from "./v2-workspace";

const from = `FROM v2_upload_sessions u JOIN v2_files f ON f.id=u.file_id
  JOIN v2_workspaces w ON w.id=f.workspace_id JOIN v2_operations o ON o.id=f.operation_id
  JOIN v2_idempotency i ON i.operation_id=o.id AND i.owner_id=o.owner_id`;
const eligible = `u.id=? AND u.revision=? AND u.state='open' AND u.encrypted_payload IS NULL
  AND u.expires_at>? AND f.state IN ('reserved','uploading') AND w.owner_id=?
  AND o.owner_id=w.owner_id AND o.state='admitted' AND o.kind='file_extract' AND ${aliveWorkspace}
  AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id)
  AND EXISTS(SELECT 1 FROM v2_consents WHERE file_id=f.id AND owner_id=w.owner_id AND kind='auto_processing')`;

/** Format probing precedes uploaded state. Its paid lease is inline, not an AI
 * interpretation job, so it does not consume a user AI quota or dispatch an outbox.
 * Neither completion nor expiry changes the upload operation or file revision.
 */
export function createV2UploadProbeRepository(core: V2Core) {
  const context = (actor: Actor, uploadId: string, uploadRevision: number) => {
    const a = parse(actorSchema, actor);
    parse(opaqueIdSchema, uploadId);
    parse(revisionSchema, uploadRevision);
    return core
      .statement(
        `SELECT o.id AS operationId,o.revision AS operationRevision,i.request_hash AS requestHash,
        w.id AS workspaceId,f.id AS fileId,f.revision AS fileRevision,u.reserved_bytes AS byteLength
        ${from} WHERE ${eligible}`,
        [uploadId, uploadRevision, a.now, a.ownerId],
      )
      .first<{
        operationId: string;
        operationRevision: number;
        requestHash: string;
        workspaceId: string;
        fileId: string;
        fileRevision: number;
        byteLength: number;
      }>();
  };
  return {
    context: (actor: Actor, uploadId: string, uploadRevision: number) =>
      safe(() => context(actor, uploadId, uploadRevision)),
    attach(
      actor: Actor,
      input: { uploadId: string; uploadRevision: number; leaseUntil: string },
      paid?: PreparedPaidHold,
    ) {
      return safe(async (): Promise<JobLease | null> => {
        const a = parse(actorSchema, actor);
        const until = new Date(parse(timestampSchema, input.leaseUntil)).toISOString();
        if (
          !paid ||
          !isPreparedPaidHold(paid) ||
          paid.request.service !== "container" ||
          Date.parse(until) <= Date.parse(a.now) ||
          Date.parse(until) - Date.parse(a.now) > 300_000
        )
          return null;
        const current = await context(a, input.uploadId, input.uploadRevision);
        const r = paid.request;
        if (
          !current ||
          r.targetKind !== "file" ||
          r.targetId !== current.fileId ||
          r.targetRevision !== current.fileRevision ||
          r.plan.operationId !== current.operationId ||
          r.plan.operationRevision !== current.operationRevision ||
          r.plan.requestHash !== current.requestHash
        )
          return null;
        const claimId = crypto.randomUUID(),
          token = crypto.randomUUID();
        const previousExpired = `EXISTS(SELECT 1 FROM v2_jobs previous WHERE previous.id=f.current_job_id
          AND previous.operation_id=o.id AND previous.target_kind='file' AND previous.target_id=f.id
          AND previous.target_revision=f.revision AND previous.status IN ('running','validating')
          AND previous.lease_until<=? AND NOT EXISTS(SELECT 1 FROM v2_outbox WHERE job_id=previous.id))`;
        const changed = await core.changed([
          core.statement(
            `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision)
            SELECT ?,w.owner_id,f.id,f.revision ${from} WHERE ${eligible}
            AND o.id=? AND o.revision=? AND i.request_hash=? AND f.id=? AND f.revision=?
            AND (f.current_job_id IS NULL OR ${previousExpired}) AND (${paid.predicate.sql})`,
            [
              claimId,
              input.uploadId,
              input.uploadRevision,
              a.now,
              a.ownerId,
              current.operationId,
              current.operationRevision,
              current.requestHash,
              current.fileId,
              current.fileRevision,
              a.now,
              ...paid.predicate.values,
            ],
          ),
          core.statement(
            `UPDATE v2_jobs SET status='cancelled',failure_code=NULL,retryable=0,
            lease_token=NULL,lease_until=NULL,fencing=fencing+1,updated_at=?
            WHERE id=(SELECT current_job_id FROM v2_files WHERE id=?) AND ${sqlClaim}`,
            [a.now, current.fileId, claimId],
          ),
          core.statement(
            `INSERT INTO v2_jobs(id,operation_id,runtime_instance_id,workspace_id,
            target_kind,target_id,target_revision,kind,status,phase,attempts,fencing,lease_token,lease_until,created_at,updated_at)
            SELECT ?,?,?,?,'file',?,?,'file_processing','running','extracting',1,1,?,?,?,? WHERE ${sqlClaim}`,
            [
              r.jobId,
              current.operationId,
              `${r.jobId}-1`,
              current.workspaceId,
              current.fileId,
              current.fileRevision,
              token,
              until,
              a.now,
              a.now,
              claimId,
            ],
          ),
          core.statement(`UPDATE v2_files SET current_job_id=? WHERE id=? AND ${sqlClaim}`, [
            r.jobId,
            current.fileId,
            claimId,
          ]),
          ...paid.statements(core, a, claimId),
          core.finish(claimId),
        ]);
        return changed ? parse(leaseSchema, { jobId: r.jobId, token, fencing: 1 }) : null;
      });
    },
    finish(
      actor: Actor,
      uploadId: string,
      uploadRevision: number,
      lease: JobLease,
      succeeded: boolean,
    ) {
      return safe(async () => {
        const a = parse(actorSchema, actor),
          l = parse(leaseSchema, lease);
        parse(z.boolean(), succeeded);
        const claimId = crypto.randomUUID();
        return core.changed([
          core.statement(
            `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision)
            SELECT ?,w.owner_id,j.id,j.target_revision ${from}
            JOIN v2_jobs j ON j.id=f.current_job_id AND j.operation_id=o.id
            WHERE ${eligible} AND j.id=? AND j.target_kind='file' AND j.target_id=f.id
            AND j.target_revision=f.revision AND j.lease_token=? AND j.fencing=? AND j.lease_until>?
            AND j.status IN ('running','validating') AND NOT EXISTS(SELECT 1 FROM v2_outbox WHERE job_id=j.id)`,
            [
              claimId,
              uploadId,
              uploadRevision,
              a.now,
              a.ownerId,
              l.jobId,
              l.token,
              l.fencing,
              a.now,
            ],
          ),
          core.statement(
            `UPDATE v2_files SET current_job_id=NULL WHERE current_job_id=? AND ${sqlClaim}`,
            [l.jobId, claimId],
          ),
          core.statement(
            `UPDATE v2_jobs SET status=?,phase='finished',progress=?,failure_code=NULL,retryable=0,
            lease_token=NULL,lease_until=NULL,fencing=fencing+1,updated_at=? WHERE id=? AND ${sqlClaim}`,
            [succeeded ? "completed" : "cancelled", succeeded ? 100 : 0, a.now, l.jobId, claimId],
          ),
          core.finish(claimId),
        ]);
      });
    },
  };
}
