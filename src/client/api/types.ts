import type { V2Coverage, V2FactReference, V2FileObservation } from "../../contracts/v2";
import type { V2Summary } from "../../contracts/v2/intake";

export type AccountType = "customer" | "lawyer";
export type Provider = "google" | "naver" | "kakao";
export type SessionView = {
  user: null | { id: string; name: string; accountType: AccountType };
  needsConsent: boolean;
};
export type CaseView = {
  id: string;
  title: string;
  subjectContext: "individual" | "company";
  stage: "intake" | "summary" | "active" | "archived";
  revision: number;
  updatedAt: string;
  summary: string;
  schemaVersion?: "1" | "2";
  summaryDetails?: V2Summary;
};
export type QuestionView = {
  id: string;
  text: string;
  kind: "text" | "choice";
  options?: string[];
  answer?: string;
  answerState?: "answered" | "unknown" | "skipped";
};
export type MessageView = {
  id: string;
  role: "user" | "assistant";
  text: string;
  status: "pending" | "complete" | "failed";
  retryable?: boolean | undefined;
  createdAt: string;
  references?: V2FactReference[];
  citations?: { id: string; title: string; url: string }[];
  warnings?: string[];
};
export type ActionView = { id: string; title: string; detail: string; done: boolean };
export type TimelineView = {
  id: string;
  revision?: number | undefined;
  date: string;
  datePrecision?: "day" | "month" | "year" | "unknown";
  title: string;
  detail: string;
};
export type FileView = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  status: "uploading" | "processing" | "ready" | "failed" | "waiting";
  coverage: string;
  extractedText: string;
  canStartProcessing?: boolean | undefined;
};
export type WorkspaceCollection = "messages" | "actions" | "timeline";
export type WorkspaceView = {
  pagination?: Record<WorkspaceCollection, boolean> | undefined;
  case: CaseView;
  messages: MessageView[];
  actions: ActionView[];
  timeline: TimelineView[];
  files: FileView[];
  facts?: V2Summary["facts"];
  people?: V2Summary["parties"];
  unknowns?: string[];
  notices?: string[];
};
export type ReportView = {
  savedZip?: { id: string; fileCount: number; createdAt: string } | undefined;
  basis?: { workspaceRevision: number; summaryRevision: number; generatedAt: string } | undefined;
  pdfAvailable?: boolean | undefined;
  id: string;
  caseId: string;
  revision: number;
  title: string;
  content: string;
  updatedAt: string;
  stale: boolean;
  excludedFileIds: string[];
  maskIdentifiers: boolean;
};
export type LawyerView = {
  id: string;
  revision: number;
  name: string;
  introduction: string;
  officeName: string;
  address: string;
  region: string;
  practiceAreas: string[];
  phone: string;
  email: string;
  website: string;
  photoUrl: string | null;
  portfolio: { id: string; title: string; url: string | null }[];
  published: boolean;
  verificationStatus: "self_declared" | "verified";
};
export type UsageView = {
  newCases: { used: number; limit: number };
  aiResponses: { used: number; limit: number };
  mediaMinutes: { used: number; limit: number };
  storageBytes: { used: number; limit: number };
};
export type ApiErrorView = {
  code:
    | "UNAUTHENTICATED"
    | "CONSENT_REQUIRED"
    | "NOT_FOUND"
    | "CONFLICT"
    | "QUOTA_EXCEEDED"
    | "VALIDATION_ERROR"
    | "UNAVAILABLE";
  message: string;
  retryable: boolean;
};

export type FileReviewProgress = {
  reviewId: string;
  fileId: string;
  revision: number;
  workspaceRevision: number;
  status: "saving" | "ready" | "conflict";
  completed: number;
  total: number;
};
export type FileReviewView = {
  file: { id: string; revision: number; name: string; status: string };
  workspaceRevision: number;
  coverage: V2Coverage | null;
  observations: { ordinal: number; value: V2FileObservation; original: V2FileObservation }[];
  nextAfterOrdinal: number | null;
  pendingReview: FileReviewProgress | null;
  recovery: { code: string; message: string; actions: string[] } | null;
};
