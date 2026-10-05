import { z } from "zod";
import { opaqueIdSchema, revisionSchema, timestampSchema } from "../../../contracts";
import { v2HashSchema } from "../../../contracts/v2";
import { MODEL_ID } from "../llm-gateway/prompts";

// Decimal strings are never converted to binary floats for money arithmetic.
export const decimalSchema = z.string().regex(/^(0|[1-9]\d{0,17})(\.\d{1,12})?$/);
const positiveDecimal = decimalSchema.refine((value) => /[1-9]/.test(value));
const freshSchema = {
  checkedAt: timestampSchema,
  validUntil: timestampSchema,
};
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
    model: z.enum([MODEL_ID, "@cf/openai/whisper"]).nullable(),
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
    officialUrl,
    ...freshSchema,
  })
  .refine(
    (price) => price.billingMode === "verified_free" || /[1-9]/.test(price.usdPerUnit),
    "Missing price cannot become zero",
  )
  .refine((price) => {
    if (price.sku.startsWith("model_")) return price.model === MODEL_ID;
    if (price.sku === "asr_seconds") return price.model === "@cf/openai/whisper";
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
    fx: z.strictObject({
      krwPerUsd: positiveDecimal,
      authority: z.string().min(1).max(200),
      referenceUrl: z.url().refine((value) => new URL(value).protocol === "https:"),
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
  );
export const fundingProofSchema = z.strictObject({
  id: opaqueIdSchema,
  environment: z.enum(["preview", "production"]),
  state: z.enum(["funded", "trial_credit", "unavailable"]),
  existingPaymentPath: z.literal(true),
  autoRecharge: z.literal(false),
  spendAllowanceKrw: z.number().int().min(0).max(1_000_000),
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
    observedAt: timestampSchema,
    transport: z.enum(["response", "unknown", "not_sent", "provider_error"]),
    definitiveNoCharge: z.boolean(),
    meteringComplete: z.boolean(),
    quantities: z.array(z.strictObject({ sku: costSkuSchema, quantity: decimalSchema })).max(32),
    chargedUsd: decimalSchema.nullable(),
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
