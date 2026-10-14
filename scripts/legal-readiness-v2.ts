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
  // A newest tax-source row can be HTML-only. Inspect two candidates while
  // retaining the same nine-reservation cap and explicit limited status.
  { kind: "precedent", query: "대여금", limit: 2 },
  workspaceGuidePlans.legal_consultation,
];

/** Fixed public diagnostic only; callers cannot supply case text or arbitrary URLs. */
export function legalReadinessScope(scope: string = "standard") {
  if (scope === "standard") return { scope, plans: readinessV2Plans };
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
        };
        requestObservations.push(observation);
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
    requests,
    reservations,
    // Snapshot only allowlisted metadata; never retain URL, headers, body or exception text.
    requestObservations: requestObservations.map((observation) => ({ ...observation })),
    upstreamRejections: upstreamRejections.map((observation) => ({ ...observation })),
    status:
      plans.length === 3 &&
      new Set(plans.map((plan) => plan.kind)).size === 3 &&
      output.outcomes.every((o) => o.availability === "verified") &&
      claimCheck?.valid === true
        ? ("passed" as const)
        : ("failed" as const),
    outcomes: output.outcomes.map(({ kind, availability, reason, schemaFailure: failure }) => {
      const schemaFailure = safeLegalSchemaDiagnostic(failure);
      return { kind, availability, reason, ...(schemaFailure ? { schemaFailure } : {}) };
    }),
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
      observed.outcomes.every((outcome) => outcome.availability === "verified") &&
      observed.claimIntegrity === true
        ? ("diagnostic_passed" as const)
        : ("diagnostic_failed" as const),
  };
}
