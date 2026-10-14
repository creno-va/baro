import { z } from "zod";
import { timestampSchema } from "../../contracts";
import { quotaTransitionStatements } from "../db/v2-accounting";
import { sqlClaim, type V2Core } from "../db/v2-core";
import { stoppedJobRetryPredicate } from "./job-recovery-transport";

type Binding = { get(id: string): Promise<{ id: string; status(): Promise<{ status: string }> }> };
type Candidate = {
  id: string;
  owner_id: string;
  operation_id: string;
  operation_revision: number;
  operation_state: string;
  runtime_instance_id: string;
  status: string;
  fencing: number;
  attempts: number;
  lease_token: string | null;
  lease_until: string | null;
  target_kind: "file" | "workspace";
  target_id: string;
  target_revision: number;
  updated_at: string;
  workspace_id: string;
  workspace_revision: number;
  workspace_status: string;
};
const joins = `FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id
  JOIN v2_workspaces w ON w.id=j.workspace_id AND w.owner_id=o.owner_id`;
const current = `((j.target_kind='file' AND j.kind='file_processing') OR (j.target_kind='workspace' AND j.kind IN ('intake_questions','intake_summary','chat_response')))
  AND j.status IN ('queued','running','validating') AND o.state IN ('admitted','ambiguous') AND w.status IN ('intake','active')
  AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE (target_kind='account' AND target_id=o.owner_id) OR (target_kind='workspace' AND target_id=w.id) OR (target_kind=j.target_kind AND target_id=j.target_id))
  AND ((j.target_kind='workspace' AND j.target_id=w.id AND w.current_job_id=j.id)
    OR (j.target_kind='file' AND EXISTS(SELECT 1 FROM v2_files f WHERE f.id=j.target_id AND f.workspace_id=w.id AND f.revision=j.target_revision AND f.current_job_id=j.id AND f.state IN ('queued','processing'))))
  AND EXISTS(SELECT 1 FROM v2_outbox x WHERE x.job_id=j.id AND x.operation_id=o.id AND x.kind='job_dispatch' AND x.target_id=j.runtime_instance_id AND x.state='dispatched')`;

/** Only the trusted scheduler reads the actual immutable Workflow instance.
 * An expired lease is a reason to inspect, never proof that external IO stopped. */
export async function reconcileStoppedJobs(
  core: V2Core,
  options: {
    files?: Binding;
    workspaces?: Binding;
    clock?: () => string;
    limit?: number;
  },
) {
  const now = () =>
    new Date(
      timestampSchema.parse((options.clock ?? (() => new Date().toISOString()))()),
    ).toISOString();
  const at = now();
  const limit = z
    .number()
    .int()
    .min(1)
    .max(20)
    .parse(options.limit ?? 8);
  const rows = (
    await core
      .statement(
        `WITH candidates AS (SELECT j.id,o.owner_id,j.operation_id,o.revision AS operation_revision,o.state AS operation_state,
    j.runtime_instance_id,j.status,j.fencing,j.attempts,j.lease_token,j.lease_until,j.target_kind,j.target_id,j.target_revision,j.updated_at,
    w.id AS workspace_id,w.revision AS workspace_revision,w.status AS workspace_status ${joins}
    WHERE ${current} AND (j.lease_until<=? OR (j.status='queued' AND j.updated_at<=?) OR (j.target_kind='workspace' AND w.revision!=j.target_revision))),
    numbered AS (SELECT candidates.*,row_number() OVER(ORDER BY updated_at,id)-1 AS scan_index,count(*) OVER() AS scan_count FROM candidates)
    SELECT * FROM numbered WHERE scan_index/?=?%((scan_count+?-1)/?) ORDER BY scan_index`,
        // Rotate bounded pages each scheduled minute; a permanently unknown
        // oldest instance must not starve later recoverable jobs.
        [
          at,
          new Date(Date.parse(at) - 300000).toISOString(),
          limit,
          Math.floor(Date.parse(at) / 60000),
          limit,
          limit,
        ],
      )
      .all<Candidate>()
  ).results;
  let recovered = 0;
  for (const row of rows) {
    try {
      const binding = row.target_kind === "file" ? options.files : options.workspaces;
      if (!binding) continue;
      const instance = await binding.get(row.runtime_instance_id);
      if (
        instance.id !== row.runtime_instance_id ||
        !["complete", "errored", "terminated"].includes((await instance.status()).status)
      )
        continue;
      const observedAt = now();
      const retry = await stoppedJobRetryPredicate(core, row.operation_id, observedAt);
      const claim = crypto.randomUUID();
      const changed = await core.changed([
        core.statement(
          `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision)
          SELECT ?,o.owner_id,j.id,j.target_revision ${joins} WHERE ${current}
          AND j.id=? AND o.owner_id=? AND j.operation_id=? AND o.revision=? AND o.state=?
          AND j.runtime_instance_id=? AND j.status=? AND j.fencing=? AND j.attempts=? AND j.lease_token IS ? AND j.lease_until IS ?
          AND j.target_kind=? AND j.target_id=? AND j.target_revision=? AND j.updated_at=?
          AND w.id=? AND w.revision=? AND w.status=?`,
          [
            claim,
            row.id,
            row.owner_id,
            row.operation_id,
            row.operation_revision,
            row.operation_state,
            row.runtime_instance_id,
            row.status,
            row.fencing,
            row.attempts,
            row.lease_token,
            row.lease_until,
            row.target_kind,
            row.target_id,
            row.target_revision,
            row.updated_at,
            row.workspace_id,
            row.workspace_revision,
            row.workspace_status,
          ],
        ),
        // A dispatched Workflow that ended before acquiring its lease still
        // consumed this runtime ordinal; retry must not reuse that terminal ID.
        core.statement(
          `UPDATE v2_jobs SET status='failed',failure_code='JOB_TIMEOUT',retryable=CASE WHEN ${retry.sql} THEN 1 ELSE 0 END,
          attempts=attempts+CASE WHEN status='queued' THEN 1 ELSE 0 END,
          lease_token=NULL,lease_until=NULL,fencing=fencing+1,updated_at=? WHERE id=? AND ${sqlClaim}`,
          [...retry.values, observedAt, row.id, claim],
        ),
        core.statement(`UPDATE v2_operations SET state='failed' WHERE id=? AND ${sqlClaim}`, [
          row.operation_id,
          claim,
        ]),
        ...quotaTransitionStatements(core, row.id, claim, "released", undefined, true),
        core.statement(
          `UPDATE v2_workspaces SET current_job_id=NULL,revision=revision+1,updated_at=? WHERE id=? AND current_job_id=? AND ?='workspace' AND ${sqlClaim}`,
          [observedAt, row.workspace_id, row.id, row.target_kind, claim],
        ),
        core.statement(
          `UPDATE v2_intakes SET status='collecting',summary_id=NULL,current_job_id=NULL WHERE id=? AND current_job_id=? AND ?='workspace' AND ${sqlClaim}`,
          [row.workspace_id, row.id, row.target_kind, claim],
        ),
        // A file's failed metadata cannot invalidate an independent chat revision.
        core.statement(
          `UPDATE v2_files SET state='failed',failure_code='JOB_TIMEOUT',current_job_id=NULL,updated_at=? WHERE id=? AND current_job_id=? AND ?='file' AND ${sqlClaim}`,
          [observedAt, row.target_id, row.id, row.target_kind, claim],
        ),
        core.finish(claim),
      ]);
      if (changed) recovered++;
    } catch {
      // No inferred terminal state on lookup/write failure. The atomic batch
      // may have committed before an ACK loss; the next scan reads durable state.
    }
  }
  return { inspected: rows.length, recovered };
}
