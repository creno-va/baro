import { expect, test } from "bun:test";
import { responseReceipt } from "../src/server/modules/llm-gateway/attempts";
import { readModelCompletion } from "../src/server/modules/llm-gateway/completion";
import { createLlmGateway } from "../src/server/modules/llm-gateway/service";
import { gatewayResponse } from "../src/server/modules/llm-gateway/transport";

function native(text: string, finishReason = "STOP") {
  return {
    candidates: [
      {
        content: {
          role: "model",
          parts: [{ text: "private thinking sentinel", thought: true }, { text }],
        },
        finishReason,
      },
    ],
    usageMetadata: {
      promptTokenCount: 32,
      candidatesTokenCount: 519,
      thoughtsTokenCount: 336,
      totalTokenCount: 887,
    },
    responseId: "synthetic-request",
  };
}

test("Gemini native output separates answer from thoughts and keeps full thinking usage", async () => {
  const output = { schemaVersion: "1", inScope: true, urgency: "none", reasonCode: "IN_SCOPE" };
  const raw = native(JSON.stringify({ output }));
  expect(readModelCompletion(raw)).toEqual({
    content: JSON.stringify({ output }),
    stopped: true,
    refused: false,
  });
  expect(responseReceipt(raw)).toMatchObject({
    providerRequestId: "synthetic-request",
    inputTokens: 32,
    outputTokens: 855,
    cachedInputTokens: null,
    cacheWriteInputTokens: null,
    serviceTier: null,
    meteringStatus: "incomplete",
  });
  const gateway = createLlmGateway({
    AI_GATEWAY_ID: "synthetic",
    AI: { run: async () => Response.json({ result: raw, success: true, errors: [] }) },
  });
  expect(await gateway.call("screening", {}, "synthetic", async () => true)).toEqual(output);
});

test("native safety, truncation, unexpected calls and contradictory envelopes cannot become answers", () => {
  expect(readModelCompletion(native("{}", "SAFETY"))?.refused).toBe(true);
  expect(readModelCompletion(native("{}", "MAX_TOKENS"))?.stopped).toBe(false);
  expect(
    readModelCompletion({ candidates: [], promptFeedback: { blockReason: "SAFETY" } })?.refused,
  ).toBe(true);
  expect(readModelCompletion({ ...native("{}"), choices: [] })).toBeNull();
  expect(
    readModelCompletion({
      candidates: [
        { content: { parts: [{ functionCall: { name: "unexpected" } }] }, finishReason: "STOP" },
      ],
    }),
  ).toBeNull();
  expect(readModelCompletion(native("x".repeat(256 * 1024 + 1)))).toBeNull();
});

test("native usage never prices only visible tokens or silently invents cache observations", () => {
  expect(
    responseReceipt({ usageMetadata: { promptTokenCount: 32, candidatesTokenCount: 519 } }),
  ).toMatchObject({ inputTokens: 32, outputTokens: null, meteringStatus: "incomplete" });
  expect(
    responseReceipt({ usageMetadata: { promptTokenCount: 32, totalTokenCount: 2 } }).meteringStatus,
  ).toBe("invalid");
  expect(
    responseReceipt({
      usageMetadata: {
        promptTokenCount: 32,
        candidatesTokenCount: 519,
        thoughtsTokenCount: 336,
        totalTokenCount: 33,
      },
    }).meteringStatus,
  ).toBe("invalid");
});

test("Cloudflare raw transport unwraps only an explicit successful API envelope", async () => {
  const result = native("{}");
  expect(await gatewayResponse(Response.json({ success: true, result }))).toEqual(result);
  await expect(
    gatewayResponse(Response.json({ success: false, errors: [{ message: "private sentinel" }] })),
  ).rejects.toThrow("GATEWAY_PROVIDER_ERROR");
  expect(await gatewayResponse(Response.json({ result }))).toEqual({ result });
});
