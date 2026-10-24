import type { z } from "zod";
import type { V2Fact } from "../../../../contracts/v2";
import {
  type PrecedentComparisonDraft,
  precedentComparisonDraftSchema,
  type precedentComparisonSourceSchema,
} from "../../../../contracts/v2/precedent-comparison";

/** Literal evidence integrity, separate from the independent model's semantic audit.
 * Missing evidence never becomes a negative finding or a smaller denominator. */
export function checkPrecedentComparison(
  raw: unknown,
  facts: readonly V2Fact[],
  source: z.infer<typeof precedentComparisonSourceSchema>,
): PrecedentComparisonDraft | null {
  const parsed = precedentComparisonDraftSchema.safeParse(raw);
  if (!parsed.success) return null;
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const excerpt = source.excerpt;
  for (const metric of parsed.data.metrics) {
    for (const evidence of metric.caseEvidence) {
      const fact = byId.get(evidence.factId);
      if (
        !fact ||
        fact.attribution === "official_source" ||
        !fact.text.includes(evidence.text) ||
        (metric.verdict !== "unknown" && ["uncertain", "conflicting"].includes(fact.certainty))
      )
        return null;
    }
    for (const evidence of metric.precedentEvidence) {
      const start = evidence.startUtf16 - excerpt.startUtf16;
      const end = evidence.endUtf16 - excerpt.startUtf16;
      if (
        start < 0 ||
        end <= start ||
        end > excerpt.text.length ||
        excerpt.text.slice(start, end) !== evidence.text
      )
        return null;
      // A UTF-16 coordinate may not split a surrogate pair.
      if (start > 0 && /[\uDC00-\uDFFF]/.test(excerpt.text[start] ?? "")) return null;
      if (end < excerpt.text.length && /[\uDC00-\uDFFF]/.test(excerpt.text[end] ?? "")) return null;
    }
  }
  return parsed.data;
}

export function precedentComparisonScore(draft: PrecedentComparisonDraft) {
  const matchedCount = draft.metrics.filter((metric) => metric.verdict === "yes").length;
  return {
    matchedCount,
    knownCount: draft.metrics.filter((metric) => metric.verdict !== "unknown").length,
    percentage: Math.round((100 * matchedCount) / 8),
  };
}
