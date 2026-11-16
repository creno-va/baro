import type { ReactNode } from "react";
import type { FileReviewView, FileView } from "../../client/api/types";
import type { V2ConversationState } from "../../contracts/v2";

export interface FileReviewProps {
  caseId: string;
  fileId: string;
  canEdit: boolean;
  onChanged: () => Promise<unknown>;
  onError: (cause: unknown) => unknown;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
  refreshVersion?: string;
}
export type ReviewObservationRow = FileReviewView["observations"][number];
export type ReviewDraft = { text: string; included: boolean };

export interface MaterialsPanelProps {
  caseId: string;
  files: FileView[];
  children: ReactNode;
  busy: string;
  readonly: boolean;
  ready: boolean;
  evidenceIds: ReadonlySet<string>;
  selected: string[];
  selectionDisabled?: boolean;
  onSelect?: (id: string, checked: boolean) => void;
  onReview: (file: FileView, origin: HTMLElement) => void;
  onDelete: (file: FileView, origin: HTMLElement) => void;
  onRetry: (fileId: string) => void;
  acceptedFileRetries: string[];
  report: V2ConversationState["report"] | null;
  onReportRefresh?: () => void;
  standalone?: boolean;
}

export interface CaseContextPanelProps {
  caseId: string;
  files: FileView[];
  reportStatus?: string | undefined;
  materials: ReactNode;
  viewer: ReactNode;
  viewingFileId?: string | undefined;
  materialsRequest?: number;
  onAdd: () => void;
  canAdd: boolean;
  onReview: (file: FileView, origin: HTMLButtonElement) => void;
  preparation?: ReactNode;
  needsEvidence?: boolean;
  feedback?: ReactNode;
}
