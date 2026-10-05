import {
  createAnalysisExecution,
  type ExecutionPhase,
} from "../../src/server/modules/case-structure/execution";
import { domainRepository } from "../../src/server/modules/intake/service";
import { createLegalRetrieval } from "../../src/server/modules/legal-retrieval/service";
import {
  createLlmGateway,
  type GatewayBinding,
} from "../../src/server/modules/llm-gateway/service";
import { guidance, questions } from "../fixtures/contracts";
import list from "../fixtures/legal/official-list.json";
import detail from "../fixtures/legal/official-sample.json";

/** HTTP/auth/DB/gateway contract harness only, never a live model/platform-quality claim. */
export async function syntheticWorkflow(env: Env) {
  const repo = await domainRepository(env);
  let answered = false;
  const binding: GatewayBinding = {
    async run(_model, input) {
      const phase = (
        input.response_format as { json_schema: { name: string } }
      ).json_schema.name.replace(/^baro_|_v1$/g, "");
      const data = JSON.parse((input.messages as { content: string }[])[1]?.content ?? "{}").data;
      let output: unknown;
      if (phase === "minimize") {
        answered = data.narrative.includes('"answers"');
        output = {
          schemaVersion: "1",
          sentences: ["합성 사용자 A는 지인에게 금전을 대여했다고 진술했습니다."],
          maskingHints: [],
        };
      }
      if (phase === "screening")
        output = { schemaVersion: "1", inScope: true, urgency: "none", reasonCode: "IN_SCOPE" };
      if (phase === "structure")
        output = {
          schemaVersion: "1",
          parties: [],
          amounts: [],
          dates: [],
          agreements: [],
          performance: [],
          evidence: [],
          unknowns: answered ? [] : ["반환 약정일"],
        };
      if (phase === "questions") output = { schemaVersion: "1", questions };
      if (phase === "generation")
        output = {
          ...guidance,
          asOfDate: data.asOfDate,
          citations: data.retrieval.chunks.map((c: { citation: unknown }) => c.citation),
          issues: guidance.issues.map((i) => ({
            ...i,
            citationIds: [data.retrieval.chunks[0].citation.id],
          })),
        };
      if (phase === "validation")
        output = { schemaVersion: "1", pass: true, sanitizedResult: data.draft, findings: [] };
      return {
        choices: [{ message: { content: JSON.stringify({ output }) }, finish_reason: "stop" }],
      };
    },
  };
  const gateway = createLlmGateway(
      { AI: binding, AI_GATEWAY_ID: "synthetic" },
      { sleep: async () => {} },
    ),
    retrieval = createLegalRetrieval(
      { ...env, LAW_API_OC: "test" },
      repo,
      async (url) => Response.json(url.includes("lawSearch") ? list : detail),
      async () => {},
    );
  const instances = new Map<string, string>();
  const stub = (id: string) => ({
    status: async () => ({ status: instances.get(id) ?? "unknown" }),
    sendEvent: async () => {
      instances.set(id, "complete");
    },
  });
  return {
    async get(id: string) {
      return stub(id);
    },
    async create({
      id,
      params,
    }: {
      id: string;
      params: { analysisId: string; inputRevision: number };
    }) {
      if (instances.has(id)) throw new Error("duplicate synthetic instance");
      instances.set(id, "running");
      const execution = createAnalysisExecution(env, params, id, gateway, retrieval);
      const phases: ExecutionPhase[] = [
        "initialize",
        "minimize",
        "screening",
        "structure",
        "questions",
        "retrieval",
        "generation",
        "validation",
        "finish",
      ];
      void (async () => {
        for (const phase of phases) {
          const result = await execution.phase(phase);
          if (result.status === "waiting_for_answers") {
            instances.set(id, "waiting");
            return;
          }
          if (result.status === "failed" || result.status === "stopped") break;
        }
        instances.set(id, "complete");
      })().catch(() => instances.set(id, "errored"));
      return stub(id);
    },
  } as unknown as Workflow;
}
