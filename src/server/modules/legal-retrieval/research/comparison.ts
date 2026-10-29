import { z } from "zod";
import type { V2Fact } from "../../../../contracts/v2";
import {
  type PrecedentComparisonDraft,
  precedentComparisonDraftSchema,
  precedentComparisonMetricSchema,
  type precedentComparisonSourceSchema,
  type precedentCriterionSchema,
} from "../../../../contracts/v2/precedent-comparison";

/** Private model candidate. Cross-field evidence requirements are checked per
 * indicator below; empty evidence must not invalidate unrelated indicators. */
export const comparisonCandidateSchema = z.strictObject({
  metrics: z
    .array(z.strictObject(precedentComparisonMetricSchema.shape))
    .length(8)
    .refine((metrics) => new Set(metrics.map((metric) => metric.criterion)).size === 8),
});

export const comparisonEvidenceObservationSchema = z
  .strictObject({
    reason: z.enum([
      "accepted",
      "invalid_draft",
      "unknown_case_fact",
      "case_not_user_fact",
      "case_quote_mismatch",
      "case_uncertain",
      "source_quote_missing",
      "source_quote_ambiguous",
      "source_quote_invalid",
      "audit_metric_rejected",
    ]),
    validSpans: z.number().int().min(0).max(24),
    uniqueExactSpans: z.number().int().min(0).max(24),
  })
  .refine((value) => value.validSpans + value.uniqueExactSpans <= 24);
export type ComparisonEvidenceObservation = z.infer<typeof comparisonEvidenceObservationSchema>;
const malformedUnicode = (text: string) =>
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);
const scalarBoundary = (text: string, offset: number) =>
  !(
    offset > 0 &&
    offset < text.length &&
    /[\uD800-\uDBFF]/.test(text[offset - 1] ?? "") &&
    /[\uDC00-\uDFFF]/.test(text[offset] ?? "")
  );

/** Only numeric coordinates may be corrected, using a unique exact quote inside
 * the supplied verified excerpt. Never search an unread part of the original,
 * paraphrase/normalize text, change identities, or weaken the independent audit. */
export function inspectPrecedentComparison(
  raw: unknown,
  facts: readonly V2Fact[],
  source: z.infer<typeof precedentComparisonSourceSchema>,
) {
  let validSpans = 0,
    uniqueExactSpans = 0;
  const finish = (
    reason: ComparisonEvidenceObservation["reason"],
    draft: PrecedentComparisonDraft | null = null,
  ) => ({
    draft,
    observation: comparisonEvidenceObservationSchema.parse({
      reason,
      validSpans,
      uniqueExactSpans,
    }),
  });
  const parsed = precedentComparisonDraftSchema.safeParse(raw);
  if (!parsed.success) return finish("invalid_draft");
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const excerpt = source.excerpt;
  for (const metric of parsed.data.metrics) {
    for (const evidence of metric.caseEvidence) {
      const fact = byId.get(evidence.factId);
      if (!fact) return finish("unknown_case_fact");
      if (!["user_statement", "user_material"].includes(fact.attribution))
        return finish("case_not_user_fact");
      if (malformedUnicode(evidence.text) || !fact.text.includes(evidence.text))
        return finish("case_quote_mismatch");
      if (metric.verdict !== "unknown" && ["uncertain", "conflicting"].includes(fact.certainty))
        return finish("case_uncertain");
    }
    for (const evidence of metric.precedentEvidence) {
      let start = evidence.startUtf16 - excerpt.startUtf16;
      let end = evidence.endUtf16 - excerpt.startUtf16;
      if (malformedUnicode(evidence.text)) return finish("source_quote_invalid");
      if (
        start >= 0 &&
        end > start &&
        end <= excerpt.text.length &&
        scalarBoundary(excerpt.text, start) &&
        scalarBoundary(excerpt.text, end) &&
        excerpt.text.slice(start, end) === evidence.text
      ) {
        validSpans++;
        continue;
      }
      start = excerpt.text.indexOf(evidence.text);
      if (start < 0) return finish("source_quote_missing");
      if (excerpt.text.indexOf(evidence.text, start + 1) !== -1)
        return finish("source_quote_ambiguous");
      end = start + evidence.text.length;
      if (!scalarBoundary(excerpt.text, start) || !scalarBoundary(excerpt.text, end))
        return finish("source_quote_invalid");
      evidence.startUtf16 = excerpt.startUtf16 + start;
      evidence.endUtf16 = excerpt.startUtf16 + end;
      uniqueExactSpans++;
    }
  }
  return finish("accepted", parsed.data);
}

/** Missing evidence never becomes a negative finding or a smaller denominator. */
export function checkPrecedentComparison(
  raw: unknown,
  facts: readonly V2Fact[],
  source: z.infer<typeof precedentComparisonSourceSchema>,
) {
  return inspectPrecedentComparison(raw, facts, source).draft;
}

export function unverifiedComparisonMetric(criterion: z.infer<typeof precedentCriterionSchema>) {
  return {
    criterion,
    verdict: "unknown" as const,
    explanation: "제공된 사건 사실과 판례에서 이 항목을 비교할 근거를 확인하지 못했어요.",
    caseEvidence: [],
    precedentEvidence: [],
  };
}

/** Reuse the exact strict evidence check independently for each bounded
 * indicator. Unverifiable content is discarded in full, not rewritten into a
 * match/difference; the resulting complete draft still needs semantic audit. */
export function groundPrecedentComparison(
  raw: unknown,
  facts: readonly V2Fact[],
  source: z.infer<typeof precedentComparisonSourceSchema>,
) {
  const parsed = comparisonCandidateSchema.safeParse(raw);
  if (!parsed.success)
    return {
      draft: null,
      observations: [inspectPrecedentComparison(raw, facts, source).observation],
    };
  const observations: ComparisonEvidenceObservation[] = [];
  const metrics = parsed.data.metrics.map((metric) => {
    const checked = inspectPrecedentComparison(
      {
        metrics: parsed.data.metrics.map((other) =>
          other.criterion === metric.criterion
            ? metric
            : unverifiedComparisonMetric(other.criterion),
        ),
      },
      facts,
      source,
    );
    observations.push(checked.observation);
    return (
      checked.draft?.metrics.find((other) => other.criterion === metric.criterion) ??
      unverifiedComparisonMetric(metric.criterion)
    );
  });
  return { draft: { metrics }, observations };
}

export function precedentComparisonScore(draft: PrecedentComparisonDraft) {
  const matchedCount = draft.metrics.filter((metric) => metric.verdict === "yes").length;
  return {
    matchedCount,
    knownCount: draft.metrics.filter((metric) => metric.verdict !== "unknown").length,
    percentage: Math.round((100 * matchedCount) / 8),
  };
}
