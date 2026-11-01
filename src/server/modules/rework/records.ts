import { z } from "zod";
import { dateSchema, opaqueIdSchema, revisionSchema, timestampSchema } from "../../../contracts";
import {
  v2AnalysisBasisSchema,
  v2ConversationActionRequestSchema,
  v2FailureCodeSchema,
  v2LegalAnalysisSnapshotSchema,
  v2OfficialCitationSchema,
  v2ResolutionCheckSchema,
  v2ResolutionDocumentKindSchema,
  v2SourceClaimSchema,
} from "../../../contracts/v2";
import { legalAnalysisInputSchema } from "../legal-retrieval/analysis/context";
import { GUIDE_HOSTS } from "../legal-retrieval/v2/registry";

/** Private encrypted records. Never extend installed-client job/message DTOs. */
export const analysisTaskSchema = z
  .strictObject({
    format: z.literal("legal-analysis-task-v1"),
    kind: z.literal("legal_analysis"),
    jobId: opaqueIdSchema,
    operationId: opaqueIdSchema,
    requestId: opaqueIdSchema,
    actionRequest: v2ConversationActionRequestSchema.optional(),
    beforeWorkspaceRevision: revisionSchema,
    targetWorkspaceRevision: revisionSchema,
    summaryRevision: revisionSchema,
    input: legalAnalysisInputSchema,
    asOfDate: dateSchema,
    createdAt: timestampSchema,
    invocationIds: z.strictObject({
      workspace_legal_plan: opaqueIdSchema,
      workspace_legal_analysis: opaqueIdSchema,
      workspace_legal_audit: opaqueIdSchema,
    }),
    continueWithReport: z.boolean(),
    reportExpectedRevision: revisionSchema.nullable().optional(),
    limitations: z.array(z.string().max(2000)).max(100),
  })
  .refine(
    (t) =>
      t.targetWorkspaceRevision === t.beforeWorkspaceRevision + 1 &&
      t.input.confirmedSummary.revision === t.summaryRevision,
  );
export type AnalysisTask = z.infer<typeof analysisTaskSchema>;
export const procedureSourcesSchema = z.strictObject({
  procedureChecks: z.array(v2ResolutionCheckSchema).max(100),
  documentSupport: z
    .array(
      z.strictObject({
        documentKind: v2ResolutionDocumentKindSchema,
        sourceClaimIds: z.array(opaqueIdSchema).max(100),
      }),
    )
    .max(8),
  citations: z.array(v2OfficialCitationSchema(GUIDE_HOSTS)).max(2),
  sourceClaims: z.array(v2SourceClaimSchema).max(10),
  limitations: z
    .array(
      z.strictObject({
        id: opaqueIdSchema,
        reason: z.string().min(1).max(200),
        action: z.string().min(1).max(2000),
        url: z.url().nullable(),
        checkedAt: timestampSchema.nullable(),
      }),
    )
    .max(100),
});
export const preparedAnalysisRecordSchema = z
  .strictObject({
    format: z.literal("prepared-legal-analysis-v1"),
    basis: v2AnalysisBasisSchema,
    scope: legalAnalysisInputSchema.shape.scope,
    snapshot: v2LegalAnalysisSnapshotSchema(GUIDE_HOSTS).nullable(),
    failure: v2FailureCodeSchema.nullable(),
    completedAt: timestampSchema,
    procedureCitations: z.array(v2OfficialCitationSchema(GUIDE_HOSTS)).max(2),
    procedureSources: procedureSourcesSchema.optional(),
  })
  .refine((r) => (r.snapshot === null) === (r.failure !== null));
export type PreparedAnalysisRecord = z.infer<typeof preparedAnalysisRecordSchema>;
export const reportContinuationSchema = z
  .strictObject({
    format: z.literal("report-continuation-v1"),
    requestId: opaqueIdSchema,
    requestHash: z.string().regex(/^[a-f0-9]{64}$/),
    basis: v2AnalysisBasisSchema,
    expectedReportRevision: revisionSchema.nullable(),
    status: z.enum(["pending", "ready", "failed"]),
    failure: v2FailureCodeSchema.nullable(),
    errorCode: z.string().min(1).max(100).nullable(),
    reportId: opaqueIdSchema.nullable(),
    reportRevision: revisionSchema.nullable(),
  })
  .refine(
    (r) =>
      (r.status === "failed") === (r.failure !== null) &&
      (r.reportId === null) === (r.reportRevision === null) &&
      (r.status !== "ready" || r.reportId !== null),
  );
