import {
  ArrowLeft,
  ArrowRight,
  CheckCheck,
  Clock3,
  FileText,
  FolderOpen,
  LoaderCircle,
  MessageSquare,
  Plus,
  Send,
  Upload,
  X,
} from "lucide-react";
import { type SyntheticEvent, useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../client/api";
import type { FileView, TimelineView, WorkspaceView } from "../../client/api/types";
import { CaseDetail } from "../analysis/CaseDetail";
import { Button, ButtonLink } from "../ui/button";

export type WorkspaceTab = "chat" | "files" | "timeline" | "actions";
const tabs = [
  { id: "chat", label: "대화", icon: MessageSquare, path: "" },
  { id: "files", label: "자료", icon: FolderOpen, path: "/files" },
  { id: "timeline", label: "타임라인", icon: Clock3, path: "/timeline" },
  { id: "actions", label: "다음 행동", icon: CheckCheck, path: "/actions" },
] as const;
const fileStatus: Record<FileView["status"], string> = {
  uploading: "업로드 중",
  processing: "처리 중",
  ready: "결과 확인 가능",
  failed: "처리 실패",
  waiting: "처리 대기",
};
function problem(cause: unknown) {
  const error = cause as { code?: string; message?: string; retryable?: boolean };
  const known = [
    "UNAUTHENTICATED",
    "CONSENT_REQUIRED",
    "NOT_FOUND",
    "CONFLICT",
    "QUOTA_EXCEEDED",
    "VALIDATION_ERROR",
    "UNAVAILABLE",
  ].includes(error?.code ?? "");
  return {
    code: known ? (error.code ?? "UNAVAILABLE") : "UNAVAILABLE",
    message: known
      ? (error.message ?? "요청을 완료하지 못했어요.")
      : "요청을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.",
    retryable: error?.retryable !== false,
  };
}
function size(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.ceil(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function Workspace({ caseId, tab = "chat" }: { caseId: string; tab?: WorkspaceTab }) {
  const [view, setView] = useState<WorkspaceView | null>(null);
  const [error, setError] = useState<ReturnType<typeof problem> | null>(null);
  const [busy, setBusy] = useState("");
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<FileView | null>(null);
  const [deleteFile, setDeleteFile] = useState<FileView | null>(null);
  const [entry, setEntry] = useState<Partial<TimelineView> | null>(null);
  const [original, setOriginal] = useState<{ url: string; type: string } | null>(null);
  const [uploadConsent, setUploadConsent] = useState(false);
  const [retryUploads, setRetryUploads] = useState<File[]>([]);
  const lock = useRef(false);
  const mounted = useRef(true);
  const uploadInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const latest = useRef(0);
  const showError = useCallback((cause: unknown) => {
    const next = problem(cause);
    setError(next);
    if (["UNAUTHENTICATED", "NOT_FOUND", "CONSENT_REQUIRED"].includes(next.code)) {
      setView(null);
      setSelected([]);
      setPreview(null);
      setDeleteFile(null);
      setEntry(null);
      setOriginal(null);
    }
    return next;
  }, []);

  const apply = useCallback((next: WorkspaceView) => {
    setView(next);
    setSelected((ids) =>
      ids.filter((id) => next.files.some((file) => file.id === id && file.status === "ready")),
    );
    setPreview((file) => (file ? (next.files.find((item) => item.id === file.id) ?? null) : null));
  }, []);
  const load = useCallback(async () => {
    const ticket = ++latest.current;
    const next = await api.workspace.get(caseId);
    if (mounted.current && ticket === latest.current) apply(next);
  }, [caseId, apply]);
  useEffect(() => {
    mounted.current = true;
    void load().catch((cause) => {
      if (mounted.current) showError(cause);
    });
    const refresh = () => {
      if (!document.hidden && !lock.current)
        void load().catch((cause) => {
          if (mounted.current) showError(cause);
        });
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      mounted.current = false;
      latest.current++;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load, showError]);
  useEffect(() => {
    if (!view || view.case.schemaVersion === "1") return;
    const pending =
      view.messages.some((message) => message.status === "pending") ||
      view.files.some((file) => ["uploading", "processing", "waiting"].includes(file.status));
    if (!pending) return;
    const timer = setTimeout(() => {
      if (!document.hidden && !lock.current) void load().catch(showError);
    }, 1800);
    return () => clearTimeout(timer);
  }, [view, load, showError]);
  useEffect(() => {
    if (tab === "chat" && view?.messages.length)
      chatEnd.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [view?.messages.length, tab]);
  useEffect(() => {
    const open = !!(preview || deleteFile || entry);
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current?.close();
  }, [preview, deleteFile, entry]);

  async function run(key: string, action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    latest.current++;
    setBusy(key);
    setError(null);
    setNotice("");
    try {
      await action();
    } catch (cause) {
      const nextError = showError(cause);
      if (nextError.code === "CONFLICT") await load().catch(() => {});
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  async function send(event: SyntheticEvent) {
    event.preventDefault();
    if (!view || !draft.trim()) return;
    const text = draft.trim();
    await run("send", async () => {
      apply(
        await api.workspace.sendMessage(caseId, {
          expectedRevision: view.case.revision,
          text,
          selectedFileIds: selected,
        }),
      );
      setDraft("");
      setSelected([]);
      setNotice("메시지를 저장했어요.");
    });
  }
  async function upload(files: FileList | File[] | null) {
    if (!files?.length) return;
    const chosen = Array.from(files);
    await run("upload", async () => {
      let completed = 0;
      try {
        for (const file of chosen) {
          await api.files.upload(caseId, file);
          completed++;
          await load();
        }
        setRetryUploads([]);
        setNotice("자료를 저장했어요. 처리 상태와 확인 가능한 범위를 확인해 주세요.");
      } catch (cause) {
        setRetryUploads(chosen.slice(completed));
        throw cause;
      }
    });
    if (uploadInput.current) uploadInput.current.value = "";
  }
  function closeDialog() {
    if (busy) return;
    setPreview(null);
    setDeleteFile(null);
    setEntry(null);
    setOriginal(null);
  }
  async function saveEntry(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await run("timeline", async () => {
      apply(
        await api.workspace.saveTimeline(caseId, {
          ...(entry?.id ? { id: entry.id } : {}),
          date: String(values.get("date") ?? ""),
          title: String(values.get("title") ?? "").trim(),
          detail: String(values.get("detail") ?? "").trim(),
        }),
      );
      setEntry(null);
      setNotice("타임라인을 저장했어요.");
    });
  }

  if (view?.case.schemaVersion === "1") return <CaseDetail caseId={caseId} />;
  const base = `/cases/${encodeURIComponent(caseId)}`;
  const readyFiles = view?.files.filter((file) => file.status === "ready") ?? [];
  const pendingResponse = view?.messages.some((message) => message.status === "pending");
  const readonly = view?.case.stage !== "active";
  return (
    <div className="workspace">
      <a className="workspace-back" href="/cases">
        <ArrowLeft size={16} /> 내 사건
      </a>
      <header className="workspace-header">
        <div>
          <p className="workspace-eyebrow">나의 사건 작업 공간</p>
          <h1>{view?.case.title ?? "사건을 불러오는 중"}</h1>
          <p className="workspace-muted">내용을 이어서 정리하고, 준비할 일을 하나씩 확인하세요.</p>
        </div>
        <ButtonLink href={`${base}/reports`} variant="outline">
          <FileText size={17} /> 리포트 보기
        </ButtonLink>
      </header>
      <nav className="workspace-tabs" aria-label="사건 메뉴">
        {tabs.map(({ id, label, icon: Icon, path }) => (
          <a key={id} href={`${base}${path}`} aria-current={tab === id ? "page" : undefined}>
            <Icon size={17} />
            {label}
            {id === "files" && view ? <span>{view.files.length}</span> : null}
          </a>
        ))}
      </nav>
      <div className="workspace-feedback" aria-live="polite" aria-atomic="true">
        {notice}
      </div>
      {error && (
        <section className="workspace-error" role="alert">
          <strong>{error.message}</strong>
          <p>
            {error.code === "CONFLICT"
              ? "최신 내용을 불러왔어요. 입력은 유지됩니다. 확인한 뒤 다시 저장해 주세요."
              : error.code === "QUOTA_EXCEEDED"
                ? "저장된 사건은 보존돼요. 사용량에서 한도를 확인할 수 있어요."
                : "입력한 내용은 이 화면에 남아 있어요."}
          </p>
          <div className="workspace-buttons">
            {!!retryUploads.length && (
              <Button variant="outline" disabled={!!busy} onClick={() => void upload(retryUploads)}>
                업로드 다시 시도
              </Button>
            )}
            {error.code === "UNAUTHENTICATED" ? (
              <ButtonLink href={`/login?returnTo=${encodeURIComponent(base)}`}>로그인</ButtonLink>
            ) : error.code === "CONSENT_REQUIRED" ? (
              <ButtonLink href="/consent">동의 확인</ButtonLink>
            ) : error.code === "QUOTA_EXCEEDED" ? (
              <ButtonLink href="/settings">사용량 확인</ButtonLink>
            ) : (
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() =>
                  void run("refresh", async () => {
                    await load();
                    setNotice("최신 내용을 불러왔어요.");
                  })
                }
              >
                새로고침 · 다시 확인
              </Button>
            )}
          </div>
        </section>
      )}
      {!view && !error && (
        <div className="workspace-loading" role="status">
          <LoaderCircle className="workspace-spin" /> 사건과 저장된 자료를 불러오고 있어요.
        </div>
      )}
      {view && (
        <>
          {readonly && (
            <section className="workspace-error">
              <p>
                {view.case.stage === "archived"
                  ? "보관된 사건이에요. 저장된 내용을 확인할 수 있어요."
                  : "대화를 시작하려면 최신 요약을 확인해 주세요."}
              </p>
              {view.case.stage !== "archived" && (
                <ButtonLink href={`${base}/summary`}>요약 확인하기</ButtonLink>
              )}
            </section>
          )}
          <div className="workspace-grid">
            <section
              className="workspace-main"
              aria-label={tabs.find((item) => item.id === tab)?.label}
            >
              {tab === "chat" && (
                <>
                  <div className="workspace-section-heading">
                    <div>
                      <h2>이어서 대화하기</h2>
                      <p>사실을 보충하거나 확인이 필요한 내용을 물어보세요.</p>
                    </div>
                    <MessageSquare size={22} />
                  </div>
                  <div
                    className="workspace-messages"
                    role="log"
                    aria-label="사건 대화"
                    aria-live="polite"
                  >
                    {!view.messages.length && (
                      <div className="workspace-empty">
                        <MessageSquare size={32} />
                        <h3>함께 내용을 정리해 볼까요?</h3>
                        <p>추가로 알게 된 사실이나 궁금한 내용을 남겨주세요.</p>
                      </div>
                    )}
                    {view.messages.map((message) => (
                      <article
                        className={`workspace-message workspace-message--${message.role}`}
                        key={message.id}
                      >
                        <div className="workspace-message-label">
                          {message.role === "user" ? "나" : "BARO · AI 정리"}
                          <time dateTime={message.createdAt}>
                            {new Date(message.createdAt).toLocaleTimeString("ko-KR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </time>
                        </div>
                        <p>{message.text}</p>
                        {message.status === "pending" && (
                          <span className="workspace-status">
                            <LoaderCircle size={15} className="workspace-spin" /> 응답 준비 중 ·
                            저장된 대화는 유지돼요
                          </span>
                        )}
                        {message.status === "failed" && (
                          <div className="workspace-message-failed">
                            <p>응답을 완료하지 못했어요. 같은 대화에서 다시 시도할 수 있어요.</p>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!!busy || readonly}
                              onClick={() =>
                                void run(message.id, async () => {
                                  apply(await api.workspace.retryMessage(caseId, message.id));
                                  setNotice("응답을 다시 요청했어요.");
                                })
                              }
                            >
                              응답 다시 시도
                            </Button>
                          </div>
                        )}
                      </article>
                    ))}
                    <div ref={chatEnd} />
                  </div>
                  <form className="workspace-composer" onSubmit={(event) => void send(event)}>
                    {!!readyFiles.length && (
                      <fieldset disabled={!!busy || readonly}>
                        <legend>대화에 함께 사용할 자료</legend>
                        <div className="workspace-file-choices">
                          {readyFiles.map((file) => (
                            <label key={file.id}>
                              <input
                                type="checkbox"
                                checked={selected.includes(file.id)}
                                onChange={(event) =>
                                  setSelected((ids) =>
                                    event.target.checked
                                      ? [...ids, file.id]
                                      : ids.filter((id) => id !== file.id),
                                  )
                                }
                              />
                              {file.name}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    )}
                    <label htmlFor="workspace-message">추가 사실 또는 질문</label>
                    <textarea
                      id="workspace-message"
                      maxLength={10000}
                      rows={3}
                      value={draft}
                      disabled={readonly}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder="예: 약속한 날짜 이후에 받은 연락도 정리하고 싶어요."
                    />
                    <div className="workspace-composer-footer">
                      <small>중요한 사실과 기한은 원본 및 전문가와 확인해 주세요.</small>
                      <Button
                        type="submit"
                        disabled={!!busy || !draft.trim() || readonly || pendingResponse}
                      >
                        {busy === "send" ? (
                          <LoaderCircle className="workspace-spin" size={17} />
                        ) : (
                          <Send size={17} />
                        )}
                        {busy === "send" ? "저장 중" : "보내기"}
                      </Button>
                    </div>
                  </form>
                </>
              )}
              {tab === "files" && (
                <>
                  <div className="workspace-section-heading">
                    <div>
                      <h2>사건 자료</h2>
                      <p>원본과 추출 내용을 함께 확인하고 필요한 자료를 대화에 사용하세요.</p>
                    </div>
                    <FolderOpen size={22} />
                  </div>
                  <div className="workspace-upload">
                    <Upload size={28} />
                    <h3>자료를 추가하세요</h3>
                    <p>
                      문서 · 이미지 · 음성 · 영상
                      <br />
                      파일별 최대 50 MB, 음성·영상 300 MB
                    </p>
                    <label className="workspace-consent">
                      <input
                        type="checkbox"
                        checked={uploadConsent}
                        disabled={!!busy || readonly}
                        onChange={(event) => setUploadConsent(event.target.checked)}
                      />
                      선택 자료의 자동 처리에 동의합니다.
                    </label>
                    <label className="workspace-upload-label" htmlFor="workspace-upload">
                      업로드할 파일 선택
                    </label>
                    <input
                      ref={uploadInput}
                      id="workspace-upload"
                      aria-label="업로드할 파일 선택"
                      type="file"
                      multiple
                      disabled={!!busy || readonly || !uploadConsent}
                      accept=".txt,.pdf,.doc,.docx,.hwp,.hwpx,.xls,.xlsx,.ppt,.pptx,image/*,audio/*,video/*"
                      onChange={(event) => void upload(event.target.files)}
                    />
                    {busy === "upload" && (
                      <p role="status">
                        <LoaderCircle size={17} className="workspace-spin" /> 자료 저장 중
                      </p>
                    )}
                  </div>
                  {!view.files.length && (
                    <div className="workspace-empty">
                      <FolderOpen size={30} />
                      <h3>아직 자료가 없어요</h3>
                      <p>자료 없이도 대화를 이어갈 수 있어요. 준비되면 원본을 추가하세요.</p>
                    </div>
                  )}
                  <ul className="workspace-file-list">
                    {view.files.map((file) => (
                      <li key={file.id}>
                        <div className="workspace-file-title">
                          <FileText size={24} />
                          <div>
                            <h3>{file.name}</h3>
                            <p>
                              {size(file.sizeBytes)} ·{" "}
                              <span className={`workspace-status workspace-status--${file.status}`}>
                                {fileStatus[file.status]}
                              </span>
                            </p>
                          </div>
                        </div>
                        <p className="workspace-coverage">
                          {file.coverage || "추출 범위는 처리가 끝난 뒤 확인할 수 있어요."}
                        </p>
                        {file.status === "uploading" && (
                          <p className="workspace-muted">
                            업로드가 중단됐다면 같은 원본 파일을 다시 선택해 이어서 저장하세요.
                            만료된 업로드는 삭제한 뒤 다시 추가할 수 있어요.
                          </p>
                        )}
                        <div className="workspace-buttons">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setPreview(file);
                              setOriginal(null);
                            }}
                          >
                            자료 확인
                          </Button>
                          {file.status === "failed" && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!!busy || readonly}
                              onClick={() =>
                                void run(file.id, async () => {
                                  await api.files.retry(caseId, file.id);
                                  await load();
                                })
                              }
                            >
                              처리 다시 시도
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!!busy || readonly}
                            onClick={() => setDeleteFile(file)}
                          >
                            삭제
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {tab === "timeline" && (
                <>
                  <div className="workspace-section-heading">
                    <div>
                      <h2>타임라인</h2>
                      <p>언제 어떤 일이 있었는지 시간 순서로 정리하세요.</p>
                    </div>
                    <Button
                      variant="outline"
                      disabled={!!busy || readonly}
                      onClick={() => setEntry({ date: "", title: "", detail: "" })}
                    >
                      <Plus size={17} />
                      일정 추가
                    </Button>
                  </div>
                  {!view.timeline.length && (
                    <div className="workspace-empty">
                      <Clock3 size={32} />
                      <h3>타임라인을 시작하세요</h3>
                      <p>
                        처음 일어난 일부터 추가하세요. 날짜가 기억나지 않으면 비워 둘 수 있어요.
                      </p>
                    </div>
                  )}
                  <ol className="workspace-timeline">
                    {[...view.timeline]
                      .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"))
                      .map((item) => (
                        <li key={item.id}>
                          <time>{item.date || "날짜 확인 필요"}</time>
                          <div>
                            <h3>{item.title}</h3>
                            <p>{item.detail}</p>
                            <span className="workspace-muted">사용자 확인 필요</span>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!!busy || readonly}
                            onClick={() => setEntry(item)}
                          >
                            편집
                          </Button>
                        </li>
                      ))}
                  </ol>
                </>
              )}
              {tab === "actions" && (
                <>
                  <div className="workspace-section-heading">
                    <div>
                      <h2>다음 행동</h2>
                      <p>완료한 일을 표시하고, 확인이 필요한 내용을 준비하세요.</p>
                    </div>
                    <span className="workspace-count">
                      {view.actions.filter((action) => action.done).length} / {view.actions.length}{" "}
                      완료
                    </span>
                  </div>
                  {!view.actions.length && (
                    <div className="workspace-empty">
                      <CheckCheck size={32} />
                      <h3>준비할 일이 아직 없어요</h3>
                      <p>대화로 사실을 보충하면 다음에 확인할 일을 정리할 수 있어요.</p>
                      <ButtonLink href={base} variant="outline">
                        대화로 이동
                      </ButtonLink>
                    </div>
                  )}
                  <ul className="workspace-action-list">
                    {view.actions.map((action) => (
                      <li key={action.id} className={action.done ? "is-done" : ""}>
                        <label>
                          <input
                            type="checkbox"
                            checked={action.done}
                            disabled={!!busy || readonly}
                            onChange={(event) => {
                              const done = event.target.checked;
                              if (lock.current) return;
                              const previous = view;
                              apply({
                                ...view,
                                actions: view.actions.map((item) =>
                                  item.id === action.id ? { ...item, done } : item,
                                ),
                              });
                              void run(action.id, async () => {
                                try {
                                  apply(await api.workspace.setAction(caseId, action.id, done));
                                  setNotice(
                                    done ? "완료 표시를 저장했어요." : "완료 표시를 해제했어요.",
                                  );
                                } catch (cause) {
                                  apply(previous);
                                  throw cause;
                                }
                              });
                            }}
                          />
                          <span>
                            <strong>{action.title}</strong>
                            <small>{action.detail}</small>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <div className="workspace-next">
                    <h3>전문가와 직접 확인할 준비가 되셨나요?</h3>
                    <p>리포트와 필요한 자료를 검토하고, 변호사를 직접 선택해 연락하세요.</p>
                    <div className="workspace-buttons">
                      <ButtonLink href={`${base}/reports`} variant="outline">
                        리포트 검토
                      </ButtonLink>
                      <ButtonLink href="/lawyers">
                        변호사 탐색 <ArrowRight size={17} />
                      </ButtonLink>
                    </div>
                  </div>
                </>
              )}
            </section>
            <aside className="workspace-sidebar">
              <section>
                <p className="workspace-eyebrow">확인한 사건 요약</p>
                <h2>현재까지 정리한 내용</h2>
                <p className="workspace-summary">
                  {view.case.summary || "확인한 요약이 아직 없어요."}
                </p>
                <a href={`${base}/summary`}>
                  요약 검토하기 <ArrowRight size={14} />
                </a>
              </section>
              <section>
                <h2>준비 현황</h2>
                <a href={`${base}/files`}>
                  자료 <span>{view.files.length}개</span>
                </a>
                <a href={`${base}/timeline`}>
                  타임라인 <span>{view.timeline.length}개</span>
                </a>
                <a href={`${base}/actions`}>
                  다음 행동{" "}
                  <span>{view.actions.filter((action) => !action.done).length}개 남음</span>
                </a>
              </section>
              <section className="workspace-sidebar-help">
                <h2>변호사에게 전달하기</h2>
                <p>리포트에서 내용을 검토하고 전달할 자료를 직접 선택하세요.</p>
                <ButtonLink href={`${base}/reports`} variant="outline">
                  리포트 보기
                </ButtonLink>
                <a href="/lawyers">
                  변호사 탐색 <ArrowRight size={14} />
                </a>
              </section>
              <p className="workspace-saved">
                <CheckCheck size={15} />
                {new Date(view.case.updatedAt).toLocaleString("ko-KR")} 저장
              </p>
            </aside>
          </div>
        </>
      )}
      <dialog
        ref={dialog}
        className="workspace-dialog"
        onCancel={(event) => {
          event.preventDefault();
          closeDialog();
        }}
        aria-labelledby="workspace-dialog-title"
      >
        <div className="workspace-dialog-header">
          <h2 id="workspace-dialog-title">
            {deleteFile
              ? "자료 삭제"
              : entry
                ? entry.id
                  ? "타임라인 편집"
                  : "타임라인 추가"
                : "자료 확인"}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            aria-label="닫기"
            disabled={!!busy}
            onClick={closeDialog}
          >
            <X size={20} />
          </Button>
        </div>
        {preview && (
          <div className="workspace-preview">
            <h3>{preview.name}</h3>
            <p>
              {fileStatus[preview.status]} · {size(preview.sizeBytes)}
            </p>
            <h4>처리 범위</h4>
            <p>{preview.coverage || "추출 범위를 아직 확인할 수 없어요."}</p>
            <h4>추출 결과</h4>
            <pre>
              {preview.extractedText || "아직 추출된 내용이 없어요. 처리 완료 후 다시 확인하세요."}
            </pre>
            <div className="workspace-buttons">
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() =>
                  void run("original", async () => {
                    const blob = await api.files.original(caseId, preview.id);
                    const type =
                      blob.type === "application/octet-stream" ? preview.mimeType : blob.type;
                    const safe = /^(image\/(png|jpeg|webp|gif|bmp))$/.test(type);
                    if (safe) {
                      const url = await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(String(reader.result));
                        reader.onerror = () =>
                          reject(new Error("원본 미리보기를 불러오지 못했어요."));
                        reader.readAsDataURL(new Blob([blob], { type }));
                      });
                      setOriginal({ url, type });
                    } else download(blob, preview.name);
                    setNotice(
                      safe
                        ? "원본 미리보기를 불러왔어요."
                        : "원본을 내려받았어요. 파일을 열어 확인하세요.",
                    );
                  })
                }
              >
                원본 확인 · 다운로드
              </Button>
              <Button variant="ghost" onClick={closeDialog} disabled={!!busy}>
                닫기
              </Button>
            </div>
            {original && <img src={original.url} alt={`${preview.name} 원본 미리보기`} />}
            {error && (
              <p role="alert" className="workspace-error">
                {error.message}
              </p>
            )}
          </div>
        )}
        {deleteFile && (
          <>
            <p>
              <strong>{deleteFile.name}</strong> 원본과 처리 결과를 삭제할까요?
            </p>
            <p>
              삭제한 자료는 대화·리포트의 자료 선택에서 제외됩니다. 이미 저장된 대화 내용은 다시
              검토해 주세요.
            </p>
            <div className="workspace-buttons">
              <Button variant="outline" disabled={!!busy} onClick={closeDialog}>
                취소
              </Button>
              <Button
                variant="destructive"
                disabled={!!busy}
                onClick={() =>
                  void run("delete", async () => {
                    await api.files.remove(caseId, deleteFile.id);
                    await load();
                    setDeleteFile(null);
                    setNotice("자료를 삭제했어요.");
                  })
                }
              >
                {busy === "delete" ? "삭제 중" : "자료 삭제 확인"}
              </Button>
            </div>
            {error && (
              <p role="alert" className="workspace-error">
                {error.message}
              </p>
            )}
          </>
        )}
        {entry && (
          <form onSubmit={(event) => void saveEntry(event)}>
            <label htmlFor="timeline-date">날짜 (모르면 비워 두세요)</label>
            <input id="timeline-date" name="date" type="date" defaultValue={entry.date} />
            <label htmlFor="timeline-title">어떤 일이 있었나요?</label>
            <input
              id="timeline-title"
              name="title"
              required
              maxLength={300}
              defaultValue={entry.title}
            />
            <label htmlFor="timeline-detail">상세 내용</label>
            <textarea
              id="timeline-detail"
              name="detail"
              maxLength={1600}
              rows={4}
              defaultValue={entry.detail}
            />
            <div className="workspace-buttons">
              <Button variant="outline" disabled={!!busy} onClick={closeDialog}>
                취소
              </Button>
              <Button type="submit" disabled={!!busy}>
                {busy === "timeline" ? "저장 중" : "타임라인 저장"}
              </Button>
            </div>
            {error && (
              <p role="alert" className="workspace-error">
                {error.message}
              </p>
            )}
          </form>
        )}
      </dialog>
    </div>
  );
}
