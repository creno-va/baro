import { FileText } from "lucide-react";
import type { ReactNode } from "react";
import type { FileView } from "../../client/api/types";
import type { V2ConversationState, V2Fact } from "../../contracts/v2";
import { Button, ButtonLink } from "../ui/button";
import { ElapsedTime } from "./ElapsedTime";
import { materialState, materialStateLabels } from "./evidence-state";
import { fileFailureLabel, fileProcessingLabel } from "./processing-progress";

function size(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.ceil(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
const reportLabels = {
  not_started: "아직 리포트가 없어요",
  pending: "리포트 준비 중",
  ready: "리포트를 열 수 있어요",
  stale: "리포트 검토·갱신이 필요해요",
  failed: "리포트 준비 실패",
};

/** One presentation of the existing file workflow. Workspace owns every read and mutation. */
export function MaterialsPanel({
  caseId,
  files,
  children,
  busy,
  readonly,
  ready,
  evidenceIds,
  facts = [],
  selected,
  selectionDisabled = false,
  onSelect,
  onAsk,
  onReview,
  onDelete,
  onRetry,
  acceptedFileRetries,
  report,
  onReportRefresh,
  standalone = false,
}: {
  caseId: string;
  files: FileView[];
  children: ReactNode;
  busy: string;
  readonly: boolean;
  ready: boolean;
  evidenceIds: ReadonlySet<string>;
  facts?: V2Fact[];
  selected: string[];
  selectionDisabled?: boolean;
  onSelect?: (id: string, checked: boolean) => void;
  onAsk?: (file: FileView) => void;
  onReview: (file: FileView, origin: HTMLElement) => void;
  onDelete: (file: FileView, origin: HTMLElement) => void;
  onRetry: (fileId: string) => void;
  acceptedFileRetries: string[];
  report: V2ConversationState["report"] | null;
  onReportRefresh?: () => void;
  standalone?: boolean;
}) {
  const privateContent = {
    style: { visibility: ready ? undefined : ("hidden" as const) },
    inert: !ready,
    "aria-hidden": !ready,
  };
  return (
    <section
      className={`materials-panel${standalone ? " materials-panel--page" : ""}`}
      aria-label="사건 자료"
    >
      <div className="materials-panel__body">
        {standalone && <h2 {...privateContent}>사건 자료</h2>}
        {children}
        <ul className="workspace-file-list">
          {files.map((file) => (
            <li key={file.id}>
              <div className="workspace-file-title" {...privateContent}>
                <FileText size={24} />
                <div>
                  <h3>{file.name}</h3>
                  {evidenceIds.has(file.id) && (
                    <span className="workspace-evidence-notice">
                      현재 자료가 대화 근거로 연결됨
                    </span>
                  )}
                  <p>
                    {size(file.sizeBytes)} ·{" "}
                    <span className={`workspace-status workspace-status--${file.status}`}>
                      {materialStateLabels[materialState(file, facts)]}
                    </span>
                  </p>
                </div>
              </div>
              <p className="workspace-coverage" {...privateContent}>
                {file.coverage || "추출 범위는 처리가 끝난 뒤 확인할 수 있어요."}
              </p>
              {file.status === "ready" && (
                <p className="workspace-muted" {...privateContent}>
                  추출 결과를 원문과 확인할 수 있어요. 자료 선택이나 내용 확인만으로 분석과 리포트에
                  반영되지는 않아요.
                </p>
              )}
              {file.processing && ["processing", "waiting"].includes(file.status) && (
                <div className="workspace-muted" {...privateContent}>
                  <p>{fileProcessingLabel(file.processing)}</p>
                  <p>
                    <ElapsedTime
                      startedAt={file.processing.updatedAt}
                      label="마지막 상태 갱신 후"
                    />
                  </p>
                </div>
              )}
              {!file.processing &&
                !file.uploadRejection &&
                file.createdAt &&
                ["uploading", "processing", "waiting"].includes(file.status) && (
                  <p className="workspace-muted" {...privateContent}>
                    <ElapsedTime startedAt={file.createdAt} label="자료 등록 후" />
                  </p>
                )}
              {file.status === "failed" && (
                <p className="workspace-muted" {...privateContent}>
                  {fileFailureLabel(file)}
                </p>
              )}
              {file.status === "uploading" && (
                <p className="workspace-muted" {...privateContent}>
                  {file.uploadRejection
                    ? "파일 등록이 거절됐어요. 암호·보호를 해제하거나 지원하는 형식으로 저장한 파일을 새로 선택해 주세요."
                    : "등록이 아직 완료되지 않았어요. 전송이 중단된 경우 같은 원본을 다시 선택해 이어서 저장할 수 있어요. 파일 거절 안내를 받았다면 수정한 파일을 새로 선택해 주세요. 만료된 업로드는 삭제한 뒤 다시 추가할 수 있어요."}
                </p>
              )}
              {file.status === "ready" && onSelect && (
                <label className="materials-panel__selection" {...privateContent}>
                  <input
                    type="checkbox"
                    checked={selected.includes(file.id)}
                    disabled={!!busy || readonly || selectionDisabled}
                    onChange={(event) => onSelect(file.id, event.target.checked)}
                  />
                  <span>대화에 사용할 {file.name}</span>
                </label>
              )}
              <div className="workspace-buttons">
                {file.status === "ready" && onAsk && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!!busy || readonly || selectionDisabled}
                    onClick={() => onAsk(file)}
                  >
                    이 자료로 질문하기
                  </Button>
                )}
                {((file.status === "failed" && file.canRetry) || file.canStartProcessing) && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!!busy || readonly || acceptedFileRetries.includes(file.id)}
                    onClick={() => onRetry(file.id)}
                  >
                    {file.canStartProcessing ? "자료 처리 시작" : "처리 다시 시도"}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!!busy}
                  aria-haspopup="dialog"
                  onClick={(event) => {
                    event.currentTarget.focus();
                    onReview(file, event.currentTarget);
                  }}
                >
                  자료 확인
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  {...privateContent}
                  disabled={!!busy || !ready}
                  aria-haspopup="dialog"
                  onClick={(event) => {
                    event.currentTarget.focus();
                    onDelete(file, event.currentTarget);
                  }}
                >
                  삭제
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <footer className="materials-panel__report" {...privateContent}>
        <p role="status" aria-live="polite">
          {report ? reportLabels[report.status] : "준비 상태를 확인하지 못했어요"}
        </p>
        {report?.status === "stale" && (
          <p>
            저장된 리포트와 현재 사건의 기준을 확인해 주세요. 필요한 갱신은 리포트 화면에서
            선택하세요.
          </p>
        )}
        {report?.status === "failed" && (
          <p>완료된 결과가 아니에요. 리포트 화면에서 실패 상태와 다음 선택을 확인하세요.</p>
        )}
        <ButtonLink href={`/cases/${encodeURIComponent(caseId)}/reports?mode=conversation`}>
          리포트 열기
        </ButtonLink>
        {onReportRefresh && (
          <Button variant="ghost" size="sm" disabled={!!busy} onClick={onReportRefresh}>
            리포트 상태 다시 확인
          </Button>
        )}
      </footer>
    </section>
  );
}
