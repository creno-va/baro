import type { V2PrecedentComparison } from "../contracts/v2/precedent-comparison";

/** Keep the verified excerpt intact, including overlapping evidence and UTF-16 offsets. */
export function precedentHighlights(comparison: V2PrecedentComparison) {
  const { text, startUtf16 } = comparison.source.excerpt;
  const ranges = comparison.metrics.flatMap((metric, index) =>
    metric.verdict === "yes"
      ? metric.precedentEvidence.flatMap((evidence) => {
          const start = evidence.startUtf16 - startUtf16;
          const end = evidence.endUtf16 - startUtf16;
          return start >= 0 &&
            end <= text.length &&
            end > start &&
            text.slice(start, end) === evidence.text
            ? [{ start, end, index }]
            : [];
        })
      : [],
  );
  const boundaries = [
    ...new Set([0, text.length, ...ranges.flatMap(({ start, end }) => [start, end])]),
  ].sort((a, b) => a - b);
  return boundaries.slice(0, -1).map((start, i) => {
    const end = boundaries[i + 1] ?? text.length;
    return {
      start,
      text: text.slice(start, end),
      metrics: ranges
        .filter((range) => range.start <= start && range.end >= end)
        .map((range) => range.index),
    };
  });
}
