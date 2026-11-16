import type { ReactNode } from "react";
import { accessHref } from "../../client/return-path";
import { Button } from "../Button";
import { LegacyCaseSection, legacyLinkClass, legacyMutedClass } from "./LegacyCaseParts";
import { terminal } from "./presentation";
import type { CaseDetailController } from "./useCaseDetailController";

export function CaseDetailView({
  controller,
  questions,
  result,
  feedback,
}: {
  controller: CaseDetailController;
  questions: ReactNode;
  result: ReactNode;
  feedback: ReactNode;
}) {
  const {
    caseId,
    detail,
    stage,
    error,
    busy,
    confirmDelete,
    deleted,
    consent,
    heading,
    refreshSignal,
    mutate,
    setConfirmDelete,
  } = controller;
  if (deleted)
    return (
      <LegacyCaseSection data-product-legacy-case="" className="mx-auto max-w-4xl">
        <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold tracking-tight">
          사건과 관련 분석을 삭제했어요.
        </h1>
        <a className={legacyLinkClass} href="/cases">
          내 사건으로
        </a>
      </LegacyCaseSection>
    );
  return (
    <div
      data-product-legacy-case=""
      className="mx-auto w-full max-w-4xl space-y-6 pb-12 text-[var(--pui-text)] [overflow-wrap:anywhere]"
    >
      <header className="space-y-3 py-5 sm:py-8">
        <h1
          ref={heading}
          tabIndex={-1}
          className="text-2xl font-semibold tracking-tight sm:text-3xl"
        >
          {detail?.title ?? "사건 확인"}
        </h1>
        <p
          data-product-legacy-case-status=""
          className={legacyMutedClass}
          aria-live="polite"
          aria-atomic="true"
        >
          {busy ? "요청을 저장하고 있어요." : stage || "사건을 불러오고 있어요."}
        </p>
      </header>
      {error && (
        <LegacyCaseSection data-product-legacy-case-error="">
          <p role="alert" className="text-sm leading-7 text-[var(--pui-danger)]">
            {error}
          </p>
          {consent ? (
            <a className={legacyLinkClass} href={accessHref("consent", `/cases/${caseId}`)}>
              필수 동의 확인
            </a>
          ) : (
            <Button variant="secondary" type="button" onClick={() => refreshSignal.current?.()}>
              최신 상태 다시 확인
            </Button>
          )}
        </LegacyCaseSection>
      )}
      {detail?.status === "needs_clarification" && questions}
      {detail && !terminal.has(detail.status) && detail.status !== "needs_clarification" && (
        <LegacyCaseSection title={stage}>
          <p className={legacyMutedClass}>
            화면을 떠나도 입력은 저장돼요. 내 사건에서 다시 확인할 수 있어요.
          </p>
        </LegacyCaseSection>
      )}
      {detail?.result && result}
      {detail?.result?.kind === "guidance" && feedback}
      {detail?.status === "failed" && (
        <LegacyCaseSection title="분석을 완료하지 못했어요" data-product-legacy-case-failure="">
          <p className={legacyMutedClass}>
            {detail.error?.code === "LEGAL_SOURCE_UNAVAILABLE"
              ? "공식 자료를 확인하지 못해 결과를 만들지 않았어요."
              : detail.error?.message}
          </p>
          {detail.error?.retryable ? (
            <Button
              type="button"
              disabled={busy}
              onClick={() => void mutate("retry", { inputRevision: detail.inputRevision })}
            >
              분석 다시 시도
            </Button>
          ) : (
            <div
              data-product-legacy-failure-actions=""
              className="flex flex-wrap items-center gap-3"
            >
              <Button
                variant="secondary"
                type="button"
                disabled={busy}
                onClick={() => refreshSignal.current?.()}
              >
                분석 상태 다시 확인
              </Button>
              <a className={legacyLinkClass} href="/cases/new">
                새 사건 입력
              </a>
            </div>
          )}
        </LegacyCaseSection>
      )}
      {detail && (
        <LegacyCaseSection title="사건 삭제" data-product-legacy-case-delete="">
          {confirmDelete ? (
            <>
              <p className={legacyMutedClass}>
                사건 입력과 관련 분석·결과를 삭제해요. 되돌릴 수 없어요.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="danger"
                  type="button"
                  disabled={busy}
                  onClick={() => void mutate("delete")}
                >
                  사건 삭제 확인
                </Button>
                <Button
                  variant="secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmDelete(false)}
                >
                  취소
                </Button>
              </div>
            </>
          ) : (
            <Button
              variant="secondary"
              type="button"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              사건 삭제
            </Button>
          )}
        </LegacyCaseSection>
      )}
      <a className={legacyLinkClass} href="/cases">
        내 사건으로
      </a>
    </div>
  );
}
