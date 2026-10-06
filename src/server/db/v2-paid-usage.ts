import { timestampSchema } from "../../contracts";
import { parse, safe, type V2Core } from "./v2-core";
import {
  paidHoldRequestSchema,
  pricingProofSchema,
  type RuntimeProofVerifier,
  receiptKrw,
  type UsageReceipt,
  usageReceiptSchema,
  verifiedEvidenceSchema,
} from "./v2-paid-contracts";
import { runtimeDigest } from "./v2-paid-runtime";
import { storagePaidHoldRequestSchema } from "./v2-storage-paid-contracts";

const iso = timestampSchema.transform((v) => new Date(v).toISOString());
const financialClaim = "EXISTS(SELECT 1 FROM v2_runtime_claims WHERE id=?)";
const financialFinish = (core: V2Core, id: string) =>
  core.statement("DELETE FROM v2_runtime_claims WHERE id=?", [id]);

export function recordRuntimeUsage(
  core: V2Core,
  verify: RuntimeProofVerifier | undefined,
  receipt: UsageReceipt,
  now: string,
  storage = false,
) {
  const holds = storage ? "v2_storage_paid_executions" : "v2_paid_holds";
  const plansJoin = storage
    ? "JOIN v2_storage_paid_executions p ON p.attempt_id=h.attempt_id"
    : "JOIN v2_runtime_plans p ON p.id=h.plan_id";
  return safe(async () => {
    now = parse(iso, now);
    const r = parse(usageReceiptSchema, receipt);
    if (!verify || Date.parse(r.observedAt) > Date.parse(now)) return false;
    const row = await core
      .statement(
        `SELECT h.state AS dispatch_state,h.dispatch_token,p.payload_json,p.pricing_proof_id,ca.* FROM ${holds} h ${plansJoin} JOIN v2_cost_attempts ca ON ca.id=h.attempt_id WHERE h.attempt_id=?`,
        [r.attemptId],
      )
      .first<{
        dispatch_state: string;
        dispatch_token: string | null;
        payload_json: string;
        pricing_proof_id: string;
        state: string;
        month: string;
        reserved_krw: number;
        invocation_id: string;
      }>();
    if (
      !row ||
      r.invocationId !== row.invocation_id ||
      !["reserved", "ambiguous"].includes(row.state)
    )
      return false;
    if (row.dispatch_state === "prepared" && !r.definitiveNoCharge) return false;
    if (r.dispatchToken !== row.dispatch_token) return false;
    if (
      r.definitiveNoCharge &&
      (row.dispatch_state !== "prepared" || row.dispatch_token !== null || row.state !== "reserved")
    )
      return false;
    const pricing = await core
      .statement(
        "SELECT payload_json,digest FROM v2_runtime_proofs WHERE id=? AND kind='pricing'",
        [row.pricing_proof_id],
      )
      .first<{ payload_json: string; digest: string }>();
    if (!pricing) return false;
    const p = parse(pricingProofSchema, JSON.parse(pricing.payload_json));
    if ((await runtimeDigest(p)) !== pricing.digest) return false;
    const plan = storage
      ? parse(storagePaidHoldRequestSchema, JSON.parse(row.payload_json))
      : parse(paidHoldRequestSchema, JSON.parse(row.payload_json));
    if (r.quantities.some((q) => !plan.plan.quantities.some((i) => i.sku === q.sku))) return false;
    if (
      r.meteringComplete &&
      (r.quantities.length !== plan.plan.quantities.length ||
        plan.plan.quantities.some((i) => !r.quantities.some((q) => q.sku === i.sku)))
    )
      return false;
    const digest = await runtimeDigest(r),
      evidence = await verify("usage", r, digest);
    if (!evidence) return false;
    const e = parse(verifiedEvidenceSchema, evidence);
    if (
      e.digest !== digest ||
      Date.parse(e.verifiedAt) > Date.parse(now) ||
      ![
        "provider_receipt",
        "authenticated_console",
        ...(r.definitiveNoCharge ? ["authenticated_coordinator"] : []),
      ].includes(e.method)
    )
      return false;
    let charged: number | null = null,
      amountOverflow = false;
    try {
      charged = receiptKrw(p, r);
    } catch {
      amountOverflow = true;
    }
    const outcome = r.definitiveNoCharge ? "released" : charged === null ? "ambiguous" : "settled";
    if (row.state === "ambiguous" && outcome === "ambiguous") {
      // Late incomplete observations add immutable evidence without a fake
      // ambiguous→ambiguous monetary transition or releasing the hold.
      const claimId = crypto.randomUUID();
      return core.changed([
        core.statement(
          `INSERT INTO v2_runtime_claims(id,owner_id,target_id,revision) SELECT ?,ca.principal_id,ca.id,1 FROM v2_cost_attempts ca JOIN ${holds} h ON h.attempt_id=ca.id WHERE ca.id=? AND ca.state='ambiguous' AND h.state=? AND h.dispatch_token IS ? AND NOT EXISTS(SELECT 1 FROM v2_runtime_usage WHERE id=?)`,
          [claimId, r.attemptId, row.dispatch_state, r.dispatchToken, r.id],
        ),
        core.statement(
          `INSERT INTO v2_runtime_usage(id,attempt_id,digest,payload_json,evidence_hash,observed_at,outcome,charged_krw) SELECT ?,?,?,?,?,?,'ambiguous',NULL WHERE ${financialClaim}`,
          [r.id, r.attemptId, digest, JSON.stringify(r), e.evidenceHash, r.observedAt, claimId],
        ),
        core.statement(
          `UPDATE v2_runtime_controls SET phase='frozen',local_drain_id=NULL,revision=revision+1,updated_at=? WHERE ?=1 AND ${financialClaim}`,
          [now, amountOverflow ? 1 : 0, claimId],
        ),
        financialFinish(core, claimId),
      ]);
    }
    if (row.state === "ambiguous" && outcome !== "settled") return false;
    const oldColumn = row.state === "reserved" ? "reserved_krw" : "ambiguous_krw";
    const newColumn =
      outcome === "settled" ? "settled_krw" : outcome === "ambiguous" ? "ambiguous_krw" : null;
    const claimId = crypto.randomUUID(),
      transitionId = crypto.randomUUID();
    return core.changed([
      core.statement(
        `INSERT INTO v2_runtime_claims(id,owner_id,target_id,revision) SELECT ?,ca.principal_id,ca.id,1 FROM v2_cost_attempts ca JOIN ${holds} h ON h.attempt_id=ca.id WHERE ca.id=? AND ca.state=? AND h.state=? AND h.dispatch_token IS ? AND (?=0 OR (h.state='prepared' AND h.dispatch_token IS NULL AND ca.state='reserved')) AND NOT EXISTS(SELECT 1 FROM v2_runtime_usage WHERE id=?)`,
        [
          claimId,
          r.attemptId,
          row.state,
          row.dispatch_state,
          r.dispatchToken,
          r.definitiveNoCharge ? 1 : 0,
          r.id,
        ],
      ),
      core.statement(
        `INSERT INTO v2_runtime_usage(id,attempt_id,digest,payload_json,evidence_hash,observed_at,outcome,charged_krw) SELECT ?,?,?,?,?,?,?,? WHERE ${financialClaim}`,
        [
          r.id,
          r.attemptId,
          digest,
          JSON.stringify(r),
          e.evidenceHash,
          r.observedAt,
          outcome,
          outcome === "settled" ? charged : null,
          claimId,
        ],
      ),
      core.statement(
        `INSERT INTO v2_cost_receipts(id,attempt_id,previous_state,next_state) SELECT ?,?,?,? WHERE ${financialClaim}`,
        [transitionId, r.attemptId, row.state, outcome, claimId],
      ),
      core.statement(
        `UPDATE v2_monthly_budget SET ${oldColumn}=${oldColumn}-?${newColumn ? `,${newColumn}=${newColumn}+?` : ""} WHERE month=? AND ${financialClaim}`,
        [
          row.reserved_krw,
          ...(newColumn ? [outcome === "settled" ? charged : row.reserved_krw] : []),
          row.month,
          claimId,
        ],
      ),
      core.statement(
        `UPDATE v2_cost_attempts SET state=?,charged_krw=? WHERE id=? AND ${financialClaim}`,
        [outcome, outcome === "settled" ? charged : null, r.attemptId, claimId],
      ),
      core.statement(`UPDATE ${holds} SET state=? WHERE attempt_id=? AND ${financialClaim}`, [
        outcome === "ambiguous" ? "unknown" : "final",
        r.attemptId,
        claimId,
      ]),
      core.statement(
        `UPDATE v2_runtime_controls SET phase='frozen',local_drain_id=NULL,revision=revision+1,updated_at=? WHERE (?=1 OR EXISTS(SELECT 1 FROM v2_monthly_budget b WHERE b.month=v2_runtime_controls.month AND b.settled_krw+b.reserved_krw+b.ambiguous_krw+b.fixed_maintenance_krw>b.limit_krw)) AND ${financialClaim}`,
        [now, amountOverflow || (charged !== null && charged > row.reserved_krw) ? 1 : 0, claimId],
      ),
      financialFinish(core, claimId),
    ]);
  });
}
