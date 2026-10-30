import { z } from "zod";
import { displayText, opaqueIdSchema, revisionSchema, timestampSchema } from "../common";
import { v2PrecedentReadRequestSchema, v2PrecedentReadResponseSchema } from "./precedent-research";
import { v2JobSchema } from "./workspace";

export const PRECEDENT_COMPARISON_CRITERIA = {
  relationship: "당사자의 역할과 관계",
  activity: "거래나 행위의 종류",
  formation: "약속이나 관계가 생긴 과정",
  disputed_conduct: "문제가 된 행동",
  sequence: "일이 진행된 순서",
  harm: "발생한 피해나 불이익의 종류",
  disputed_facts: "서로 다투는 사실",
  records: "사실 확인에 쓰인 자료의 종류",
} as const;
export const precedentCriterionSchema = z.enum([
  "relationship",
  "activity",
  "formation",
  "disputed_conduct",
  "sequence",
  "harm",
  "disputed_facts",
  "records",
]);
export const v2PrecedentComparisonRequestSchema = v2PrecedentReadRequestSchema.extend({
  summaryRevision: revisionSchema,
});
export type V2PrecedentComparisonRequest = z.infer<typeof v2PrecedentComparisonRequestSchema>;
export const precedentComparisonSourceSchema = z.strictObject({
  citation: v2PrecedentReadResponseSchema.shape.citation,
  excerpt: v2PrecedentReadResponseSchema.shape.excerpt,
});
// Quoted evidence is not display prose: never trim or normalize its exact bytes.
const exactQuote = z
  .string()
  .refine(
    (value) =>
      value.trim().length > 0 && [...value].length <= 1000 && !/<\/?[a-z!][^>]*>/i.test(value),
  );
export const precedentComparisonMetricSchema = z
  .strictObject({
    criterion: precedentCriterionSchema,
    verdict: z.enum(["yes", "no", "unknown"]),
    explanation: displayText(350),
    caseEvidence: z.array(z.strictObject({ factId: opaqueIdSchema, text: exactQuote })).max(3),
    precedentEvidence: z
      .array(
        z.strictObject({
          text: exactQuote,
          startUtf16: z.number().int().nonnegative(),
          endUtf16: z.number().int().positive(),
        }),
      )
      .max(3),
  })
  .refine(
    (value) =>
      value.verdict === "unknown" ||
      (value.caseEvidence.length > 0 && value.precedentEvidence.length > 0),
    "A yes/no comparison requires evidence on both sides",
  );

/** Model supplies grounded indicators only; counts, weights and score are server-owned. */
export const precedentComparisonDraftSchema = z.strictObject({
  metrics: z
    .array(precedentComparisonMetricSchema)
    .length(8)
    .refine(
      (values) => new Set(values.map((value) => value.criterion)).size === 8,
      "Every fixed criterion must appear exactly once",
    ),
});
export type PrecedentComparisonDraft = z.infer<typeof precedentComparisonDraftSchema>;
export const v2PrecedentComparisonSchema = z
  .strictObject({
    schemaVersion: z.literal("2"),
    criteriaVersion: z.literal("1"),
    basedOnWorkspaceRevision: revisionSchema,
    publishedWorkspaceRevision: revisionSchema,
    summaryRevision: revisionSchema,
    checkedAt: timestampSchema,
    source: precedentComparisonSourceSchema,
    metrics: precedentComparisonDraftSchema.shape.metrics,
    matchedCount: z.number().int().min(0).max(8),
    knownCount: z.number().int().min(0).max(8),
    percentage: z.number().int().min(0).max(100),
    factsPartial: z.boolean(),
  })
  .refine((value) => {
    const yes = value.metrics.filter((metric) => metric.verdict === "yes").length;
    const known = value.metrics.filter((metric) => metric.verdict !== "unknown").length;
    return (
      value.matchedCount === yes &&
      value.knownCount === known &&
      value.percentage === Math.round((100 * yes) / 8) &&
      value.publishedWorkspaceRevision === value.basedOnWorkspaceRevision + 2
    );
  }, "Server score and publication revision must match the fixed evidence checklist");
export type V2PrecedentComparison = z.infer<typeof v2PrecedentComparisonSchema>;
export const v2PrecedentComparisonStateSchema = z
  .strictObject({
    schemaVersion: z.literal("2"),
    job: v2JobSchema,
    comparison: v2PrecedentComparisonSchema.nullable(),
    stale: z.boolean(),
  })
  .refine(
    (value) => (value.job.status === "completed") === (value.comparison !== null),
    "Only a completed comparison has a published result",
  );
export type V2PrecedentComparisonState = z.infer<typeof v2PrecedentComparisonStateSchema>;
