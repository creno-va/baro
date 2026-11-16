import { accessHref } from "../../client/return-path";
import { Button, ButtonLink } from "../Button";
import type { WorkspaceComponents } from "./slots";
import type { WorkspaceController } from "./useWorkspaceController";
export function workspaceFeedback({
  controller,
}: {
  controller: WorkspaceController;
  components: WorkspaceComponents;
}) {
  const {
    tab,
    error,
    busy,
    setNotice,
    uploadReadbackPending,
    uploadConsent,
    uploadForConversation,
    retryUploads,
    acceptedFileRetries,
    ready,
    verify,
    current,
    readonly,
    load,
    run,
    upload,
  } = controller;
  const errorFeedback = error ? (
    <section
      data-product-workspace-error=""
      className="space-y-3 rounded-xl border border-[var(--pui-danger)] bg-[var(--pui-surface)] p-4 text-sm leading-7 text-[var(--pui-danger)] [overflow-wrap:anywhere]"
      role="alert"
    >
      <strong>{error.message}</strong>
      <p>
        {error.code === "CONFLICT"
          ? "최신 내용을 불러왔어요. 입력은 유지됩니다. 확인한 뒤 다시 저장해 주세요."
          : error.code === "QUOTA_EXCEEDED"
            ? "저장된 사건은 보존돼요. 사용량에서 한도를 확인할 수 있어요."
            : error.code === "FILE_REJECTED"
              ? "수정한 파일을 새로 선택해 주세요. 기존 자료는 목록에서 확인하거나 삭제할 수 있어요."
              : ["UNAUTHENTICATED", "CONSENT_REQUIRED", "NOT_FOUND"].includes(error.code) &&
                  !error.resource
                ? "계정 또는 사건 접근이 바뀌어 이전 내용을 비웠어요."
                : uploadReadbackPending
                  ? "이미 접수된 자료는 다시 업로드하지 않아도 돼요. 새로고침으로 최신 목록을 확인해 주세요."
                  : acceptedFileRetries.length
                    ? "자료 처리 요청은 이미 접수됐어요. 다시 요청하지 말고 새로고침으로 최신 상태를 확인해 주세요."
                    : "입력한 내용은 보존돼요. 확인한 뒤 다시 시도해 주세요."}
      </p>
      <div data-product-workspace-buttons="" className="flex min-w-0 flex-wrap items-center gap-2">
        {error.code === "UNAUTHENTICATED" ? (
          <ButtonLink href={accessHref("login")}>로그인</ButtonLink>
        ) : error.code === "CONSENT_REQUIRED" ? (
          <ButtonLink href={accessHref("consent")}>동의 확인</ButtonLink>
        ) : error.code === "QUOTA_EXCEEDED" ? (
          <ButtonLink href="/settings">사용량 확인</ButtonLink>
        ) : (
          <Button
            variant="secondary"
            disabled={!!busy}
            onClick={() =>
              void run("refresh", async (epoch) => {
                if (!(await load())) return;
                if (!(await verify()) || !current(epoch)) return;
                setNotice("최신 내용을 불러왔어요.");
              })
            }
          >
            새로고침 · 다시 확인
          </Button>
        )}
      </div>
    </section>
  ) : null;
  const uploadRecovery =
    ready && retryUploads.length > 0 ? (
      <section
        data-product-workspace-upload=""
        className="space-y-3 rounded-xl border border-[var(--pui-border)] bg-[var(--pui-background)] p-4 text-sm leading-7 text-[var(--pui-muted)]"
        aria-label="자료 업로드 이어하기"
      >
        <p>업로드가 끝나지 않은 선택 자료가 {retryUploads.length}개 있어요.</p>
        <div
          data-product-workspace-buttons=""
          className="flex min-w-0 flex-wrap items-center gap-2"
        >
          <Button
            variant="secondary"
            disabled={!!busy || readonly || (tab === "chat" && !uploadConsent)}
            onClick={() => void upload(retryUploads, uploadForConversation.current)}
          >
            업로드 다시 시도
          </Button>
        </div>
      </section>
    ) : null;

  return { errorFeedback, uploadRecovery };
}
