import type { OfficialSourceWrite } from "../src/server/db/v2-official-sources";
import { createV2LegalRetrieval } from "../src/server/modules/legal-retrieval/v2/service";
import type { Transport } from "../src/server/modules/legal-retrieval/v2/transport";
import {
  isWorkspacePublicQuery,
  type WorkspaceSourceRequest,
  workspaceRetrievalPlans,
} from "../src/server/modules/legal-retrieval/v2/workspace-plans";
import { projectWorkspaceSources } from "../src/server/modules/legal-retrieval/v2/workspace-sources";
import { ModelError } from "../src/server/modules/llm-gateway/service";
import type { WorkspaceContext } from "../src/server/modules/workspace/pipeline";

/** Public synthetic source test only. No application DB/cache or caller query. */
export function createSyntheticLegalLookup(credential: string, transport?: Transport) {
  const sources = new Map<string, OfficialSourceWrite>();
  let requests = 0,
    verifiedSourceCount = 0;
  let sourceFailures: ("upstream_rejected" | "schema_mismatch" | "unavailable")[] = [];
  const service = createV2LegalRetrieval(
    { LAW_API_OC: credential },
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
      bindCitation: async (citation) => sources.has(citation.sourceId),
      ...(transport ? { transport } : {}),
    },
  );
  return {
    snapshot: (acceptedQuotationCount: number) => ({
      requests,
      verifiedSourceCount,
      acceptedQuotationCount,
      sourceFailures: [...sourceFailures],
    }),
    async retrieve(
      context: WorkspaceContext,
      selected: WorkspaceSourceRequest[],
    ): Promise<WorkspaceContext> {
      const plans = workspaceRetrievalPlans(selected);
      // Never repeat the known pending guide or expand this public diagnostic.
      if (
        plans.length !== 1 ||
        plans.some(
          (p) =>
            p.kind !== "statute" ||
            p.lawTitle !== "민법" ||
            p.articles.length !== 1 ||
            p.articles.some((a) => BigInt(a.number) !== 598n || BigInt(a.branch) !== 0n),
        )
      )
        throw new ModelError("POLICY_REJECTED");
      const now = new Date().toISOString();
      const output = await service.retrieve(
        {
          now,
          asOfDate:
            context.calendar?.localDate ??
            new Date(Date.parse(now) + 9 * 3600000).toISOString().slice(0, 10),
          plans,
        },
        {
          authorize: async () => true,
          authorizeQuery: async (query) => isWorkspacePublicQuery(query),
          reserveRequest: async () => {
            if (requests >= 9) return false;
            requests++;
            return true;
          },
          signal: AbortSignal.timeout(120000),
        },
      );
      const projected = await projectWorkspaceSources(output);
      verifiedSourceCount = projected.citations.length;
      sourceFailures = output.outcomes
        .filter((o) => o.availability !== "verified")
        .map((o) =>
          o.reason === "upstream_rejected"
            ? "upstream_rejected"
            : o.reason === "schema_mismatch"
              ? "schema_mismatch"
              : "unavailable",
        );
      return {
        ...context,
        ...projected,
        references: {
          ...context.references,
          verifiedCitationIds: projected.citations.map((c) => c.id),
        },
      };
    },
  };
}
