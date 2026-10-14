import { timestampSchema } from "../../../../contracts";
import { v2OfficialCitationSchema } from "../../../../contracts/v2";
import type { V2Core } from "../../../db/v2-core";
import { decodeSource, type SourceRow } from "../../../db/v2-official-sources";
import { EXTRACTOR_VERSION, MAX_SOURCE_BYTES, type SourceChunk } from "./contracts";
import { OFFICIAL_CATALOG } from "./registry";
import { makeChunk } from "./source";

// At most four separate 1 MiB originals per read; never aggregate bodies in SQL.
export const BOUND_SOURCE_BATCH_SIZE = 4;
type BoundRow = SourceRow & { citation_id: string; citation_json: string };

/** Fresh binding and original reads on both sides of hashing. Results retain input order. */
export async function readBoundSourceBatch(
  core: V2Core,
  workspaceId: string,
  citationIds: readonly string[],
  now: string,
  guideHosts: readonly string[] = [],
): Promise<(SourceChunk | null)[]> {
  const unavailable = () => citationIds.map(() => null);
  if (!citationIds.length || citationIds.length > BOUND_SOURCE_BATCH_SIZE) return unavailable();
  try {
    now = new Date(timestampSchema.parse(now)).toISOString();
    const read = async () =>
      (
        await core
          .statement(
            `SELECT b.id AS citation_id,b.citation_json,s.* FROM v2_citation_bindings b JOIN v2_official_sources s ON s.source_id=b.source_id WHERE b.workspace_id=? AND b.id IN (${citationIds.map(() => "?").join(",")}) AND s.fetched_at<=? AND s.verified_at<=? AND s.expires_at>? AND length(CAST(s.body AS BLOB))<=?`,
            [workspaceId, ...citationIds, now, now, now, MAX_SOURCE_BYTES],
          )
          .all<BoundRow>()
      ).results;
    const initial = new Map((await read()).map((row) => [row.citation_id, row]));
    const asOfDate = new Date(Date.parse(now) + 9 * 3600000).toISOString().slice(0, 10);
    const verified: (SourceChunk | null)[] = [];
    for (const citationId of citationIds) {
      try {
        const row = initial.get(citationId);
        if (!row || row.extractor_version !== EXTRACTOR_VERSION) {
          verified.push(null);
          continue;
        }
        const { _availability, ...publicCitation } = JSON.parse(row.citation_json);
        if (_availability !== "verified") {
          verified.push(null);
          continue;
        }
        const citation = v2OfficialCitationSchema(guideHosts).parse(publicCitation);
        const source = decodeSource(row);
        if (
          citation.id !== citationId ||
          source.rightsProvenance !==
            OFFICIAL_CATALOG.find((entry) => entry.type === source.sourceType)?.rights
        ) {
          verified.push(null);
          continue;
        }
        const rebuilt = await makeChunk(source, asOfDate);
        verified.push(
          rebuilt.source.sourceId === source.sourceId &&
            rebuilt.source.contentHash === source.contentHash &&
            rebuilt.source.expiresAt === source.expiresAt &&
            JSON.stringify({ ...rebuilt.citation, id: citation.id }) === JSON.stringify(citation)
            ? { ...rebuilt, source, citation }
            : null,
        );
      } catch {
        verified.push(null);
      }
    }
    // Hashing yields. Re-read the full source AND its workspace binding before release;
    // no verified result is cached across report digest/fence verification points.
    const final = new Map((await read()).map((row) => [row.citation_id, row]));
    return verified.map((chunk, index) => {
      if (!chunk) return null;
      const citationId = citationIds[index] ?? "";
      const row = final.get(citationId);
      try {
        return row &&
          row.citation_json === initial.get(citationId)?.citation_json &&
          JSON.stringify(decodeSource(row)) === JSON.stringify(chunk.source)
          ? chunk
          : null;
      } catch {
        return null;
      }
    });
  } catch {
    return unavailable();
  }
}

/** Reuse is not source discovery. Rebuild the complete identity from fresh original text. */
export async function readBoundSource(
  core: V2Core,
  workspaceId: string,
  citationId: string,
  now: string,
  guideHosts: readonly string[] = [],
): Promise<SourceChunk | null> {
  return (await readBoundSourceBatch(core, workspaceId, [citationId], now, guideHosts))[0] ?? null;
}
