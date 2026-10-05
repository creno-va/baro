import { z } from "zod";
import {
  displayText,
  hasUniqueIds,
  opaqueIdSchema,
  revisionSchema,
  timestampSchema,
} from "../common";
import {
  V2_LIMITS,
  v2FailureCodeSchema,
  v2HashSchema,
  v2IdListSchema,
  v2JsonRequestSchema,
  v2VersionSchema,
} from "./common";
import { v2FactsSchema, v2OfficialCitationSchema } from "./sources";
import { v2ActionSchema, v2TimelineEntrySchema } from "./workspace";

export const v2ReportEditSchema = z.discriminatedUnion("field", [
  z.strictObject({ field: z.literal("overview"), text: displayText(5000) }),
  z.strictObject({ field: z.literal("fact"), factId: opaqueIdSchema, text: displayText(2000) }),
  z.strictObject({ field: z.literal("party"), partyId: opaqueIdSchema, label: displayText(200) }),
  z.strictObject({
    field: z.literal("lawyer_question"),
    questionId: opaqueIdSchema,
    text: displayText(1000),
  }),
]);
export const v2MaskingChoiceSchema = z.discriminatedUnion("mode", [
  z.strictObject({ partyId: opaqueIdSchema, mode: z.literal("keep") }),
  z.strictObject({
    partyId: opaqueIdSchema,
    mode: z.literal("mask"),
    replacement: displayText(200),
  }),
]);
const reportRequestBase = {
  expectedRevision: revisionSchema,
  selectedFileIds: v2IdListSchema,
  editedFields: z
    .array(v2ReportEditSchema)
    .max(100)
    .refine((edits) => {
      const keys = edits.map((edit) =>
        edit.field === "overview"
          ? "overview"
          : edit.field === "fact"
            ? `fact:${edit.factId}`
            : edit.field === "party"
              ? `party:${edit.partyId}`
              : `question:${edit.questionId}`,
      );
      return new Set(keys).size === keys.length;
    }, "Duplicate report edits"),
  maskingChoices: z
    .array(v2MaskingChoiceSchema)
    .max(30)
    .refine(
      (choices) => new Set(choices.map((choice) => choice.partyId)).size === choices.length,
      "Duplicate masking choices",
    ),
  reviewConfirmed: z.literal(true),
};
export const v2ReportCreateRequestSchema = v2JsonRequestSchema(
  z.discriminatedUnion("includeOriginals", [
    z.strictObject({ ...reportRequestBase, includeOriginals: z.literal(false) }),
    z
      .strictObject({
        ...reportRequestBase,
        includeOriginals: z.literal(true),
        originalsUnmaskedAcknowledged: z.literal(true),
        selectedOriginalFileIds: v2IdListSchema.min(1),
      })
      .refine(
        (request) =>
          request.selectedOriginalFileIds.every((id) => request.selectedFileIds.includes(id)),
        "An original package needs selected files",
      ),
  ]),
);
export const v2ReportFileSelectionSchema = z.strictObject({
  id: opaqueIdSchema,
  revision: revisionSchema,
  contentHash: v2HashSchema,
  byteLength: z.number().int().positive().max(V2_LIMITS.mediaBytes),
  name: displayText(255),
});
export function v2ReportBodySchema(guideHosts: readonly string[] = []) {
  return z
    .strictObject({
      schemaVersion: v2VersionSchema,
      overview: displayText(5000),
      parties: z
        .array(
          z.strictObject({ id: opaqueIdSchema, label: displayText(200), role: displayText(300) }),
        )
        .max(30)
        .refine(hasUniqueIds, "Duplicate parties"),
      facts: v2FactsSchema,
      timeline: z
        .array(v2TimelineEntrySchema)
        .max(300)
        .refine(hasUniqueIds, "Duplicate timeline entries"),
      selectedFiles: z
        .array(v2ReportFileSelectionSchema)
        .max(100)
        .refine(hasUniqueIds, "Duplicate files"),
      unknowns: z.array(displayText(1000)).max(100),
      actions: z.array(v2ActionSchema).max(100).refine(hasUniqueIds, "Duplicate actions"),
      lawyerQuestions: z
        .array(z.strictObject({ id: opaqueIdSchema, text: displayText(1000) }))
        .max(50)
        .refine(hasUniqueIds, "Duplicate lawyer questions"),
      citations: z
        .array(v2OfficialCitationSchema(guideHosts))
        .max(50)
        .refine(hasUniqueIds, "Duplicate citations"),
      legalSourceStatus: z.enum(["verified", "unavailable", "not_requested"]),
      notices: z.array(displayText(500)).min(1).max(20),
      generatedAt: timestampSchema,
    })
    .refine((body) => {
      if (body.legalSourceStatus !== "verified" && body.citations.length > 0) return false;
      const facts = body.facts.map((fact) => fact.id);
      const references = [
        ...body.facts.flatMap((fact) => fact.references),
        ...body.timeline.flatMap((entry) => entry.references),
        ...body.actions.flatMap((action) => action.references),
      ];
      return (
        body.timeline.every((entry) => entry.factIds.every((id) => facts.includes(id))) &&
        body.actions.every((action) => action.factIds.every((id) => facts.includes(id))) &&
        references.every((ref) =>
          ref.kind === "official_source"
            ? body.citations.some((citation) => citation.id === ref.citationId)
            : ref.kind !== "user_material" ||
              body.selectedFiles.some(
                (file) => file.id === ref.fileId && file.revision === ref.fileRevision,
              ),
        )
      );
    }, "Report contains unknown, unselected or unverified references");
}
export const v2PrivateArtifactSchema = z.strictObject({
  id: opaqueIdSchema,
  encryption: z.literal("chunk_aead_v1"),
  byteLength: z.number().int().positive().max(V2_LIMITS.accountStorageBytes),
  contentHash: v2HashSchema,
});
export function v2ReportSchema(guideHosts: readonly string[] = []) {
  return z
    .strictObject({
      schemaVersion: v2VersionSchema,
      id: opaqueIdSchema,
      version: revisionSchema,
      snapshotRevision: revisionSchema,
      summaryRevision: revisionSchema,
      createdAt: timestampSchema,
      status: z.enum(["queued", "building", "ready", "failed", "obsolete"]),
      request: v2ReportCreateRequestSchema,
      body: v2ReportBodySchema(guideHosts),
      pdf: v2PrivateArtifactSchema.nullable(),
      originalsZip: v2PrivateArtifactSchema.nullable(),
      originalManifest: z
        .array(v2ReportFileSelectionSchema)
        .max(100)
        .refine(hasUniqueIds, "Duplicate originals"),
      currentJobId: opaqueIdSchema.nullable(),
      failure: v2FailureCodeSchema.nullable(),
    })
    .refine((report) => {
      if (report.request.expectedRevision !== report.snapshotRevision) return false;
      const ids = report.body.selectedFiles.map((file) => file.id);
      if (
        report.request.selectedFileIds.length !== ids.length ||
        report.request.selectedFileIds.some((id) => !ids.includes(id))
      )
        return false;
      const ready = report.status === "ready" || report.status === "obsolete";
      if (ready) {
        if (report.pdf === null || report.currentJobId !== null || report.failure !== null)
          return false;
        if (report.request.includeOriginals) {
          if (
            report.originalsZip === null ||
            report.originalManifest.length !== report.request.selectedOriginalFileIds.length ||
            !report.request.selectedOriginalFileIds.every((id) =>
              report.originalManifest.some((file) => file.id === id),
            ) ||
            !report.originalManifest.every((original) =>
              report.body.selectedFiles.some(
                (file) =>
                  file.id === original.id &&
                  file.revision === original.revision &&
                  file.byteLength === original.byteLength &&
                  file.contentHash === original.contentHash,
              ),
            )
          )
            return false;
        } else if (report.originalsZip !== null || report.originalManifest.length !== 0)
          return false;
      } else if (
        report.pdf !== null ||
        report.originalsZip !== null ||
        report.originalManifest.length !== 0
      )
        return false;
      return report.status === "failed"
        ? report.failure !== null && report.currentJobId === null
        : ready || (report.failure === null && report.currentJobId !== null);
    }, "Report artifacts do not match the immutable snapshot and original selection");
}
export function v2ReportForSnapshotSchema(snapshot: {
  revision: number;
  fileIds: readonly string[];
  factIds: readonly string[];
  partyIds: readonly string[];
  lawyerQuestionIds: readonly string[];
}) {
  revisionSchema.parse(snapshot.revision);
  return v2ReportCreateRequestSchema.refine(
    (request) =>
      request.expectedRevision === snapshot.revision &&
      request.selectedFileIds.every((id) => snapshot.fileIds.includes(id)) &&
      request.maskingChoices.every((choice) => snapshot.partyIds.includes(choice.partyId)) &&
      request.editedFields.every(
        (edit) =>
          edit.field === "overview" ||
          (edit.field === "fact" && snapshot.factIds.includes(edit.factId)) ||
          (edit.field === "party" && snapshot.partyIds.includes(edit.partyId)) ||
          (edit.field === "lawyer_question" &&
            snapshot.lawyerQuestionIds.includes(edit.questionId)),
      ),
    "Report edits must address the current owned snapshot",
  );
}
export type V2ReportEdit = z.infer<typeof v2ReportEditSchema>;
export type V2MaskingChoice = z.infer<typeof v2MaskingChoiceSchema>;
export type V2ReportCreateRequest = z.infer<typeof v2ReportCreateRequestSchema>;
export type V2ReportBody = z.infer<ReturnType<typeof v2ReportBodySchema>>;
export type V2Report = z.infer<ReturnType<typeof v2ReportSchema>>;
export type V2ReportFileSelection = z.infer<typeof v2ReportFileSelectionSchema>;
export type V2PrivateArtifact = z.infer<typeof v2PrivateArtifactSchema>;
