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

test("chat uses explicit native LOW while accepted simple generation requests remain unchanged", () => {
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
  for (const phase of ["workspace_questions", "workspace_summary", "screening"] as const) {
    const accepted = prepareGatewayWireInput(phase, {});
    expect(providerWire(accepted)).toBe(accepted);
  }
});
