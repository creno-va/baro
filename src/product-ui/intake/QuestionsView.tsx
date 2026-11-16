import { ArrowLeft, ArrowRight, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { accessHref } from "../../client/return-path";
import type { V2CaseContext } from "../../contracts/v2";
import { Button, ButtonLink } from "../Button";
import { cn } from "../utils";
import { CaseInputError } from "./CaseInputError";
import { QuestionAnswerField } from "./QuestionAnswerField";
import { QuestionRecovery } from "./QuestionRecovery";
import type { QuestionsController } from "./useQuestionsController";

export function QuestionsView({ controller: view }: { controller: QuestionsController }) {
  const {
    caseId,
    item,
    caseContext,
    result,
    index,
    question,
    ready,
    canMutate,
    loading,
    error,
    editing,
    waiting,
    leaving,
    locked,
    heading,
    round,
    roundIndex,
    finalQuestion,
    statusTitle,
    failureTitle,
    failureDescription,
  } = view;
  const base = `/cases/${encodeURIComponent(caseId)}`;
  const recovery = (
    <QuestionRecovery
      title={failureTitle}
      description={failureDescription}
      retryDisabled={view.recoveryRetryDisabled}
      resumeDisabled={view.resumeDisabled}
      retry={view.retryPreparation}
      resume={view.resumeLater}
    />
  );
  return (
    <div
      data-product-questions=""
      className="mx-auto w-full max-w-[800px] px-4 pb-10 text-[var(--pui-text)] [view-transition-name:intake-page] sm:px-8"
    >
      <nav
        aria-label="사건 정리 탐색"
        className="flex min-h-16 flex-wrap items-center justify-between gap-2 border-b border-[var(--pui-border)] py-3 text-xs text-[var(--pui-muted)]"
      >
        <ButtonLink
          href="/cases"
          variant="ghost"
          className="-ml-3 rounded-full px-3 text-xs text-[var(--pui-muted)]"
        >
          <ArrowLeft size={16} aria-hidden="true" />내 사건
        </ButtonLink>
        <span>
          {question
            ? `${round.ordinal}차 질문 · ${roundIndex + 1} / ${round.questionIds.length}`
            : "질문은 최대 두 차례"}
        </span>
      </nav>
      {loading && !result && !error && <PreparationStatus title="저장한 질문을 불러오고 있어요." />}
      {error ? (
        <div className="mt-6">
          <CaseInputError error={error} retry={view.retry} disabled={view.retryDisabled} />
        </div>
      ) : null}
      {ready && item && result && (
        <section
          data-product-question-scene=""
          data-transition={leaving ? "leaving" : "idle"}
          className="pt-10 sm:pt-16"
        >
          {!canMutate && (
            <p className="mb-6 text-sm leading-6 text-[var(--pui-muted)]">
              저장한 질문과 답변을 읽을 수 있어요. 변경·AI 처리에는{" "}
              <a className="underline underline-offset-4" href={accessHref("consent")}>
                최신 동의 확인
              </a>
              이 필요해요.
            </p>
          )}
          {item.schemaVersion === "1" ? (
            <SavedState title="이 사건은 기존 기록이에요.">
              <ButtonLink href={base} variant="secondary">
                기존 기록 열기
              </ButtonLink>
            </SavedState>
          ) : item.stage === "active" || item.stage === "archived" ? (
            <SavedState title="확인한 사건을 이어서 정리할 수 있어요.">
              <ButtonLink href={base} variant="secondary">
                사건 열기
              </ButtonLink>
            </SavedState>
          ) : result.complete && !editing && !waiting ? (
            <SavedState title="질문 정리가 끝났어요. 요약을 확인해 주세요.">
              <ButtonLink href={`${base}/summary`} variant="secondary">
                요약 확인하기
              </ButtonLink>
            </SavedState>
          ) : (
            <div
              key={question?.id ?? "initial"}
              data-product-question-content=""
              data-waiting={waiting}
              className={cn(
                "motion-reduce:animate-none motion-reduce:transform-none",
                leaving
                  ? "pointer-events-none animate-[intake-scene-out_160ms_ease-in_both]"
                  : "animate-[intake-scene-in_360ms_cubic-bezier(0.2,0.7,0.2,1)_both]",
              )}
            >
              {caseContext ? (
                <QuestionContext context={caseContext} />
              ) : (
                <p role="status" className="mb-6 text-xs leading-5 text-[var(--pui-muted)]">
                  사건 입장 정보를 불러오지 못했어요. 저장한 답변은 계속 확인할 수 있어요.
                </p>
              )}
              <header className="mb-8">
                <h1
                  ref={heading}
                  tabIndex={-1}
                  id="question-heading"
                  className="text-2xl font-medium leading-snug tracking-tight focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--pui-focus)] sm:text-3xl"
                >
                  {question?.text ?? "필요한 내용만 확인할게요"}
                </h1>
                <p className="mt-3 text-sm leading-6 text-[var(--pui-muted)]">
                  {question
                    ? finalQuestion
                      ? "마지막 질문이에요. 기억나는 만큼만 알려주세요."
                      : "기억나는 만큼만 편하게 알려주세요."
                    : "말씀해 주신 상황에서 질문을 고르고 있어요."}
                </p>
              </header>
              {!question ? (
                waiting ? (
                  <PreparationStatus title={statusTitle} />
                ) : result.failed ? (
                  recovery
                ) : (
                  <Button
                    data-product-question-primary=""
                    disabled={locked}
                    onClick={view.start}
                    className="rounded-full"
                  >
                    질문 시작하기 <ArrowRight size={18} aria-hidden="true" />
                  </Button>
                )
              ) : (
                <form noValidate onSubmit={view.submit}>
                  <QuestionAnswerField question={question} controller={view} />
                  <div
                    data-product-question-navigation=""
                    data-product-question-action=""
                    className="mt-8 flex items-center justify-between gap-3"
                  >
                    {index > 0 && (
                      <Button
                        data-product-question-back=""
                        variant="secondary"
                        disabled={view.backDisabled}
                        onClick={view.previous}
                        className="rounded-full"
                      >
                        <ArrowLeft size={18} aria-hidden="true" />
                        이전으로
                      </Button>
                    )}
                    {waiting ? (
                      <PreparationStatus title={statusTitle} />
                    ) : !canMutate ? (
                      <Button
                        data-product-question-primary=""
                        type="button"
                        disabled={view.nextReadDisabled}
                        onClick={view.nextRead}
                        className="ml-auto rounded-full"
                      >
                        다음 질문 <ArrowRight size={18} aria-hidden="true" />
                      </Button>
                    ) : (
                      <Button
                        data-product-question-primary=""
                        type="submit"
                        disabled={view.submitDisabled}
                        className="ml-auto min-w-0 shrink rounded-full [overflow-wrap:anywhere]"
                      >
                        {view.primaryLabel}
                        <ArrowRight size={18} className="shrink-0" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                  {result.failed && !waiting && recovery}
                </form>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function PreparationStatus({ title }: { title: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="flex min-h-11 items-center gap-2 py-6 text-sm leading-6 text-[var(--pui-muted)]"
    >
      <LoaderCircle
        size={18}
        className="shrink-0 animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      />
      <p>{title}</p>
    </div>
  );
}

function SavedState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="status" className="space-y-5 py-8">
      <p className="text-sm leading-6 text-[var(--pui-muted)]">{title}</p>
      {children}
    </div>
  );
}

function QuestionContext({ context }: { context: V2CaseContext }) {
  const purpose = {
    prepare_claim: "고소 준비",
    respond_to_claim: "주장 대응",
    unconfirmed: "미확인 입장",
  };
  const kind = {
    civil: "민사",
    criminal: "형사",
    family: "가사",
    administrative: "행정",
    labor: "노동",
    other: "기타 분야",
    unconfirmed: "사건 분야 미확인",
  };
  const stage = {
    before_filing: "고소·청구 전",
    investigation: "수사",
    first_instance: "1심 재판",
    appeal: "항소",
    final_appeal: "상고",
    enforcement: "집행",
    other: "기타 단계",
    unconfirmed: "절차 단계 미확인",
  };
  return (
    <aside
      aria-label="사건 입장과 맥락"
      className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5 text-[var(--pui-muted)]"
    >
      <span>{purpose[context.casePurpose]}</span>
      {context.procedure.kind !== "unconfirmed" && <span>{kind[context.procedure.kind]}</span>}
      {context.procedure.stage !== "unconfirmed" && <span>{stage[context.procedure.stage]}</span>}
      {context.procedure.description && (
        <p className="w-full whitespace-pre-wrap [overflow-wrap:anywhere]">
          {context.procedure.description}
        </p>
      )}
    </aside>
  );
}
