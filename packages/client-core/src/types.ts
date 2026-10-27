import type { CaseDetail } from "@baro/contracts/cases";
import type { ClientSession } from "@baro/contracts/session";
import type {
  V2Coverage,
  V2FactReference,
  V2FailureCode,
  V2FileObservation,
  V2FileProcessing,
} from "@baro/contracts/v2";
import type { V2Summary } from "@baro/contracts/v2/intake";
import type { IntakeQuestionContext } from "./intake-questions";

export type AccountType = NonNullable<ClientSession["user"]>["accountType"];
export type Provider = "google" | "naver" | "kakao";
export type MobileProvider = import("@baro/contracts/mobile-auth").MobileAuthProvider;
export type SessionView = ClientSession;
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
  intakeQuestions?: IntakeQuestionContext;
  summaryNeedsConfirmation?: boolean;
  legacyDetail?: CaseDetail;
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
  selectedFileIds?: string[] | undefined;
  id: string;
  role: "user" | "assistant";
  text: string;
  status: "pending" | "complete" | "failed";
  retryable?: boolean | undefined;
  createdAt: string;
  statusUpdatedAt?: string | undefined;
  references?: V2FactReference[];
  citations?: { id: string; title: string; url: string }[];
  warnings?: string[];
};
export type ActionView = {
  id: string;
  revision?: number;
  title: string;
  detail: string;
  done: boolean;
};
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
  revision?: number | undefined;
  name: string;
  mimeType: string;
  sizeBytes: number;
  status: "uploading" | "processing" | "ready" | "failed" | "waiting";
  coverage: string;
  extractedText: string;
  canStartProcessing?: boolean | undefined;
  canRetry?: boolean | undefined;
  processing?: V2FileProcessing | undefined;
  uploadContentHash?: string | undefined;
  uploadRejection?: "FILE_REJECTED" | undefined;
  createdAt?: string | undefined;
  failure?: V2FailureCode | null | undefined;
};
export type FileUploadProgress = {
  stage: "checking_access" | "hashing" | "preparing" | "uploading" | "checking" | "confirming";
  completedBytes: number;
  totalBytes: number;
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
  includedPhotoIds?: string[] | undefined;
  photoCandidates?: { id: string; name: string; revision: number }[] | undefined;
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
    | "FILE_REJECTED"
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
