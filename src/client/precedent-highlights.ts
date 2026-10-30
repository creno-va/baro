import type { V2PrecedentComparison } from "../contracts/v2/precedent-comparison";

/** Keep the verified excerpt intact, including overlapping evidence and UTF-16 offsets. */
export function precedentHighlights(
  comparison: V2PrecedentComparison,
  span = comparison.source.excerpt as { text: string; startUtf16: number },
) {
  const { text, startUtf16 } = span;
  const ranges = comparison.metrics.flatMap((metric, index) =>
    metric.verdict === "yes"
      ? metric.precedentEvidence.flatMap((evidence) => {
          const start = evidence.startUtf16 - startUtf16;
          const end = evidence.endUtf16 - startUtf16;
          const clippedStart = Math.max(0, start),
            clippedEnd = Math.min(text.length, end);
          const originalStart = evidence.startUtf16 - comparison.source.excerpt.startUtf16;
          return evidence.endUtf16 - evidence.startUtf16 === evidence.text.length &&
            originalStart >= 0 &&
            comparison.source.excerpt.text.slice(
              originalStart,
              originalStart + evidence.text.length,
            ) === evidence.text &&
            clippedEnd > clippedStart &&
            text.slice(clippedStart, clippedEnd) ===
              evidence.text.slice(clippedStart - start, clippedEnd - start)
            ? [{ start: clippedStart, end: clippedEnd, index }]
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
