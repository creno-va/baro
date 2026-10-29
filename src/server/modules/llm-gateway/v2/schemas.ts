import { z } from "zod";
import { displayText, hasUniqueIds, opaqueIdSchema } from "../../../../contracts";
import {
  caseTitleSchema,
  V2_INTAKE_POLICY,
  v2ActionSchema,
  v2FactReferenceSchema,
  v2FactSchema,
  v2LookupToolIdSchema,
  v2QuestionsSchema,
  v2SummarySchema,
  v2TimelineEntrySchema,
} from "../../../../contracts/v2";
import { sourceClaimSchema } from "../../citation/v2-validate";
import { workspaceSourceRequestSchema } from "../../legal-retrieval/v2/workspace-plans";
import { materialWindowRequestSchema } from "../../workspace/materials";

export const workspaceQuestionsOutputSchema = z.strictObject({
  questions: v2QuestionsSchema.max(V2_INTAKE_POLICY.questionsPerBatch),
});
export const workspaceSummaryOutputSchema = v2SummarySchema
  .omit({
    schemaVersion: true,
    revision: true,
    intakeRevision: true,
    createdAt: true,
  })
  .extend({ caseTitle: caseTitleSchema.nullable().default(null) });
export const workspaceChatOutputSchema = z.strictObject({
  text: displayText(10000),
  references: z.array(v2FactReferenceSchema).max(100),
  warnings: z.array(displayText(500)).max(20),
  // Chat is a delta: conflicts may point to facts in the current summary.
  facts: z.array(v2FactSchema).max(5).refine(hasUniqueIds, "Duplicate fact IDs"),
  actions: z.array(v2ActionSchema).max(5),
  parties: v2SummarySchema.shape.parties.max(5),
  requestedSources: z.array(workspaceSourceRequestSchema).max(2),
  requestedTools: z.array(v2LookupToolIdSchema).max(2).default([]),
  requestedMaterials: z.array(materialWindowRequestSchema).max(2).default([]),
  sourceClaims: z.array(sourceClaimSchema).max(50).default([]),
  timeline: z.array(v2TimelineEntrySchema).max(5),
});
export const workspaceAuditTargetSchema = z.enum([
  "response_text",
  "fact",
  "party",
  "action",
  "timeline",
  "warning",
  "source_claim",
  "question",
  "summary",
  "unknown",
]);
export const workspaceAuditBasisSchema = z.enum([
  "intake_narrative",
  "intake_answer",
  "confirmed_summary",
  "current_fact",
  "user_message",
  "assistant_history",
  "selected_material",
  "verified_source",
  "server_calendar",
  "coverage_limit",
  "draft_internal",
  "policy",
  "unknown",
]);
export const workspaceAuditSourceClaimReasonSchema = z.enum([
  "citation_unavailable",
  "source_identity_mismatch",
  "quotation_text_or_span_mismatch",
  "source_semantics_mismatch",
  "source_freshness",
  "coverage_overstatement",
  "unknown",
]);
export const workspaceAuditFindingSchema = z.strictObject({
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
  // Older local fixtures may omit these diagnostics; absence is not evidence.
  target: workspaceAuditTargetSchema.default("unknown"),
  basis: workspaceAuditBasisSchema.default("unknown"),
  sourceClaimReason: workspaceAuditSourceClaimReasonSchema.default("unknown"),
});
export const workspaceAuditOutputSchema = z.strictObject({
  pass: z.boolean(),
  findings: z.array(workspaceAuditFindingSchema).max(30),
  unsupportedFactIds: z.array(opaqueIdSchema).max(300),
  legalClaimsSupported: z.boolean(),
  strategyDetected: z.boolean(),
});
