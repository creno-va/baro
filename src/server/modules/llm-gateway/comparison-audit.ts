import { z } from "zod";
import { precedentCriterionSchema } from "../../../contracts/v2/precedent-comparison";

/** Private, bounded review: a rejected indicator is omitted, never counted as a
 * difference. Global privacy/policy violations still reject the entire draft. */
export const comparisonAuditOutputSchema = z.strictObject({
  safe: z.boolean(),
  metrics: z
    .array(z.strictObject({ criterion: precedentCriterionSchema, supported: z.boolean() }))
    .length(8)
    .refine((metrics) => new Set(metrics.map((metric) => metric.criterion)).size === 8),
});

export function isComparisonAudit(phase: string, input: unknown) {
  return (
    phase === "workspace_audit" &&
    input !== null &&
    typeof input === "object" &&
    (input as { phase?: unknown }).phase === "workspace_precedent_compare"
  );
}
