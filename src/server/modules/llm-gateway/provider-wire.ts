/** Explicit native audit avoids relying on model-dependent OpenAI reasoning
 * translation in the Cloudflare binding. No direct provider SDK/network path. */
export function providerWire(input: {
  messages: { role: string; content: string }[];
  max_completion_tokens: number;
  response_format: { json_schema: { schema: unknown } };
  extra_body?: {
    google: { thinking_config: { thinking_level: string; include_thoughts: boolean } };
  };
}) {
  if (!input.extra_body) return input;
  return {
    systemInstruction: { parts: [{ text: input.messages[0]?.content ?? "" }] },
    contents: [{ role: "user", parts: [{ text: input.messages[1]?.content ?? "" }] }],
    generationConfig: {
      maxOutputTokens: input.max_completion_tokens,
      responseMimeType: "application/json",
      responseJsonSchema: input.response_format.json_schema.schema,
      thinkingConfig: { thinkingLevel: "MEDIUM", includeThoughts: false },
    },
  };
}
