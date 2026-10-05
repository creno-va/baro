import { z } from "zod";
import {
  boundedText,
  dateSchema,
  displayText,
  hasUniqueIds,
  opaqueIdSchema,
  revisionSchema,
  timestampSchema,
} from "../common";
import { v2FailureCodeSchema, v2IdListSchema, v2VersionSchema } from "./common";
import { v2FactReferenceSchema, v2OfficialCitationSchema } from "./sources";

export const v2CreateCaseRequestSchema = z.strictObject({
  narrative: boundedText(20, 5000),
  subjectContext: z.enum(["individual", "company"]),
  jurisdiction: z.literal("KR"),
  turnstileToken: boundedText(1, 2048),
});
export const v2WorkspaceSchema = z
  .strictObject({
    schemaVersion: v2VersionSchema,
    id: opaqueIdSchema,
    title: z.literal("사건 작업 공간"),
    subjectContext: z.enum(["individual", "company"]),
    jurisdiction: z.literal("KR"),
    status: z.enum(["intake", "active", "archived"]),
    archivedFrom: z.enum(["intake", "active"]).nullable(),
    workspaceRevision: revisionSchema,
    intakeRevision: revisionSchema,
    confirmedSummaryRevision: revisionSchema.nullable(),
    currentJobId: opaqueIdSchema.nullable(),
    legacySnapshotId: opaqueIdSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .refine((workspace) => {
    if (Date.parse(workspace.updatedAt) < Date.parse(workspace.createdAt)) return false;
    if ((workspace.status === "archived") !== (workspace.archivedFrom !== null)) return false;
    const effective = workspace.status === "archived" ? workspace.archivedFrom : workspace.status;
    return (
      (effective === "active") === (workspace.confirmedSummaryRevision !== null) &&
      (workspace.status !== "archived" || workspace.currentJobId === null)
    );
  }, "Inconsistent workspace state");
export const v2WorkspaceStateRequestSchema = z.strictObject({
  expectedRevision: revisionSchema,
  action: z.enum(["archive", "resume"]),
});
export const v2UpgradeRequestSchema = z.strictObject({
  expectedRevision: revisionSchema,
  preserveLegacySnapshot: z.literal(true),
});
export const v2MessageRequestSchema = z.strictObject({
  expectedRevision: revisionSchema,
  text: boundedText(1, 10_000),
  selectedFileIds: v2IdListSchema,
});
const messageBase = {
  schemaVersion: v2VersionSchema,
  id: opaqueIdSchema,
  operationId: opaqueIdSchema,
  workspaceRevision: revisionSchema,
  createdAt: timestampSchema,
};
export const v2UserMessageSchema = z.strictObject({
  ...messageBase,
  role: z.literal("user"),
  text: boundedText(1, 10_000),
  selectedFileIds: v2IdListSchema,
});
export function v2AssistantMessageSchema(guideHosts: readonly string[]) {
  return z
    .strictObject({
      ...messageBase,
      role: z.literal("assistant"),
      safety: z.literal("validated"),
      text: displayText(10_000),
      references: z.array(v2FactReferenceSchema).max(100),
      citations: z
        .array(v2OfficialCitationSchema(guideHosts))
        .max(50)
        .refine(hasUniqueIds, "Duplicate citations"),
      warnings: z.array(displayText(500)).max(20),
    })
    .refine(
      (message) =>
        message.references.every(
          (ref) =>
            ref.kind !== "official_source" ||
            message.citations.some((citation) => citation.id === ref.citationId),
        ),
      "Unverified citation reference",
    );
}
export function v2MessageSchema(guideHosts: readonly string[] = []) {
  return z.discriminatedUnion("role", [v2UserMessageSchema, v2AssistantMessageSchema(guideHosts)]);
}
export const v2TimelineEntrySchema = z
  .strictObject({
    id: opaqueIdSchema,
    revision: revisionSchema,
    date: dateSchema.nullable(),
    datePrecision: z.enum(["day", "month", "year", "unknown"]),
    event: displayText(2000),
    certainty: z.enum(["reported", "observed", "uncertain", "conflicting"]),
    references: z.array(v2FactReferenceSchema).max(100),
    factIds: v2IdListSchema,
    userEdited: z.boolean(),
  })
  .refine(
    (entry) =>
      (!entry.userEdited || entry.certainty !== "observed") &&
      (entry.datePrecision === "unknown") === (entry.date === null) &&
      (entry.date === null || entry.datePrecision !== "month" || entry.date.endsWith("-01")) &&
      (entry.date === null || entry.datePrecision !== "year" || entry.date.endsWith("-01-01")),
    "Date precision does not match stored date",
  );
export const v2TimelineEditRequestSchema = z
  .strictObject({
    expectedRevision: revisionSchema,
    date: dateSchema.nullable(),
    datePrecision: z.enum(["day", "month", "year", "unknown"]),
    event: displayText(2000),
  })
  .refine(
    (request) =>
      v2TimelineEntrySchema.safeParse({
        date: request.date,
        datePrecision: request.datePrecision,
        event: request.event,
        id: "validation",
        revision: request.expectedRevision,
        certainty: "reported",
        references: [],
        factIds: [],
        userEdited: true,
      }).success,
    "Invalid timeline date",
  );
export const v2ActionSchema = z
  .strictObject({
    id: opaqueIdSchema,
    revision: revisionSchema,
    kind: z.enum([
      "evidence_preserve",
      "fact_check",
      "organize_materials",
      "official_guide_check",
      "ask_lawyer",
    ]),
    title: displayText(300),
    instructions: displayText(2000),
    caution: displayText(1000),
    status: z.enum(["todo", "done", "skipped"]),
    factIds: v2IdListSchema,
    references: z.array(v2FactReferenceSchema).max(100),
  })
  .refine(
    (action) =>
      action.kind !== "official_guide_check" ||
      action.references.some((ref) => ref.kind === "official_source"),
    "Official-guide action needs a source",
  );
export const v2ActionUpdateRequestSchema = z.strictObject({
  expectedRevision: revisionSchema,
  status: z.enum(["todo", "done", "skipped"]),
});
export const v2JobTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("workspace"),
    caseId: opaqueIdSchema,
    workspaceRevision: revisionSchema,
  }),
  z.strictObject({
    kind: z.literal("file"),
    caseId: opaqueIdSchema,
    fileId: opaqueIdSchema,
    fileRevision: revisionSchema,
  }),
  z.strictObject({
    kind: z.literal("report"),
    caseId: opaqueIdSchema,
    reportId: opaqueIdSchema,
    snapshotRevision: revisionSchema,
  }),
  z.strictObject({
    kind: z.literal("profile_asset"),
    profileId: opaqueIdSchema,
    assetId: opaqueIdSchema,
    assetRevision: revisionSchema,
  }),
]);
export const v2JobSchema = z
  .strictObject({
    schemaVersion: v2VersionSchema,
    id: opaqueIdSchema,
    operationId: opaqueIdSchema,
    target: v2JobTargetSchema,
    kind: z.enum([
      "intake_questions",
      "intake_summary",
      "chat_response",
      "file_processing",
      "report_build",
      "portfolio_sanitize",
    ]),
    status: z.enum([
      "queued",
      "running",
      "validating",
      "completed",
      "failed",
      "cancelled",
      "superseded",
    ]),
    phase: z.enum([
      "admission",
      "extracting",
      "transcribing",
      "observing",
      "retrieving",
      "generating",
      "validating",
      "assembling",
      "finished",
    ]),
    progressPercent: z.number().int().min(0).max(100),
    attempts: z.number().int().min(0).max(10),
    failure: v2FailureCodeSchema.nullable(),
    retryable: z.boolean(),
    updatedAt: timestampSchema,
  })
  .refine((job) => {
    const targets = {
      intake_questions: "workspace",
      intake_summary: "workspace",
      chat_response: "workspace",
      file_processing: "file",
      report_build: "report",
      portfolio_sanitize: "profile_asset",
    } as const;
    return (
      targets[job.kind] === job.target.kind &&
      (job.status === "failed") === (job.failure !== null) &&
      (!job.retryable || job.status === "failed") &&
      (job.status !== "completed" || (job.progressPercent === 100 && job.phase === "finished")) &&
      (job.status !== "queued" || job.progressPercent === 0)
    );
  }, "Inconsistent job state");
export const v2AcceptedOperationSchema = z.strictObject({
  operationId: opaqueIdSchema,
  jobId: opaqueIdSchema,
  status: z.literal("queued"),
  retryAfter: z.number().int().min(1).max(300),
});
/** Server-owned ID allowlists; shape validation alone is never an ownership check. */
export function v2MessageForFilesSchema(fileIds: readonly string[], expectedRevision: number) {
  revisionSchema.parse(expectedRevision);
  return v2MessageRequestSchema.refine(
    (request) =>
      request.expectedRevision === expectedRevision &&
      request.selectedFileIds.every((id) => fileIds.includes(id)),
    "Stale revision or foreign file",
  );
}
export type V2CreateCaseRequest = z.infer<typeof v2CreateCaseRequestSchema>;
export type V2Workspace = z.infer<typeof v2WorkspaceSchema>;
export type V2MessageRequest = z.infer<typeof v2MessageRequestSchema>;
export type V2Message = z.infer<ReturnType<typeof v2MessageSchema>>;
export type V2TimelineEntry = z.infer<typeof v2TimelineEntrySchema>;
export type V2Action = z.infer<typeof v2ActionSchema>;
export type V2JobTarget = z.infer<typeof v2JobTargetSchema>;
export type V2Job = z.infer<typeof v2JobSchema>;
export type V2AcceptedOperation = z.infer<typeof v2AcceptedOperationSchema>;
export type V2WorkspaceStateRequest = z.infer<typeof v2WorkspaceStateRequestSchema>;
export type V2UpgradeRequest = z.infer<typeof v2UpgradeRequestSchema>;
export type V2UserMessage = z.infer<typeof v2UserMessageSchema>;
export type V2AssistantMessage = z.infer<ReturnType<typeof v2AssistantMessageSchema>>;
export type V2TimelineEditRequest = z.infer<typeof v2TimelineEditRequestSchema>;
export type V2ActionUpdateRequest = z.infer<typeof v2ActionUpdateRequestSchema>;
