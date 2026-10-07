import { z } from "zod";
import {
  timestampSchema as inputTimestampSchema,
  opaqueIdSchema,
  revisionSchema,
} from "../../contracts";
import { v2HashSchema } from "../../contracts/v2";

// Existing accepted model identifiers, not a provider/model selection mechanism.
const MODEL_ID = "openai/gpt-6-sol";
const timestampSchema = inputTimestampSchema.transform((value) => new Date(value).toISOString());

// Decimal strings are never converted to binary floats for money arithmetic.
export const decimalSchema = z.string().regex(/^(0|[1-9]\d{0,17})(\.\d{1,12})?$/);
const positiveDecimal = decimalSchema.refine((value) => /[1-9]/.test(value));
const freshSchema = {
  checkedAt: timestampSchema,
  validUntil: timestampSchema,
};
const modelRateSchema = z.strictObject({
  contextTier: z.enum(["short", "long"]),
  cacheClass: z.enum(["ordinary", "cached_read", "cache_write", "not_applicable"]),
  usdPerUnit: decimalSchema,
});
export const costSkuSchema = z.enum([
  "model_input_tokens",
  "model_output_tokens",
  "asr_seconds",
  "container_cpu_seconds",
  "container_memory_gib_seconds",
  "container_disk_gb_seconds",
  "r2_storage_gb_months",
  "r2_class_a_requests",
  "r2_class_b_requests",
  "worker_requests",
  "worker_cpu_ms",
  "d1_rows_read",
  "d1_rows_written",
  "d1_storage_gb_months",
  "fixed_operation",
]);
const officialUrl = z.url().refine((url) => {
  const value = new URL(url);
  return (
    value.protocol === "https:" &&
    !value.username &&
    !value.password &&
    !value.search &&
    !value.hash &&
    [
      "developers.cloudflare.com",
      "developers.openai.com",
      "openai.com",
      "platform.openai.com",
    ].includes(value.hostname)
  );
}, "Official pricing reference required");
const priceSchema = z
  .strictObject({
    sku: costSkuSchema,
    provider: z.enum(["cloudflare", "openai"]),
    model: z.enum([MODEL_ID, "@cf/openai/whisper-large-v3-turbo"]).nullable(),
    region: z.string().min(1).max(100),
    plan: z.string().min(1).max(100),
    billingMode: z.enum(["metered", "verified_free"]),
    unit: z.enum([
      "tokens",
      "seconds",
      "vcpu_seconds",
      "gib_seconds",
      "gb_seconds",
      "gb_months",
      "requests",
      "milliseconds",
      "rows",
      "operation",
    ]),
    unitSize: positiveDecimal,
    usdPerUnit: decimalSchema,
    billingQuantum: positiveDecimal,
    // Complete pinned-model rate matrix. Base usdPerUnit is the reservation
    // bound, not evidence of the actual cache/context classification.
    modelRates: z.array(modelRateSchema).max(6).nullable().default(null),
    officialUrl,
    ...freshSchema,
  })
  .refine(
    (price) => price.billingMode === "verified_free" || /[1-9]/.test(price.usdPerUnit),
    "Missing price cannot become zero",
  )
  .refine((price) => {
    if (price.sku.startsWith("model_")) return price.model === MODEL_ID;
    if (price.sku === "asr_seconds") return price.model === "@cf/openai/whisper-large-v3-turbo";
    return price.model === null;
  }, "Only agreed model/ASR identifiers are allowed")
  .refine((price) => {
    const units = {
      model_input_tokens: "tokens",
      model_output_tokens: "tokens",
      asr_seconds: "seconds",
      container_cpu_seconds: "vcpu_seconds",
      container_memory_gib_seconds: "gib_seconds",
      container_disk_gb_seconds: "gb_seconds",
      r2_storage_gb_months: "gb_months",
      r2_class_a_requests: "requests",
      r2_class_b_requests: "requests",
      worker_requests: "requests",
      worker_cpu_ms: "milliseconds",
      d1_rows_read: "rows",
      d1_rows_written: "rows",
      d1_storage_gb_months: "gb_months",
      fixed_operation: "operation",
    } as const;
    return price.unit === units[price.sku];
  }, "SKU and billing unit must match");
export const pricingProofSchema = z
  .strictObject({
    id: opaqueIdSchema,
    version: revisionSchema,
    environment: z.enum(["preview", "production"]),
    prices: z.array(priceSchema).min(1).max(32),
    modelBillingPolicy: z
      .strictObject({
        contextThresholdTokens: z.literal(272000),
        serviceTier: z.literal("default"),
        processingRegion: z.string().min(1).max(100),
        regionMultiplier: positiveDecimal,
      })
      .nullable()
      .default(null),
    fx: z.strictObject({
      krwPerUsd: positiveDecimal,
      authority: z.string().min(1).max(200),
      referenceUrl: z
        .url()
        .max(2048)
        .refine((value) => {
          const url = new URL(value);
          return (
            url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash
          );
        }),
      asOf: timestampSchema,
      ...freshSchema,
    }),
    taxRatio: decimalSchema,
    feeRatio: decimalSchema,
    safetyMarginRatio: decimalSchema,
    hiddenAttemptMultiplier: z.number().int().min(1).max(10),
    hiddenRetryReference: z.string().min(1).max(200),
    ...freshSchema,
  })
  .refine(
    (proof) => new Set(proof.prices.map((price) => price.sku)).size === proof.prices.length,
    "Duplicate SKU",
  )
  .refine(
    (proof) =>
      proof.prices.every((price) => {
        if (!price.sku.startsWith("model_")) return price.modelRates === null;
        if (!proof.modelBillingPolicy || !price.modelRates) return false;
        const classes =
          price.sku === "model_input_tokens"
            ? ["ordinary", "cached_read", "cache_write"]
            : ["not_applicable"];
        const expected = ["short", "long"].flatMap((tier) =>
          classes.map((cache) => `${tier}:${cache}`),
        );
        const actual = price.modelRates.map((rate) => `${rate.contextTier}:${rate.cacheClass}`);
        if (
          actual.length !== expected.length ||
          new Set(actual).size !== actual.length ||
          expected.some((k) => !actual.includes(k))
        )
          return false;
        const bound = decimalFraction(price.usdPerUnit),
          factor = decimalFraction(proof.modelBillingPolicy.regionMultiplier);
        return price.modelRates.every((rate) => {
          const value = decimalFraction(rate.usdPerUnit);
          return bound.n * value.d * factor.d >= value.n * factor.n * bound.d;
        });
      }),
    "Complete model cache/context rate matrix and worst-case reservation bound required",
  );
export const fundingProofSchema = z.strictObject({
  id: opaqueIdSchema,
  environment: z.enum(["preview", "production"]),
  state: z.enum(["funded", "trial_credit", "unavailable"]),
  existingPaymentPath: z.literal(true),
  autoRecharge: z.boolean(),
  spendAllowanceKrw: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  reference: z.string().min(1).max(200),
  observedAt: timestampSchema,
  validUntil: timestampSchema,
});
export const executionPlanSchema = z
  .strictObject({
    operationId: opaqueIdSchema,
    operationRevision: revisionSchema,
    requestHash: v2HashSchema,
    invocationId: opaqueIdSchema,
    maximumAttempts: z.number().int().min(1).max(10),
    deadlineAt: timestampSchema,
    // Per actual transport attempt; the proof multiplier covers hidden provider retries.
    quantities: z
      .array(z.strictObject({ sku: costSkuSchema, maximumQuantity: positiveDecimal }))
      .min(1)
      .max(32),
  })
  .refine(
    (plan) => new Set(plan.quantities.map((item) => item.sku)).size === plan.quantities.length,
    "Duplicate execution SKU",
  );
export const usageReceiptSchema = z
  .strictObject({
    id: opaqueIdSchema,
    attemptId: opaqueIdSchema,
    invocationId: opaqueIdSchema,
    providerRequestId: opaqueIdSchema.nullable(),
    dispatchToken: opaqueIdSchema.nullable(),
    observedAt: timestampSchema,
    transport: z.enum(["response", "unknown", "not_sent", "provider_error"]),
    definitiveNoCharge: z.boolean(),
    meteringComplete: z.boolean(),
    quantities: z.array(z.strictObject({ sku: costSkuSchema, quantity: decimalSchema })).max(32),
    chargedUsd: decimalSchema.nullable(),
    modelTokenDetails: z
      .strictObject({
        cachedInputTokens: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
        cacheWriteInputTokens: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
        serviceTier: z.string().min(1).max(100).nullable(),
      })
      .nullable()
      .default(null),
  })
  .refine(
    (receipt) =>
      new Set(receipt.quantities.map((item) => item.sku)).size === receipt.quantities.length,
    "Duplicate receipt SKU",
  )
  .refine(
    (receipt) =>
      !receipt.definitiveNoCharge ||
      (receipt.transport === "not_sent" &&
        receipt.quantities.length === 0 &&
        receipt.chargedUsd === null),
    "Only definitively unsent transport can release a hold",
  );
export type PricingProof = z.infer<typeof pricingProofSchema>;
export type FundingProof = z.infer<typeof fundingProofSchema>;
export type ExecutionPlan = z.infer<typeof executionPlanSchema>;
export type UsageReceipt = z.infer<typeof usageReceiptSchema>;
export type CostSku = z.infer<typeof costSkuSchema>;

export const verifiedEvidenceSchema = z.strictObject({
  digest: v2HashSchema,
  evidenceHash: v2HashSchema,
  method: z.enum([
    "official_document",
    "authenticated_console",
    "authenticated_coordinator",
    "provider_receipt",
  ]),
  verifiedAt: timestampSchema,
});
export type VerifiedEvidence = z.infer<typeof verifiedEvidenceSchema>;
// This callback belongs to the trusted server composition root. No default verifier,
// boolean 'verified' field, browser receipt or arbitrary id can activate paid work.
export type RuntimeProofVerifier = (
  kind: "pricing" | "funding" | "allocation" | "drain" | "usage" | "execution" | "maintenance",
  payload: unknown,
  digest: string,
) => Promise<VerifiedEvidence | null>;
export const paidHoldRequestSchema = z.strictObject({
  attemptId: opaqueIdSchema,
  quoteId: opaqueIdSchema,
  planId: opaqueIdSchema,
  pricingProofId: opaqueIdSchema,
  fundingProofId: opaqueIdSchema,
  attempt: z.number().int().min(1).max(10),
  service: z.enum(["model", "asr", "container", "storage", "requests", "fixed_operation"]),
  jobId: opaqueIdSchema,
  targetKind: z.enum(["workspace", "file", "report", "profile_asset"]),
  targetId: opaqueIdSchema,
  targetRevision: revisionSchema,
  plan: executionPlanSchema,
});
export type PaidHoldRequest = z.infer<typeof paidHoldRequestSchema>;

type Fraction = { n: bigint; d: bigint };
export function decimalFraction(value: string): Fraction {
  decimalSchema.parse(value);
  const [whole, fraction = ""] = value.split(".");
  return { n: BigInt(`${whole}${fraction}`), d: 10n ** BigInt(fraction.length) };
}
const multiply = (a: Fraction, b: Fraction): Fraction => ({ n: a.n * b.n, d: a.d * b.d });
const add = (a: Fraction, b: Fraction): Fraction => ({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
const ceil = (a: Fraction): bigint => (a.n + a.d - 1n) / a.d;
export function estimatePlanKrw(
  proof: PricingProof,
  quantities: ExecutionPlan["quantities"],
): number {
  let usd: Fraction = { n: 0n, d: 1n };
  for (const quantity of quantities) {
    const price = proof.prices.find((p) => p.sku === quantity.sku);
    if (!price) throw new Error("RUNTIME_PRICE_MISSING");
    const max = decimalFraction(quantity.maximumQuantity);
    const quantum = decimalFraction(price.billingQuantum);
    const rounded = multiply(
      { n: ceil({ n: max.n * quantum.d, d: max.d * quantum.n }), d: 1n },
      quantum,
    );
    const unit = decimalFraction(price.unitSize);
    const rate = decimalFraction(price.usdPerUnit);
    usd = add(usd, { n: rounded.n * rate.n * unit.d, d: rounded.d * rate.d * unit.n });
  }
  return usdToKrw(proof, usd, true);
}
function usdToKrw(proof: PricingProof, usd: Fraction, margin: boolean): number {
  let total = multiply(usd, decimalFraction(proof.fx.krwPerUsd));
  for (const ratio of [
    proof.taxRatio,
    proof.feeRatio,
    ...(margin ? [proof.safetyMarginRatio] : []),
  ])
    total = multiply(total, add({ n: 1n, d: 1n }, decimalFraction(ratio)));
  if (margin) total = multiply(total, { n: BigInt(proof.hiddenAttemptMultiplier), d: 1n });
  const result = ceil(total);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("RUNTIME_AMOUNT_INVALID");
  return Number(result);
}
export function receiptKrw(proof: PricingProof, receipt: UsageReceipt): number | null {
  if (receipt.definitiveNoCharge) return 0;
  if (receipt.chargedUsd !== null)
    return usdToKrw(proof, decimalFraction(receipt.chargedUsd), false);
  if (
    receipt.transport !== "response" ||
    !receipt.meteringComplete ||
    receipt.quantities.length === 0
  )
    return null;
  const modelQuantities = receipt.quantities.filter((q) => q.sku.startsWith("model_"));
  if (modelQuantities.length) {
    const policy = proof.modelBillingPolicy,
      details = receipt.modelTokenDetails;
    if (
      !policy ||
      !details ||
      details.serviceTier !== policy.serviceTier ||
      details.cachedInputTokens === null ||
      details.cacheWriteInputTokens === null
    )
      return null;
    const input = receipt.quantities.find((q) => q.sku === "model_input_tokens"),
      output = receipt.quantities.find((q) => q.sku === "model_output_tokens");
    if (!input || !output) return null;
    const inputCount = decimalFraction(input.quantity),
      outputCount = decimalFraction(output.quantity);
    if (inputCount.n % inputCount.d !== 0n || outputCount.n % outputCount.d !== 0n) return null;
    const totalInput = inputCount.n / inputCount.d,
      cached = BigInt(details.cachedInputTokens),
      written = BigInt(details.cacheWriteInputTokens);
    if (cached + written > totalInput) return null;
    const tier = totalInput > BigInt(policy.contextThresholdTokens) ? "long" : "short";
    let usd: Fraction = { n: 0n, d: 1n };
    for (const [sku, cacheClass, quantity] of [
      ["model_input_tokens", "ordinary", totalInput - cached - written],
      ["model_input_tokens", "cached_read", cached],
      ["model_input_tokens", "cache_write", written],
      ["model_output_tokens", "not_applicable", outputCount.n / outputCount.d],
    ] as const) {
      const price = proof.prices.find((p) => p.sku === sku),
        rate = price?.modelRates?.find(
          (r) => r.contextTier === tier && r.cacheClass === cacheClass,
        );
      if (!price || !rate) return null;
      const unit = decimalFraction(price.unitSize),
        value = decimalFraction(rate.usdPerUnit),
        quantum = decimalFraction(price.billingQuantum);
      const rounded = multiply(
        { n: ceil({ n: quantity * quantum.d, d: quantum.n }), d: 1n },
        quantum,
      );
      usd = add(usd, { n: rounded.n * value.n * unit.d, d: rounded.d * value.d * unit.n });
    }
    usd = multiply(usd, decimalFraction(policy.regionMultiplier));
    for (const q of receipt.quantities.filter((q) => !q.sku.startsWith("model_"))) {
      const price = proof.prices.find((p) => p.sku === q.sku);
      if (!price) return null;
      const value = decimalFraction(q.quantity),
        unit = decimalFraction(price.unitSize),
        rate = decimalFraction(price.usdPerUnit),
        quantum = decimalFraction(price.billingQuantum);
      const rounded = multiply(
        { n: ceil({ n: value.n * quantum.d, d: value.d * quantum.n }), d: 1n },
        quantum,
      );
      usd = add(usd, { n: rounded.n * rate.n * unit.d, d: rounded.d * rate.d * unit.n });
    }
    return usdToKrw(proof, usd, false);
  }
  const charged = { ...proof, safetyMarginRatio: "0", hiddenAttemptMultiplier: 1 };
  return estimatePlanKrw(
    charged,
    receipt.quantities.map((q) => ({ sku: q.sku, maximumQuantity: q.quantity })),
  );
}
