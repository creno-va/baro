import { z } from "zod";

const chatSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z
            .string()
            .max(256 * 1024)
            .nullable(),
          refusal: z.string().nullable().optional(),
        }),
        finish_reason: z.string(),
      }),
    )
    .length(1),
});
const nativeSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z
              .array(
                z.object({
                  text: z.string().optional(),
                  thought: z.boolean().optional(),
                  functionCall: z.unknown().optional(),
                }),
              )
              .max(100),
          })
          .optional(),
        finishReason: z.string(),
      }),
    )
    .max(1),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
});

/** Both documented Gateway envelopes, never a model/provider fallback. Thought
 * parts and signatures are not output, evidence or content to show the user. */
export function readModelCompletion(raw: unknown): {
  content: string | null;
  stopped: boolean;
  refused: boolean;
} | null {
  if (!raw || typeof raw !== "object") return null;
  // Do not choose one of two contradictory provider envelopes.
  if ("choices" in raw && "candidates" in raw) return null;
  if ("choices" in raw) {
    const result = chatSchema.safeParse(raw);
    if (!result.success) return null;
    const choice = result.data.choices[0];
    if (!choice) return null;
    return {
      content: choice.message.content,
      stopped: choice.finish_reason === "stop",
      refused: Boolean(choice.message.refusal) || choice.finish_reason === "content_filter",
    };
  }
  const result = nativeSchema.safeParse(raw);
  if (!result.success) return null;
  const candidate = result.data.candidates[0];
  const refused =
    Boolean(result.data.promptFeedback?.blockReason) ||
    ["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY"].includes(
      candidate?.finishReason ?? "",
    );
  const parts = candidate?.content?.parts ?? [];
  // Unrequested function calls are never silently treated as a final response.
  if (parts.some((part) => part.functionCall !== undefined)) return null;
  const content = parts
    .filter((part) => !part.thought)
    .map((part) => part.text ?? "")
    .join("");
  if (content.length > 256 * 1024) return null;
  return { content: content || null, stopped: candidate?.finishReason === "STOP", refused };
}
