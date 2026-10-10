import { ChevronDown, Download, Eye, FileText, RefreshCw, Save, Settings2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../client/api";
import type { ReportView as BaseReportView, FileView } from "../../client/api/types";
import { isExplicitSignOut } from "../../client/session-events";
import { CaseNavigation } from "../workspace/CaseNavigation";
import { ConfirmDialog } from "./ConfirmDialog";
import { createReportMarkup } from "./document";
import { downloadBlob } from "./download";

type ReportView = BaseReportView & {
  basis?: { workspaceRevision: number; summaryRevision: number; generatedAt: string } | undefined;
  pdfAvailable?: boolean | undefined;
};

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
  const [needsConsent, setNeedsConsent] = useState(false);
  const [initialLimit, setInitialLimit] = useState(false);
  const [exportExhausted, setExportExhausted] = useState(false);
  const owner = useRef<string | null>(null);
  const lock = useRef(false);
  const loadSequence = useRef(0);
  const focusRequest = useRef(0);
  const accept = useCallback((value: ReportView) => {
    setReport(value);
    setContent(value.content);
    setMask(value.maskIdentifiers);
    setExcluded(value.excludedFileIds);
    setReviewed(false);
    setInitialLimit(false);
    setExportExhausted(false);
  }, []);
  const clearOwnerState = useCallback(() => {
    ++loadSequence.current;
    owner.current = null;
    setReport(null);
    setNeedsConsent(false);
    setInitialLimit(false);
    setExportExhausted(false);
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
  const verifyOwner = useCallback(
    async (isCurrent?: () => boolean) => {
      const sequence = loadSequence.current;
      const current = isCurrent ?? (() => sequence === loadSequence.current);
      const superseded = () =>
        Object.assign(new Error("접근 확인 요청이 갱신됐어요."), {
          code: "OWNER_CHECK_SUPERSEDED",
        });
      let session: Awaited<ReturnType<typeof api.session.get>>;
      try {
        session = await api.session.get();
      } catch (e) {
        if (!current()) throw superseded();
        throw e;
      }
      if (!current()) throw superseded();
      const id = session.user?.id;
      if (
        !id ||
        session.user?.accountType !== "customer" ||
        (owner.current && owner.current !== id)
      ) {
        clearOwnerState();
        throw Object.assign(
          new Error(
            session.user?.accountType !== "customer"
              ? "고객 역할로 로그인한 뒤 리포트를 다시 확인해 주세요."
              : "계정 또는 접근 상태가 변경됐어요. 로그인 후 리포트를 다시 확인해 주세요.",
          ),
          {
            ownerRevoked: true,
            code: !id
              ? "UNAUTHENTICATED"
              : session.user?.accountType !== "customer"
                ? "ROLE_REQUIRED"
                : "NOT_FOUND",
          },
        );
      }
      setNeedsConsent(session.needsConsent);
      owner.current = id;
      return id;
    },
    [clearOwnerState],
  );
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setAccessChecking(true);
    setBusy("리포트 확인 중…");
    setError("");
    try {
      await verifyOwner(() => sequence === loadSequence.current);
      const [value, materials] = await Promise.allSettled([
        api.reports.get(caseId),
        api.files.list(caseId),
      ]);
      await verifyOwner(() => sequence === loadSequence.current);
      if (sequence !== loadSequence.current) return;
      if (materials.status === "fulfilled") setFiles(materials.value);
      if (value.status === "rejected") {
        if (value.reason?.code === "EXPORT_LIMIT_EXCEEDED" && materials.status === "fulfilled")
          setInitialLimit(true);
        throw value.reason;
      }
      if (materials.status === "rejected") throw materials.reason;
      accept(value.value);
      setSelected([]);
    } catch (e) {
      const failure = e as { code?: string; ownerRevoked?: boolean };
      if (
        failure?.code === "OWNER_CHECK_SUPERSEDED" ||
        (sequence !== loadSequence.current && !failure?.ownerRevoked)
      )
        return;
      if ((e as { code?: string })?.code === "EXPORT_RETRY_EXHAUSTED") setExportExhausted(true);
      if ((e as { code?: string })?.code === "CONSENT_REQUIRED") setNeedsConsent(true);
      if (
        [
          "UNAUTHENTICATED",
          "NOT_FOUND",
          "FORBIDDEN",
          "ROLE_REQUIRED",
          "ORIGIN_NOT_ALLOWED",
        ].includes((e as { code?: string })?.code ?? "")
      )
        if (!failure?.ownerRevoked) clearOwnerState();
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
    const check = (event: Event) => {
      if (isExplicitSignOut(event)) {
        clearOwnerState();
        setError("로그인 후 리포트를 다시 확인해 주세요.");
        return;
      }
      if (document.visibilityState === "hidden") return;
      const sequence = loadSequence.current;
      const request = ++focusRequest.current;
      const current = () => sequence === loadSequence.current && request === focusRequest.current;
      setAccessChecking(true);
      void (async () => {
        await verifyOwner(current);
        if (!current() || lock.current) return;
        const [value, materials] = await Promise.all([
          api.reports.get(caseId),
          api.files.list(caseId),
        ]);
        await verifyOwner(current);
        if (!current()) return;
        setReport((existing) => {
          if (!existing) return existing;
          return existing.id === value.id ? value : existing;
        });
        setFiles(materials);
        setSelected((ids) =>
          ids.filter((id) => materials.some((file) => file.id === id && file.status === "ready")),
        );
        setReviewed(false);
        // Content, masking and exclusions intentionally stay in the editor.
        setNotice(
          "사건·자료 상태를 다시 확인했어요. 다른 곳에서 새 버전을 만든 경우 다시 불러와 주세요.",
        );
      })()
        .catch((e: unknown) => {
          const failure = e as { code?: string; ownerRevoked?: boolean };
          if (
            request !== focusRequest.current ||
            failure?.code === "OWNER_CHECK_SUPERSEDED" ||
            (!current() && !failure?.ownerRevoked)
          )
            return;
          if (
            [
              "UNAUTHENTICATED",
              "NOT_FOUND",
              "FORBIDDEN",
              "ROLE_REQUIRED",
              "ORIGIN_NOT_ALLOWED",
            ].includes((e as { code?: string })?.code ?? "")
          )
            if (!failure?.ownerRevoked) clearOwnerState();
          setError(e instanceof Error ? e.message : "로그인 상태를 다시 확인해 주세요.");
        })
        .finally(() => {
          if (current()) setAccessChecking(false);
        });
    };
    window.addEventListener("focus", check);
    window.addEventListener("storage", check);
    window.addEventListener("baro-session-changed", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      ++loadSequence.current;
      window.removeEventListener("focus", check);
      window.removeEventListener("storage", check);
      window.removeEventListener("baro-session-changed", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [load, clearOwnerState, verifyOwner, caseId]);
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
    const sequence = loadSequence.current;
    lock.current = true;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await verifyOwner();
      await action();
    } catch (e) {
      const failure = e as { code?: string; ownerRevoked?: boolean };
      if (
        failure?.code === "OWNER_CHECK_SUPERSEDED" ||
        (sequence !== loadSequence.current && !failure?.ownerRevoked)
      )
        return;
      if ((e as { code?: string })?.code === "EXPORT_RETRY_EXHAUSTED") setExportExhausted(true);
      if ((e as { code?: string })?.code === "CONSENT_REQUIRED") setNeedsConsent(true);
      if (
        [
          "UNAUTHENTICATED",
          "NOT_FOUND",
          "FORBIDDEN",
          "ROLE_REQUIRED",
          "ORIGIN_NOT_ALLOWED",
        ].includes((e as { code?: string })?.code ?? "")
      ) {
        if (!failure?.ownerRevoked) clearOwnerState();
      }
      setError(e instanceof Error ? e.message : "처리하지 못했어요. 다시 시도해 주세요.");
    } finally {
      lock.current = false;
      if (sequence === loadSequence.current) setBusy("");
    }
  }
  async function ownedResult<T>(work: Promise<T>) {
    const sequence = loadSequence.current;
    const value = await work;
    await verifyOwner(() => sequence === loadSequence.current);
    return value;
  }
  const splitSave = Boolean(
    report &&
      content !== report.content &&
      JSON.stringify([...excluded].sort()) !== JSON.stringify([...report.excludedFileIds].sort()),
  );
  async function save() {
    const pendingExclusions = excluded;
    accept(
      await ownedResult(
        api.reports.save(
          caseId,
          {
            content,
            maskIdentifiers: mask,
            excludedFileIds: splitSave ? (report?.excludedFileIds ?? []) : excluded,
          },
          report?.revision,
        ),
      ),
    );
    if (splitSave) {
      setExcluded(pendingExclusions);
      setNotice(
        "본문 편집을 먼저 저장했어요. 자료 제외를 적용하려면 다시 저장하고 구성된 본문을 확인해 주세요.",
      );
    } else setNotice("검토 내용을 저장했어요.");
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
        {initialLimit && !report && !accessChecking && (
          <section className="report-options-body" aria-label="리포트 처리 한도 복구">
            <h2>자료를 줄여 첫 리포트를 만들어요</h2>
            <p>리포트에서 제외할 자료를 선택하세요. 원본은 그대로 보관돼요.</p>
            {files.map((file) => (
              <label key={file.id} className="report-check">
                <input
                  type="checkbox"
                  checked={excluded.includes(file.id)}
                  disabled={Boolean(busy) || needsConsent}
                  onChange={() => setExcluded(toggle(excluded, file.id))}
                />
                {file.name} · 리포트에서 제외
              </label>
            ))}
            <button
              type="button"
              disabled={Boolean(busy) || needsConsent || !excluded.length}
              onClick={() =>
                void run("리포트 생성 중…", async () => {
                  const value = await ownedResult(api.reports.generate(caseId, excluded));
                  accept(value);
                  setFiles(await ownedResult(api.files.list(caseId)));
                })
              }
            >
              선택 자료를 제외하고 생성
            </button>
          </section>
        )}
        {report && !accessChecking && (
          <>
            {needsConsent && (
              <p className="report-callout" role="status">
                새 리포트 생성과 수정은 필수 동의 후 이용할 수 있어요. 기존 리포트와 저장된
                PDF·ZIP은 계속 확인할 수 있어요. <a href="/consent">동의 확인</a>
              </p>
            )}
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
                  {report.basis && (
                    <p className="report-meta">
                      생성 기준: 요약 {report.basis.summaryRevision} · 사건{" "}
                      {report.basis.workspaceRevision} ·{" "}
                      {new Date(report.basis.generatedAt).toLocaleString("ko-KR")}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={Boolean(busy) || needsConsent}
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
                  사건이나 자료가 변경됐어요. 이 리포트는 위 생성 기준의 내용이에요. 최신 내용은 새
                  버전을 만들어 검토해 주세요. 저장된 PDF는 기존 내용으로 다운로드할 수 있어요.
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
                  disabled={Boolean(busy) || needsConsent}
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
                  disabled={Boolean(busy) || needsConsent || report.stale || !content.trim()}
                  onClick={() => void run("저장 중…", save)}
                  className={dirty ? "report-save is-dirty" : "report-save"}
                >
                  <Save size={16} aria-hidden="true" />{" "}
                  {splitSave ? "본문 편집 먼저 저장" : "검토 내용 저장"}
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
                      disabled={Boolean(busy) || needsConsent}
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
                            disabled={Boolean(busy) || needsConsent}
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
                              Boolean(busy) ||
                              needsConsent ||
                              excluded.includes(file.id) ||
                              file.status !== "ready"
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
                  {splitSave && (
                    <p className="report-callout">
                      본문과 제외 목록을 함께 바꿨어요. 본문을 먼저 저장한 뒤 제외를 적용해 주세요.
                      입력한 편집은 이전 버전에 보관됩니다.
                    </p>
                  )}
                  <p className="report-option-note">
                    제외 목록을 바꾸면 자료를 기준으로 본문을 다시 구성해요. 기존 수동 편집은 이전
                    버전에 보관돼요. 저장 후 내용을 다시 확인해 주세요.
                  </p>
                </section>
              </div>
            </details>
            {preview && (
              <section className="report-preview-section" id="report-preview-section">
                <h2>전달 내용 미리보기</h2>
                <p className="report-option-note">
                  {dirty
                    ? "저장 전 미리보기예요. 자료 제외 설정은 저장 후 본문에 반영돼요."
                    : "저장된 생성 기준과 검토 내용을 담은 HTML 리포트예요."}
                </p>
                {/* Trusted template escapes every title/body string; no user HTML is interpreted. */}
                <section
                  className="report-html-preview"
                  aria-label="디자인된 HTML 리포트 미리보기"
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: The bounded report region must support keyboard scrolling.
                  tabIndex={0}
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: createReportMarkup escapes every user-derived string.
                  dangerouslySetInnerHTML={{
                    __html: createReportMarkup({
                      ...report,
                      content,
                      maskIdentifiers: mask,
                      excludedFileIds: excluded,
                    }),
                  }}
                />
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
              {exportExhausted && (
                <div className="report-callout">
                  <p>
                    다운로드 재시도를 모두 사용했어요. 현재 검토 내용을 새 버전으로 저장하면 새
                    다운로드를 준비할 수 있어요.
                  </p>
                  <button
                    type="button"
                    disabled={Boolean(busy) || needsConsent || report.stale || !content.trim()}
                    onClick={() => void run("검토 버전 저장 중…", save)}
                  >
                    검토 내용을 보존하고 새 버전 저장
                  </button>
                </div>
              )}
              <div className="report-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={Boolean(busy) || dirty || !reviewed}
                  onClick={() =>
                    void run("HTML 준비 중…", async () => {
                      downloadBlob(
                        await ownedResult(api.reports.html(report.id)),
                        `BARO-${report.id}.html`,
                      );
                      setNotice("HTML 리포트 다운로드를 시작했어요.");
                    })
                  }
                >
                  <Download size={16} aria-hidden="true" /> HTML 다운로드
                </button>
                <button
                  type="button"
                  disabled={
                    Boolean(busy) ||
                    ((report.stale || needsConsent) && !report.pdfAvailable) ||
                    dirty ||
                    !reviewed
                  }
                  onClick={() =>
                    void run("PDF 준비 중…", async () => {
                      downloadBlob(
                        await ownedResult(api.reports.pdf(report.id)),
                        `BARO-${report.id}.pdf`,
                      );
                      setReport((current) =>
                        current?.id === report.id ? { ...current, pdfAvailable: true } : current,
                      );
                      setNotice("PDF 다운로드를 시작했어요.");
                    })
                  }
                >
                  <Download size={16} aria-hidden="true" /> PDF 다운로드
                </button>
                <button
                  type="button"
                  disabled={
                    Boolean(busy) ||
                    needsConsent ||
                    report.stale ||
                    dirty ||
                    !reviewed ||
                    !selected.length
                  }
                  onClick={() =>
                    void run("ZIP 준비 중…", async () => {
                      downloadBlob(
                        await ownedResult(api.reports.zip(report.id, selected)),
                        `BARO-${report.id}.zip`,
                      );
                      const refreshed = await ownedResult(api.reports.get(caseId));
                      setReport((current) =>
                        current?.id === refreshed.id
                          ? { ...current, savedZip: refreshed.savedZip }
                          : current,
                      );
                      setNotice("ZIP 다운로드를 시작했어요.");
                    })
                  }
                >
                  <Download size={16} aria-hidden="true" /> 선택 원본 ZIP ({selected.length})
                </button>
              </div>
              {report.savedZip && (
                <button
                  type="button"
                  disabled={Boolean(busy) || dirty || !reviewed}
                  onClick={() =>
                    void run("저장된 ZIP 확인 중…", async () => {
                      if (!report.savedZip) return;
                      downloadBlob(
                        await ownedResult(api.reports.savedZip(report.savedZip.id)),
                        `BARO-${report.id}.zip`,
                      );
                      setNotice("저장된 ZIP 다운로드를 시작했어요.");
                    })
                  }
                >
                  <Download size={16} aria-hidden="true" /> 저장된 선택 원본 ZIP (
                  {report.savedZip.fileCount}) 다시 다운로드
                </button>
              )}
              {(selected.length > 0 || report.savedZip) && (
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
              disabled={Boolean(busy) || needsConsent || (dirty && !report?.stale)}
              onClick={() =>
                void run("새 버전 생성 중…", async () => {
                  const value = await ownedResult(api.reports.generate(caseId));
                  const materials = await ownedResult(api.files.list(caseId));
                  accept(value);
                  setFiles(materials);
                  setSelected([]);
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
