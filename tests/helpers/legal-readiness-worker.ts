import { inspectLegalV2 } from "../../scripts/legal-readiness-v2";

// Isolated workerd conformance fixture, never a deployed product endpoint.
export default {
  async fetch(request: Request) {
    const input = (await request.json()) as { now: string; responses: Record<string, unknown> };
    const receipt = await inspectLegalV2({ LAW_API_OC: "synthetic-worker-only" }, input.now, {
      transport: async (value) => {
        const url = new URL(value),
          guide = url.hostname.includes("easylaw");
        const key = guide
          ? "guide"
          : `${url.searchParams.get("target")}_${url.pathname.endsWith("lawSearch.do") ? "list" : "detail"}`;
        return new Response(
          guide ? String(input.responses[key]) : JSON.stringify(input.responses[key]),
          { headers: { "content-type": guide ? "text/html" : "application/json" } },
        );
      },
    });
    return Response.json({ ...receipt, runtimeWorker: true, synthetic: true });
  },
};
