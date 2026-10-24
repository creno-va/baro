import { z } from "zod";
import {
  v2AssistantMessageSchema,
  v2MessageSchema,
  v2ToolResultsSchema,
  v2UserMessageSchema,
} from "../../../contracts/v2";

/** Private encrypted extension. Installed clients keep their original strict DTO. */
export function storedMessageSchema(guideHosts: readonly string[] = []) {
  return z.discriminatedUnion("role", [
    v2UserMessageSchema,
    v2AssistantMessageSchema(guideHosts).safeExtend({
      toolResults: v2ToolResultsSchema.optional(),
    }),
  ]);
}
export function publicStoredMessageSchema(guideHosts: readonly string[] = []) {
  return storedMessageSchema(guideHosts).transform((stored) => {
    if (stored.role === "user") return stored;
    const { toolResults: _tools, ...message } = stored;
    return v2MessageSchema(guideHosts).parse(message);
  });
}
