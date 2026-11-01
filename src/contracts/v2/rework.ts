import { z } from "zod";
import {
  boundedText,
  displayText,
  opaqueIdSchema,
  revisionSchema,
  timestampSchema,
} from "../common";
import { v2FailureCodeSchema, v2HashSchema, v2IdListSchema } from "./common";
import { v2SummarySchema } from "./intake";
import { v2CreateCaseRequestSchema, v2WorkspaceSchema } from "./workspace";

/** Opt-in only. Existing v1/v2 workspace, intake and report responses stay unchanged. */
export const CONVERSATION_REPORT_VERSION = "conversation-report-v1" as const;
export const v2ReworkVersionSchema = z.literal(CONVERSATION_REPORT_VERSION);
export const v2CasePurposeSchema = z.enum(["prepare_claim", "respond_to_claim", "unconfirmed"]);
export const v2ConfirmedCasePurposeSchema = v2CasePurposeSchema.exclude(["unconfirmed"]);
export const v2ProcedureSchema = z.strictObject({
  kind: z.enum(["civil", "criminal", "family", "administrative", "labor", "other", "unconfirmed"]),
  stage: z.enum([
    "before_filing",
    "investigation",
    "first_instance",
    "appeal",
    "final_appeal",
    "enforcement",
    "other",
    "unconfirmed",
  ]),
  description: displayText(500).nullable(),
});
export const v2CaseContextSchema = z.strictObject({
  casePurpose: v2CasePurposeSchema,
  subjectContext: z.enum(["individual", "company"]),
  procedure: v2ProcedureSchema,
});
export const v2CaseContextUpdateSchema = z.strictObject({
  expectedRevision: revisionSchema,
  casePurpose: v2ConfirmedCasePurposeSchema,
  subjectContext: z.enum(["individual", "company"]),
  procedure: v2ProcedureSchema,
});
export const v2ReworkCreateCaseRequestSchema = v2CreateCaseRequestSchema.extend({
  casePurpose: v2ConfirmedCasePurposeSchema,
});
export const v2CaseContextViewSchema = z.strictObject({
  contractVersion: v2ReworkVersionSchema,
  workspaceRevision: revisionSchema,
  context: v2CaseContextSchema,
});
export const v2ReworkCreateCaseResponseSchema = z.strictObject({
  contractVersion: v2ReworkVersionSchema,
  workspace: v2WorkspaceSchema,
  context: v2CaseContextSchema,
});
/** File metadata and observation edits must change fileRevision or the evidence digest. */
export const v2AnalysisEvidenceSchema = z.strictObject({
  fileId: opaqueIdSchema,
  fileRevision: revisionSchema,
  contentHash: v2HashSchema,
});
export const v2AnalysisBasisSchema = z.strictObject({
  researchRevision: revisionSchema,
  summaryRevision: revisionSchema,
  evidenceHash: v2HashSchema,
  casePurpose: v2CasePurposeSchema,
});
export const v2EvidenceRequirementSchema = z.strictObject({
  id: opaqueIdSchema,
  kind: z.enum(["contract", "receipt", "conversation", "photo", "other"]),
  label: displayText(300),
  reason: displayText(1000),
  fileIds: v2IdListSchema,
});
export const v2SummaryReconciliationRequestSchema = z.strictObject({
  expectedRevision: revisionSchema,
  summaryRevision: revisionSchema,
  kind: z.enum(["correction", "addition"]),
  explanation: boundedText(1, 5000),
});
export const v2SummaryReconciliationProposalSchema = z
  .strictObject({
    id: opaqueIdSchema,
    requestId: opaqueIdSchema,
    baseWorkspaceRevision: revisionSchema,
    baseIntakeRevision: revisionSchema,
    baseSummaryRevision: revisionSchema,
    before: v2SummarySchema,
    after: v2SummarySchema,
    reasons: z.array(displayText(1000)).min(1).max(100),
    createdAt: timestampSchema,
  })
  .refine(
    (p) =>
      p.before.revision === p.baseSummaryRevision &&
      p.before.intakeRevision === p.baseIntakeRevision &&
      p.after.revision === p.baseSummaryRevision + 1 &&
      p.after.intakeRevision === p.baseIntakeRevision,
    "Proposal must identify its exact base and next revision",
  );
export const v2SummaryReconciliationSchema = z
  .strictObject({
    contractVersion: v2ReworkVersionSchema,
    workspaceRevision: revisionSchema,
    status: z.enum([
      "idle",
      "pending",
      "running",
      "proposed",
      "failed",
      "cancelled",
      "confirmed",
      "stale",
    ]),
    request: z
      .strictObject({
        id: opaqueIdSchema,
        input: v2SummaryReconciliationRequestSchema,
        createdAt: timestampSchema,
      })
      .nullable(),
    proposal: v2SummaryReconciliationProposalSchema.nullable(),
    currentJobId: opaqueIdSchema.nullable(),
    failure: v2FailureCodeSchema.nullable(),
    confirmedSummaryRevision: revisionSchema.nullable(),
    confirmedWorkspaceRevision: revisionSchema.nullable(),
  })
  .refine(
    (s) =>
      (s.status !== "idle" || (s.request === null && s.proposal === null)) &&
      (s.status === "idle" || s.request !== null) &&
      (s.status !== "proposed" || s.proposal !== null) &&
      (s.proposal === null || s.proposal.requestId === s.request?.id) &&
      (s.proposal === null ||
        s.proposal.baseSummaryRevision === s.request?.input.summaryRevision) &&
      (s.status === "confirmed") ===
        (s.confirmedSummaryRevision !== null && s.confirmedWorkspaceRevision !== null) &&
      (s.status === "pending" || s.status === "running") === (s.currentJobId !== null) &&
      (s.status === "failed") === (s.failure !== null),
    "Inconsistent reconciliation lifecycle",
  );
export const v2SummaryReconciliationConfirmSchema = z.strictObject({
  expectedRevision: revisionSchema,
  proposalId: opaqueIdSchema,
  /** The proposal's baseSummaryRevision, not its unconfirmed after.revision. */
  summaryRevision: revisionSchema,
});
export const v2SummaryReconciliationCancelSchema = z.strictObject({
  expectedRevision: revisionSchema,
  requestId: opaqueIdSchema,
});
export const v2ResolutionChoiceSchema = z.enum(["self", "lawyer", "save_report"]);
export const v2ConversationIntentSchema = z.enum([
  "add_material",
  "reconfirm_case",
  "show_preparation",
  "analyze_legal",
  "prepare_report",
  "resolve_followup",
  "save_report",
  "open_lawyers",
]);
const execute = { requestId: opaqueIdSchema, expectedRevision: revisionSchema };
/** Models propose allowlisted actions; only trusted handlers execute them. No URLs or tool names. */
export const v2ConversationActionRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ ...execute, action: z.literal("add_material") }),
  z.strictObject({ ...execute, action: z.literal("reconfirm_case") }),
  z.strictObject({ ...execute, action: z.literal("show_preparation") }),
  z.strictObject({ ...execute, action: z.literal("analyze_legal") }),
  z.strictObject({ ...execute, action: z.literal("prepare_report") }),
  z.strictObject({
    ...execute,
    action: z.literal("resolve_followup"),
    choice: v2ResolutionChoiceSchema.optional(),
  }),
  z.strictObject({
    ...execute,
    action: z.literal("save_report"),
    reportId: opaqueIdSchema,
    reportRevision: revisionSchema,
  }),
  z.strictObject({ ...execute, action: z.literal("open_lawyers") }),
]);
export const v2PreparationStateSchema = z
  .strictObject({
    status: z.enum([
      "not_started",
      "pending",
      "running",
      "ready",
      "partial",
      "empty",
      "unavailable",
      "failed",
      "stale",
    ]),
    basis: v2AnalysisBasisSchema.nullable(),
    currentJobId: opaqueIdSchema.nullable(),
    missingItems: z.array(displayText(1000)).max(100),
    failure: v2FailureCodeSchema.nullable(),
  })
  .refine(
    (s) =>
      (s.status === "pending" || s.status === "running") === (s.currentJobId !== null) &&
      (s.status === "failed") === (s.failure !== null) &&
      (s.status === "not_started") === (s.basis === null),
    "Inconsistent analysis readiness",
  );
export type V2CasePurpose = z.infer<typeof v2CasePurposeSchema>;
export type V2CaseContext = z.infer<typeof v2CaseContextSchema>;
export type V2CaseContextUpdate = z.infer<typeof v2CaseContextUpdateSchema>;
export type V2ReworkCreateCaseRequest = z.infer<typeof v2ReworkCreateCaseRequestSchema>;
export type V2CaseContextView = z.infer<typeof v2CaseContextViewSchema>;
export type V2ReworkCreateCaseResponse = z.infer<typeof v2ReworkCreateCaseResponseSchema>;
export type V2AnalysisEvidence = z.infer<typeof v2AnalysisEvidenceSchema>;
export type V2AnalysisBasis = z.infer<typeof v2AnalysisBasisSchema>;
export type V2EvidenceRequirement = z.infer<typeof v2EvidenceRequirementSchema>;
export type V2SummaryReconciliationRequest = z.infer<typeof v2SummaryReconciliationRequestSchema>;
export type V2SummaryReconciliationProposal = z.infer<typeof v2SummaryReconciliationProposalSchema>;
export type V2SummaryReconciliation = z.infer<typeof v2SummaryReconciliationSchema>;
export type V2SummaryReconciliationConfirm = z.infer<typeof v2SummaryReconciliationConfirmSchema>;
export type V2SummaryReconciliationCancel = z.infer<typeof v2SummaryReconciliationCancelSchema>;
export type V2ResolutionChoice = z.infer<typeof v2ResolutionChoiceSchema>;
export type V2ConversationIntent = z.infer<typeof v2ConversationIntentSchema>;
export type V2ConversationActionRequest = z.infer<typeof v2ConversationActionRequestSchema>;
export type V2PreparationState = z.infer<typeof v2PreparationStateSchema>;
