import { type Phase, promptFor, prompts } from "../../src/server/modules/llm-gateway/prompts";
/** Synthetic adapters understand both documented wire formats. Never production. */
export function syntheticGatewayInput(input: Record<string, unknown>) {
  const native = input as {
    systemInstruction?: { parts: { text: string }[] };
    contents?: { parts: { text: string }[] }[];
  };
  const messages = input.messages as { content: string }[] | undefined;
  const system = native.systemInstruction?.parts[0]?.text ?? messages?.[0]?.content ?? "";
  const text = native.contents?.[0]?.parts[0]?.text ?? messages?.[1]?.content ?? "{}";
  const schemaName = (input.generationConfig as { responseJsonSchema?: unknown } | undefined)
    ? undefined
    : (input.response_format as { json_schema?: { name?: string } } | undefined)?.json_schema?.name;
  const data = JSON.parse(text).data;
  const phase = Object.keys(prompts).find((phase) =>
    schemaName
      ? schemaName === `baro_${phase}_${phase.startsWith("workspace_") ? "v2" : "v1"}`
      : system.startsWith("BARO prompt ") && system.endsWith(promptFor(phase as Phase, data)),
  );
  if (!phase) throw new Error("SYNTHETIC_GATEWAY_PHASE_MISSING");
  return {
    phase,
    name: `baro_${phase}_${phase.startsWith("workspace_") ? "v2" : "v1"}`,
    data,
    system,
  };
}
