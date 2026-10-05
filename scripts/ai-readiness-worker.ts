import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import {
  createLlmGateway,
  type GatewayBinding,
  ModelError,
  type ModelMetric,
} from "../src/server/modules/llm-gateway/service";
import {
  activeProvenance,
  authorizedProbeRequest,
  handleDurableProbe,
  PROBE_PROTOCOL_VERSION,
  PROBE_REQUEST_ID,
  type ProbeConfiguration,
} from "./ai-readiness-control";

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
      try {
        const output = await createLlmGateway(this.env, { observe: (m) => metrics.push(m) }).call(
          "screening",
          {
            sentences: [
              "대한민국에서 지인에게 100만 원을 빌려주었습니다.",
              "약속한 상환일이 지났지만 아직 돌려받지 못했습니다.",
            ],
          },
          PROBE_REQUEST_ID,
          reserve,
        );
        const expected = z.object({ inScope: z.literal(true), urgency: z.literal("none") });
        return expected.safeParse(output).success
          ? { status: "passed", failure: null, metrics }
          : { status: "failed", failure: "POLICY_REJECTED", metrics };
      } catch (error) {
        return {
          status: "failed",
          failure: error instanceof ModelError ? error.code : "MODEL_UNAVAILABLE",
          metrics,
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
