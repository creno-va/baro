import { z } from "zod";
import { opaqueIdSchema, timestampSchema } from "../../../contracts";
import type { V2Core } from "../../db/v2-core";
import { type CleanupLease, cleanupLeaseSchema } from "../../db/v2-deletion";
import { paidHoldRequestSchema } from "../../db/v2-paid-contracts";
import { runtimeDigest } from "../../db/v2-paid-runtime";

const anchorSchema = z.strictObject({
  workspace_id: opaqueIdSchema,
  created_at: timestampSchema,
  principal_id: opaqueIdSchema,
  owner_id: opaqueIdSchema,
});

/** Historical identity evidence only, never an execution/stop/settlement receipt.
 * The captured storage inventory provides an independent owner anchor after the
 * workspace and jobs cascade away. A text-only/unknown journal stays quarantined.
 */
export async function provesWorkspaceOnlyCleanup(
  core: V2Core,
  lease: CleanupLease,
  runtimeId: string,
  environment: "preview" | "production",
  clock: () => string,
) {
  const identity =
    /^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})-([1-9]|10)$/.exec(runtimeId);
  if (!identity || !cleanupLeaseSchema.safeParse(lease).success) return false;
  const anchor = async () => {
    const at = timestampSchema.parse(clock());
    const rows = (
      await core
        .statement(
          `SELECT DISTINCT j.target_id workspace_id,j.created_at,
        CASE WHEN coalesce(r.created_at,b.created_at)<=j.created_at THEN p.id END principal_id,
        p.owner_id
      FROM v2_deletion_journals j
      JOIN v2_deletion_targets job ON job.journal_id=j.id AND job.kind='job' AND job.target_id=? AND job.state='pending'
      JOIN v2_deletion_targets captured ON captured.journal_id=j.id AND captured.kind IN ('reservation','blob')
      LEFT JOIN v2_storage_reservations r ON captured.kind='reservation' AND r.id=captured.target_id
      LEFT JOIN v2_blobs b ON captured.kind='blob' AND b.id=captured.target_id
      LEFT JOIN v2_billing_principals p ON p.id=coalesce(r.principal_id,b.principal_id)
      WHERE j.id=? AND j.target_kind='workspace' AND j.state='running' AND j.lease_token=? AND j.fencing=? AND j.lease_until>?
        AND EXISTS(SELECT 1 FROM v2_tombstones t WHERE t.target_kind='workspace' AND t.target_id=j.target_id)
        AND NOT EXISTS(SELECT 1 FROM v2_workspaces w WHERE w.id=j.target_id)
        AND NOT EXISTS(SELECT 1 FROM v2_runtime_plans prior WHERE prior.job_id=?)
        AND NOT EXISTS(SELECT 1 FROM v2_paid_holds prior WHERE prior.job_id=?)
      LIMIT 2`,
          [runtimeId, lease.journalId, lease.token, lease.fencing, at, identity[1], identity[1]],
        )
        .all()
    ).results;
    if (rows.length !== 1) return null;
    const parsed = anchorSchema.safeParse(rows[0]);
    return parsed.success ? parsed.data : null;
  };
  const captured = await anchor();
  if (!captured) return false;
  // Match runtime directly, including contradictory rows with another job ID.
  // The bounded historical fallback is not used by ordinary named native cleanup.
  const rows = (
    await core
      .statement(
        `SELECT a.*,p.owner_id FROM v2_execution_admissions a
    LEFT JOIN v2_billing_principals p ON p.id=a.principal_id
    WHERE a.runtime_instance_id=? LIMIT 65`,
        [runtimeId],
      )
      .all<Record<string, unknown>>()
  ).results;
  if (rows.length === 0 || rows.length > 64) return false;
  for (const row of rows) {
    if (
      row.kind !== "job" ||
      row.environment !== environment ||
      row.runtime_instance_id !== runtimeId ||
      row.job_id !== identity[1] ||
      row.target_kind !== "workspace" ||
      row.target_id !== captured.workspace_id ||
      row.principal_id !== captured.principal_id ||
      row.owner_id !== captured.owner_id ||
      row.service !== "model" ||
      typeof row.created_at !== "string" ||
      !timestampSchema.safeParse(row.created_at).success ||
      Date.parse(row.created_at) > Date.parse(captured.created_at) ||
      typeof row.verified_at !== "string" ||
      !timestampSchema.safeParse(row.verified_at).success ||
      Date.parse(row.verified_at) > Date.parse(row.created_at) ||
      typeof row.payload_json !== "string" ||
      new TextEncoder().encode(row.payload_json).byteLength > 65536
    )
      return false;
    let raw: unknown;
    try {
      raw = JSON.parse(row.payload_json);
    } catch {
      return false;
    }
    const parsed = paidHoldRequestSchema.safeParse(raw);
    if (!parsed.success) return false;
    const request = parsed.data;
    if (
      request.attemptId !== row.attempt_id ||
      request.planId !== row.plan_id ||
      request.jobId !== row.job_id ||
      request.targetKind !== row.target_kind ||
      request.targetId !== row.target_id ||
      request.targetRevision !== row.target_revision ||
      request.attempt !== row.attempt ||
      request.service !== row.service ||
      request.plan.operationId !== row.operation_id ||
      request.plan.operationRevision !== row.operation_revision ||
      request.plan.requestHash !== row.request_hash ||
      request.plan.invocationId !== row.invocation_id ||
      request.plan.deadlineAt !== row.deadline_at ||
      (await runtimeDigest(request)) !== row.digest
    )
      return false;
  }
  // Hash verification yields. Recheck the current lease and independent owner
  // anchor before letting the existing final receipt CAS run.
  const current = await anchor();
  return (
    current !== null &&
    current.workspace_id === captured.workspace_id &&
    current.created_at === captured.created_at &&
    current.principal_id === captured.principal_id &&
    current.owner_id === captured.owner_id
  );
}
