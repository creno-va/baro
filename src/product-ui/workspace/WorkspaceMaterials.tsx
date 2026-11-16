import { LoaderCircle, Plus, Upload } from "lucide-react";
import { ChatAttachments } from "../../components/workspace/ChatAttachments";
import { ElapsedTime } from "../../components/workspace/ElapsedTime";
import { EvidenceRequirements } from "../../components/workspace/EvidenceRequirements";
import { MaterialsPanel } from "../../components/workspace/MaterialsPanel";
import { uploadProgressLabel } from "../../components/workspace/processing-progress";
import { V2_LIMITS } from "../../contracts/v2";
import { Button, Button as ControlButton } from "../Button";
import type { WorkspaceComponents } from "./slots";
import type { WorkspaceController } from "./useWorkspaceController";
import { WorkspaceInput as ControlInput, WorkspaceLabel as FieldLabel } from "./WorkspaceControls";
export function WorkspaceMaterials({
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
    conversationState,
    busy,
    selected,
    setSelected,
    localAttachments,
    setLocalAttachments,
    chatAttachments,
    queuedSend,
    setConversationRefresh,
    setDeleteFile,
    uploadConsent,
    setUploadConsent,
    retryUploads,
    setRetryUploads,
    acceptedFileRetries,
    uploadProgress,
    ready,
    ticket,
    readonly,
    privateContent,
    fileReviewError,
    retryFile,
    chooseAttachments,
    openUploadChooser,
    chooseConversationAttachments,
    openConversationFile,
    upload,
    evidenceIds,
    pendingResponse,
  } = controller;
  const { EvidencePicker } = components;
  return view ? (
    <MaterialsPanel
      caseId={caseId}
      files={view.files}
      busy={busy}
      readonly={readonly}
      ready={ready}
      evidenceIds={evidenceIds}
      selected={selected}
      selectionDisabled={queuedSend || !!pendingResponse}
      {...(tab === "chat"
        ? {
            onSelect: (id: string, checked: boolean) =>
              setSelected((ids) =>
                checked ? [...new Set([...ids, id])] : ids.filter((value) => value !== id),
              ),
          }
        : {})}
      onReview={(file, origin) => openConversationFile(file.id, origin)}
      onDelete={(file, origin) => {
        origin.focus();
        setDeleteFile(file);
      }}
      onRetry={(id) => void retryFile(id)}
      acceptedFileRetries={acceptedFileRetries}
      report={conversationState?.report ?? null}
      standalone={tab === "files"}
      {...(tab === "chat"
        ? { onReportRefresh: () => setConversationRefresh((value) => value + 1) }
        : {})}
    >
      {conversationState?.snapshot &&
        !["stale", "pending", "running"].includes(conversationState.analysis.status) && (
          <div {...privateContent}>
            <EvidenceRequirements
              requirements={conversationState.snapshot.evidenceRequirements}
              files={view.files}
              facts={view.facts ?? []}
              disabled={
                readonly ||
                !!busy ||
                queuedSend ||
                !!localAttachments.length ||
                !!chatAttachments.length
              }
              onAdd={openUploadChooser}
              onReview={openConversationFile}
            />
          </div>
        )}
      <div
        data-product-workspace-material-upload=""
        data-compact={!!view.files.length || undefined}
        className="min-w-0 space-y-4"
        {...privateContent}
      >
        <ChatAttachments
          label="업로드할 자료"
          local={localAttachments}
          uploaded={[]}
          disabled={readonly || !!busy}
          removeLocal={(file) => {
            setLocalAttachments((items) => items.filter((item) => item !== file));
            setRetryUploads((items) => items.filter((item) => item !== file));
          }}
          removeUploaded={() => {}}
        />
        {!!localAttachments.length && (
          <>
            <FieldLabel
              data-product-workspace-consent=""
              className="items-start rounded-xl border border-[var(--pui-border)] bg-[var(--pui-background)] p-3 text-sm [&_input]:mt-1"
            >
              <ControlInput
                type="checkbox"
                checked={uploadConsent}
                disabled={readonly || !!busy}
                onChange={(event) => setUploadConsent(event.target.checked)}
              />
              첨부한 파일의 자동 처리에 동의합니다.
            </FieldLabel>
            <Button
              disabled={readonly || !!busy || !uploadConsent || retryUploads.length > 0}
              onClick={() => void upload(localAttachments, false)}
            >
              선택한 자료 업로드
            </Button>
          </>
        )}
        {!view.files.length && <h3 className="sr-only">아직 자료가 없어요</h3>}
        <ControlButton
          type="button"
          data-product-workspace-upload-target=""
          className="flex h-auto w-full flex-col items-center justify-center gap-3 whitespace-normal rounded-xl border-dashed p-5 text-center"
          aria-label={view.files.length ? "파일 추가" : "파일 선택"}
          disabled={!!busy || readonly}
          onClick={openUploadChooser}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (!busy && !readonly) {
              if (tab === "chat") chooseAttachments(Array.from(event.dataTransfer.files));
              else void upload(event.dataTransfer.files);
            }
          }}
        >
          <span
            data-product-workspace-upload-icon=""
            className="inline-flex shrink-0 items-center justify-center rounded-xl bg-[var(--pui-background)] p-3"
          >
            {view.files.length ? <Plus size={20} /> : <Upload size={28} />}
          </span>
          <span data-product-workspace-upload-title="" className="block text-sm font-medium">
            {view.files.length ? "파일 추가" : "파일 선택"}
          </span>
          <span
            data-product-workspace-upload-limit=""
            className="block text-xs font-normal leading-6 text-[var(--pui-muted)]"
          >
            문서·이미지 {V2_LIMITS.documentImageBytes / 1_000_000} MB · 음성·영상{" "}
            {V2_LIMITS.mediaBytes / 1_000_000_000} GB까지
          </span>
        </ControlButton>
        <EvidencePicker
          scopeKey={`${caseId}:${ticket()}`}
          photoOnly
          compact
          captureOnly
          disabled={readonly || !!busy || retryUploads.length > 0}
          onSelect={chooseConversationAttachments}
          onError={fileReviewError}
        />
        {busy === "upload" && (
          <div
            data-product-workspace-upload-progress=""
            className="space-y-2 rounded-xl bg-[var(--pui-background)] p-3 text-sm leading-6 text-[var(--pui-muted)]"
            role="status"
          >
            <p>
              <LoaderCircle
                size={17}
                data-product-workspace-spin=""
                className="animate-spin motion-reduce:animate-none"
              />{" "}
              {uploadProgress ? uploadProgressLabel(uploadProgress.value) : "자료 저장 중"}
            </p>
            {uploadProgress && (
              <>
                <p>
                  {uploadProgress.fileName} · {uploadProgress.index}/{uploadProgress.total}개
                </p>
                {uploadProgress.value.stage === "uploading" && (
                  <p>
                    저장 확인된 전송량 {uploadProgress.value.completedBytes.toLocaleString("ko-KR")}{" "}
                    / {uploadProgress.value.totalBytes.toLocaleString("ko-KR")} 바이트
                  </p>
                )}
                <ElapsedTime startedAt={uploadProgress.startedAt} label="업로드 시작 후" />
              </>
            )}
          </div>
        )}
      </div>
    </MaterialsPanel>
  ) : null;
}
