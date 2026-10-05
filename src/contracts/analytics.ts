import { z } from "zod";
import { caseStatusSchema, timestampSchema, uuidSchema } from "./common";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const common = {
  eventId: uuidSchema,
  flowId: uuidSchema,
  eventVersion: z.literal("1"),
  occurredAt: timestampSchema,
  environment: z.enum(["local", "preview", "production"]),
  release: z.string().regex(/^(local|[a-f0-9]{7,40})$/),
  anonymousUserId: uuidSchema,
  sessionId: uuidSchema,
  caseIdHash: hash.optional(),
  analysisIdHash: hash.optional(),
  entryPoint: z.enum(["list", "direct", "result"]).optional(),
  deviceClass: z.enum(["mobile", "tablet", "desktop"]).optional(),
  resultStatus: caseStatusSchema.optional(),
  questionCount: z.number().int().min(0).max(5).optional(),
  citationCount: z.number().int().min(0).max(20).optional(),
  durationBucket: z.enum(["under_1m", "under_3m", "under_5m", "under_10m", "over_10m"]).optional(),
  errorCategory: z
    .enum(["model", "legal_source", "timeout", "policy", "dispatch", "internal"])
    .optional(),
};
export const analyticsEventSchema = z.discriminatedUnion("name", [
  z.strictObject({ ...common, name: z.literal("case_input_viewed") }),
  z.strictObject({
    ...common,
    name: z.literal("case_submitted"),
    caseIdHash: hash,
    analysisIdHash: hash,
    narrativeLengthBucket: z.enum(["20_100", "101_1000", "1001_5000"]),
  }),
  z.strictObject({
    ...common,
    name: z.literal("clarification_viewed"),
    questionCount: z.number().int().min(1).max(5),
  }),
  z.strictObject({
    ...common,
    name: z.literal("clarification_completed"),
    questionCount: z.number().int().min(1).max(5),
    unknownCount: z.number().int().min(0).max(5),
  }),
  z.strictObject({ ...common, name: z.literal("analysis_started"), analysisIdHash: hash }),
  z.strictObject({ ...common, name: z.literal("analysis_completed"), analysisIdHash: hash }),
  z.strictObject({
    ...common,
    name: z.literal("analysis_failed"),
    analysisIdHash: hash,
    retryable: z.boolean(),
  }),
  z.strictObject({ ...common, name: z.literal("result_viewed"), analysisIdHash: hash }),
  z.strictObject({
    ...common,
    name: z.literal("evidence_checked"),
    analysisIdHash: hash,
    itemIndex: z.number().int().min(0).max(19),
    checked: z.boolean(),
  }),
  z.strictObject({
    ...common,
    name: z.literal("citation_opened"),
    analysisIdHash: hash,
    sourceType: z.literal("statute"),
    itemIndex: z.number().int().min(0).max(19),
  }),
  z.strictObject({
    ...common,
    name: z.literal("case_revisited"),
    analysisIdHash: hash,
    daysSinceCreationBucket: z.enum(["same_day", "1_7", "8_30", "over_30"]),
  }),
  z.strictObject({ ...common, name: z.literal("trust_answered"), helpful: z.enum(["yes", "no"]) }),
  z.strictObject({ ...common, name: z.literal("case_deleted") }),
  z.strictObject({ ...common, name: z.literal("account_deleted") }),
]);
export type AnalyticsEvent = z.infer<typeof analyticsEventSchema>;
export const feedbackRequestSchema = z.strictObject({ helpful: z.boolean() });
