import { expect, test } from "bun:test";
import type { z } from "zod";
import { answerSchema, createCaseRequestSchema, resultSchema } from "../src/contracts";
import {
  V2_LIMITS,
  v2ActionSchema,
  v2AnswersForBatchSchema,
  v2ApplicationDecisionRequestSchema,
  v2BudgetAdmissionSchema,
  v2BudgetLedgerSchema,
  v2CaseOriginalUsageSchema,
  v2CitationsForRetrievedSourcesSchema,
  v2CostAttemptSchema,
  v2CoverageSchema,
  v2CreateCaseRequestSchema,
  v2CurrentSummaryConfirmationSchema,
  v2DirectoryQuerySchema,
  v2ErrorSchema,
  v2FactSchema,
  v2FactsForSourcesSchema,
  v2FileProbeSchema,
  v2FileSchema,
  v2IntakeSchema,
  v2JobSchema,
  v2LawyerApplicationDraftRequestSchema,
  v2LawyerApplicationSchema,
  v2LawyerAssetUploadRequestSchema,
  v2MessageForFilesSchema,
  v2MessageSchema,
  v2ModerationDecisionSchema,
  v2OfficialCitationSchema,
  v2OfficialCitationsForRegistrySchema,
  v2OriginalManifestSchema,
  v2ProfileEditRequestSchema,
  v2ProfileRevisionSchema,
  v2ProfileSubmitForAssetsSchema,
  v2PublicLawyerSchema,
  v2ReportBodySchema,
  v2ReportCreateRequestSchema,
  v2ReportForSnapshotSchema,
  v2ReportSchema,
  v2SessionRolesSchema,
  v2StorageAdmissionSchema,
  v2SummaryEditForFactsSchema,
  v2SummaryEditRequestSchema,
  v2TimelineEditRequestSchema,
  v2TimelineEntrySchema,
  v2UploadReservationRequestSchema,
  v2UsageSchema,
  v2UserQuotaAdmissionSchema,
  v2WorkspaceSchema,
} from "../src/contracts/v2";
import { guidance } from "./fixtures/contracts";
import {
  action,
  application,
  assistantMessage,
  audioCoverage,
  batch,
  budget,
  citation,
  costAttempt,
  documentCoverage,
  guide,
  hash,
  intake,
  job,
  precedent,
  profileRevision,
  publicLawyer,
  quote,
  readyFile,
  rejectedFixtures,
  report,
  reportBody,
  reportRequest,
  roles,
  sourceContext,
  summary,
  time,
  timeline,
  usage,
  userMessage,
  v2FixtureMetadata,
  videoCoverage,
  workspace,
} from "./fixtures/contracts/v2";

function rejects(schema: z.ZodType, value: unknown) {
  expect(schema.safeParse(value).success).toBe(false);
}
function accepts(schema: z.ZodType, value: unknown) {
  expect(schema.safeParse(value).success).toBe(true);
}

test("v2 synthetic fixtures cover each complete domain without changing v1", () => {
  expect(v2FixtureMetadata.synthetic).toBe(true);
  accepts(v2SessionRolesSchema, roles);
  accepts(v2IntakeSchema, intake);
  accepts(v2WorkspaceSchema, workspace);
  accepts(v2MessageSchema(), userMessage);
  accepts(v2MessageSchema(), assistantMessage);
  accepts(v2TimelineEntrySchema, timeline);
  accepts(v2ActionSchema, action);
  accepts(v2JobSchema, job);
  accepts(v2FileSchema, readyFile);
  accepts(v2PublicLawyerSchema, publicLawyer);
  accepts(v2LawyerApplicationSchema, application);
  accepts(v2ProfileRevisionSchema, profileRevision);
  accepts(v2ReportSchema(), report);
  accepts(v2UsageSchema, usage);
  accepts(v2BudgetLedgerSchema, budget);
  accepts(v2CostAttemptSchema, costAttempt);
  accepts(resultSchema, guidance);
  rejects(v2WorkspaceSchema, rejectedFixtures.v1Workspace);
  rejects(resultSchema, { ...guidance, schemaVersion: "2" });
  accepts(createCaseRequestSchema, { narrative: intake.narrative, turnstileToken: "synthetic" });
  rejects(createCaseRequestSchema, {
    narrative: intake.narrative,
    subjectContext: "company",
    jurisdiction: "KR",
    turnstileToken: "synthetic",
  });
});

test("mutations cannot assign owner, role, status or carry opaque internal payloads", () => {
  const request = {
    narrative: intake.narrative,
    subjectContext: "company",
    jurisdiction: "KR",
    turnstileToken: "synthetic",
  };
  accepts(v2CreateCaseRequestSchema, request);
  for (const field of ["ownerId", "roles", "status", "schemaVersion", "teamId"])
    rejects(v2CreateCaseRequestSchema, { ...request, [field]: "synthetic" });
  rejects(v2ProfileEditRequestSchema, rejectedFixtures.forgedRoleMutation);
  rejects(v2JobSchema, rejectedFixtures.opaquePayloadJob);
  rejects(v2ErrorSchema, rejectedFixtures.rawError);
  rejects(v2SessionRolesSchema, { ...roles, roles: ["moderator"] });
  rejects(v2SessionRolesSchema, {
    ...roles,
    roles: ["user", "lawyer_applicant", "verified_lawyer"],
  });
  accepts(v2SessionRolesSchema, { ...roles, roles: ["user", "verified_lawyer", "moderator"] });
});

test("text bounds count Unicode code points, trim input and reject rendered HTML", () => {
  const request = {
    narrative: " 가".repeat(20),
    subjectContext: "individual",
    jurisdiction: "KR",
    turnstileToken: "synthetic",
  };
  accepts(v2CreateCaseRequestSchema, request);
  accepts(v2CreateCaseRequestSchema, { ...request, narrative: "😀".repeat(5000) });
  rejects(v2CreateCaseRequestSchema, { ...request, narrative: "😀".repeat(5001) });
  rejects(v2MessageSchema(), { ...assistantMessage, text: "<script>synthetic</script>" });
  rejects(v2MessageSchema(), rejectedFixtures.unvalidatedAssistant);
});

test("partial intake answers persist but advance validates all server questions and options", () => {
  const partial = {
    expectedRevision: 2,
    answers: [{ questionId: "q1", status: "answered", value: "합성 응답" }],
  };
  accepts(v2AnswersForBatchSchema(batch), partial);
  rejects(v2AnswersForBatchSchema(batch, true), partial);
  accepts(v2AnswersForBatchSchema(batch, true), { expectedRevision: 2, answers: batch.answers });
  for (const answer of [
    rejectedFixtures.skippedWithValue,
    { questionId: "q2", status: "answered", value: "없는 선택지" },
    { questionId: "foreign", status: "unknown" },
  ])
    rejects(v2AnswersForBatchSchema(batch), { expectedRevision: 2, answers: [answer] });
  rejects(v2AnswersForBatchSchema(batch), {
    ...partial,
    answers: [partial.answers[0], partial.answers[0]],
  });
  rejects(answerSchema, rejectedFixtures.skippedWithValue);
});

test("intake enforces 3x5 default batches, unique question IDs and resumable drafts", () => {
  const draft = { ...intake, status: "collecting", summary: null, confirmedSummaryRevision: null };
  accepts(v2IntakeSchema, draft);
  rejects(v2IntakeSchema, { ...draft, expiresAt: "2026-10-07T00:00:00Z" });
  const batches = [1, 2, 3].map((ordinal) => ({
    ...batch,
    id: `batch_${ordinal}`,
    ordinal,
    questions: batch.questions.map((q) => ({ ...q, id: `${q.id}_${ordinal}` })),
    answers: [],
  }));
  accepts(v2IntakeSchema, { ...draft, batches });
  rejects(v2IntakeSchema, {
    ...draft,
    batches: [...batches, { ...batch, id: "batch_4", ordinal: 4 }],
  });
  rejects(v2IntakeSchema, { ...draft, batches: [batch, { ...batch, id: "batch_2", ordinal: 2 }] });
  rejects(v2IntakeSchema, {
    ...draft,
    batches: [
      {
        ...batch,
        questions: Array.from({ length: 6 }, (_, i) => ({
          id: `q${i}`,
          prompt: "합성 질문",
          answerType: "text",
          options: [],
        })),
      },
    ],
  });
});

test("summary confirmation binds the current intake and summary revisions", () => {
  accepts(v2CurrentSummaryConfirmationSchema(2, 1), { expectedRevision: 2, summaryRevision: 1 });
  rejects(v2CurrentSummaryConfirmationSchema(3, 2), { expectedRevision: 2, summaryRevision: 1 });
  rejects(v2IntakeSchema, { ...intake, summary: { ...summary, intakeRevision: 1 } });
  rejects(v2IntakeSchema, { ...intake, status: "confirmed", confirmedSummaryRevision: 2 });
  accepts(v2IntakeSchema, { ...intake, status: "confirmed", confirmedSummaryRevision: 1 });
  rejects(v2WorkspaceSchema, { ...workspace, confirmedSummaryRevision: null });
  rejects(v2WorkspaceSchema, { ...workspace, status: "intake" });
  accepts(v2WorkspaceSchema, { ...workspace, status: "archived", archivedFrom: "active" });
  rejects(v2WorkspaceSchema, {
    ...workspace,
    status: "archived",
    archivedFrom: "active",
    currentJobId: "job_1",
  });
});

test("source ownership, positions, skipped answers and stale revisions are checked against server context", () => {
  accepts(v2FactsForSourcesSchema(sourceContext), summary.facts);
  const fact = summary.facts[0];
  expect(fact).toBeDefined();
  for (const reference of [
    { kind: "intake_answer", questionId: "q2", intakeRevision: 2 },
    { kind: "intake_answer", questionId: "q1", intakeRevision: 1 },
    { kind: "user_message", messageId: "foreign_message", workspaceRevision: 3 },
  ]) {
    rejects(v2FactsForSourcesSchema(sourceContext), [{ ...fact, references: [reference] }]);
  }
  const material = {
    ...fact,
    attribution: "user_material",
    certainty: "observed",
    references: [
      {
        kind: "user_material",
        fileId: "file_1",
        fileRevision: 1,
        position: { kind: "document", page: 1, paragraph: null, table: null },
      },
    ],
  };
  accepts(v2FactsForSourcesSchema(sourceContext), [material]);
  rejects(v2FactsForSourcesSchema({ ...sourceContext, files: [] }), [material]);
  rejects(
    v2FactsForSourcesSchema({
      ...sourceContext,
      files: [{ id: "file_1", revision: 2, category: "document", pageCount: 1 }],
    }),
    [material],
  );
  rejects(
    v2FactsForSourcesSchema({
      ...sourceContext,
      files: [{ id: "file_1", revision: 1, category: "image" }],
    }),
    [material],
  );
});

test("uncertainty, conflicting and unfavorable facts survive; user edits never become official facts", () => {
  const first = {
    ...summary.facts[0],
    id: "conflict_1",
    certainty: "conflicting",
    significance: "unfavorable",
    conflictingFactIds: ["conflict_2"],
  };
  const second = { ...first, id: "conflict_2", conflictingFactIds: ["conflict_1"] };
  accepts(v2FactsForSourcesSchema(sourceContext), [first, second]);
  rejects(v2FactsForSourcesSchema(sourceContext), [first]);
  rejects(v2FactSchema, { ...first, conflictingFactIds: ["conflict_1"] });
  rejects(v2FactSchema, {
    ...summary.facts[0],
    attribution: "ai_organization",
    certainty: "observed",
  });
  const official = {
    ...summary.facts[0],
    attribution: "official_source",
    references: [{ kind: "official_source", citationId: "citation_1" }],
  };
  accepts(v2FactsForSourcesSchema(sourceContext), [official]);
  rejects(v2FactsForSourcesSchema(sourceContext), [{ ...official, userEdited: true }]);
  rejects(v2FactsForSourcesSchema({ ...sourceContext, verifiedCitationIds: [] }), [official]);
});

test("official citations separate statute, precedent and registry-approved guide semantics", () => {
  const schema = v2OfficialCitationSchema(["www.klac.or.kr"]);
  for (const source of [citation, precedent, guide]) accepts(schema, source);
  rejects(v2OfficialCitationSchema([]), guide);
  rejects(schema, { ...precedent, effectiveDate: "2026-01-01" });
  rejects(schema, { ...citation, decisionDate: "2026-01-01" });
  for (const url of [
    "https://law.go.kr.evil.test/x",
    "http://law.go.kr/x",
    "https://user:secret@law.go.kr/x",
    "https://law.go.kr:444/x",
    "https://law.go.kr/x?OC=synthetic",
    "https://law.go.kr/x?token=synthetic",
  ])
    rejects(schema, { ...citation, url });
  rejects(schema, { ...guide, url: "https://unreviewed.go.kr/x" });
  rejects(schema, { ...citation, contentHash: "broken" });
});

test("chat selection and jobs bind revision and target kind without exposing internal bodies", () => {
  const request = { expectedRevision: 3, text: "합성 질문", selectedFileIds: ["file_1"] };
  accepts(v2MessageForFilesSchema(["file_1"], 3), request);
  rejects(v2MessageForFilesSchema([], 3), request);
  rejects(v2MessageForFilesSchema(["file_1"], 4), request);
  rejects(v2MessageForFilesSchema(["file_1"], 3), {
    ...request,
    selectedFileIds: ["file_1", "file_1"],
  });
  rejects(v2JobSchema, { ...job, kind: "report_build" });
  rejects(v2JobSchema, { ...job, status: "failed" });
  rejects(v2JobSchema, { ...job, status: "running", retryable: true });
  rejects(v2JobSchema, { ...job, status: "completed", progressPercent: 99, phase: "finished" });
  accepts(v2JobSchema, { ...job, status: "completed", progressPercent: 100, phase: "finished" });
  accepts(v2JobSchema, { ...job, status: "failed", failure: "MODEL_UNAVAILABLE", retryable: true });
});

test("timeline precision and navigation action categories prohibit impossible dates and strategy fields", () => {
  accepts(v2TimelineEditRequestSchema, {
    expectedRevision: 1,
    date: null,
    datePrecision: "unknown",
    event: "합성 사건",
  });
  rejects(v2TimelineEditRequestSchema, {
    expectedRevision: 1,
    date: "2026-02-02",
    datePrecision: "month",
    event: "합성 사건",
  });
  rejects(v2TimelineEntrySchema, { ...timeline, date: "2026-01-01" });
  rejects(v2ActionSchema, { ...action, kind: "litigation_strategy" });
  rejects(v2ActionSchema, { ...action, winProbability: 0.9 });
  rejects(v2ActionSchema, { ...action, kind: "official_guide_check" });
  accepts(v2ActionSchema, {
    ...action,
    kind: "official_guide_check",
    references: [{ kind: "official_source", citationId: "guide_1" }],
  });
});

test("multipart originals enforce 8MiB boundaries, order, hash and total without binary buffering", () => {
  const full = { index: 0, byteLength: V2_LIMITS.chunkBytes, contentHash: hash };
  const last = { index: 1, byteLength: 100, contentHash: hash };
  const manifest = {
    byteLength: full.byteLength + last.byteLength,
    contentHash: hash,
    parts: [full, last],
  };
  accepts(v2OriginalManifestSchema, manifest);
  rejects(v2OriginalManifestSchema, { ...manifest, parts: [last, full] });
  rejects(v2OriginalManifestSchema, { ...manifest, parts: [full, { ...last, index: 2 }] });
  rejects(v2OriginalManifestSchema, { ...manifest, byteLength: manifest.byteLength - 1 });
  rejects(v2OriginalManifestSchema, {
    byteLength: 200,
    contentHash: hash,
    parts: [{ ...full, byteLength: 100 }, last],
  });
  rejects(v2OriginalManifestSchema, {
    byteLength: V2_LIMITS.chunkBytes + 1,
    contentHash: hash,
    parts: [{ ...full, byteLength: V2_LIMITS.chunkBytes + 1 }],
  });
  const request = {
    name: "합성.pdf",
    byteLength: 100,
    mediaType: "application/pdf",
    autoProcessConsentVersion: "synthetic-v2",
  };
  accepts(v2UploadReservationRequestSchema, request);
  rejects(v2UploadReservationRequestSchema, { ...request, name: "../synthetic.pdf" });
  rejects(v2UploadReservationRequestSchema, { ...request, byteLength: 1_000_000_001 });
  rejects(v2UploadReservationRequestSchema, { ...request, durationSeconds: 0 });
});

test("server probes cover the required document corpus and decimal size/duration/page limits", () => {
  for (const format of ["pdf", "txt", "docx", "hwp", "hwpx", "xlsx", "pptx", "doc", "xls", "ppt"]) {
    accepts(v2FileProbeSchema, {
      category: "document",
      format,
      byteLength: 100_000_000,
      pageCount: 500,
    });
  }
  for (const category of ["audio", "video"]) {
    const probe = {
      category,
      format: category === "audio" ? "wav" : "mp4",
      byteLength: 1_000_000_000,
      durationSeconds: 3600,
      ...(category === "video" ? { hasAudio: false } : {}),
    };
    accepts(v2FileProbeSchema, probe);
    rejects(v2FileProbeSchema, { ...probe, durationSeconds: 0 });
    rejects(v2FileProbeSchema, { ...probe, durationSeconds: 3600.01 });
    rejects(v2FileProbeSchema, { ...probe, byteLength: 1_000_000_001 });
  }
  rejects(v2FileProbeSchema, { category: "audio", format: "wav", byteLength: 100 });
  rejects(v2FileProbeSchema, { ...readyFile.probe, pageCount: 501 });
  rejects(v2FileProbeSchema, { ...readyFile.probe, byteLength: 100_000_001 });
});

test("document/audio coverage accounts for every page and time interval including silence and failures", () => {
  accepts(v2CoverageSchema, documentCoverage);
  accepts(v2CoverageSchema, audioCoverage);
  rejects(v2CoverageSchema, { ...documentCoverage, pageCount: 2 });
  const partial = {
    category: "document",
    status: "partial",
    pageCount: 2,
    pages: [
      { page: 1, status: "processed" },
      { page: 2, status: "failed" },
    ],
  };
  accepts(v2CoverageSchema, partial);
  rejects(v2CoverageSchema, { ...partial, status: "complete" });
  rejects(v2CoverageSchema, {
    category: "audio",
    audio: {
      durationSeconds: 2,
      status: "complete",
      intervals: [{ startSeconds: 0, endSeconds: 1, status: "processed" }],
    },
  });
  const missing = {
    category: "audio",
    audio: {
      durationSeconds: 2,
      status: "partial",
      intervals: [
        { startSeconds: 0, endSeconds: 1, status: "processed" },
        { startSeconds: 1, endSeconds: 2, status: "missing" },
      ],
    },
  };
  accepts(v2CoverageSchema, missing);
  rejects(v2CoverageSchema, { ...missing, audio: { ...missing.audio, status: "complete" } });
});

test("video coverage requires all 1-second frames, scene detection and the whole audio track", () => {
  accepts(v2CoverageSchema, videoCoverage);
  if (videoCoverage.category !== "video") throw new Error("fixture must be video");
  rejects(v2CoverageSchema, { ...videoCoverage, frames: videoCoverage.frames.slice(1) });
  rejects(v2CoverageSchema, { ...videoCoverage, audio: null });
  rejects(v2CoverageSchema, { ...videoCoverage, sceneDetection: "failed" });
  rejects(v2CoverageSchema, { ...videoCoverage, sceneFrameCount: null });
  rejects(v2CoverageSchema, {
    ...videoCoverage,
    frames: videoCoverage.frames.filter((frame) => frame.sampling !== "scene_change"),
  });
  const partial = {
    ...videoCoverage,
    status: "partial",
    frames: videoCoverage.frames.map((frame) =>
      frame.id === "frame_1" ? { ...frame, status: "missing" } : frame,
    ),
  };
  accepts(v2CoverageSchema, partial);
  rejects(v2CoverageSchema, { ...partial, status: "complete" });
  accepts(v2CoverageSchema, { ...videoCoverage, hasAudio: false, audio: null });
  rejects(v2CoverageSchema, {
    ...videoCoverage,
    frames: [...videoCoverage.frames, videoCoverage.frames[0]],
  });
  const oneHour = {
    ...videoCoverage,
    durationSeconds: 3600,
    hasAudio: false,
    audio: null,
    frames: Array.from({ length: 3600 }, (_, second) => ({
      id: `second_${second}`,
      timestampSeconds: second,
      frameIndex: second * 30,
      sampling: "one_second",
      status: "processed",
    })),
    sceneFrameCount: 0,
  };
  accepts(v2CoverageSchema, oneHour);
  rejects(v2CoverageSchema, { ...oneHour, frames: oneHour.frames.slice(0, 3599) });
});

test("file readiness binds verified probe, completed upload, coverage and material coordinates", () => {
  rejects(v2FileSchema, { ...readyFile, probe: null });
  rejects(v2FileSchema, { ...readyFile, manifest: null });
  rejects(v2FileSchema, { ...readyFile, coverage: null });
  rejects(v2FileSchema, { ...readyFile, currentJobId: "still_running" });
  rejects(v2FileSchema, { ...readyFile, byteLength: 101 });
  rejects(v2FileSchema, {
    ...readyFile,
    coverage: { category: "image", status: "complete", observation: "processed" },
  });
  rejects(v2FileSchema, {
    ...readyFile,
    observations: readyFile.observations.map((observation) => ({
      ...observation,
      position: { kind: "document", page: 2, paragraph: null, table: null },
    })),
  });
  rejects(v2FileSchema, {
    ...readyFile,
    observations: readyFile.observations.map((observation) => ({
      ...observation,
      userEdited: true,
      certainty: "observed",
    })),
  });
  const pending = {
    ...readyFile,
    status: "reserved",
    probe: null,
    manifest: null,
    coverage: null,
    observations: [],
    derivatives: [],
    operationId: null,
  };
  accepts(v2FileSchema, pending);
  rejects(v2FileSchema, { ...pending, observations: readyFile.observations });
  accepts(v2FileSchema, { ...readyFile, status: "failed", failure: "FILE_PROCESSING_FAILED" });
});

test("private application approval and all public edits require review; no client verified flag", () => {
  rejects(v2LawyerApplicationSchema, { ...application, reviewerId: application.applicantId });
  rejects(v2LawyerApplicationSchema, {
    ...application,
    checklist: { identity: true, lawyerLicense: false, office: true },
  });
  rejects(v2LawyerApplicationSchema, {
    ...application,
    content: {
      ...application.content,
      assets: [
        {
          id: "verification_1",
          purpose: "lawyer_license",
          status: "uploaded",
          byteLength: 100,
          contentHash: hash,
        },
      ],
    },
  });
  accepts(v2ProfileEditRequestSchema, {
    expectedRevision: 2,
    content: { introduction: "새 합성 소개" },
  });
  rejects(v2ProfileEditRequestSchema, { expectedRevision: 2, content: { verified: true } });
  rejects(v2ProfileRevisionSchema, { ...profileRevision, status: "approved" });
  rejects(v2PublicLawyerSchema, { ...publicLawyer, rejectionReason: "비공개 심사 의견" });
  rejects(v2PublicLawyerSchema, { ...publicLawyer, verificationAssets: application });
  rejects(v2PublicLawyerSchema, {
    ...publicLawyer,
    assets: publicLawyer.assets.map((asset) => ({ ...asset, approvedRevision: 1 })),
  });
  rejects(v2PublicLawyerSchema, {
    ...publicLawyer,
    assets: publicLawyer.assets.map((asset) => ({ ...asset, sanitization: "pending" })),
  });
});

test("moderation decisions require a different authorized reviewer, recent OAuth and exact submitted revision", () => {
  const context = {
    applicantId: "applicant_1",
    reviewerId: "reviewer_1",
    roles: ["user", "moderator"],
    reauthenticatedAt: time,
    now: "2026-10-06T00:10:00Z",
    expectedRevision: 1,
    state: "submitted" as const,
  };
  const decision = {
    expectedRevision: 1,
    decision: "approved",
    reason: "합성 심사",
    checklist: { identity: true, lawyerLicense: true, office: true },
  };
  accepts(v2ModerationDecisionSchema(context, "application"), decision);
  for (const changed of [
    { ...context, reviewerId: "applicant_1" },
    { ...context, roles: ["user"] },
    { ...context, now: "2026-10-06T00:10:01Z" },
    { ...context, now: "2026-10-05T23:59:59Z" },
    { ...context, state: "withdrawn" as const },
    { ...context, expectedRevision: 2 },
  ]) {
    rejects(v2ModerationDecisionSchema(changed, "application"), decision);
  }
  rejects(v2ApplicationDecisionRequestSchema, {
    expectedRevision: 1,
    decision: "rejected",
    reason: "  ",
  });
  rejects(v2ApplicationDecisionRequestSchema, {
    ...decision,
    role: "moderator",
    reviewerId: "reviewer_1",
  });
});

test("directory accepts objective filters and rejects case-based ranking and unsafe public links", () => {
  accepts(v2DirectoryQuerySchema, { region: "seoul", legalField: "other" });
  for (const field of ["caseId", "narrative", "aiFitScore", "paidPriority", "reviewScore"])
    rejects(v2DirectoryQuerySchema, { [field]: "synthetic" });
  for (const consultationUrl of [
    "javascript:alert(1)",
    "http://lawyer.test/x",
    "https://localhost/x",
    "https://127.0.0.1/x",
    "https://user:pass@lawyer.com/x",
    "https://lawyer.com/x?caseId=synthetic",
  ]) {
    rejects(v2PublicLawyerSchema, {
      ...publicLawyer,
      content: { ...publicLawyer.content, contact: { phone: null, email: null, consultationUrl } },
    });
  }
  accepts(v2PublicLawyerSchema, {
    ...publicLawyer,
    content: {
      ...publicLawyer.content,
      contact: { phone: null, email: null, consultationUrl: "https://lawyer.com/consultation" },
    },
  });
});

test("report review keeps PDF masking separate from selected original bytes and requires original warning acknowledgment", () => {
  rejects(v2ReportCreateRequestSchema, { ...reportRequest, reviewConfirmed: false });
  rejects(v2ReportCreateRequestSchema, { ...reportRequest, originalsUnmaskedAcknowledged: false });
  rejects(v2ReportCreateRequestSchema, { ...reportRequest, selectedFileIds: [] });
  rejects(v2ReportCreateRequestSchema, { ...reportRequest, selectedFileIds: ["file_1", "file_1"] });
  rejects(v2ReportSchema(), {
    ...report,
    originalManifest: report.originalManifest.map((file) => ({
      ...file,
      contentHash: "c".repeat(64),
    })),
  });
  rejects(v2ReportSchema(), { ...report, originalsZip: null });
  rejects(v2ReportSchema(), { ...report, pdf: null });
  accepts(v2ReportSchema(), {
    ...report,
    request: {
      ...reportRequest,
      maskingChoices: [{ partyId: "party_1", mode: "mask", replacement: "당사자 A" }],
    },
  });
  accepts(v2ReportSchema(), { ...report, status: "obsolete" });
});

test("report edits/selection/reference validation bind the owned immutable snapshot and preserve unfavorable facts", () => {
  const snapshot = {
    revision: 4,
    fileIds: ["file_1"],
    factIds: ["fact_1"],
    partyIds: ["party_1"],
    lawyerQuestionIds: ["lawyer_question_1"],
  };
  accepts(v2ReportForSnapshotSchema(snapshot), reportRequest);
  rejects(v2ReportForSnapshotSchema({ ...snapshot, revision: 5 }), reportRequest);
  rejects(v2ReportForSnapshotSchema({ ...snapshot, fileIds: [] }), reportRequest);
  rejects(v2ReportForSnapshotSchema(snapshot), {
    ...reportRequest,
    editedFields: [{ field: "fact", factId: "foreign", text: "합성 수정" }],
  });
  rejects(v2ReportForSnapshotSchema(snapshot), {
    ...reportRequest,
    maskingChoices: [{ partyId: "foreign", mode: "keep" }],
  });
  rejects(v2ReportSchema(), { ...report, snapshotRevision: 5 });
  rejects(v2ReportBodySchema(), {
    ...reportBody,
    timeline: [{ ...timeline, factIds: ["foreign"] }],
  });
  accepts(v2ReportBodySchema(), {
    ...reportBody,
    facts: reportBody.facts.map((fact) => ({ ...fact, significance: "unfavorable" })),
  });
  rejects(v2ReportBodySchema(), {
    ...reportBody,
    actions: [{ ...action, references: [{ kind: "official_source", citationId: "missing" }] }],
  });
});

test("factual reports remain possible during official-source failure without unverified legal citations", () => {
  const factual = { ...reportBody, citations: [], legalSourceStatus: "unavailable" };
  accepts(v2ReportBodySchema(), factual);
  rejects(v2ReportBodySchema(), { ...factual, citations: [citation] });
  accepts(v2ReportBodySchema(["www.klac.or.kr"]), { ...reportBody, citations: [citation, guide] });
  rejects(v2ReportBodySchema(), { ...reportBody, citations: [citation, guide] });
});

test("case original limits and account total storage keep decimal bytes and pending reservations separate", () => {
  accepts(v2CaseOriginalUsageSchema, {
    count: { limit: 100, used: 99, reserved: 1, remaining: 0 },
    originalBytes: {
      limit: 5_000_000_000,
      used: 4_000_000_000,
      reserved: 1_000_000_000,
      remaining: 0,
    },
  });
  accepts(v2UsageSchema, {
    ...usage,
    storageBytes: {
      limit: 10_000_000_000,
      used: 9_000_000_000,
      reserved: 1_000_000_000,
      remaining: 0,
    },
  });
  accepts(v2UsageSchema, {
    ...usage,
    storageBytes: { limit: 10_000_000_000, used: 10_000_000_000, reserved: 1, remaining: 0 },
  });
  rejects(v2UsageSchema, {
    ...usage,
    storageBytes: {
      limit: 10 * 1024 ** 3,
      used: 100,
      reserved: 0,
      remaining: 10 * 1024 ** 3 - 100,
    },
  });
  rejects(v2UsageSchema, { ...usage, newCases: { limit: 10, used: 1, reserved: 0, remaining: 9 } });
  accepts(v2UsageSchema, { ...usage, newCases: { limit: 3, used: 2, reserved: 2, remaining: 0 } });
  rejects(v2UsageSchema, { ...usage, resetAt: "2026-10-07T00:00:00Z" });
});

test("logical visible responses are distinct from actual attempt cost and ambiguity stays reserved", () => {
  const retry = { ...costAttempt, id: "attempt_2", attempt: 2, state: "settled", chargedKrw: 90 };
  accepts(v2CostAttemptSchema, retry);
  accepts(v2CostAttemptSchema, costAttempt);
  rejects(v2CostAttemptSchema, { ...costAttempt, chargedKrw: 0 });
  rejects(v2CostAttemptSchema, { ...costAttempt, state: "settled", chargedKrw: null });
  rejects(v2CostAttemptSchema, { ...costAttempt, userQuotaChargedAgain: true });
  rejects(v2BudgetLedgerSchema, { ...budget, ambiguousKrw: 0 });
  accepts(v2BudgetAdmissionSchema(budget, time), quote);
  rejects(v2BudgetAdmissionSchema(budget, time), {
    ...quote,
    estimatedKrw: (budget.availableKrw ?? 0) + 1,
  });
  rejects(v2BudgetAdmissionSchema(budget, "2026-10-07T00:00:00Z"), quote);
  const exhausted = { ...budget, settledKrw: 1_000_000, availableKrw: 0 };
  accepts(v2BudgetLedgerSchema, exhausted);
  rejects(v2BudgetAdmissionSchema(exhausted, time), quote);
  const unlimited = { ...exhausted, limitKrw: null, availableKrw: null };
  accepts(v2BudgetLedgerSchema, unlimited);
  accepts(v2BudgetAdmissionSchema(unlimited, time), quote);
  rejects(v2BudgetLedgerSchema, { ...unlimited, availableKrw: 0 });
});

test("timestamp checks compare instants across ISO fractional precision and preserve KST midnight", () => {
  accepts(v2UsageSchema, { ...usage, resetAt: "2026-10-06T15:00:00.000Z" });
  rejects(v2UsageSchema, { ...usage, resetAt: "2026-10-06T15:00:00.001Z" });
  accepts(v2WorkspaceSchema, {
    ...workspace,
    createdAt: "2026-10-06T00:00:00Z",
    updatedAt: "2026-10-06T00:00:00.001Z",
  });
  rejects(v2WorkspaceSchema, {
    ...workspace,
    createdAt: "2026-10-06T00:00:00.001Z",
    updatedAt: time,
  });
  const shortQuote = { ...quote, reviewedAt: time, validUntil: "2026-10-06T00:00:00.001Z" };
  accepts(v2BudgetAdmissionSchema(budget, time), shortQuote);
  rejects(v2BudgetAdmissionSchema(budget, "2026-10-06T00:00:00.001Z"), shortQuote);
  rejects(v2BudgetAdmissionSchema(budget, time), {
    ...quote,
    reviewedAt: "2026-10-06T00:00:00.001Z",
  });
});

test("derivative coordinates remain within the actual source even when failed or deleting", () => {
  for (const status of ["ready", "failed", "deleting"]) {
    const file = {
      ...readyFile,
      status,
      failure: status === "failed" ? "FILE_PROCESSING_FAILED" : null,
    };
    rejects(v2FileSchema, {
      ...file,
      derivatives: readyFile.derivatives.map((derivative) => ({
        ...derivative,
        sourcePosition: { kind: "document", page: 2, paragraph: null, table: null },
      })),
    });
    rejects(v2FileSchema, {
      ...file,
      derivatives: readyFile.derivatives.map((derivative) => ({
        ...derivative,
        sourcePosition: {
          kind: "video",
          timestampSeconds: 0,
          frameIndex: 0,
          sampling: "one_second",
        },
      })),
    });
  }
});

test("truthful over-budget actual charges remain recordable while new paid admission is blocked", () => {
  const overage = 1_500_000;
  accepts(v2CostAttemptSchema, { ...costAttempt, state: "settled", chargedKrw: overage });
  const observed = { ...budget, settledKrw: overage, availableKrw: 0 };
  accepts(v2BudgetLedgerSchema, observed);
  rejects(v2BudgetAdmissionSchema(observed, time), quote);
  rejects(v2CostAttemptSchema, { ...costAttempt, reservedKrw: overage });
  rejects(v2CostAttemptSchema, { ...costAttempt, state: "settled", chargedKrw: 0.1 });
  rejects(v2BudgetLedgerSchema, {
    ...budget,
    settledKrw: Number.MAX_SAFE_INTEGER,
    reservedKrw: Number.MAX_SAFE_INTEGER,
    availableKrw: 0,
  });
  accepts(v2UsageSchema, {
    ...usage,
    mediaSeconds: { limit: 3600, used: 2.5, reserved: 0.25, remaining: 3597.25 },
  });
});

test("profile submission accepts only approved applicants with safe owned photo and portfolio staging", () => {
  const photo = {
    id: "photo_1",
    revision: 1,
    kind: "image",
    status: "ready",
    byteLength: 100,
    originalHash: hash,
    sanitizedDerivative: { id: "safe_photo_1", contentHash: hash, byteLength: 90, format: "png" },
    currentJobId: null,
    failure: null,
  };
  const context = {
    applicationState: "approved" as const,
    revision: 2,
    content: publicLawyer.content,
    assets: [photo],
  };
  accepts(v2ProfileSubmitForAssetsSchema(context), { expectedRevision: 2 });
  rejects(v2ProfileSubmitForAssetsSchema({ ...context, applicationState: "submitted" }), {
    expectedRevision: 2,
  });
  rejects(v2ProfileSubmitForAssetsSchema({ ...context, assets: [] }), { expectedRevision: 2 });
  rejects(v2ProfileSubmitForAssetsSchema(context), { expectedRevision: 1 });
  rejects(
    v2ProfileSubmitForAssetsSchema({
      ...context,
      assets: [{ ...photo, status: "uploaded", sanitizedDerivative: null }],
    }),
    { expectedRevision: 2 },
  );
  const assetRequest = {
    name: "synthetic.png",
    byteLength: 100,
    mediaType: "image/png",
    purpose: "profile_photo",
  };
  accepts(v2LawyerAssetUploadRequestSchema, assetRequest);
  rejects(v2LawyerAssetUploadRequestSchema, { ...assetRequest, mediaType: "image/svg+xml" });
  rejects(v2LawyerAssetUploadRequestSchema, { ...assetRequest, mediaType: "application/pdf" });
});

test("registered guide endpoints and exact retrieved citation content prevent fabricated official sources", () => {
  const registry = [
    {
      institutionId: "synthetic_institution",
      endpointId: "synthetic_endpoint",
      host: "www.klac.or.kr",
      pathPrefix: "/legalstruct",
    },
  ];
  accepts(v2OfficialCitationsForRegistrySchema(registry), [citation, precedent, guide]);
  rejects(v2OfficialCitationsForRegistrySchema(registry), [
    { ...guide, endpointId: "fabricated_endpoint" },
  ]);
  rejects(v2OfficialCitationsForRegistrySchema(registry), [
    { ...guide, url: "https://www.klac.or.kr/legalstruct-redirect" },
  ]);
  accepts(v2CitationsForRetrievedSourcesSchema([citation]), [citation]);
  rejects(v2CitationsForRetrievedSourcesSchema([citation]), [precedent]);
  for (const changed of [
    { ...citation, title: "조작한 인용" },
    { ...citation, sourceId: "fabricated_source" },
    { ...citation, contentHash: "c".repeat(64) },
    { ...citation, effectiveDate: "2025-01-01" },
  ]) {
    rejects(v2CitationsForRetrievedSourcesSchema([citation]), [changed]);
  }
});

test("coverage marks low-quality materials as partial instead of claiming complete interpretation", () => {
  const lowQualityAudio = {
    category: "audio",
    audio: {
      durationSeconds: 1,
      status: "partial",
      intervals: [{ startSeconds: 0, endSeconds: 1, status: "low_quality" }],
    },
  };
  accepts(v2CoverageSchema, lowQualityAudio);
  rejects(v2CoverageSchema, {
    ...lowQualityAudio,
    audio: { ...lowQualityAudio.audio, status: "complete" },
  });
  accepts(v2CoverageSchema, { category: "image", status: "partial", observation: "low_quality" });
  rejects(v2CoverageSchema, { category: "image", status: "complete", observation: "low_quality" });
});

test("legacy cutover and reconciliation preserve observed quota overages without new allowances", () => {
  const overage = {
    ...usage,
    newCases: { limit: 3, used: 10, reserved: 0, remaining: 0 },
    aiResponses: { limit: 200, used: 201, reserved: 1, remaining: 0 },
    mediaSeconds: { limit: 3600, used: 3601.5, reserved: 0, remaining: 0 },
  };
  accepts(v2UsageSchema, overage);
  rejects(v2UsageSchema, { ...overage, newCases: { ...overage.newCases, remaining: 1 } });
  for (const quota of [
    { kind: "new_case", units: 1 },
    { kind: "visible_ai_response", units: 1, responseKind: "chat" },
    { kind: "media_processing", originalDurationSeconds: 0.1 },
  ])
    rejects(v2UserQuotaAdmissionSchema(overage), quota);
  accepts(v2UserQuotaAdmissionSchema(overage), { kind: "no_user_quota", reason: "read" });
  accepts(v2UserQuotaAdmissionSchema(overage), { kind: "no_user_quota", reason: "delete" });
});

test("initial narrative is a real source and editing cannot promote a material observation", () => {
  const initial = {
    ...summary.facts[0],
    references: [{ kind: "intake_narrative", intakeRevision: 2 }],
  };
  accepts(v2FactsForSourcesSchema(sourceContext), [initial]);
  rejects(v2FactsForSourcesSchema(sourceContext), [
    { ...initial, references: [{ kind: "intake_narrative", intakeRevision: 1 }] },
  ]);
  const editedMaterial = {
    ...summary.facts[0],
    attribution: "user_material",
    userEdited: true,
    certainty: "observed",
    references: [
      {
        kind: "user_material",
        fileId: "file_1",
        fileRevision: 1,
        position: { kind: "document", page: 1, paragraph: null, table: null },
      },
    ],
  };
  rejects(v2FactsForSourcesSchema(sourceContext), [editedMaterial]);
  accepts(v2FactsForSourcesSchema(sourceContext), [{ ...editedMaterial, certainty: "uncertain" }]);
  rejects(v2TimelineEntrySchema, { ...timeline, userEdited: true, certainty: "observed" });
});

test("PDF can retain a sourced material while its sensitive original is excluded from the ZIP", () => {
  const sensitive = {
    ...reportBody.selectedFiles[0],
    id: "sensitive_2",
    revision: 1,
    name: "합성-민감자료.pdf",
    byteLength: 100,
    contentHash: hash,
  };
  const partialOriginals = {
    ...report,
    request: {
      ...reportRequest,
      selectedFileIds: ["file_1", "sensitive_2"],
      selectedOriginalFileIds: ["file_1"],
    },
    body: { ...reportBody, selectedFiles: [...reportBody.selectedFiles, sensitive] },
  };
  accepts(v2ReportSchema(), partialOriginals);
  rejects(v2ReportSchema(), {
    ...partialOriginals,
    originalManifest: [...report.originalManifest, sensitive],
  });
  rejects(v2ReportCreateRequestSchema, { ...reportRequest, selectedOriginalFileIds: ["foreign"] });
  rejects(v2ReportCreateRequestSchema, { ...reportRequest, selectedOriginalFileIds: [] });
});

test("summary patches and partial application drafts are bounded and cannot write server provenance", () => {
  const patch = {
    expectedRevision: 1,
    factEdits: [{ factId: "fact_1", text: "합성 사용자 보완" }],
  };
  accepts(v2SummaryEditForFactsSchema(["fact_1"], 1), patch);
  rejects(v2SummaryEditForFactsSchema([], 1), patch);
  rejects(v2SummaryEditForFactsSchema(["fact_1"], 2), patch);
  rejects(v2SummaryEditRequestSchema, { expectedRevision: 1 });
  rejects(v2SummaryEditRequestSchema, { expectedRevision: 1, facts: summary.facts });
  rejects(v2SummaryEditRequestSchema, {
    expectedRevision: 1,
    factEdits: [{ factId: "fact_1", text: "합성 보완", attribution: "official_source" }],
  });
  rejects(v2SummaryEditRequestSchema, {
    expectedRevision: 1,
    factEdits: Array.from({ length: 100 }, (_, index) => ({
      factId: `fact_${index}`,
      text: "가".repeat(2000),
    })),
  });
  accepts(v2LawyerApplicationDraftRequestSchema, {
    expectedRevision: 1,
    content: { office: { region: "seoul" }, verificationAssetIds: [] },
  });
  accepts(v2LawyerApplicationSchema, {
    schemaVersion: "2",
    id: "draft_1",
    applicantId: "applicant_1",
    revision: 1,
    createdAt: time,
    status: "draft",
    content: { office: { region: "seoul" }, assets: [] },
  });
});

test("many paid invocations per visible operation each have their own bounded retry ordinal", () => {
  for (let invocation = 1; invocation <= 50; invocation += 1)
    accepts(v2CostAttemptSchema, {
      ...costAttempt,
      id: `attempt_${invocation}`,
      invocationId: `invocation_${invocation}`,
      attempt: 1,
    });
  rejects(v2CostAttemptSchema, { ...costAttempt, invocationId: undefined });
  rejects(v2CostAttemptSchema, { ...costAttempt, attempt: 11 });
});

test("storage admission reserves originals against both scopes while derivatives use account capacity", () => {
  const fullOriginals = {
    count: { limit: 100, used: 100, reserved: 0, remaining: 0 },
    originalBytes: { limit: 5_000_000_000, used: 5_000_000_000, reserved: 0, remaining: 0 },
  };
  const original = {
    id: "reservation_original_1",
    kind: "case_original",
    caseId: "case_synthetic_1",
    fileId: "file_1",
    byteLength: 100,
    state: "reserved",
  };
  rejects(
    v2StorageAdmissionSchema(usage, { caseId: "case_synthetic_1", usage: fullOriginals }),
    original,
  );
  accepts(v2StorageAdmissionSchema(usage, { caseId: "case_synthetic_1", usage: fullOriginals }), {
    id: "reservation_derived_1",
    kind: "derived_or_report",
    caseId: "case_synthetic_1",
    operationId: "operation_report_1",
    byteLength: 100,
    state: "reserved",
  });
  const availableOriginals = {
    count: { limit: 100, used: 99, reserved: 0, remaining: 1 },
    originalBytes: { limit: 5_000_000_000, used: 4_999_999_900, reserved: 0, remaining: 100 },
  };
  accepts(
    v2StorageAdmissionSchema(usage, { caseId: "case_synthetic_1", usage: availableOriginals }),
    original,
  );
  rejects(
    v2StorageAdmissionSchema(usage, { caseId: "wrong_case", usage: availableOriginals }),
    original,
  );
  rejects(
    v2StorageAdmissionSchema(
      {
        ...usage,
        storageBytes: { limit: 10_000_000_000, used: 10_000_000_001, reserved: 0, remaining: 0 },
      },
      { caseId: "case_synthetic_1", usage: availableOriginals },
    ),
    original,
  );
});
