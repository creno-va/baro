import { z } from "zod";
import type { V2OfficialCitation } from "../../../../contracts/v2";
import type {
  createV2OfficialSourceRepository,
  OfficialSourceIdentity,
} from "../../../db/v2-official-sources";
import type { LegalOutcomeObservation } from "../diagnostics";
import { type LegalUpstreamRejection, textHash, upstreamError } from "../service";
import {
  type Access,
  EXTRACTOR_VERSION,
  type FailureReason,
  MAX_RESPONSE_BYTES,
  RetrievalFailure,
  type RetrievalOutput,
  requestSchema,
  type SourceChunk,
  type SourceOutcome,
  safePermit,
} from "./contracts";
import { parseGuide } from "./guides";
import { parsePrecedent, type PrecedentCandidate, precedentCandidates } from "./precedents";
import { assertCanonicalUrl, guideUrl, OFFICIAL_CATALOG } from "./registry";
import { safeLegalSchemaDiagnostic } from "./schema-diagnostics";
import { makeChunk } from "./source";
import { type LawCandidate, parseStatute, selectStatuteHistory } from "./statutes";
import { createBoundedTransport, type LegalRequestObservation, type Transport } from "./transport";

type Repo = ReturnType<typeof createV2OfficialSourceRepository>;
export type UpstreamRejectionObservation = {
  endpointId: "moleg_eflaw_list" | "moleg_eflaw_detail" | "moleg_prec_list" | "moleg_prec_detail";
  category: LegalUpstreamRejection;
};
export function createV2LegalRetrieval(
  env: Pick<Env, "LAW_API_OC">,
  repo: Repo,
  options: {
    transport?: Transport;
    timeoutMs?: number;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
    bindCitation: (citation: V2OfficialCitation) => Promise<boolean>;
    observeUpstreamRejection?: (observation: UpstreamRejectionObservation) => void | Promise<void>;
    observeRequest?: (observation: LegalRequestObservation) => void | Promise<void>;
    observeOutcome?: (observation: LegalOutcomeObservation) => void | Promise<void>;
    /** Server-only research ranking. Never supplied by a model or wire request. */
    precedentDiscovery?: {
      rank: (rows: readonly PrecedentCandidate[], query: string) => readonly string[];
    };
  },
) {
  const request = createBoundedTransport(options.transport, {
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
    ...(options.observeRequest ? { observeRequest: options.observeRequest } : {}),
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
  async function json(
    url: URL,
    endpointId: UpstreamRejectionObservation["endpointId"],
    access: Access,
  ) {
    const raw = await request(url, endpointId, access);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new RetrievalFailure("schema_mismatch", {
        stage: "response_json",
        issues: [{ field: "response", expected: "json" }],
      });
    }
    if (value && typeof value === "object" && ("result" in value || "msg" in value)) {
      // Optional tooling diagnostics contain finite labels only. Observer failure
      // must not change the public reason, request budget, or retry behavior.
      try {
        if (options.observeUpstreamRejection)
          void Promise.resolve(
            options.observeUpstreamRejection({
              endpointId,
              category: upstreamError(value) ?? "upstream-error",
            }),
          ).catch(() => undefined);
      } catch {
        // Keep the original upstream rejection even if the observer throws.
      }
      throw new RetrievalFailure("upstream_rejected");
    }
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
      const durations: number[] = [];
      let totalBytes = 0,
        calls = 0;
      // Every external attempt (including retries) has a unique invocation/attempt
      // reservation. A bounded operation never creates invisible unlimited calls.
      const boundedAccess: Access = {
        ...access,
        reserveRequest: async (attempt) => ++calls <= 30 && access.reserveRequest(attempt),
      };
      // Verified statute candidates are scoped to this invocation's fixed dates.
      // Failures are never memoized; fresh cache discovery/hash checks still run.
      const candidates = new Map<string, LawCandidate>();
      async function selectedStatute(
        plan: Extract<(typeof body.plans)[number], { kind: "statute" }>,
      ) {
        const url = lawUrl("lawSearch.do", "eflaw", {
          query: plan.lawTitle,
          ...(plan.lawId ? { LID: plan.lawId } : {}),
          nw: "1,3",
          sort: "efdes",
          display: "100",
          page: "1",
          efYd: `00010101~${body.asOfDate.replaceAll("-", "")}`,
        });
        const key = url.href;
        const cached = candidates.get(key);
        if (cached) {
          if (access.signal?.aborted) throw new RetrievalFailure("cancelled");
          if (!(await safePermit(access.authorize))) throw new RetrievalFailure("not_authorized");
          if (access.signal?.aborted) throw new RetrievalFailure("cancelled");
          return cached;
        }
        const candidate = await selectStatuteHistory(
          await json(url, "moleg_eflaw_list", boundedAccess),
          async (page) => {
            const next = new URL(url);
            next.searchParams.set("page", String(page));
            return json(next, "moleg_eflaw_list", boundedAccess);
          },
          plan,
          body.asOfDate,
          new Date(Date.parse(body.now) + 9 * 3600000).toISOString().slice(0, 10),
        );
        candidates.set(key, candidate);
        return candidate;
      }
      for (const plan of body.plans) {
        const started = performance.now();
        const verified: SourceChunk[] = [];
        const limited: SourceChunk[] = [];
        const failures: FailureReason[] = [];
        let searchTruncated: boolean | undefined;
        let schemaFailure: SourceOutcome["schemaFailure"];
        const failureReason = (error: unknown): FailureReason =>
          error instanceof RetrievalFailure
            ? error.reason
            : error instanceof z.ZodError
              ? "schema_mismatch"
              : "upstream_unavailable";
        // Validate, persist and bind each original independently. A later failed
        // original cannot demote an earlier verified original to a limited source.
        const collect = async (
          work: () => Promise<{ chunk: SourceChunk; reason?: FailureReason | null }>,
        ) => {
          try {
            const { chunk, reason = null } = await work();
            totalBytes += new TextEncoder().encode(chunk.source.body).byteLength;
            if (totalBytes > MAX_RESPONSE_BYTES) throw new RetrievalFailure("too_large");
            if (!(await safePermit(access.authorize)) || access.signal?.aborted)
              throw new RetrievalFailure(access.signal?.aborted ? "cancelled" : "not_authorized");
            if (
              !(await repo.put(
                chunk.source,
                chunk.citation,
                reason === null ? "verified" : "limited",
              ))
            )
              throw new RetrievalFailure("cache_invalid");
            if (!(await safePermit(access.authorize)) || access.signal?.aborted)
              throw new RetrievalFailure(access.signal?.aborted ? "cancelled" : "not_authorized");
            if (reason === null && !(await options.bindCitation(chunk.citation)))
              throw new RetrievalFailure("not_authorized");
            if (reason === null) verified.push(chunk);
            else {
              limited.push(chunk);
              failures.push(reason);
            }
          } catch (error) {
            const reason = failureReason(error);
            if (reason === "not_authorized" || reason === "cancelled")
              throw new RetrievalFailure(reason);
            failures.push(reason);
            if (error instanceof RetrievalFailure && reason === "schema_mismatch")
              schemaFailure ??= safeLegalSchemaDiagnostic(error.schemaFailure);
          }
        };
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
            const candidate = await selectedStatute(plan);
            for (const article of plan.articles)
              await collect(async () => {
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
                return {
                  chunk:
                    cached ??
                    (await parseStatute(
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
                    )),
                };
              });
          } else if (plan.kind === "precedent") {
            // Research considers a wider title-first pool before spending any
            // detail requests. Ordinary chat retrieval keeps its original scope.
            // Official scope/display parameters: open.law.go.kr/LSO/openApi/guideResult.do?htmlName=precListGuide
            const discover = async (search: "1" | "2") =>
              precedentCandidates(
                await json(
                  lawUrl("lawSearch.do", "prec", {
                    query: plan.query,
                    search,
                    datSrcNm: "대법원",
                    display: String(options.precedentDiscovery ? 40 : plan.limit),
                    page: "1",
                    sort: "ddes",
                    prncYd: `00010101~${body.asOfDate.replaceAll("-", "")}`,
                  }),
                  "moleg_prec_list",
                  boundedAccess,
                ),
                body.asOfDate,
                options.precedentDiscovery ? 40 : plan.limit,
              );
            let candidates = await discover(options.precedentDiscovery ? "1" : "2");
            if (
              options.precedentDiscovery &&
              !candidates.rows.length &&
              !candidates.failures?.length
            )
              candidates = await discover("2");
            if (!candidates.rows.length)
              throw new RetrievalFailure(candidates.failures?.[0] ?? "no_results");
            const ranked = options.precedentDiscovery?.rank(candidates.rows, plan.query);
            // Resolve IDs back to the validated upstream rows. A ranking hook
            // cannot forge a candidate's identity or proof metadata.
            const byId = new Map(candidates.rows.map((row) => [row.판례일련번호, row]));
            const selected = ranked
              ? [...new Set(ranked)]
                  .flatMap((id) => {
                    const row = byId.get(id);
                    return row ? [row] : [];
                  })
                  .slice(0, plan.limit)
              : candidates.rows;
            searchTruncated = candidates.truncated || candidates.rows.length > selected.length;
            failures.push(...(candidates.failures ?? []));
            for (const candidate of selected)
              await collect(async () => {
                if (candidate.데이터출처명 === "국세법령정보시스템")
                  throw new RetrievalFailure("unsupported_format");
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
                if (cached) return { chunk: cached };
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
                return { chunk: result.chunk, reason: result.full ? null : "unsupported_format" };
              });
          } else
            await collect(async () =>
              parseGuide(
                await request(guideUrl(plan), "easylaw_text_section", boundedAccess, true),
                plan,
                body.asOfDate,
                body.now,
              ),
            );
          const chunks = verified.length ? verified : limited;
          const reason = verified.length ? null : (failures[0] ?? "no_results");
          outcomes.push({
            kind: plan.kind,
            availability: verified.length ? "verified" : limited.length ? "limited" : "unavailable",
            reason,
            chunks,
            ...(searchTruncated === undefined ? {} : { searchTruncated }),
            ...(failures.length ? { sourceFailures: [...new Set(failures)] } : {}),
            ...(schemaFailure ? { schemaFailure } : {}),
          });
        } catch (error) {
          const failure = failureReason(error);
          const diagnostic =
            error instanceof RetrievalFailure && failure === "schema_mismatch"
              ? safeLegalSchemaDiagnostic(error.schemaFailure)
              : undefined;
          outcomes.push({
            kind: plan.kind,
            availability: "unavailable",
            reason: failure,
            chunks: [],
            ...(diagnostic ? { schemaFailure: diagnostic } : {}),
          });
        }
        durations.push(Math.max(0, Math.round(performance.now() - started)));
      }
      let chunks = [
        ...new Map(
          outcomes
            .flatMap((outcome) => outcome.chunks)
            .map((chunk) => [chunk.citation.sourceId, chunk]),
        ).values(),
      ];
      let retrievalHash = await textHash(JSON.stringify(chunks.map((c) => c.citation.sourceId)));
      const emptyHash = await textHash("[]");
      // No await may follow this guard: hashing also yields to revocation/cancellation.
      if (!(await safePermit(access.authorize)) || access.signal?.aborted) {
        for (const outcome of outcomes) {
          outcome.availability = "unavailable";
          outcome.reason = access.signal?.aborted ? "cancelled" : "not_authorized";
          outcome.chunks = [];
        }
        chunks = [];
        retrievalHash = emptyHash;
      }
      // Emit only finite metadata after the final authorization fence.
      for (const [index, outcome] of outcomes.entries()) {
        try {
          if (options.observeOutcome)
            void Promise.resolve(
              options.observeOutcome({
                kind: outcome.kind,
                availability: outcome.availability,
                reason: outcome.reason,
                sourceFailures: [...(outcome.sourceFailures ?? [])],
                verifiedSourceCount:
                  outcome.availability === "verified" ? outcome.chunks.length : 0,
                durationMs: durations[index] ?? 0,
              }),
            ).catch(() => undefined);
        } catch {
          /* Diagnostics never change source acceptance. */
        }
      }
      return {
        schemaVersion: "2",
        asOfDate: body.asOfDate,
        outcomes,
        chunks,
        retrievalHash,
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
