import { expect, test } from "bun:test";
import { providerWire } from "../src/server/modules/llm-gateway/provider-wire";
import {
  gatewayWireIdentity,
  prepareGatewayWireInput,
} from "../src/server/modules/llm-gateway/service";

test.each([
  ["minimize", 2200],
  ["screening", 800],
  ["structure", 4000],
  ["questions", 1800],
  ["generation", 8000],
] as const)(
  "retained %s sends explicit native LOW with its existing %i output ceiling",
  async (phase, cap) => {
    const data = { synthetic: "untrusted source text" };
    const canonical = prepareGatewayWireInput(phase, data);
    const actual = providerWire(canonical);
    const system = canonical.messages[0]?.content,
      user = canonical.messages[1]?.content;
    if (typeof system !== "string" || typeof user !== "string")
      throw new Error("SYNTHETIC_GATEWAY_MESSAGES_MISSING");
    expect(actual).toEqual({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        maxOutputTokens: cap,
        responseMimeType: "application/json",
        responseJsonSchema: canonical.response_format.json_schema.schema,
        thinkingConfig: { thinkingLevel: "LOW", includeThoughts: false },
      },
    });
    for (const key of [
      "messages",
      "reasoning_effort",
      "service_tier",
      "response_format",
      "extra_body",
    ])
      expect(actual).not.toHaveProperty(key);
    const bytes = new TextEncoder().encode(JSON.stringify(actual));
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    expect(await gatewayWireIdentity(canonical)).toEqual({
      inputBytes: bytes.byteLength,
      wireInputSha256: Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join(""),
    });
  },
);
