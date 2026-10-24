import { expect, test } from "bun:test";
import { z } from "zod";
import { structuredCaseSchema } from "../src/contracts";
import { providerWire } from "../src/server/modules/llm-gateway/provider-wire";
import {
  createLlmGateway,
  gatewayWireIdentity,
  prepareGatewayWireInput,
} from "../src/server/modules/llm-gateway/service";

const structured = {
  schemaVersion: "1",
  parties: [],
  amounts: [{ value: "30만 원", originalValue: "30만 원", source: "user", confidence: "stated" }],
  dates: [],
  agreements: [],
  performance: [],
  evidence: [],
  unknowns: ["실제 송금 여부"],
};

test("structure shares one closed fact definition without dropping fields or semantic checks", () => {
  const schema = prepareGatewayWireInput("structure", {}).response_format.json_schema.schema;
  const encoded = JSON.stringify(schema);
  expect(encoded.length).toBeLessThan(1800);
  expect(encoded).toContain('"$defs"');
  const compact = z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]);
  const expanded = z.fromJSONSchema(
    z.toJSONSchema(z.strictObject({ output: structuredCaseSchema }), {
      io: "output",
      unrepresentable: "any",
    }),
  );
  for (const candidate of [
    { output: structured },
    { output: { ...structured, invented: "extra" } },
    { output: { ...structured, evidence: undefined } },
    { output: { ...structured, amounts: [{ ...structured.amounts[0], extra: true }] } },
    { output: { ...structured, amounts: [{ ...structured.amounts[0], confidence: "invented" }] } },
  ]) {
    expect(compact.safeParse(candidate).success).toBe(expanded.safeParse(candidate).success);
  }
  expect(compact.safeParse({ output: structured }).success).toBe(true);
  // Provider schemas do not encode Zod refinements. The unchanged server parser
  // must still reject a purported user fact labelled as independently verified.
  const invalid = {
    ...structured,
    amounts: [{ ...structured.amounts[0], confidence: "verified" }],
  };
  expect(structuredCaseSchema.safeParse(invalid).success).toBe(false);
  expect(
    structuredCaseSchema.safeParse({ ...structured, unknowns: Array(21).fill("미확인") }).success,
  ).toBe(false);
});

test("structure dispatch uses native LOW and journals the exact bytes with the existing output cap", async () => {
  const canonical = prepareGatewayWireInput("structure", { sentences: ["합성 30만 원 대여"] });
  const actual = providerWire(canonical);
  expect(actual).toMatchObject({
    generationConfig: {
      maxOutputTokens: 4000,
      responseMimeType: "application/json",
      responseJsonSchema: canonical.response_format.json_schema.schema,
      thinkingConfig: { thinkingLevel: "LOW", includeThoughts: false },
    },
  });
  for (const key of ["messages", "reasoning_effort", "response_format", "extra_body"])
    expect(actual).not.toHaveProperty(key);
  const bytes = new TextEncoder().encode(JSON.stringify(actual));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  expect(await gatewayWireIdentity(canonical)).toEqual({
    inputBytes: bytes.byteLength,
    wireInputSha256: Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join(""),
  });
  let calls = 0;
  const gateway = createLlmGateway({
    AI_GATEWAY_ID: "synthetic",
    AI: {
      async run(model, input, options) {
        calls++;
        expect(model).toBe("google/gemini-3.8-flash");
        expect(input).toEqual(actual);
        expect(options.gateway).toEqual({ id: "synthetic", collectLog: false, skipCache: true });
        return Response.json({
          candidates: [
            {
              content: {
                parts: [
                  { thought: true, text: "private thought" },
                  {
                    text: JSON.stringify({ output: structured }),
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
        });
      },
    },
  });
  expect(
    await gateway.call(
      "structure",
      { sentences: ["합성 30만 원 대여"] },
      "synthetic",
      async () => true,
    ),
  ).toEqual(structured);
  expect(calls).toBe(1);
});
