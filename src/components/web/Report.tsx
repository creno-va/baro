import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Download, FileCheck2, RefreshCw, Save, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError, api, type ReportView } from "../../client/api";
import { browserSessionScope } from "../../client/api/context";
import { queryKeys } from "../../client/query/resources";
import { useWebSession } from "../../client/query/session";
import type { V2ConversationActionRequest, V2ConversationActionResult } from "../../contracts/v2";
import { downloadReviewedReport } from "../reports/download-reviewed";
import { Button, Dialog, Empty, formatDate, Loading, Problem, SectionTitle } from "./Primitives";

type Draft = {
  base: ReportView;
  content: string;
  maskIdentifiers: boolean;
  excludedFileIds: string[];
  includedPhotoIds: string[];
};
const fromReport = (report: ReportView): Draft => ({
  base: report,
  content: report.content,
  maskIdentifiers: report.maskIdentifiers,
  excludedFileIds: [...report.excludedFileIds],
  includedPhotoIds: [...(report.includedPhotoIds ?? [])],
});
const selectionKey = (ids: string[]) => [...ids].sort().join("\u0000");
const isDirty = (draft: Draft) =>
  draft.content !== draft.base.content ||
  draft.maskIdentifiers !== draft.base.maskIdentifiers ||
  selectionKey(draft.excludedFileIds) !== selectionKey(draft.base.excludedFileIds) ||
  selectionKey(draft.includedPhotoIds) !== selectionKey(draft.base.includedPhotoIds ?? []);
const saveInput = (draft: Draft) => ({
  content: draft.content,
  maskIdentifiers: draft.maskIdentifiers,
  excludedFileIds: draft.excludedFileIds,
  includedPhotoIds: draft.includedPhotoIds,
});
type SaveAttempt = { reportId: string; revision: number; input: ReturnType<typeof saveInput> };
type ReportCommand =
  | { kind: "prepare" }
  | { kind: "save"; attempt: SaveAttempt }
  | { kind: "download"; report: ReportView };
function definiteRejection(error: unknown) {
  return (
    error instanceof ApiError &&
    [
      "UNAUTHENTICATED",
      "CONSENT_REQUIRED",
      "NOT_FOUND",
      "CONFLICT",
      "VALIDATION_ERROR",
      "QUOTA_EXCEEDED",
      "EXPORT_LIMIT_EXCEEDED",
      "EXPORT_RETRY_EXHAUSTED",
    ].includes(error.code)
  );
}

export function Report({ caseId, onChanged }: { caseId: string; onChanged: () => Promise<void> }) {
  const { owner, session } = useWebSession();
  const apiOwner = session?.user?.id;
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState(false);
  const [reviewedVersion, setReviewedVersion] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"replace" | "discard" | null>(null);
  const [notice, setNotice] = useState("");
  const [refreshError, setRefreshError] = useState<unknown>(null);
  const [result, setResult] = useState<V2ConversationActionResult | null>(null);
  const preparationAttempt = useRef<V2ConversationActionRequest | null>(null);
  const savingAttempt = useRef<SaveAttempt | null>(null);
  const continuationPoll = useRef<{ requestId: string; expiresAt: number } | null>(null);
  const mounted = useRef(true);
  const lock = useRef(false);
  const dirty = draft ? isDirty(draft) : false;
  const current = useRef({
    owner,
    caseId,
    reportId: draft?.base.id,
    reportRevision: draft?.base.revision,
    dirty,
  });
  current.current = {
    owner,
    caseId,
    reportId: draft?.base.id,
    reportRevision: draft?.base.revision,
    dirty,
  };
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    lifetime.current = new AbortController();
    return () => {
      mounted.current = false;
      lifetime.current?.abort();
    };
  }, []);
  const report = useQuery({
    queryKey: queryKeys.report(owner, caseId),
    queryFn: ({ signal }) =>
      api.rework.peekReport(caseId, { expectedOwner: apiOwner ?? "", signal }),
    enabled: Boolean(owner && apiOwner),
  });
  const progress = useQuery({
    queryKey: queryKeys.progress(owner, caseId),
    queryFn: ({ signal }) =>
      api.rework.getConversationProgress(caseId, { expectedOwner: apiOwner ?? "", signal }),
    enabled: Boolean(owner && apiOwner),
    refetchInterval: (query) => {
      if (query.state.status === "error") return false;
      const state = query.state.data?.state;
      if (state && (state.report.currentJobId !== null || state.analysis.currentJobId !== null))
        return 2500;
      const continuation = query.state.data?.reportContinuation;
      if (!continuation) {
        continuationPoll.current = null;
        return false;
      }
      // Logical continuation can remain unresolved without an active provider job.
      // Observe it briefly, then leave another check to an explicit user action.
      if (continuationPoll.current?.requestId !== continuation.requestId)
        continuationPoll.current = {
          requestId: continuation.requestId,
          expiresAt: Date.now() + 120_000,
        };
      return Date.now() < continuationPoll.current.expiresAt ? 2500 : false;
    },
    refetchIntervalInBackground: false,
  });
  const files = useQuery({
    queryKey: queryKeys.files(owner, caseId),
    queryFn: async ({ signal }) => {
      signal.throwIfAborted();
      const value = await api.files.list(caseId, { metadataOnly: true });
      signal.throwIfAborted();
      return value;
    },
    enabled: Boolean(owner),
  });
  const reportStatus = progress.data?.state.report.status;
  const reportRevision = progress.data?.state.report.revision;
  useEffect(() => {
    if (reportStatus || reportRevision !== undefined)
      void queryClient.invalidateQueries({ queryKey: queryKeys.report(owner, caseId) });
  }, [reportStatus, reportRevision, owner, caseId, queryClient]);
  useEffect(() => {
    if (!report.data) return;
    setDraft((existing) =>
      existing && isDirty(existing) ? existing : fromReport(report.data as ReportView),
    );
  }, [report.data]);
  const reviewIdentity = report.data ? `${report.data.id}:${report.data.revision}` : null;
  const reviewed = reviewIdentity !== null && reviewedVersion === reviewIdentity;
  const remoteChanged = Boolean(
    draft &&
      report.data &&
      (draft.base.id !== report.data.id || draft.base.revision !== report.data.revision),
  );
  const activeJob = Boolean(
    progress.data &&
      (progress.data.state.report.currentJobId !== null ||
        progress.data.state.analysis.currentJobId !== null),
  );
  const command = useMutation({
    mutationFn: async (action: ReportCommand) => {
      if (!owner || !apiOwner) throw new ApiError("UNAUTHENTICATED", "로그인이 필요해요.");
      const operationOwner = owner;
      const generation = browserSessionScope.snapshot();
      const live = () =>
        mounted.current &&
        current.current.owner === operationOwner &&
        current.current.caseId === caseId &&
        browserSessionScope.isCurrent(generation);
      const assertLive = () => {
        if (!live()) throw new ApiError("UNAUTHENTICATED", "이용 계정 또는 사건이 변경됐어요.");
      };
      const signals = [browserSessionScope.signal()];
      if (lifetime.current) signals.push(lifetime.current.signal);
      const signal = AbortSignal.any(signals);
      setNotice("");
      setRefreshError(null);
      const synchronize = async () => {
        if (!live()) return;
        try {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.report(operationOwner, caseId) }),
            queryClient.invalidateQueries({ queryKey: queryKeys.progress(operationOwner, caseId) }),
          ]);
          if (live()) await onChanged();
        } catch (error) {
          if (live()) setRefreshError(error);
        }
      };
      if (action.kind === "prepare") {
        // Reads do not prepare a report. Only this explicit action admits work.
        const fresh = await api.rework.getConversationProgress(caseId, {
          expectedOwner: apiOwner,
          signal,
        });
        assertLive();
        queryClient.setQueryData(queryKeys.progress(operationOwner, caseId), fresh);
        if (!preparationAttempt.current)
          preparationAttempt.current = {
            action: "prepare_report",
            requestId: crypto.randomUUID(),
            expectedRevision: fresh.state.workspaceRevision,
          };
        const attempt = preparationAttempt.current;
        let accepted: V2ConversationActionResult;
        try {
          accepted = await api.rework.executeAction(caseId, attempt, {
            expectedOwner: apiOwner,
            signal,
          });
        } catch (error) {
          // An uncertain response replays the entire original request, including revision.
          if (definiteRejection(error)) preparationAttempt.current = null;
          throw error;
        }
        assertLive();
        if (preparationAttempt.current === attempt) preparationAttempt.current = null;
        setResult(accepted);
        setConfirm(null);
        if (accepted.status === "pending")
          setNotice("리포트 준비 요청을 접수했어요. 진행 상태를 확인하고 있어요.");
        if (accepted.status === "ready")
          setNotice("리포트 준비 상태를 갱신했어요. 내용을 확인해 주세요.");
        await synchronize();
      } else if (action.kind === "save") {
        let accepted: ReportView;
        try {
          accepted = await api.reports.save(caseId, action.attempt.input, action.attempt.revision);
        } catch (error) {
          if (definiteRejection(error)) savingAttempt.current = null;
          throw error;
        }
        assertLive();
        // Save is acknowledged before any metadata refresh; a refresh failure is not a failed write.
        savingAttempt.current = null;
        queryClient.setQueryData(queryKeys.report(operationOwner, caseId), accepted);
        setDraft(fromReport(accepted));
        setEditing(false);
        setReviewedVersion(null);
        setNotice("검토한 내용을 새 버전으로 저장했어요.");
        await synchronize();
      } else {
        await downloadReviewedReport({
          caseId,
          reportId: action.report.id,
          reportRevision: action.report.revision,
          expectedOwner: apiOwner,
          signal,
          verify: async () =>
            live() &&
            current.current.reportId === action.report.id &&
            current.current.reportRevision === action.report.revision &&
            !current.current.dirty,
        });
        assertLive();
        setNotice("검토한 버전의 PDF 다운로드를 요청했어요.");
      }
    },
  });
  function run(action: ReportCommand) {
    if (lock.current || command.isPending) return;
    lock.current = true;
    command.mutate(action, {
      onSettled: () => {
        lock.current = false;
      },
    });
  }
  function save() {
    if (!draft?.content.trim()) return;
    const input = saveInput(draft);
    if (
      !savingAttempt.current ||
      savingAttempt.current.reportId !== draft.base.id ||
      JSON.stringify(savingAttempt.current.input) !== JSON.stringify(input)
    )
      savingAttempt.current = { reportId: draft.base.id, revision: draft.base.revision, input };
    run({ kind: "save", attempt: savingAttempt.current });
  }
  function reload() {
    setConfirm(null);
    savingAttempt.current = null;
    setEditing(false);
    setReviewedVersion(null);
    if (report.data) setDraft(fromReport(report.data));
    continuationPoll.current = null;
    void report.refetch();
    void progress.refetch();
  }
  function edit(change: Partial<Omit<Draft, "base">>) {
    setReviewedVersion(null);
    setDraft((value) => (value ? { ...value, ...change } : value));
  }
  const matchingSave = Boolean(
    draft &&
      savingAttempt.current &&
      savingAttempt.current.reportId === draft.base.id &&
      JSON.stringify(savingAttempt.current.input) === JSON.stringify(saveInput(draft)),
  );
  const readyDownload = Boolean(
    report.data &&
      draft &&
      !dirty &&
      !remoteChanged &&
      !report.data.stale &&
      report.data.pdfAvailable !== false &&
      reviewed,
  );
  const failed =
    progress.data?.state.report.status === "failed" ||
    progress.data?.state.analysis.status === "failed";
  return (
    <section className="web-report">
      <SectionTitle label="REPORT" title="내 이야기를 한눈에">
        <Button
          variant="ghost"
          disabled={command.isPending}
          onClick={() => {
            continuationPoll.current = null;
            void report.refetch();
            void progress.refetch();
          }}
        >
          <RefreshCw size={16} />
          상태 확인
        </Button>
      </SectionTitle>
      <p className="web-resource-intro">
        정리한 내용을 검토하고, 필요한 내용을 담은 PDF를 직접 보관하거나 전달하세요.
      </p>
      {command.error && <Problem error={command.error} />}
      {Boolean(refreshError) && (
        <Problem
          error={refreshError}
          retry={() => {
            setRefreshError(null);
            void report.refetch();
            void progress.refetch();
          }}
        />
      )}
      {notice && (
        <p className="web-resource-notice" role="status">
          {notice}
        </p>
      )}
      {progress.error && <Problem error={progress.error} retry={() => void progress.refetch()} />}
      {activeJob && (
        <div className="web-report-progress">
          <Loading>
            {progress.data?.state.report.currentJobId
              ? "리포트를 준비하고 있어요."
              : "리포트에 필요한 사건 분석을 준비하고 있어요."}
          </Loading>
          <p>화면을 떠나도 이미 접수된 작업은 계속될 수 있어요. 다시 열어 상태를 확인해 주세요.</p>
        </div>
      )}
      {failed && (
        <p className="web-resource-notice">
          준비를 완료하지 못했어요. 자료와 사건 내용을 확인한 뒤 다시 요청해 주세요.
        </p>
      )}
      {progress.data?.reportContinuation && !activeJob && (
        <p className="web-resource-notice">
          이전에 접수한 준비 요청의 후속 상태를 확인해요. 오래 걸리면 상태 확인 버튼으로 다시 확인할
          수 있어요.
        </p>
      )}
      {result && (result.status === "blocked" || result.status === "require_confirmation") && (
        <div className="web-resource-notice">
          <p>리포트를 준비하기 전에 확인할 내용이 있어요.</p>
          {result.missingItems.length > 0 && (
            <ul>
              {[...new Set(result.missingItems)].map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          <a href={`/cases/${encodeURIComponent(caseId)}/summary`}>사건 내용 확인하기</a>
        </div>
      )}
      {report.isPending ? (
        <Loading>저장된 리포트를 확인하고 있어요.</Loading>
      ) : report.error ? (
        <Problem error={report.error} retry={() => void report.refetch()} />
      ) : !report.data ? (
        <Empty
          title="이야기를 한 장의 리포트로"
          action={
            <Button
              disabled={
                command.isPending || activeJob || progress.isPending || Boolean(progress.error)
              }
              onClick={() => run({ kind: "prepare" })}
            >
              <Sparkles size={17} />
              {preparationAttempt.current ? "같은 요청 다시 확인" : "리포트 준비하기"}
            </Button>
          }
        >
          사건의 사실과 자료를 정리한 뒤 리포트를 만들 수 있어요. 버튼을 누르면 필요한 분석과 리포트
          준비를 요청해요.
        </Empty>
      ) : (
        draft && (
          <>
            <header className="web-report-meta">
              <div className="web-report-meta__info">
                <FileCheck2 size={21} aria-hidden="true" />
                <span>
                  저장 버전 {report.data.revision} · {formatDate(report.data.updatedAt)}
                </span>
              </div>
              <span className="web-material-status">
                {report.data.stale ? "최신 내용 확인 필요" : "검토할 수 있어요"}
              </span>
            </header>
            {report.data.stale && (
              <p className="web-resource-notice">
                리포트를 만든 뒤 사건 내용이 바뀌었어요. 현재 내용을 확인하고 새 리포트를 준비해
                주세요.
              </p>
            )}
            {remoteChanged && (
              <div className="web-resource-notice">
                <p>
                  다른 버전이 저장됐어요. 작성 중인 내용은 유지했어요. 최신 내용을 확인한 뒤 다시
                  편집해 주세요.
                </p>
                <Button
                  variant="secondary"
                  disabled={command.isPending}
                  onClick={() => setConfirm("discard")}
                >
                  최신 내용 불러오기
                </Button>
              </div>
            )}
            <article className="web-report-document" aria-label="리포트 내용">
              <div className="web-report-document__heading">
                <span>BARO · CASE REPORT</span>
                <h3>{draft.base.title}</h3>
              </div>
              {editing ? (
                <label className="web-report-editor">
                  <span className="web-sr-only">리포트 본문 편집</span>
                  <textarea
                    value={draft.content}
                    maxLength={30000}
                    disabled={command.isPending}
                    onChange={(event) => edit({ content: event.target.value })}
                  />
                </label>
              ) : (
                <div className="web-report-content">{draft.content}</div>
              )}
            </article>
            <div className="web-resource-actions">
              <Button
                variant="secondary"
                disabled={command.isPending}
                onClick={() => setEditing(!editing)}
              >
                {editing ? "읽기 모드" : "내용 편집"}
              </Button>
              {dirty && (
                <>
                  <Button
                    disabled={
                      command.isPending || !draft.content.trim() || (remoteChanged && !matchingSave)
                    }
                    onClick={save}
                  >
                    <Save size={16} />
                    {command.isPending && command.variables?.kind === "save"
                      ? "저장 중…"
                      : matchingSave
                        ? "저장 결과 다시 확인"
                        : "검토 내용 저장"}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={command.isPending}
                    onClick={() => setConfirm("discard")}
                  >
                    편집 내용 버리기
                  </Button>
                </>
              )}
            </div>
            <fieldset className="web-report-options" disabled={command.isPending}>
              <legend>리포트에 담을 내용</legend>
              <label className="web-resource-check">
                <input
                  type="checkbox"
                  checked={draft.maskIdentifiers}
                  onChange={(event) => edit({ maskIdentifiers: event.target.checked })}
                />
                <span>저장할 때 주민등록번호·연락처·이메일 가리기</span>
              </label>
              <p className="web-resource-caption">
                이름·주소와 사진 속 개인정보는 직접 확인해 주세요. 자료 원본은 가려지지 않아요.
              </p>
              {files.error && <Problem error={files.error} retry={() => void files.refetch()} />}
              {Boolean(files.data?.length) && (
                <details>
                  <summary>리포트에서 제외할 자료 선택</summary>
                  <div className="web-report-selections">
                    {files.data?.map((file) => (
                      <label className="web-resource-check" key={file.id}>
                        <input
                          type="checkbox"
                          checked={draft.excludedFileIds.includes(file.id)}
                          onChange={(event) =>
                            edit({
                              excludedFileIds: event.target.checked
                                ? [...draft.excludedFileIds, file.id]
                                : draft.excludedFileIds.filter((id) => id !== file.id),
                              includedPhotoIds: event.target.checked
                                ? draft.includedPhotoIds.filter((id) => id !== file.id)
                                : draft.includedPhotoIds,
                            })
                          }
                        />
                        <span>{file.name}</span>
                      </label>
                    ))}
                  </div>
                </details>
              )}
              {Boolean(draft.base.photoCandidates?.length) && (
                <details>
                  <summary>포함할 사진 선택 · {draft.includedPhotoIds.length}/12</summary>
                  <div className="web-report-selections">
                    {draft.base.photoCandidates?.map((photo) => (
                      <label className="web-resource-check" key={photo.id}>
                        <input
                          type="checkbox"
                          checked={draft.includedPhotoIds.includes(photo.id)}
                          disabled={
                            draft.excludedFileIds.includes(photo.id) ||
                            (!draft.includedPhotoIds.includes(photo.id) &&
                              draft.includedPhotoIds.length >= 12)
                          }
                          onChange={(event) =>
                            edit({
                              includedPhotoIds: event.target.checked
                                ? [...draft.includedPhotoIds, photo.id]
                                : draft.includedPhotoIds.filter((id) => id !== photo.id),
                            })
                          }
                        />
                        <span>{photo.name}</span>
                      </label>
                    ))}
                  </div>
                </details>
              )}
            </fieldset>
            {dirty && (
              <p className="web-resource-notice">
                편집한 내용을 먼저 저장해 주세요. 저장 전에는 PDF를 내려받을 수 없어요.
              </p>
            )}
            {report.data.pdfAvailable === false && (
              <p className="web-resource-notice">
                현재 버전의 PDF를 사용할 수 없어요. 준비 상태를 확인하거나 새 버전을 만들어 주세요.
              </p>
            )}
            <section className="web-report-delivery" aria-label="리포트 검토 및 다운로드">
              <div className="web-report-delivery__heading">
                <Check size={20} aria-hidden="true" />
                <h3>전달 전, 한 번 더 확인하세요</h3>
              </div>
              <p>
                AI 결과에는 오류가 있을 수 있어요. 사실관계·기한·개인정보를 확인하고, 중요한 판단은
                자격 있는 전문가와 상의하세요.
              </p>
              <label className="web-resource-check">
                <input
                  type="checkbox"
                  checked={reviewed}
                  disabled={dirty || remoteChanged || report.data.stale || command.isPending}
                  onChange={(event) =>
                    setReviewedVersion(event.target.checked ? reviewIdentity : null)
                  }
                />
                <span>이 버전의 본문과 포함할 자료를 확인했어요.</span>
              </label>
              <Button
                disabled={!readyDownload || command.isPending}
                onClick={() => run({ kind: "download", report: report.data as ReportView })}
              >
                <Download size={17} />
                {command.isPending && command.variables?.kind === "download"
                  ? "PDF 확인 중…"
                  : "검토한 PDF 다운로드"}
              </Button>
            </section>
            <div className="web-report-regenerate">
              <p>새로운 자료나 대화가 추가됐나요?</p>
              <Button
                variant="secondary"
                disabled={dirty || command.isPending || activeJob || Boolean(progress.error)}
                onClick={() => setConfirm("replace")}
              >
                <Sparkles size={16} />
                {preparationAttempt.current
                  ? "같은 준비 요청 다시 확인"
                  : "현재 내용으로 새 리포트 준비"}
              </Button>
            </div>
          </>
        )
      )}
      {confirm && (
        <Dialog
          title={confirm === "replace" ? "새 리포트를 준비할까요?" : "편집 내용을 버릴까요?"}
          onClose={() => {
            if (!command.isPending) setConfirm(null);
          }}
        >
          <p>
            {confirm === "replace"
              ? "현재 사건 내용과 자료로 리포트를 다시 구성해요. 직접 편집한 문장이 새 초안에서는 달라질 수 있어요."
              : "아직 저장하지 않은 편집을 버리고 현재 저장된 리포트를 불러와요."}
          </p>
          <div className="web-resource-actions">
            <Button
              variant="secondary"
              disabled={command.isPending}
              onClick={() => setConfirm(null)}
            >
              취소
            </Button>
            <Button
              disabled={command.isPending}
              onClick={() => (confirm === "replace" ? run({ kind: "prepare" }) : reload())}
            >
              {command.isPending
                ? "확인 중…"
                : confirm === "replace"
                  ? "리포트 준비하기"
                  : "편집 버리고 불러오기"}
            </Button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
