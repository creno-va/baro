import { DurableObject } from "cloudflare:workers";
import type { z } from "zod";
import {
  createLlmGateway,
  type GatewayBinding,
  ModelError,
  type ModelMetric,
} from "../src/server/modules/llm-gateway/service";
import { createWorkspacePipeline } from "../src/server/modules/workspace/pipeline";
import {
  activeProvenance,
  authorizedProbeRequest,
  handleDurableProbe,
  PROBE_PROTOCOL_VERSION,
  PROBE_REQUEST_ID,
  type ProbeConfiguration,
  probeProviderFailureSchema,
} from "./ai-readiness-control";
import { syntheticIntakeContext } from "./ai-readiness-fixture";

interface ProbeEnv extends ProbeConfiguration {
  AI: GatewayBinding;
  AI_GATEWAY_ID: string;
  PROBE: DurableObjectNamespace;
}

// An isolated synthetic-only Worker. No application DB, cases or OAuth credentials.
export class SyntheticProbe extends DurableObject<ProbeEnv> {
  override async fetch(request: Request): Promise<Response> {
    return handleDurableProbe(request, this.env, this.ctx.storage, async (reserve) => {
      const metrics: ModelMetric[] = [];
      const providerFailures: z.infer<typeof probeProviderFailureSchema>[] = [];
      try {
        const gateway = createLlmGateway(this.env, {
          observe: (m) => metrics.push(m),
          observeFailure: (failure) => {
            const safe = probeProviderFailureSchema.safeParse(failure);
            if (safe.success) providerFailures.push(safe.data);
          },
        });
        const pipeline = createWorkspacePipeline(gateway, {
          reserve: async () => reserve(),
          invocation: () => crypto.randomUUID(),
        });
        const output = await pipeline.questions(syntheticIntakeContext(), PROBE_REQUEST_ID);
        return output.length >= 1 && output.length <= 3
          ? { status: "passed", failure: null, metrics, providerFailures }
          : { status: "failed", failure: "POLICY_REJECTED", metrics, providerFailures };
      } catch (error) {
        return {
          status: "failed",
          failure: error instanceof ModelError ? error.code : "MODEL_UNAVAILABLE",
          metrics,
          providerFailures,
        };
      }
    });
  }
}

export default {
  async fetch(request: Request, env: ProbeEnv): Promise<Response> {
    const forwarded = authorizedProbeRequest(request, env);
    const active = activeProvenance(env);
    if (!forwarded || !active)
      return Response.json(
        {
          status: "unavailable",
          probeVersion: PROBE_PROTOCOL_VERSION,
          configurationReady: Boolean(env.READINESS_TOKEN) && active !== null,
        },
        { status: 403 },
      );
    let transportStage = "binding";
    try {
      // Stable per candidate, never a source-hash namespace that resets its call budget.
      const stub = env.PROBE.get(env.PROBE.idFromName(active.candidateSha));
      transportStage = "dispatch";
      return await stub.fetch(forwarded);
    } catch {
      return Response.json({ status: "probe-transport-failed", transportStage }, { status: 502 });
    }
  },
};
