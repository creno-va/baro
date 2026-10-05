import { z } from "zod";
import {
  dateSchema,
  displayText,
  opaqueIdSchema,
  revisionSchema,
  timestampSchema,
} from "../common";
import { V2_LIMITS, v2CountSchema, v2VersionSchema, v2WaitReasonSchema } from "./common";

const observedKrw = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const reservedKrw = observedKrw.max(V2_LIMITS.monthlyBudgetKrw);

function counter(limit: number, integral = true) {
  const quantity = integral ? v2CountSchema : z.number().min(0).max(Number.MAX_SAFE_INTEGER);
  return z
    .strictObject({
      limit: z.literal(limit),
      used: quantity,
      reserved: quantity,
      remaining: quantity,
    })
    .refine(
      (value) =>
        (integral
          ? Number.isSafeInteger(value.used + value.reserved)
          : Number.isFinite(value.used + value.reserved)) &&
        (integral
          ? value.remaining === Math.max(0, value.limit - value.used - value.reserved)
          : Math.abs(value.remaining - Math.max(0, value.limit - value.used - value.reserved)) <
            1e-9),
      "Counter must include pending reservations",
    );
}
export const v2UsageSchema = z
  .strictObject({
    schemaVersion: v2VersionSchema,
    day: dateSchema,
    timezone: z.literal("Asia/Seoul"),
    resetAt: timestampSchema,
    newCases: counter(V2_LIMITS.dailyCases),
    aiResponses: counter(V2_LIMITS.dailyAiResponses),
    mediaSeconds: counter(V2_LIMITS.dailyMediaSeconds, false),
    storageBytes: counter(V2_LIMITS.accountStorageBytes),
    waitReasons: z
      .array(v2WaitReasonSchema)
      .max(7)
      .refine((reasons) => new Set(reasons).size === reasons.length, "Duplicate wait reasons"),
  })
  .refine(
    (usage) => Date.parse(usage.resetAt) === Date.parse(`${usage.day}T15:00:00Z`),
    "KST next midnight is 15:00 UTC on the usage day",
  );
export const v2CaseOriginalUsageSchema = z.strictObject({
  count: counter(V2_LIMITS.originalCount),
  originalBytes: counter(V2_LIMITS.caseOriginalBytes),
});
export const v2OperationQuotaSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("new_case"), units: z.literal(1) }),
  z.strictObject({
    kind: z.literal("visible_ai_response"),
    units: z.literal(1),
    responseKind: z.enum(["question_batch", "summary", "chat", "file_interpretation"]),
  }),
  z.strictObject({
    kind: z.literal("media_processing"),
    originalDurationSeconds: z.number().positive().max(3600),
  }),
  z.strictObject({
    kind: z.literal("no_user_quota"),
    reason: z.enum(["text_extraction", "export_build", "read", "delete"]),
  }),
]);
export const v2QuotaReservationSchema = z.strictObject({
  id: opaqueIdSchema,
  operationId: opaqueIdSchema,
  day: dateSchema,
  quota: v2OperationQuotaSchema,
  state: z.enum(["reserved", "consumed", "released"]),
  createdAt: timestampSchema,
});
/** Initial operation admission only. A retry reuses its durable logical reservation. */
export function v2UserQuotaAdmissionSchema(usage: unknown) {
  const snapshot = v2UsageSchema.parse(usage);
  return v2OperationQuotaSchema.refine((operation) => {
    if (operation.kind === "new_case") return snapshot.newCases.remaining >= operation.units;
    if (operation.kind === "visible_ai_response")
      return snapshot.aiResponses.remaining >= operation.units;
    if (operation.kind === "media_processing")
      return snapshot.mediaSeconds.remaining >= operation.originalDurationSeconds;
    return true;
  }, "User quota has insufficient remaining capacity");
}
export const v2StorageReservationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    id: opaqueIdSchema,
    kind: z.literal("case_original"),
    caseId: opaqueIdSchema,
    fileId: opaqueIdSchema,
    byteLength: z.number().int().positive().max(V2_LIMITS.mediaBytes),
    state: z.enum(["reserved", "stored", "released"]),
  }),
  z.strictObject({
    id: opaqueIdSchema,
    kind: z.literal("derived_or_report"),
    caseId: opaqueIdSchema,
    operationId: opaqueIdSchema,
    byteLength: z.number().int().positive().max(V2_LIMITS.accountStorageBytes),
    state: z.enum(["reserved", "stored", "released"]),
  }),
  z.strictObject({
    id: opaqueIdSchema,
    kind: z.literal("lawyer_asset"),
    profileId: opaqueIdSchema,
    assetId: opaqueIdSchema,
    byteLength: z.number().int().positive().max(V2_LIMITS.documentImageBytes),
    state: z.enum(["reserved", "stored", "released"]),
  }),
]);
/** Caller supplies the authenticated account and authorized case snapshots; runtime reserves atomically. */
export function v2StorageAdmissionSchema(
  usage: unknown,
  caseSnapshot?: { caseId: string; usage: unknown },
) {
  const account = v2UsageSchema.parse(usage);
  const caseUsage =
    caseSnapshot === undefined ? undefined : v2CaseOriginalUsageSchema.parse(caseSnapshot.usage);
  return v2StorageReservationSchema.refine((reservation) => {
    if (reservation.byteLength > account.storageBytes.remaining) return false;
    if (reservation.kind !== "case_original") return true;
    return (
      caseSnapshot !== undefined &&
      caseUsage !== undefined &&
      reservation.caseId === caseSnapshot.caseId &&
      caseUsage.count.remaining >= 1 &&
      reservation.byteLength <= caseUsage.originalBytes.remaining
    );
  }, "Insufficient account storage, case originals capacity or wrong case snapshot");
}
export const v2CostQuoteSchema = z
  .strictObject({
    id: opaqueIdSchema,
    version: revisionSchema,
    reviewedAt: timestampSchema,
    validUntil: timestampSchema,
    currency: z.literal("KRW"),
    providerPricingVersion: displayText(200),
    exchangeRateKrwPerUsd: z.number().positive().max(100_000),
    safetyMarginRatio: z.number().min(0).max(10),
    estimatedKrw: reservedKrw,
  })
  .refine(
    (quote) => Date.parse(quote.validUntil) > Date.parse(quote.reviewedAt),
    "Quote must have a future expiration",
  );
export const v2CostAttemptSchema = z
  .strictObject({
    id: opaqueIdSchema,
    operationId: opaqueIdSchema,
    // Retry ordinal is per invocation, not per visible response or entire media job.
    attempt: z.number().int().min(1).max(10),
    invocationId: opaqueIdSchema,
    quoteId: opaqueIdSchema,
    service: z.enum(["model", "asr", "container", "storage", "requests", "fixed_operation"]),
    state: z.enum(["reserved", "settled", "ambiguous", "released"]),
    reservedKrw,
    chargedKrw: observedKrw.nullable(),
    createdAt: timestampSchema,
  })
  .refine(
    (attempt) => (attempt.state === "settled") === (attempt.chargedKrw !== null),
    "Ambiguous attempts retain the reservation and do not claim zero cost",
  );
export const v2BudgetLedgerSchema = z
  .strictObject({
    schemaVersion: v2VersionSchema,
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    timezone: z.literal("Asia/Seoul"),
    limitKrw: z.literal(V2_LIMITS.monthlyBudgetKrw),
    settledKrw: observedKrw,
    reservedKrw: observedKrw,
    ambiguousKrw: observedKrw,
    fixedAndMaintenanceKrw: observedKrw,
    availableKrw: reservedKrw,
  })
  .refine((ledger) => {
    const committed =
      ledger.settledKrw + ledger.reservedKrw + ledger.ambiguousKrw + ledger.fixedAndMaintenanceKrw;
    return (
      Number.isSafeInteger(committed) &&
      ledger.availableKrw === Math.max(0, ledger.limitKrw - committed)
    );
  }, "Budget availability must include attempts, ambiguity and maintenance");
/** Snapshot decision only; runtime must reserve atomically and recheck before execution. */
export function v2BudgetAdmissionSchema(ledger: unknown, now: string) {
  const snapshot = v2BudgetLedgerSchema.parse(ledger);
  timestampSchema.parse(now);
  return v2CostQuoteSchema.refine(
    (quote) =>
      Date.parse(quote.reviewedAt) <= Date.parse(now) &&
      Date.parse(quote.validUntil) > Date.parse(now) &&
      quote.estimatedKrw <= snapshot.availableKrw,
    "Expired quote or insufficient global budget",
  );
}
export type V2Usage = z.infer<typeof v2UsageSchema>;
export type V2CaseOriginalUsage = z.infer<typeof v2CaseOriginalUsageSchema>;
export type V2OperationQuota = z.infer<typeof v2OperationQuotaSchema>;
export type V2QuotaReservation = z.infer<typeof v2QuotaReservationSchema>;
export type V2StorageReservation = z.infer<typeof v2StorageReservationSchema>;
export type V2CostQuote = z.infer<typeof v2CostQuoteSchema>;
export type V2CostAttempt = z.infer<typeof v2CostAttemptSchema>;
export type V2BudgetLedger = z.infer<typeof v2BudgetLedgerSchema>;
