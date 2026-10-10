import type { OfficialSourceWrite } from "../src/server/db/v2-official-sources";
import { validateV2Claims } from "../src/server/modules/citation/v2-validate";
import {
  type RetrievalPlan,
  requestSchema,
} from "../src/server/modules/legal-retrieval/v2/contracts";
import { createV2LegalRetrieval } from "../src/server/modules/legal-retrieval/v2/service";
import type { Transport } from "../src/server/modules/legal-retrieval/v2/transport";
import {
  isWorkspacePublicQuery,
  workspaceGuidePlans,
} from "../src/server/modules/legal-retrieval/v2/workspace-plans";
import { sourceExcerpt } from "../src/server/modules/legal-retrieval/v2/workspace-sources";

export const readinessV2Plans: RetrievalPlan[] = [
  { kind: "statute", lawTitle: "민법", articles: [{ number: "598", branch: "0" }] },
  { kind: "precedent", query: "대여금", limit: 1 },
  workspaceGuidePlans.legal_consultation,
];

/** CI adapter evidence only. Original responses and credential URLs never enter the receipt. */
export async function inspectLegalV2(
  env: { LAW_API_OC?: string },
  now: string,
  options: { transport?: Transport; plans?: RetrievalPlan[] } = {},
) {
  let requests = 0;
  let reservations = 0;
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
        return (options.transport ?? fetch)(url, init);
      },
      bindCitation: async (citation) => sources.has(citation.sourceId),
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
  const claimCheck = await validateV2Claims(
    verified.map((chunk, i) => ({
      id: `readiness_${i}`,
      kind: "quotation",
      text: sourceExcerpt(chunk.span.text, 1000).text,
      citationId: chunk.citation.id,
      startUtf16: 0,
      endUtf16: sourceExcerpt(chunk.span.text, 1000).endUtf16,
    })),
    verified.map((chunk) => chunk.citation),
    output,
  );
  return {
    schemaVersion: "2" as const,
    runtimeWorker: false as const,
    checkedAt: now,
    requests,
    reservations,
    status:
      plans.length === 3 &&
      new Set(plans.map((plan) => plan.kind)).size === 3 &&
      output.outcomes.every((o) => o.availability === "verified") &&
      claimCheck.valid
        ? ("passed" as const)
        : ("failed" as const),
    outcomes: output.outcomes.map(({ kind, availability, reason }) => ({
      kind,
      availability,
      reason,
    })),
    sources: output.chunks.map(({ source }) => ({
      sourceType: source.sourceType,
      officialId: source.officialId,
      version: source.version,
      sourceDate: source.sourceDate,
      contentHash: source.contentHash,
      canonicalUrl: source.canonicalUrl,
      extractorVersion: source.extractorVersion,
    })),
    claimIntegrity: claimCheck.valid,
  };
}
