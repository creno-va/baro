import { z } from "zod";
import type { V2OfficialCitation } from "../../../contracts/v2";
import type { RetrievalOutput } from "../legal-retrieval/v2/contracts";
import { sourceExcerpt } from "../legal-retrieval/v2/workspace-sources";
import type { SourceClaim } from "./v2-validate";

const count = z.number().int().min(0).max(50);
const quotationResolutionSchema = z
  .strictObject({
    valid_span: count,
    unique_exact_match: count,
    text_not_found: count,
    ambiguous: count,
    invalid_text: count,
    source_unavailable: count,
  })
  .refine((value) => Object.values(value).reduce((sum, n) => sum + n, 0) <= 50);
export type QuotationResolution = z.infer<typeof quotationResolutionSchema>;

/** Internal, pre-audit observation only. Publication still requires all existing guards. */
export function safeQuotationResolution(value: unknown) {
  const parsed = quotationResolutionSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

type Sources = {
  citations: readonly V2OfficialCitation[];
  sourceTexts?: readonly { citationId: string; text: string }[];
  sourceRetrieval?: RetrievalOutput;
  references: { verifiedCitationIds: readonly string[] };
};
const scalarBoundary = (text: string, i: number) =>
  !(
    i > 0 &&
    i < text.length &&
    /[\uD800-\uDBFF]/.test(text[i - 1] ?? "") &&
    /[\uDC00-\uDFFF]/.test(text[i] ?? "")
  );

/** Correct only numeric quotation coordinates, never text, identity or the provided excerpt.
 * Input claims have already passed workspaceChatOutputSchema (at most 50).
 * The original proof is checked again by validateV2Claims after the final draft audit. */
export function resolveQuotationSpans(claims: readonly SourceClaim[], sources: Sources) {
  const resolution: QuotationResolution = {
    valid_span: 0,
    unique_exact_match: 0,
    text_not_found: 0,
    ambiguous: 0,
    invalid_text: 0,
    source_unavailable: 0,
  };
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
    if (
      !claim.text.length ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(claim.text)
    ) {
      resolution.invalid_text++;
      return claim;
    }
    if (
      claim.startUtf16 >= 0 &&
      claim.endUtf16 <= text.length &&
      scalarBoundary(text, claim.startUtf16) &&
      scalarBoundary(text, claim.endUtf16) &&
      text.slice(claim.startUtf16, claim.endUtf16) === claim.text
    ) {
      resolution.valid_span++;
      return claim;
    }
    const start = text.indexOf(claim.text);
    if (start < 0) {
      resolution.text_not_found++;
      return claim;
    }
    // Increment by one UTF-16 unit to detect overlapping occurrences too.
    if (text.indexOf(claim.text, start + 1) !== -1) {
      resolution.ambiguous++;
      return claim;
    }
    const end = start + claim.text.length;
    if (!scalarBoundary(text, start) || !scalarBoundary(text, end)) {
      resolution.invalid_text++;
      return claim;
    }
    resolution.unique_exact_match++;
    return { ...claim, startUtf16: start, endUtf16: end };
  });
  return { claims: resolved, resolution };
}
