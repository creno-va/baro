import { Download, FilePenLine, FileText, Pause, Scale } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  resolutionReadingLinks,
  sameResolutionFiles,
} from "../../utils/resolution";
import { downloadBlob } from "../reports/download";
import { Button, ButtonLink } from "../ui/button";
import { Dialog } from "../ui/dialog";
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
    description: "준비할 절차와 자료를 확인하고 초안을 검토해요.",
    Icon: FilePenLine,
  },
  {
    id: "lawyer",
    label: "변호사와 해결",
    description: "상담 준비사항과 전달할 범위를 확인해요.",
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
export function FollowUpResolution(props: FollowUpResolutionProps) {
  const client = props.client ?? browserClient;
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
  const [needsConsent, setNeedsConsent] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingChoice, setPendingChoice] = useState<typeof selected>(null);
  const sequence = useRef(0),
    owner = useRef<string | null>(null),
    lock = useRef<number | null>(null);
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
  }, []);
  const handleFailure = useCallback(
    (error: unknown) => {
      const code = (error as { code?: string })?.code;
      if (code === "NOT_FOUND" || code === "UNAUTHENTICATED") purge();
      else if (code === "STALE_REVISION")
        setState((current) => (current ? { ...current, status: "stale" } : null));
      else if (code === "CONSENT_REQUIRED") setNeedsConsent(true);
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
      if (epoch === sequence.current) handleFailure(e);
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
      if (!dirtyRef.current) void load();
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
  ) {
    if (lock.current !== null) return;
    const epoch = sequence.current;
    lock.current = epoch;
    setBusy(true);
    setError("");
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
      if (epoch === sequence.current) handleFailure(e);
    } finally {
      finish(epoch);
    }
  }
  async function choose(choice: NonNullable<typeof selected>) {
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
    const readOnly = needsConsent;
    await run(async (options, epoch) => {
      const [available, currentReport, historical] = await Promise.all([
        client.files(props.caseId),
        client.report(props.caseId, options),
        readOnly ? client.getResolution(props.caseId, options) : Promise.resolve(null),
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
      if (!state) throw new Error("NOT_READY");
      const base = state.basis
        ? { reportId: state.basis.reportId, reportRevision: state.basis.reportRevision }
        : { reportId: currentReport.id, reportRevision: currentReport.revision };
      return client.updateResolution(
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
      );
    }, !readOnly);
  }
  function requestChoice(choice: NonNullable<typeof selected>) {
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
                  choice: selected === "lawyer" ? "lawyer" : "self",
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
    <section
      className={`resolution${props.embedded ? " resolution--embedded" : ""}`}
      aria-label="리포트 이후 해결 방법"
    >
      <div className="resolution-heading">
        <h2>다음으로 어떻게 진행할까요?</h2>
        <p>필요한 방법을 선택하고 언제든 바꿀 수 있어요.</p>
      </div>
      <div className="resolution-paths">
        {paths.map(({ id, label, description, Icon }) => (
          <Button
            key={id}
            variant="outline"
            className="resolution-path"
            aria-pressed={selected === id}
            disabled={busy || props.disabled}
            onClick={() => requestChoice(id)}
          >
            <Icon size={20} aria-hidden="true" />
            <span>
              <strong>{label}</strong>
              <span>{description}</span>
            </span>
          </Button>
        ))}
      </div>
      {error && (
        <div role="alert" className="resolution-error">
          <p>{error}</p>
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
          아직 연결할 현재 리포트·분석이 없어요. 리포트를 확인해 주세요. 변호사 목록과 기존 리포트
          저장은 이용할 수 있어요.
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
      {selected === "self" && state && (
        <div className="resolution-body">
          {state.basis && <p>확인할 사건 맥락: {resolutionContextLabel(state.basis)}</p>}
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
          {scope}
          <div className="resolution-draft-controls">
            <label>
              문서 종류
              <select
                value={kind}
                disabled={busy || blocked}
                onChange={(event) => setKind(event.target.value as V2ResolutionDocumentKind)}
              >
                {state.allowedDocumentKinds.map((value) => (
                  <option key={value} value={value}>
                    {resolutionDocumentLabels[value]}
                  </option>
                ))}
              </select>
            </label>
            <p>
              절차·서식의 공식 근거가 없으면 사실 정리 초안만 제공해요. 방어 선택만으로 항소를
              권하지 않아요.
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
                !reference ||
                state.status === "not_ready" ||
                state.status === "paused"
              }
              onClick={() => {
                if (!reference) return;
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
              }}
            >
              검토용 초안 준비
            </Button>
          </div>
          {state.draft && (
            <div className="resolution-draft">
              <h3>{state.draft.title}</h3>
              <p>
                기준 리포트 {state.draft.basis.reportRevision} ·{" "}
                {state.draft.userEdited ? "사용자가 수정한 내용" : "근거에서 구성한 초안"}
              </p>
              {!draftCurrent ? (
                <p>
                  이전 기준의 초안이에요. 선택한 범위나 사건이 달라져 본문을 표시하거나 최신 문서로
                  저장하지 않아요. 현재 기준으로 새 초안을 준비해 주세요.
                </p>
              ) : (
                <>
                  <label>
                    초안 검토·수정
                    <textarea
                      value={content}
                      maxLength={20000}
                      disabled={busy || blocked || state.status === "paused"}
                      onChange={(event) => {
                        setContent(event.target.value);
                        setReviewed(false);
                      }}
                    />
                  </label>
                  <p>미입력 항목: {state.draft.missingFields.join(" · ")}</p>
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
        </div>
      )}
      {selected === "lawyer" && (
        <div className="resolution-body">
          <h3>상담 준비와 공유 범위</h3>
          {scope}
          {scopeDirty ? (
            <p>변경한 범위를 적용하면 상담 준비사항을 다시 보여드려요.</p>
          ) : (
            <ul>
              {[...new Set(state?.consultationPreparation ?? [])].map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          )}
          <ButtonLink variant="outline" href="/lawyers">
            변호사 목록·프로필 보기
          </ButtonLink>
          <p>프로필에서 연락 방법을 골라 직접 연락해 주세요. 사건 자료는 자동 전송하지 않아요.</p>
          {state?.procedureChecks
            .filter((c) => c.id === "public-defender")
            .map((check) => (
              <div className="resolution-notice" key={check.id}>
                <h4>{check.label}</h4>
                <p>{check.detail}</p>
                <p>
                  일반 변호사 찾기와 국선변호 절차는 별개예요. 자격·선정·선임을 보장하지 않아요.
                </p>
                <div className="resolution-actions">
                  {state?.basis?.procedure.kind === "criminal" && (
                    <ButtonLink
                      variant="outline"
                      href={resolutionReadingLinks.publicDefender}
                      target="_blank"
                      rel="noreferrer"
                    >
                      국선변호인제도 공식 안내
                    </ButtonLink>
                  )}
                  <ButtonLink
                    variant="outline"
                    href={resolutionReadingLinks.legalAid}
                    target="_blank"
                    rel="noreferrer"
                  >
                    법률구조제도 공식 안내
                  </ButtonLink>
                </div>
                <p>공식 원문의 최신 내용과 이 사건의 대상 여부·신청 절차는 기관에 확인해 주세요.</p>
                {check.sourceClaimIds.map((id) => {
                  const claim = state.sourceClaims.find((c) => c.id === id);
                  const citation = state.citations.find((c) => c.id === claim?.citationId);
                  return citation ? (
                    <a key={id} href={citation.url} target="_blank" rel="noreferrer">
                      {citation.title} · 공식 안내 확인
                    </a>
                  ) : null;
                })}
              </div>
            ))}
        </div>
      )}
      {state && selected && selected !== "save_report" && (
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
    </section>
  );
}
