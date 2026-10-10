import { textHash } from "../service";
import type { RetrievalOutput } from "./contracts";

export function sourceExcerpt(text: string, limit = 20000) {
  let end = Math.min(text.length, limit);
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1] ?? "")) end--;
  return {
    text: text.slice(0, end),
    startUtf16: 0,
    endUtf16: end,
    fullLengthUtf16: text.length,
    truncated: end < text.length,
  };
}

/** Keep proof originals server-side; model input contains explicit bounded excerpts only. */
export async function projectWorkspaceSources(output: RetrievalOutput, rejectedSources = 0) {
  const verified = new Set(
    output.outcomes
      .filter((o) => o.availability === "verified" && o.reason === null)
      .flatMap((o) => o.chunks.map((c) => c.citation.id)),
  );
  const eligible = output.chunks.filter((c) => verified.has(c.citation.id));
  const chunks = eligible.slice(0, 10);
  const sourceTexts = chunks.map((chunk) => ({
    citationId: chunk.citation.id,
    ...sourceExcerpt(chunk.source.body),
  }));
  const sourceRetrieval: RetrievalOutput = {
    ...output,
    chunks,
    outcomes: output.outcomes.map((o) => ({
      ...o,
      chunks: o.chunks.filter((c) => chunks.some((chunk) => chunk.citation.id === c.citation.id)),
    })),
    retrievalHash: await textHash(JSON.stringify(chunks.map((c) => c.citation.sourceId))),
    legalSourceStatus: chunks.length
      ? "verified"
      : output.legalSourceStatus === "not_requested" && !rejectedSources
        ? "not_requested"
        : "unavailable",
  };
  return {
    citations: chunks.map((chunk) => chunk.citation),
    sourceTexts,
    sourceStatus: sourceRetrieval.legalSourceStatus,
    sourceRetrieval,
    sourceCoverage: {
      sourcesPartial:
        eligible.length > 10 ||
        sourceTexts.some((text) => text.truncated) ||
        rejectedSources > 0 ||
        output.outcomes.some(
          (o) => o.availability === "limited" || o.availability === "unavailable",
        ),
      rejectedSources,
      outcomes: output.outcomes.map(({ kind, availability, reason }) => ({
        kind,
        availability,
        reason,
      })),
    },
  };
}
