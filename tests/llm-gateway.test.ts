import { expect, test } from "bun:test";
import { MODEL_ID } from "../src/server/modules/llm-gateway/prompts";
import {
  createLlmGateway,
  ModelError,
  type ModelMetric,
} from "../src/server/modules/llm-gateway/service";
import { assembleVerifiedResult } from "../src/server/modules/response/validate";
import { guidance, syntheticCitation } from "./fixtures/contracts";

const screening = { schemaVersion: "1", inScope: true, urgency: "none", reasonCode: "IN_SCOPE" };
const completion = (output: unknown) => ({
  choices: [{ message: { content: JSON.stringify({ output }) }, finish_reason: "stop" }],
  usage: { prompt_tokens: 10, completion_tokens: 20 },
});
test("Worker binding sends pinned structured model/privacy options and allowlisted metadata", async () => {
  const metrics: ModelMetric[] = [];
  let reserved = 0;
  const gateway = createLlmGateway(
    {
      AI_GATEWAY_ID: "synthetic-gateway",
      AI: {
        run: async (model, input, options) => {
          expect(model).toBe(MODEL_ID);
          expect(input.reasoning_effort).toBe("medium");
          expect(input.store).toBe(false);
          expect(input.service_tier).toBe("default");
          expect(input).not.toHaveProperty("temperature");
          expect(options).toEqual({
            gateway: { id: "synthetic-gateway", collectLog: false, skipCache: true },
          });
          expect(JSON.stringify(input.response_format)).toContain('"strict":true');
          return completion(screening);
        },
      },
    },
    { observe: (metric) => metrics.push(metric), sleep: async () => {} },
  );
  expect(
    await gateway.call(
      "screening",
      { narrative: "synthetic private sentinel" },
      "safe-id",
      async () => {
        reserved++;
        return true;
      },
    ),
  ).toEqual(screening);
  expect(reserved).toBe(1);
  expect(metrics).toHaveLength(1);
  expect(JSON.stringify(metrics)).not.toContain("sentinel");
  expect(Object.keys(metrics[0] ?? {}).sort()).toEqual(
    ["requestId", "phase", "model", "latencyMs", "inputTokens", "outputTokens", "status"].sort(),
  );
});
test("transient/correction combined budget, strict unknown fields, credit refusal and timeout", async () => {
  let calls = 0;
  let reservations = 0;
  const gateway = createLlmGateway(
    {
      AI_GATEWAY_ID: "synthetic",
      AI: {
        run: async () => {
          calls++;
          if (calls === 1) throw { status: 429, retryAfter: 100 };
          if (calls === 2) return completion({ ...screening, unknownField: true });
          return completion(screening);
        },
      },
    },
    {
      sleep: async (ms) => {
        expect(ms).toBeLessThanOrEqual(30_000);
      },
    },
  );
  expect(
    await gateway.call("screening", {}, "safe", async () => {
      reservations++;
      return true;
    }),
  ).toEqual(screening);
  expect(calls).toBe(3);
  expect(reservations).toBe(3);
  calls = 0;
  const invalid = createLlmGateway(
    {
      AI_GATEWAY_ID: "synthetic",
      AI: {
        run: async () => {
          calls++;
          return completion({ invalid: true });
        },
      },
    },
    { sleep: async () => {} },
  );
  await expect(invalid.call("screening", {}, "safe", async () => true)).rejects.toThrow(
    "MODEL_SCHEMA_INVALID",
  );
  expect(calls).toBe(2);
  calls = 0;
  const credits = createLlmGateway(
    {
      AI_GATEWAY_ID: "synthetic",
      AI: {
        run: async () => {
          calls++;
          throw { status: 402 };
        },
      },
    },
    { sleep: async () => {} },
  );
  await expect(credits.call("screening", {}, "safe", async () => true)).rejects.toThrow(
    "MODEL_UNAVAILABLE",
  );
  expect(calls).toBe(1);
  const noBudget = createLlmGateway({
    AI_GATEWAY_ID: "synthetic",
    AI: {
      run: async () => {
        throw new Error("must not call");
      },
    },
  });
  await expect(noBudget.call("screening", {}, "safe", async () => false)).rejects.toThrow(
    "MODEL_UNAVAILABLE",
  );
  calls = 0;
  const timeout = createLlmGateway(
    {
      AI_GATEWAY_ID: "synthetic",
      AI: {
        run: async () => {
          calls++;
          return new Promise(() => {});
        },
      },
    },
    { timeoutMs: 5 },
  );
  await expect(timeout.call("screening", {}, "safe", async () => true)).rejects.toThrow(
    "MODEL_UNAVAILABLE",
  );
  expect(calls).toBe(1);
});
test("critical policy/citation findings and prohibited output fail closed without correction", async () => {
  const retrieval = {
    schemaVersion: "1",
    asOfDate: guidance.asOfDate,
    chunks: [{ citation: syntheticCitation, text: "synthetic statute" }],
    retrievalHash: "a".repeat(64),
  };
  const audit = {
    schemaVersion: "1",
    pass: false,
    sanitizedResult: null,
    findings: [{ code: "UNVERIFIED_CITATION", severity: "critical" }],
  };
  await expect(assembleVerifiedResult(guidance, audit, retrieval)).rejects.toBeInstanceOf(
    ModelError,
  );
  const prohibited = { ...guidance, notices: ["반드시 승소할 수 있습니다"] };
  await expect(
    assembleVerifiedResult(
      prohibited,
      { schemaVersion: "1", pass: true, sanitizedResult: prohibited, findings: [] },
      retrieval,
    ),
  ).rejects.toThrow("POLICY_REJECTED");
  let calls = 0;
  const refusal = createLlmGateway({
    AI_GATEWAY_ID: "synthetic",
    AI: {
      run: async () => {
        calls++;
        return {
          choices: [
            { message: { content: null, refusal: "synthetic refusal" }, finish_reason: "stop" },
          ],
        };
      },
    },
  });
  await expect(refusal.call("generation", {}, "safe", async () => true)).rejects.toThrow(
    "POLICY_REJECTED",
  );
  expect(calls).toBe(1);
});
