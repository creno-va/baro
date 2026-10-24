import { expect, test } from "bun:test";
import { providerWire } from "../src/server/modules/llm-gateway/provider-wire";
import {
  createLlmGateway,
  gatewayWireIdentity,
  prepareGatewayWireInput,
} from "../src/server/modules/llm-gateway/service";
import { gatewayRequestIssue, gatewayResponse } from "../src/server/modules/llm-gateway/transport";

test.each(["workspace_audit", "validation"] as const)(
  "%s uses native MEDIUM thinking and receipts hash the exact dispatched bytes",
  async (phase) => {
    const canonical = prepareGatewayWireInput(phase, { privateSentinel: "synthetic-only" });
    const wire = providerWire(canonical);
    expect(wire).toMatchObject({
      generationConfig: {
        thinkingConfig: { thinkingLevel: "MEDIUM", includeThoughts: false },
        maxOutputTokens: canonical.max_completion_tokens,
        responseMimeType: "application/json",
        responseJsonSchema: canonical.response_format.json_schema.schema,
      },
    });
    for (const key of [
      "messages",
      "reasoning_effort",
      "extra_body",
      "response_format",
      "max_completion_tokens",
    ])
      expect(wire).not.toHaveProperty(key);
    const bytes = new TextEncoder().encode(JSON.stringify(wire));
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    expect(await gatewayWireIdentity(canonical)).toEqual({
      inputBytes: bytes.byteLength,
      wireInputSha256: Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join(""),
    });
  },
);

test("native independent audit still passes through the same binding/privacy and validates final output", async () => {
  const output = {
    pass: true,
    findings: [],
    unsupportedFactIds: [],
    legalClaimsSupported: true,
    strategyDetected: false,
  };
  let captured: unknown;
  const gateway = createLlmGateway({
    AI_GATEWAY_ID: "synthetic-only",
    AI: {
      async run(model, input, options) {
        expect(model).toBe("google/gemini-3.8-flash");
        expect(options).toEqual({
          gateway: { id: "synthetic-only", collectLog: false, skipCache: true },
          returnRawResponse: true,
        });
        captured = input;
        return Response.json({
          candidates: [
            {
              content: {
                parts: [
                  { thought: true, text: "not public" },
                  { text: JSON.stringify({ output }) },
                ],
              },
              finishReason: "STOP",
            },
          ],
        });
      },
    },
  });
  expect(await gateway.call("workspace_audit", {}, "synthetic-request", async () => true)).toEqual(
    output,
  );
  expect(captured).toEqual(providerWire(prepareGatewayWireInput("workspace_audit", {})));
});

test("bounded plain-text provider errors can be classified without exposing the text", async () => {
  const error = await gatewayResponse(
    new Response("Invalid response_format schema private sentinel", { status: 400 }),
  ).catch((e) => e);
  expect(gatewayRequestIssue(error)).toBe("schema_constraint");
  expect(String(error)).toBe("Error: GATEWAY_HTTP_ERROR");
  expect(JSON.stringify(error)).not.toContain("sentinel");
});
