import { z } from "zod";
import { displayText, opaqueIdSchema, revisionSchema } from "../common";
import { v2FailureCodeSchema, v2IdListSchema } from "./common";
import { v2LegalAnalysisSnapshotSchema } from "./legal-analysis";
import {
  v2AnalysisBasisSchema,
  v2CaseContextSchema,
  v2ConversationIntentSchema,
  v2PreparationStateSchema,
  v2ReworkVersionSchema,
} from "./rework";

export const v2ReworkReportStateSchema = z
  .strictObject({
    status: z.enum(["not_started", "pending", "ready", "stale", "failed"]),
    id: opaqueIdSchema.nullable(),
    revision: revisionSchema.nullable(),
    basis: v2AnalysisBasisSchema.nullable(),
    currentJobId: opaqueIdSchema.nullable(),
    failure: v2FailureCodeSchema.nullable(),
  })
  .refine(
    (s) =>
      (s.status === "pending") === (s.currentJobId !== null) &&
      (s.status === "failed") === (s.failure !== null) &&
      (s.id === null) === (s.revision === null) &&
      (s.status !== "ready" || (s.id !== null && s.basis !== null)),
    "Inconsistent report readiness",
  );
export function v2ConversationStateSchema(guideHosts: readonly string[] = []) {
  return z
    .strictObject({
      contractVersion: v2ReworkVersionSchema,
      workspaceRevision: revisionSchema,
      caseContext: v2CaseContextSchema,
      summaryConfirmed: z.boolean(),
      pendingEvidenceIds: v2IdListSchema,
      analysis: v2PreparationStateSchema,
      snapshot: v2LegalAnalysisSnapshotSchema(guideHosts).nullable(),
      report: v2ReworkReportStateSchema,
      intents: z
        .array(
          z.strictObject({
            messageId: opaqueIdSchema,
            requestId: opaqueIdSchema,
            intent: v2ConversationIntentSchema,
            workspaceRevision: revisionSchema,
          }),
        )
        .max(100),
    })
    .refine((s) => {
      const sameBasis = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
      const published = ["ready", "partial", "empty", "unavailable"].includes(s.analysis.status);
      return (
        (!published ||
          (s.snapshot !== null &&
            s.snapshot.status === s.analysis.status &&
            sameBasis(s.snapshot.basis, s.analysis.basis))) &&
        (s.report.status !== "ready" || sameBasis(s.report.basis, s.analysis.basis)) &&
        new Set(s.intents.map((i) => i.requestId)).size === s.intents.length &&
        s.intents.every((i) => i.workspaceRevision <= s.workspaceRevision)
      );
    }, "Conversation must bind the published analysis, report and current intents");
}
export type V2ReworkReportState = z.infer<typeof v2ReworkReportStateSchema>;
export type V2ConversationState = z.infer<ReturnType<typeof v2ConversationStateSchema>>;
/** Opt-in logical continuation progress. Neither phase asserts an active job,
 * lease, provider attempt or permission to retry. Installed state DTOs stay unchanged. */
export function v2ConversationProgressSchema(guideHosts: readonly string[] = []) {
  return z
    .strictObject({
      contractVersion: z.literal("conversation-report-progress-v1"),
      state: v2ConversationStateSchema(guideHosts),
      reportContinuation: z
        .strictObject({
          phase: z.enum(["requested", "registered"]),
          requestId: opaqueIdSchema,
          basis: v2AnalysisBasisSchema,
          expectedReportRevision: revisionSchema.nullable(),
        })
        .nullable(),
    })
    .refine(
      (p) =>
        !p.reportContinuation ||
        (p.state.report.status !== "ready" &&
          !["not_started", "pending", "running", "stale"].includes(p.state.analysis.status) &&
          JSON.stringify(p.reportContinuation.basis) === JSON.stringify(p.state.analysis.basis) &&
          p.reportContinuation.expectedReportRevision === p.state.report.revision),
      "Continuation must describe an unresolved request for the current report basis",
    );
}
export type V2ConversationProgress = z.infer<ReturnType<typeof v2ConversationProgressSchema>>;
export const v2ConversationActionResultSchema = z.strictObject({
  contractVersion: v2ReworkVersionSchema,
  requestId: opaqueIdSchema,
  workspaceRevision: revisionSchema,
  pane: z.enum([
    "materials",
    "reconfirmation",
    "preparation",
    "analysis",
    "report",
    "followup",
    "lawyers",
  ]),
  status: z.enum(["require_confirmation", "pending", "ready", "blocked"]),
  missingItems: z.array(displayText(1000)).max(100),
  operationId: opaqueIdSchema.nullable(),
});
export type V2ConversationActionResult = z.infer<typeof v2ConversationActionResultSchema>;
