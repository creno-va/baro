import { expect, test } from "bun:test";
import { safeModelSchemaFailure } from "../src/server/modules/llm-gateway/schema-diagnostics";
import {
  createLlmGateway,
  ModelError,
  prepareGatewayWireInput,
} from "../src/server/modules/llm-gateway/service";

const audit = {
  pass: true,
  findings: [],
  unsupportedFactIds: [],
  legalClaimsSupported: true,
  strategyDetected: false,
};

test("MEDIUM native audit leaves bounded headroom for thinking and complete JSON without another call", async () => {
  let calls = 0,
    corrections = 0;
  const gateway = createLlmGateway({
    AI_GATEWAY_ID: "synthetic",
    AI: {
      run: async (_model, input) => {
        calls++;
        const config = input.generationConfig as {
          maxOutputTokens: number;
          thinkingConfig: unknown;
        };
        expect(config.thinkingConfig).toEqual({ thinkingLevel: "MEDIUM", includeThoughts: false });
        expect(config.maxOutputTokens).toBe(8000);
        // Synthetic provider obeys the shared thinking/output envelope. No partial
        // answer is accepted if the reasoning consumes the old small envelope.
        const complete = config.maxOutputTokens >= 4096;
        return {
          candidates: [
            {
              finishReason: complete ? "STOP" : "MAX_TOKENS",
              content: { parts: [{ text: complete ? JSON.stringify({ output: audit }) : "" }] },
            },
          ],
          usageMetadata: {
            promptTokenCount: 100,
            totalTokenCount: complete ? 4100 : 2483,
            candidatesTokenCount: complete ? 100 : 0,
            thoughtsTokenCount: complete ? 3900 : 2383,
          },
        };
      },
    },
  });
  expect(
    await gateway.call(
      "workspace_audit",
      {},
      "synthetic-audit",
      async () => true,
      async () => {
        corrections++;
        return true;
      },
    ),
  ).toEqual(audit);
  expect(calls).toBe(1);
  expect(corrections).toBe(0);
  expect(prepareGatewayWireInput("workspace_chat", {}).max_completion_tokens).toBe(10000);
  expect(prepareGatewayWireInput("workspace_questions", {}).max_completion_tokens).toBe(2400);
});

for (const [raw, reason, field, issue] of [
  [
    {
      candidates: [
        { finishReason: "MAX_TOKENS", content: { parts: [{ text: "private-partial-output" }] } },
      ],
    },
    "incomplete_output",
    "unknown",
    "unknown",
  ],
  [
    { choices: [{ finish_reason: "stop", message: { content: "private-invalid-json" } }] },
    "invalid_json",
    "unknown",
    "unknown",
  ],
  [
    {
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({ output: { ...audit, pass: "private-wrong-type" } }),
          },
        },
      ],
    },
    "schema_invalid",
    "pass",
    "invalid_type",
  ],
] as const) {
  test(`audit ${reason} stays rejected with one correction and only finite failure metadata`, async () => {
    let calls = 0,
      corrections = 0;
    const gateway = createLlmGateway({
      AI_GATEWAY_ID: "synthetic",
      AI: {
        run: async () => {
          calls++;
          return raw;
        },
      },
    });
    let failure: unknown;
    try {
      await gateway.call(
        "workspace_audit",
        {},
        "synthetic-failure",
        async () => true,
        async () => {
          corrections++;
          return true;
        },
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ModelError);
    expect(failure).toMatchObject({
      code: "MODEL_SCHEMA_INVALID",
      schemaFailure: { phase: "workspace_audit", reason, field, issue },
    });
    expect(calls).toBe(2);
    expect(corrections).toBe(1);
    expect(JSON.stringify(failure)).not.toContain("private");
  });
}

test("schema diagnostics drop arbitrary text and reject unknown enum values", () => {
  const finite = {
    phase: "workspace_audit",
    reason: "incomplete_output",
    field: "unknown",
    issue: "unknown",
  } as const;
  expect(
    safeModelSchemaFailure({ ...finite, output: "private-text", stack: "private-stack" }),
  ).toEqual(finite);
  expect(safeModelSchemaFailure({ ...finite, field: "private-key" })).toBeUndefined();
});
