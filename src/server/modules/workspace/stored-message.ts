import { z } from "zod";
import { revisionSchema } from "../../../contracts/common";
import {
  v2AssistantMessageSchema,
  v2ConversationIntentSchema,
  v2LookupRequestsSchema,
  v2MessageSchema,
  v2ToolResultsSchema,
  v2UserMessageSchema,
} from "../../../contracts/v2";
import {
  v2PrecedentComparisonRequestSchema,
  v2PrecedentComparisonSchema,
} from "../../../contracts/v2/precedent-comparison";

export const unchangedResearchSchema = z.object({
  format: z.literal("unchanged-research-v1"),
  beforeWorkspaceRevision: revisionSchema,
  summaryRevision: revisionSchema,
});

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
      conversationIntent: v2ConversationIntentSchema.nullable().optional(),
      unchangedResearch: unchangedResearchSchema.optional(),
    }),
  ]);
}
export function publicStoredMessageSchema(
  guideHosts: readonly string[] = [],
  omitComparisonSources = false,
) {
  return storedMessageSchema(guideHosts).transform((stored) => {
    if (stored.role === "user") return publicStoredUserMessageSchema.parse(stored);
    const {
      toolResults: _tools,
      precedentComparison: comparison,
      conversationIntent: _intent,
      unchangedResearch: _unchangedResearch,
      ...message
    } = stored;
    const validated = v2MessageSchema(guideHosts).parse(message);
    // The comparison tab owns this source card. Keep the stored result and
    // model context intact; only the conversation projection omits its card.
    if (omitComparisonSources && comparison && validated.role === "assistant")
      return {
        ...validated,
        citations: [],
        references: validated.references.filter((ref) => ref.kind !== "official_source"),
      };
    return validated;
  });
}
