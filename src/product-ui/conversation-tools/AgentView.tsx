import { ArrowRight, LoaderCircle } from "lucide-react";
import { ConversationAnalysis } from "../../components/workspace/ConversationAnalysis";
import { ConversationPanel } from "../../components/workspace/ConversationPanel";
import {
  conversationActionLabels,
  conversationPaneTitles,
} from "../../components/workspace/conversation-state";
import type { V2ConversationIntent } from "../../contracts/v2";
import { Button, ButtonLink } from "../Button";
import { Disclosure, DisclosureSummary } from "../Disclosure";
import type { ConversationAgentController } from "./useConversationAgentController";

/** Snapshot and callbacks only: no authenticated client or request is imported. */
export function AgentView({ controller }: { controller: ConversationAgentController }) {
  const {
    state,
    pane,
    error,
    busy,
    paneBusy,
    checkingConfirmation,
    attempt,
    recheck,
    execute,
    canMutate,
    reportHref,
    next,
    disabled,
    stateIsCurrent,
    menu,
    continuationPending,
    continuationUnconfirmed,
    close,
    origin,
    mounted,
    current,
    paneEpoch,
    abort,
    result,
    waiting,
    missingItems,
    workspace,
    onReviewFile,
    renderPane,
    changed,
    changeDirty,
    changePaneBusy,
    setViewedReport,
    dirty,
    setHasDraft,
    setResult,
    setPane,
  } = controller;
  const errorFeedback = error ? (
    <div
      data-product-conversation-error=""
      className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--pui-danger)] bg-[var(--pui-surface)] p-3 text-sm text-[var(--pui-danger)]"
      role="alert"
    >
      <p className="w-full leading-6 [overflow-wrap:anywhere]">{error}</p>
      <Button
        variant="secondary"
        size="sm"
        disabled={busy || checkingConfirmation}
        onClick={(event) => void recheck(event.currentTarget)}
      >
        상태 다시 확인
      </Button>
      {attempt.current && (
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || disabled}
          onClick={(event) => {
            event.currentTarget.focus();
            const request = attempt.current?.input;
            if (request) void execute(request.action, request.requestId);
          }}
        >
          같은 요청 결과 확인
        </Button>
      )}
    </div>
  ) : null;
  return (
    <div data-product-conversation-agent="" className="min-w-0 space-y-4">
      {!pane && errorFeedback}
      {state && (
        <>
          {!canMutate && (
            <p className="text-sm leading-6 text-[var(--pui-muted)]">
              저장된 내용을 확인할 수 있어요. 새 분석·수정·생성은 현재 정책 동의 후 이어갈 수
              있어요.
            </p>
          )}
          <fieldset
            data-product-conversation-actions=""
            className="flex min-w-0 flex-wrap items-start gap-2 border-0 p-0"
          >
            <legend className="sr-only">대화에서 이어갈 작업</legend>
            {reportHref && next === "prepare_report" && state.report.status === "ready" ? (
              <ButtonLink href={reportHref}>
                리포트 열기 <ArrowRight size={16} aria-hidden="true" />
              </ButtonLink>
            ) : (
              <Button
                type="button"
                variant="primary"
                disabled={disabled || !stateIsCurrent || busy || paneBusy}
                aria-busy={busy || undefined}
                onClick={(event) => {
                  event.currentTarget.focus();
                  if (next) void execute(next);
                }}
              >
                {busy && (
                  <LoaderCircle
                    size={16}
                    className="animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                )}
                {next && conversationActionLabels[next]} <ArrowRight size={16} aria-hidden="true" />
              </Button>
            )}
            <Disclosure ref={menu} className="min-w-40 flex-1 sm:max-w-xs">
              <DisclosureSummary>다른 작업</DisclosureSummary>
              <fieldset
                data-product-conversation-menu=""
                className="grid min-w-0 gap-1 border-0 p-0 [&_button]:justify-start [&_a]:justify-start"
                disabled={disabled || !stateIsCurrent || busy || paneBusy}
              >
                <legend className="sr-only">다른 사건 작업</legend>
                {(Object.keys(conversationActionLabels) as V2ConversationIntent[])
                  .filter((action) => action !== next)
                  .map((action) =>
                    reportHref &&
                    (["save_report", "resolve_followup", "open_lawyers"].includes(action) ||
                      (action === "prepare_report" && state.report.status === "ready")) ? (
                      <ButtonLink key={action} href={reportHref} variant="ghost" size="sm">
                        {action === "prepare_report"
                          ? "리포트 열기"
                          : conversationActionLabels[action]}
                      </ButtonLink>
                    ) : (
                      <Button
                        type="button"
                        key={action}
                        variant="ghost"
                        size="sm"
                        onClick={(event) => {
                          event.currentTarget.focus();
                          void execute(action);
                        }}
                      >
                        {conversationActionLabels[action]}
                      </Button>
                    ),
                  )}
              </fieldset>
            </Disclosure>
          </fieldset>
        </>
      )}
      {(continuationPending || continuationUnconfirmed) && (
        <div className="text-sm leading-6 text-[var(--pui-muted)]" role="status">
          <p>
            {continuationUnconfirmed
              ? "리포트 준비 결과를 직접 다시 확인해 주세요. 입력과 자료는 보존돼요."
              : "리포트 준비 결과를 확인하고 있어요. 아직 완료된 결과는 아니에요."}
          </p>
          {continuationUnconfirmed && !error && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || checkingConfirmation}
              onClick={(event) => void recheck(event.currentTarget)}
            >
              리포트 상태 다시 확인
            </Button>
          )}
        </div>
      )}
      {!state && !error && (
        <p className="text-sm leading-6 text-[var(--pui-muted)]" role="status">
          <LoaderCircle
            size={16}
            className="inline animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />{" "}
          사건의 현재 작업 상태를 확인하고 있어요.
        </p>
      )}
      {pane && state && (
        <ConversationPanel
          key={pane}
          title={conversationPaneTitles[pane]}
          busy={busy || paneBusy}
          onClose={close}
          returnFocus={origin.current}
          canRestoreFocus={() =>
            mounted.current && current(paneEpoch.current) && !abort.current.signal.aborted
          }
        >
          {errorFeedback}
          {!stateIsCurrent && !error && (
            <p role="status">현재 사건 상태를 다시 확인하고 있어요. 검토 중인 입력은 보존돼요.</p>
          )}
          {result?.status === "pending" && waiting && (
            <p role="status">
              요청을 접수했어요. 필요한 준비와 현재 결과를 확인하고 있어요. 아직 완료된 결과는
              아니에요.
            </p>
          )}
          {!!missingItems.length && (
            <ul
              aria-label="작업에 필요한 확인 사항"
              className="list-disc space-y-1 rounded-xl bg-[var(--pui-background)] py-3 pl-8 pr-3 text-sm leading-6 text-[var(--pui-muted)]"
            >
              {missingItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          {pane === "analysis" ? (
            stateIsCurrent ? (
              <ConversationAnalysis
                state={state}
                files={workspace.files}
                facts={workspace.facts}
                onReviewFile={onReviewFile}
              />
            ) : null
          ) : (
            renderPane(pane, {
              state,
              disabled: disabled || busy || !canMutate || !stateIsCurrent,
              readDisabled: disabled || busy || !stateIsCurrent,
              onChanged: changed,
              onCancel: close,
              onDirtyChange: changeDirty,
              onBusyChange: changePaneBusy,
              onReportViewed: (identity) => {
                if (
                  pane !== "report" ||
                  !mounted.current ||
                  !current(paneEpoch.current) ||
                  abort.current.signal.aborted
                )
                  return;
                // The report owner emits only a freshly accepted body. Keep
                // that identity even if conversation metadata catches up next;
                // it counts only when the current report has the same identity.
                setViewedReport(`${identity.id}:${identity.revision}`);
              },
              onOpenPane: (nextPane) => {
                if (!mounted.current || !current(paneEpoch.current)) return;
                dirty.current = false;
                setHasDraft(false);
                setResult(null);
                setPane(nextPane);
              },
            })
          )}
        </ConversationPanel>
      )}
    </div>
  );
}
