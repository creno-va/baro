import { z } from "zod";

// Workers and the browser hash CSP prohibit eval. Configure before constructing schemas:
// even Zod's caught capability probe otherwise emits a browser CSP violation.
z.config({ jitless: true });

export const CONTRACT_VERSION = "1" as const;
export const MAX_REQUEST_BYTES = 64 * 1024;
export const schemaVersionSchema = z.literal(CONTRACT_VERSION);

/** Trim first; JavaScript UTF-16 length is not the contract's code-point count. */
export const boundedText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .refine((value) => {
      const length = [...value].length;
      return length >= min && length <= max;
    }, `Expected ${min}–${max} Unicode code points`);

// Results are rendered as text; markup is rejected at the shared boundary as well.
export const displayText = (max: number) =>
  boundedText(1, max).refine((value) => !/<\/?[a-z!][^>]*>/i.test(value), "HTML is not allowed");
export const uuidSchema = z.uuidv4();
export const opaqueIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
export const dateSchema = z.iso.date();
export const timestampSchema = z.iso.datetime({ offset: false });
export const revisionSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
export const hasUniqueIds = (items: readonly { id: string }[]) =>
  new Set(items.map(({ id }) => id)).size === items.length;
export const citationIdsSchema = z
  .array(opaqueIdSchema)
  .max(20)
  .refine((ids) => new Set(ids).size === ids.length, "Duplicate citation IDs");

export const caseStatusSchema = z.enum([
  "screening",
  "needs_clarification",
  "queued",
  "analyzing",
  "completed",
  "out_of_scope",
  "urgent_redirect",
  "failed",
]);
export const analysisStatusSchema = z.enum([
  "queued",
  "screening",
  "waiting_for_answers",
  "retrieving",
  "generating",
  "validating",
  "completed",
  "failed",
  "superseded",
]);
export const failureCodeSchema = z.enum([
  "CLARIFICATION_EXPIRED",
  "DISPATCH_FAILED",
  "MODEL_UNAVAILABLE",
  "MODEL_SCHEMA_INVALID",
  "LEGAL_SOURCE_UNAVAILABLE",
  "CITATION_INVALID",
  "POLICY_REJECTED",
  "ANALYSIS_TIMEOUT",
  "CRYPTO_DECRYPT_FAILED",
  "INTERNAL_ERROR",
]);
export const errorCodeSchema = z.enum([
  ...failureCodeSchema.options,
  "UNAUTHENTICATED",
  "ORIGIN_NOT_ALLOWED",
  "INVALID_CONSENT",
  "CONSENT_REQUIRED",
  "AGE_RESTRICTED",
  "NOT_FOUND",
  "CASE_NOT_FOUND",
  "BETA_NOT_OPEN",
  "BODY_TOO_LARGE",
  "VALIDATION_ERROR",
  "INVALID_STATE",
  "REVISION_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "RATE_LIMITED",
  "QUOTA_EXCEEDED",
  "TURNSTILE_FAILED",
  "REAUTHENTICATION_REQUIRED",
]);
// Never accept arbitrary records: external bodies, stack traces and SQL are not details.
export const errorSchema = z.strictObject({
  code: errorCodeSchema,
  message: displayText(500),
  requestId: opaqueIdSchema,
  retryable: z.boolean(),
  details: z.strictObject({
    fields: z
      .array(
        z.strictObject({
          field: z.enum([
            "narrative",
            "turnstileToken",
            "inputRevision",
            "answers",
            "cursor",
            "limit",
          ]),
          code: z.enum(["required", "invalid", "too_short", "too_long", "duplicate"]),
        }),
      )
      .max(10)
      .optional(),
  }),
});
export const errorResponseSchema = z.strictObject({ error: errorSchema });
export type CaseStatus = z.infer<typeof caseStatusSchema>;
export type AnalysisStatus = z.infer<typeof analysisStatusSchema>;
export type FailureCode = z.infer<typeof failureCodeSchema>;
export type ApiError = z.infer<typeof errorSchema>;
