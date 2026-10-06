import { z } from "zod";
import { timestampSchema } from "../../../contracts";
import { CURRENT_POLICY_VERSIONS } from "../../../contracts/consent";
import type { V2Core } from "../../db/v2-core";
import { jobAlive } from "../../db/v2-jobs";
import { type FileProcessingParams, fileProcessingParamsSchema } from "./execution";

type Instance = { id: string; status(): Promise<{ status: string }> };
export type FileProcessingBinding = {
  create(input: { id: string; params: FileProcessingParams }): Promise<Instance>;
  get(id: string): Promise<Instance>;
};
const instanceStatuses = new Set([
  "queued",
  "running",
  "paused",
  "errored",
  "terminated",
  "complete",
  "waiting",
  "waitingForPause",
  "rollingBack",
]);
const instanceIdSchema = z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_-]{0,99}$/);
const consentValues = [
  CURRENT_POLICY_VERSIONS.termsVersion,
  CURRENT_POLICY_VERSIONS.privacyVersion,
  CURRENT_POLICY_VERSIONS.aiNoticeVersion,
  CURRENT_POLICY_VERSIONS.aiNoticeVersion,
];
const joins =
  "FROM v2_outbox outbox JOIN v2_jobs j ON j.id=outbox.job_id AND j.operation_id=outbox.operation_id JOIN v2_operations o ON o.id=j.operation_id JOIN v2_files f ON f.id=j.target_id AND f.workspace_id=j.workspace_id JOIN v2_workspaces w ON w.id=f.workspace_id AND w.owner_id=o.owner_id";
const live = `outbox.kind='job_dispatch' AND outbox.target_id=j.runtime_instance_id AND j.target_kind='file' AND j.kind='file_processing' AND j.status IN ('queued','running','validating') AND j.target_revision=f.revision AND f.current_job_id=j.id AND f.operation_id=o.id AND f.state='queued' AND o.state='admitted' AND w.status IN ('active','intake') AND ${jobAlive} AND EXISTS(SELECT 1 FROM user_consents WHERE user_id=o.owner_id AND terms_version=? AND privacy_version=? AND ai_notice_version=? AND over_14_confirmed=1) AND EXISTS(SELECT 1 FROM v2_consents WHERE owner_id=o.owner_id AND file_id=f.id AND kind='auto_processing' AND version=?)`;
type Row = {
  id: string;
  operation_id: string;
  job_id: string;
  runtime_instance_id: string;
  owner_id: string;
  workspace_id: string;
  file_id: string;
  file_revision: number;
  revision: number;
  attempts: number;
  next_attempt_at: string;
  created_at: string;
  status: string;
};

/** Metadata-only scheduler. It never acquires a model/native processing lease. */
export function createFileProcessingDispatcher(
  core: V2Core,
  options: { binding?: FileProcessingBinding; clock?: () => string; leaseMs?: number } = {},
) {
  const now = () =>
    new Date(
      timestampSchema.parse((options.clock ?? (() => new Date().toISOString()))()),
    ).toISOString();
  const leaseMs = z
    .number()
    .int()
    .min(1000)
    .max(300000)
    .parse(options.leaseMs ?? 60000);
  return {
    async dispatch(limit = 8) {
      z.number().int().min(1).max(20).parse(limit);
      if (!options.binding) return { dispatched: 0, pending: 0, available: false };
      const rows = (
        await core
          .statement(
            `SELECT outbox.id,outbox.operation_id,outbox.job_id,j.runtime_instance_id,o.owner_id,j.workspace_id,f.id AS file_id,f.revision AS file_revision,outbox.revision,outbox.attempts,outbox.next_attempt_at,outbox.created_at,j.status ${joins} WHERE ${live} AND outbox.state IN ('pending','failed') AND outbox.next_attempt_at<=? ORDER BY outbox.created_at,outbox.id LIMIT ?`,
            [...consentValues, now(), limit],
          )
          .all<Row>()
      ).results;
      let dispatched = 0,
        pending = 0;
      for (const row of rows) {
        const id = instanceIdSchema.safeParse(row.runtime_instance_id);
        if (!id.success) {
          pending++;
          continue;
        }
        const params = fileProcessingParamsSchema.parse({
          ownerId: row.owner_id,
          workspaceId: row.workspace_id,
          fileId: row.file_id,
          fileRevision: row.file_revision,
          jobId: row.job_id,
        });
        const claimedAt = now(),
          until = new Date(Date.parse(claimedAt) + leaseMs).toISOString();
        const claim = await core
          .statement(
            `UPDATE v2_outbox SET attempts=attempts+1,next_attempt_at=? WHERE id=? AND kind='job_dispatch' AND operation_id=? AND job_id=? AND target_id=? AND revision=? AND attempts=? AND next_attempt_at=? AND next_attempt_at<=? AND state IN ('pending','failed') AND EXISTS(SELECT 1 ${joins} WHERE outbox.id=v2_outbox.id AND ${live} AND j.runtime_instance_id=? AND o.owner_id=? AND j.workspace_id=? AND f.id=? AND f.revision=?)`,
            [
              until,
              row.id,
              row.operation_id,
              row.job_id,
              id.data,
              row.revision,
              row.attempts,
              row.next_attempt_at,
              claimedAt,
              ...consentValues,
              id.data,
              params.ownerId,
              params.workspaceId,
              params.fileId,
              params.fileRevision,
            ],
          )
          .run();
        if (claim.meta.changes !== 1) continue;
        let known = false;
        try {
          try {
            const instance = await options.binding.get(id.data);
            known =
              instance.id === id.data && instanceStatuses.has((await instance.status()).status);
          } catch {
            /* An ambiguous lookup can only create the same durable runtime ID. */
          }
          const canCreate =
            row.status === "queued" &&
            (row.attempts === 0 || Date.parse(now()) < Date.parse(row.created_at) + 86400000);
          if (!known && canCreate && Date.parse(now()) < Date.parse(until)) {
            const active = await core
              .statement(
                `SELECT outbox.id ${joins} WHERE outbox.id=? AND outbox.attempts=? AND outbox.next_attempt_at=? AND outbox.next_attempt_at>? AND outbox.state IN ('pending','failed') AND ${live} AND j.status='queued' AND j.runtime_instance_id=? AND o.owner_id=? AND j.workspace_id=? AND f.id=? AND f.revision=?`,
                [
                  row.id,
                  row.attempts + 1,
                  until,
                  now(),
                  ...consentValues,
                  id.data,
                  params.ownerId,
                  params.workspaceId,
                  params.fileId,
                  params.fileRevision,
                ],
              )
              .first();
            if (!active) {
              pending++;
              continue;
            }
            try {
              const instance = await options.binding.create({ id: id.data, params });
              known =
                instance.id === id.data && instanceStatuses.has((await instance.status()).status);
            } catch {
              const instance = await options.binding.get(id.data);
              known =
                instance.id === id.data && instanceStatuses.has((await instance.status()).status);
            }
          }
        } catch {
          /* Lease persists for same-ID reconciliation; never invent a retry job. */
        }
        if (!known) {
          pending++;
          continue;
        }
        const ack = await core
          .statement(
            `UPDATE v2_outbox SET state='dispatched' WHERE id=? AND kind='job_dispatch' AND operation_id=? AND job_id=? AND target_id=? AND revision=? AND attempts=? AND next_attempt_at=? AND state IN ('pending','failed') AND EXISTS(SELECT 1 ${joins} WHERE outbox.id=v2_outbox.id AND ${live} AND j.runtime_instance_id=? AND o.owner_id=? AND j.workspace_id=? AND f.id=? AND f.revision=?)`,
            [
              row.id,
              row.operation_id,
              row.job_id,
              id.data,
              row.revision,
              row.attempts + 1,
              until,
              ...consentValues,
              id.data,
              params.ownerId,
              params.workspaceId,
              params.fileId,
              params.fileRevision,
            ],
          )
          .run();
        if (ack.meta.changes === 1) dispatched++;
        else pending++;
      }
      return { dispatched, pending, available: true };
    },
  };
}
