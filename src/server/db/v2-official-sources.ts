import { z } from "zod";
import { opaqueIdSchema, timestampSchema } from "../../contracts";
import {
  type V2OfficialCitation,
  v2OfficialCitationSchema,
  v2OfficialUrlSchema,
} from "../../contracts/v2";
import {
  guardSchema,
  hashSchema,
  parse,
  safe,
  sqlClaim,
  utf8Bytes,
  type V2Core,
  type WorkspaceGuard,
} from "./v2-core";

const sourceSchema = z.strictObject({
  sourceId: opaqueIdSchema,
  sourceType: z.enum(["statute", "precedent", "official_guide"]),
  officialId: z.string().min(1).max(200),
  version: z.string().min(1).max(200),
  section: z.string().min(1).max(500),
  contentHash: hashSchema,
  extractorVersion: z.string().min(1).max(100),
  canonicalUrl: z.url().max(2048),
  title: z.string().min(1).max(500),
  body: z.string().min(1),
  sourceDate: z.string().nullable(),
  fetchedAt: timestampSchema,
  verifiedAt: timestampSchema,
  expiresAt: timestampSchema,
  rightsProvenance: z.string().min(1).max(2000),
  institutionId: z.string().nullable(),
  endpointId: z.string().nullable(),
  court: z.string().nullable(),
  caseNumber: z.string().nullable(),
});
export type OfficialSourceWrite = z.infer<typeof sourceSchema>;
export const officialSourceIdentitySchema = sourceSchema.pick({
  sourceType: true,
  officialId: true,
  version: true,
  section: true,
  extractorVersion: true,
});
export type OfficialSourceIdentity = z.infer<typeof officialSourceIdentitySchema>;
type SourceRow = {
  source_id: string;
  source_type: OfficialSourceWrite["sourceType"];
  official_id: string;
  version: string;
  section: string;
  content_hash: string;
  extractor_version: string;
  canonical_url: string;
  title: string;
  body: string;
  source_date: string | null;
  fetched_at: string;
  verified_at: string;
  expires_at: string;
  rights_provenance: string;
  institution_id: string | null;
  endpoint_id: string | null;
  court: string | null;
  case_number: string | null;
};
function decodeSource(row: SourceRow): OfficialSourceWrite {
  return parse(sourceSchema, {
    sourceId: row.source_id,
    sourceType: row.source_type,
    officialId: row.official_id,
    version: row.version,
    section: row.section,
    contentHash: row.content_hash,
    extractorVersion: row.extractor_version,
    canonicalUrl: row.canonical_url,
    title: row.title,
    body: row.body,
    sourceDate: row.source_date,
    fetchedAt: row.fetched_at,
    verifiedAt: row.verified_at,
    expiresAt: row.expires_at,
    rightsProvenance: row.rights_provenance,
    institutionId: row.institution_id,
    endpointId: row.endpoint_id,
    court: row.court,
    caseNumber: row.case_number,
  });
}
function citationMatches(source: OfficialSourceWrite, citation: V2OfficialCitation): boolean {
  if (
    source.sourceId !== citation.sourceId ||
    source.sourceType !== citation.kind ||
    source.contentHash !== citation.contentHash ||
    source.canonicalUrl !== citation.url ||
    source.title !== citation.title ||
    Date.parse(source.verifiedAt) !== Date.parse(citation.verifiedAt)
  )
    return false;
  return citation.kind === "statute"
    ? source.officialId === citation.officialId &&
        source.section === citation.article &&
        source.sourceDate === citation.effectiveDate
    : citation.kind === "precedent"
      ? source.officialId === citation.officialId &&
        source.court === citation.court &&
        source.caseNumber === citation.caseNumber &&
        source.sourceDate === citation.decisionDate
      : source.institutionId === citation.institutionId &&
        source.endpointId === citation.endpointId &&
        source.section === citation.section &&
        source.sourceDate === citation.publishedDate;
}
export function createV2OfficialSourceRepository(core: V2Core, guideHosts: readonly string[] = []) {
  return {
    // Public discovered identity only; never a user's private search query.
    findLatestByIdentity(input: OfficialSourceIdentity, now: string) {
      return safe(async () => {
        const identity = parse(officialSourceIdentitySchema, input);
        now = new Date(parse(timestampSchema, now)).toISOString();
        const row = await core
          .statement(
            "SELECT * FROM v2_official_sources WHERE source_type=? AND official_id=? AND version=? AND section=? AND extractor_version=? AND fetched_at<=? AND verified_at<=? AND expires_at>? ORDER BY fetched_at DESC,verified_at DESC,source_id ASC LIMIT 1",
            [
              identity.sourceType,
              identity.officialId,
              identity.version,
              identity.section,
              identity.extractorVersion,
              now,
              now,
              now,
            ],
          )
          .first<SourceRow>();
        if (!row) return null;
        const source = decodeSource(row);
        if (
          !v2OfficialUrlSchema(
            source.sourceType === "official_guide"
              ? guideHosts
              : ["law.go.kr", "www.law.go.kr", "open.law.go.kr"],
          ).safeParse(source.canonicalUrl).success ||
          utf8Bytes(source.body) > 1048576 ||
          Date.parse(source.fetchedAt) > Date.parse(source.verifiedAt)
        )
          return null;
        const digest = Array.from(
          new Uint8Array(
            await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source.body)),
          ),
          (b) => b.toString(16).padStart(2, "0"),
        ).join("");
        if (digest !== source.contentHash) return null;
        // Avoid returning an old latest tuple if a fresher public revision arrives
        // during verification. At most two indexed queries and one 1MiB digest.
        const final = await core
          .statement(
            "SELECT source_id,content_hash,canonical_url,body,verified_at,expires_at FROM v2_official_sources WHERE source_type=? AND official_id=? AND version=? AND section=? AND extractor_version=? AND fetched_at<=? AND verified_at<=? AND expires_at>? ORDER BY fetched_at DESC,verified_at DESC,source_id ASC LIMIT 1",
            [
              identity.sourceType,
              identity.officialId,
              identity.version,
              identity.section,
              identity.extractorVersion,
              now,
              now,
              now,
            ],
          )
          .first<
            Pick<
              SourceRow,
              "source_id" | "content_hash" | "canonical_url" | "body" | "verified_at" | "expires_at"
            >
          >();
        return final &&
          final.source_id === row.source_id &&
          final.content_hash === row.content_hash &&
          final.canonical_url === row.canonical_url &&
          final.body === row.body &&
          final.verified_at === row.verified_at &&
          final.expires_at === row.expires_at
          ? source
          : null;
      });
    },
    put(input: OfficialSourceWrite, citation: V2OfficialCitation) {
      return safe(async () => {
        const source = parse(sourceSchema, input);
        const c = parse(v2OfficialCitationSchema(guideHosts), citation);
        if (
          !citationMatches(source, c) ||
          utf8Bytes(source.body) > 1048576 ||
          Date.parse(source.expiresAt) <= Date.parse(source.verifiedAt) ||
          Date.parse(source.verifiedAt) < Date.parse(source.fetchedAt)
        )
          return false;
        const digest = Array.from(
          new Uint8Array(
            await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source.body)),
          ),
          (b) => b.toString(16).padStart(2, "0"),
        ).join("");
        if (digest !== source.contentHash) return false;
        return (
          (
            await core
              .statement(
                "INSERT INTO v2_official_sources VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET fetched_at=excluded.fetched_at,verified_at=excluded.verified_at,expires_at=excluded.expires_at WHERE v2_official_sources.fetched_at<=excluded.fetched_at AND v2_official_sources.verified_at<=excluded.verified_at AND v2_official_sources.source_type=excluded.source_type AND v2_official_sources.official_id=excluded.official_id AND v2_official_sources.version=excluded.version AND v2_official_sources.section=excluded.section AND v2_official_sources.content_hash=excluded.content_hash AND v2_official_sources.extractor_version=excluded.extractor_version AND v2_official_sources.canonical_url=excluded.canonical_url AND v2_official_sources.source_date IS excluded.source_date AND v2_official_sources.court IS excluded.court AND v2_official_sources.case_number IS excluded.case_number AND v2_official_sources.institution_id IS excluded.institution_id AND v2_official_sources.endpoint_id IS excluded.endpoint_id AND v2_official_sources.title=excluded.title AND v2_official_sources.body=excluded.body AND v2_official_sources.rights_provenance=excluded.rights_provenance",
                [
                  source.sourceId,
                  source.sourceType,
                  source.officialId,
                  source.version,
                  source.section,
                  source.contentHash,
                  source.extractorVersion,
                  source.canonicalUrl,
                  source.title,
                  source.body,
                  source.sourceDate,
                  new Date(source.fetchedAt).toISOString(),
                  new Date(source.verifiedAt).toISOString(),
                  new Date(source.expiresAt).toISOString(),
                  source.rightsProvenance,
                  source.institutionId,
                  source.endpointId,
                  source.court,
                  source.caseNumber,
                ],
              )
              .run()
          ).meta.changes === 1
        );
      });
    },
    find(
      input: {
        sourceId: string;
        sourceType: OfficialSourceWrite["sourceType"];
        officialId: string;
        version: string;
        section: string;
        contentHash: string;
        extractorVersion: string;
      },
      now: string,
    ) {
      return safe(async () => {
        parse(opaqueIdSchema, input.sourceId);
        parse(hashSchema, input.contentHash);
        parse(timestampSchema, now);
        const row = await core
          .statement(
            "SELECT * FROM v2_official_sources WHERE source_id=? AND source_type=? AND official_id=? AND version=? AND section=? AND content_hash=? AND extractor_version=? AND fetched_at<=? AND verified_at<=? AND expires_at>?",
            [
              input.sourceId,
              input.sourceType,
              input.officialId,
              input.version,
              input.section,
              input.contentHash,
              input.extractorVersion,
              new Date(now).toISOString(),
              new Date(now).toISOString(),
              new Date(now).toISOString(),
            ],
          )
          .first<SourceRow>();
        return row ? decodeSource(row) : null;
      });
    },
    bindCitation(g: WorkspaceGuard, citation: V2OfficialCitation) {
      return safe(async () => {
        g = parse(guardSchema, g);
        const c = parse(v2OfficialCitationSchema(guideHosts), citation);
        const row = await core
          .statement("SELECT * FROM v2_official_sources WHERE source_id=?", [c.sourceId])
          .first<SourceRow>();
        if (!row || !citationMatches(decodeSource(row), c)) return false;
        const claimId = crypto.randomUUID();
        return core.changed([
          core.claim(
            g,
            claimId,
            "EXISTS(SELECT 1 FROM v2_official_sources WHERE source_id=? AND source_type=? AND content_hash=? AND canonical_url=? AND official_id=? AND section=? AND source_date IS ? AND institution_id IS ? AND endpoint_id IS ? AND court IS ? AND case_number IS ? AND title=? AND verified_at=? AND verified_at<=? AND expires_at>?)",
            [
              c.sourceId,
              c.kind,
              c.contentHash,
              c.url,
              row.official_id,
              row.section,
              row.source_date,
              row.institution_id,
              row.endpoint_id,
              row.court,
              row.case_number,
              row.title,
              row.verified_at,
              g.now,
              g.now,
            ],
          ),
          core.statement(
            `INSERT INTO v2_citation_bindings(id,workspace_id,source_id,snapshot_revision,citation_json) SELECT ?,?,?,?,? WHERE ${sqlClaim}`,
            [c.id, g.workspaceId, c.sourceId, g.expectedRevision, JSON.stringify(c), claimId],
          ),
          core.finish(claimId),
        ]);
      });
    },
  };
}
