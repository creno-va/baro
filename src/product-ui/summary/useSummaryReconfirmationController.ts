import { type MouseEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { api } from "../../client/api";
import { ApiError } from "../../client/api/core";
import type { CaseView, FileView } from "../../client/api/types";
import { startForegroundPolling } from "../../client/foreground-poll";
import { useCustomerAccess } from "../../components/intake/useCustomerAccess";
import type {
  V2CaseContext,
  V2CaseContextUpdate,
  V2Summary,
  V2SummaryReconciliation,
  V2SummaryReconciliationCancel,
  V2SummaryReconciliationConfirm,
  V2SummaryReconciliationRequest,
} from "../../contracts/v2";
import { v2SummarySchema } from "../../contracts/v2";
import { type Completion, matches } from "./completion";

export type SummaryReconfirmationProps = {
  caseId: string;
  embedded?: boolean;
  onConfirmed?: (item: CaseView) => void;
  onChanged?: (item: CaseView) => void;
  onCancel?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
};
type Mutation =
  | { kind: "context"; input: V2CaseContextUpdate }
  | { kind: "request"; input: V2SummaryReconciliationRequest }
  | { kind: "proposal"; input: V2SummaryReconciliationConfirm; requestId: string }
  | {
      kind: "cancel";
      input: V2SummaryReconciliationCancel;
      resumeExplanation?: Pick<V2SummaryReconciliationRequest, "kind" | "explanation">;
    }
  | {
      kind: "initial";
      revision: number;
      summaryRevision: number | null;
      alreadyConfirmed: boolean;
      canonical: V2Summary | null;
    };

export function useSummaryReconfirmationController({
  caseId,
  embedded = false,
  onConfirmed,
  onChanged,
  onCancel,
  onDirtyChange,
  onBusyChange,
}: SummaryReconfirmationProps) {
  const [item, setItem] = useState<CaseView | null>(null);
  const [state, setState] = useState<V2SummaryReconciliation | null>(null);
  const [context, setContext] = useState<V2CaseContext | null>(null);
  const [files, setFiles] = useState<FileView[]>([]);
  const [materialsError, setMaterialsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [kind, setKind] = useState<"correction" | "addition" | null>(null);
  const [explanation, setExplanation] = useState("");
  const [purposeOpen, setPurposeOpen] = useState(false);
  const [purposeDraft, setPurposeDraft] = useState<"prepare_claim" | "respond_to_claim" | null>(
    null,
  );
  const contextIntent = useRef<{ input: V2CaseContextUpdate; revision: number } | null>(null);
  const [confirming, setConfirming] = useState<Extract<Mutation, { kind: "initial" }> | null>(null);
  const [returnHref, setReturnHref] = useState(`/cases/${encodeURIComponent(caseId)}`);
  const base = `/cases/${encodeURIComponent(caseId)}`;
  const fieldId = useId();
  const headingId = useId();
  const revision = useRef<CaseView | null>(null);
  revision.current = item;
  const pending = useRef(false);
  const request = useRef(0);
  const failed = useRef<Mutation | null>(null);
  const completion = useRef<Completion | null>(null);
  const requestIntent = useRef<V2SummaryReconciliationRequest | null>(null);
  const draft = useRef("");
  draft.current = explanation;
  const focusTarget = useRef<HTMLElement>(null);
  const dialogReturnFocus = useRef<HTMLElement | null>(null);
  const focusPhase = useRef<string | null>(null);
  const callbacks = useRef({ onConfirmed, onChanged, onDirtyChange, onBusyChange });
  callbacks.current = { onConfirmed, onChanged, onDirtyChange, onBusyChange };
  const dirty = useRef(false);
  const isDirty =
    !!explanation.trim() ||
    (purposeOpen && purposeDraft !== null && purposeDraft !== context?.casePurpose);
  dirty.current = isDirty;
  const access = useCustomerAccess(
    () => {
      ++request.current;
      pending.current = false;
      failed.current = null;
      completion.current = null;
      requestIntent.current = null;
      contextIntent.current = null;
      setPurposeOpen(false);
      setPurposeDraft(null);
      revision.current = null;
      focusPhase.current = null;
      dialogReturnFocus.current = null;
      draft.current = "";
      setItem(null);
      setState(null);
      setContext(null);
      setFiles([]);
      setExplanation("");
      setKind(null);
      setConfirming(null);
      setBusy(false);
      setNotice("");
      setError(null);
    },
    setError,
    true,
  );
  const { ready, canMutate, ticket, current, alive, verify, version, deny } = access;
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("from");
    setReturnHref(
      ["files", "timeline", "actions", "precedents"].includes(tab ?? "") ? `${base}/${tab}` : base,
    );
  }, [base]);
  useEffect(() => {
    callbacks.current.onDirtyChange?.(isDirty);
  }, [isDirty]);
  useEffect(() => {
    // Ordinary dismissal restores the opener; a successful submission selects
    // the persistent review group because the old trigger is then removed.
    if (kind !== null) dialogReturnFocus.current = null;
  }, [kind]);
  useEffect(() => {
    callbacks.current.onBusyChange?.(busy);
  }, [busy]);
  useEffect(
    () => () => {
      callbacks.current.onDirtyChange?.(false);
      callbacks.current.onBusyChange?.(false);
    },
    [],
  );
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const finish = useCallback(
    (next: CaseView) => {
      completion.current = null;
      failed.current = null;
      if (callbacks.current.onConfirmed) callbacks.current.onConfirmed(next);
      else window.location.assign(returnHref);
    },
    [returnHref],
  );
  const report = useCallback(
    (cause: unknown) => {
      if ((cause as { code?: string })?.code === "CONFLICT") {
        completion.current = null;
        contextIntent.current = null;
      }
      if (["UNAUTHENTICATED", "NOT_FOUND"].includes((cause as { code?: string })?.code ?? ""))
        deny();
      setError(cause);
    },
    [deny],
  );
  const readSnapshot = useCallback(async () => {
    // A just-confirmed case can advance through automatic preparation between
    // these reads. Retry only mismatched fresh pairs, never mutations or errors.
    const attempts = completion.current ? 4 : 2;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const next = await api.cases.get(caseId);
      // Legacy summary routes remain readable without requiring a v2 rework record.
      if (next.schemaVersion === "1" || !["summary", "active"].includes(next.stage))
        return { next, reconciliation: null, context: null, conversation: null };
      const [reconciliation, contextView] = await Promise.all([
        api.rework.getReconciliation(caseId, { expectedOwner: access.ownerId() ?? "" }),
        api.rework.getContext(caseId, { expectedOwner: access.ownerId() ?? "" }).catch(() => null),
      ]);
      if (next.revision === reconciliation.workspaceRevision) {
        if (
          reconciliation.status === "proposed" &&
          reconciliation.proposal &&
          next.summaryDetails &&
          JSON.stringify(v2SummarySchema.parse(reconciliation.proposal.before)) !==
            JSON.stringify(v2SummarySchema.parse(next.summaryDetails))
        )
          throw new ApiError(
            "CONFLICT",
            "변경안의 기준과 현재 정리가 달라요. 최신 내용을 확인해 주세요.",
          );
        const intent = completion.current;
        const conversation =
          intent?.kind === "initial" && intent.canonical !== null
            ? await api.rework.getConversation(caseId, { expectedOwner: access.ownerId() ?? "" })
            : null;
        if (conversation && conversation.workspaceRevision !== next.revision) continue;
        return {
          next,
          reconciliation,
          context: contextView?.workspaceRevision === next.revision ? contextView.context : null,
          conversation,
        };
      }
    }
    throw new ApiError(
      "CONFLICT",
      "다른 화면에서 사건 내용이 바뀌었어요. 최신 내용을 다시 확인해 주세요.",
    );
  }, [caseId, access.ownerId]);
  const accept = useCallback((snapshot: Awaited<ReturnType<typeof readSnapshot>>) => {
    const status = snapshot.reconciliation?.status;
    const phase =
      status === "pending" || status === "running"
        ? "working"
        : status === "proposed"
          ? "proposal"
          : status === "failed" || status === "stale"
            ? "problem"
            : "reading";
    if (
      phase !== focusPhase.current &&
      snapshot.next.schemaVersion !== "1" &&
      ["summary", "active"].includes(snapshot.next.stage) &&
      focusTarget.current?.contains(document.activeElement)
    )
      focusTarget.current.focus();
    focusPhase.current = phase;
    revision.current = snapshot.next;
    setItem(snapshot.next);
    setState(snapshot.reconciliation);
    setContext(snapshot.context);
    const saved = requestIntent.current;
    if (
      saved &&
      snapshot.reconciliation?.request?.input.explanation === saved.explanation &&
      snapshot.reconciliation.request.input.kind === saved.kind &&
      snapshot.reconciliation.request.input.expectedRevision === saved.expectedRevision
    ) {
      dialogReturnFocus.current = focusTarget.current;
      requestIntent.current = null;
      setExplanation("");
      setKind(null);
      failed.current = null;
    }
  }, []);
  const finishContext = useCallback((snapshot: Awaited<ReturnType<typeof readSnapshot>>) => {
    const intent = contextIntent.current;
    if (!intent) return false;
    if (
      snapshot.next.revision === intent.revision &&
      snapshot.context?.casePurpose === intent.input.casePurpose &&
      snapshot.context.subjectContext === intent.input.subjectContext &&
      JSON.stringify(snapshot.context.procedure) === JSON.stringify(intent.input.procedure)
    ) {
      contextIntent.current = null;
      setPurposeOpen(false);
      setPurposeDraft(null);
      setNotice("입장을 저장했어요. 개인·기업 맥락과 절차 단계는 그대로 유지했어요.");
      callbacks.current.onChanged?.(snapshot.next);
      return true;
    }
    if (snapshot.next.revision > intent.revision) {
      contextIntent.current = null;
      throw new ApiError(
        "CONFLICT",
        "입장 저장 이후 사건이 바뀌었어요. 최신 내용을 확인해 주세요.",
      );
    }
    return false;
  }, []);
  const load = useCallback(
    async (replace = false) => {
      if (pending.current) return;
      const serial = ++request.current;
      let epoch = ticket();
      setLoading(true);
      try {
        if (!(await verify()) || serial !== request.current) return;
        epoch = ticket();
        const [snapshot, materials] = await Promise.all([
          readSnapshot(),
          api.files.list(caseId, { metadataOnly: true }).then(
            (files) => ({ files, failed: false }),
            () => ({ files: [] as FileView[], failed: true }),
          ),
        ]);
        if (!(await verify()) || !current(epoch) || serial !== request.current) return;
        if (
          !replace &&
          dirty.current &&
          revision.current &&
          revision.current.revision !== snapshot.next.revision &&
          !requestIntent.current &&
          !contextIntent.current
        )
          throw new ApiError(
            "CONFLICT",
            "다른 화면에서 사건 내용이 바뀌었어요. 작성한 설명은 남겨뒀어요. 최신 정리를 확인한 뒤 다시 요청해 주세요.",
          );
        accept(snapshot);
        finishContext(snapshot);
        setFiles(materials.files);
        setMaterialsError(materials.failed);
        setError(null);
        const intent = completion.current;
        if (intent) {
          if (matches(snapshot.next, snapshot.reconciliation, intent, snapshot.conversation))
            finish(snapshot.next);
          else if (
            snapshot.next.stage === "active" &&
            snapshot.reconciliation?.status !== "pending" &&
            snapshot.reconciliation?.status !== "running"
          ) {
            completion.current = null;
            throw new ApiError(
              "CONFLICT",
              "확인 이후 사건 내용이 달라졌어요. 최신 정리를 다시 확인해 주세요.",
            );
          }
        }
        if (replace) failed.current = null;
      } catch (cause) {
        if (alive(epoch) && serial === request.current) report(cause);
      } finally {
        if (alive(epoch) && serial === request.current) setLoading(false);
      }
    },
    [ticket, verify, readSnapshot, caseId, current, accept, finish, finishContext, alive, report],
  );
  useEffect(() => {
    if (version) void load();
  }, [version, load]);
  useEffect(() => {
    if (state?.status !== "pending" && state?.status !== "running") return;
    return startForegroundPolling(() => load(), 2000);
  }, [state?.status, load]);
  async function mutate(operation: Mutation): Promise<boolean> {
    if (pending.current || !canMutate) return false;
    pending.current = true;
    ++request.current;
    setBusy(true);
    setError(null);
    setNotice("");
    setLoading(false);
    const epoch = ticket();
    const owner = access.ownerId() ?? "";
    let acknowledged = false;
    try {
      if (!(await verify(false, true)) || !current(epoch)) return false;
      failed.current = operation;
      if (operation.kind === "context") {
        contextIntent.current = {
          input: operation.input,
          revision: operation.input.expectedRevision + 1,
        };
        const updated = await api.rework.updateContext(caseId, operation.input, {
          expectedOwner: owner,
        });
        contextIntent.current = { input: operation.input, revision: updated.workspaceRevision };
      } else if (operation.kind === "request") {
        requestIntent.current = operation.input;
        await api.rework.requestReconciliation(caseId, operation.input, { expectedOwner: owner });
      } else if (operation.kind === "proposal") {
        completion.current = {
          kind: "proposal",
          caseId,
          proposalId: operation.input.proposalId,
          requestId: operation.requestId,
          revision: operation.input.expectedRevision + 1,
          summaryRevision: operation.input.summaryRevision + 1,
        };
        await api.rework.confirmReconciliation(caseId, operation.input, { expectedOwner: owner });
      } else if (operation.kind === "cancel") {
        await api.rework.cancelReconciliation(caseId, operation.input, { expectedOwner: owner });
      } else {
        const intent: Completion = {
          kind: "initial",
          caseId,
          revision: operation.revision + (operation.alreadyConfirmed ? 0 : 1),
          summaryRevision: operation.summaryRevision,
          canonical: operation.canonical,
          acknowledged: false,
        };
        completion.current = intent;
        if (!operation.alreadyConfirmed) {
          await api.cases.confirmSummary(caseId, {
            expectedRevision: operation.revision,
          });
        }
        completion.current = { ...intent, acknowledged: true };
      }
      acknowledged = true;
      failed.current = null;
      if (!(await verify()) || !current(epoch)) return false;
      const snapshot = await readSnapshot();
      if (!(await verify()) || !current(epoch)) return false;
      if (
        operation.kind === "request" &&
        (snapshot.reconciliation?.request?.input.expectedRevision !==
          operation.input.expectedRevision ||
          snapshot.reconciliation.request.input.kind !== operation.input.kind ||
          snapshot.reconciliation.request.input.explanation !== operation.input.explanation ||
          !["pending", "running", "proposed", "failed"].includes(snapshot.reconciliation.status))
      )
        throw new ApiError(
          "CONFLICT",
          "요청 이후 다른 화면에서 변경 요청이 바뀌었어요. 작성한 설명을 남겨뒀어요.",
        );
      if (
        operation.kind === "cancel" &&
        (snapshot.reconciliation?.request?.id !== operation.input.requestId ||
          snapshot.reconciliation.status !== "cancelled")
      )
        throw new ApiError(
          "CONFLICT",
          "취소 이후 다른 화면에서 새 요청이 생겼어요. 최신 내용을 확인해 주세요.",
        );
      accept(snapshot);
      if (operation.kind === "context") {
        if (!finishContext(snapshot))
          throw new ApiError("CONFLICT", "입장 저장 결과를 확인해 주세요.");
      } else if (operation.kind === "request") {
        setExplanation("");
        setKind(null);
        requestIntent.current = null;
        setNotice("변경안을 요청했어요. 확인하고 확정할 때까지 기존 정리는 그대로예요.");
      } else if (operation.kind === "cancel") {
        setExplanation(operation.resumeExplanation?.explanation ?? "");
        setKind(operation.resumeExplanation?.kind ?? null);
        setNotice("변경 요청을 취소했어요. 기존 정리는 그대로예요.");
        focusTarget.current?.focus();
      } else {
        setConfirming(null);
        const intent = completion.current;
        if (
          !intent ||
          !matches(snapshot.next, snapshot.reconciliation, intent, snapshot.conversation)
        ) {
          completion.current = null;
          throw new ApiError("CONFLICT", "사건 내용이 바뀌었어요. 최신 정리를 확인해 주세요.");
        }
        finish(snapshot.next);
      }
      return true;
    } catch (cause) {
      if (alive(epoch)) {
        if (acknowledged) failed.current = null;
        report(cause);
      }
      return false;
    } finally {
      if (alive(epoch)) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  const activeRequest =
    !!state && ["pending", "running", "proposed", "failed", "stale"].includes(state.status);
  // Writes reverify access/revision and supersede older reads. A background
  // refresh keeps the current control focusable while its snapshot is checked.
  const locked = busy || !canMutate || (error as { code?: string })?.code === "CONFLICT";
  const proposal = state?.status === "proposed" ? state.proposal : null;
  const requestChange = () => {
    if (!item || !kind || !explanation.trim() || [...explanation.trim()].length > 5000) return;
    void mutate({
      kind: "request",
      input: {
        expectedRevision: item.revision,
        summaryRevision: item.summaryDetails?.revision ?? 1,
        kind,
        explanation: explanation.trim(),
      },
    });
  };
  const cancel = (
    resumeExplanation?: Pick<V2SummaryReconciliationRequest, "kind" | "explanation">,
  ) =>
    state?.request && item
      ? mutate({
          kind: "cancel",
          input: { expectedRevision: item.revision, requestId: state.request.id },
          ...(resumeExplanation ? { resumeExplanation } : {}),
        })
      : Promise.resolve(false);
  const explainAgain = () => {
    const previous = state?.request;
    if (!previous) return;
    // Terminal jobs can read as failed while the private request stays pending.
    // Retire and read back first, retaining the intent for either retry control.
    return cancel(previous.input);
  };
  const modalActive = ready && (purposeOpen || kind !== null || confirming !== null);
  function retry() {
    void (failed.current && (error as { code?: string }).code !== "CONFLICT"
      ? mutate(failed.current)
      : load(true));
  }
  function openPurpose(event: MouseEvent<HTMLButtonElement>) {
    if (!context) return;
    event.currentTarget.focus();
    setPurposeDraft(context.casePurpose === "unconfirmed" ? null : context.casePurpose);
    setPurposeOpen(true);
  }
  function agree(event: MouseEvent<HTMLButtonElement>) {
    if (!item) return;
    event.currentTarget.focus();
    setConfirming({
      kind: "initial",
      revision: item.revision,
      summaryRevision: item.summaryDetails?.revision ?? null,
      canonical: item.summaryDetails
        ? structuredClone(v2SummarySchema.parse(item.summaryDetails))
        : null,
      alreadyConfirmed: item.stage === "active" && !item.summaryNeedsConfirmation,
    });
  }
  function explain(next: "correction" | "addition", event: MouseEvent<HTMLButtonElement>) {
    event.currentTarget.focus();
    setKind(next);
  }
  return {
    caseId,
    embedded,
    base,
    headingId,
    fieldId,
    item,
    state,
    context,
    files,
    materialsError,
    loading,
    busy,
    error,
    notice,
    kind,
    explanation,
    purposeOpen,
    purposeDraft,
    confirming,
    returnHref,
    ready,
    canMutate,
    locked,
    activeRequest,
    proposal,
    modalActive,
    focusTarget,
    dialogReturnFocus,
    onCancel,
    retry,
    requestChange,
    openPurpose,
    agree,
    explain,
    setExplanation,
    setPurpose: (next: string) => {
      if (next === "prepare_claim" || next === "respond_to_claim") setPurposeDraft(next);
    },
    closePurpose: () => {
      if (ready && !busy) {
        setPurposeOpen(false);
        setPurposeDraft(null);
      }
    },
    closeExplanation: () => {
      if (ready && !busy) {
        setKind(null);
        setExplanation("");
      }
    },
    closeConfirmation: () => {
      if (ready && !busy) setConfirming(null);
    },
    cancelProposal: () => void cancel(),
    explainAgain: () => void explainAgain(),
    confirmInitial: () => confirming && void mutate(confirming),
    confirmProposal: () => {
      if (!item || !proposal) return;
      void mutate({
        kind: "proposal",
        requestId: proposal.requestId,
        input: {
          expectedRevision: item.revision,
          proposalId: proposal.id,
          summaryRevision: proposal.baseSummaryRevision,
        },
      });
    },
    savePurpose: () =>
      item &&
      context &&
      purposeDraft &&
      void mutate({
        kind: "context",
        input: {
          expectedRevision: item.revision,
          casePurpose: purposeDraft,
          subjectContext: context.subjectContext,
          procedure: context.procedure,
        },
      }),
  };
}

export type SummaryReconfirmationController = ReturnType<typeof useSummaryReconfirmationController>;
