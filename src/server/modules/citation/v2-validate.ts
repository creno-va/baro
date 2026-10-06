import { z } from "zod";
import { displayText, hasUniqueIds, opaqueIdSchema } from "../../../contracts";
import { v2CitationsForRetrievedSourcesSchema } from "../../../contracts/v2";
import { textHash } from "../legal-retrieval/service";
import { EXTRACTOR_VERSION, type RetrievalOutput } from "../legal-retrieval/v2/contracts";
import { GUIDE_HOSTS } from "../legal-retrieval/v2/registry";
import { makeChunk } from "../legal-retrieval/v2/source";

const claimSchema = z
  .strictObject({
    id: opaqueIdSchema,
    text: displayText(10000),
    kind: z.enum(["quotation", "legal_explanation"]),
    citationId: opaqueIdSchema,
    startUtf16: z.number().int().nonnegative(),
    endUtf16: z.number().int().positive(),
  })
  .refine((c) => c.endUtf16 > c.startUtf16);
export type SourceClaim = z.infer<typeof claimSchema>;
export function claimReviewHash(claim: SourceClaim, asOfDate: string) {
  return textHash(
    JSON.stringify([
      claim.id,
      claim.kind,
      claim.text,
      claim.citationId,
      claim.startUtf16,
      claim.endUtf16,
      asOfDate,
    ]),
  );
}
// Semantic/policy receipts are produced by #64 through llm-gateway. Source
// integrity alone proves neither applicability nor an asserted legal conclusion.
export type ClaimReview = {
  claimId: string;
  claimHash: string;
  sourceHash: string;
  accepted: boolean;
  policyAccepted: boolean;
};
export async function validateV2Claims(
  claims: unknown,
  citations: unknown,
  retrieval: RetrievalOutput,
  reviews: readonly ClaimReview[] = [],
) {
  const parsed = z.array(claimSchema).max(100).refine(hasUniqueIds).safeParse(claims);
  // This boundary may receive corrupt persisted metadata too. Never let a
  // malformed server citation escape as a raw Zod exception.
  let citationsParsed: ReturnType<
    ReturnType<typeof v2CitationsForRetrievedSourcesSchema>["safeParse"]
  >;
  try {
    citationsParsed = v2CitationsForRetrievedSourcesSchema(
      retrieval.chunks.map((c) => c.citation),
      GUIDE_HOSTS,
    ).safeParse(citations);
  } catch {
    return { valid: false, accepted: [], rejected: [] };
  }
  if (!parsed.success || !citationsParsed.success)
    return { valid: false, accepted: [], rejected: [] };
  if (
    retrieval.retrievalHash !==
    (await textHash(JSON.stringify(retrieval.chunks.map((c) => c.citation.sourceId))))
  )
    return { valid: false, accepted: [], rejected: [] };
  const verifiedCitationIds = new Set<string>();
  for (const citation of citationsParsed.data) {
    const chunk = retrieval.chunks.find((c) => c.citation.id === citation.id);
    const outcome = retrieval.outcomes.find(
      (o) =>
        o.availability === "verified" &&
        o.reason === null &&
        o.chunks.some((c) => c.citation.id === citation.id),
    );
    if (
      !chunk ||
      !outcome ||
      outcome.kind !== citation.kind ||
      retrieval.legalSourceStatus !== "verified"
    )
      return { valid: false, accepted: [], rejected: [] };
    try {
      const rebuilt = await makeChunk(chunk.source, retrieval.asOfDate);
      if (
        chunk.source.sourceId !== rebuilt.source.sourceId ||
        chunk.source.contentHash !== rebuilt.source.contentHash ||
        chunk.source.extractorVersion !== EXTRACTOR_VERSION ||
        JSON.stringify({ ...rebuilt.citation, id: citation.id }) !== JSON.stringify(citation) ||
        chunk.span.text !== chunk.source.body ||
        chunk.span.startUtf16 !== 0 ||
        chunk.span.endUtf16 !== chunk.source.body.length
      )
        return { valid: false, accepted: [], rejected: [] };
    } catch {
      return { valid: false, accepted: [], rejected: [] };
    }
    verifiedCitationIds.add(citation.id);
  }
  const accepted: string[] = [],
    rejected: string[] = [];
  for (const claim of parsed.data) {
    const chunk = retrieval.chunks.find((c) => c.citation.id === claim.citationId);
    let valid = !!chunk && verifiedCitationIds.has(claim.citationId);
    if (chunk) {
      valid = valid && claim.endUtf16 <= chunk.source.body.length;
      const slice = chunk.source.body.slice(claim.startUtf16, claim.endUtf16);
      // A span cannot split a supplementary Unicode scalar.
      const scalarBoundary = (i: number) =>
        !(
          i > 0 &&
          i < chunk.source.body.length &&
          /[\uD800-\uDBFF]/.test(chunk.source.body[i - 1] ?? "") &&
          /[\uDC00-\uDFFF]/.test(chunk.source.body[i] ?? "")
        );
      valid = valid && scalarBoundary(claim.startUtf16) && scalarBoundary(claim.endUtf16);
      if (claim.kind === "quotation") valid = valid && claim.text === slice;
      else {
        const claimHash = await claimReviewHash(claim, retrieval.asOfDate);
        valid =
          valid &&
          reviews.some(
            (r) =>
              r.claimId === claim.id &&
              r.sourceHash === chunk.citation.contentHash &&
              r.accepted &&
              r.policyAccepted &&
              r.claimHash === claimHash,
          );
      }
    }
    (valid ? accepted : rejected).push(claim.id);
  }
  return { valid: rejected.length === 0, accepted, rejected };
}
