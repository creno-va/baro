import { Download, FilePenLine, FileText, Pause, Scale } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { api } from "../../client/api";
import type {
  V2ResolutionDocumentKind,
  V2ResolutionDraftRequest,
  V2ResolutionMutation,
  V2ResolutionState,
} from "../../contracts/v2/resolution";
import {
  resolutionContextLabel,
  resolutionDocumentLabels,
  resolutionDraftIsCurrent,
  resolutionGuideTextParts,
  sameResolutionFiles,
} from "../../utils/resolution";
import { downloadBlob } from "../reports/download";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Select, Textarea } from "../ui/form";
import { InlineNotice } from "../ui/inline-notice";
import { Section } from "../ui/section";
import { draftReviewGuidance, draftReviewState } from "./draft-review";
import {
  createResolutionSelectionFailureTracker,
  type ResolutionErrorDiagnostic,
  type ResolutionSelectionFailureStep,
  resolutionErrorDiagnostic,
} from "./error-diagnostic";
import "../../styles/resolution.css";

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
const paths = [
  {
    id: "self",
    label: "직접 해결",
    description: "확인된 준비 항목과 절차의 조건을 살펴보고 초안을 검토해요.",
    Icon: FilePenLine,
  },
  {
    id: "lawyer",
    label: "변호사와 해결",
    description: "현재 지원 여부를 확인해요.",
    Icon: Scale,
  },
  {
    id: "save_report",
    label: "리포트만 저장",
    description: "현재 리포트의 저장으로 바로 이어져요.",
    Icon: FileText,
  },
] as const;
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
  /** Retained task surfaces stay mounted; only active surfaces refresh on focus. */
  active?: boolean;
  section?: "report" | "drafts";
}
export function FollowUpResolution(props: FollowUpResolutionProps) {
  const client = props.client ?? browserClient;
  const controlId = useId();
  const activity = useRef({ active: props.active !== false, section: props.section });
  activity.current = { active: props.active !== false, section: props.section };
  const [state, setState] = useState<V2ResolutionState | null>(null);
  const [selected, setSelected] = useState<"self" | "lawyer" | "save_report" | null>(null);
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  const [report, setReport] = useState<ReportIdentity | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [mask, setMask] = useState(false);
  const [kind, setKind] = useState<V2ResolutionDocumentKind>("fact_statement");
  const [factsConfirmed, setFactsConfirmed] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [needsConsent, setNeedsConsent] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loadDiagnostic, setLoadDiagnostic] = useState<ResolutionErrorDiagnostic | null>(null);
  const [actionDiagnostic, setActionDiagnostic] = useState<ResolutionErrorDiagnostic | null>(null);
  const [actionFailureStep, setActionFailureStep] = useState<ResolutionSelectionFailureStep>();
  const [notice, setNotice] = useState("");
  const [lawyerNoticeOpen, setLawyerNoticeOpen] = useState(false);
  const lawyerTrigger = useRef<HTMLButtonElement>(null);
  const [pendingChoice, setPendingChoice] = useState<typeof selected>(null);
  const sequence = useRef(0),
    owner = useRef<string | null>(null),
    lock = useRef<number | null>(null);
  const hasState = useRef(false);
  const controller = useRef(new AbortController());
  const reloadRequested = useRef(false);
  const reload = useRef<() => void>(() => undefined);
  const scopeDirty =
    !!state && (!sameResolutionFiles(ids, state.selectedFileIds) || mask !== state.maskIdentifiers);
  const contentDirty = !!state?.draft && content !== state.draft.content;
  const dirty = contentDirty || scopeDirty;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
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
    setLawyerNoticeOpen(false);
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
    setBusy(true);
    setError("");
    setLoadError("");
    setLoadDiagnostic(null);
    setActionDiagnostic(null);
    setActionFailureStep(undefined);
    try {
      const options = await verify(epoch);
      const next = await client.getResolution(props.caseId, options);
      if (next.selection === "self" || activity.current.section === "drafts") {
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
      if (activity.current.active && !dirtyRef.current) void load();
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
  const previousSection = useRef(props.section);
  useEffect(() => {
    const changed = previousSection.current !== props.section;
    previousSection.current = props.section;
    if (changed && props.section === "drafts" && !dirtyRef.current) void load();
  }, [props.section, load]);
  async function run(
    work: (options: Options, epoch: number) => Promise<V2ResolutionState | null>,
    write = true,
    selectionFailureStep?: () => ResolutionSelectionFailureStep,
    label = "현재 상태를 확인하고 있어요.",
  ) {
    if (lock.current !== null) return;
    const epoch = sequence.current;
    lock.current = epoch;
    setBusy(true);
    setBusyLabel(label);
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
    if (choice === "lawyer") {
      setLawyerNoticeOpen(true);
      return;
    }
    if (props.disabled || busy) return;
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
    await run(
      (options) =>
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
      true,
      undefined,
      "검토한 초안을 저장하고 있어요.",
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
    await run(
      async (options, epoch) => {
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
      },
      false,
      undefined,
      "저장한 초안을 확인하고 있어요.",
    );
  }
  const scope = (
    <fieldset className="resolution-scope" disabled={busy || blocked || contentDirty}>
      <legend>사용할 자료와 가림 범위</legend>
      {files.length ? (
        files.map((file, index) => (
          <label key={file.id}>
            <input
              type="checkbox"
              checked={ids.includes(file.id)}
              onChange={(event) => {
                setIds(
                  event.target.checked ? [...ids, file.id] : ids.filter((id) => id !== file.id),
                );
                setFactsConfirmed(false);
                setReviewed(false);
              }}
            />
            {mask ? `선택 자료 ${index + 1}` : file.name}
          </label>
        ))
      ) : (
        <p>선택한 자료가 없어요. 사건 사실만 사용할 수 있어요.</p>
      )}
      <label>
        <input
          type="checkbox"
          checked={mask}
          disabled={!!report?.maskIdentifiers}
          onChange={(event) => {
            setMask(event.target.checked);
            setReviewed(false);
            setFactsConfirmed(false);
          }}
        />
        식별정보 가리기
      </label>
      <p>가림 후에도 이름·주소·내용을 직접 확인해 주세요. 원본은 첨부하거나 전송하지 않아요.</p>
      {contentDirty && <p>수정한 초안을 먼저 저장한 뒤 자료 범위를 바꿔 주세요.</p>}
      {scopeDirty && (
        <Button
          variant="outline"
          onClick={() => {
            if (!state || !reference) return;
            void run((options) =>
              client.updateResolution(
                props.caseId,
                {
                  ...reference,
                  expectedRevision: state.revision,
                  action: "select",
                  choice: "self",
                  selectedFileIds: ids,
                  maskIdentifiers: mask,
                },
                options,
              ),
            );
          }}
        >
          범위 적용
        </Button>
      )}
    </fieldset>
  );
  return (
    <Section
      title="이해한 내용을 다음 준비로 이어가요"
      description="리포트에서 확인한 내용을 바탕으로 문서 초안을 준비하거나 현재 리포트를 보관할 수 있어요."
      className={`resolution${props.embedded ? " resolution--embedded" : ""}`}
      aria-label="리포트 이후 해결 방법"
    >
      <div className="resolution-paths">
        {paths.map(({ id, label, description, Icon }) => (
          <Button
            key={id}
            variant="outline"
            className="resolution-path"
            aria-pressed={selected === id}
            ref={id === "lawyer" ? lawyerTrigger : undefined}
            disabled={id !== "lawyer" && (busy || props.disabled)}
            onClick={(event) => {
              event.currentTarget.focus();
              requestChoice(id);
            }}
          >
            <Icon size={20} aria-hidden="true" />
            <span>
              <strong>{label}</strong>
              <span>{description}</span>
            </span>
          </Button>
        ))}
      </div>
      {(loadError || error) && (
        <div
          role="alert"
          className="resolution-error"
          data-load-error-code={loadDiagnostic?.code}
          data-load-error-http-status={loadDiagnostic?.httpStatus}
          data-load-error-transport={loadDiagnostic?.transport}
          data-action-error-code={actionDiagnostic?.code}
          data-action-error-http-status={actionDiagnostic?.httpStatus}
          data-action-error-transport={actionDiagnostic?.transport}
          data-action-error-step={actionFailureStep}
        >
          {loadError && <p>{loadError}</p>}
          {error && <p>{error}</p>}
          <Button variant="outline" disabled={busy} onClick={() => void load()}>
            다시 확인
          </Button>
        </div>
      )}
      {needsConsent && (
        <p>
          새 초안 준비·수정은 현재 정책 동의 후 이용할 수 있어요. 저장된 내용 확인과 다운로드는 계속
          이용할 수 있어요. 동의 전에는 화면만 전환하며 선택을 저장하지 않아요.
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {busy && busyLabel && <p aria-live="polite">{busyLabel}</p>}
      {(viewBlocked || state?.status === "stale") && (
        <div className="resolution-notice">
          <p>현재 리포트 기준을 저장·확인한 뒤 새 초안을 준비해 주세요. 이전 초안은 보존돼요.</p>
          <Button
            variant="outline"
            disabled={busy || dirty || props.disabled}
            onClick={() => void load()}
          >
            현재 기준 다시 확인
          </Button>
        </div>
      )}
      {state?.status === "not_ready" && (
        <p>
          아직 연결할 현재 리포트·분석이 없어요. 리포트를 확인해 주세요. 기존 리포트 저장은 이용할
          수 있어요.
        </p>
      )}
      {state?.status === "paused" && (
        <div className="resolution-notice">
          <p>잠시 중단했어요. 저장된 내용을 이어갈 수 있어요.</p>
          <Button
            variant="outline"
            disabled={busy || blocked || !reference}
            onClick={() => {
              if (state && reference)
                void run((options) =>
                  client.updateResolution(
                    props.caseId,
                    { ...reference, expectedRevision: state.revision, action: "resume" },
                    options,
                  ),
                );
            }}
          >
            이어서 진행
          </Button>
        </div>
      )}
      {(selected === "self" || props.section === "drafts") && state && (
        <div className="resolution-body">
          <h3>문서 초안</h3>
          <p>
            작성 기준을 확인하고 본문을 검토한 뒤 저장하세요. 다운로드는 검토용 텍스트(TXT)예요.
          </p>
          {state.basis && <p>확인할 사건 맥락: {resolutionContextLabel(state.basis)}</p>}
          <details open={!state.draft}>
            <summary>초안에 사용할 자료와 가림 범위</summary>
            {scope}
          </details>
          {state.selection !== "self" && (
            <p>
              문서 초안을 준비하려면 위의 ‘직접 해결’을 선택해 주세요. 열람만으로 선택이나 초안을
              저장하지 않아요.
            </p>
          )}
          <div className="resolution-draft-controls">
            <label htmlFor={`${controlId}-kind`}>
              문서 종류
              <Select
                id={`${controlId}-kind`}
                value={kind}
                disabled={busy || blocked}
                onChange={(event) => setKind(event.target.value as V2ResolutionDocumentKind)}
              >
                {state.allowedDocumentKinds.map((value) => (
                  <option key={value} value={value}>
                    {resolutionDocumentLabels[value]}
                  </option>
                ))}
              </Select>
            </label>
            <p>{draftReviewGuidance[kind]}</p>
            <p>
              소장에 대한 답변과 지급명령에 대한 대응은 절차가 달라요. 받은 문서 종류와 절차·서식의
              근거가 확인되지 않으면 사실 정리 초안을 이용하세요.
            </p>
            <label className="resolution-checkbox">
              <input
                type="checkbox"
                checked={factsConfirmed}
                onChange={(event) => setFactsConfirmed(event.target.checked)}
                disabled={busy || blocked}
              />
              현재 리포트의 사실과 사용할 자료를 확인했어요.
            </label>
            <Button
              variant="outline"
              disabled={
                busy ||
                blocked ||
                scopeDirty ||
                contentDirty ||
                !factsConfirmed ||
                state.selection !== "self" ||
                !reference ||
                state.status === "not_ready" ||
                state.status === "paused"
              }
              onClick={() => {
                if (!reference) return;
                void run(
                  (options) =>
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
                  true,
                  undefined,
                  "검토용 초안을 준비하고 있어요.",
                );
              }}
            >
              검토용 초안 준비
            </Button>
          </div>
          {state.draft && (
            <div className="resolution-draft">
              <h3>{state.draft.title}</h3>
              <div className="resolution-draft-state" aria-live="polite">
                <InlineNotice
                  tone={
                    !draftCurrent || contentDirty
                      ? "warning"
                      : state.draft.status === "saved"
                        ? "success"
                        : "neutral"
                  }
                  title={draftReviewState(
                    state.draft,
                    Boolean(draftCurrent),
                    contentDirty,
                    reviewed,
                  )}
                />
              </div>
              <p>
                기준 리포트 {state.draft.basis.reportRevision} ·{" "}
                {state.draft.userEdited ? "사용자가 수정한 내용" : "근거에서 구성한 초안"}
              </p>
              <p>
                사용한 자료 {state.draft.selectedFileIds.length}개 ·{" "}
                {state.draft.maskIdentifiers ? "식별정보 가림" : "식별정보 가림 안 함"}
                {" · "}초안 버전 {state.draft.revision}
              </p>
              <p>{draftReviewGuidance[state.draft.documentKind]}</p>
              {!draftCurrent ? (
                <p>
                  이전 기준의 초안이에요. 선택한 범위나 사건이 달라져 본문을 표시하거나 최신 문서로
                  저장하지 않아요. 현재 기준으로 새 초안을 준비해 주세요.
                </p>
              ) : (
                <>
                  <label htmlFor={`${controlId}-draft`}>
                    초안 검토·수정
                    <Textarea
                      id={`${controlId}-draft`}
                      value={content}
                      maxLength={20000}
                      disabled={busy || blocked || state.status === "paused"}
                      onChange={(event) => {
                        setContent(event.target.value);
                        setReviewed(false);
                      }}
                    />
                  </label>
                  {state.draft.missingFields.length > 0 ? (
                    <div>
                      <h4>아직 채워야 할 항목</h4>
                      <ul>
                        {state.draft.missingFields.map((field) => (
                          <li key={field}>{field}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p>표시된 미입력 항목은 없어요. 사실과 증거, 제출 요건을 직접 검토하세요.</p>
                  )}
                  <p>
                    작성 중 수정은 이 화면에만 유지돼요. 검토를 마쳐 저장하기 전에는 다른 페이지로
                    이동하거나 닫으면 사라질 수 있어요.
                  </p>
                  <label className="resolution-checkbox">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      disabled={busy || blocked}
                      onChange={(event) => setReviewed(event.target.checked)}
                    />
                    사실·증거·미입력 항목과 수정한 내용을 검토했어요.
                  </label>
                  <div className="resolution-actions">
                    <Button
                      variant="outline"
                      disabled={busy || blocked || !reviewed || state.status === "paused"}
                      onClick={() => void saveDraft()}
                    >
                      검토한 초안 저장
                    </Button>
                    <Button
                      variant="outline"
                      disabled={
                        busy ||
                        viewBlocked ||
                        dirty ||
                        state.draft.status !== "saved" ||
                        !state.draft.reviewed
                      }
                      onClick={() => void exportDraft()}
                    >
                      <Download size={18} aria-hidden="true" />
                      초안 다운로드
                    </Button>
                  </div>
                </>
              )}
              <p>
                사용자가 최종 확인하고 직접 제출해요. 이 화면에서 제출·발송·대리를 수행하지 않아요.
              </p>
            </div>
          )}
          <details open={!state.draft}>
            <summary>준비 순서·근거와 보완할 자료 확인</summary>
            <h3>준비 순서와 확인할 안내</h3>
            <ol className="resolution-checks">
              {state.procedureChecks
                .filter((c) => c.id !== "public-defender")
                .map((check) => (
                  <li key={check.id}>
                    <strong>{check.label}</strong>
                    <span>
                      {resolutionGuideTextParts(check.detail).map((part) =>
                        part.url ? (
                          <a
                            key={`${part.start}-${part.url}`}
                            href={part.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            공식 안내 원문에서 확인
                          </a>
                        ) : (
                          part.text
                        ),
                      )}
                    </span>
                    <small>
                      {check.status === "verified"
                        ? "공식 근거 확인 · 사건에 맞는지 검토 필요"
                        : "공식 안내 확인 필요"}
                    </small>
                    {check.sourceClaimIds.map((id) => {
                      const claim = state.sourceClaims.find((c) => c.id === id);
                      const citation = state.citations.find((c) => c.id === claim?.citationId);
                      return citation ? (
                        <a key={id} href={citation.url} target="_blank" rel="noreferrer">
                          {citation.title} · 확인{" "}
                          {new Date(citation.verifiedAt).toLocaleDateString("ko-KR", {
                            timeZone: "Asia/Seoul",
                          })}
                        </a>
                      ) : null;
                    })}
                  </li>
                ))}
            </ol>
            {state.weaknessChecks.length > 0 && (
              <>
                <h3>약점과 보완할 자료·사실</h3>
                <ul>
                  {[...new Set(state.weaknessChecks)].map((text) => (
                    <li key={text} className="resolution-preline">
                      {text}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </details>
        </div>
      )}
      {state && selected === "self" && (
        <div className="resolution-actions">
          <Button
            variant="ghost"
            disabled={busy || blocked || !reference || dirty}
            onClick={() => {
              if (reference)
                void run((options) =>
                  client.updateResolution(
                    props.caseId,
                    { ...reference, expectedRevision: state.revision, action: "pause" },
                    options,
                  ),
                );
            }}
          >
            <Pause size={18} aria-hidden="true" />
            잠시 중단
          </Button>
          {props.onCancel && (
            <Button variant="ghost" disabled={busy || dirty} onClick={props.onCancel}>
              닫기
            </Button>
          )}
        </div>
      )}
      <Dialog
        open={lawyerNoticeOpen}
        onOpenChange={setLawyerNoticeOpen}
        title="아직 지원하지 않는 기능이에요"
        description="현재 변호사 연결 기능은 제공하지 않습니다."
        returnFocusRef={lawyerTrigger}
        showCloseButton={false}
      >
        <Button onClick={() => setLawyerNoticeOpen(false)}>확인</Button>
      </Dialog>
      <Dialog
        open={pendingChoice !== null}
        onOpenChange={(open) => {
          if (!open) setPendingChoice(null);
        }}
        title="저장하지 않은 변경이 있어요"
        description="경로를 바꾸면 이 화면의 미저장 수정은 사라져요. 저장된 초안은 보존돼요."
      >
        <div className="resolution-actions">
          <Button variant="outline" onClick={() => setPendingChoice(null)}>
            계속 검토
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const choice = pendingChoice;
              setPendingChoice(null);
              if (choice) void choose(choice);
            }}
          >
            수정을 버리고 경로 변경
          </Button>
        </div>
      </Dialog>
    </Section>
  );
}
