import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import {
  createLlmGateway,
  type GatewayBinding,
  ModelError,
  type ModelMetric,
} from "../src/server/modules/llm-gateway/service";

interface ProbeEnv {
  AI: GatewayBinding;
  AI_GATEWAY_ID: string;
  READINESS_CANDIDATE_SHA: string;
  READINESS_TOKEN: string;
  PROBE: DurableObjectNamespace;
}

// An isolated synthetic-only Worker. No application DB, cases or OAuth credentials.
export class SyntheticProbe extends DurableObject<ProbeEnv> {
  override async fetch(request: Request): Promise<Response> {
    if (request.method === "GET") {
      const report = await this.ctx.storage.get("report");
      return Response.json(
        report ?? {
          status: "no-completed-report",
          started: (await this.ctx.storage.get("started")) === true,
          attempts: (await this.ctx.storage.get<number>("calls")) ?? 0,
        },
      );
    }
    const acquired = await this.ctx.storage.transaction(async (txn) => {
      if (await txn.get("started")) return false;
      await txn.put("started", true);
      return true;
    });
    if (!acquired) return Response.json({ status: "already-attempted" }, { status: 409 });
    const metrics: ModelMetric[] = [];
    const requestId = "00000000-0000-4000-8000-000000000027";
    let status: "passed" | "failed" = "failed";
    let failure: "MODEL_UNAVAILABLE" | "MODEL_SCHEMA_INVALID" | "POLICY_REJECTED" | null = null;
    const reserve = () =>
      this.ctx.storage.transaction(async (txn) => {
        const calls = (await txn.get<number>("calls")) ?? 0;
        if (calls >= 3) return false;
        await txn.put("calls", calls + 1);
        return true;
      });
    try {
      const output = await createLlmGateway(this.env, { observe: (m) => metrics.push(m) }).call(
        "screening",
        {
          sentences: [
            "대한민국에서 지인에게 100만 원을 빌려주었습니다.",
            "약속한 상환일이 지났지만 아직 돌려받지 못했습니다.",
          ],
        },
        requestId,
        reserve,
      );
      const expected = z.object({ inScope: z.literal(true), urgency: z.literal("none") });
      status = expected.safeParse(output).success ? "passed" : "failed";
    } catch (error) {
      failure = error instanceof ModelError ? error.code : "MODEL_UNAVAILABLE";
    }
    const report = {
      version: 1,
      checkedAt: new Date().toISOString(),
      candidateSha: this.env.READINESS_CANDIDATE_SHA,
      environment: "isolated-synthetic-worker",
      status,
      failure,
      runtimeWorker: true,
      attempts: (await this.ctx.storage.get<number>("calls")) ?? 0,
      metrics,
      unverified: ["full-product-smoke", "live-corpus-eval", "oauth", "legal", "public-policy"],
    };
    await this.ctx.storage.put("report", report);
    return Response.json(report, { status: status === "passed" ? 200 : 502 });
  }
}

export default {
  async fetch(request: Request, env: ProbeEnv): Promise<Response> {
    if (
      !["POST", "GET"].includes(request.method) ||
      new URL(request.url).pathname !== "/probe" ||
      !env.READINESS_TOKEN ||
      request.headers.get("authorization") !== `Bearer ${env.READINESS_TOKEN}` ||
      !/^[a-f0-9]{40}$/.test(env.READINESS_CANDIDATE_SHA)
    )
      return Response.json(
        {
          status: "unavailable",
          probeVersion: 1,
          configurationReady:
            Boolean(env.READINESS_TOKEN) && /^[a-f0-9]{40}$/.test(env.READINESS_CANDIDATE_SHA),
        },
        { status: 403 },
      );
    let transportStage = "binding";
    try {
      const stub = env.PROBE.get(env.PROBE.idFromName(env.READINESS_CANDIDATE_SHA));
      transportStage = "dispatch";
      return await stub.fetch(request);
    } catch {
      return Response.json({ status: "probe-transport-failed", transportStage }, { status: 502 });
    }
  },
};
