import type { OfficialSourceWrite } from "../src/server/db/v2-official-sources";
import { validateV2Claims } from "../src/server/modules/citation/v2-validate";
import {
  type RetrievalPlan,
  requestSchema,
} from "../src/server/modules/legal-retrieval/v2/contracts";
import { safeLegalSchemaDiagnostic } from "../src/server/modules/legal-retrieval/v2/schema-diagnostics";
import {
  createV2LegalRetrieval,
  type UpstreamRejectionObservation,
} from "../src/server/modules/legal-retrieval/v2/service";
import type { Transport } from "../src/server/modules/legal-retrieval/v2/transport";
import {
  isWorkspacePublicQuery,
  workspaceGuidePlans,
} from "../src/server/modules/legal-retrieval/v2/workspace-plans";
import { sourceExcerpt } from "../src/server/modules/legal-retrieval/v2/workspace-sources";

export const readinessV2Plans: RetrievalPlan[] = [
  { kind: "statute", lawTitle: "민법", articles: [{ number: "598", branch: "0" }] },
  // The product selects the documented court corpus. Two bounded originals,
  // not exhaustive case-law coverage; retain the nine-reservation cap.
  { kind: "precedent", query: "대여금", limit: 2 },
  workspaceGuidePlans.legal_consultation,
];

/** Fixed public diagnostic only; callers cannot supply case text or arbitrary URLs. */
export function legalReadinessScope(scope: string = "standard") {
  if (scope === "standard") return { scope, plans: readinessV2Plans };
  if (scope === "core_sources")
    return { scope, plans: readinessV2Plans.filter((plan) => plan.kind !== "official_guide") };
  if (scope === "statute_matrix")
    return {
      scope,
      plans: [
        { kind: "statute", lawTitle: "형법", articles: [{ number: "347", branch: "0" }] },
        { kind: "statute", lawTitle: "근로기준법", articles: [{ number: "23", branch: "0" }] },
        { kind: "statute", lawTitle: "개인정보 보호법", articles: [{ number: "15", branch: "0" }] },
      ] satisfies RetrievalPlan[],
    };
  if (scope === "precedent_matrix")
    return {
      scope,
      plans: ["임대차", "임금", "손해배상"].map((query) => ({
        kind: "precedent",
        query,
        limit: 1,
      })) satisfies RetrievalPlan[],
    };
  if (scope === "housing_article_3_2")
    return {
      scope,
      plans: [
        { kind: "statute", lawTitle: "주택임대차보호법", articles: [{ number: "3", branch: "2" }] },
      ] satisfies RetrievalPlan[],
    };
  throw new Error("INVALID_LEGAL_DIAGNOSTIC_SCOPE");
}

type RequestObservation = {
  endpoint:
    | "statute_list"
    | "statute_detail"
    | "precedent_list"
    | "precedent_detail"
    | "official_guide"
    | "other";
  httpStatus: number | null;
  contentType: "json" | "html" | "other" | "missing" | null;
  transport: "pending" | "response" | "failed";
  durationMs: number;
};

function requestEndpoint(value: string): RequestObservation["endpoint"] {
  const url = new URL(value);
  if (url.hostname === "www.easylaw.go.kr") return "official_guide";
  if (url.hostname !== "www.law.go.kr") return "other";
  const target = url.searchParams.get("target");
  if (url.pathname === "/DRF/lawSearch.do") {
    if (target === "eflaw") return "statute_list";
    if (target === "prec") return "precedent_list";
  }
  if (url.pathname === "/DRF/lawService.do") {
    if (target === "eflaw") return "statute_detail";
    if (target === "prec") return "precedent_detail";
  }
  return "other";
}

/** CI adapter evidence only. Original responses and credential URLs never enter the receipt. */
export async function inspectLegalV2(
  env: { LAW_API_OC?: string },
  now: string,
  options: { transport?: Transport; plans?: RetrievalPlan[] } = {},
) {
  const diagnosticStarted = performance.now();
  let requests = 0;
  let reservations = 0;
  const requestObservations: RequestObservation[] = [];
  const upstreamRejections: UpstreamRejectionObservation[] = [];
  const sources = new Map<string, OfficialSourceWrite>();
  const plans = options.plans ?? readinessV2Plans;
  const asOfDate = new Date(Date.parse(now) + 9 * 3600000).toISOString().slice(0, 10);
  requestSchema.parse({ now, asOfDate, plans });
  const service = createV2LegalRetrieval(
    { LAW_API_OC: env.LAW_API_OC ?? "" },
    {
      findLatestByIdentity: async () => null,
      find: async () => null,
      bindCitation: async () => false,
      put: async (source) => {
        sources.set(source.sourceId, source);
        return true;
      },
    },
    {
      transport: async (url, init) => {
        requests++;
        const observation: RequestObservation = {
          endpoint: requestEndpoint(url),
          httpStatus: null,
          contentType: null,
          transport: "pending",
          durationMs: 0,
        };
        requestObservations.push(observation);
        const started = performance.now();
        try {
          const response = await (options.transport ?? fetch)(url, init);
          const contentType = response.headers
            .get("content-type")
            ?.split(";")[0]
            ?.trim()
            .toLowerCase();
          observation.httpStatus = response.status;
          observation.contentType = !contentType
            ? "missing"
            : contentType === "application/json" || contentType === "text/json"
              ? "json"
              : contentType === "text/html"
                ? "html"
                : "other";
          observation.transport = "response";
          return response;
        } catch (error) {
          observation.transport = "failed";
          throw error;
        } finally {
          // Header/transport latency only; body parsing and integrity checks
          // are covered by the complete diagnostic duration below.
          observation.durationMs = Math.max(0, Math.round(performance.now() - started));
        }
      },
      bindCitation: async (citation) => sources.has(citation.sourceId),
      observeUpstreamRejection: ({ endpointId, category }) => {
        upstreamRejections.push({ endpointId, category });
      },
    },
  );
  const output = await service.retrieve(
    { now, asOfDate, plans },
    {
      authorize: async () => true,
      authorizeQuery: async (query) => isWorkspacePublicQuery(query),
      reserveRequest: async () => {
        if (reservations >= 9) return false;
        reservations++;
        return true;
      },
      signal: AbortSignal.timeout(120000),
    },
  );
  const verified = output.outcomes
    .filter((o) => o.availability === "verified")
    .flatMap((o) => o.chunks);
  const claims = verified.map((chunk, i) => ({
    id: `readiness_${i}`,
    kind: "quotation",
    text: sourceExcerpt(chunk.span.text, 1000).text,
    citationId: chunk.citation.id,
    startUtf16: 0,
    endUtf16: sourceExcerpt(chunk.span.text, 1000).endUtf16,
  }));
  // An empty claim set is valid to the validator but provides no readiness evidence.
  const claimCheck = claims.length
    ? await validateV2Claims(
        claims,
        verified.map((chunk) => chunk.citation),
        output,
      )
    : null;
  return {
    schemaVersion: "2" as const,
    runtimeWorker: false as const,
    checkedAt: now,
    durationMs: Math.max(0, Math.round(performance.now() - diagnosticStarted)),
    requests,
    reservations,
    // Snapshot only allowlisted metadata; never retain URL, headers, body or exception text.
    requestObservations: requestObservations.map((observation) => ({ ...observation })),
    upstreamRejections: upstreamRejections.map((observation) => ({ ...observation })),
    status:
      plans.length === 3 &&
      new Set(plans.map((plan) => plan.kind)).size === 3 &&
      output.outcomes.every((o) => o.availability === "verified" && !o.sourceFailures?.length) &&
      claimCheck?.valid === true
        ? ("passed" as const)
        : ("failed" as const),
    outcomes: output.outcomes.map(
      ({ kind, availability, reason, searchTruncated, sourceFailures, schemaFailure: failure }) => {
        const schemaFailure = safeLegalSchemaDiagnostic(failure);
        return {
          kind,
          availability,
          reason,
          ...(searchTruncated === undefined ? {} : { searchTruncated }),
          ...(sourceFailures?.length ? { sourceFailures } : {}),
          ...(schemaFailure ? { schemaFailure } : {}),
        };
      },
    ),
    sources: output.chunks.map(({ source }) => ({
      sourceType: source.sourceType,
      officialId: source.officialId,
      version: source.version,
      sourceDate: source.sourceDate,
      contentHash: source.contentHash,
      canonicalUrl: source.canonicalUrl,
      extractorVersion: source.extractorVersion,
    })),
    verifiedSourceCount: new Set(verified.map((chunk) => chunk.source.sourceId)).size,
    checkedClaimCount: claims.length,
    claimIntegrity: claimCheck?.valid ?? null,
  };
}

/** A diagnostic is not readiness evidence and retains no public source IDs or URLs either. */
export function legalDiagnosticReceipt(observed: Awaited<ReturnType<typeof inspectLegalV2>>) {
  return {
    schemaVersion: observed.schemaVersion,
    runtimeWorker: false as const,
    checkedAt: observed.checkedAt,
    durationMs: observed.durationMs,
    requests: observed.requests,
    reservations: observed.reservations,
    requestObservations: observed.requestObservations,
    upstreamRejections: observed.upstreamRejections,
    outcomes: observed.outcomes,
    verifiedSourceCount: observed.verifiedSourceCount,
    checkedClaimCount: observed.checkedClaimCount,
    claimIntegrity: observed.claimIntegrity,
    status:
      observed.outcomes.length > 0 &&
      observed.outcomes.every(
        (outcome) => outcome.availability === "verified" && !outcome.sourceFailures?.length,
      ) &&
      observed.claimIntegrity === true
        ? ("diagnostic_passed" as const)
        : ("diagnostic_failed" as const),
  };
}
