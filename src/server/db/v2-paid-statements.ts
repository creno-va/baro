import { usageDateKst } from "./repository";
import { type Actor, sqlClaim, type V2Core } from "./v2-core";
import type { PaidHoldRequest } from "./v2-paid-contracts";

export const carryoverSql =
  "coalesce((SELECT sum(reserved_krw+ambiguous_krw) FROM v2_monthly_budget WHERE month<?),0)+coalesce((SELECT sum(amount_krw) FROM v2_maintenance_exposure WHERE month<? AND state IN ('reserved','ambiguous')),0)";
export function budgetAdmissionPredicate(input: {
  pricingProofId: string;
  fundingProofId: string;
  pricingJson: string;
  fundingJson: string;
  amount: number;
  environment: "preview" | "production";
  now: string;
}) {
  const { amount, environment, now } = input;
  const month = usageDateKst(now).slice(0, 7);
  return {
    sql: `EXISTS(SELECT 1 FROM v2_monthly_budget b JOIN v2_runtime_controls c ON c.month=b.month JOIN v2_budget_allocations a ON a.month=b.month AND a.version=b.allocation_version JOIN v2_runtime_proofs ap ON ap.id=c.allocation_proof_id JOIN v2_runtime_proofs pp ON pp.id=? JOIN v2_runtime_proofs fp ON fp.id=? WHERE b.month=? AND b.environment=? AND c.environment=b.environment AND c.phase='active' AND ap.kind='allocation' AND ap.environment=b.environment AND json_extract(ap.payload_json,'$.allocation.version')=b.allocation_version AND json_extract(ap.payload_json,'$.allocation.manifestHash')=a.manifest_hash AND ap.valid_until>? AND ap.verified_at<=? AND pp.kind='pricing' AND fp.kind='funding' AND pp.environment=b.environment AND fp.environment=b.environment AND pp.payload_json=? AND fp.payload_json=? AND pp.verified_at<=? AND fp.verified_at<=? AND pp.valid_until>? AND fp.valid_until>? AND a.reviewed_at<=? AND a.valid_until>? AND a.funding_valid_until>? AND a.funding_state IN ('funded','trial_credit') AND b.settled_krw+b.reserved_krw+b.ambiguous_krw+b.fixed_maintenance_krw+(${carryoverSql})+?<=b.limit_krw AND b.settled_krw+b.reserved_krw+b.ambiguous_krw+b.fixed_maintenance_krw+(${carryoverSql})+?<=json_extract(fp.payload_json,'$.spendAllowanceKrw') AND json_extract(fp.payload_json,'$.state') IN ('funded','trial_credit'))`,
    values: [
      input.pricingProofId,
      input.fundingProofId,
      month,
      environment,
      now,
      now,
      input.pricingJson,
      input.fundingJson,
      now,
      now,
      now,
      now,
      now,
      now,
      now,
      month,
      month,
      amount,
      month,
      month,
      amount,
    ],
  };
}
export interface PreparedPaidHold {
  readonly request: PaidHoldRequest;
  readonly reservedKrw: number;
  readonly predicate: { sql: string; values: unknown[] };
  statements(core: V2Core, actor: Actor, claimId: string): D1PreparedStatement[];
}
const trustedHolds = new WeakSet<object>();
export function isPreparedPaidHold(value: unknown): value is PreparedPaidHold {
  return typeof value === "object" && value !== null && trustedHolds.has(value);
}
export function preparePaidStatements(input: {
  request: PaidHoldRequest;
  reservedKrw: number;
  planHash: string;
  pricingJson: string;
  fundingJson: string;
  planJson: string;
  evidenceHash: string;
  verifiedAt: string;
  environment: "preview" | "production";
  now: string;
  ownerId: string;
}): PreparedPaidHold {
  const freeze = (value: unknown): void => {
    if (value && typeof value === "object") {
      for (const v of Object.values(value)) freeze(v);
      Object.freeze(value);
    }
  };
  input = { ...input, request: JSON.parse(JSON.stringify(input.request)) as PaidHoldRequest };
  freeze(input.request);
  const { request: r, reservedKrw: amount, environment, now } = input;
  const month = usageDateKst(now).slice(0, 7);
  // Distinct authenticated phases reserve additive holds. Reusing an unresolved
  // invocation is denied even if only the attempt identifier changes.
  const budget = budgetAdmissionPredicate({
    pricingProofId: r.pricingProofId,
    fundingProofId: r.fundingProofId,
    pricingJson: input.pricingJson,
    fundingJson: input.fundingJson,
    amount,
    environment,
    now,
  });
  const predicate = {
    sql: `${budget.sql} AND NOT EXISTS(SELECT 1 FROM v2_cost_attempts WHERE id=? OR (invocation_id=? AND attempt=?)) AND NOT EXISTS(SELECT 1 FROM v2_runtime_plans WHERE id=?) AND NOT EXISTS(SELECT 1 FROM v2_paid_holds h JOIN v2_cost_attempts a ON a.id=h.attempt_id WHERE h.job_id=? AND a.invocation_id=? AND a.state IN ('reserved','ambiguous'))`,
    values: [
      ...budget.values,
      r.attemptId,
      r.plan.invocationId,
      r.attempt,
      r.planId,
      r.jobId,
      r.plan.invocationId,
    ],
  };
  const prepared: PreparedPaidHold = {
    request: r,
    reservedKrw: amount,
    predicate,
    statements(core, actor, claimId) {
      if (actor.ownerId !== input.ownerId || actor.now !== now)
        throw new Error("RUNTIME_HOLD_ACTOR_MISMATCH");
      return [
        core.statement(
          `INSERT INTO v2_cost_quotes(id,version,reviewed_at,valid_until,currency,provider_pricing_version,exchange_rate,safety_margin,estimated_krw) SELECT ?,1,?,?,'KRW',?,CAST(json_extract(?,'$.fx.krwPerUsd') AS REAL),CAST(json_extract(?,'$.safetyMarginRatio') AS REAL),? WHERE ${sqlClaim}`,
          [
            r.quoteId,
            now,
            r.plan.deadlineAt,
            r.pricingProofId,
            input.pricingJson,
            input.pricingJson,
            amount,
            claimId,
          ],
        ),
        core.statement(
          `INSERT INTO v2_runtime_plans(id,operation_id,operation_revision,request_hash,invocation_id,pricing_proof_id,funding_proof_id,job_id,target_kind,target_id,target_revision,digest,payload_json,evidence_hash,verified_at,maximum_attempts,reserved_krw,deadline_at,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${sqlClaim}`,
          [
            r.planId,
            r.plan.operationId,
            r.plan.operationRevision,
            r.plan.requestHash,
            r.plan.invocationId,
            r.pricingProofId,
            r.fundingProofId,
            r.jobId,
            r.targetKind,
            r.targetId,
            r.targetRevision,
            input.planHash,
            input.planJson,
            input.evidenceHash,
            input.verifiedAt,
            r.plan.maximumAttempts,
            amount,
            r.plan.deadlineAt,
            now,
            claimId,
          ],
        ),
        core.statement(
          `INSERT INTO v2_cost_attempts(id,principal_id,operation_id,invocation_id,attempt,month,quote_id,service,state,reserved_krw,created_at) SELECT ?,p.id,?,?,?,?,?,?,'reserved',?,? FROM v2_billing_principals p JOIN v2_operations o ON o.owner_id=p.owner_id JOIN v2_jobs j ON j.operation_id=o.id WHERE p.owner_id=? AND o.id=? AND o.revision=? AND j.id=? AND j.target_kind=? AND j.target_id=? AND j.target_revision=? AND (EXISTS(SELECT 1 FROM v2_idempotency i WHERE i.operation_id=o.id AND i.request_hash=?) OR EXISTS(SELECT 1 FROM v2_runtime_plans old WHERE old.operation_id=o.id AND old.request_hash=? AND old.id!=?)) AND ${sqlClaim}`,
          [
            r.attemptId,
            r.plan.operationId,
            r.plan.invocationId,
            r.attempt,
            month,
            r.quoteId,
            r.service,
            amount,
            now,
            actor.ownerId,
            r.plan.operationId,
            r.plan.operationRevision,
            r.jobId,
            r.targetKind,
            r.targetId,
            r.targetRevision,
            r.plan.requestHash,
            r.plan.requestHash,
            r.planId,
            claimId,
          ],
        ),
        core.statement(
          `INSERT INTO v2_paid_holds(attempt_id,plan_id,job_id) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM v2_cost_attempts WHERE id=?) AND ${sqlClaim}`,
          [r.attemptId, r.planId, r.jobId, r.attemptId, claimId],
        ),
        // Failure to insert any binding rolls back op/quota/job/outbox, never partial admission.
        core.statement(
          "UPDATE v2_mutation_claims SET verified=(SELECT count(*)=1 FROM v2_paid_holds WHERE attempt_id=?) WHERE id=?",
          [r.attemptId, claimId],
        ),
        core.statement(
          `UPDATE v2_monthly_budget SET reserved_krw=reserved_krw+? WHERE month=? AND ${sqlClaim}`,
          [amount, month, claimId],
        ),
      ];
    },
  };
  freeze(predicate);
  trustedHolds.add(prepared);
  return Object.freeze(prepared);
}
// No legacy unguarded acquire may start a paid-bound job. Proof/controls are
// checked at acquire AND before each actual transport; no cross-D1 transaction.
export function paidAcquirePredicate(
  attemptId: string | null,
  now: string,
): { sql: string; values: unknown[] } {
  return {
    sql: `((NOT EXISTS(SELECT 1 FROM v2_runtime_controls) AND NOT EXISTS(SELECT 1 FROM v2_paid_holds WHERE job_id=j.id)) OR EXISTS(SELECT 1 FROM v2_paid_holds h JOIN v2_cost_attempts ca ON ca.id=h.attempt_id JOIN v2_runtime_plans p ON p.id=h.plan_id JOIN v2_runtime_controls c ON c.month=ca.month JOIN v2_monthly_budget b ON b.month=c.month JOIN v2_runtime_proofs ap ON ap.id=c.allocation_proof_id JOIN v2_runtime_proofs pp ON pp.id=p.pricing_proof_id JOIN v2_runtime_proofs fp ON fp.id=p.funding_proof_id WHERE h.attempt_id=? AND h.job_id=j.id AND h.state='prepared' AND ca.state='reserved' AND ca.operation_id=j.operation_id AND p.target_id=j.target_id AND p.target_revision=j.target_revision AND p.deadline_at>? AND pp.valid_until>? AND fp.valid_until>? AND c.phase='active' AND ap.valid_until>? AND json_extract(ap.payload_json,'$.allocation.version')=b.allocation_version))`,
    values: [attemptId, now, now, now, now],
  };
}
