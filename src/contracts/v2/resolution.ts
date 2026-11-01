import { z } from "zod";
import {
  boundedText,
  displayText,
  opaqueIdSchema,
  revisionSchema,
  timestampSchema,
} from "../common";
import { v2IdListSchema } from "./common";
import { v2SourceClaimSchema } from "./legal-analysis";
import {
  v2AnalysisBasisSchema,
  v2ProcedureSchema,
  v2ResolutionChoiceSchema,
  v2ReworkVersionSchema,
} from "./rework";
import { v2OfficialCitationSchema } from "./sources";

export const v2ResolutionBasisSchema = v2AnalysisBasisSchema.extend({
  workspaceRevision: revisionSchema,
  analysisId: opaqueIdSchema,
  reportId: opaqueIdSchema,
  reportRevision: revisionSchema,
  procedure: v2ProcedureSchema,
});
export const v2ResolutionDocumentKindSchema = z.enum([
  "fact_statement",
  "criminal_complaint",
  "civil_claim",
  "statement",
  "answer",
  "opinion",
  "appeal",
  "final_appeal",
]);
export const v2ResolutionDraftSchema = z
  .strictObject({
    id: opaqueIdSchema,
    revision: revisionSchema,
    documentKind: v2ResolutionDocumentKindSchema,
    title: displayText(300),
    content: boundedText(1, 20000),
    basis: v2ResolutionBasisSchema,
    selectedFileIds: v2IdListSchema,
    maskIdentifiers: z.boolean(),
    userEdited: z.boolean(),
    missingFields: z.array(displayText(1000)).max(100),
    reviewed: z.boolean(),
    status: z.enum(["draft", "saved"]),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .refine(
    (d) =>
      Date.parse(d.updatedAt) >= Date.parse(d.createdAt) && (d.status !== "saved" || d.reviewed),
    "Only reviewed drafts can be saved",
  );
/** Official guidance needs verified analysis claim IDs; absence means check required. */
export const v2ResolutionCheckSchema = z
  .strictObject({
    id: opaqueIdSchema,
    label: displayText(500),
    detail: displayText(2000),
    status: z.enum(["verified", "needs_confirmation", "unavailable"]),
    sourceClaimIds: v2IdListSchema,
  })
  .refine((c) => c.status !== "verified" || c.sourceClaimIds.length > 0);
export function v2ResolutionStateForGuidesSchema(guideHosts: readonly string[] = []) {
  return z
    .strictObject({
      contractVersion: v2ReworkVersionSchema,
      revision: revisionSchema,
      basis: v2ResolutionBasisSchema.nullable(),
      selection: v2ResolutionChoiceSchema.nullable(),
      selectedFileIds: v2IdListSchema,
      maskIdentifiers: z.boolean(),
      status: z.enum(["active", "paused", "stale", "not_ready"]),
      draft: v2ResolutionDraftSchema.nullable(),
      procedureChecks: z.array(v2ResolutionCheckSchema).max(100),
      weaknessChecks: z.array(displayText(2000)).max(100),
      consultationPreparation: z.array(displayText(2000)).max(100),
      citations: z.array(v2OfficialCitationSchema(guideHosts)).max(50),
      sourceClaims: z.array(v2SourceClaimSchema).max(100),
      allowedDocumentKinds: z.array(v2ResolutionDocumentKindSchema).min(1).max(8),
    })
    .refine(
      (s) =>
        (s.status === "not_ready" || s.basis !== null) &&
        (s.draft === null || s.basis !== null) &&
        s.sourceClaims.every((claim) => s.citations.some((c) => c.id === claim.citationId)) &&
        s.procedureChecks.every((check) =>
          check.sourceClaimIds.every((id) => s.sourceClaims.some((c) => c.id === id)),
        ),
      "Resolution needs an identified report, analysis and official claims",
    );
}
export const v2ResolutionStateSchema = v2ResolutionStateForGuidesSchema();
const mutation = {
  expectedRevision: revisionSchema,
  reportId: opaqueIdSchema,
  reportRevision: revisionSchema,
};
export const v2ResolutionMutationSchema = z.discriminatedUnion("action", [
  z.strictObject({
    ...mutation,
    action: z.literal("select"),
    choice: v2ResolutionChoiceSchema,
    selectedFileIds: v2IdListSchema,
    maskIdentifiers: z.boolean(),
  }),
  z.strictObject({ ...mutation, action: z.literal("pause") }),
  z.strictObject({ ...mutation, action: z.literal("resume") }),
  z.strictObject({
    ...mutation,
    action: z.literal("save_draft"),
    draftId: opaqueIdSchema,
    draftRevision: revisionSchema,
    content: boundedText(1, 20000),
    reviewed: z.literal(true),
  }),
]);
export const v2ResolutionDraftRequestSchema = z.strictObject({
  ...mutation,
  documentKind: v2ResolutionDocumentKindSchema,
  selectedFileIds: v2IdListSchema,
  maskIdentifiers: z.boolean(),
  factsConfirmed: z.literal(true),
});
export type V2ResolutionBasis = z.infer<typeof v2ResolutionBasisSchema>;
export type V2ResolutionDocumentKind = z.infer<typeof v2ResolutionDocumentKindSchema>;
export type V2ResolutionDraft = z.infer<typeof v2ResolutionDraftSchema>;
export type V2ResolutionCheck = z.infer<typeof v2ResolutionCheckSchema>;
export type V2ResolutionState = z.infer<typeof v2ResolutionStateSchema>;
export type V2ResolutionMutation = z.infer<typeof v2ResolutionMutationSchema>;
export type V2ResolutionDraftRequest = z.infer<typeof v2ResolutionDraftRequestSchema>;
