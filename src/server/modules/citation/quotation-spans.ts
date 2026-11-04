import type { V2OfficialCitation } from "../../../contracts/v2";
import type { RetrievalOutput } from "../legal-retrieval/v2/contracts";
import { sourceExcerpt } from "../legal-retrieval/v2/workspace-sources";
import { emptyQuotationResolution, locateLiteralQuotation } from "./literal-quotation";
import type { SourceClaim } from "./v2-validate";

export { type QuotationResolution, safeQuotationResolution } from "./literal-quotation";

type Sources = {
  citations: readonly V2OfficialCitation[];
  sourceTexts?: readonly { citationId: string; text: string }[];
  sourceRetrieval?: RetrievalOutput;
  references: { verifiedCitationIds: readonly string[] };
};

/** Correct only numeric quotation coordinates, never text, identity or the provided excerpt.
 * Input claims have already passed workspaceChatOutputSchema (at most 50).
 * The original proof is checked again by validateV2Claims after the final draft audit. */
export function resolveQuotationSpans(claims: readonly SourceClaim[], sources: Sources) {
  const resolution = emptyQuotationResolution();
  const resolved = claims.map((claim) => {
    if (claim.kind !== "quotation") return claim;
    const texts = sources.sourceTexts?.filter((item) => item.citationId === claim.citationId) ?? [];
    const citations = sources.citations.filter((item) => item.id === claim.citationId);
    const retrieval = sources.sourceRetrieval;
    const chunks = retrieval?.chunks.filter((item) => item.citation.id === claim.citationId) ?? [];
    const text = texts[0]?.text,
      citation = citations[0],
      chunk = chunks[0];
    if (
      texts.length !== 1 ||
      citations.length !== 1 ||
      chunks.length !== 1 ||
      text === undefined ||
      !citation ||
      !chunk ||
      retrieval?.legalSourceStatus !== "verified" ||
      !sources.references.verifiedCitationIds.includes(claim.citationId) ||
      JSON.stringify(citation) !== JSON.stringify(chunk.citation) ||
      !retrieval.outcomes.some(
        (outcome) =>
          outcome.availability === "verified" &&
          outcome.reason === null &&
          outcome.kind === citation.kind &&
          outcome.chunks.some((item) => item.citation.id === claim.citationId),
      ) ||
      // The model received this exact prefix. Never search the full original.
      text !== sourceExcerpt(chunk.source.body).text
    ) {
      resolution.source_unavailable++;
      return claim;
    }
    const located = locateLiteralQuotation(claim, text);
    resolution[located.kind]++;
    return located.kind === "unique_exact_match"
      ? { ...claim, startUtf16: located.startUtf16, endUtf16: located.endUtf16 }
      : claim;
  });
  return { claims: resolved, resolution };
}
