import { z } from "zod";
import {
  v2AssistantMessageSchema,
  v2LookupRequestsSchema,
  v2MessageSchema,
  v2ToolResultsSchema,
  v2UserMessageSchema,
} from "../../../contracts/v2";
import {
  v2PrecedentComparisonRequestSchema,
  v2PrecedentComparisonSchema,
} from "../../../contracts/v2/precedent-comparison";

export const storedUserMessageSchema = v2UserMessageSchema.extend({
  precedentComparisonRequest: v2PrecedentComparisonRequestSchema.optional(),
  lookupRequests: v2LookupRequestsSchema.optional(),
});
export type StoredUserMessage = z.infer<typeof storedUserMessageSchema>;
export const publicStoredUserMessageSchema = storedUserMessageSchema.transform((stored) => {
  const { precedentComparisonRequest: _request, lookupRequests: _lookups, ...message } = stored;
  return v2UserMessageSchema.parse(message);
});

/** Private encrypted extension. Installed clients keep their original strict DTO. */
export function storedMessageSchema(guideHosts: readonly string[] = []) {
  return z.discriminatedUnion("role", [
    storedUserMessageSchema,
    v2AssistantMessageSchema(guideHosts).safeExtend({
      toolResults: v2ToolResultsSchema.optional(),
      precedentComparison: v2PrecedentComparisonSchema.optional(),
    }),
  ]);
}
export function publicStoredMessageSchema(guideHosts: readonly string[] = []) {
  return storedMessageSchema(guideHosts).transform((stored) => {
    if (stored.role === "user") return publicStoredUserMessageSchema.parse(stored);
    const { toolResults: _tools, precedentComparison: _comparison, ...message } = stored;
    return v2MessageSchema(guideHosts).parse(message);
  });
}
