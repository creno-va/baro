import { prompts } from "../../src/server/modules/llm-gateway/prompts";
/** Synthetic adapters understand both documented wire formats. Never production. */
export function syntheticGatewayInput(input: Record<string, unknown>) {
  const native = input as {
    systemInstruction?: { parts: { text: string }[] };
    contents?: { parts: { text: string }[] }[];
  };
  const messages = input.messages as { content: string }[] | undefined;
  const system = native.systemInstruction?.parts[0]?.text ?? messages?.[0]?.content ?? "";
  const text = native.contents?.[0]?.parts[0]?.text ?? messages?.[1]?.content ?? "{}";
  const phase = Object.entries(prompts).find(([, prompt]) => system.endsWith(prompt))?.[0];
  if (!phase) throw new Error("SYNTHETIC_GATEWAY_PHASE_MISSING");
  return {
    phase,
    name: `baro_${phase}_${phase.startsWith("workspace_") ? "v2" : "v1"}`,
    data: JSON.parse(text).data,
    system,
  };
}
