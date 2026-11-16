import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../client/api";
import { downloadBlob } from "../../components/reports/download";
import {
  createResolutionSelectionFailureTracker,
  type ResolutionErrorDiagnostic,
  type ResolutionSelectionFailureStep,
  resolutionErrorDiagnostic,
} from "../../components/resolution/error-diagnostic";
import type {
  V2ResolutionDocumentKind,
  V2ResolutionDraftRequest,
  V2ResolutionMutation,
  V2ResolutionState,
} from "../../contracts/v2/resolution";
import { resolutionDraftIsCurrent, sameResolutionFiles } from "../../utils/resolution";

type Options = { expectedOwner: string; signal: AbortSignal };
type ReportIdentity = {
  id: string;
  revision: number;
  stale: boolean;
  excludedFileIds: string[];
  maskIdentifiers: boolean;
};
export interface ResolutionClient {
  session(): Promise<{ ownerId: string | null; needsConsent: boolean }>;
  getResolution(caseId: string, options: Options): Promise<V2ResolutionState>;
  updateResolution(
    caseId: string,
    input: V2ResolutionMutation,
    options: Options,
  ): Promise<V2ResolutionState>;
  prepareDraft(
    caseId: string,
    input: V2ResolutionDraftRequest,
    options: Options,
  ): Promise<V2ResolutionState>;
  files(caseId: string): Promise<{ id: string; name: string }[]>;
  report(caseId: string, options: Options): Promise<ReportIdentity>;
}
const browserClient: ResolutionClient = {
  async session() {
    const s = await api.session.get();
    return { ownerId: s.user?.id ?? null, needsConsent: s.needsConsent };
  },
  getResolution: (id, options) => api.rework.getResolution(id, options),
  updateResolution: (id, input, options) => api.rework.updateResolution(id, input, options),
  prepareDraft: (id, input, options) => api.rework.prepareDraft(id, input, options),
  files: (id) => api.files.list(id, { metadataOnly: true }),
  async report(id, options) {
    const report = await api.rework.peekReport(id, options);
    if (!report)
      throw Object.assign(new Error("현재 리포트를 확인해 주세요."), { code: "REVIEW_REQUIRED" });
    return report;
  },
};
function failureMessage(error: unknown) {
  const code = (error as { code?: string })?.code;
  if (code === "CONFLICT")
    return "내용이 변경됐어요. 현재 상태를 다시 확인해 주세요. 저장된 내용은 보존돼요.";
  if (code === "STALE_REVISION")
    return "사건이나 리포트가 바뀌었어요. 현재 버전을 다시 확인해 주세요. 이전 초안은 보존돼요.";
  if (code === "REVIEW_REQUIRED") return "현재 리포트와 사실을 확인한 뒤 초안을 준비해 주세요.";
  if (code === "POLICY_REJECTED")
    return "이 문서 종류의 절차·서식 근거를 확인하지 못했어요. 사실 정리 초안을 이용해 주세요.";
  if (code === "RESOLUTION_TOO_LARGE")
    return "초안이 저장 가능한 분량을 넘었어요. 사용할 자료를 줄여 주세요.";
  if (code === "NOT_FOUND" || code === "UNAUTHENTICATED" || code === "CONSENT_REQUIRED")
    return "계정·동의 또는 사건 접근 상태가 바뀌었어요. 다시 로그인하고 확인해 주세요.";
  return "작업을 완료하지 못했어요. 저장된 내용은 보존돼요. 다시 시도해 주세요.";
}
const metadataMessage =
  "후속 해결 상태를 확인하지 못했어요. 다시 확인한 뒤 진행해 주세요. 리포트 저장은 이용할 수 있어요.";
export interface FollowUpResolutionProps {
  caseId: string;
  reportId?: string | undefined;
  reportRevision?: number | undefined;
  disabled?: boolean | undefined;
  embedded?: boolean | undefined;
  onSaveReport: () => Promise<void>;
  onChanged?: (() => void) | undefined;
  onCancel?: (() => void) | undefined;
  onDirtyChange?: ((dirty: boolean) => void) | undefined;
  onBusyChange?: ((busy: boolean) => void) | undefined;
  /** Explicit isolated tests; production defaults to the central authenticated API. */
  client?: ResolutionClient | undefined;
}
export function useResolutionController(props: FollowUpResolutionProps) {
  const client = props.client ?? browserClient;
  const [state, setState] = useState<V2ResolutionState | null>(null);
  const [selected, setSelected] = useState<"self" | "lawyer" | "save_report" | null>(null);
  const [lawyerNoticeOpen, setLawyerNoticeOpen] = useState(false);
  const lawyerTrigger = useRef<HTMLButtonElement>(null);
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  const [report, setReport] = useState<ReportIdentity | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [mask, setMask] = useState(false);
  const [kind, setKind] = useState<V2ResolutionDocumentKind>("fact_statement");
  const [factsConfirmed, setFactsConfirmed] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsConsent, setNeedsConsent] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loadDiagnostic, setLoadDiagnostic] = useState<ResolutionErrorDiagnostic | null>(null);
  const [actionDiagnostic, setActionDiagnostic] = useState<ResolutionErrorDiagnostic | null>(null);
  const [actionFailureStep, setActionFailureStep] = useState<ResolutionSelectionFailureStep>();
  const [notice, setNotice] = useState("");
  const [pendingChoice, setPendingChoice] = useState<typeof selected>(null);
  const sequence = useRef(0),
    owner = useRef<string | null>(null),
    lock = useRef<number | null>(null);
  const hasState = useRef(false);
  const loadFailed = useRef(false);
  const controller = useRef(new AbortController());
  const reloadRequested = useRef(false);
  const reload = useRef<() => void>(() => undefined);
  const scopeDirty =
    !!state && (!sameResolutionFiles(ids, state.selectedFileIds) || mask !== state.maskIdentifiers);
  const contentDirty = !!state?.draft && content !== state.draft.content;
  const dirty = contentDirty || scopeDirty;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const reviewInProgress = useRef(false);
  reviewInProgress.current = factsConfirmed || reviewed !== (state?.draft?.reviewed ?? false);
  const reportMismatch =
    !!state?.basis &&
    ((props.reportId !== undefined && props.reportId !== state.basis.reportId) ||
      (props.reportRevision !== undefined && props.reportRevision !== state.basis.reportRevision));
  const draftCurrent =
    state && resolutionDraftIsCurrent(state) && !scopeDirty && !reportMismatch && !report?.stale;
  const viewBlocked = !!props.disabled || reportMismatch || !!report?.stale;
  const blocked = viewBlocked || needsConsent;
  const reference = useMemo(
    () =>
      state?.basis
        ? { reportId: state.basis.reportId, reportRevision: state.basis.reportRevision }
        : report
          ? { reportId: report.id, reportRevision: report.revision }
          : null,
    [state?.basis, report],
  );
  useEffect(() => {
    props.onDirtyChange?.(dirty);
  }, [dirty, props.onDirtyChange]);
  useEffect(() => {
    props.onBusyChange?.(busy);
  }, [busy, props.onBusyChange]);
  useEffect(
    () => () => {
      props.onDirtyChange?.(false);
      props.onBusyChange?.(false);
    },
    [props.onDirtyChange, props.onBusyChange],
  );
  const purge = useCallback(() => {
    ++sequence.current;
    controller.current.abort();
    controller.current = new AbortController();
    lock.current = null;
    reloadRequested.current = false;
    dirtyRef.current = false;
    setBusy(false);
    owner.current = null;
    setNeedsConsent(false);
    hasState.current = false;
    loadFailed.current = false;
    setState(null);
    setSelected(null);
    setFiles([]);
    setReport(null);
    setIds([]);
    setContent("");
    setReviewed(false);
    setFactsConfirmed(false);
    setMask(false);
    setPendingChoice(null);
    setNotice("");
    setError("");
    setLoadError("");
    setLoadDiagnostic(null);
    setActionDiagnostic(null);
    setActionFailureStep(undefined);
  }, []);
  const handleFailure = useCallback(
    (
      error: unknown,
      source: "load" | "action" = "action",
      step?: ResolutionSelectionFailureStep,
    ) => {
      const code = (error as { code?: string })?.code;
      if (code === "NOT_FOUND" || code === "UNAUTHENTICATED") purge();
      else if (code === "STALE_REVISION" || code === "CONFLICT")
        setState((current) =>
          current ? { ...current, status: current.basis ? "stale" : "not_ready" } : null,
        );
      else if (code === "CONSENT_REQUIRED") setNeedsConsent(true);
      const diagnostic = resolutionErrorDiagnostic(error);
      if (source === "load") setLoadDiagnostic(diagnostic);
      else {
        setActionDiagnostic(diagnostic);
        setActionFailureStep(step);
      }
      setError(failureMessage(error));
    },
    [purge],
  );
  const verify = useCallback(
    async (epoch: number, write = false) => {
      const session = await client.session();
      if (epoch !== sequence.current) throw new Error("SUPERSEDED");
      if (!session.ownerId || (owner.current !== null && owner.current !== session.ownerId)) {
        purge();
        setError("계정 또는 접근 상태가 바뀌었어요. 다시 확인해 주세요.");
        throw Object.assign(new Error("ACCESS_CHANGED"), {
          code: session.needsConsent ? "CONSENT_REQUIRED" : "NOT_FOUND",
        });
      }
      setNeedsConsent(session.needsConsent);
      if (write && session.needsConsent)
        throw Object.assign(new Error("CONSENT_REQUIRED"), { code: "CONSENT_REQUIRED" });
      owner.current = session.ownerId;
      return { expectedOwner: session.ownerId, signal: controller.current.signal };
    },
    [client, purge],
  );
  const accept = useCallback((next: V2ResolutionState) => {
    hasState.current = true;
    loadFailed.current = false;
    setLoadError("");
    setLoadDiagnostic(null);
    setActionDiagnostic(null);
    setActionFailureStep(undefined);
    setState(next);
    setSelected(next.selection);
    setIds(next.selectedFileIds);
    setMask(next.maskIdentifiers);
    setContent(next.draft?.content ?? "");
    setReviewed(next.draft?.reviewed ?? false);
    setFactsConfirmed(false);
    setKind(
      next.allowedDocumentKinds.includes(next.draft?.documentKind ?? "fact_statement")
        ? (next.draft?.documentKind ?? "fact_statement")
        : "fact_statement",
    );
  }, []);
  const finish = useCallback((epoch: number) => {
    // A superseded promise may settle after a fresh owner has already loaded or
    // started work. Only the operation owning this epoch may release its lock.
    if (lock.current !== epoch) return;
    lock.current = null;
    setBusy(false);
    if (reloadRequested.current) {
      reloadRequested.current = false;
      reload.current();
    }
  }, []);
  const load = useCallback(async () => {
    if (lock.current !== null) {
      reloadRequested.current = true;
      return;
    }
    const epoch = sequence.current;
    lock.current = epoch;
    loadFailed.current = false;
    setBusy(true);
    setError("");
    setLoadError("");
    setLoadDiagnostic(null);
    setActionDiagnostic(null);
    setActionFailureStep(undefined);
    try {
      const options = await verify(epoch);
      const next = await client.getResolution(props.caseId, options);
      if (next.selection === "self" || next.selection === "lawyer") {
        const [available, currentReport] = await Promise.all([
          client.files(props.caseId),
          client.report(props.caseId, options),
        ]);
        await verify(epoch);
        if (epoch === sequence.current) {
          setFiles(available.filter((f) => !currentReport.excludedFileIds.includes(f.id)));
          setReport(currentReport);
        }
      }
      await verify(epoch);
      if (epoch === sequence.current) accept(next);
    } catch (e) {
      if (epoch === sequence.current) {
        loadFailed.current = true;
        const code = (e as { code?: string })?.code;
        if (
          !hasState.current &&
          code !== "NOT_FOUND" &&
          code !== "UNAUTHENTICATED" &&
          code !== "CONSENT_REQUIRED" &&
          code !== "REVIEW_REQUIRED"
        ) {
          setLoadError(metadataMessage);
          setLoadDiagnostic(resolutionErrorDiagnostic(e));
        } else handleFailure(e, "load");
      }
    } finally {
      finish(epoch);
    }
  }, [client, props.caseId, verify, accept, handleFailure, finish]);
  reload.current = () => void load();
  const previousReport = useRef({ id: props.reportId, revision: props.reportRevision });
  useEffect(() => {
    const previous = previousReport.current;
    previousReport.current = { id: props.reportId, revision: props.reportRevision };
    if (
      (previous.id !== props.reportId || previous.revision !== props.reportRevision) &&
      !dirtyRef.current
    )
      void load();
  }, [props.reportId, props.reportRevision, load]);
  useEffect(() => {
    purge();
    void load();
    const changed = () => {
      purge();
      void load();
    };
    const storage = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key === "baro-session-changed" ||
        event.key === "better-auth.message"
      )
        changed();
    };
    const focus = () => {
      if (
        !dirtyRef.current &&
        !reviewInProgress.current &&
        lock.current === null &&
        !loadFailed.current
      )
        void load();
      else void verify(sequence.current).catch(() => undefined);
    };
    window.addEventListener("baro-session-changed", changed);
    window.addEventListener("storage", storage);
    window.addEventListener("focus", focus);
    window.addEventListener("pageshow", focus);
    return () => {
      purge();
      window.removeEventListener("baro-session-changed", changed);
      window.removeEventListener("storage", storage);
      window.removeEventListener("focus", focus);
      window.removeEventListener("pageshow", focus);
    };
  }, [load, purge, verify]);
  async function run(
    work: (options: Options, epoch: number) => Promise<V2ResolutionState | null>,
    write = true,
    selectionFailureStep?: () => ResolutionSelectionFailureStep,
  ) {
    if (lock.current !== null) return;
    const epoch = sequence.current;
    lock.current = epoch;
    setBusy(true);
    setError("");
    setActionDiagnostic(null);
    setActionFailureStep(undefined);
    if (!loadError) setLoadDiagnostic(null);
    setNotice("");
    try {
      const options = await verify(epoch, write);
      const next = await work(options, epoch);
      await verify(epoch, write);
      if (epoch === sequence.current) {
        if (next) accept(next);
        if (next && write) props.onChanged?.();
      }
    } catch (e) {
      if (epoch === sequence.current) handleFailure(e, "action", selectionFailureStep?.());
    } finally {
      finish(epoch);
    }
  }
  async function choose(choice: NonNullable<typeof selected>) {
    if (props.disabled || busy) return;
    if (choice === "lawyer") {
      setLawyerNoticeOpen(true);
      return;
    }
    if (choice === "save_report") {
      setSelected(choice);
      await run(async () => {
        await props.onSaveReport();
        setNotice("리포트 저장 요청을 마쳤어요.");
        return null;
      }, false);
      return;
    }
    if (!state) {
      setLoadError(metadataMessage);
      return;
    }
    const readOnly = needsConsent;
    const failure = createResolutionSelectionFailureTracker();
    await run(
      async (options, epoch) => {
        const [available, currentReport, historical] = await Promise.all([
          failure.observe("files_read", () => client.files(props.caseId)),
          failure.observe("report_read", () => client.report(props.caseId, options)),
          readOnly
            ? failure.observe("resolution_read", () => client.getResolution(props.caseId, options))
            : Promise.resolve(null),
        ]);
        await verify(epoch);
        if (epoch !== sequence.current) return null;
        setFiles(available.filter((f) => !currentReport.excludedFileIds.includes(f.id)));
        setReport(currentReport);
        if (historical) {
          accept(historical);
          setSelected(choice);
          return null;
        }
        const base = state.basis
          ? { reportId: state.basis.reportId, reportRevision: state.basis.reportRevision }
          : { reportId: currentReport.id, reportRevision: currentReport.revision };
        return failure.observe("selection_update", () =>
          client.updateResolution(
            props.caseId,
            {
              ...base,
              expectedRevision: state.revision,
              action: "select",
              choice,
              selectedFileIds: state.selectedFileIds,
              maskIdentifiers: state.maskIdentifiers,
            },
            options,
          ),
        );
      },
      !readOnly,
      failure.snapshot,
    );
  }
  function requestChoice(choice: NonNullable<typeof selected>) {
    if (choice === "lawyer") {
      setLawyerNoticeOpen(true);
      return;
    }
    if (dirty) {
      setPendingChoice(choice);
      return;
    }
    void choose(choice);
  }
  async function saveDraft() {
    if (!state?.draft || !reference || !reviewed) return;
    await run((options) =>
      client.updateResolution(
        props.caseId,
        {
          ...reference,
          expectedRevision: state.revision,
          action: "save_draft",
          draftId: state.draft?.id ?? "",
          draftRevision: state.draft?.revision ?? 0,
          content,
          reviewed: true,
        },
        options,
      ),
    );
  }
  async function exportDraft() {
    if (
      !state?.draft ||
      !draftCurrent ||
      dirty ||
      !state.draft.reviewed ||
      state.draft.status !== "saved"
    )
      return;
    await run(async (options, epoch) => {
      const latest = await client.getResolution(props.caseId, options);
      await verify(epoch);
      if (
        !resolutionDraftIsCurrent(latest) ||
        latest.draft?.id !== state.draft?.id ||
        latest.draft?.revision !== state.draft?.revision
      )
        throw Object.assign(new Error("STALE"), { code: "STALE_REVISION" });
      if (epoch !== sequence.current || !latest.draft) return null;
      downloadBlob(
        new Blob([latest.draft.content], { type: "text/plain;charset=utf-8" }),
        `${latest.draft.title}-검토용.txt`,
      );
      setNotice("초안 다운로드를 요청했어요. 저장 위치를 확인해 주세요.");
      return null;
    }, false);
  }
  function changeFile(fileId: string, checked: boolean) {
    setIds(checked ? [...ids, fileId] : ids.filter((id) => id !== fileId));
    setFactsConfirmed(false);
    setReviewed(false);
  }
  function changeMask(checked: boolean) {
    setMask(checked);
    setReviewed(false);
    setFactsConfirmed(false);
  }
  function applyScope() {
    if (!state || !reference) return;
    void run((options) =>
      client.updateResolution(
        props.caseId,
        {
          ...reference,
          expectedRevision: state.revision,
          action: "select",
          choice: selected === "lawyer" ? "lawyer" : "self",
          selectedFileIds: ids,
          maskIdentifiers: mask,
        },
        options,
      ),
    );
  }
  function resume() {
    if (state && reference)
      void run((options) =>
        client.updateResolution(
          props.caseId,
          { ...reference, expectedRevision: state.revision, action: "resume" },
          options,
        ),
      );
  }
  function prepareDraft() {
    if (!state || !reference) return;
    void run((options) =>
      client.prepareDraft(
        props.caseId,
        {
          ...reference,
          expectedRevision: state.revision,
          documentKind: kind,
          selectedFileIds: ids,
          maskIdentifiers: mask,
          factsConfirmed: true,
        },
        options,
      ),
    );
  }
  function changeContent(value: string) {
    setContent(value);
    setReviewed(false);
  }
  function pause() {
    if (state && reference)
      void run((options) =>
        client.updateResolution(
          props.caseId,
          { ...reference, expectedRevision: state.revision, action: "pause" },
          options,
        ),
      );
  }
  function discardAndChange() {
    const choice = pendingChoice;
    setPendingChoice(null);
    if (choice) void choose(choice);
  }
  return {
    props,
    state,
    selected,
    lawyerNoticeOpen,
    lawyerTrigger,
    files,
    report,
    ids,
    mask,
    kind,
    factsConfirmed,
    reviewed,
    content,
    busy,
    needsConsent,
    error,
    loadError,
    loadDiagnostic,
    actionDiagnostic,
    actionFailureStep,
    notice,
    pendingChoice,
    scopeDirty,
    contentDirty,
    dirty,
    reportMismatch,
    draftCurrent,
    viewBlocked,
    blocked,
    reference,
    requestChoice,
    changeFile,
    changeMask,
    applyScope,
    resume,
    prepareDraft,
    changeContent,
    pause,
    changeKind: (value: string) => setKind(value as V2ResolutionDocumentKind),
    changeFactsConfirmed: setFactsConfirmed,
    changeReviewed: setReviewed,
    retry: () => void load(),
    saveDraft: () => void saveDraft(),
    exportDraft: () => void exportDraft(),
    closeLawyerNotice: () => setLawyerNoticeOpen(false),
    closePendingChoice: () => setPendingChoice(null),
    discardAndChange,
  };
}
export type ResolutionController = ReturnType<typeof useResolutionController>;
