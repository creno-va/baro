/** Retained analysis and complex workspace paths avoid model-dependent compatibility
 * translation in the binding. No direct provider SDK/network path. */
export function providerWire(input: {
  messages: { role: string; content: string }[];
  max_completion_tokens: number;
  response_format: { json_schema: { name?: string; schema: unknown } };
  extra_body?: {
    google: { thinking_config: { thinking_level: string; include_thoughts: boolean } };
  };
}) {
  if (
    !input.extra_body &&
    ![
      "baro_workspace_chat_v2",
      "baro_minimize_v1",
      "baro_screening_v1",
      "baro_structure_v1",
      "baro_questions_v1",
      "baro_generation_v1",
    ].includes(input.response_format.json_schema.name ?? "")
  )
    return input;
  return {
    systemInstruction: { parts: [{ text: input.messages[0]?.content ?? "" }] },
    contents: [{ role: "user", parts: [{ text: input.messages[1]?.content ?? "" }] }],
    generationConfig: {
      maxOutputTokens: input.max_completion_tokens,
      responseMimeType: "application/json",
      responseJsonSchema: input.response_format.json_schema.schema,
      thinkingConfig: {
        thinkingLevel: input.extra_body ? "MEDIUM" : "LOW",
        includeThoughts: false,
      },
    },
  };
}
