import { expect, test } from "bun:test";
import { questionOutputSchema } from "../src/contracts";
import { MODEL_ID, prompts } from "../src/server/modules/llm-gateway/prompts";
import {
  createLlmGateway,
  ModelError,
  type ModelMetric,
  prepareGatewayWireInput,
} from "../src/server/modules/llm-gateway/service";
import { workspaceChatOutputSchema } from "../src/server/modules/llm-gateway/v2/schemas";
import { assembleVerifiedResult } from "../src/server/modules/response/validate";
import { guidance, syntheticCitation } from "./fixtures/contracts";

const screening = { schemaVersion: "1", inScope: true, urgency: "none", reasonCode: "IN_SCOPE" };
const completion = (output: unknown) => ({
  choices: [{ message: { content: JSON.stringify({ output }) }, finish_reason: "stop" }],
  usage: { prompt_tokens: 10, completion_tokens: 20 },
});

test("new legacy question batches enforce three while historical four-question DTOs remain readable", async () => {
  const questions = Array.from({ length: 4 }, (_, i) => ({
    id: `q${i + 1}`,
    prompt: `합성 확인 질문 ${i + 1}`,
    answerType: "text",
    options: [],
  }));
  expect(questionOutputSchema.parse({ schemaVersion: "1", questions }).questions).toHaveLength(4);
  let calls = 0,
    corrections = 0;
  const gateway = createLlmGateway(
    {
      AI_GATEWAY_ID: "synthetic",
      AI: {
        run: async () =>
          completion({
            schemaVersion: "1",
            questions: ++calls === 1 ? questions : questions.slice(0, 3),
          }),
      },
    },
    { sleep: async () => {} },
  );
  const result = await gateway.call(
    "questions",
    {},
    "synthetic-question-cap",
    async () => true,
    async () => {
      corrections++;
      return true;
    },
  );
  expect(result).toEqual({ schemaVersion: "1", questions: questions.slice(0, 3) });
  expect(calls).toBe(2);
  expect(corrections).toBe(1);
});
for (const phase of Object.keys(prompts) as (keyof typeof prompts)[]) {
  test(`${phase} wire schema requires every object property, including defaulted fields`, () => {
    // The provider rejects strict schemas with omitted required properties before
    // model execution, even when our server parser can supply their defaults.
    const schema = prepareGatewayWireInput(phase, {}).response_format.json_schema.schema;
    const violations: string[] = [];
    const visit = (value: unknown, path: string) => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          visit(item, `${path}[${index}]`);
        });
        return;
      }
      const node = value as Record<string, unknown>;
      if ("default" in node) violations.push(`${path} contains a server default annotation`);
      if (typeof node.maxItems === "number" && node.maxItems > 0)
        violations.push(`${path} expands a bounded array grammar`);
      if (node.type === "object" && node.properties) {
        const required = Array.isArray(node.required) ? node.required : [];
        for (const key of Object.keys(node.properties))
          if (!required.includes(key)) violations.push(`${path}.${key} is not required`);
        if (node.additionalProperties !== false) violations.push(`${path} is not closed`);
      }
      for (const [key, child] of Object.entries(node)) visit(child, `${path}.${key}`);
    };
    visit(schema, "schema");
    expect(violations).toEqual([]);
  });
}

test("explicit provider defaults remain compatible with server parsing and legacy defaults", () => {
  const output = {
    text: "거래 기록에서 날짜와 금액을 확인해 주세요.",
    references: [],
    warnings: [],
    facts: [],
    actions: [],
    parties: [],
    requestedSources: [
      {
        kind: "statute" as const,
        lawTitle: "민법" as const,
        articles: [{ number: "750", branch: "0" }],
      },
    ],
    requestedMaterials: [],
    requestedTools: [],
    sourceClaims: [],
    timeline: [],
  };
  expect(workspaceChatOutputSchema.parse(output)).toEqual(output);
  const { sourceClaims: _, ...legacy } = output;
  expect(
    workspaceChatOutputSchema.parse({
      ...legacy,
      requestedSources: [{ kind: "statute", lawTitle: "민법", articles: [{ number: "750" }] }],
    }),
  ).toEqual(output);
  expect(workspaceChatOutputSchema.safeParse({ ...output, unverified: true }).success).toBe(false);
  expect(
    workspaceChatOutputSchema.safeParse({
      ...output,
      requestedSources: [
        { kind: "statute", lawTitle: "민법", articles: [{ number: "750", branch: "100" }] },
      ],
    }).success,
  ).toBe(false);
});

test("question transport uses provider-supported nested unions and retains both discriminators", () => {
  const format = JSON.stringify(prepareGatewayWireInput("workspace_questions", {}).response_format);
  expect(format).not.toContain('"oneOf"');
  expect(format).toContain('"anyOf"');
  expect(format).toContain('"enum":["text"]');
  expect(format).toContain('"enum":["choice"]');
  expect(format).toContain('"additionalProperties":false');
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
          expect(input).toMatchObject({
            generationConfig: {
              thinkingConfig: { thinkingLevel: "LOW", includeThoughts: false },
              responseMimeType: "application/json",
              responseJsonSchema: { additionalProperties: false },
            },
          });
          expect(input).not.toHaveProperty("store");
          expect(input).not.toHaveProperty("service_tier");
          expect(input).not.toHaveProperty("temperature");
          expect(options).toEqual({
            gateway: { id: "synthetic-gateway", collectLog: false, skipCache: true },
            returnRawResponse: true,
          });
          expect(input).not.toHaveProperty("reasoning_effort");
          expect(input).not.toHaveProperty("response_format");
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
  const timeoutFailures: unknown[] = [];
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
    { timeoutMs: 5, observeFailure: (failure) => timeoutFailures.push(failure) },
  );
  await expect(timeout.call("screening", {}, "safe", async () => true)).rejects.toThrow(
    "MODEL_UNAVAILABLE",
  );
  expect(calls).toBe(1);
  expect(timeoutFailures).toEqual([
    { phase: "screening", category: "provider_timeout", httpStatus: null },
  ]);
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

test("Gemini thinking policy separates bounded generation from independent audit", () => {
  expect(MODEL_ID).toBe("google/gemini-3.8-flash");
  for (const phase of Object.keys(prompts) as (keyof typeof prompts)[]) {
    const wire = prepareGatewayWireInput(phase, {});
    const audit = phase === "workspace_audit" || phase === "validation";
    expect("reasoning_effort" in wire ? wire.reasoning_effort : undefined).toBe(
      audit ? undefined : "low",
    );
    if (audit)
      expect("extra_body" in wire ? wire.extra_body : undefined).toEqual({
        google: { thinking_config: { thinking_level: "medium", include_thoughts: false } },
      });
    else expect(wire).not.toHaveProperty("extra_body");
    expect(wire).not.toHaveProperty("store");
    expect(JSON.stringify(wire)).not.toContain('"reasoning_effort":"minimal"');
  }
});

test("Gemini content filtering is a policy refusal and never consumes a schema correction", async () => {
  let calls = 0,
    corrections = 0;
  const gateway = createLlmGateway({
    AI_GATEWAY_ID: "synthetic",
    AI: {
      run: async () => {
        calls++;
        return { choices: [{ message: { content: null }, finish_reason: "content_filter" }] };
      },
    },
  });
  await expect(
    gateway.call(
      "workspace_questions",
      {},
      "safe",
      async () => true,
      async () => {
        corrections++;
        return true;
      },
    ),
  ).rejects.toThrow("POLICY_REJECTED");
  expect(calls).toBe(1);
  expect(corrections).toBe(0);
});
