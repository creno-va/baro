import { expect, test } from "bun:test";
import { z } from "zod";
import { providerWire } from "../src/server/modules/llm-gateway/provider-wire";
import { prepareGatewayWireInput } from "../src/server/modules/llm-gateway/service";
import { workspaceChatOutputSchema } from "../src/server/modules/llm-gateway/v2/schemas";

const draft = {
  text: "확인할 날짜와 금액을 구분해 주세요.",
  references: [],
  warnings: [],
  facts: [],
  actions: [],
  parties: [],
  requestedSources: [],
  sourceClaims: [],
  timeline: [],
  requestedMaterials: [],
  requestedTools: [],
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
  const { requestedTools: _, ...legacy } = draft;
  expect(decoder.safeParse({ output: legacy }).success).toBe(false);
  expect(workspaceChatOutputSchema.parse(legacy)).toEqual(draft);
  expect(
    workspaceChatOutputSchema.safeParse({
      ...draft,
      requestedTools: ["registry", "thecheat", "hometax_status"],
    }).success,
  ).toBe(false);
});

test("chat uses explicit native LOW while accepted v2 questions and summary remain unchanged", () => {
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
  for (const phase of ["workspace_questions", "workspace_summary"] as const) {
    const accepted = prepareGatewayWireInput(phase, {});
    expect(providerWire(accepted)).toBe(accepted);
  }
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
