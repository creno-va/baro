import { ArrowRight } from "lucide-react";
import { MediaPlayer } from "../../components/ui/media-player";
import { Button } from "../Button";
import { fileStatus, size } from "./presentation";
import type { WorkspaceComponents } from "./slots";
import type { WorkspaceController } from "./useWorkspaceController";
export function WorkspaceFileViewer({
  controller,
  components,
}: {
  controller: WorkspaceController;
  components: WorkspaceComponents;
}) {
  const {
    caseId,
    tab,
    view,
    error,
    busy,
    preview,
    original,
    reviewState,
    fileReviewBusyChanged,
    fileReviewDirtyChanged,
    ready,
    readonly,
    fileReviewError,
    load,
    reflectMaterial,
    closeDialog,
    readOriginal,
    downloadOriginal,
  } = controller;
  const { FileReview } = components;
  return preview ? (
    <section
      data-product-workspace-preview=""
      className="min-w-0 space-y-4 text-sm leading-7 text-[var(--pui-text)] [overflow-wrap:anywhere] [&>h4]:text-sm [&>h4]:font-semibold [&>img]:max-h-[60dvh] [&>img]:max-w-full [&>img]:rounded-xl [&>img]:object-contain"
      role={tab === "chat" ? "dialog" : "region"}
      aria-label="자료 확인"
      hidden={!ready}
      inert={!ready}
      onKeyDown={(event) => {
        if (tab === "chat" && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closeDialog();
        }
      }}
    >
      <div
        data-product-workspace-inline-review-heading=""
        className="flex min-w-0 flex-wrap items-center gap-3 [&_h3]:min-w-0 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:[overflow-wrap:anywhere]"
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={closeDialog}
          disabled={!!busy || reviewState.busy}
        >
          자료 목록
        </Button>
        <h3>{preview.name}</h3>
      </div>
      <p>
        {preview.uploadRejection ? "등록 거절" : fileStatus[preview.status]} ·{" "}
        {size(preview.sizeBytes)}
      </p>
      {preview.uploadRejection && (
        <p>
          파일 등록이 거절됐어요. 암호·보호를 해제하거나 지원하는 형식으로 저장한 파일을 새로 선택해
          주세요.
        </p>
      )}
      <h4>처리 범위</h4>
      <p>{preview.coverage || "추출 범위를 아직 확인할 수 없어요."}</p>
      <FileReview
        key={preview.id}
        caseId={caseId}
        fileId={preview.id}
        canEdit={!readonly}
        onChanged={load}
        onError={fileReviewError}
        onDirtyChange={fileReviewDirtyChanged}
        onBusyChange={fileReviewBusyChanged}
        refreshVersion={`${view?.case.revision ?? 0}:${preview.status}`}
      />
      {preview.status === "ready" && (
        <div
          data-product-workspace-material-apply=""
          className="rounded-xl bg-[var(--pui-background)] p-3 text-xs leading-6 text-[var(--pui-muted)]"
        >
          <p>
            교정을 저장한 뒤 자료 내용을 대화로 보내면 사건의 사실을 함께 정리해요. 긴 자료는 일부만
            참고할 수 있으니 전체 원문도 확인하세요. 저장한 리포트는 새 버전에서 갱신할 수 있어요.
          </p>
        </div>
      )}
      <div
        data-product-workspace-buttons=""
        className={`flex min-w-0 flex-wrap items-center gap-2${tab !== "chat" ? " sticky bottom-0 z-10 bg-[var(--pui-surface)] py-3 pb-[calc(12px+var(--workspace-dialog-padding,24px))]" : ""}`}
      >
        {preview.status === "ready" && (
          <Button
            disabled={!!busy || readonly || reviewState.dirty || reviewState.busy}
            onClick={() => void reflectMaterial(preview.id)}
          >
            자료 내용 반영하기 <ArrowRight size={16} />
          </Button>
        )}
        <Button
          variant="secondary"
          disabled={!!busy || !ready || preview.status === "uploading"}
          onClick={() => void readOriginal()}
        >
          원본 확인 · 다운로드
        </Button>
        {original && (
          <Button
            variant="secondary"
            disabled={!!busy || !ready}
            onClick={() => void downloadOriginal()}
          >
            원본 다운로드
          </Button>
        )}
        <Button variant="ghost" onClick={closeDialog} disabled={!!busy}>
          닫기
        </Button>
      </div>
      {original &&
        (original.type.startsWith("audio/") ? (
          <MediaPlayer
            src={original.url}
            label={`${preview.name} 원음 듣기`}
            kind="audio"
            enabled={ready}
          />
        ) : original.type.startsWith("video/") ? (
          <MediaPlayer
            src={original.url}
            label={`${preview.name} 원본 영상`}
            kind="video"
            enabled={ready}
          />
        ) : (
          <img src={original.url} alt={`${preview.name} 원본 미리보기`} />
        ))}
      {error && (
        <p
          role="alert"
          data-product-workspace-error=""
          className="space-y-3 rounded-xl border border-[var(--pui-danger)] bg-[var(--pui-surface)] p-4 text-sm leading-7 text-[var(--pui-danger)] [overflow-wrap:anywhere]"
        >
          {error.message}
        </p>
      )}
    </section>
  ) : null;
}
