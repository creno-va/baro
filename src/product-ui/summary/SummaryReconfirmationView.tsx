import { ArrowLeft, ArrowRight, Check, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { accessHref } from "../../client/return-path";
import { Button, ButtonLink } from "../Button";
import { Dialog } from "../Dialog";
import { TextareaField } from "../Field";
import { cn } from "../utils";
import { purposeLabels, SummaryContext } from "./SummaryContext";
import { SummaryMaterials } from "./SummaryMaterials";
import { SummaryProblem } from "./SummaryProblem";
import { SummaryChanges, SummaryReading } from "./SummaryReading";
import type { SummaryReconfirmationController } from "./useSummaryReconfirmationController";

const actionClass = "flex flex-wrap items-center gap-2";

export function SummaryReconfirmationView({
  controller: view,
}: {
  controller: SummaryReconfirmationController;
}) {
  const { item, state, context, embedded, base, ready, busy, locked, proposal, activeRequest } =
    view;
  const errorPanel = view.error ? (
    <SummaryProblem error={view.error} disabled={busy} retry={view.retry} />
  ) : null;
  return (
    <div
      data-product-summary-root=""
      data-embedded={embedded}
      className={cn(
        "min-w-0 text-[var(--pui-text)]",
        embedded
          ? "space-y-6"
          : "mx-auto w-full max-w-[1120px] px-4 pb-12 [view-transition-name:intake-page] sm:px-8",
      )}
    >
      {!embedded && (
        <nav
          aria-label="사건 정리 탐색"
          className="flex min-h-16 flex-wrap items-center justify-between gap-2 border-b border-[var(--pui-border)] py-3 text-xs text-[var(--pui-muted)]"
        >
          <ButtonLink
            variant="ghost"
            href={item?.stage === "active" ? view.returnHref : "/cases"}
            className="-ml-3 rounded-full px-3 text-xs"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            {item?.stage === "active" ? "작업 공간으로 돌아가기" : "내 사건"}
          </ButtonLink>
          <span>사건 정리 재확인</span>
        </nav>
      )}
      {view.loading && !item && !view.error && (
        <ProgressNotice title="저장한 사건 정리를 불러오고 있어요." />
      )}
      {!view.modalActive && errorPanel && <div className="my-6">{errorPanel}</div>}
      {item && ready && (
        <section
          aria-labelledby={view.headingId}
          aria-busy={busy}
          className={embedded ? "space-y-6" : "space-y-8 pt-10 sm:pt-14"}
        >
          <header className="space-y-3">
            {embedded ? (
              <h2 id={view.headingId} className="text-xl font-medium leading-snug">
                사건 정리를 다시 확인해요
              </h2>
            ) : (
              <>
                <h1
                  id={view.headingId}
                  className="text-2xl font-medium leading-snug tracking-tight sm:text-3xl"
                >
                  이야기를 이렇게 정리했어요
                </h1>
                <p className="text-sm leading-6 text-[var(--pui-muted)]">
                  다르거나 빠진 내용을 알려주세요. 변경안을 함께 확인한 뒤 반영해요.
                </p>
              </>
            )}
            {context ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SummaryContext context={context} />
                {item.schemaVersion !== "1" && item.stage !== "archived" && (
                  <Button
                    variant="secondary"
                    disabled={locked || activeRequest}
                    onClick={view.openPurpose}
                    className="rounded-full text-xs"
                  >
                    {context.casePurpose === "unconfirmed" ? "입장 확인하기" : "입장 변경"}
                  </Button>
                )}
              </div>
            ) : item.stage === "intake" ? null : (
              <p role="status" className="text-xs leading-6 text-[var(--pui-muted)]">
                {item.schemaVersion === "1"
                  ? "미확인 입장"
                  : item.stage === "archived"
                    ? "보관한 사건이에요. 저장한 정리를 읽을 수 있어요."
                    : "사건 입장 정보를 불러오지 못했어요."}
              </p>
            )}
          </header>
          {item.schemaVersion === "1" || item.stage === "archived" ? (
            <>
              <p
                data-product-summary-overview=""
                className="whitespace-pre-wrap text-base leading-8 [overflow-wrap:anywhere]"
              >
                {item.summary}
              </p>
              <ReadNotice title="저장한 사건을 읽을 수 있어요.">
                <ButtonLink href={base} variant="secondary">
                  사건 열기
                </ButtonLink>
              </ReadNotice>
            </>
          ) : !["summary", "active"].includes(item.stage) ? (
            <ReadNotice title="먼저 질문을 마치고 정리를 준비해 주세요.">
              <ButtonLink href={`${base}/intake`} variant="secondary">
                질문 이어가기
              </ButtonLink>
            </ReadNotice>
          ) : (
            <div
              className={cn(
                "grid min-w-0 gap-10",
                !embedded &&
                  (view.files.length > 0 || view.materialsError) &&
                  "xl:grid-cols-[minmax(0,1fr)_240px]",
              )}
            >
              <div className="min-w-0 space-y-8">
                {item.summaryDetails ? (
                  <SummaryReading
                    summary={item.summaryDetails}
                    context={item.intakeQuestions}
                    base={base}
                    files={view.files}
                  />
                ) : (
                  <p
                    data-product-summary-overview=""
                    className="whitespace-pre-wrap text-base leading-8 [overflow-wrap:anywhere]"
                  >
                    {item.summary}
                  </p>
                )}
                {!view.canMutate && (
                  <p className="text-sm leading-6 text-[var(--pui-muted)]">
                    읽을 수 있는 저장본이에요. 변경·확인하려면{" "}
                    <a className="underline underline-offset-4" href={accessHref("consent")}>
                      최신 동의 확인
                    </a>
                    이 필요해요.
                  </p>
                )}
                <section
                  ref={view.focusTarget}
                  aria-label="사건 정리 확인"
                  tabIndex={-1}
                  className="space-y-6 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--pui-focus)]"
                >
                  {proposal && (
                    <>
                      <SummaryChanges
                        proposal={proposal}
                        base={base}
                        context={item.intakeQuestions}
                        files={view.files}
                      />
                      <div data-product-summary-actions="" className={actionClass}>
                        <Button disabled={locked} aria-busy={busy} onClick={view.confirmProposal}>
                          <Check size={18} aria-hidden="true" />
                          변경안 확정하기
                        </Button>
                        <Button variant="secondary" disabled={locked} onClick={view.cancelProposal}>
                          변경안 취소
                        </Button>
                        <Button variant="ghost" disabled={locked} onClick={view.explainAgain}>
                          다시 설명하기
                        </Button>
                      </div>
                    </>
                  )}
                  {state && ["pending", "running"].includes(state.status) && (
                    <ReadNotice
                      title="변경안을 준비하고 있어요"
                      working
                      description="기존 정리는 그대로예요. 이 화면을 닫았다가 다시 와도 이어서 확인할 수 있어요."
                    >
                      <Button variant="secondary" disabled={locked} onClick={view.cancelProposal}>
                        요청 취소
                      </Button>
                    </ReadNotice>
                  )}
                  {state && ["failed", "stale"].includes(state.status) && (
                    <ReadNotice
                      alert
                      title={
                        state.status === "stale"
                          ? "사건 내용이 바뀌어 변경안을 다시 확인해야 해요."
                          : "변경안을 준비하지 못했어요."
                      }
                      description="기존 정리와 요청한 설명은 남아 있어요."
                    >
                      <div data-product-summary-actions="" className={actionClass}>
                        <Button disabled={locked} onClick={view.explainAgain}>
                          다시 설명하기
                        </Button>
                        <Button variant="secondary" disabled={locked} onClick={view.cancelProposal}>
                          요청 취소
                        </Button>
                      </div>
                    </ReadNotice>
                  )}
                  {!activeRequest && (
                    <div data-product-summary-actions="" className={actionClass}>
                      <Button
                        disabled={locked || !item.summary.trim()}
                        aria-haspopup="dialog"
                        onClick={view.agree}
                      >
                        맞아요
                        <ArrowRight size={18} aria-hidden="true" />
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={locked}
                        onClick={(event) => view.explain("correction", event)}
                      >
                        다른 부분이 있어요
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={locked}
                        onClick={(event) => view.explain("addition", event)}
                      >
                        빠진 내용이 있어요
                      </Button>
                    </div>
                  )}
                </section>
                <p role="status" className="text-sm leading-6 text-[var(--pui-muted)]">
                  {view.notice}
                </p>
                {view.onCancel && (
                  <Button variant="ghost" disabled={busy} onClick={view.onCancel}>
                    재확인 닫기
                  </Button>
                )}
                <p className="text-xs leading-6 text-[var(--pui-muted)]">
                  AI가 정리한 내용이며, 법률 판단은 아니에요.
                </p>
              </div>
              {(view.files.length > 0 || view.materialsError) && (
                <aside className="min-w-0 border-t border-[var(--pui-border)] pt-6 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
                  <SummaryMaterials
                    caseId={view.caseId}
                    files={view.files}
                    facts={item.summaryDetails?.facts}
                  />
                  {view.materialsError && (
                    <p role="status" className="mt-3 text-xs leading-6 text-[var(--pui-muted)]">
                      자료 목록을 불러오지 못했어요.{" "}
                      <a href={`${base}/files`} className="underline underline-offset-4">
                        자료 화면에서 다시 확인
                      </a>
                    </p>
                  )}
                </aside>
              )}
            </div>
          )}
        </section>
      )}
      <Dialog
        preserveMounted
        open={ready && view.purposeOpen}
        onClose={view.closePurpose}
        title="어떤 입장에서 정리하고 싶나요?"
        description="입장과 사건 분야·진행 단계는 서로 달라요. 확인하지 않은 입장은 미확인으로 남겨도 괜찮아요."
        footer={
          <>
            <Button
              disabled={
                locked ||
                !context ||
                !view.purposeDraft ||
                view.purposeDraft === context.casePurpose
              }
              aria-busy={busy}
              onClick={view.savePurpose}
            >
              입장 저장
            </Button>
            <Button variant="secondary" disabled={busy} onClick={view.closePurpose}>
              나중에 확인
            </Button>
          </>
        }
      >
        <fieldset disabled={busy} className="grid gap-2">
          <legend className="mb-3 text-sm font-medium">사건 입장</legend>
          {(["prepare_claim", "respond_to_claim"] as const).map((purpose) => (
            <label
              key={purpose}
              className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--pui-border)] px-4 py-3 text-sm has-checked:bg-[var(--pui-background)]"
            >
              <input
                type="radio"
                name="review-case-purpose"
                value={purpose}
                checked={view.purposeDraft === purpose}
                onChange={() => view.setPurpose(purpose)}
                className="h-4 w-4 shrink-0 appearance-auto accent-[var(--pui-text)]"
              />
              <span>{purposeLabels[purpose]}</span>
            </label>
          ))}
        </fieldset>
        {errorPanel && <div className="mt-5">{errorPanel}</div>}
      </Dialog>
      <Dialog
        preserveMounted
        open={ready && view.kind !== null}
        returnFocusRef={view.dialogReturnFocus}
        onClose={view.closeExplanation}
        title={view.kind === "correction" ? "어떤 부분이 다른가요?" : "어떤 내용이 빠졌나요?"}
        description="설명은 변경 요청으로 저장돼요. AI가 사실과 출처를 검토한 변경안을 확인한 뒤 반영할 수 있어요."
      >
        <SummaryExplanationForm controller={view} />
      </Dialog>
      <Dialog
        preserveMounted
        open={ready && view.confirming !== null}
        onClose={view.closeConfirmation}
        title="이 내용으로 계속할까요?"
        description="확인한 사실과 미확인 내용을 바탕으로 사건 정리를 이어가요."
        footer={
          <>
            <Button
              disabled={locked || !view.confirming}
              aria-busy={busy}
              onClick={view.confirmInitial}
            >
              확인하고 계속
            </Button>
            <Button variant="secondary" disabled={busy} onClick={view.closeConfirmation}>
              취소
            </Button>
          </>
        }
      >
        {errorPanel}
      </Dialog>
    </div>
  );
}

export function SummaryExplanationForm({
  controller: view,
}: {
  controller: SummaryReconfirmationController;
}) {
  const count = [...view.explanation.trim()].length;
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        view.requestChange();
      }}
      className="space-y-5"
    >
      <TextareaField
        id={view.fieldId}
        label={view.kind === "correction" ? "다른 부분을 알려주세요" : "빠진 내용을 알려주세요"}
        value={view.explanation}
        disabled={view.busy}
        onChange={(event) => view.setExplanation(event.target.value)}
        description={
          <>
            정확히 모르는 부분은 모른다고 적어주세요. 이 설명만으로 기존 사실이나 출처를 덮어쓰지
            않아요. {count.toLocaleString("ko-KR")} / 5,000자
          </>
        }
        invalid={count > 5000}
        error={count > 5000 ? "설명은 5,000자까지 입력할 수 있어요." : undefined}
        className="min-h-40"
      />
      {view.error ? (
        <SummaryProblem error={view.error} disabled={view.busy} retry={view.retry} />
      ) : null}
      <div data-product-summary-actions="" className={actionClass}>
        <Button
          type="submit"
          disabled={view.locked || !view.explanation.trim() || count > 5000}
          aria-busy={view.busy}
        >
          {view.busy && (
            <LoaderCircle
              size={16}
              className="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          )}
          변경안 요청하기
        </Button>
        <Button variant="secondary" disabled={view.busy} onClick={view.closeExplanation}>
          취소
        </Button>
      </div>
    </form>
  );
}

function ProgressNotice({ title }: { title: string }) {
  return (
    <p
      role="status"
      className="flex items-center gap-2 py-8 text-sm leading-6 text-[var(--pui-muted)]"
    >
      <LoaderCircle
        size={18}
        className="shrink-0 animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      />
      {title}
    </p>
  );
}
function ReadNotice({
  title,
  description,
  children,
  working = false,
  alert = false,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  working?: boolean;
  alert?: boolean;
}) {
  return (
    <div
      role={alert ? "alert" : "status"}
      className="space-y-3 rounded-2xl border border-[var(--pui-border)] p-4 sm:p-5"
    >
      <p className="flex items-center gap-2 text-sm font-medium">
        {working && (
          <LoaderCircle
            size={18}
            className="shrink-0 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        )}
        {title}
      </p>
      {description && <p className="text-sm leading-6 text-[var(--pui-muted)]">{description}</p>}
      {children}
    </div>
  );
}
