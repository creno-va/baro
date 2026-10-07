import { z } from "zod";
import { displayText, opaqueIdSchema, timestampSchema } from "../common";

export const V2_CONTRACT_VERSION = "2" as const;
/** New intake generation policy; stored legacy batches keep their original limits below. */
export const V2_INTAKE_POLICY = { followupLimit: 2, questionsPerBatch: 1 } as const;
export const V2_LIMITS = {
  jsonBytes: 64 * 1024,
  chunkBytes: 8 * 1024 * 1024,
  originalCount: 100,
  caseOriginalBytes: 5_000_000_000,
  accountStorageBytes: 10_000_000_000,
  documentImageBytes: 100_000_000,
  mediaBytes: 1_000_000_000,
  pdfPages: 500,
  mediaSeconds: 3600,
  dailyCases: 3,
  dailyAiResponses: 200,
  dailyMediaSeconds: 3600,
  maximumAttemptKrw: 1_000_000,
  initialBatches: 3,
  questionsPerBatch: 5,
} as const;
export const v2VersionSchema = z.literal(V2_CONTRACT_VERSION);
export const v2CountSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const v2HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const v2FailureCodeSchema = z.enum([
  "MODEL_UNAVAILABLE",
  "MODEL_SCHEMA_INVALID",
  "LEGAL_SOURCE_UNAVAILABLE",
  "CITATION_INVALID",
  "POLICY_REJECTED",
  "JOB_TIMEOUT",
  "CRYPTO_DECRYPT_FAILED",
  "DISPATCH_FAILED",
  "FILE_REJECTED",
  "FILE_PROCESSING_FAILED",
  "COVERAGE_INCOMPLETE",
  "UPLOAD_EXPIRED",
  "BUDGET_UNAVAILABLE",
  "USER_QUOTA_EXCEEDED",
  "STORAGE_UNAVAILABLE",
  "INTERNAL_ERROR",
]);
export const v2ErrorCodeSchema = z.enum([
  ...v2FailureCodeSchema.options,
  "UNAUTHENTICATED",
  "ORIGIN_NOT_ALLOWED",
  "NOT_FOUND",
  "INVALID_CONSENT",
  "CONSENT_REQUIRED",
  "AGE_RESTRICTED",
  "BETA_NOT_OPEN",
  "BODY_TOO_LARGE",
  "VALIDATION_ERROR",
  "INVALID_STATE",
  "STALE_REVISION",
  "IDEMPOTENCY_CONFLICT",
  "RATE_LIMITED",
  "TURNSTILE_FAILED",
  "REAUTHENTICATION_REQUIRED",
  "UPLOAD_LIMIT",
  "ROLE_REQUIRED",
  "REVIEW_REQUIRED",
]);
export const v2WaitReasonSchema = z.enum([
  "daily_cases",
  "daily_ai_responses",
  "daily_media",
  "case_original_storage",
  "account_storage",
  "monthly_budget",
  "ai_funding",
  "processing_capacity",
]);
export const v2ErrorSchema = z.strictObject({
  code: v2ErrorCodeSchema,
  message: displayText(500),
  requestId: opaqueIdSchema,
  retryable: z.boolean(),
  details: z.strictObject({
    fields: z
      .array(
        z.strictObject({
          field: z.enum([
            "narrative",
            "answers",
            "text",
            "expectedRevision",
            "summaryRevision",
            "selectedFileIds",
            "name",
            "byteLength",
            "mediaType",
            "parts",
            "cursor",
            "limit",
            "profile",
            "decision",
            "editedFields",
            "maskingChoices",
            "consentVersion",
          ]),
          code: z.enum(["required", "invalid", "too_short", "too_long", "duplicate", "stale"]),
        }),
      )
      .max(10)
      .optional(),
    waitReason: v2WaitReasonSchema.optional(),
    resetAt: timestampSchema.optional(),
  }),
});
export const v2RoleSchema = z.enum(["user", "lawyer_applicant", "verified_lawyer", "moderator"]);
// Server output only. No mutation schema accepts roles or capability flags.
export const v2SessionRolesSchema = z.strictObject({
  schemaVersion: v2VersionSchema,
  roles: z
    .array(v2RoleSchema)
    .min(1)
    .max(4)
    .refine(
      (roles) =>
        new Set(roles).size === roles.length &&
        roles.includes("user") &&
        !(roles.includes("lawyer_applicant") && roles.includes("verified_lawyer")),
      "Invalid role set",
    ),
  reauthenticatedAt: timestampSchema.nullable(),
});
export const v2PageQuerySchema = z.strictObject({
  cursor: opaqueIdSchema.optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
export const v2IdListSchema = z
  .array(opaqueIdSchema)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, "Duplicate references");
/** Runtime rejects oversized raw bodies first; this also bounds normalized JSON inputs. */
export function v2JsonRequestSchema<T extends z.ZodType>(schema: T) {
  return schema.refine(
    (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= V2_LIMITS.jsonBytes,
    "JSON request exceeds 64KiB",
  );
}
export type V2FailureCode = z.infer<typeof v2FailureCodeSchema>;
export type V2ApiError = z.infer<typeof v2ErrorSchema>;
export type V2Role = z.infer<typeof v2RoleSchema>;
export type V2SessionRoles = z.infer<typeof v2SessionRolesSchema>;
export type V2ErrorCode = z.infer<typeof v2ErrorCodeSchema>;
export type V2WaitReason = z.infer<typeof v2WaitReasonSchema>;
export type V2PageQuery = z.infer<typeof v2PageQuerySchema>;
