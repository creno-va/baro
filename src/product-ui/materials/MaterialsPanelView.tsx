import { FileText } from "lucide-react";
import type { FileView } from "../../client/api/types";
import { ElapsedTime } from "../../components/workspace/ElapsedTime";
import {
  fileFailureLabel,
  fileProcessingLabel,
} from "../../components/workspace/processing-progress";
import { Button, ButtonLink } from "../Button";
import { cn } from "../utils";
import type { MaterialsPanelProps } from "./types";

const fileStatus: Record<FileView["status"], string> = {
  uploading: "업로드 중",
  processing: "처리 중",
  ready: "결과 확인 가능",
  failed: "처리 실패",
  waiting: "처리 대기",
};
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

/** Workspace still owns all reads, selections and mutations. This tree only
 * presents supplied file state and explicit user actions. */
export function MaterialsPanelView({
  caseId,
  files,
  children,
  busy,
  readonly,
  ready,
  evidenceIds,
  selected,
  selectionDisabled = false,
  onSelect,
  onReview,
  onDelete,
  onRetry,
  acceptedFileRetries,
  report,
  onReportRefresh,
  standalone = false,
}: MaterialsPanelProps) {
  const privateContent = { inert: !ready, "aria-hidden": !ready };
  const concealed = !ready && "invisible";
  return (
    <section
      data-product-materials=""
      data-standalone={standalone || undefined}
      aria-label="사건 자료"
      className="flex min-h-0 flex-col gap-5 text-[var(--pui-text)]"
    >
      {standalone && (
        <h2 {...privateContent} className={cn("text-lg font-semibold", concealed)}>
          사건 자료
        </h2>
      )}
      {children}
      <ul data-product-material-list="" className="grid min-w-0 gap-3">
        {files.map((file) => (
          <li
            key={file.id}
            className="min-w-0 space-y-3 rounded-2xl border border-[var(--pui-border)] bg-[var(--pui-surface)] p-4"
          >
            <div {...privateContent} className={cn("flex min-w-0 items-start gap-3", concealed)}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--pui-background)] text-[var(--pui-muted)]">
                <FileText size={20} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold leading-6 [overflow-wrap:anywhere]">
                  {file.name}
                </h3>
                <p className="mt-0.5 text-xs leading-5 text-[var(--pui-muted)]">
                  {size(file.sizeBytes)} ·{" "}
                  <span>{file.uploadRejection ? "등록 거절" : fileStatus[file.status]}</span>
                </p>
                {evidenceIds.has(file.id) && (
                  <span className="mt-2 inline-flex rounded-full border border-[var(--pui-border)] px-2 py-0.5 text-[11px] text-[var(--pui-muted)]">
                    근거로 활용됨
                  </span>
                )}
              </div>
            </div>
            <p
              {...privateContent}
              className={cn(
                "text-xs leading-5 text-[var(--pui-muted)] [overflow-wrap:anywhere]",
                concealed,
              )}
            >
              {file.coverage || "추출 범위는 처리가 끝난 뒤 확인할 수 있어요."}
            </p>
            {file.processing && ["processing", "waiting"].includes(file.status) && (
              <div
                {...privateContent}
                className={cn("space-y-1 text-xs leading-5 text-[var(--pui-muted)]", concealed)}
              >
                <p>{fileProcessingLabel(file.processing)}</p>
                <p>
                  <ElapsedTime startedAt={file.processing.updatedAt} label="마지막 상태 갱신 후" />
                </p>
              </div>
            )}
            {!file.processing &&
              !file.uploadRejection &&
              file.createdAt &&
              ["uploading", "processing", "waiting"].includes(file.status) && (
                <p {...privateContent} className={cn("text-xs text-[var(--pui-muted)]", concealed)}>
                  <ElapsedTime startedAt={file.createdAt} label="자료 등록 후" />
                </p>
              )}
            {file.status === "failed" && (
              <p
                {...privateContent}
                className={cn("text-xs leading-5 text-[var(--pui-danger)]", concealed)}
              >
                {fileFailureLabel(file)}
              </p>
            )}
            {file.status === "uploading" && (
              <p
                {...privateContent}
                className={cn("text-xs leading-5 text-[var(--pui-muted)]", concealed)}
              >
                {file.uploadRejection
                  ? "파일 등록이 거절됐어요. 암호·보호를 해제하거나 지원하는 형식으로 저장한 파일을 새로 선택해 주세요."
                  : "등록이 아직 완료되지 않았어요. 전송이 중단된 경우 같은 원본을 다시 선택해 이어서 저장할 수 있어요. 파일 거절 안내를 받았다면 수정한 파일을 새로 선택해 주세요. 만료된 업로드는 삭제한 뒤 다시 추가할 수 있어요."}
              </p>
            )}
            {file.status === "ready" && onSelect && (
              <label
                {...privateContent}
                className={cn("flex min-h-11 cursor-pointer items-center gap-3 text-xs", concealed)}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(file.id)}
                  disabled={!!busy || readonly || selectionDisabled}
                  onChange={(event) => onSelect(file.id, event.target.checked)}
                  className="h-4 w-4 shrink-0 appearance-auto accent-[var(--pui-primary)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--pui-focus)]"
                />
                <span>
                  <span aria-hidden="true">대화에 함께 사용</span>
                  <span className="sr-only">대화에 사용할 {file.name}</span>
                </span>
              </label>
            )}
            <div className="flex flex-wrap gap-2 border-t border-[var(--pui-border)] pt-3">
              {((file.status === "failed" && file.canRetry) || file.canStartProcessing) && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!!busy || readonly || acceptedFileRetries.includes(file.id)}
                  onClick={() => onRetry(file.id)}
                >
                  {file.canStartProcessing ? "자료 처리 시작" : "처리 다시 시도"}
                </Button>
              )}
              <Button
                variant="secondary"
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
                className={cn("text-[var(--pui-muted)]", concealed)}
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
      <footer
        data-product-material-report=""
        {...privateContent}
        className={cn(
          "mt-auto space-y-3 rounded-2xl border border-[var(--pui-border)] bg-[var(--pui-background)] p-4 text-xs leading-5 text-[var(--pui-muted)]",
          concealed,
        )}
      >
        <p role="status" aria-live="polite">
          {standalone
            ? "리포트에서 준비 상태를 확인할 수 있어요"
            : report
              ? reportLabels[report.status]
              : "준비 상태를 확인하지 못했어요"}
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
        <div className="flex flex-wrap gap-2">
          <ButtonLink
            variant="secondary"
            size="sm"
            href={`/cases/${encodeURIComponent(caseId)}/reports?mode=conversation`}
          >
            리포트 열기
          </ButtonLink>
          {onReportRefresh && (
            <Button variant="ghost" size="sm" disabled={!!busy} onClick={onReportRefresh}>
              리포트 상태 다시 확인
            </Button>
          )}
        </div>
      </footer>
    </section>
  );
}
