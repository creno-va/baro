import { Download, Image as ImageIcon, Pencil } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../client/api";
import type { ReportView as BaseReportView, FileView } from "../../client/api/types";
import { isExplicitSignOut } from "../../client/session-events";
import { LoadingContent, Spinner } from "../ui/loading";
import { CaseNavigation } from "../workspace/CaseNavigation";
import { ConfirmDialog } from "./ConfirmDialog";
import { downloadBlob } from "./download";
import { ReportReading } from "./ReportReading";

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
  const [includedPhotos, setIncludedPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [busyStartedAt, setBusyStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [regenerate, setRegenerate] = useState(false);
  const [reloadConfirm, setReloadConfirm] = useState(false);
  const [accessChecking, setAccessChecking] = useState(true);
  const [accessUnknown, setAccessUnknown] = useState(false);
  const [needsConsent, setNeedsConsent] = useState(false);
  const [initialLimit, setInitialLimit] = useState(false);
  const [exportExhausted, setExportExhausted] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const owner = useRef<string | null>(null);
  const lock = useRef(false);
  const loadSequence = useRef(0);
  const focusRequest = useRef(0);
  const accept = useCallback((value: ReportView) => {
    setReport(value);
    setEditing(false);
    setIncludedPhotos(value.includedPhotoIds ?? []);

    setContent(value.content);
    setMask(value.maskIdentifiers);
    setExcluded(value.excludedFileIds);

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
    setExportingPdf(false);
    setContent("");
    setEditing(false);
    setMask(false);
    setExcluded([]);
    setIncludedPhotos([]);

    setRegenerate(false);
    setReloadConfirm(false);

    setAccessChecking(false);
    setAccessUnknown(false);
    setBusy("");
    setBusyStartedAt(null);
  }, []);
  useEffect(() => {
    setElapsedSeconds(0);
    if (busyStartedAt === null) return;
    const timer = window.setInterval(
      () => setElapsedSeconds(Math.max(0, Math.floor((performance.now() - busyStartedAt) / 1000))),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [busyStartedAt]);
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
        setAccessUnknown(true);
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
      setAccessUnknown(false);
      owner.current = id;
      return id;
    },
    [clearOwnerState],
  );
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setAccessChecking(true);
    setBusy("리포트 확인 중…");
    setBusyStartedAt(performance.now());
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
        setBusyStartedAt(null);
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
        setIncludedPhotos((ids) =>
          ids.filter((id) => materials.some((file) => file.id === id && file.status === "ready")),
        );

        // Content, masking and exclusions intentionally stay in the editor.
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
        JSON.stringify(includedPhotos) !== JSON.stringify(report.includedPhotoIds ?? []) ||
        JSON.stringify(excluded) !== JSON.stringify(report.excludedFileIds)),
  );
  const photoCandidates = (report?.photoCandidates ?? []).filter(
    (photo) => !excluded.includes(photo.id),
  );
  const selectedPhotoBytes = files
    .filter((file) => includedPhotos.includes(file.id))
    .reduce((sum, file) => sum + file.sizeBytes, 0);
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
    setBusy("계정 접근 상태 확인 중…");
    setBusyStartedAt(performance.now());
    setError("");

    try {
      await verifyOwner();
      setBusy(label);
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
      if (sequence === loadSequence.current) {
        setBusy("");
        setBusyStartedAt(null);
      }
    }
  }
  async function ownedResult<T>(work: Promise<T>) {
    const sequence = loadSequence.current;
    const value = await work;
    if (sequence === loadSequence.current) setBusy("접근 권한 다시 확인 중…");
    await verifyOwner(() => sequence === loadSequence.current);
    return value;
  }
  async function save() {
    if (!report) throw new Error("리포트를 다시 확인해 주세요.");
    const value = await ownedResult(
      api.reports.save(
        caseId,
        {
          content,
          maskIdentifiers: mask,
          includedPhotoIds: includedPhotos,
          excludedFileIds: excluded,
        },
        report.revision,
      ),
    );
    accept(value);
    return value;
  }
  const toggle = (values: string[], id: string) =>
    values.includes(id) ? values.filter((x) => x !== id) : [...values, id];
  const progressText = `${busy || "계정 접근 상태 확인 중…"}${busyStartedAt !== null ? ` · 요청 시작 후 ${elapsedSeconds}초` : ""}`;
  return (
    <div className="report-review report-workspace" aria-busy={Boolean(busy) || accessChecking}>
      <CaseNavigation
        caseId={caseId}
        title={report ? report.title : "사건 정리"}
        active="reports"
        {...(report ? { fileCount: files.length } : {})}
      />
      <div className="report-canvas">
        <header className="report-heading">
          <div className="report-heading-copy">
            <h2>전달할 리포트를 준비해요</h2>
            <p>내용을 확인하고, 필요한 부분을 고쳐 다운로드하세요.</p>
          </div>
          {report && (
            <div className="report-heading-actions">
              <button
                type="button"
                className="report-edit-toggle"
                disabled={Boolean(busy) || accessChecking || accessUnknown || needsConsent}
                aria-expanded={editing}
                aria-controls="report-edit-fields"
                onClick={() => {
                  if (editing && dirty && !report.stale)
                    void run("수정 내용 저장 중…", async () => {
                      await save();
                      setEditing(false);
                    });
                  else setEditing((value) => !value);
                }}
              >
                <Pencil size={16} aria-hidden="true" />
                {editing ? "수정 마치기" : "수정하기"}
              </button>
              <button
                type="button"
                className="report-regenerate primary"
                disabled={Boolean(busy) || accessChecking || accessUnknown || needsConsent}
                onClick={() => setRegenerate(true)}
              >
                새 버전 만들기
              </button>
            </div>
          )}
        </header>
        {(busy || accessChecking) && (
          <p role="status" className="report-progress">
            <Spinner />
            {progressText}
          </p>
        )}
        {!report && !error && (busy || accessChecking) && (
          <LoadingContent announce={false} layout="detail" title="리포트를 불러오고 있어요." />
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
                  setBusy("자료 목록 확인 중…");
                  setFiles(await ownedResult(api.files.list(caseId)));
                })
              }
            >
              선택 자료를 제외하고 생성
            </button>
          </section>
        )}
        {report && (
          <fieldset
            className="report-controls"
            disabled={Boolean(busy) || accessChecking || accessUnknown}
          >
            {needsConsent && (
              <p className="report-callout" role="status">
                새 리포트 생성과 수정은 필수 동의 후 이용할 수 있어요. 기존 리포트와 저장된
                PDF·ZIP은 계속 확인할 수 있어요. <a href="/consent">동의 확인</a>
              </p>
            )}
            <section className="report-read-content" aria-label="리포트 검토 본문">
              <div id="report-edit-fields">
                <ReportReading
                  content={content}
                  editing={editing}
                  disabled={Boolean(busy) || needsConsent}
                  onChange={setContent}
                />
              </div>
            </section>
            <div className="report-output-options">
              <section className="report-photo-selection" aria-labelledby="report-photos-heading">
                <header>
                  <div>
                    <h3 id="report-photos-heading">PDF에 넣을 사진</h3>
                    <p>선택한 사진은 본문 뒤에 첨부해요.</p>
                  </div>
                  <a href={`/cases/${encodeURIComponent(caseId)}/files`}>자료에서 사진 추가</a>
                </header>
                {report.stale ? (
                  <p className="report-option-note">
                    새 버전을 만들면 최신 자료에서 사진을 선택할 수 있어요.
                  </p>
                ) : photoCandidates.length ? (
                  <>
                    <ul className="report-photo-list" aria-label="첨부할 사진 선택">
                      {photoCandidates.map((photo) => {
                        const checked = includedPhotos.includes(photo.id);
                        const size = files.find((file) => file.id === photo.id)?.sizeBytes ?? 0;
                        return (
                          <li key={photo.id}>
                            <label className="report-photo-choice">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={
                                  Boolean(busy) ||
                                  needsConsent ||
                                  mask ||
                                  (!checked &&
                                    (includedPhotos.length >= 12 ||
                                      selectedPhotoBytes + size > 8_000_000))
                                }
                                onChange={() => setIncludedPhotos(toggle(includedPhotos, photo.id))}
                              />
                              <ImageIcon size={20} aria-hidden="true" />
                              <span>{photo.name}</span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="report-option-note">
                      {mask
                        ? "식별정보 가리기가 켜져 있어 사진은 PDF에 포함되지 않아요."
                        : `${includedPhotos.length}장 선택 · 최대 12장, 합계 8 MB`}
                    </p>
                  </>
                ) : (
                  <p className="report-option-note">
                    자료에 사진을 올린 뒤 새 버전을 만들어 주세요.
                  </p>
                )}
              </section>
              <section className="report-mask" aria-label="식별정보 설정">
                <label className="report-check">
                  <input
                    type="checkbox"
                    checked={mask}
                    disabled={Boolean(busy) || needsConsent}
                    aria-describedby="report-mask-description"
                    onChange={(event) => setMask(event.target.checked)}
                  />
                  <span>식별정보 가리기</span>
                </label>
                <p id="report-mask-description" className="report-option-note">
                  전화번호·이메일·주민등록번호 가리기
                  <br />
                  이름·주소 등 다른 식별정보는 내용에서 직접 수정해 주세요. 자동 가림은 모든
                  개인정보를 찾아내지 못해요.
                </p>
              </section>
            </div>
            <section className="report-export" aria-label="리포트 다운로드">
              {exportExhausted && (
                <div className="report-callout">
                  <p>다운로드 재시도를 모두 사용했어요. 새 버전으로 다시 준비해 주세요.</p>
                  <button
                    type="button"
                    disabled={Boolean(busy) || needsConsent || report.stale || !content.trim()}
                    onClick={() =>
                      void run("다운로드 버전 준비 중…", async () => {
                        await save();
                      })
                    }
                  >
                    새 버전으로 다시 준비
                  </button>
                </div>
              )}
              <div className="report-actions">
                <button
                  type="button"
                  className="primary"
                  title={
                    report.stale && (!report.pdfAvailable || dirty)
                      ? "새 버전 만들기로 최신 사건을 반영한 뒤 다운로드하세요."
                      : needsConsent && dirty
                        ? "필수 동의를 확인한 뒤 수정 내용을 저장할 수 있어요."
                        : undefined
                  }
                  disabled={
                    Boolean(busy) ||
                    exportingPdf ||
                    !content.trim() ||
                    ((report.stale || needsConsent) && (!report.pdfAvailable || dirty))
                  }
                  onClick={async () => {
                    setExportingPdf(true);
                    try {
                      await run("PDF 준비 중…", async () => {
                        const value = dirty ? await save() : report;
                        const blob = await ownedResult(api.reports.pdf(value.id));
                        downloadBlob(blob, `BARO-${value.id}.pdf`);
                        setReport((current) =>
                          current?.id === value.id ? { ...current, pdfAvailable: true } : current,
                        );
                      });
                    } finally {
                      setExportingPdf(false);
                    }
                  }}
                >
                  {exportingPdf ? <Spinner /> : <Download size={16} aria-hidden="true" />}
                  {exportingPdf ? "PDF 만드는 중…" : "PDF 다운로드"}
                </button>
              </div>
              <p className="report-export-notice">
                AI가 정리한 상담 준비 자료예요. 법률 판단·원본의 진정성·법적 효력을 보장하지 않아요.
                변호사에게 전달하는 것은 직접 결정하고 진행해 주세요.
              </p>
            </section>
          </fieldset>
        )}
        {regenerate && report && (
          <ConfirmDialog
            title="새 버전을 만들까요?"
            busy={Boolean(busy)}
            busyLabel={progressText}
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
              disabled={Boolean(busy) || needsConsent}
              onClick={() =>
                void run("새 버전 생성 중…", async () => {
                  const current = dirty && !report.stale ? await save() : report;
                  const value = await ownedResult(
                    api.reports.generate(caseId, undefined, current.revision),
                  );
                  setBusy("자료 목록 확인 중…");
                  const materials = await ownedResult(api.files.list(caseId));
                  accept(value);
                  setFiles(materials);
                  setIncludedPhotos([]);
                  setRegenerate(false);
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
            busyLabel={progressText}
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
      </div>
    </div>
  );
}
