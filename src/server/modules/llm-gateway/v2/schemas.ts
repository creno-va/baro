import { z } from "zod";
import { displayText, opaqueIdSchema } from "../../../../contracts";
import {
  V2_INTAKE_POLICY,
  v2ActionSchema,
  v2FactReferenceSchema,
  v2FactsSchema,
  v2QuestionsSchema,
  v2SummarySchema,
  v2TimelineEntrySchema,
} from "../../../../contracts/v2";
import { sourceClaimSchema } from "../../citation/v2-validate";
import { workspaceSourceRequestSchema } from "../../legal-retrieval/v2/workspace-plans";

export const workspaceQuestionsOutputSchema = z.strictObject({
  questions: v2QuestionsSchema.max(V2_INTAKE_POLICY.questionsPerBatch),
});
export const workspaceSummaryOutputSchema = v2SummarySchema.omit({
  schemaVersion: true,
  revision: true,
  intakeRevision: true,
  createdAt: true,
});
export const workspaceChatOutputSchema = z.strictObject({
  text: displayText(10000),
  references: z.array(v2FactReferenceSchema).max(100),
  warnings: z.array(displayText(500)).max(20),
  facts: v2FactsSchema.refine(
    (facts) => facts.length <= 5,
    "At most five fact updates per response",
  ),
  actions: z.array(v2ActionSchema).max(5),
  parties: v2SummarySchema.shape.parties.max(5),
  requestedSources: z.array(workspaceSourceRequestSchema).max(2),
  sourceClaims: z.array(sourceClaimSchema).max(50).default([]),
  timeline: z.array(v2TimelineEntrySchema).max(5),
});
export const workspaceAuditOutputSchema = z.strictObject({
  pass: z.boolean(),
  findings: z
    .array(
      z.strictObject({
        severity: z.enum(["critical", "warning"]),
        code: z.enum([
          "unsupported_fact",
          "wrong_reference",
          "legal_strategy",
          "unsupported_legal_claim",
          "privacy",
          "coverage",
          "contradiction",
          "question_repetition",
        ]),
      }),
    )
    .max(30),
  unsupportedFactIds: z.array(opaqueIdSchema).max(300),
  legalClaimsSupported: z.boolean(),
  strategyDetected: z.boolean(),
});
