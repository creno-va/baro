import { z } from "zod";
import { opaqueIdSchema, timestampSchema } from "../../contracts";
import { usageDateKst } from "./repository";
import { allocationSchema } from "./v2-accounting";
import { type Actor, actorSchema, hashSchema, parse, safe, sqlClaim, type V2Core } from "./v2-core";
import { jobAlive } from "./v2-jobs";
import {
  estimatePlanKrw,
  type FundingProof,
  fundingProofSchema,
  type PaidHoldRequest,
  type PricingProof,
  paidHoldRequestSchema,
  pricingProofSchema,
  type RuntimeProofVerifier,
  receiptKrw,
  type UsageReceipt,
  usageReceiptSchema,
  verifiedEvidenceSchema,
} from "./v2-paid-contracts";
import {
  carryoverSql,
  isPreparedPaidHold,
  type PreparedPaidHold,
  preparePaidStatements,
} from "./v2-paid-statements";
import { type JobLease, leaseSchema } from "./v2-workspace";

export * from "./v2-paid-contracts";

const financialClaim = "EXISTS(SELECT 1 FROM v2_runtime_claims WHERE id=?)";
const financialFinish = (core: V2Core, id: string) =>
  core.statement("DELETE FROM v2_runtime_claims WHERE id=?", [id]);
const environmentSchema = z.enum(["preview", "production"]);
const iso = timestampSchema.transform((v) => new Date(v).toISOString());
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const safeAmount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const allocationProofSchema = z.strictObject({
  id: opaqueIdSchema,
  environment: environmentSchema,
  allocation: allocationSchema,
});
export const drainProofSchema = z
  .strictObject({
    id: opaqueIdSchema,
    environment: environmentSchema,
    month: monthSchema,
    version: z.number().int().positive(),
    controlRevision: z.number().int().positive(),
    manifestHash: hashSchema,
    settledKrw: safeAmount,
    fixedKrw: safeAmount,
    carryoverKrw: safeAmount,
    reservedKrw: z.literal(0),
    ambiguousKrw: z.literal(0),
    limitKrw: z.number().int().min(0).max(1000000),
    observedAt: iso,
    validUntil: iso,
  })
  .refine((p) => Date.parse(p.validUntil) > Date.parse(p.observedAt));
export type AllocationProof = z.infer<typeof allocationProofSchema>;
export type DrainProof = z.infer<typeof drainProofSchema>;
type ProofRow = {
  id: string;
  kind: string;
  environment: string;
  digest: string;
  payload_json: string;
  evidence_hash: string;
  verified_at: string;
  valid_until: string;
};
export async function runtimeDigest(payload: unknown): Promise<string> {
  // Strict parsed proof DTOs have no undefined/non-JSON values. Object insertion
  // order is not provenance; array order is retained as part of the exact plan.
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b, "en"))
          .map(([key, item]) => [key, canonical(item)]),
      );
    return value;
  };
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(payload)));
  if (bytes.byteLength > 65536) throw new Error("RUNTIME_PROOF_TOO_LARGE");
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
function freshPricing(p: PricingProof, now: string, deadline: string): boolean {
  const start = Date.parse(now),
    end = Date.parse(deadline);
  return (
    end > start &&
    end - start <= 3600000 &&
    [p, p.fx, ...p.prices].every(
      (item) => Date.parse(item.checkedAt) <= start && Date.parse(item.validUntil) >= end,
    ) &&
    Date.parse(p.fx.asOf) <= start
  );
}
export function createV2PaidRuntimeRepository(
  core: V2Core,
  environment: "preview" | "production",
  verify?: RuntimeProofVerifier,
) {
  parse(environmentSchema, environment);
  async function putProof(
    kind: "pricing" | "funding" | "allocation" | "drain",
    value: unknown,
    now: string,
  ): Promise<boolean> {
    now = parse(iso, now);
    if (!verify) return false;
    const p =
      kind === "pricing"
        ? parse(pricingProofSchema, value)
        : kind === "funding"
          ? parse(fundingProofSchema, value)
          : kind === "allocation"
            ? parse(allocationProofSchema, value)
            : parse(drainProofSchema, value);
    if (p.environment !== environment && kind !== "drain") return false;
    const expiry = "allocation" in p ? p.allocation.validUntil : p.validUntil;
    if (Date.parse(expiry) <= Date.parse(now)) return false;
    const digest = await runtimeDigest(p);
    const evidence = await verify(kind, p, digest);
    if (!evidence) return false;
    const e = parse(verifiedEvidenceSchema, evidence);
    if (
      e.digest !== digest ||
      Date.parse(e.verifiedAt) > Date.parse(now) ||
      Date.parse(e.verifiedAt) >= Date.parse(expiry) ||
      (kind === "pricing" && !["official_document", "authenticated_console"].includes(e.method)) ||
      (kind === "funding" && e.method !== "authenticated_console") ||
      ((kind === "allocation" || kind === "drain") && e.method !== "authenticated_coordinator")
    )
      return false;
    const existing = await core
      .statement("SELECT digest FROM v2_runtime_proofs WHERE id=?", [p.id])
      .first<string>("digest");
    if (existing) return existing === digest;
    return (
      (
        await core
          .statement(
            "INSERT INTO v2_runtime_proofs(id,kind,environment,digest,payload_json,evidence_hash,verification_method,verified_at,valid_until) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
            [
              p.id,
              kind,
              p.environment,
              digest,
              JSON.stringify(p),
              e.evidenceHash,
              e.method,
              e.verifiedAt,
              new Date(expiry).toISOString(),
            ],
          )
          .run()
      ).meta.changes === 1
    );
  }
  async function proof<T>(
    id: string,
    kind: string,
    schema: z.ZodType<T>,
    now: string,
  ): Promise<{ row: ProofRow; value: T } | null> {
    parse(opaqueIdSchema, id);
    const row = await core
      .statement(
        "SELECT * FROM v2_runtime_proofs WHERE id=? AND kind=? AND verified_at<=? AND valid_until>?",
        [id, kind, now, now],
      )
      .first<ProofRow>();
    if (!row) return null;
    const value = parse(schema, JSON.parse(row.payload_json));
    if ((await runtimeDigest(value)) !== row.digest) return null;
    return { row, value };
  }
  return {
    putPricingProof: (p: PricingProof, now: string) => safe(() => putProof("pricing", p, now)),
    putFundingProof: (p: FundingProof, now: string) => safe(() => putProof("funding", p, now)),
    putAllocationProof: (p: AllocationProof, now: string) =>
      safe(() => putProof("allocation", p, now)),
    putRemoteDrainProof: (p: DrainProof, now: string) => safe(() => putProof("drain", p, now)),
    findProof(id: string, now: string) {
      return safe(async () => {
        now = parse(iso, now);
        parse(opaqueIdSchema, id);
        const row = await core
          .statement(
            "SELECT * FROM v2_runtime_proofs WHERE id=? AND environment=? AND verified_at<=? AND valid_until>?",
            [id, environment, now, now],
          )
          .first<ProofRow>();
        if (!row || (await runtimeDigest(JSON.parse(row.payload_json))) !== row.digest) return null;
        return {
          id: row.id,
          kind: row.kind,
          digest: row.digest,
          evidenceHash: row.evidence_hash,
          verifiedAt: row.verified_at,
          validUntil: row.valid_until,
          payload: JSON.parse(row.payload_json) as unknown,
        };
      });
    },
    prepareHold(actor: Actor, input: PaidHoldRequest): Promise<PreparedPaidHold | null> {
      return safe(async () => {
        actor = parse(actorSchema, actor);
        const r = parse(paidHoldRequestSchema, input);
        const skus = new Set(r.plan.quantities.map((q) => q.sku));
        if (
          (r.service === "model" &&
            (!skus.has("model_input_tokens") || !skus.has("model_output_tokens"))) ||
          (r.service === "asr" && !skus.has("asr_seconds")) ||
          (r.service === "container" && !skus.has("container_cpu_seconds")) ||
          (r.service === "storage" &&
            !skus.has("r2_storage_gb_months") &&
            !skus.has("d1_storage_gb_months")) ||
          (r.service === "requests" &&
            !skus.has("worker_requests") &&
            !skus.has("r2_class_a_requests") &&
            !skus.has("r2_class_b_requests")) ||
          (r.service === "fixed_operation" && !skus.has("fixed_operation"))
        )
          return null;
        if (r.attempt > r.plan.maximumAttempts || r.plan.operationRevision < 1) return null;
        const p = await proof(r.pricingProofId, "pricing", pricingProofSchema, actor.now);
        const f = await proof(r.fundingProofId, "funding", fundingProofSchema, actor.now);
        if (
          !p ||
          !f ||
          p.value.environment !== environment ||
          f.value.environment !== environment ||
          !freshPricing(p.value, actor.now, r.plan.deadlineAt) ||
          f.value.state === "unavailable" ||
          Date.parse(f.value.observedAt) > Date.parse(actor.now) ||
          Date.parse(f.value.validUntil) < Date.parse(r.plan.deadlineAt)
        )
          return null;
        if (
          r.plan.quantities.some(
            (q) => p.value.prices.find((price) => price.sku === q.sku)?.billingMode !== "metered",
          ) ||
          !verify
        )
          return null;
        const planHash = await runtimeDigest(r),
          evidence = await verify("execution", r, planHash);
        if (!evidence) return null;
        const e = parse(verifiedEvidenceSchema, evidence);
        if (
          e.digest !== planHash ||
          e.method !== "authenticated_coordinator" ||
          Date.parse(e.verifiedAt) > Date.parse(actor.now)
        )
          return null;
        const amount = estimatePlanKrw(p.value, r.plan.quantities);
        if (amount > 1000000 || amount > f.value.spendAllowanceKrw) return null;
        const owner = await core
          .statement(
            "SELECT p.id FROM v2_billing_principals p JOIN user u ON u.id=p.owner_id WHERE u.id=? AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='account' AND target_id=u.id)",
            [actor.ownerId],
          )
          .first();
        if (!owner) return null;
        return preparePaidStatements({
          request: r,
          reservedKrw: amount,
          planHash,
          planJson: JSON.stringify(r),
          evidenceHash: e.evidenceHash,
          verifiedAt: e.verifiedAt,
          pricingJson: p.row.payload_json,
          fundingJson: f.row.payload_json,
          environment,
          now: actor.now,
          ownerId: actor.ownerId,
        });
      });
    },
    reserveAttempt(actor: Actor, lease: JobLease, paid: PreparedPaidHold) {
      return safe(async () => {
        actor = parse(actorSchema, actor);
        parse(leaseSchema, lease);
        if (!isPreparedPaidHold(paid) || paid.request.jobId !== lease.jobId) return false;
        const r = paid.request,
          claimId = crypto.randomUUID();
        return core.changed([
          core.statement(
            `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,o.owner_id,j.id,j.target_revision FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id WHERE j.id=? AND o.owner_id=? AND o.id=? AND o.revision=? AND j.target_kind=? AND j.target_id=? AND j.target_revision=? AND j.lease_token=? AND j.fencing=? AND j.lease_until>? AND j.status IN ('running','validating') AND o.state='admitted' AND (${paid.predicate.sql}) AND ${jobAlive}`,
            [
              claimId,
              lease.jobId,
              actor.ownerId,
              r.plan.operationId,
              r.plan.operationRevision,
              r.targetKind,
              r.targetId,
              r.targetRevision,
              lease.token,
              lease.fencing,
              actor.now,
              ...paid.predicate.values,
            ],
          ),
          ...paid.statements(core, actor, claimId),
          core.finish(claimId),
        ]);
      });
    },
    beforeDispatch(actor: Actor, lease: JobLease, attemptId: string) {
      return safe(async () => {
        actor = parse(actorSchema, actor);
        parse(leaseSchema, lease);
        parse(opaqueIdSchema, attemptId);
        const token = crypto.randomUUID(),
          claimId = crypto.randomUUID();
        const ok = await core.changed([
          core.statement(
            `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,o.owner_id,j.id,j.target_revision FROM v2_jobs j JOIN v2_operations o ON o.id=j.operation_id JOIN v2_paid_holds h ON h.job_id=j.id JOIN v2_cost_attempts ca ON ca.id=h.attempt_id JOIN v2_runtime_plans p ON p.id=h.plan_id JOIN v2_runtime_controls c ON c.month=ca.month JOIN v2_runtime_proofs pp ON pp.id=p.pricing_proof_id JOIN v2_runtime_proofs fp ON fp.id=p.funding_proof_id JOIN v2_runtime_proofs ap ON ap.id=c.allocation_proof_id JOIN v2_monthly_budget b ON b.month=c.month WHERE j.id=? AND o.owner_id=? AND j.lease_token=? AND j.fencing=? AND j.lease_until>? AND j.status IN ('running','validating') AND o.state='admitted' AND h.attempt_id=? AND h.state='prepared' AND ca.state='reserved' AND ca.operation_id=o.id AND p.operation_revision=o.revision AND p.job_id=j.id AND p.target_kind=j.target_kind AND p.target_id=j.target_id AND p.target_revision=j.target_revision AND p.deadline_at>? AND pp.valid_until>? AND fp.valid_until>? AND ap.valid_until>? AND c.phase='active' AND c.environment=? AND json_extract(ap.payload_json,'$.allocation.version')=b.allocation_version AND ${jobAlive}`,
            [
              claimId,
              lease.jobId,
              actor.ownerId,
              lease.token,
              lease.fencing,
              actor.now,
              attemptId,
              actor.now,
              actor.now,
              actor.now,
              actor.now,
              environment,
            ],
          ),
          core.statement(
            `UPDATE v2_paid_holds SET state='dispatched',lease_token=?,fencing=?,dispatch_token=?,dispatched_at=? WHERE attempt_id=? AND ${sqlClaim}`,
            [lease.token, lease.fencing, token, actor.now, attemptId, claimId],
          ),
          core.finish(claimId),
        ]);
        if (!ok) return null;
        const binding = await core
          .statement(
            `SELECT h.plan_id,p.digest,p.pricing_proof_id,p.funding_proof_id,ca.quote_id,ca.invocation_id,ca.attempt FROM v2_paid_holds h JOIN v2_runtime_plans p ON p.id=h.plan_id JOIN v2_cost_attempts ca ON ca.id=h.attempt_id JOIN v2_jobs j ON j.id=h.job_id JOIN v2_operations o ON o.id=j.operation_id JOIN v2_runtime_controls c ON c.month=ca.month WHERE h.attempt_id=? AND h.dispatch_token=? AND j.lease_token=? AND j.fencing=? AND j.lease_until>? AND o.owner_id=? AND c.phase='active' AND ${jobAlive}`,
            [attemptId, token, lease.token, lease.fencing, actor.now, actor.ownerId],
          )
          .first<{
            plan_id: string;
            digest: string;
            pricing_proof_id: string;
            funding_proof_id: string;
            quote_id: string;
            invocation_id: string;
            attempt: number;
          }>();
        return binding
          ? {
              attemptId,
              jobId: lease.jobId,
              leaseToken: lease.token,
              fencing: lease.fencing,
              dispatchToken: token,
              planId: binding.plan_id,
              planHash: binding.digest,
              pricingProofId: binding.pricing_proof_id,
              fundingProofId: binding.funding_proof_id,
              quoteId: binding.quote_id,
              invocationId: binding.invocation_id,
              attempt: binding.attempt,
            }
          : null;
      });
    },
    // Verification occurs before ledger writes. It can authenticate late receipts
    // after owner/job deletion; neither case data nor a live user FK is required.
    recordUsage(receipt: UsageReceipt, now: string) {
      return safe(async () => {
        now = parse(iso, now);
        const r = parse(usageReceiptSchema, receipt);
        if (!verify || Date.parse(r.observedAt) > Date.parse(now)) return false;
        const row = await core
          .statement(
            "SELECT h.state AS dispatch_state,h.dispatch_token,p.payload_json,p.pricing_proof_id,ca.* FROM v2_paid_holds h JOIN v2_runtime_plans p ON p.id=h.plan_id JOIN v2_cost_attempts ca ON ca.id=h.attempt_id WHERE h.attempt_id=?",
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
          (row.dispatch_state !== "prepared" ||
            row.dispatch_token !== null ||
            row.state !== "reserved")
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
        const plan = parse(paidHoldRequestSchema, JSON.parse(row.payload_json));
        if (r.quantities.some((q) => !plan.plan.quantities.some((i) => i.sku === q.sku)))
          return false;
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
        const outcome = r.definitiveNoCharge
          ? "released"
          : charged === null
            ? "ambiguous"
            : "settled";
        if (row.state === "ambiguous" && outcome === "ambiguous") {
          // Late incomplete observations add immutable evidence without a fake
          // ambiguous→ambiguous monetary transition or releasing the hold.
          const claimId = crypto.randomUUID();
          return core.changed([
            core.statement(
              "INSERT INTO v2_runtime_claims(id,owner_id,target_id,revision) SELECT ?,ca.principal_id,ca.id,1 FROM v2_cost_attempts ca JOIN v2_paid_holds h ON h.attempt_id=ca.id WHERE ca.id=? AND ca.state='ambiguous' AND h.state=? AND h.dispatch_token IS ? AND NOT EXISTS(SELECT 1 FROM v2_runtime_usage WHERE id=?)",
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
            "INSERT INTO v2_runtime_claims(id,owner_id,target_id,revision) SELECT ?,ca.principal_id,ca.id,1 FROM v2_cost_attempts ca JOIN v2_paid_holds h ON h.attempt_id=ca.id WHERE ca.id=? AND ca.state=? AND h.state=? AND h.dispatch_token IS ? AND (?=0 OR (h.state='prepared' AND h.dispatch_token IS NULL AND ca.state='reserved')) AND NOT EXISTS(SELECT 1 FROM v2_runtime_usage WHERE id=?)",
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
          core.statement(
            `UPDATE v2_paid_holds SET state=? WHERE attempt_id=? AND ${financialClaim}`,
            [outcome === "ambiguous" ? "unknown" : "final", r.attemptId, claimId],
          ),
          core.statement(
            `UPDATE v2_runtime_controls SET phase='frozen',local_drain_id=NULL,revision=revision+1,updated_at=? WHERE (?=1 OR EXISTS(SELECT 1 FROM v2_monthly_budget b WHERE b.month=v2_runtime_controls.month AND b.settled_krw+b.reserved_krw+b.ambiguous_krw+b.fixed_maintenance_krw>b.limit_krw)) AND ${financialClaim}`,
            [
              now,
              amountOverflow || (charged !== null && charged > row.reserved_krw) ? 1 : 0,
              claimId,
            ],
          ),
          financialFinish(core, claimId),
        ]);
      });
    },
    exposure(now: string) {
      return safe(async () => {
        now = parse(iso, now);
        const month = usageDateKst(now).slice(0, 7);
        return core
          .statement(
            `SELECT b.*,c.phase,c.revision AS control_revision,(${carryoverSql}) AS carryover_krw FROM v2_monthly_budget b LEFT JOIN v2_runtime_controls c ON c.month=b.month WHERE b.month=? AND b.environment=?`,
            [month, month, month, environment],
          )
          .first<{
            month: string;
            allocation_version: number;
            limit_krw: number;
            settled_krw: number;
            reserved_krw: number;
            ambiguous_krw: number;
            fixed_maintenance_krw: number;
            phase: string;
            control_revision: number;
            carryover_krw: number;
          }>();
      });
    },
    // Startup creates a frozen control. It never treats old string ack IDs as
    // authenticated coordination or activates global allocations by itself.
    initializeControl(month: string, now: string) {
      return safe(async () => {
        parse(monthSchema, month);
        now = parse(iso, now);
        return (
          (
            await core
              .statement(
                "INSERT INTO v2_runtime_controls(month,environment,pending_version,updated_at) SELECT month,environment,allocation_version,? FROM v2_monthly_budget WHERE month=? AND environment=? ON CONFLICT(month) DO NOTHING",
                [now, month, environment],
              )
              .run()
          ).meta.changes === 1
        );
      });
    },
    freeze(month: string, expectedRevision: number, nextVersion: number, now: string) {
      return safe(async () => {
        parse(monthSchema, month);
        now = parse(iso, now);
        parse(z.number().int().positive(), expectedRevision);
        parse(z.number().int().positive(), nextVersion);
        return (
          (
            await core
              .statement(
                "UPDATE v2_runtime_controls SET phase='frozen',pending_version=?,local_drain_id=NULL,revision=revision+1,updated_at=? WHERE month=? AND environment=? AND revision=? AND phase IN ('active','frozen') AND EXISTS(SELECT 1 FROM v2_monthly_budget b WHERE b.month=v2_runtime_controls.month AND b.allocation_version<=?)",
                [nextVersion, now, month, environment, expectedRevision, nextVersion],
              )
              .run()
          ).meta.changes === 1
        );
      });
    },
    // Separate local freeze/decrease/drain acknowledgement, then authenticated
    // remote evidence; activation across two D1s is not a single atomic action.
    drain(month: string, expectedRevision: number, allocationProofId: string, now: string) {
      return safe(async () => {
        parse(monthSchema, month);
        now = parse(iso, now);
        parse(z.number().int().positive(), expectedRevision);
        const a = await proof(allocationProofId, "allocation", allocationProofSchema, now);
        if (!a || a.value.environment !== environment || a.value.allocation.month !== month)
          return null;
        const budget = await core
          .statement(
            `SELECT b.*,(${carryoverSql}) AS carryover FROM v2_monthly_budget b WHERE b.month=? AND b.environment=?`,
            [month, month, month, environment],
          )
          .first<{
            settled_krw: number;
            reserved_krw: number;
            ambiguous_krw: number;
            fixed_maintenance_krw: number;
            carryover: number;
          }>();
        if (budget?.reserved_krw !== 0 || budget.ambiguous_krw !== 0) return null;
        const allocation = a.value.allocation;
        const amount = environment === "preview" ? allocation.previewKrw : allocation.productionKrw;
        if (budget.settled_krw + budget.fixed_maintenance_krw + budget.carryover > amount)
          return null;
        const id = crypto.randomUUID();
        const value: DrainProof = {
          id,
          environment,
          month,
          version: allocation.version,
          controlRevision: expectedRevision + 1,
          manifestHash: allocation.manifestHash,
          settledKrw: budget.settled_krw,
          fixedKrw: budget.fixed_maintenance_krw,
          carryoverKrw: budget.carryover,
          reservedKrw: 0,
          ambiguousKrw: 0,
          limitKrw: amount,
          observedAt: now,
          validUntil: new Date(
            Math.min(Date.parse(allocation.validUntil), Date.parse(now) + 300000),
          ).toISOString(),
        };
        const digest = await runtimeDigest(value),
          claimId = crypto.randomUUID();
        const ok = await core.changed([
          core.statement(
            `INSERT INTO v2_runtime_claims(id,owner_id,target_id,revision) SELECT ?,?,c.month,c.revision FROM v2_runtime_controls c JOIN v2_monthly_budget b ON b.month=c.month WHERE c.month=? AND c.environment=? AND c.revision=? AND c.phase='frozen' AND c.pending_version=? AND b.reserved_krw=0 AND b.ambiguous_krw=0 AND b.settled_krw=? AND b.fixed_maintenance_krw=? AND (${carryoverSql})=?`,
            [
              claimId,
              environment,
              month,
              environment,
              expectedRevision,
              allocation.version,
              budget.settled_krw,
              budget.fixed_maintenance_krw,
              month,
              month,
              budget.carryover,
            ],
          ),
          core.statement(
            `INSERT INTO v2_runtime_drains(id,month,environment,version,control_revision,manifest_hash,settled_krw,fixed_krw,carryover_krw,digest,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${financialClaim}`,
            [
              id,
              month,
              environment,
              allocation.version,
              value.controlRevision,
              value.manifestHash,
              value.settledKrw,
              value.fixedKrw,
              value.carryoverKrw,
              digest,
              now,
              claimId,
            ],
          ),
          core.statement(
            `UPDATE v2_monthly_budget SET limit_krw=min(limit_krw,?) WHERE month=? AND ${financialClaim}`,
            [amount, month, claimId],
          ),
          core.statement(
            `UPDATE v2_runtime_controls SET phase='drained',local_drain_id=?,allocation_proof_id=?,revision=revision+1,updated_at=? WHERE month=? AND ${financialClaim}`,
            [id, allocationProofId, now, month, claimId],
          ),
          financialFinish(core, claimId),
        ]);
        return ok ? value : null;
      });
    },
    activate(
      month: string,
      expectedRevision: number,
      allocationProofId: string,
      localProofId: string,
      remoteProofId: string,
      now: string,
    ) {
      return safe(async () => {
        parse(monthSchema, month);
        now = parse(iso, now);
        parse(z.number().int().positive(), expectedRevision);
        const a = await proof(allocationProofId, "allocation", allocationProofSchema, now);
        const local = await proof(localProofId, "drain", drainProofSchema, now),
          remote = await proof(remoteProofId, "drain", drainProofSchema, now);
        if (
          !a ||
          !local ||
          !remote ||
          a.value.environment !== environment ||
          local.value.environment !== environment ||
          remote.value.environment === environment
        )
          return false;
        const allocation = a.value.allocation;
        if (
          allocation.month !== month ||
          [local.value, remote.value].some(
            (p) =>
              p.month !== month ||
              p.version !== allocation.version ||
              p.manifestHash !== allocation.manifestHash ||
              p.limitKrw !==
                (p.environment === "preview" ? allocation.previewKrw : allocation.productionKrw) ||
              p.settledKrw + p.fixedKrw + p.carryoverKrw > p.limitKrw,
          )
        )
          return false;
        const claimId = crypto.randomUUID(),
          amount = environment === "preview" ? allocation.previewKrw : allocation.productionKrw;
        return core.changed([
          core.statement(
            `INSERT INTO v2_runtime_claims(id,owner_id,target_id,revision) SELECT ?,?,c.month,c.revision FROM v2_runtime_controls c JOIN v2_monthly_budget b ON b.month=c.month JOIN v2_runtime_drains d ON d.id=c.local_drain_id JOIN v2_budget_allocations a ON a.month=b.month AND a.version=? WHERE c.month=? AND c.environment=? AND c.phase='drained' AND c.revision=? AND c.pending_version=? AND c.allocation_proof_id=? AND d.id=? AND d.digest=? AND d.control_revision=c.revision AND b.reserved_krw=0 AND b.ambiguous_krw=0 AND b.settled_krw=? AND b.fixed_maintenance_krw=? AND (${carryoverSql})=? AND a.manifest_hash=? AND a.preview_krw=? AND a.production_krw=? AND a.shared_fixed_krw=? AND a.maintenance_reserve_krw=? AND a.reviewed_at<=? AND a.valid_until>? AND a.funding_valid_until>? AND a.funding_state IN ('funded','trial_credit') AND EXISTS(SELECT 1 FROM v2_runtime_proofs WHERE id=? AND digest=? AND valid_until>?) AND EXISTS(SELECT 1 FROM v2_runtime_proofs WHERE id=? AND digest=? AND valid_until>?)`,
            [
              claimId,
              environment,
              allocation.version,
              month,
              environment,
              expectedRevision,
              allocation.version,
              allocationProofId,
              local.value.id,
              local.row.digest,
              local.value.settledKrw,
              local.value.fixedKrw,
              month,
              month,
              local.value.carryoverKrw,
              allocation.manifestHash,
              allocation.previewKrw,
              allocation.productionKrw,
              allocation.sharedFixedKrw,
              allocation.maintenanceReserveKrw,
              now,
              now,
              now,
              localProofId,
              local.row.digest,
              now,
              remoteProofId,
              remote.row.digest,
              now,
            ],
          ),
          core.statement(
            `UPDATE v2_monthly_budget SET allocation_version=?,limit_krw=? WHERE month=? AND ${financialClaim}`,
            [allocation.version, amount, month, claimId],
          ),
          core.statement(
            `UPDATE v2_runtime_controls SET phase='active',pending_version=NULL,revision=revision+1,updated_at=? WHERE month=? AND ${financialClaim}`,
            [now, month, claimId],
          ),
          financialFinish(core, claimId),
        ]);
      });
    },
    recordMaintenance(
      input: {
        id: string;
        month: string;
        referenceHash: string;
        amountKrw: number;
        state: "reserved" | "ambiguous" | "settled";
      },
      now: string,
    ) {
      return safe(async () => {
        now = parse(iso, now);
        const p = parse(
          z.strictObject({
            id: opaqueIdSchema,
            month: monthSchema,
            referenceHash: hashSchema,
            amountKrw: safeAmount,
            state: z.enum(["reserved", "ambiguous", "settled"]),
          }),
          input,
        );
        if (!verify) return false;
        const payload = { environment, action: "record", input: p, observedAt: now },
          digest = await runtimeDigest(payload);
        const evidence = await verify("maintenance", payload, digest);
        if (!evidence) return false;
        const e = parse(verifiedEvidenceSchema, evidence);
        if (
          e.digest !== digest ||
          !["provider_receipt", "authenticated_console"].includes(e.method) ||
          Date.parse(e.verifiedAt) > Date.parse(now)
        )
          return false;
        const claimId = crypto.randomUUID();
        return core.changed([
          core.statement(
            "INSERT INTO v2_runtime_claims(id,owner_id,target_id,revision) SELECT ?,?,b.month,1 FROM v2_monthly_budget b WHERE b.month=? AND b.environment=? AND NOT EXISTS(SELECT 1 FROM v2_maintenance_exposure WHERE id=? OR (month=? AND reference_hash=?))",
            [claimId, environment, p.month, environment, p.id, p.month, p.referenceHash],
          ),
          core.statement(
            `INSERT INTO v2_maintenance_exposure(id,month,reference_hash,amount_krw,state,created_at) SELECT ?,?,?,?,?,? WHERE ${financialClaim}`,
            [p.id, p.month, p.referenceHash, p.amountKrw, p.state, now, claimId],
          ),
          core.statement(
            `INSERT INTO v2_maintenance_evidence(id,maintenance_id,action,digest,payload_json,evidence_hash,verified_at) SELECT ?,?,'record',?,?,?,? WHERE ${financialClaim}`,
            [
              crypto.randomUUID(),
              p.id,
              digest,
              JSON.stringify(payload),
              e.evidenceHash,
              e.verifiedAt,
              claimId,
            ],
          ),
          core.statement(
            `UPDATE v2_monthly_budget SET fixed_maintenance_krw=fixed_maintenance_krw+? WHERE month=? AND ${financialClaim}`,
            [p.amountKrw, p.month, claimId],
          ),
          core.statement(
            `UPDATE v2_runtime_controls SET phase='frozen',local_drain_id=NULL,revision=revision+1,updated_at=? WHERE ${financialClaim}`,
            [now, claimId],
          ),
          financialFinish(core, claimId),
        ]);
      });
    },
    settleMaintenance(
      id: string,
      expectedState: "reserved" | "ambiguous",
      chargedKrw: number,
      now: string,
    ) {
      return safe(async () => {
        parse(opaqueIdSchema, id);
        parse(z.enum(["reserved", "ambiguous"]), expectedState);
        parse(safeAmount, chargedKrw);
        now = parse(iso, now);
        if (!verify) return false;
        const old = await core
          .statement(
            "SELECT m.* FROM v2_maintenance_exposure m JOIN v2_monthly_budget b ON b.month=m.month WHERE m.id=? AND m.state=? AND b.environment=?",
            [id, expectedState, environment],
          )
          .first<{
            id: string;
            month: string;
            amount_krw: number;
            reference_hash: string;
            state: string;
          }>();
        if (!old) return false;
        const payload = {
            environment,
            action: "settle",
            id,
            expectedState,
            chargedKrw,
            originalAmountKrw: old.amount_krw,
            referenceHash: old.reference_hash,
            observedAt: now,
          },
          digest = await runtimeDigest(payload);
        const evidence = await verify("maintenance", payload, digest);
        if (!evidence) return false;
        const e = parse(verifiedEvidenceSchema, evidence);
        if (
          e.digest !== digest ||
          !["provider_receipt", "authenticated_console"].includes(e.method) ||
          Date.parse(e.verifiedAt) > Date.parse(now)
        )
          return false;
        const claimId = crypto.randomUUID();
        return core.changed([
          core.statement(
            "INSERT INTO v2_runtime_claims(id,owner_id,target_id,revision) SELECT ?,?,id,amount_krw FROM v2_maintenance_exposure WHERE id=? AND state=? AND amount_krw=? AND reference_hash=?",
            [claimId, environment, id, expectedState, old.amount_krw, old.reference_hash],
          ),
          core.statement(
            `INSERT INTO v2_maintenance_evidence(id,maintenance_id,action,digest,payload_json,evidence_hash,verified_at) SELECT ?,?,'settle',?,?,?,? WHERE ${financialClaim}`,
            [
              crypto.randomUUID(),
              id,
              digest,
              JSON.stringify(payload),
              e.evidenceHash,
              e.verifiedAt,
              claimId,
            ],
          ),
          core.statement(
            `UPDATE v2_monthly_budget SET fixed_maintenance_krw=fixed_maintenance_krw+(?- (SELECT amount_krw FROM v2_maintenance_exposure WHERE id=?)) WHERE month=(SELECT month FROM v2_maintenance_exposure WHERE id=?) AND environment=? AND ${financialClaim}`,
            [chargedKrw, id, id, environment, claimId],
          ),
          core.statement(
            `UPDATE v2_maintenance_exposure SET state='settled',amount_krw=? WHERE id=? AND ${financialClaim}`,
            [chargedKrw, id, claimId],
          ),
          core.statement(
            `UPDATE v2_runtime_controls SET phase='frozen',local_drain_id=NULL,revision=revision+1,updated_at=? WHERE ${financialClaim}`,
            [now, claimId],
          ),
          financialFinish(core, claimId),
        ]);
      });
    },
  };
}
