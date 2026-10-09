import { ChevronDown, Download, Eye, FileText, RefreshCw, Save, Settings2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../client/api";
import type { FileView, ReportView } from "../../client/api/types";
import { CaseNavigation } from "../workspace/CaseNavigation";
import { ConfirmDialog } from "./ConfirmDialog";
import { downloadBlob, maskReportText } from "./download";

export function ReportReview({ caseId }: { caseId: string }) {
  const [report, setReport] = useState<ReportView | null>(null);
  const [files, setFiles] = useState<FileView[]>([]);
  const [content, setContent] = useState("");
  const [mask, setMask] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState(false);
  const [regenerate, setRegenerate] = useState(false);
  const [reloadConfirm, setReloadConfirm] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [accessChecking, setAccessChecking] = useState(true);
  const owner = useRef<string | null>(null);
  const lock = useRef(false);
  const loadSequence = useRef(0);
  const accept = useCallback((value: ReportView) => {
    setReport(value);
    setContent(value.content);
    setMask(value.maskIdentifiers);
    setExcluded(value.excludedFileIds);
    setReviewed(false);
  }, []);
  const clearOwnerState = useCallback(() => {
    ++loadSequence.current;
    owner.current = null;
    setReport(null);
    setFiles([]);
    setContent("");
    setMask(false);
    setExcluded([]);
    setSelected([]);
    setNotice("");
    setPreview(false);
    setRegenerate(false);
    setReloadConfirm(false);
    setReviewed(false);
    setAccessChecking(false);
    setBusy("");
  }, []);
  const verifyOwner = useCallback(async () => {
    const session = await api.session.get();
    const id = session.user?.id;
    if (
      !id ||
      session.needsConsent ||
      session.user?.accountType !== "customer" ||
      (owner.current && owner.current !== id)
    ) {
      clearOwnerState();
      throw Object.assign(
        new Error(
          session.needsConsent
            ? "필수 동의를 다시 확인한 뒤 리포트를 불러와 주세요."
            : session.user?.accountType !== "customer"
              ? "고객 역할로 로그인한 뒤 리포트를 다시 확인해 주세요."
              : "계정 또는 접근 상태가 변경됐어요. 로그인 후 리포트를 다시 확인해 주세요.",
        ),
        {
          code: !id
            ? "UNAUTHENTICATED"
            : session.needsConsent
              ? "CONSENT_REQUIRED"
              : session.user?.accountType !== "customer"
                ? "ROLE_REQUIRED"
                : "NOT_FOUND",
        },
      );
    }
    owner.current = id;
    return id;
  }, [clearOwnerState]);
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setAccessChecking(true);
    setBusy("리포트 확인 중…");
    setError("");
    try {
      await verifyOwner();
      const [value, materials] = await Promise.all([
        api.reports.get(caseId),
        api.files.list(caseId),
      ]);
      await verifyOwner();
      if (sequence !== loadSequence.current) return;
      accept(value);
      setFiles(materials);
      setSelected([]);
    } catch (e) {
      if (
        [
          "UNAUTHENTICATED",
          "CONSENT_REQUIRED",
          "NOT_FOUND",
          "FORBIDDEN",
          "ROLE_REQUIRED",
          "ORIGIN_NOT_ALLOWED",
        ].includes((e as { code?: string })?.code ?? "")
      )
        clearOwnerState();
      else if (sequence !== loadSequence.current) return;
      setError(e instanceof Error ? e.message : "리포트를 확인하지 못했어요.");
    } finally {
      if (sequence === loadSequence.current) {
        setBusy("");
        setAccessChecking(false);
      }
    }
  }, [caseId, accept, clearOwnerState, verifyOwner]);
  useEffect(() => {
    clearOwnerState();
    void load();
    const check = () => {
      if (document.visibilityState === "hidden") return;
      const sequence = loadSequence.current;
      setAccessChecking(true);
      void verifyOwner()
        .catch((e: unknown) => {
          clearOwnerState();
          setError(e instanceof Error ? e.message : "로그인 상태를 다시 확인해 주세요.");
        })
        .finally(() => {
          if (sequence === loadSequence.current) setAccessChecking(false);
        });
    };
    window.addEventListener("focus", check);
    window.addEventListener("storage", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      ++loadSequence.current;
      window.removeEventListener("focus", check);
      window.removeEventListener("storage", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [load, clearOwnerState, verifyOwner]);
  const dirty = Boolean(
    report &&
      (content !== report.content ||
        mask !== report.maskIdentifiers ||
        JSON.stringify(excluded) !== JSON.stringify(report.excludedFileIds)),
  );
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function run(label: string, action: () => Promise<void>) {
    if (lock.current || accessChecking) return;
    lock.current = true;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await verifyOwner();
      await action();
    } catch (e) {
      if (
        [
          "UNAUTHENTICATED",
          "CONSENT_REQUIRED",
          "NOT_FOUND",
          "FORBIDDEN",
          "ROLE_REQUIRED",
          "ORIGIN_NOT_ALLOWED",
        ].includes((e as { code?: string })?.code ?? "")
      )
        clearOwnerState();
      setError(e instanceof Error ? e.message : "처리하지 못했어요. 다시 시도해 주세요.");
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  async function ownedResult<T>(work: Promise<T>) {
    const sequence = loadSequence.current;
    const value = await work;
    await verifyOwner();
    if (sequence !== loadSequence.current)
      throw Object.assign(new Error("접근 상태를 다시 확인해 주세요."), { code: "NOT_FOUND" });
    return value;
  }
  async function save() {
    accept(
      await ownedResult(
        api.reports.save(caseId, { content, maskIdentifiers: mask, excludedFileIds: excluded }),
      ),
    );
    setNotice("검토 내용을 저장했어요.");
  }
  const toggle = (values: string[], id: string) =>
    values.includes(id) ? values.filter((x) => x !== id) : [...values, id];
  return (
    <div className="report-review report-workspace" aria-busy={Boolean(busy) || accessChecking}>
      <CaseNavigation
        caseId={caseId}
        title={report && !accessChecking ? report.title : "사건 정리"}
        active="reports"
        {...(!accessChecking ? { fileCount: files.length } : {})}
      />
      <div className="report-canvas">
        <header className="report-heading">
          <span className="report-heading-icon" aria-hidden="true">
            <FileText size={24} />
          </span>
          <h2>전달할 리포트를 준비해요</h2>
          <p>내용을 확인하고, 필요한 자료만 골라 다운로드하세요.</p>
        </header>
        {(busy || accessChecking) && (
          <p role="status" className="report-progress">
            {busy || "계정 접근 상태 확인 중…"}
          </p>
        )}
        {error && !regenerate && !reloadConfirm && (
          <div className="report-error" role="alert">
            <p>{error}</p>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={(event) => {
                event.currentTarget.focus();
                if (dirty) setReloadConfirm(true);
                else void load();
              }}
            >
              다시 확인
            </button>
            <a href="/login">로그인</a>
          </div>
        )}
        {notice && (
          <p role="status" className="report-success">
            {notice}
          </p>
        )}
        {report && !accessChecking && (
          <>
            <section className="report-editor" aria-labelledby="report-editor-heading">
              <div className="report-editor-heading">
                <div>
                  <h2 id="report-editor-heading">리포트 내용</h2>
                  <p className="report-meta">
                    버전 {report.revision} ·{" "}
                    <time dateTime={report.updatedAt}>
                      {new Date(report.updatedAt).toLocaleDateString("ko-KR")}
                    </time>
                  </p>
                </div>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={(event) => {
                    event.currentTarget.focus();
                    setRegenerate(true);
                  }}
                >
                  <RefreshCw size={16} aria-hidden="true" /> 새 버전 만들기
                </button>
              </div>
              {report.stale && (
                <p className="report-callout report-stale" role="status">
                  사건이나 자료가 변경됐어요. 새 버전을 만든 뒤 다시 검토해 주세요. 이전 편집 내용은
                  현재 버전에 보관돼요.
                </p>
              )}
              <div className="report-paper">
                <label htmlFor="report-content" className="sr-only">
                  리포트 내용 편집
                </label>
                <textarea
                  id="report-content"
                  rows={12}
                  maxLength={30000}
                  value={content}
                  disabled={Boolean(busy)}
                  onChange={(e) => {
                    setContent(e.target.value);
                    setReviewed(false);
                  }}
                  aria-describedby="report-content-count"
                />
                <p className="report-editor-count" id="report-content-count">
                  {content.length.toLocaleString()} / 30,000자
                  {dirty ? " · 저장하지 않은 변경" : " · 저장됨"}
                </p>
              </div>
              <div className="report-editor-tools">
                <button
                  type="button"
                  onClick={() => setPreview(!preview)}
                  aria-expanded={preview}
                  aria-controls={preview ? "report-preview-section" : undefined}
                >
                  <Eye size={16} aria-hidden="true" />{" "}
                  {preview ? "미리보기 닫기" : "전달 내용 미리보기"}
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy) || report.stale || !content.trim()}
                  onClick={() => void run("저장 중…", save)}
                  className={dirty ? "report-save is-dirty" : "report-save"}
                >
                  <Save size={16} aria-hidden="true" /> 검토 내용 저장
                </button>
              </div>
            </section>
            <details className="report-options">
              <summary>
                <Settings2 size={19} aria-hidden="true" />
                <span>
                  <strong>개인정보·자료 설정</strong>
                  <span className="report-options-status">
                    {mask ? "자동 가림 켜짐" : "자동 가림 꺼짐"} · 원본 {selected.length}개
                    {excluded.length > 0 ? ` · 자료 ${excluded.length}개 제외` : ""}
                  </span>
                </span>
                <ChevronDown size={18} className="report-options-chevron" aria-hidden="true" />
              </summary>
              <div className="report-options-body">
                <section aria-labelledby="report-mask-heading">
                  <h2 id="report-mask-heading">식별정보 가리기</h2>
                  <p>식별정보는 기본으로 남아요. 필요한 내용을 직접 확인한 뒤 가려 주세요.</p>
                  <label className="report-check">
                    <input
                      type="checkbox"
                      checked={mask}
                      disabled={Boolean(busy)}
                      onChange={(e) => {
                        setMask(e.target.checked);
                        setReviewed(false);
                      }}
                    />{" "}
                    전화번호·이메일·주민등록번호 가리기
                  </label>
                  <p className="report-meta">
                    이름·주소 등 다른 식별정보는 내용에서 직접 수정해 주세요. 자동 가림은 모든
                    개인정보를 찾아내지 못해요.
                  </p>
                </section>
                <section aria-labelledby="report-files-heading">
                  <h2 id="report-files-heading">자료 제외와 원본 선택</h2>
                  <p>
                    리포트에서 제외할 자료와 ZIP에 넣을 원본은 별도로 선택해요. 원본이 많거나 크면
                    선택을 줄여 나눠 다운로드해 주세요.
                  </p>
                  {!files.length && <p>등록한 자료가 없어요. PDF만 다운로드할 수 있어요.</p>}
                  {files.map((file) => (
                    <div key={file.id} className="report-material">
                      <strong>{file.name}</strong>
                      <p className="report-meta">
                        {file.sizeBytes.toLocaleString()}바이트 · {file.coverage} ·{" "}
                        {
                          {
                            ready: "확인 가능",
                            failed: "처리 실패 · 원본을 확인하거나 자료 화면에서 재시도해 주세요.",
                            processing: "처리 중",
                            uploading: "업로드 중",
                            waiting: "처리 대기",
                          }[file.status]
                        }
                      </p>
                      <div className="report-material-options">
                        <label className="report-check">
                          <input
                            type="checkbox"
                            checked={excluded.includes(file.id)}
                            disabled={Boolean(busy)}
                            onChange={() => {
                              setExcluded(toggle(excluded, file.id));
                              setSelected(selected.filter((id) => id !== file.id));
                              setReviewed(false);
                            }}
                          />{" "}
                          리포트에서 제외
                        </label>
                        <label className="report-check">
                          <input
                            type="checkbox"
                            checked={selected.includes(file.id)}
                            disabled={
                              Boolean(busy) || excluded.includes(file.id) || file.status !== "ready"
                            }
                            onChange={() => {
                              setSelected(toggle(selected, file.id));
                              setReviewed(false);
                            }}
                          />{" "}
                          ZIP에 원본 포함
                        </label>
                      </div>
                    </div>
                  ))}
                  <p className="report-option-note">
                    제외 설정은 기존 리포트 문장을 자동으로 지우지 않으므로 관련 내용을 직접 수정해
                    주세요.
                  </p>
                </section>
              </div>
            </details>
            {preview && (
              <section className="report-preview-section" id="report-preview-section">
                <h2>전달 내용 미리보기</h2>
                <pre className="report-preview">{mask ? maskReportText(content) : content}</pre>
                <p>
                  리포트 제외 자료: {excluded.length}개 · ZIP 원본: {selected.length}개
                </p>
              </section>
            )}
            <section className="report-export" aria-labelledby="report-export-heading">
              <h2 id="report-export-heading">준비됐다면 다운로드하세요</h2>
              <p>
                {dirty
                  ? "저장하지 않은 변경이 있어요. 검토 내용을 먼저 저장해 주세요."
                  : "최신 저장 내용을 다운로드해요. 전달할 상대는 직접 선택해 주세요."}
              </p>
              <label className="report-check">
                <input
                  type="checkbox"
                  checked={reviewed}
                  disabled={Boolean(busy) || dirty}
                  onChange={(e) => setReviewed(e.target.checked)}
                />{" "}
                내용·식별정보·선택한 원본을 확인했어요
              </label>
              <div className="report-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={Boolean(busy) || report.stale || dirty || !reviewed}
                  onClick={() =>
                    void run("PDF 준비 중…", async () => {
                      downloadBlob(
                        await ownedResult(api.reports.pdf(report.id)),
                        `BARO-${report.id}.pdf`,
                      );
                      setNotice("PDF 다운로드를 시작했어요.");
                    })
                  }
                >
                  <Download size={16} aria-hidden="true" /> PDF 다운로드
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy) || report.stale || dirty || !reviewed || !selected.length}
                  onClick={() =>
                    void run("ZIP 준비 중…", async () => {
                      downloadBlob(
                        await ownedResult(api.reports.zip(report.id, selected)),
                        `BARO-${report.id}.zip`,
                      );
                      setNotice("ZIP 다운로드를 시작했어요.");
                    })
                  }
                >
                  <Download size={16} aria-hidden="true" /> 선택 원본 ZIP ({selected.length})
                </button>
              </div>
              {selected.length > 0 && (
                <p className="report-option-note">
                  PDF에서 가린 정보도 원본에는 남을 수 있어요. 원본의 개인정보도 확인해 주세요.
                </p>
              )}
              <p className="report-export-notice">
                AI가 정리한 상담 준비 자료예요. 법률 판단·원본의 진정성·법적 효력을 보장하지 않아요.
                변호사에게 전달하는 것은 직접 결정하고 진행해 주세요.
              </p>
            </section>
          </>
        )}
        {regenerate && (
          <ConfirmDialog
            title="새 버전을 만들까요?"
            busy={Boolean(busy)}
            onCancel={() => setRegenerate(false)}
          >
            <p>
              최신 사건과 자료로 새 초안을 만들어요. 편집한 내용은 현재 버전에 남고 새 초안을 다시
              검토해야 해요. 사건이 변경된 경우 저장하지 않은 편집은 새 초안으로 교체돼요. 필요한
              내용은 먼저 복사해 보관하세요.
            </p>
            {error && (
              <p role="alert" className="report-error">
                {error}
              </p>
            )}
            <button type="button" onClick={() => setRegenerate(false)}>
              취소
            </button>
            <button
              type="button"
              disabled={Boolean(busy) || (dirty && !report?.stale)}
              onClick={() =>
                void run("새 버전 생성 중…", async () => {
                  accept(await ownedResult(api.reports.generate(caseId)));
                  setRegenerate(false);
                  setNotice("새 초안을 만들었어요. 내용을 다시 확인해 주세요.");
                })
              }
            >
              새 버전 생성
            </button>
          </ConfirmDialog>
        )}
        {reloadConfirm && (
          <ConfirmDialog
            title="저장 내용을 다시 불러올까요?"
            busy={Boolean(busy)}
            onCancel={() => setReloadConfirm(false)}
          >
            <p>저장하지 않은 편집 내용은 사라져요. 현재 편집 내용을 보관하려면 취소해 주세요.</p>
            <button type="button" onClick={() => setReloadConfirm(false)}>
              취소
            </button>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => {
                setReloadConfirm(false);
                void load();
              }}
            >
              편집을 버리고 다시 불러오기
            </button>
          </ConfirmDialog>
        )}
        <footer>
          <a href={`/cases/${encodeURIComponent(caseId)}`}>사건으로 돌아가기</a> ·{" "}
          <a href="/help">리포트·삭제 도움말</a> ·{" "}
          <a href="/policies/privacy">개인정보 처리방침 초안</a>
        </footer>
      </div>
    </div>
  );
}
