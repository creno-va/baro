import type {
  V2Action,
  V2BudgetLedger,
  V2CostAttempt,
  V2CostQuote,
  V2Coverage,
  V2File,
  V2FileProbe,
  V2Intake,
  V2Job,
  V2LawyerApplication,
  V2Message,
  V2OfficialCitation,
  V2ProfileRevision,
  V2PublicLawyer,
  V2QuestionBatch,
  V2ReferenceContext,
  V2Report,
  V2ReportBody,
  V2ReportCreateRequest,
  V2SessionRoles,
  V2Summary,
  V2TimelineEntry,
  V2Usage,
  V2Workspace,
} from "../../../../src/contracts/v2";

export const v2FixtureMetadata = {
  schemaVersion: "2",
  synthetic: true,
  reviewedAt: "2026-10-06",
  purpose: "Strict contracts only; no real identities, licenses, laws or release evidence",
} as const;
export const time = "2026-10-06T00:00:00Z";
export const hash = "b".repeat(64);
export const roles: V2SessionRoles = {
  schemaVersion: "2",
  roles: ["user", "verified_lawyer"],
  reauthenticatedAt: time,
};
export const batch: V2QuestionBatch = {
  id: "batch_1",
  ordinal: 1,
  generatedForIntakeRevision: 1,
  questions: [
    { id: "q1", prompt: "어떤 자료를 보유하고 있나요?", answerType: "text", options: [] },
    {
      id: "q2",
      prompt: "사건의 날짜를 알고 있나요?",
      answerType: "choice",
      options: ["알고 있음", "모름"],
    },
  ],
  answers: [
    { questionId: "q1", status: "answered", value: "합성 문서 한 개가 있습니다." },
    { questionId: "q2", status: "unknown" },
  ],
};
export const summary: V2Summary = {
  schemaVersion: "2",
  revision: 1,
  intakeRevision: 2,
  createdAt: time,
  overview: "합성 사건 자료와 미확인 날짜를 분리한 요약입니다.",
  facts: [
    {
      id: "fact_1",
      text: "사용자가 합성 문서 한 개를 보유했다고 진술했습니다.",
      attribution: "user_statement",
      certainty: "reported",
      significance: "neutral",
      userEdited: false,
      references: [{ kind: "intake_answer", questionId: "q1", intakeRevision: 2 }],
      conflictingFactIds: [],
    },
  ],
  parties: [{ id: "party_1", label: "합성 당사자 A", role: "자료를 정리하는 사용자" }],
  unknowns: ["사건 발생 날짜가 확인되지 않았습니다."],
  notices: ["합성 예시이며 법률 판단이 아닙니다."],
};
export const intake: V2Intake = {
  schemaVersion: "2",
  revision: 2,
  status: "reviewing_summary",
  narrative: "합성 사건에서 자료를 정리하고 확인되지 않은 날짜를 확인하려 합니다.",
  batches: [batch],
  summary,
  confirmedSummaryRevision: null,
  currentJobId: null,
};
export const workspace: V2Workspace = {
  schemaVersion: "2",
  id: "case_synthetic_1",
  title: "사건 작업 공간",
  subjectContext: "company",
  jurisdiction: "KR",
  status: "active",
  archivedFrom: null,
  workspaceRevision: 3,
  intakeRevision: 2,
  confirmedSummaryRevision: 1,
  currentJobId: null,
  legacySnapshotId: "legacy_synthetic_1",
  createdAt: time,
  updatedAt: time,
};
export const userMessage: V2Message = {
  schemaVersion: "2",
  id: "message_1",
  operationId: "operation_chat_1",
  workspaceRevision: 3,
  createdAt: time,
  role: "user",
  text: "합성 자료의 날짜를 다시 정리해주세요.",
  selectedFileIds: ["file_1"],
};
export const citation: V2OfficialCitation = {
  id: "citation_1",
  sourceId: "source_synthetic_1",
  title: "합성 법령 계약 fixture",
  kind: "statute",
  officialId: "synthetic_statute",
  article: "합성 제1조",
  effectiveDate: "2026-01-01",
  verifiedAt: time,
  contentHash: hash,
  url: "https://law.go.kr/LSW/lsInfoP.do?lsiSeq=0",
};
export const precedent: V2OfficialCitation = {
  id: "precedent_1",
  sourceId: "source_synthetic_2",
  title: "합성 판례 계약 fixture",
  kind: "precedent",
  officialId: "synthetic_precedent",
  court: "합성 법원",
  caseNumber: "합성 사건번호",
  decisionDate: "2026-01-01",
  verifiedAt: time,
  contentHash: hash,
  url: "https://law.go.kr/LSW/precInfoP.do?precSeq=0",
};
export const guide: V2OfficialCitation = {
  id: "guide_1",
  sourceId: "source_synthetic_3",
  title: "합성 기관 안내 계약 fixture",
  kind: "official_guide",
  institutionId: "synthetic_institution",
  endpointId: "synthetic_endpoint",
  section: "합성 안내 항목",
  publishedDate: null,
  verifiedAt: time,
  contentHash: hash,
  url: "https://www.klac.or.kr/legalstruct/synthetic-fixture",
};
export const assistantMessage: V2Message = {
  schemaVersion: "2",
  id: "message_2",
  operationId: "operation_chat_1",
  workspaceRevision: 4,
  createdAt: time,
  role: "assistant",
  safety: "validated",
  text: "원문 자료에서 날짜를 확인하고 불명확한 내용은 질문으로 남겨주세요.",
  references: [{ kind: "official_source", citationId: "citation_1" }],
  citations: [citation],
  warnings: ["합성 예시입니다."],
};
export const timeline: V2TimelineEntry = {
  id: "timeline_1",
  revision: 1,
  date: null,
  datePrecision: "unknown",
  event: "합성 자료를 보유했다는 진술",
  certainty: "reported",
  references: summary.facts[0]?.references ?? [],
  factIds: ["fact_1"],
  userEdited: false,
};
export const action: V2Action = {
  id: "action_1",
  revision: 1,
  kind: "organize_materials",
  title: "합성 자료 정리",
  instructions: "보유한 합성 문서를 목록으로 정리해주세요.",
  caution: "자료의 진정성은 확인되지 않았습니다.",
  status: "todo",
  factIds: ["fact_1"],
  references: [],
};
export const job: V2Job = {
  schemaVersion: "2",
  id: "job_1",
  operationId: "operation_chat_1",
  target: { kind: "workspace", caseId: "case_synthetic_1", workspaceRevision: 3 },
  kind: "chat_response",
  status: "queued",
  phase: "admission",
  progressPercent: 0,
  attempts: 0,
  failure: null,
  retryable: false,
  updatedAt: time,
};
export const documentProbe: V2FileProbe = {
  category: "document",
  format: "pdf",
  byteLength: 100,
  pageCount: 1,
};
export const documentCoverage: V2Coverage = {
  category: "document",
  status: "complete",
  pageCount: 1,
  pages: [{ page: 1, status: "processed" }],
};
export const audioCoverage: V2Coverage = {
  category: "audio",
  audio: {
    durationSeconds: 2,
    status: "complete",
    intervals: [
      { startSeconds: 0, endSeconds: 1, status: "processed" },
      { startSeconds: 1, endSeconds: 2, status: "silent" },
    ],
  },
};
export const videoCoverage: V2Coverage = {
  category: "video",
  durationSeconds: 2,
  status: "complete",
  hasAudio: true,
  audio: {
    durationSeconds: 2,
    status: "complete",
    intervals: [{ startSeconds: 0, endSeconds: 2, status: "processed" }],
  },
  frames: [
    {
      id: "frame_0",
      timestampSeconds: 0,
      frameIndex: 0,
      sampling: "one_second",
      status: "processed",
    },
    {
      id: "frame_1",
      timestampSeconds: 1,
      frameIndex: 30,
      sampling: "one_second",
      status: "processed",
    },
    {
      id: "frame_scene",
      timestampSeconds: 0.5,
      frameIndex: 15,
      sampling: "scene_change",
      status: "processed",
    },
  ],
  sceneDetection: "complete",
  sceneFrameCount: 1,
};
export const readyFile: V2File = {
  schemaVersion: "2",
  id: "file_1",
  revision: 1,
  name: "합성-자료.pdf",
  declaredMediaType: "application/pdf",
  byteLength: 100,
  status: "ready",
  probe: documentProbe,
  manifest: {
    byteLength: 100,
    contentHash: hash,
    parts: [{ index: 0, byteLength: 100, contentHash: hash }],
  },
  coverage: documentCoverage,
  observations: [
    {
      id: "observation_1",
      text: "합성 문서의 날짜는 명확하지 않습니다.",
      position: { kind: "document", page: 1, paragraph: 1, table: null },
      certainty: "uncertain",
      userEdited: false,
      included: true,
    },
  ],
  derivatives: [
    {
      id: "derivative_1",
      kind: "extracted_text",
      byteLength: 50,
      contentHash: hash,
      sourcePosition: { kind: "document", page: 1, paragraph: 1, table: null },
    },
  ],
  currentJobId: null,
  operationId: "operation_file_1",
  failure: null,
  createdAt: time,
};
export const sourceContext: V2ReferenceContext = {
  intakeRevision: 2,
  answeredQuestionIds: ["q1"],
  messages: [{ id: "message_1", workspaceRevision: 3 }],
  files: [{ id: "file_1", revision: 1, category: "document", pageCount: 1 }],
  verifiedCitationIds: ["citation_1"],
};
const office = {
  name: "합성 사무실",
  country: "KR",
  region: "seoul",
  address: "합성 공개 주소",
  addressDetail: null,
  postalCode: null,
} as const;
export const publicLawyer: V2PublicLawyer = {
  schemaVersion: "2",
  id: "lawyer_1",
  approvedRevision: 2,
  publishedAt: time,
  content: {
    name: "합성 변호사 A",
    introduction: "합성 프로필입니다. 실제 자격 증거가 아닙니다.",
    photoAssetId: "photo_1",
    office,
    contact: { phone: "000-0000-0000", email: null, consultationUrl: null },
    legalFields: ["company", "other"],
    portfolio: [
      { id: "portfolio_1", kind: "text", title: "합성 소개", text: "계약 테스트용 소개입니다." },
    ],
  },
  verification: {
    status: "manually_verified",
    identityChecked: true,
    licenseChecked: true,
    officeChecked: true,
    verifiedAt: time,
  },
  assets: [
    {
      id: "photo_1",
      kind: "image",
      contentHash: hash,
      byteLength: 100,
      sanitization: "verified",
      approvedRevision: 2,
    },
  ],
};
export const profileRevision: V2ProfileRevision = {
  schemaVersion: "2",
  id: "revision_2",
  profileId: "lawyer_1",
  revision: 2,
  createdAt: time,
  status: "submitted",
  content: publicLawyer.content,
  submittedAt: time,
};
export const application: V2LawyerApplication = {
  schemaVersion: "2",
  id: "application_1",
  applicantId: "applicant_1",
  revision: 1,
  createdAt: time,
  status: "approved",
  content: {
    name: "합성 변호사 A",
    licenseNumber: "SYNTHETIC-ONLY",
    office,
    assets: [
      {
        id: "verification_1",
        purpose: "lawyer_license",
        status: "ready",
        byteLength: 100,
        contentHash: hash,
      },
    ],
  },
  submittedAt: time,
  reviewerId: "reviewer_1",
  reviewedAt: time,
  reason: "합성 테스트 결정이며 실제 승인 증거가 아닙니다.",
  checklist: { identity: true, lawyerLicense: true, office: true },
};
export const reportRequest: V2ReportCreateRequest = {
  expectedRevision: 4,
  selectedFileIds: ["file_1"],
  editedFields: [],
  maskingChoices: [{ partyId: "party_1", mode: "keep" }],
  reviewConfirmed: true,
  includeOriginals: true,
  originalsUnmaskedAcknowledged: true,
  selectedOriginalFileIds: ["file_1"],
};
export const reportBody: V2ReportBody = {
  schemaVersion: "2",
  overview: summary.overview,
  parties: summary.parties,
  facts: summary.facts,
  timeline: [timeline],
  selectedFiles: [
    { id: "file_1", revision: 1, contentHash: hash, byteLength: 100, name: "합성-자료.pdf" },
  ],
  unknowns: summary.unknowns,
  actions: [action],
  lawyerQuestions: [
    { id: "lawyer_question_1", text: "합성 자료의 어떤 내용이 확인되어야 하나요?" },
  ],
  citations: [citation],
  legalSourceStatus: "verified",
  notices: summary.notices,
  generatedAt: time,
};
export const report: V2Report = {
  schemaVersion: "2",
  id: "report_1",
  version: 1,
  snapshotRevision: 4,
  summaryRevision: 1,
  createdAt: time,
  status: "ready",
  request: reportRequest,
  body: reportBody,
  pdf: { id: "pdf_1", encryption: "chunk_aead_v1", byteLength: 200, contentHash: hash },
  originalsZip: { id: "zip_1", encryption: "chunk_aead_v1", byteLength: 300, contentHash: hash },
  originalManifest: reportBody.selectedFiles,
  currentJobId: null,
  failure: null,
};
export const usage: V2Usage = {
  schemaVersion: "2",
  day: "2026-10-06",
  timezone: "Asia/Seoul",
  resetAt: "2026-10-06T15:00:00Z",
  newCases: { limit: 3, used: 1, reserved: 1, remaining: 1 },
  aiResponses: { limit: 30, used: 2, reserved: 1, remaining: 27 },
  mediaSeconds: { limit: 3600, used: 2, reserved: 0, remaining: 3598 },
  storageBytes: { limit: 10_000_000_000, used: 100, reserved: 200, remaining: 9_999_999_700 },
  waitReasons: [],
};
export const budget: V2BudgetLedger = {
  schemaVersion: "2",
  month: "2026-10",
  timezone: "Asia/Seoul",
  limitKrw: 1_000_000,
  settledKrw: 10_000,
  reservedKrw: 20_000,
  ambiguousKrw: 5000,
  fixedAndMaintenanceKrw: 100_000,
  availableKrw: 865_000,
};
export const quote: V2CostQuote = {
  id: "quote_1",
  version: 1,
  reviewedAt: time,
  validUntil: "2026-10-07T00:00:00Z",
  currency: "KRW",
  providerPricingVersion: "synthetic-price-version",
  exchangeRateKrwPerUsd: 1000,
  safetyMarginRatio: 0.2,
  estimatedKrw: 100,
};
export const costAttempt: V2CostAttempt = {
  id: "attempt_1",
  operationId: "operation_chat_1",
  invocationId: "invocation_model_phase_1",
  attempt: 1,
  quoteId: "quote_1",
  service: "model",
  state: "ambiguous",
  reservedKrw: 100,
  chargedKrw: null,
  createdAt: time,
};

export const rejectedFixtures = {
  v1Workspace: { ...workspace, schemaVersion: "1" },
  forgedRoleMutation: { expectedRevision: 1, content: {}, roles: ["moderator"] },
  unvalidatedAssistant: {
    ...assistantMessage,
    safety: "unvalidated",
    rawProviderOutput: "synthetic raw output",
  },
  rawError: {
    code: "FILE_PROCESSING_FAILED",
    message: "합성 오류",
    requestId: "request_1",
    retryable: false,
    details: { stack: "synthetic parser stack", url: "https://invalid.local/private" },
  },
  skippedWithValue: { questionId: "q2", status: "skipped", value: "미확인 값을 확정하지 않음" },
  opaquePayloadJob: { ...job, payload: { narrative: "synthetic plaintext payload" } },
} as const;
