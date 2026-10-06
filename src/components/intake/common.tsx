import { ArrowLeft, Check, Circle } from "lucide-react";
import type { CaseView } from "../../client/api/types";
import { Button, ButtonLink } from "../ui/button";
import { StatePanel } from "../ui/state-panel";

export function caseHref(item: CaseView) {
  const id = encodeURIComponent(item.id);
  if (item.schemaVersion === "1") return `/cases/${id}`;
  return item.stage === "intake"
    ? `/cases/${id}/intake`
    : item.stage === "summary"
      ? `/cases/${id}/summary`
      : `/cases/${id}`;
}
export function IntakeProgress({ step }: { step: number }) {
  return (
    <ol className="intake-steps" aria-label="사건 정리 단계">
      {["상황 입력", "질문 답하기", "요약 확인"].map((label, index) => (
        <li
          key={label}
          aria-current={index === step ? "step" : undefined}
          className={index <= step ? "is-current" : ""}
        >
          {index < step ? (
            <Check size={16} aria-hidden="true" />
          ) : (
            <Circle size={16} aria-hidden="true" />
          )}
          <span>{label}</span>
        </li>
      ))}
    </ol>
  );
}
export function BackToCases() {
  return (
    <ButtonLink variant="ghost" href="/cases">
      <ArrowLeft size={16} aria-hidden="true" />내 사건
    </ButtonLink>
  );
}
export function ErrorPanel({
  error,
  retry,
  disabled = false,
}: {
  error: unknown;
  retry?: () => void;
  disabled?: boolean;
}) {
  const value = error as { code?: string; message?: string };
  const code = value?.code;
  return (
    <StatePanel
      variant={
        code === "QUOTA_EXCEEDED"
          ? "limit"
          : code === "UNAUTHENTICATED" || code === "CONSENT_REQUIRED"
            ? "permission"
            : "error"
      }
      title={value?.message || "요청을 완료하지 못했어요. 입력은 그대로 남아 있어요."}
      {...(code === "CONFLICT"
        ? {
            description:
              "다른 화면에서 저장한 내용이 있어요. 최신 내용을 확인하고 다시 저장해 주세요.",
          }
        : {})}
      action={
        code === "UNAUTHENTICATED" ? (
          <ButtonLink href="/login">로그인하기</ButtonLink>
        ) : code === "CONSENT_REQUIRED" ? (
          <ButtonLink href="/consent">동의 확인</ButtonLink>
        ) : retry ? (
          <Button variant="outline" disabled={disabled} onClick={retry}>
            {code === "CONFLICT" ? "최신 내용 불러오기" : "다시 시도"}
          </Button>
        ) : undefined
      }
    />
  );
}
