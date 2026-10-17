import { timestampSchema } from "../../../../contracts";
import type { V2FactReference, V2OfficialCitation } from "../../../../contracts/v2";
import { utf8Bytes, type V2Core, type WorkspaceGuard } from "../../../db/v2-core";
import { BOUND_SOURCE_BATCH_SIZE, readBoundSourceBatch } from "./bound-sources";
import type { SourceChunk } from "./contracts";
import { NO_NEWER_CONFLICTING_SOURCE_SQL } from "./source-authority";

// Hashing happens in Workers. The atomic SQL claim then freezes every verified
// public field and full original byte-for-byte, including the hash it attested.
const sourceColumns = {
  source_id: "sourceId",
  source_type: "sourceType",
  official_id: "officialId",
  version: "version",
  section: "section",
  content_hash: "contentHash",
  extractor_version: "extractorVersion",
  canonical_url: "canonicalUrl",
  title: "title",
  body: "body",
  source_date: "sourceDate",
  fetched_at: "fetchedAt",
  verified_at: "verifiedAt",
  expires_at: "expiresAt",
  rights_provenance: "rightsProvenance",
  institution_id: "institutionId",
  endpoint_id: "endpointId",
  court: "court",
  case_number: "caseNumber",
} as const;

/** For new AI publication only. Historical reads/manual edits do not gain a new
 * freshness requirement. No caller/model citation can replace a stored binding. */
export async function capturePublicationSourceAuthority(
  core: V2Core,
  guard: WorkspaceGuard,
  references: readonly V2FactReference[],
  citations: readonly V2OfficialCitation[],
  guideHosts: readonly string[],
) {
  const ids = [
    ...new Set(
      references.flatMap((ref) => (ref.kind === "official_source" ? [ref.citationId] : [])),
    ),
  ];
  if (!ids.length) return { sql: "1", values: (_now: string): unknown[] => [] };
  if (ids.length > 50) return null;
  const proofs: { citationId: string; binding: string; source: SourceChunk["source"] }[] = [];
  let proofBytes = 2; // JSON array brackets; the existing report fence uses the same 1 MiB technical bound.
  for (let offset = 0; offset < ids.length; offset += BOUND_SOURCE_BATCH_SIZE) {
    const chunks = await readBoundSourceBatch(
      core,
      guard.workspaceId,
      ids.slice(offset, offset + BOUND_SOURCE_BATCH_SIZE),
      guard.now,
      guideHosts,
    );
    for (const chunk of chunks) {
      if (
        !chunk ||
        !citations.some((citation) => JSON.stringify(citation) === JSON.stringify(chunk.citation))
      )
        return null;
      const proof = {
        citationId: chunk.citation.id,
        binding: JSON.stringify({ ...chunk.citation, _availability: "verified" }),
        source: chunk.source,
      };
      proofBytes += utf8Bytes(JSON.stringify(proof)) + (proofs.length ? 1 : 0);
      if (proofBytes > 1048576) return null;
      proofs.push(proof);
    }
  }
  const frozen = JSON.stringify(proofs);
  return {
    sql: `NOT EXISTS (SELECT 1 FROM json_each(?) proof WHERE NOT EXISTS (
      SELECT 1 FROM v2_citation_bindings c JOIN v2_official_sources s ON s.source_id=c.source_id
      WHERE c.workspace_id=w.id AND c.id=json_extract(proof.value,'$.citationId') AND c.citation_json=json_extract(proof.value,'$.binding')
        AND (${Object.keys(sourceColumns)
          .map((column) => `s.${column}`)
          .join(",")}) IS (${Object.values(sourceColumns)
          .map((field) => `json_extract(proof.value,'$.source.${field}')`)
          .join(",")})
        AND s.fetched_at<=? AND s.verified_at<=? AND s.expires_at>?
        AND ${NO_NEWER_CONFLICTING_SOURCE_SQL}
    ))`,
    values(now: string): unknown[] {
      now = new Date(timestampSchema.parse(now)).toISOString();
      return [frozen, now, now, now];
    },
  };
}
