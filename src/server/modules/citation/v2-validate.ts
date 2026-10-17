import { z } from "zod";
import { displayText, hasUniqueIds, opaqueIdSchema } from "../../../contracts";
import { v2CitationsForRetrievedSourcesSchema } from "../../../contracts/v2";
import { textHash } from "../legal-retrieval/service";
import { EXTRACTOR_VERSION, type RetrievalOutput } from "../legal-retrieval/v2/contracts";
import { GUIDE_HOSTS } from "../legal-retrieval/v2/registry";
import { citationMatchesReverifiedSource, makeChunk } from "../legal-retrieval/v2/source";
import type { ClaimFailure } from "./claim-diagnostics";

export const sourceClaimSchema = z
  .strictObject({
    id: opaqueIdSchema,
    text: displayText(10000),
    kind: z.enum(["quotation", "legal_explanation"]),
    citationId: opaqueIdSchema,
    startUtf16: z.number().int().nonnegative(),
    endUtf16: z.number().int().positive(),
  })
  .refine((c) => c.endUtf16 > c.startUtf16);
export type SourceClaim = z.infer<typeof sourceClaimSchema>;
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
  const failed = (failure: ClaimFailure) => ({
    valid: false,
    accepted: [] as string[],
    rejected: [] as string[],
    failure,
  });
  const parsed = z.array(sourceClaimSchema).max(100).refine(hasUniqueIds).safeParse(claims);
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
    return failed("server_citation_schema");
  }
  if (!parsed.success) return failed("claim_schema");
  if (!citationsParsed.success) return failed("citation_allowlist");
  if (
    retrieval.retrievalHash !==
    (await textHash(JSON.stringify(retrieval.chunks.map((c) => c.citation.sourceId))))
  )
    return failed("retrieval_hash");
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
      return failed("verified_source_missing");
    try {
      const rebuilt = await makeChunk(chunk.source, retrieval.asOfDate);
      if (chunk.source.sourceId !== rebuilt.source.sourceId) return failed("source_identity");
      if (chunk.source.contentHash !== rebuilt.source.contentHash) return failed("source_hash");
      if (chunk.source.extractorVersion !== EXTRACTOR_VERSION) return failed("source_extractor");
      if (!citationMatchesReverifiedSource(citation, rebuilt.citation))
        return failed(
          Date.parse(citation.verifiedAt) > Date.parse(rebuilt.citation.verifiedAt)
            ? "citation_verification_time"
            : "citation_identity",
        );
      if (
        chunk.span.text !== chunk.source.body ||
        chunk.span.startUtf16 !== 0 ||
        chunk.span.endUtf16 !== chunk.source.body.length
      )
        return failed("source_span");
    } catch {
      return failed("source_rebuild");
    }
    verifiedCitationIds.add(citation.id);
  }
  const accepted: string[] = [],
    rejected: string[] = [];
  let failure: ClaimFailure | undefined;
  for (const claim of parsed.data) {
    const chunk = retrieval.chunks.find((c) => c.citation.id === claim.citationId);
    let valid = !!chunk && verifiedCitationIds.has(claim.citationId);
    let reason: ClaimFailure | undefined = valid ? undefined : "claim_source_missing";
    if (chunk) {
      valid = valid && claim.endUtf16 <= chunk.source.body.length;
      if (!valid) reason ??= "claim_span_bounds";
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
      if (!valid) reason ??= "claim_unicode_boundary";
      if (claim.kind === "quotation") {
        valid = valid && claim.text === slice;
        if (!valid) reason ??= "quotation_mismatch";
      } else {
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
        if (!valid) reason ??= "semantic_receipt";
      }
    }
    (valid ? accepted : rejected).push(claim.id);
    if (!valid) failure ??= reason;
  }
  return { valid: rejected.length === 0, accepted, rejected, ...(failure ? { failure } : {}) };
}
