import { z } from "zod";

const claimFailureSchema = z.enum([
  "retrieval_missing",
  "excerpt_missing",
  "excerpt_span_bounds",
  "claim_schema",
  "server_citation_schema",
  "citation_allowlist",
  "retrieval_hash",
  "verified_source_missing",
  "source_identity",
  "source_hash",
  "source_extractor",
  "citation_verification_time",
  "citation_identity",
  "source_span",
  "source_rebuild",
  "claim_source_missing",
  "claim_span_bounds",
  "claim_unicode_boundary",
  "quotation_mismatch",
  "semantic_receipt",
]);
export type ClaimFailure = z.infer<typeof claimFailureSchema>;

/** Internal receipt only: no source text, IDs, offsets, hashes or free-form reasons. */
export function safeClaimFailure(value: unknown) {
  const result = claimFailureSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
