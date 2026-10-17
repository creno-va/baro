import { z } from "zod";
import { opaqueIdSchema, revisionSchema, timestampSchema } from "../../contracts";
import { CURRENT_POLICY_VERSIONS } from "../../contracts/consent";
import { AUTH_RETENTION_MS } from "../auth/policy";
import {
  type Actor,
  actorSchema,
  aliveWorkspace,
  hashSchema,
  parse,
  safe,
  sqlClaim,
  type V2Core,
} from "./v2-core";
import { storedFileMetadataSchema } from "./v2-files";
import { isPreparedPaidHold, type PreparedPaidHold } from "./v2-paid-statements";
import { type JobLease, leaseSchema } from "./v2-workspace";

const from = `FROM v2_upload_sessions u JOIN v2_files f ON f.id=u.file_id
  JOIN v2_workspaces w ON w.id=f.workspace_id JOIN v2_operations o ON o.id=f.operation_id
  JOIN v2_idempotency i ON i.operation_id=o.id AND i.owner_id=o.owner_id`;
const eligible = `u.id=? AND u.revision=? AND u.state='open'
  AND u.expires_at>? AND f.state IN ('reserved','uploading') AND w.owner_id=?
  AND o.owner_id=w.owner_id AND o.state='admitted' AND o.kind='file_extract' AND ${aliveWorkspace}
  AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='file' AND target_id=f.id)
  AND EXISTS(SELECT 1 FROM v2_consents WHERE file_id=f.id AND owner_id=w.owner_id AND kind='auto_processing')`;

/** Format probing precedes uploaded state. Its paid lease is inline, not an AI
 * interpretation job, so it does not consume a user AI quota or dispatch an outbox.
 * Neither completion nor expiry changes the upload operation or file revision.
 */
export function createV2UploadProbeRepository(core: V2Core) {
  const context = async (
    actor: Actor,
    uploadId: string,
    uploadRevision: number,
    contentHash?: string,
  ) => {
    const a = parse(actorSchema, actor);
    parse(opaqueIdSchema, uploadId);
    parse(revisionSchema, uploadRevision);
    if (contentHash !== undefined) parse(hashSchema, contentHash);
    const row = await core
      .statement(
        `SELECT u.encrypted_payload AS uploadPayload,o.id AS operationId,o.revision AS operationRevision,i.request_hash AS requestHash,
        w.id AS workspaceId,f.id AS fileId,f.revision AS fileRevision,u.reserved_bytes AS byteLength
        ${from} WHERE ${eligible}`,
        [uploadId, uploadRevision, a.now, a.ownerId],
      )
      .first<{
        uploadPayload: string | null;
        operationId: string;
        operationRevision: number;
        requestHash: string;
        workspaceId: string;
        fileId: string;
        fileRevision: number;
        byteLength: number;
      }>();
    if (!row || row.uploadPayload === null) return row;
    // A completed source read can precede a failed workspace CAS. Its digest
    // seals the same original; it does not mean the upload was finalized.
    if (contentHash === undefined) return null;
    const original = await core.decrypt(
      "v2_upload_sessions",
      uploadId,
      a.ownerId,
      uploadRevision,
      row.uploadPayload,
      z.strictObject({ contentHash: hashSchema }),
    );
    return original.contentHash === contentHash ? row : null;
  };
  return {
    context: (actor: Actor, uploadId: string, uploadRevision: number, contentHash?: string) =>
      safe(() => context(actor, uploadId, uploadRevision, contentHash)),
    attach(
      actor: Actor,
      input: {
        uploadId: string;
        uploadRevision: number;
        leaseUntil: string;
        contentHash?: string;
        uploadPayload?: string | null;
      },
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
        const current = await context(a, input.uploadId, input.uploadRevision, input.contentHash);
        const r = paid.request;
        if (
          !current ||
          current.uploadPayload !== (input.uploadPayload ?? null) ||
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
            AND u.encrypted_payload IS ? AND o.id=? AND o.revision=? AND i.request_hash=? AND f.id=? AND f.revision=?
            AND (f.current_job_id IS NULL OR ${previousExpired}) AND (${paid.predicate.sql})`,
            [
              claimId,
              input.uploadId,
              input.uploadRevision,
              a.now,
              a.ownerId,
              current.uploadPayload,
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
      outcome: boolean | "rejected",
      sessionId?: string,
      uploadPayload: string | null = null,
    ) {
      return safe(async () => {
        const a = parse(actorSchema, actor),
          l = parse(leaseSchema, lease);
        parse(z.union([z.boolean(), z.literal("rejected")]), outcome);
        if (sessionId !== undefined) parse(opaqueIdSchema, sessionId);
        parse(z.string().nullable(), uploadPayload);
        const succeeded = outcome === true;
        let rejected: { previous: string; envelope: string } | undefined;
        if (outcome === "rejected") {
          const row = await core
            .statement(
              `SELECT f.id,f.revision,f.encrypted_payload ${from} WHERE ${eligible}
              AND u.encrypted_payload IS ?`,
              [uploadId, uploadRevision, a.now, a.ownerId, uploadPayload],
            )
            .first<{ id: string; revision: number; encrypted_payload: string }>();
          if (!row) return false;
          const metadata = await core.decrypt(
            "v2_files",
            row.id,
            a.ownerId,
            row.revision,
            row.encrypted_payload,
            storedFileMetadataSchema,
          );
          if (metadata.probe !== null) return false;
          rejected = {
            previous: row.encrypted_payload,
            envelope: await core.encrypt("v2_files", row.id, a.ownerId, row.revision, {
              ...metadata,
              uploadRejection: "FILE_REJECTED",
            }),
          };
        }
        // Only a trusted native refusal uses this extra fence. Ordinary cleanup
        // still releases its own probe lease after access is revoked.
        const refusalFence = rejected
          ? {
              sql: `AND f.encrypted_payload=?
            AND coalesce((SELECT value FROM app_metadata WHERE key='account-type:'||w.owner_id),'customer')='customer'
            AND EXISTS(SELECT 1 FROM user_consents c WHERE c.user_id=w.owner_id
              AND c.terms_version=? AND c.privacy_version=? AND c.ai_notice_version=? AND c.over_14_confirmed=1)
            AND EXISTS(SELECT 1 FROM v2_consents WHERE file_id=f.id AND owner_id=w.owner_id
              AND kind='auto_processing' AND version=?)
            ${sessionId ? `AND EXISTS(SELECT 1 FROM session s WHERE s.id=? AND s.user_id=w.owner_id AND s.expires_at>? AND s.created_at>?)` : ""}`,
              values: [
                rejected.previous,
                CURRENT_POLICY_VERSIONS.termsVersion,
                CURRENT_POLICY_VERSIONS.privacyVersion,
                CURRENT_POLICY_VERSIONS.aiNoticeVersion,
                CURRENT_POLICY_VERSIONS.aiNoticeVersion,
                ...(sessionId
                  ? [sessionId, Date.parse(a.now), Date.parse(a.now) - AUTH_RETENTION_MS]
                  : []),
              ],
            }
          : { sql: "", values: [] };
        const claimId = crypto.randomUUID();
        return core.changed([
          core.statement(
            `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision)
            SELECT ?,w.owner_id,j.id,j.target_revision ${from}
            JOIN v2_jobs j ON j.id=f.current_job_id AND j.operation_id=o.id
            WHERE ${eligible} AND u.encrypted_payload IS ? AND j.id=? AND j.target_kind='file' AND j.target_id=f.id
            AND j.target_revision=f.revision AND j.lease_token=? AND j.fencing=? AND j.lease_until>?
            AND j.status IN ('running','validating') AND NOT EXISTS(SELECT 1 FROM v2_outbox WHERE job_id=j.id)
            ${refusalFence.sql}`,
            [
              claimId,
              uploadId,
              uploadRevision,
              a.now,
              a.ownerId,
              uploadPayload,
              l.jobId,
              l.token,
              l.fencing,
              a.now,
              ...refusalFence.values,
            ],
          ),
          core.statement(
            `UPDATE v2_files SET current_job_id=NULL,encrypted_payload=coalesce(?,encrypted_payload)
            WHERE current_job_id=? AND ${sqlClaim}`,
            [rejected?.envelope ?? null, l.jobId, claimId],
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
