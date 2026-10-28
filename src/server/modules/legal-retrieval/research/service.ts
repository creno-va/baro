import { opaqueIdSchema } from "../../../../contracts";
import { v2SummarySchema } from "../../../../contracts/v2";
import { v2PrecedentComparisonRequestSchema } from "../../../../contracts/v2/precedent-comparison";
import {
  type V2PrecedentSearchResponse,
  type V2PrecedentTopic,
  v2PrecedentReadRequestSchema,
  v2PrecedentReadResponseSchema,
  v2PrecedentResearchContextSchema,
  v2PrecedentSearchRequestSchema,
  v2PrecedentSearchResponseSchema,
} from "../../../../contracts/v2/precedent-research";
import { readCustomerConsentSnapshot } from "../../../auth/account-type";
import { aliveWorkspace, readSnapshot, type V2Core } from "../../../db/v2-core";
import {
  createV2OfficialSourceRepository,
  decodeSource,
  type SourceRow,
} from "../../../db/v2-official-sources";
import {
  reportLegalOutcome,
  reportLegalRejection,
  reportLegalRequest,
} from "../../../dependency-diagnostics";
import { textHash } from "../service";
import { EXTRACTOR_VERSION, MAX_SOURCE_BYTES } from "../v2/contracts";
import { OFFICIAL_CATALOG } from "../v2/registry";
import { createV2LegalRetrieval } from "../v2/service";
import { makeChunk } from "../v2/source";
import { NO_NEWER_CONFLICTING_SOURCE_SQL } from "../v2/source-authority";
import type { Transport } from "../v2/transport";
import { isWorkspacePublicQuery } from "../v2/workspace-plans";
import { signResearchToken, verifyResearchToken } from "./tokens";
import { RESEARCH_CONCEPTS, recommendPrecedentTopics, researchExcerpt } from "./topics";

export class PrecedentResearchError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "CONSENT_REQUIRED"
      | "REVIEW_REQUIRED"
      | "CONFLICT"
      | "UNAVAILABLE",
  ) {
    super(code);
  }
}
type Scope = {
  workspaceRevision: number;
  confirmedSummaryRevision: number | null;
  status: string;
  intakeStatus: string;
  intakeConfirmed: number | null;
  summaryRevision: number | null;
  snapshotId: string | null;
};
// Respect a later limited observation already recorded by ordinary citations.
// Alias s is the current public original, as in source-authority.ts.
const NOT_LIMITED_SQL = `NOT EXISTS(SELECT 1 FROM v2_citation_bindings b
 JOIN v2_official_sources old ON old.source_id=b.source_id
 WHERE old.source_type=s.source_type AND old.official_id=s.official_id
 AND old.version=s.version AND old.section=s.section AND old.extractor_version=s.extractor_version
 AND json_extract(b.citation_json,'$._availability')='limited'
 AND json_extract(b.citation_json,'$._limitedAt')>=s.verified_at)`;
export function createPrecedentResearchService(
  core: V2Core,
  env: Pick<Env, "LAW_API_OC" | "BETTER_AUTH_SECRET">,
  options: { clock?: () => string; transport?: Transport } = {},
) {
  const now = () => (options.clock ?? (() => new Date().toISOString()))();
  async function scope(ownerId: string, id: string, revision?: number, summaryRevision?: number) {
    opaqueIdSchema.parse(id);
    opaqueIdSchema.parse(ownerId);
    const access = await readCustomerConsentSnapshot(core.binding, ownerId);
    if (access.accountType !== "customer") throw new PrecedentResearchError("NOT_FOUND");
    if (!access.currentConsent) throw new PrecedentResearchError("CONSENT_REQUIRED");
    const row = await core
      .statement(
        `SELECT w.revision AS workspaceRevision,w.confirmed_summary_revision AS confirmedSummaryRevision,w.status,
       i.status AS intakeStatus,i.confirmed_summary_revision AS intakeConfirmed,s.revision AS summaryRevision,s.snapshot_id AS snapshotId
       FROM v2_workspaces w LEFT JOIN v2_intakes i ON i.id=w.id LEFT JOIN v2_summaries s ON s.id=i.summary_id AND s.workspace_id=w.id
       WHERE w.id=? AND w.owner_id=? AND ${aliveWorkspace}`,
        [id, ownerId],
      )
      .first<Scope>();
    if (!row) throw new PrecedentResearchError("NOT_FOUND");
    if (revision !== undefined && row.workspaceRevision !== revision)
      throw new PrecedentResearchError("CONFLICT");
    if (
      row.status !== "active" ||
      row.intakeStatus !== "confirmed" ||
      !row.snapshotId ||
      !row.summaryRevision ||
      row.confirmedSummaryRevision !== row.summaryRevision ||
      row.intakeConfirmed !== row.summaryRevision
    )
      throw new PrecedentResearchError("REVIEW_REQUIRED");
    if (summaryRevision !== undefined && row.summaryRevision !== summaryRevision)
      throw new PrecedentResearchError("CONFLICT");
    return { ...row, summaryRevision: row.summaryRevision, snapshotId: row.snapshotId };
  }
  async function readOriginal(
    ownerId: string,
    id: string,
    raw: unknown,
    executionRevision?: number,
  ) {
    const request = v2PrecedentReadRequestSchema.parse(raw);
    await scope(ownerId, id, executionRevision ?? request.expectedRevision);
    const currentTime = now();
    const proof = await verifyResearchToken(
      env.BETTER_AUTH_SECRET,
      request.readToken,
      Date.parse(currentTime),
    );
    if (
      !proof ||
      proof.ownerId !== ownerId ||
      proof.workspaceId !== id ||
      proof.revision !== request.expectedRevision
    )
      throw new PrecedentResearchError("NOT_FOUND");
    const load = () =>
      core
        .statement(
          `SELECT s.* FROM v2_official_sources s WHERE s.source_id=? AND s.source_type='precedent' AND s.extractor_version=?
        AND s.fetched_at<=? AND s.verified_at<=? AND s.expires_at>? AND length(CAST(s.body AS BLOB))<=? AND ${NO_NEWER_CONFLICTING_SOURCE_SQL} AND ${NOT_LIMITED_SQL}`,
          [
            proof.sourceId,
            EXTRACTOR_VERSION,
            currentTime,
            currentTime,
            currentTime,
            MAX_SOURCE_BYTES,
          ],
        )
        .first<SourceRow>();
    const row = await load();
    if (!row) throw new PrecedentResearchError("NOT_FOUND");
    const source = decodeSource(row);
    const rebuilt = await makeChunk(
      source,
      new Date(Date.parse(currentTime) + 9 * 3600000).toISOString().slice(0, 10),
    );
    const citation = { ...rebuilt.citation, id: proof.citationId, verifiedAt: proof.verifiedAt };
    if (
      rebuilt.source.sourceId !== source.sourceId ||
      rebuilt.source.contentHash !== source.contentHash ||
      rebuilt.source.expiresAt !== source.expiresAt ||
      source.rightsProvenance !== OFFICIAL_CATALOG[1].rights ||
      source.verifiedAt !== proof.verifiedAt ||
      (await textHash(JSON.stringify(citation))) !== proof.citationHash
    )
      throw new PrecedentResearchError("NOT_FOUND");
    const response = v2PrecedentReadResponseSchema.parse({
      schemaVersion: "2",
      workspaceRevision: request.expectedRevision,
      citation,
      excerpt: researchExcerpt(source.body, [], 4000),
    });
    // Source hashing yields: fence the exact current original and case again.
    if (JSON.stringify(await load()) !== JSON.stringify(row))
      throw new PrecedentResearchError("NOT_FOUND");
    await scope(ownerId, id, executionRevision ?? request.expectedRevision);
    if (proof.expiresAt <= Date.parse(now()) || Date.parse(source.expiresAt) <= Date.parse(now()))
      throw new PrecedentResearchError("NOT_FOUND");
    return response;
  }
  return {
    async context(ownerId: string, id: string) {
      const current = await scope(ownerId, id);
      const summary = await readSnapshot(
        core,
        { ownerId, now: now() },
        current.snapshotId,
        "summary",
        id,
        current.summaryRevision,
        v2SummarySchema,
      );
      if (!summary) throw new PrecedentResearchError("REVIEW_REQUIRED");
      const value = v2PrecedentResearchContextSchema.parse({
        schemaVersion: "2",
        workspaceRevision: current.workspaceRevision,
        summaryRevision: current.summaryRevision,
        caseTitle: summary.overview.slice(0, 80),
        recommendedTopics: recommendPrecedentTopics(summary),
      });
      await scope(ownerId, id, current.workspaceRevision, current.summaryRevision);
      return value;
    },
    async search(ownerId: string, id: string, raw: unknown, signal?: AbortSignal) {
      const request = v2PrecedentSearchRequestSchema.parse(raw);
      await scope(ownerId, id, request.expectedRevision, request.summaryRevision);
      if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32)
        throw new PrecedentResearchError("UNAVAILABLE");
      const checkedAt = now();
      const authorized = async () => {
        try {
          await scope(ownerId, id, request.expectedRevision, request.summaryRevision);
          return true;
        } catch {
          return false;
        }
      };
      const queries = request.topics.map((topic) => RESEARCH_CONCEPTS[topic]);
      const repository = createV2OfficialSourceRepository(core);
      const retrieval = createV2LegalRetrieval(env, repository, {
        observeRequest: reportLegalRequest,
        observeOutcome: reportLegalOutcome,
        observeUpstreamRejection: reportLegalRejection,
        ...(options.transport ? { transport: options.transport } : {}),
        // Research is read-only for private case state. The short-lived signed
        // result proof below supplies scope; do not add automatic chat citations.
        bindCitation: async (citation) =>
          (await authorized()) &&
          !!(await core
            .statement(
              `SELECT 1 FROM v2_official_sources s WHERE s.source_id=? AND ${NOT_LIMITED_SQL} AND ${NO_NEWER_CONFLICTING_SOURCE_SQL}`,
              [citation.sourceId],
            )
            .first()),
      });
      let attempts = 0;
      const deadline = AbortSignal.timeout(120000);
      const result = await retrieval.retrieve(
        {
          now: checkedAt,
          asOfDate: new Date(Date.parse(checkedAt) + 9 * 3600000).toISOString().slice(0, 10),
          plans: queries.map((query) => ({ kind: "precedent", query, limit: 3 })),
        },
        {
          authorize: authorized,
          authorizeQuery: async (query) =>
            queries.includes(query) && isWorkspacePublicQuery(query) && (await authorized()),
          reserveRequest: async () => ++attempts <= 12 && (await authorized()),
          signal: signal ? AbortSignal.any([deadline, signal]) : deadline,
        },
      );
      const items = new Map<string, V2PrecedentSearchResponse["items"][number]>();
      const unavailableTopics: V2PrecedentTopic[] = [];
      const availabilityIssues: NonNullable<V2PrecedentSearchResponse["availabilityIssues"]> = [];
      for (const [index, outcome] of result.outcomes.entries()) {
        const topic = request.topics[index];
        if (!topic) continue;
        const reasons = [
          ...new Set([
            ...(outcome.reason && outcome.reason !== "no_results" ? [outcome.reason] : []),
            ...(outcome.sourceFailures ?? []),
          ]),
        ];
        for (const reason of reasons) availabilityIssues.push({ topic, reason });
        if (reasons.length) unavailableTopics.push(topic);
        if (outcome.availability !== "verified") {
          if (outcome.reason !== "no_results" && !unavailableTopics.includes(topic))
            unavailableTopics.push(topic);
          continue;
        }
        for (const chunk of outcome.chunks) {
          const citation = chunk.citation;
          if (citation.kind !== "precedent") continue;
          const prior = items.get(citation.sourceId);
          if (prior) {
            if (!prior.matchedTopics.includes(topic)) prior.matchedTopics.push(topic);
            continue;
          }
          const issuedAt = Date.parse(checkedAt);
          const readToken = await signResearchToken(env.BETTER_AUTH_SECRET, {
            ownerId,
            workspaceId: id,
            revision: request.expectedRevision,
            sourceId: citation.sourceId,
            citationId: citation.id,
            verifiedAt: citation.verifiedAt,
            citationHash: await textHash(JSON.stringify(citation)),
            issuedAt,
            expiresAt: issuedAt + 600000,
          });
          items.set(citation.sourceId, {
            id: citation.id,
            citation,
            matchedTopics: [topic],
            excerpt: researchExcerpt(chunk.source.body, [RESEARCH_CONCEPTS[topic]]),
            readToken,
          });
        }
      }
      const response = v2PrecedentSearchResponseSchema.parse({
        schemaVersion: "2",
        workspaceRevision: request.expectedRevision,
        summaryRevision: request.summaryRevision,
        checkedAt,
        topics: request.topics,
        status: items.size
          ? unavailableTopics.length
            ? "partial"
            : "complete"
          : unavailableTopics.length
            ? "unavailable"
            : "empty",
        searchTruncated: result.outcomes.some((o) => o.searchTruncated),
        items: [...items.values()],
        unavailableTopics,
        availabilityIssues,
      });
      if (signal?.aborted || deadline.aborted) throw new PrecedentResearchError("UNAVAILABLE");
      await scope(ownerId, id, request.expectedRevision, request.summaryRevision);
      return response;
    },
    read: (ownerId: string, id: string, raw: unknown) => readOriginal(ownerId, id, raw),
    async readForExecution(ownerId: string, id: string, raw: unknown, executionRevision: number) {
      const request = v2PrecedentComparisonRequestSchema.parse(raw);
      if (executionRevision !== request.expectedRevision + 1)
        throw new PrecedentResearchError("CONFLICT");
      await scope(ownerId, id, executionRevision, request.summaryRevision);
      const value = await readOriginal(
        ownerId,
        id,
        { expectedRevision: request.expectedRevision, readToken: request.readToken },
        executionRevision,
      );
      await scope(ownerId, id, executionRevision, request.summaryRevision);
      return value;
    },
  };
}
