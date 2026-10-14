import { z } from "zod";
import { workspaceAuditOutputSchema } from "../llm-gateway/v2/schemas";

const auditFailureSchema = workspaceAuditOutputSchema
  .omit({ unsupportedFactIds: true })
  .extend({ unsupportedFactCount: z.number().int().min(0).max(300) });
export type WorkspaceAuditFailure = z.infer<typeof auditFailureSchema>;

/** Internal receipt only: keep existing enums and counts, never draft text or fact IDs. */
export function safeWorkspaceAuditFailure(value: unknown) {
  const result = auditFailureSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
