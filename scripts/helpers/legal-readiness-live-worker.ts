import { inspectLegalV2, legalDiagnosticReceipt, legalReadinessScope } from "../legal-readiness-v2";

// Local diagnostic bundle only. No product route or arbitrary query/URL input.
export default {
  async fetch(_request: Request, env: { LAW_API_OC: string; READINESS_LEGAL_SCOPE: string }) {
    const selected = legalReadinessScope(env.READINESS_LEGAL_SCOPE);
    const observed = await inspectLegalV2(
      { LAW_API_OC: env.LAW_API_OC },
      new Date().toISOString(),
      {
        plans: selected.plans,
      },
    );
    return Response.json({
      ...legalDiagnosticReceipt(observed),
      scope: selected.scope,
      runtimeWorker: true,
      runtimeLocation: "local-workerd",
      deployedWorker: false,
    });
  },
};
