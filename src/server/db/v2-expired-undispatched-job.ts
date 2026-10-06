import { z } from "zod";
import { opaqueIdSchema, timestampSchema } from "../../contracts";
import { quotaTransitionStatements } from "./v2-accounting";
import { parse, safe, sqlClaim, type V2Core } from "./v2-core";
import { jobAlive } from "./v2-jobs";
import { usageReceiptSchema } from "./v2-paid-contracts";
import { createV2PaidRuntimeRepository, runtimeDigest } from "./v2-paid-runtime";

const inputSchema = z.strictObject({
  ownerId: opaqueIdSchema,
  jobId: opaqueIdSchema,
  instanceId: opaqueIdSchema,
  now: timestampSchema.transform((v) => new Date(v).toISOString()),
});
export type ExpiredUndispatchedJobInput = z.infer<typeof inputSchema>;
const released = `h.state='final' AND ca.state='released' AND h.dispatch_token IS NULL AND EXISTS(SELECT 1 FROM v2_runtime_usage u WHERE u.attempt_id=ca.id AND u.outcome='released' AND json_extract(u.payload_json,'$.transport')='not_sent' AND json_extract(u.payload_json,'$.definitiveNoCharge')=1 AND json_extract(u.payload_json,'$.dispatchToken') IS NULL)`;
const prepared = "h.state='prepared' AND ca.state='reserved' AND h.dispatch_token IS NULL";
const current = `j.status='queued' AND j.target_kind IN ('file','profile_asset') AND o.state='admitted' AND ca.operation_id=o.id AND p.operation_id=o.id AND p.operation_revision=o.revision AND p.job_id=j.id AND p.target_kind=j.target_kind AND p.target_id=j.target_id AND p.target_revision=j.target_revision AND p.created_at=j.updated_at AND ${jobAlive} AND NOT EXISTS(SELECT 1 FROM v2_paid_holds fresh JOIN v2_cost_attempts fc ON fc.id=fresh.attempt_id JOIN v2_runtime_plans fp ON fp.id=fresh.plan_id WHERE fresh.job_id=j.id AND fp.operation_revision=o.revision AND fp.target_revision=j.target_revision AND fc.state IN ('reserved','ambiguous') AND (fresh.dispatch_token IS NOT NULL OR fp.deadline_at>?))`;
const joins =
  "v2_jobs j JOIN v2_operations o ON o.id=j.operation_id JOIN v2_paid_holds h ON h.job_id=j.id JOIN v2_runtime_plans p ON p.id=h.plan_id JOIN v2_cost_attempts ca ON ca.id=h.attempt_id JOIN v2_monthly_budget budget ON budget.month=ca.month";

/** A trusted Workflow recovery entry, never a client receipt endpoint. Each
 * refund uses the existing final prepared/reserved/null-token CAS. A dispatched
 * or ambiguous attempt cannot be erased. The second target transaction can be
 * resumed from the durable canonical unsent receipt after a crash. */
export function stopExpiredUndispatchedJob(
  core: V2Core,
  environment: "preview" | "production",
  value: ExpiredUndispatchedJobInput,
): Promise<boolean> {
  return safe(async () => {
    parse(z.enum(["preview", "production"]), environment);
    const input = parse(inputSchema, value),
      { ownerId, jobId, instanceId, now } = input;
    const row = await core
      .statement(
        `SELECT h.attempt_id,p.digest,p.invocation_id,p.deadline_at,j.fencing,j.updated_at,ca.state AS cost_state,j.target_kind,j.target_id,j.target_revision,o.revision AS operation_revision FROM ${joins} WHERE j.id=? AND o.owner_id=? AND j.runtime_instance_id=? AND budget.environment=? AND p.deadline_at<=? AND (${prepared} OR (${released})) AND ${current} ORDER BY p.created_at DESC,p.id DESC LIMIT 1`,
        [jobId, ownerId, instanceId, environment, now, now],
      )
      .first<{
        attempt_id: string;
        digest: string;
        invocation_id: string;
        deadline_at: string;
        fencing: number;
        updated_at: string;
        cost_state: string;
        target_kind: string;
        target_id: string;
        target_revision: number;
        operation_revision: number;
      }>();
    if (!row) return false;
    if (row.cost_state === "reserved") {
      const receipt = usageReceiptSchema.parse({
        id: crypto.randomUUID(),
        attemptId: row.attempt_id,
        invocationId: row.invocation_id,
        providerRequestId: null,
        dispatchToken: null,
        observedAt: now,
        transport: "not_sent",
        definitiveNoCharge: true,
        meteringComplete: false,
        quantities: [],
        chargedUsd: null,
        modelTokenDetails: null,
      });
      const digest = await runtimeDigest(receipt),
        evidenceHash = await runtimeDigest({
          scope: "expired_initial_undispatched",
          jobId,
          instanceId,
          fencing: row.fencing,
          planDigest: row.digest,
          receiptDigest: digest,
        });
      const runtime = createV2PaidRuntimeRepository(
        core,
        environment,
        async (kind, _payload, hash) =>
          kind === "usage" && hash === digest
            ? { digest, evidenceHash, method: "authenticated_coordinator", verifiedAt: now }
            : null,
      );
      if (!(await runtime.recordUsage(receipt, now))) return false;
    }
    const claim = crypto.randomUUID();
    return core.changed([
      core.statement(
        `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,o.owner_id,j.id,j.target_revision FROM ${joins} WHERE j.id=? AND o.owner_id=? AND j.runtime_instance_id=? AND budget.environment=? AND h.attempt_id=? AND p.digest=? AND p.deadline_at<=? AND j.fencing=? AND j.updated_at=? AND j.target_kind=? AND j.target_id=? AND j.target_revision=? AND o.revision=? AND (${released}) AND ${current}`,
        [
          claim,
          jobId,
          ownerId,
          instanceId,
          environment,
          row.attempt_id,
          row.digest,
          now,
          row.fencing,
          row.updated_at,
          row.target_kind,
          row.target_id,
          row.target_revision,
          row.operation_revision,
          now,
        ],
      ),
      core.statement(
        `UPDATE v2_jobs SET status='failed',failure_code='BUDGET_UNAVAILABLE',retryable=1,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND ${sqlClaim}`,
        [now, jobId, claim],
      ),
      core.statement(
        `UPDATE v2_operations SET state='failed' WHERE id=(SELECT operation_id FROM v2_jobs WHERE id=?) AND ${sqlClaim}`,
        [jobId, claim],
      ),
      ...quotaTransitionStatements(core, jobId, claim, "released", undefined, true),
      core.statement(
        `UPDATE v2_files SET state='failed',failure_code='BUDGET_UNAVAILABLE',current_job_id=NULL,updated_at=? WHERE current_job_id=? AND ${sqlClaim}`,
        [now, jobId, claim],
      ),
      core.statement(
        `UPDATE v2_assets SET state='failed',failure_code='BUDGET_UNAVAILABLE',current_job_id=NULL WHERE current_job_id=? AND ${sqlClaim}`,
        [jobId, claim],
      ),
      core.finish(claim),
    ]);
  });
}
