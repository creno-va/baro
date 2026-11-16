import { CircleAlert } from "lucide-react";
import { ApiError } from "../../client/api/errors";
import { accessHref } from "../../client/return-path";
import { Button, ButtonLink } from "../Button";

/** Keep the entry screen's existing authentication, conflict and retry actions. */
export function CaseInputError({
  error,
  retry,
  disabled = false,
}: {
  error: unknown;
  retry?: () => void;
  disabled?: boolean;
}) {
  const value = error instanceof ApiError ? error : null;
  const code = value?.code;
  const permission = code === "UNAUTHENTICATED" || code === "CONSENT_REQUIRED";
  const status = permission || code === "QUOTA_EXCEEDED";
  return (
    <div
      role={status ? "status" : "alert"}
      aria-live={status ? "polite" : "assertive"}
      className="flex items-start gap-3 rounded-2xl border border-[var(--pui-border)] bg-[var(--pui-surface)] p-4 text-sm text-[var(--pui-text)]"
    >
      <CircleAlert
        size={20}
        className="mt-0.5 shrink-0 text-[var(--pui-danger)]"
        aria-hidden="true"
      />
      <div className="min-w-0 space-y-3 [overflow-wrap:anywhere]">
        <p>{value?.message || "요청을 완료하지 못했어요. 입력은 그대로 남아 있어요."}</p>
        {code === "CONFLICT" && (
          <p className="text-[var(--pui-muted)]">
            다른 화면에서 저장한 내용이 있어요. 최신 내용을 확인하고 다시 저장해 주세요.
          </p>
        )}
        {code === "UNAUTHENTICATED" ? (
          <ButtonLink variant="secondary" href={accessHref("login")}>
            로그인하기
          </ButtonLink>
        ) : code === "CONSENT_REQUIRED" ? (
          <ButtonLink variant="secondary" href={accessHref("consent")}>
            동의 확인
          </ButtonLink>
        ) : retry && (!value || value.retryable || code === "CONFLICT") ? (
          <Button variant="secondary" disabled={disabled} onClick={retry}>
            {code === "CONFLICT" ? "최신 내용 불러오기" : "다시 시도"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
