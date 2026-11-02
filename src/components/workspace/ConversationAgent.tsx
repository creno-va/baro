import { ArrowRight, LoaderCircle } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../client/api";
import type { WorkspaceView } from "../../client/api/types";
import { startForegroundPolling } from "../../client/foreground-poll";
import type {
  V2ConversationActionRequest,
  V2ConversationActionResult,
  V2ConversationIntent,
  V2ConversationProgress,
  V2ConversationState,
} from "../../contracts/v2";
import { Button } from "../ui/button";
import { ConversationAnalysis } from "./ConversationAnalysis";
import { ConversationPanel } from "./ConversationPanel";
import { observeReportContinuation, type ReportConfirmation } from "./conversation-progress";
import {
  conversationActionLabels,
  conversationPaneTitles,
  conversationReadPanes,
  nextConversationAction,
} from "./conversation-state";

type RequestOptions = { expectedOwner?: string; signal?: AbortSignal };
function failureMessage(cause: unknown) {
  const value = cause as { code?: string; message?: string };
  return [
    "UNAUTHENTICATED",
    "CONSENT_REQUIRED",
    "NOT_FOUND",
    "CONFLICT",
    "STALE_REVISION",
    "QUOTA_EXCEEDED",
    "USER_QUOTA_EXCEEDED",
    "VALIDATION_ERROR",
    "UNAVAILABLE",
    "IDEMPOTENCY_CONFLICT",
    "RATE_LIMITED",
    "INVALID_STATE",
    "ROLE_REQUIRED",
    "REVIEW_REQUIRED",
  ].includes(value?.code ?? "")
    ? (value.message ?? "요청을 완료하지 못했어요.")
    : "요청 결과를 확인하지 못했어요. 같은 요청으로 다시 확인할 수 있어요.";
}
export type ConversationClient = {
  getConversationProgress: (
    caseId: string,
    options?: RequestOptions,
  ) => Promise<V2ConversationProgress>;
  executeAction: (
    caseId: string,
    request: V2ConversationActionRequest,
    options?: RequestOptions,
  ) => Promise<V2ConversationActionResult>;
};
export type ConversationPane = V2ConversationActionResult["pane"];
export type ConversationPaneProps = {
  state: V2ConversationState;
  disabled: boolean;
  readDisabled: boolean;
  onChanged: () => Promise<V2ConversationState | null>;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  onOpenPane: (pane: ConversationPane) => void;
  onReportViewed: (identity: { id: string; revision: number }) => void;
};

/** Actual domain actions use the shared authenticated client. Pane content is
 * composed by Workspace from the owning modules rather than copied here. */
export function ConversationAgent({
  workspace,
  client,
  access,
  incomingMessageIds,
  disabled,
  onChanged,
  onBusyChange,
  onReviewFile,
  renderPane,
  requestedAction,
  onPaneOpen,
  refreshKey = 0,
  queuedWork = false,
}: {
  workspace: WorkspaceView;
  client: ConversationClient;
  access: {
    ready: boolean;
    canMutate: boolean;
    ticket: () => number;
    current: (epoch: number) => boolean;
    verify: (hide?: boolean, write?: boolean) => Promise<boolean>;
  };
  incomingMessageIds: ReadonlySet<string>;
  disabled: boolean;
  onChanged: () => Promise<unknown>;
  onBusyChange: (busy: boolean) => void;
  onReviewFile: (fileId: string) => void;
  renderPane: (pane: ConversationPane, props: ConversationPaneProps) => ReactNode;
  requestedAction?: { id: string; action: V2ConversationIntent } | null;
  onPaneOpen?: () => void;
  refreshKey?: number;
  queuedWork?: boolean;
}) {
  const caseId = workspace.case.id;
  const { ready, canMutate, ticket, current, verify } = access;
  const [state, setState] = useState<V2ConversationState | null>(null);
  const refreshHint = useRef(refreshKey);
  refreshHint.current = refreshKey;
  const queuedHint = useRef(queuedWork);
  queuedHint.current = queuedWork;
  const [acceptedRefresh, setAcceptedRefresh] = useState(refreshKey);
  const [readFailures, setReadFailures] = useState(0);
  const confirmation = useRef<ReportConfirmation | null>(null);
  const [confirmationView, setConfirmationView] = useState<ReportConfirmation | null>(null);
  const [checkingConfirmation, setCheckingConfirmation] = useState(false);
  const continuationPending = confirmationView?.pending === true;
  const continuationUnconfirmed = confirmationView?.unconfirmed === true;
  const observeProgress = useCallback(
    (progress: V2ConversationProgress, started: number, reset = false) => {
      const next = observeReportContinuation(
        reset ? null : confirmation.current,
        progress.reportContinuation !== null,
        started,
        performance.now(),
      );
      confirmation.current = next;
      setConfirmationView(next);
    },
    [],
  );
  const stateIsCurrent = state?.workspaceRevision === workspace.case.revision;
  const backgroundBusy =
    (queuedWork &&
      (acceptedRefresh !== refreshKey ||
        !stateIsCurrent ||
        !!state?.pendingEvidenceIds.length ||
        continuationPending ||
        continuationUnconfirmed ||
        checkingConfirmation)) ||
    (!!state &&
      (["pending", "running"].includes(state.analysis.status) ||
        state.report.status === "pending"));
  const background = useRef(backgroundBusy);
  background.current = backgroundBusy;
  const [result, setResult] = useState<V2ConversationActionResult | null>(null);
  const [pane, setPane] = useState<ConversationPane | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [paneBusy, setPaneBusy] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [reportRequested, setReportRequested] = useState(false);
  const [viewedReport, setViewedReport] = useState<string | null>(null);
  const dirty = useRef(false);
  const paneLocked = useRef(false);
  const locked = useRef(false);
  const readError = useRef(false);
  const mounted = useRef(false);
  const reads = useRef(0);
  const owner = useRef<string | null>(null);
  const abort = useRef(new AbortController());
  const processed = useRef(new Set<string>());
  const origin = useRef<HTMLElement | null>(null);
  const paneEpoch = useRef(ticket());
  const menu = useRef<HTMLDetailsElement>(null);
  const attempt = useRef<{ identity: string; input: V2ConversationActionRequest } | null>(null);
  const callbacks = useRef({ onChanged, onBusyChange });
  callbacks.current = { onChanged, onBusyChange };
  useEffect(() => {
    callbacks.current.onBusyChange(busy || paneBusy || backgroundBusy);
  }, [busy, paneBusy, backgroundBusy]);
  useEffect(() => {
    if (pane) onPaneOpen?.();
  }, [pane, onPaneOpen]);
  const changePaneBusy = useCallback((value: boolean) => {
    paneLocked.current = value;
    setPaneBusy(value);
    callbacks.current.onBusyChange(value || locked.current || background.current);
  }, []);
  const changeDirty = useCallback((value: boolean) => {
    dirty.current = value;
    setHasDraft(value);
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current.abort();
      reads.current++;
      attempt.current = null;
      owner.current = null;
      confirmation.current = null;
      callbacks.current.onBusyChange(false);
    };
  }, []);
  const authorizedOwner = useCallback(
    async (epoch: number, write: boolean) => {
      if (!(await verify(false, write)) || !current(epoch) || !mounted.current) return null;
      const session = await api.session.get();
      if (!current(epoch) || !mounted.current || !session.user) return null;
      if (owner.current && owner.current !== session.user.id) return null;
      owner.current = session.user.id;
      return session.user.id;
    },
    [verify, current],
  );
  const load = useCallback(
    async (resetConfirmation = false) => {
      if (confirmation.current?.unconfirmed && !resetConfirmation) return null;
      const serial = ++reads.current;
      const epoch = ticket();
      const hint = refreshHint.current;
      try {
        const expectedOwner = await authorizedOwner(epoch, false);
        if (!expectedOwner || serial !== reads.current) return null;
        const started = performance.now();
        const progress = await client.getConversationProgress(caseId, {
          expectedOwner,
          signal: abort.current.signal,
        });
        const value = progress.state;
        if (
          !(await verify(false, false)) ||
          !current(epoch) ||
          !mounted.current ||
          serial !== reads.current
        )
          return null;
        if (value.workspaceRevision < workspace.case.revision) {
          setReadFailures((n) => n + 1);
          setError("사건의 최신 작업 상태를 아직 확인하지 못했어요. 다시 확인해 주세요.");
          return null;
        }
        observeProgress(progress, started, resetConfirmation);
        setState(value);
        setAcceptedRefresh(hint);
        setReadFailures(0);
        if (readError.current && !attempt.current && !locked.current) {
          readError.current = false;
          setError("");
        }
        if (
          value.workspaceRevision > workspace.case.revision &&
          !(
            queuedHint.current &&
            (value.pendingEvidenceIds.length > 0 || progress.reportContinuation !== null)
          ) &&
          !["pending", "running"].includes(value.analysis.status) &&
          value.report.status !== "pending"
        ) {
          if ((await callbacks.current.onChanged()) === false)
            throw Object.assign(
              new Error("최신 사건을 불러오지 못했어요. 상태를 다시 확인해 주세요."),
              {
                code: "UNAVAILABLE",
              },
            );
        }
        return value;
      } catch (cause) {
        if (mounted.current && current(epoch) && serial === reads.current) {
          if (!attempt.current && !locked.current) readError.current = true;
          const code = (cause as { code?: string })?.code;
          setReadFailures((n) => (["CONFLICT", "STALE_REVISION"].includes(code ?? "") ? n + 1 : 3));
          setError(failureMessage(cause));
        }
        return null;
      }
    },
    [
      authorizedOwner,
      ticket,
      current,
      verify,
      client,
      caseId,
      workspace.case.revision,
      observeProgress,
    ],
  );
  useEffect(() => {
    const deadline = confirmationView?.deadline;
    if (deadline === undefined || continuationUnconfirmed) return;
    const epoch = ticket();
    const timer = setTimeout(
      () => {
        if (!mounted.current || !current(epoch) || confirmation.current?.deadline !== deadline)
          return;
        const next = { ...confirmation.current, unconfirmed: true };
        confirmation.current = next;
        setConfirmationView(next);
      },
      Math.max(0, deadline - performance.now()),
    );
    return () => clearTimeout(timer);
  }, [confirmationView?.deadline, continuationUnconfirmed, ticket, current]);
  const recheck = async (button: HTMLButtonElement) => {
    button.focus();
    const epoch = ticket();
    const panel = button.closest<HTMLElement>(".conversation-panel");
    setCheckingConfirmation(true);
    setError("");
    setReadFailures(0);
    try {
      await load(true);
    } finally {
      if (mounted.current && current(epoch)) {
        setCheckingConfirmation(false);
        requestAnimationFrame(() => {
          if (
            !mounted.current ||
            !current(epoch) ||
            button.isConnected ||
            document.activeElement !== document.body
          )
            return;
          const heading = panel?.isConnected ? panel.querySelector<HTMLElement>("h3") : null;
          if (heading) {
            heading.focus();
            return;
          }
          const root = menu.current?.closest(".workspace");
          const composer = root?.querySelector<HTMLTextAreaElement>(
            "#workspace-message:not(:disabled)",
          );
          (composer ?? root?.querySelector<HTMLElement>(".workspace-messages"))?.focus();
        });
      }
    }
  };
  useEffect(() => {
    if (ready && Number.isSafeInteger(refreshKey) && refreshKey >= 0 && !locked.current)
      void load();
  }, [ready, load, refreshKey]);
  useEffect(() => {
    if (
      !ready ||
      !state ||
      readFailures >= 3 ||
      continuationUnconfirmed ||
      !(
        (queuedWork && acceptedRefresh !== refreshKey) ||
        (queuedWork && state.pendingEvidenceIds.length > 0) ||
        !stateIsCurrent ||
        ["pending", "running"].includes(state.analysis.status) ||
        state.report.status === "pending" ||
        (continuationPending && (queuedWork || reportRequested || pane === "report"))
      )
    )
      return;
    return startForegroundPolling(async () => {
      if (locked.current || paneLocked.current) return;
      await load();
    }, 1800);
  }, [
    ready,
    state,
    stateIsCurrent,
    acceptedRefresh,
    refreshKey,
    queuedWork,
    readFailures,
    load,
    continuationPending,
    continuationUnconfirmed,
    reportRequested,
    pane,
  ]);
  const changed = useCallback(async () => {
    const epoch = ticket();
    try {
      if ((await callbacks.current.onChanged()) === false)
        throw Object.assign(
          new Error("최신 사건을 불러오지 못했어요. 상태를 다시 확인해 주세요."),
          {
            code: "UNAVAILABLE",
          },
        );
      if (current(epoch) && mounted.current) return load();
    } catch (cause) {
      if (current(epoch) && mounted.current) {
        readError.current = true;
        setReadFailures(3);
        setError(failureMessage(cause));
      }
    }
    return null;
  }, [load, ticket, current]);
  const close = useCallback(() => {
    if (locked.current || paneLocked.current) return;
    if (
      dirty.current &&
      !window.confirm("저장하지 않은 입력이 있어요. 내용을 버리고 대화로 돌아갈까요?")
    )
      return;
    dirty.current = false;
    setHasDraft(false);
    setReportRequested(false);
    setPane(null);
    setResult(null);
  }, []);
  const execute = useCallback(
    async (action: V2ConversationIntent, requestId?: string) => {
      if (disabled || !stateIsCurrent || locked.current || paneLocked.current) return;
      if (
        dirty.current &&
        !window.confirm("저장하지 않은 입력이 있어요. 내용을 버리고 다른 작업을 열까요?")
      )
        return;
      const epoch = ticket();
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      origin.current = active?.closest("details")?.querySelector<HTMLElement>("summary") ?? active;
      paneEpoch.current = epoch;
      if (menu.current) menu.current.open = false;
      locked.current = true;
      setBusy(true);
      setError("");
      readError.current = false;
      callbacks.current.onBusyChange(true);
      ++reads.current;
      try {
        const expectedOwner = await authorizedOwner(epoch, canMutate);
        if (!expectedOwner) return;
        const started = performance.now();
        const progress = await client.getConversationProgress(caseId, {
          expectedOwner,
          signal: abort.current.signal,
        });
        const fresh = progress.state;
        if (!(await verify(false, false)) || !current(epoch) || !mounted.current) return;
        if (fresh.workspaceRevision < workspace.case.revision)
          throw Object.assign(new Error("최신 사건 상태를 다시 확인해 주세요."), {
            code: "STALE_REVISION",
          });
        if (
          requestId &&
          attempt.current?.input.requestId !== requestId &&
          fresh.workspaceRevision !== state?.workspaceRevision
        )
          throw Object.assign(
            new Error(
              "요청을 준비한 뒤 사건이 바뀌었어요. 최신 내용을 확인하고 다시 선택해 주세요.",
            ),
            { code: "STALE_REVISION" },
          );
        observeProgress(progress, started, true);
        setState(fresh);
        if (!canMutate) {
          // Withdrawal keeps authorized stored reads. The children enforce their
          // own current write/consent checks; no action receipt or job is created.
          attempt.current = null;
          dirty.current = false;
          setResult(null);
          setPane(conversationReadPanes[action]);
          await changed();
          return;
        }
        const effective = action === "save_report" && !fresh.report.id ? "prepare_report" : action;
        if (effective === "prepare_report" || effective === "save_report") setReportRequested(true);
        // Preserve the reviewed identity, rather than silently saving a newer report.
        const reviewedReport = state?.report ?? fresh.report;
        const identity = JSON.stringify([
          effective,
          effective === "save_report" ? reviewedReport : null,
          requestId,
        ]);
        if (
          attempt.current?.identity !== identity &&
          (!requestId || attempt.current?.input.requestId !== requestId)
        ) {
          const base = {
            requestId: requestId ?? crypto.randomUUID(),
            expectedRevision: fresh.workspaceRevision,
          };
          const input: V2ConversationActionRequest =
            effective === "save_report"
              ? {
                  ...base,
                  action: "save_report",
                  reportId: reviewedReport.id ?? "unavailable",
                  reportRevision: reviewedReport.revision ?? 1,
                }
              : { ...base, action: effective };
          attempt.current = { identity, input };
        }
        const next = await client.executeAction(caseId, attempt.current.input, {
          expectedOwner,
          signal: abort.current.signal,
        });
        if (!(await verify(false, false)) || !current(epoch) || !mounted.current) return;
        attempt.current = null;
        dirty.current = false;
        setHasDraft(false);
        setResult(next);
        setPane(next.pane);
        await changed();
      } catch (cause) {
        if (!current(epoch) || !mounted.current) return;
        const problem = cause as { code?: string; message?: string };
        if (
          [
            "CONFLICT",
            "STALE_REVISION",
            "VALIDATION_ERROR",
            "IDEMPOTENCY_CONFLICT",
            "CONSENT_REQUIRED",
            "QUOTA_EXCEEDED",
            "USER_QUOTA_EXCEEDED",
            "RATE_LIMITED",
            "INVALID_STATE",
            "ROLE_REQUIRED",
            "REVIEW_REQUIRED",
          ].includes(problem.code ?? "")
        )
          attempt.current = null;
        setError(failureMessage(cause));
        await load();
      } finally {
        if (mounted.current && current(epoch)) {
          locked.current = false;
          setBusy(false);
          callbacks.current.onBusyChange(paneLocked.current || background.current);
        }
      }
    },
    [
      disabled,
      canMutate,
      ticket,
      authorizedOwner,
      client,
      caseId,
      current,
      state,
      verify,
      changed,
      load,
      stateIsCurrent,
      workspace.case.revision,
      observeProgress,
    ],
  );
  useEffect(() => {
    if (
      !ready ||
      !canMutate ||
      !stateIsCurrent ||
      disabled ||
      busy ||
      paneBusy ||
      dirty.current ||
      !state
    )
      return;
    const intent = state.intents.findLast(
      (intent) =>
        incomingMessageIds.has(intent.messageId) &&
        intent.workspaceRevision === state.workspaceRevision &&
        !processed.current.has(intent.requestId),
    );
    if (!intent) return;
    processed.current.add(intent.requestId);
    void execute(intent.intent, intent.requestId);
  }, [
    ready,
    canMutate,
    stateIsCurrent,
    disabled,
    busy,
    paneBusy,
    state,
    incomingMessageIds,
    execute,
  ]);
  useEffect(() => {
    if (
      !requestedAction ||
      !ready ||
      !canMutate ||
      !stateIsCurrent ||
      disabled ||
      busy ||
      paneBusy ||
      !state ||
      processed.current.has(requestedAction.id)
    )
      return;
    processed.current.add(requestedAction.id);
    void execute(requestedAction.action, requestedAction.id);
  }, [requestedAction, ready, canMutate, stateIsCurrent, disabled, busy, paneBusy, state, execute]);
  const reportIdentity =
    state?.report.id && state.report.revision !== null
      ? `${state.report.id}:${state.report.revision}`
      : null;
  useEffect(() => {
    if (
      !reportRequested ||
      !state ||
      !ready ||
      !stateIsCurrent ||
      disabled ||
      busy ||
      paneBusy ||
      hasDraft ||
      !mounted.current ||
      abort.current.signal.aborted ||
      !current(paneEpoch.current)
    )
      return;
    if (pane === "report") {
      setReportRequested(false);
      return;
    }
    if (["pending", "ready", "failed"].includes(state.report.status)) {
      // Resume the requested view from a freshly authorized server state only.
      // The server owns admission/continuation; no POST or model call occurs.
      setResult(null);
      setPane("report");
    }
  }, [
    reportRequested,
    state,
    ready,
    stateIsCurrent,
    disabled,
    busy,
    paneBusy,
    hasDraft,
    current,
    pane,
  ]);
  const next = state
    ? state.report.status === "ready" && reportIdentity !== viewedReport
      ? "prepare_report"
      : nextConversationAction(state)
    : null;
  const waiting =
    state &&
    (["pending", "running"].includes(state.analysis.status) ||
      state.report.status === "pending" ||
      workspace.messages.some((message) => message.status === "pending"));
  const missingItems =
    result?.workspaceRevision === state?.workspaceRevision
      ? [...new Set(result?.missingItems ?? [])].filter(
          (item) =>
            !["analysis", "report"].includes(pane ?? "") ||
            !state?.analysis.missingItems.includes(item),
        )
      : [];
  const errorFeedback = error ? (
    <div className="workspace-error" role="alert">
      <p>{error}</p>
      <Button
        variant="outline"
        size="sm"
        disabled={busy || checkingConfirmation}
        onClick={(event) => void recheck(event.currentTarget)}
      >
        상태 다시 확인
      </Button>
      {attempt.current && (
        <Button
          variant="outline"
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
    <div className="conversation-agent">
      {!pane && errorFeedback}
      {state && (
        <>
          {!canMutate && (
            <p className="workspace-muted">
              저장된 내용을 확인할 수 있어요. 새 분석·수정·생성은 현재 정책 동의 후 이어갈 수
              있어요.
            </p>
          )}
          <fieldset className="conversation-agent-actions">
            <legend className="workspace-sr-only">대화에서 이어갈 작업</legend>
            <Button
              type="button"
              variant="default"
              disabled={disabled || !stateIsCurrent || busy || paneBusy}
              loading={busy}
              onClick={(event) => {
                event.currentTarget.focus();
                if (next) void execute(next);
              }}
            >
              {next && conversationActionLabels[next]} <ArrowRight size={16} aria-hidden="true" />
            </Button>
            <details ref={menu}>
              <summary>다른 작업</summary>
              <fieldset
                className="conversation-agent-menu"
                disabled={disabled || !stateIsCurrent || busy || paneBusy}
              >
                <legend className="workspace-sr-only">다른 사건 작업</legend>
                {(Object.keys(conversationActionLabels) as V2ConversationIntent[])
                  .filter((action) => action !== next)
                  .map((action) => (
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
                  ))}
              </fieldset>
            </details>
          </fieldset>
        </>
      )}
      {(continuationPending || continuationUnconfirmed) && (
        <div className="workspace-muted" role="status">
          <p>
            {continuationUnconfirmed
              ? "리포트 준비 결과를 직접 다시 확인해 주세요. 입력과 자료는 보존돼요."
              : "리포트 준비 결과를 확인하고 있어요. 아직 완료된 결과는 아니에요."}
          </p>
          {continuationUnconfirmed && !error && (
            <Button
              variant="outline"
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
        <p className="workspace-muted" role="status">
          <LoaderCircle size={16} className="workspace-spin" /> 사건의 현재 작업 상태를 확인하고
          있어요.
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
            <ul aria-label="작업에 필요한 확인 사항">
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
