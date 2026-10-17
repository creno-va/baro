import { z } from "zod";
import {
  workspaceAuditBasisSchema,
  workspaceAuditFindingSchema,
  workspaceAuditOutputSchema,
  workspaceAuditSourceClaimReasonSchema,
  workspaceAuditTargetSchema,
} from "../llm-gateway/v2/schemas";

const auditFailureSchema = workspaceAuditOutputSchema.omit({ unsupportedFactIds: true }).extend({
  // Preserve older receipts exactly; missing metadata is not new evidence.
  findings: z
    .array(
      workspaceAuditFindingSchema
        .omit({ target: true, basis: true, sourceClaimReason: true })
        .extend({
          target: workspaceAuditTargetSchema.optional(),
          basis: workspaceAuditBasisSchema.optional(),
          sourceClaimReason: workspaceAuditSourceClaimReasonSchema.optional(),
        })
        .refine(
          (finding) =>
            finding.sourceClaimReason === undefined ||
            (finding.severity === "critical" &&
              finding.target === "source_claim" &&
              finding.basis === "verified_source"),
        ),
    )
    .max(30),
  unsupportedFactCount: z.number().int().min(0).max(300),
});
export type WorkspaceAuditFailure = z.infer<typeof auditFailureSchema>;

/** Internal receipt only: fixed enums and counts, never text, IDs, offsets or free-form reasons. */
export function safeWorkspaceAuditFailure(value: unknown) {
  const result = auditFailureSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
