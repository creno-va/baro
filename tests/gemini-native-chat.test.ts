import { expect, test } from "bun:test";
import { z } from "zod";
import { providerWire } from "../src/server/modules/llm-gateway/provider-wire";
import {
  gatewayWireIdentity,
  prepareGatewayWireInput,
} from "../src/server/modules/llm-gateway/service";
import { workspaceChatOutputSchema } from "../src/server/modules/llm-gateway/v2/schemas";

const draft = {
  text: "확인할 날짜와 금액을 구분해 주세요.",
  references: [],
  warnings: [],
  facts: [],
  actions: [],
  parties: [],
  unknowns: null,
  requestedSources: [],
  sourceClaims: [],
  timeline: [],
  requestedMaterials: [],
  requestedTools: [],
  requestedCurrentTime: false,
};
test("compact chat definitions preserve required fields, closed objects and legacy server defaults", () => {
  const schema = prepareGatewayWireInput("workspace_chat", {}).response_format.json_schema.schema;
  const encoded = JSON.stringify(schema);
  expect(encoded.length).toBeLessThan(12000);
  expect(encoded).toContain('"$defs"');
  expect(encoded).toContain('"$ref"');
  const decoder = z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]);
  expect(decoder.safeParse({ output: draft }).success).toBe(true);
  expect(decoder.safeParse({ output: { ...draft, invented: true } }).success).toBe(false);
  const { requestedTools: _, unknowns: _gaps, ...legacy } = draft;
  expect(decoder.safeParse({ output: legacy }).success).toBe(false);
  expect(workspaceChatOutputSchema.parse(legacy)).toEqual(draft);
  expect(
    workspaceChatOutputSchema.safeParse({
      ...draft,
      requestedTools: ["registry", "thecheat", "hometax_status"],
    }).success,
  ).toBe(false);
});

test("chat uses explicit native LOW", () => {
  const wire = prepareGatewayWireInput("workspace_chat", {});
  const actual = providerWire(wire);
  expect(actual).toMatchObject({
    generationConfig: {
      maxOutputTokens: 10000,
      thinkingConfig: { thinkingLevel: "LOW", includeThoughts: false },
      responseMimeType: "application/json",
      responseJsonSchema: wire.response_format.json_schema.schema,
    },
  });
  for (const key of ["messages", "reasoning_effort", "extra_body", "response_format"])
    expect(actual).not.toHaveProperty(key);
});

test("chat numeric grammar is compact but material windows remain range-checked before use", () => {
  const schema = prepareGatewayWireInput("workspace_chat", {}).response_format.json_schema.schema;
  const encoded = JSON.stringify(schema);
  for (const keyword of [
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
  ])
    expect(encoded).not.toContain(`"${keyword}"`);
  const decoder = z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]);
  const valid = {
    ...draft,
    requestedMaterials: [{ fileId: "file_synthetic", fileRevision: 1, startOrdinal: 0, count: 1 }],
  };
  expect(workspaceChatOutputSchema.safeParse(valid).success).toBe(true);
  for (const override of [
    { fileRevision: 0 },
    { startOrdinal: -1 },
    { startOrdinal: 200001 },
    { count: 33 },
    { count: 0 },
  ]) {
    const candidate = {
      ...valid,
      requestedMaterials: [{ ...valid.requestedMaterials[0], ...override }],
    };
    expect(decoder.safeParse({ output: candidate }).success).toBe(true);
    expect(workspaceChatOutputSchema.safeParse(candidate).success).toBe(false);
  }
  expect(
    decoder.safeParse({
      output: { ...valid, requestedMaterials: [{ ...valid.requestedMaterials[0], count: 1.5 }] },
    }).success,
  ).toBe(false);
});

test.each(["workspace_questions", "workspace_summary"] as const)(
  "%s uses native LOW and its complete input in the admitted wire",
  async (phase) => {
    const data = { intake: { narrative: "합성 질문의 날짜는 지난달 말쯤입니다.", batches: [] } };
    const wire = prepareGatewayWireInput(phase, data);
    const actual = providerWire(wire) as Record<string, unknown>;
    expect(actual).toMatchObject({
      contents: [{ role: "user", parts: [{ text: wire.messages[1]?.content }] }],
      generationConfig: {
        maxOutputTokens: phase === "workspace_questions" ? 2400 : 10000,
        thinkingConfig: { thinkingLevel: "LOW", includeThoughts: false },
        responseJsonSchema: wire.response_format.json_schema.schema,
      },
    });
    expect(actual).not.toHaveProperty("reasoning_effort");
    expect(actual).not.toHaveProperty("messages");
    const bytes = new TextEncoder().encode(JSON.stringify(actual));
    const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    expect(await gatewayWireIdentity(wire)).toEqual({
      inputBytes: bytes.byteLength,
      wireInputSha256: sha,
    });
  },
);

test.each(["workspace_questions", "workspace_summary"] as const)(
  "%s audit omits chat-only instructions while preserving MEDIUM and all source text",
  (phase) => {
    const context = {
      intake: { narrative: "합성 불리한 진술", batches: [{ answers: [{ status: "unknown" }] }] },
    };
    const data = { phase, context, draft: { synthetic: "합성 초안" } };
    const full = prepareGatewayWireInput("workspace_audit", {});
    const wire = prepareGatewayWireInput("workspace_audit", data);
    expect(wire.messages[0]?.content.length ?? Infinity).toBeLessThan(
      (full.messages[0]?.content.length ?? 0) * 0.65,
    );
    expect(wire.messages[0]?.content).toContain("ALL supplied context");
    expect(wire.messages[0]?.content).toContain("If any critical issue exists, pass=false");
    expect(wire.messages[0]?.content).toContain("unknown/skipped");
    expect(wire.messages[0]?.content).not.toContain("For workspace_chat:");
    expect(JSON.parse(wire.messages[1]?.content ?? "{}").data).toEqual(data);
    expect(providerWire(wire)).toMatchObject({
      generationConfig: { thinkingConfig: { thinkingLevel: "MEDIUM", includeThoughts: false } },
    });
  },
);

test("unrecognized or nested user phase cannot select a narrower audit prompt", () => {
  const full = prepareGatewayWireInput("workspace_audit", {}).messages[0]?.content;
  for (const data of [
    { phase: "invented" },
    { context: { phase: "workspace_questions" } },
    { phase: "workspace_chat" },
  ])
    expect(prepareGatewayWireInput("workspace_audit", data).messages[0]?.content).toBe(full);
});
