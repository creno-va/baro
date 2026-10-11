import { v2OfficialCitationSchema } from "../../../../contracts/v2";
import type { V2Core } from "../../../db/v2-core";
import { createV2OfficialSourceRepository } from "../../../db/v2-official-sources";
import { EXTRACTOR_VERSION, type SourceChunk } from "./contracts";
import { OFFICIAL_CATALOG } from "./registry";
import { makeChunk } from "./source";

/** Reuse is not source discovery. Rebuild the complete identity from fresh original text. */
export async function readBoundSource(
  core: V2Core,
  workspaceId: string,
  citationId: string,
  now: string,
  guideHosts: readonly string[] = [],
): Promise<SourceChunk | null> {
  try {
    const row = await core
      .statement(
        "SELECT b.citation_json,s.source_id,s.source_type,s.official_id,s.version,s.section,s.content_hash,s.extractor_version FROM v2_citation_bindings b JOIN v2_official_sources s ON s.source_id=b.source_id WHERE b.workspace_id=? AND b.id=?",
        [workspaceId, citationId],
      )
      .first<{
        citation_json: string;
        source_id: string;
        source_type: "statute" | "precedent" | "official_guide";
        official_id: string;
        version: string;
        section: string;
        content_hash: string;
        extractor_version: string;
      }>();
    if (!row || row.extractor_version !== EXTRACTOR_VERSION) return null;
    const { _availability, ...publicCitation } = JSON.parse(row.citation_json);
    if (_availability !== "verified") return null;
    const citation = v2OfficialCitationSchema(guideHosts).parse(publicCitation);
    if (citation.id !== citationId) return null;
    const identity = {
      sourceId: row.source_id,
      sourceType: row.source_type,
      officialId: row.official_id,
      version: row.version,
      section: row.section,
      contentHash: row.content_hash,
      extractorVersion: row.extractor_version,
    };
    const repository = createV2OfficialSourceRepository(core, guideHosts);
    const source = await repository.find(identity, now);
    if (
      !source ||
      source.rightsProvenance !==
        OFFICIAL_CATALOG.find((entry) => entry.type === source.sourceType)?.rights
    )
      return null;
    const asOfDate = new Date(Date.parse(now) + 9 * 3600000).toISOString().slice(0, 10);
    const rebuilt = await makeChunk(source, asOfDate);
    if (
      rebuilt.source.sourceId !== source.sourceId ||
      rebuilt.source.contentHash !== source.contentHash ||
      rebuilt.source.expiresAt !== source.expiresAt ||
      JSON.stringify({ ...rebuilt.citation, id: citation.id }) !== JSON.stringify(citation)
    )
      return null;
    // Hashing yields; do not release an original/tuple changed during verification.
    const final = await repository.find(identity, now);
    if (JSON.stringify(final) !== JSON.stringify(source)) return null;
    const finalBinding = await core
      .statement("SELECT citation_json FROM v2_citation_bindings WHERE workspace_id=? AND id=?", [
        workspaceId,
        citationId,
      ])
      .first<{ citation_json: string }>();
    if (finalBinding?.citation_json !== row.citation_json) return null;
    return { ...rebuilt, source, citation };
  } catch {
    return null;
  }
}
