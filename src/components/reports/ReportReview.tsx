import { Download, Eye, FileText, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../client/api";
import type { FileView, ReportView } from "../../client/api/types";
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
  const [reviewed, setReviewed] = useState(false);
  const lock = useRef(false);
  const accept = useCallback((value: ReportView) => {
    setReport(value);
    setContent(value.content);
    setMask(value.maskIdentifiers);
    setExcluded(value.excludedFileIds);
    setReviewed(false);
  }, []);
  const load = useCallback(async () => {
    setBusy("리포트 확인 중…");
    setError("");
    try {
      const [value, materials] = await Promise.all([
        api.reports.get(caseId),
        api.files.list(caseId),
      ]);
      accept(value);
      setFiles(materials);
      setSelected([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "리포트를 확인하지 못했어요.");
    } finally {
      setBusy("");
    }
  }, [caseId, accept]);
  useEffect(() => {
    void load();
  }, [load]);
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
    if (lock.current) return;
    lock.current = true;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리하지 못했어요. 다시 시도해 주세요.");
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  async function save() {
    accept(
      await api.reports.save(caseId, { content, maskIdentifiers: mask, excludedFileIds: excluded }),
    );
    setNotice("검토 내용을 저장했어요.");
  }
  const toggle = (values: string[], id: string) =>
    values.includes(id) ? values.filter((x) => x !== id) : [...values, id];
  return (
    <div className="report-review" aria-busy={Boolean(busy)}>
      <header className="report-heading">
        <div>
          <span className="report-eyebrow">상담 준비</span>
          <h1>리포트 검토</h1>
          <p>내용을 확인하고 전달할 자료를 직접 선택해 주세요.</p>
        </div>
        <a href={`/cases/${encodeURIComponent(caseId)}`}>사건으로 돌아가기</a>
      </header>
      <aside className="report-callout">
        <ShieldCheck aria-hidden="true" size={20} />
        <p>
          AI가 정리한 상담 준비 자료예요. 법률 판단·원본의 진정성·법적 효력을 보장하지 않아요.
          변호사에게 전달하는 것은 직접 결정하고 진행해 주세요.
        </p>
      </aside>
      {busy && <p role="status">{busy}</p>}
      {error && (
        <div className="report-error" role="alert">
          <p>{error}</p>
          <button type="button" disabled={Boolean(busy)} onClick={() => void load()}>
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
      {report && (
        <>
          <section className="report-card">
            <div className="report-card-heading">
              <div>
                <h2>{report.title}</h2>
                <p className="report-meta">
                  버전 {report.revision} · {new Date(report.updatedAt).toLocaleString("ko-KR")}
                </p>
              </div>
              <button type="button" disabled={Boolean(busy)} onClick={() => setRegenerate(true)}>
                <RefreshCw size={16} aria-hidden="true" /> 새 버전 만들기
              </button>
            </div>
            {report.stale && (
              <p className="report-callout">
                사건 내용이 변경되었어요. 새 버전을 만들거나 현재 내용을 직접 수정해 주세요.
              </p>
            )}
            <label htmlFor="report-content">리포트 내용 편집</label>
            <textarea
              id="report-content"
              rows={17}
              maxLength={30000}
              value={content}
              disabled={Boolean(busy)}
              onChange={(e) => {
                setContent(e.target.value);
                setReviewed(false);
              }}
            />
            <div className="report-actions">
              <span>
                {content.length.toLocaleString()} / 30,000자
                {dirty ? " · 저장하지 않은 변경" : " · 저장됨"}
              </span>
              <button
                type="button"
                disabled={Boolean(busy) || !content.trim()}
                onClick={() => void run("저장 중…", save)}
                className="primary"
              >
                <Save size={16} aria-hidden="true" /> 검토 내용 저장
              </button>
            </div>
          </section>
          <div className="report-columns">
            <section className="report-card">
              <h2>식별정보 가리기</h2>
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
              <button type="button" onClick={() => setPreview(!preview)}>
                <Eye size={16} aria-hidden="true" />{" "}
                {preview ? "미리보기 닫기" : "전달 내용 미리보기"}
              </button>
            </section>
            <section className="report-card">
              <h2>자료 제외와 원본 선택</h2>
              <p>리포트에서 제외할 자료와 ZIP에 넣을 원본은 별도로 선택해요.</p>
              {!files.length && <p>등록한 자료가 없어요. PDF만 다운로드할 수 있어요.</p>}
              {files.map((file) => (
                <div key={file.id} className="report-material">
                  <strong>{file.name}</strong>
                  <p className="report-meta">
                    {file.coverage} ·{" "}
                    {file.status === "ready" ? "확인 가능" : "처리 대기 또는 실패"}
                  </p>
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
              ))}
              <p className="report-callout">
                PDF에서 가린 정보도 원본에는 남을 수 있어요. 제외 설정은 기존 리포트 문장을 자동으로
                지우지 않으므로 관련 내용을 직접 수정해 주세요.
              </p>
            </section>
          </div>
          {preview && (
            <section className="report-card">
              <h2>전달 내용 미리보기</h2>
              <pre className="report-preview">{mask ? maskReportText(content) : content}</pre>
              <p>
                리포트 제외 자료: {excluded.length}개 · ZIP 원본: {selected.length}개
              </p>
            </section>
          )}
          <section className="report-card report-export">
            <div>
              <FileText aria-hidden="true" />
              <h2>직접 다운로드하고 전달하기</h2>
              <p>최신 저장 내용을 다운로드해요. 저장하지 않은 변경은 먼저 저장해 주세요.</p>
              <label className="report-check">
                <input
                  type="checkbox"
                  checked={reviewed}
                  disabled={Boolean(busy) || dirty}
                  onChange={(e) => setReviewed(e.target.checked)}
                />{" "}
                내용·식별정보·선택한 원본을 확인했어요
              </label>
            </div>
            <div className="report-actions">
              <button
                type="button"
                className="primary"
                disabled={Boolean(busy) || dirty || !reviewed}
                onClick={() =>
                  void run("PDF 준비 중…", async () => {
                    downloadBlob(await api.reports.pdf(report.id), `BARO-${report.id}.pdf`);
                    setNotice("PDF 다운로드를 시작했어요.");
                  })
                }
              >
                <Download size={16} aria-hidden="true" /> PDF 다운로드
              </button>
              <button
                type="button"
                disabled={Boolean(busy) || dirty || !reviewed || !selected.length}
                onClick={() =>
                  void run("ZIP 준비 중…", async () => {
                    downloadBlob(
                      await api.reports.zip(report.id, selected),
                      `BARO-${report.id}.zip`,
                    );
                    setNotice("ZIP 다운로드를 시작했어요.");
                  })
                }
              >
                <Download size={16} aria-hidden="true" /> 선택 원본 ZIP ({selected.length})
              </button>
            </div>
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
            검토해야 해요. 저장하지 않은 변경은 먼저 저장해 주세요.
          </p>
          <button type="button" onClick={() => setRegenerate(false)}>
            취소
          </button>
          <button
            type="button"
            disabled={Boolean(busy) || dirty}
            onClick={() =>
              void run("새 버전 생성 중…", async () => {
                accept(await api.reports.generate(caseId));
                setRegenerate(false);
                setNotice("새 초안을 만들었어요. 내용을 다시 확인해 주세요.");
              })
            }
          >
            새 버전 생성
          </button>
        </ConfirmDialog>
      )}
      <footer>
        <a href="/help">리포트·삭제 도움말</a> ·{" "}
        <a href="/policies/privacy">개인정보 처리방침 초안</a>
      </footer>
    </div>
  );
}
