import { opaqueIdSchema, timestampSchema } from "../../../contracts";
import { type V2CostQuote, v2CostQuoteSchema } from "../../../contracts/v2";
import { estimatePlanKrw, receiptKrw } from "../../db/v2-paid-contracts";
import { runtimeDigest } from "../../db/v2-paid-runtime";
import {
  type ExecutionPlan,
  executionPlanSchema,
  type FundingProof,
  fundingProofSchema,
  type PricingProof,
  pricingProofSchema,
  type UsageReceipt,
  usageReceiptSchema,
} from "./contracts";

export class BudgetError extends Error {
  constructor(readonly code: "BUDGET_UNAVAILABLE" | "INVALID_RECEIPT") {
    super(code);
  }
}
export type VerifiedQuote = {
  quote: V2CostQuote;
  pricing: PricingProof;
  funding: FundingProof;
  plan: ExecutionPlan;
  proofHash: string;
  maximumInvocationKrw: number;
};
const fresh = (start: string, end: string, now: string) =>
  Date.parse(start) <= Date.parse(now) && Date.parse(now) < Date.parse(end);
function assertFresh(
  pricing: PricingProof,
  funding: FundingProof,
  now: string,
  environment: "preview" | "production",
) {
  if (
    pricing.environment !== environment ||
    funding.environment !== environment ||
    !fresh(pricing.checkedAt, pricing.validUntil, now) ||
    !fresh(pricing.fx.checkedAt, pricing.fx.validUntil, now) ||
    Date.parse(pricing.fx.asOf) > Date.parse(now) ||
    !fresh(funding.observedAt, funding.validUntil, now) ||
    funding.state === "unavailable" ||
    funding.spendAllowanceKrw <= 0 ||
    pricing.prices.some((price) => !fresh(price.checkedAt, price.validUntil, now))
  )
    throw new BudgetError("BUDGET_UNAVAILABLE");
}

/** Trusted dependency inputs only: no HTTP body is a source of price, FX, funding or clock. */
export async function calculateQuote(input: {
  environment: "preview" | "production";
  now: string;
  pricing: unknown;
  funding: unknown;
  plan: unknown;
}): Promise<VerifiedQuote> {
  try {
    const now = new Date(timestampSchema.parse(input.now)).toISOString();
    const pricing = pricingProofSchema.parse(input.pricing);
    const funding = fundingProofSchema.parse(input.funding);
    const plan = executionPlanSchema.parse(input.plan);
    assertFresh(pricing, funding, now, input.environment);
    if (
      Date.parse(plan.deadlineAt) <= Date.parse(now) ||
      Date.parse(plan.deadlineAt) - Date.parse(now) > 3600000 ||
      [pricing, pricing.fx, funding, ...pricing.prices].some(
        (proof) => Date.parse(proof.validUntil) < Date.parse(plan.deadlineAt),
      ) ||
      plan.quantities.some(
        (item) => pricing.prices.find((price) => price.sku === item.sku)?.billingMode !== "metered",
      )
    )
      throw new BudgetError("BUDGET_UNAVAILABLE");
    const estimatedKrw = estimatePlanKrw(pricing, plan.quantities);
    const maximumInvocationKrw = estimatedKrw * plan.maximumAttempts;
    if (
      !Number.isSafeInteger(maximumInvocationKrw) ||
      maximumInvocationKrw > 1_000_000 ||
      maximumInvocationKrw > funding.spendAllowanceKrw
    )
      throw new BudgetError("BUDGET_UNAVAILABLE");
    const expires = Math.min(
      ...[
        pricing.validUntil,
        pricing.fx.validUntil,
        funding.validUntil,
        plan.deadlineAt,
        ...pricing.prices.map((price) => price.validUntil),
      ].map(Date.parse),
    );
    const proofHash = await runtimeDigest({ pricing, funding, plan });
    const quote = v2CostQuoteSchema.parse({
      id: crypto.randomUUID(),
      version: pricing.version,
      reviewedAt: now,
      validUntil: new Date(expires).toISOString(),
      currency: "KRW",
      providerPricingVersion: pricing.id,
      exchangeRateKrwPerUsd: Number(pricing.fx.krwPerUsd),
      safetyMarginRatio: Number(pricing.safetyMarginRatio),
      estimatedKrw,
    });
    return { quote, pricing, funding, plan, proofHash, maximumInvocationKrw };
  } catch (error) {
    if (error instanceof BudgetError) throw error;
    throw new BudgetError("BUDGET_UNAVAILABLE");
  }
}

/** No fresh-price lookup here: late/deletion receipts use their original immutable proof. */
export function assessReceipt(hold: VerifiedQuote, attemptId: string, input: unknown) {
  try {
    const receipt = usageReceiptSchema.parse(input);
    opaqueIdSchema.parse(attemptId);
    if (receipt.attemptId !== attemptId || receipt.invocationId !== hold.plan.invocationId)
      throw new BudgetError("INVALID_RECEIPT");
    if (receipt.definitiveNoCharge)
      return { receipt, outcome: "release_candidate" as const, chargedKrw: null };
    // Transport errors can still incur charges. Missing usage is never interpreted as zero.
    if (
      receipt.chargedUsd === null &&
      (receipt.transport !== "response" ||
        !receipt.meteringComplete ||
        receipt.quantities.length === 0)
    )
      return { receipt, outcome: "ambiguous" as const, chargedKrw: null };
    if (
      receipt.quantities.some(
        (item) => !hold.plan.quantities.some((bound) => bound.sku === item.sku),
      )
    )
      throw new BudgetError("INVALID_RECEIPT");
    if (
      receipt.chargedUsd === null &&
      (receipt.quantities.length !== hold.plan.quantities.length ||
        hold.plan.quantities.some(
          (bound) => !receipt.quantities.some((item) => item.sku === bound.sku),
        ))
    )
      return { receipt, outcome: "ambiguous" as const, chargedKrw: null };
    const chargedKrw = receiptKrw(hold.pricing, receipt);
    if (chargedKrw === null) return { receipt, outcome: "ambiguous" as const, chargedKrw: null };
    return { receipt, outcome: "settled" as const, chargedKrw };
  } catch (error) {
    if (error instanceof BudgetError) throw error;
    throw new BudgetError("INVALID_RECEIPT");
  }
}

export type LocalBudget = {
  month: string;
  environment: string | null;
  allocationVersion: number | null;
  allocatedLimitKrw: number;
  settledKrw: number;
  reservedKrw: number;
  ambiguousKrw: number;
  fixedAndMaintenanceKrw: number;
  availableKrw: number;
};
export function budgetState(
  ledger: LocalBudget,
  expected: { environment: "preview" | "production"; month: string },
) {
  const amounts = [
    ledger.allocatedLimitKrw,
    ledger.settledKrw,
    ledger.reservedKrw,
    ledger.ambiguousKrw,
    ledger.fixedAndMaintenanceKrw,
    ledger.availableKrw,
  ];
  const exposure =
    ledger.settledKrw + ledger.reservedKrw + ledger.ambiguousKrw + ledger.fixedAndMaintenanceKrw;
  if (
    amounts.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    !Number.isSafeInteger(exposure) ||
    ledger.allocatedLimitKrw > 1_000_000 ||
    ledger.allocationVersion === null ||
    !Number.isSafeInteger(ledger.allocationVersion) ||
    ledger.allocationVersion <= 0 ||
    ledger.environment !== expected.environment ||
    ledger.month !== expected.month ||
    ledger.availableKrw !== Math.max(0, ledger.allocatedLimitKrw - exposure)
  )
    return { state: "unavailable" as const, availableKrw: 0 };
  const ratio = ledger.allocatedLimitKrw === 0 ? 1 : exposure / ledger.allocatedLimitKrw;
  const state =
    ratio >= 1
      ? "closed"
      : ratio >= 0.9
        ? "stop_high_cost"
        : ratio >= 0.85
          ? "restricted"
          : ratio >= 0.7
            ? "warning"
            : "available";
  return { state, availableKrw: ledger.availableKrw };
}

export function createBudgetService(options: {
  environment: "preview" | "production";
  clock?: () => string;
  // Registry and persistence are server-owned adapters; missing proof means unavailable.
  proofs: (now: string) => Promise<{ pricing: unknown; funding: unknown } | null>;
  persistQuote: (quote: VerifiedQuote) => Promise<boolean>;
  recordUsage: (hold: VerifiedQuote, result: ReturnType<typeof assessReceipt>) => Promise<boolean>;
}) {
  return {
    async quote(plan: ExecutionPlan) {
      const now = timestampSchema.parse((options.clock ?? (() => new Date().toISOString()))());
      const proofs = await options.proofs(now);
      if (!proofs) throw new BudgetError("BUDGET_UNAVAILABLE");
      const quote = await calculateQuote({
        environment: options.environment,
        now,
        ...proofs,
        plan,
      });
      if (!(await options.persistQuote(quote))) throw new BudgetError("BUDGET_UNAVAILABLE");
      return quote;
    },
    async receipt(hold: VerifiedQuote, attemptId: string, receipt: UsageReceipt) {
      const result = assessReceipt(hold, attemptId, receipt);
      if (!(await options.recordUsage(hold, result))) throw new BudgetError("BUDGET_UNAVAILABLE");
      return result;
    },
  };
}
