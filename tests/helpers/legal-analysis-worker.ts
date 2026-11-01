import type { LegalAnalysisInput } from "../../src/server/modules/legal-retrieval/analysis/context";
import { createAutomaticLegalAnalysis } from "../../src/server/modules/legal-retrieval/analysis/service";
import type { RetrievalOutput } from "../../src/server/modules/legal-retrieval/v2/contracts";

// Isolated conformance fixture, never a deployed route or production authority adapter.
export default {
  async fetch(request: Request) {
    const body = (await request.json()) as {
      input: LegalAnalysisInput;
      now: string;
      plan: unknown;
      draft: unknown;
      retrieval: RetrievalOutput;
    };
    let calls = 0;
    const service = createAutomaticLegalAnalysis({
      model: {
        plan: async () => {
          calls++;
          return body.plan;
        },
        analyze: async () => {
          calls++;
          return body.draft;
        },
        audit: async () => {
          calls++;
          return {
            pass: true,
            findings: [],
            unsupportedFactIds: [],
            legalClaimsSupported: true,
            strategyDetected: false,
          };
        },
      },
      retrieve: async () => body.retrieval,
      readBoundSources: async (ids) =>
        ids.map((id) => body.retrieval.chunks.find((c) => c.citation.id === id) ?? null),
      authorize: async () => true,
      reserveRequest: async () => true,
      clock: () => body.now,
    });
    const result = await service.prepare(body.input);
    return Response.json({
      status: result.snapshot.status,
      citations: result.snapshot.citations.length,
      calls,
      synthetic: true,
      runtimeWorker: true,
      authorityAdapter: "test_only",
    });
  },
};
