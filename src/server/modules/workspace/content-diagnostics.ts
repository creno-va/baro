import { z } from "zod";

const contentFailureSchema = z.strictObject({
  field: z.enum([
    "chat_text",
    "fact_text",
    "action_text",
    "timeline_event",
    "party",
    "fact_relation",
    "action_state",
    "action_relation",
    "timeline_state",
    "timeline_relation",
    "chat_draft",
  ]),
  category: z.enum([
    "private_identifier",
    "strategy",
    "outcome_claim",
    "professional_role",
    "duplicate_fact_id",
    "unknown_conflicting_fact",
    "invalid_revision",
    "invalid_status",
    "unknown_fact",
    "user_edited",
    "unclassified",
  ]),
  // Null means this failure came from a fact validator without a chat body.
  canonicalRefusalOpening: z.boolean().nullable(),
});
export type WorkspaceContentFailure = z.infer<typeof contentFailureSchema>;

/** Internal failure receipt only. Never retain text, matched substrings or entity IDs. */
export function safeWorkspaceContentFailure(value: unknown) {
  const result = contentFailureSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
