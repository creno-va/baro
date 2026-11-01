import { z } from "zod";
import { displayText, hasUniqueIds, opaqueIdSchema } from "../../../contracts";
import { v2IdListSchema } from "../../../contracts/v2/common";
import { v2LegalAnalysisDraftSchema } from "../../../contracts/v2/legal-analysis";
import { workspaceSourceRequestSchema } from "../legal-retrieval/v2/workspace-plans";
import { workspaceAuditOutputSchema } from "./v2/schemas";

/** A plan selects reviewed public concepts, never a narrative, URL or readToken. */
export const legalAnalysisPlanSchema = z
  .strictObject({
    issues: z
      .array(
        z.strictObject({
          id: opaqueIdSchema,
          title: displayText(500),
          factIds: v2IdListSchema.min(1),
          requests: z.array(workspaceSourceRequestSchema).min(1).max(4),
        }),
      )
      .max(3)
      .refine(hasUniqueIds),
  })
  .refine(
    (plan) =>
      new Set(plan.issues.flatMap((i) => i.requests.map((r) => JSON.stringify(r)))).size <= 4,
    "At most four distinct source requests per analysis",
  );

// Narrow execution bounds inside the larger, backwards-readable shared DTO.
export const legalAnalysisOutputSchema = v2LegalAnalysisDraftSchema.extend({
  issues: v2LegalAnalysisDraftSchema.shape.issues.max(3),
  precedents: v2LegalAnalysisDraftSchema.shape.precedents.max(4),
  sourceClaims: v2LegalAnalysisDraftSchema.shape.sourceClaims.max(30),
});
export const legalAnalysisAuditSchema = workspaceAuditOutputSchema;
export type LegalAnalysisPlan = z.infer<typeof legalAnalysisPlanSchema>;
