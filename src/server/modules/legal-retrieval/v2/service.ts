import { z } from "zod";
import type { V2OfficialCitation } from "../../../../contracts/v2";
import type {
  createV2OfficialSourceRepository,
  OfficialSourceIdentity,
} from "../../../db/v2-official-sources";
import { textHash } from "../service";
import {
  type Access,
  EXTRACTOR_VERSION,
  MAX_RESPONSE_BYTES,
  RetrievalFailure,
  type RetrievalOutput,
  requestSchema,
  type SourceChunk,
  type SourceOutcome,
  safePermit,
} from "./contracts";
import { parseGuide } from "./guides";
import { parsePrecedent, precedentCandidates } from "./precedents";
import { assertCanonicalUrl, guideUrl, OFFICIAL_CATALOG } from "./registry";
import { makeChunk } from "./source";
import { parseStatute, selectStatute } from "./statutes";
import { createBoundedTransport, type Transport } from "./transport";

type Repo = ReturnType<typeof createV2OfficialSourceRepository>;
export function createV2LegalRetrieval(
  env: Pick<Env, "LAW_API_OC">,
  repo: Repo,
  options: {
    transport?: Transport;
    timeoutMs?: number;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
    bindCitation: (citation: V2OfficialCitation) => Promise<boolean>;
  },
) {
  const request = createBoundedTransport(options.transport, {
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
  });
  function lawUrl(
    path: "lawSearch.do" | "lawService.do",
    target: "eflaw" | "prec",
    params: Record<string, string>,
  ) {
    if (!env.LAW_API_OC) throw new RetrievalFailure("configuration_missing");
    const url = new URL(`https://www.law.go.kr/DRF/${path}`);
    url.search = new URLSearchParams({
      OC: env.LAW_API_OC,
      target,
      type: "JSON",
      ...params,
    }).toString();
    return url;
  }
  async function json(url: URL, endpointId: string, access: Access) {
    const raw = await request(url, endpointId, access);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new RetrievalFailure("schema_mismatch");
    }
    if (value && typeof value === "object" && ("result" in value || "msg" in value))
      throw new RetrievalFailure("upstream_rejected");
    return value;
  }
  async function cachedChunk(
    identity: Omit<OfficialSourceIdentity, "extractorVersion">,
    expected: {
      canonicalUrl: string;
      title: string;
      court: string | null;
      caseNumber: string | null;
      sourceDate?: string;
      rightsProvenance: string;
    },
    now: string,
    asOfDate: string,
  ): Promise<SourceChunk | null> {
    // Identity comes only from the validated official list, never a model URL,
    // private query, user source ID/hash, or an unverified previous citation.
    const source = await repo.findLatestByIdentity(
      { ...identity, extractorVersion: EXTRACTOR_VERSION },
      now,
    );
    if (!source) return null;
    if (
      source.sourceType !== identity.sourceType ||
      source.officialId !== identity.officialId ||
      source.version !== identity.version ||
      source.section !== identity.section ||
      source.extractorVersion !== EXTRACTOR_VERSION ||
      !assertCanonicalUrl(source.canonicalUrl, expected.canonicalUrl) ||
      source.title !== expected.title ||
      source.court !== expected.court ||
      source.caseNumber !== expected.caseNumber ||
      source.institutionId !== null ||
      source.endpointId !== null ||
      source.rightsProvenance !== expected.rightsProvenance ||
      source.sourceDate === null ||
      source.sourceDate > asOfDate ||
      (expected.sourceDate !== undefined && source.sourceDate !== expected.sourceDate)
    )
      throw new RetrievalFailure("cache_invalid");
    try {
      const chunk = await makeChunk(source, asOfDate);
      if (
        chunk.citation.sourceId !== source.sourceId ||
        chunk.citation.contentHash !== source.contentHash
      )
        throw new RetrievalFailure("cache_invalid");
      return { ...chunk, source };
    } catch {
      throw new RetrievalFailure("cache_invalid");
    }
  }
  return {
    async retrieve(input: unknown, access: Access): Promise<RetrievalOutput> {
      const parsed = requestSchema.safeParse(input);
      if (!parsed.success) throw new RetrievalFailure("schema_mismatch");
      const body = parsed.data,
        outcomes: SourceOutcome[] = [];
      let totalBytes = 0,
        calls = 0;
      // Every external attempt (including retries) has a unique invocation/attempt
      // reservation. A bounded operation never creates invisible unlimited calls.
      const boundedAccess: Access = {
        ...access,
        reserveRequest: async (attempt) => ++calls <= 30 && access.reserveRequest(attempt),
      };
      for (const plan of body.plans) {
        const chunks: SourceChunk[] = [];
        let reason: SourceOutcome["reason"] = null;
        try {
          if (!(await safePermit(access.authorize))) throw new RetrievalFailure("not_authorized");
          if (
            plan.kind !== "official_guide" &&
            !(await safePermit(() =>
              access.authorizeQuery(plan.kind === "statute" ? plan.lawTitle : plan.query),
            ))
          )
            throw new RetrievalFailure("not_authorized");
          if (access.signal?.aborted) throw new RetrievalFailure("cancelled");
          if (plan.kind === "statute") {
            const candidate = selectStatute(
              await json(
                lawUrl("lawSearch.do", "eflaw", {
                  query: plan.lawTitle,
                  ...(plan.lawId ? { LID: plan.lawId } : {}),
                  nw: "1,3",
                  sort: "efdes",
                  display: "100",
                  page: "1",
                  efYd: `00010101~${body.asOfDate.replaceAll("-", "")}`,
                }),
                "moleg_eflaw_list",
                boundedAccess,
              ),
              plan,
              body.asOfDate,
            );
            for (const article of plan.articles) {
              const section = `제${BigInt(article.number)}조${BigInt(article.branch) !== 0n ? `의${BigInt(article.branch)}` : ""}`;
              const cached = await cachedChunk(
                {
                  sourceType: "statute",
                  officialId: candidate.법령ID,
                  version: candidate.법령일련번호,
                  section,
                },
                {
                  canonicalUrl: `https://law.go.kr/LSW/lsInfoP.do?lsiSeq=${candidate.법령일련번호}`,
                  title: candidate.법령명한글,
                  court: null,
                  caseNumber: null,
                  rightsProvenance: OFFICIAL_CATALOG[0].rights,
                },
                body.now,
                body.asOfDate,
              );
              if (cached) chunks.push(cached);
              else
                chunks.push(
                  await parseStatute(
                    await json(
                      lawUrl("lawService.do", "eflaw", {
                        MST: candidate.법령일련번호,
                        efYd: candidate.시행일자.replaceAll("-", ""),
                        JO: `${article.number.padStart(4, "0")}${article.branch.padStart(2, "0")}`,
                      }),
                      "moleg_eflaw_detail",
                      boundedAccess,
                    ),
                    candidate,
                    article,
                    body.asOfDate,
                    body.now,
                  ),
                );
            }
          } else if (plan.kind === "precedent") {
            const candidates = precedentCandidates(
              await json(
                lawUrl("lawSearch.do", "prec", {
                  query: plan.query,
                  search: "2",
                  display: String(plan.limit),
                  page: "1",
                  sort: "ddes",
                  prncYd: `00010101~${body.asOfDate.replaceAll("-", "")}`,
                }),
                "moleg_prec_list",
                boundedAccess,
              ),
              body.asOfDate,
              plan.limit,
            );
            if (!candidates.rows.length) throw new RetrievalFailure("no_results");
            if (candidates.truncated) reason = "history_incomplete";
            for (const candidate of candidates.rows) {
              if (candidate.데이터출처명 === "국세법령정보시스템") {
                reason = "unsupported_format";
                continue;
              }
              const cached = await cachedChunk(
                {
                  sourceType: "precedent",
                  officialId: candidate.판례일련번호,
                  version: `decision_${candidate.선고일자}`,
                  section: "판례내용",
                },
                {
                  canonicalUrl: `https://www.law.go.kr/LSW/precInfoP.do?precSeq=${candidate.판례일련번호}`,
                  title: candidate.사건명,
                  sourceDate: candidate.선고일자,
                  court: candidate.법원명,
                  caseNumber: candidate.사건번호,
                  rightsProvenance: OFFICIAL_CATALOG[1].rights,
                },
                body.now,
                body.asOfDate,
              );
              if (cached) {
                chunks.push(cached);
                continue;
              }
              const result = await parsePrecedent(
                await json(
                  lawUrl("lawService.do", "prec", { ID: candidate.판례일련번호 }),
                  "moleg_prec_detail",
                  boundedAccess,
                ),
                candidate,
                body.asOfDate,
                body.now,
              );
              if (!result.full) reason = "unsupported_format";
              chunks.push(result.chunk);
            }
          } else {
            const parsed = await parseGuide(
              await request(guideUrl(plan), "easylaw_text_section", boundedAccess, true),
              plan,
              body.asOfDate,
              body.now,
            );
            chunks.push(parsed.chunk);
            reason = parsed.reason;
          }
          for (const chunk of chunks) {
            totalBytes += new TextEncoder().encode(chunk.source.body).byteLength;
            if (totalBytes > MAX_RESPONSE_BYTES) throw new RetrievalFailure("too_large");
            if (!(await safePermit(access.authorize)) || access.signal?.aborted)
              throw new RetrievalFailure(access.signal?.aborted ? "cancelled" : "not_authorized");
            if (!(await repo.put(chunk.source, chunk.citation)))
              throw new RetrievalFailure("cache_invalid");
            if (!(await safePermit(access.authorize)) || access.signal?.aborted)
              throw new RetrievalFailure(access.signal?.aborted ? "cancelled" : "not_authorized");
            if (!(await options.bindCitation(chunk.citation)))
              throw new RetrievalFailure("not_authorized");
          }
          outcomes.push({
            kind: plan.kind,
            availability: chunks.length ? (reason ? "limited" : "verified") : "unavailable",
            reason,
            chunks,
          });
        } catch (error) {
          const failure =
            error instanceof RetrievalFailure
              ? error.reason
              : error instanceof z.ZodError
                ? "schema_mismatch"
                : "upstream_unavailable";
          outcomes.push({
            kind: plan.kind,
            availability: "unavailable",
            reason: failure,
            chunks: [],
          });
        }
      }
      // Deletion/consent/revision changes must never release preflight source data.
      if (!(await safePermit(access.authorize)) || access.signal?.aborted)
        for (const outcome of outcomes) {
          outcome.availability = "unavailable";
          outcome.reason = access.signal?.aborted ? "cancelled" : "not_authorized";
          outcome.chunks = [];
        }
      const chunks = [
        ...new Map(
          outcomes
            .flatMap((outcome) => outcome.chunks)
            .map((chunk) => [chunk.citation.sourceId, chunk]),
        ).values(),
      ];
      return {
        schemaVersion: "2",
        asOfDate: body.asOfDate,
        outcomes,
        chunks,
        retrievalHash: await textHash(JSON.stringify(chunks.map((c) => c.citation.sourceId))),
        legalSourceStatus: outcomes.some((o) => o.availability === "verified")
          ? "verified"
          : body.plans.length
            ? "unavailable"
            : "not_requested",
        factualPreparationAvailable: true,
      };
    },
  };
}
