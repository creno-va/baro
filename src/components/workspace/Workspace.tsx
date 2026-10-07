import {
  ArrowRight,
  CheckCheck,
  ChevronDown,
  Clock3,
  FileText,
  FolderOpen,
  LoaderCircle,
  Paperclip,
  Plus,
  Send,
  Upload,
  X,
} from "lucide-react";
import { type SyntheticEvent, useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../client/api";
import type { FileView, TimelineView, WorkspaceView } from "../../client/api/types";
import type { CustomerWorkspaceView } from "../../client/api/workspace";
import { V2_LIMITS } from "../../contracts/v2";
import { CaseDetail } from "../analysis/CaseDetail";
import { useCustomerAccess } from "../intake/useCustomerAccess";
import { BrandMark } from "../ui/brand";
import { Button, ButtonLink } from "../ui/button";
import { CaseNavigation } from "./CaseNavigation";

export type WorkspaceTab = "chat" | "files" | "timeline" | "actions";
const tabLabels = { chat: "대화", files: "자료", timeline: "타임라인", actions: "다음 행동" };
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
  const [view, setView] = useState<CustomerWorkspaceView | null>(null);
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
  const sendAttempt = useRef<{
    expectedRevision: number;
    text: string;
    selectedFileIds: string[];
  } | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const uploadInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const followingChat = useRef(true);
  const chatEnd = useRef<HTMLDivElement>(null);
  const draftInput = useRef<HTMLTextAreaElement>(null);
  const latest = useRef(0);
  const purge = useCallback(() => {
    ++latest.current;
    sendAttempt.current = null;
    setView(null);
    setDraft("");
    setSelected([]);
    setPreview(null);
    setDeleteFile(null);
    setEntry(null);
    setOriginal(null);
    setUploadConsent(false);
    setRetryUploads([]);
    setNotice("");
    setBusy("");
    setError(null);
    lock.current = false;
    if (uploadInput.current) uploadInput.current.value = "";
    dialog.current?.close();
  }, []);
  const access = useCustomerAccess(purge, (cause) => setError(problem(cause)));
  const { ready, version, verify, ticket, current, alive, deny } = access;
  const showError = useCallback(
    (cause: unknown) => {
      const next = problem(cause);
      if (["UNAUTHENTICATED", "NOT_FOUND", "CONSENT_REQUIRED"].includes(next.code)) deny();
      setError(next);
      return next;
    },
    [deny],
  );

  const apply = useCallback((next: WorkspaceView) => {
    setView(next);
    setSelected((ids) =>
      ids.filter((id) => next.files.some((file) => file.id === id && file.status === "ready")),
    );
    setPreview((file) => (file ? (next.files.find((item) => item.id === file.id) ?? null) : null));
  }, []);
  const load = useCallback(async () => {
    const serial = ++latest.current;
    let epoch = ticket();
    try {
      if (!(await verify())) return;
      epoch = ticket();
      const next = await api.workspace.get(caseId);
      if (!(await verify())) return;
      if (current(epoch) && serial === latest.current) {
        apply(next);
        setError(null);
      }
    } catch (cause) {
      if (alive(epoch) && serial === latest.current) showError(cause);
    }
  }, [caseId, apply, verify, ticket, current, alive, showError]);
  useEffect(() => {
    mounted.current = true;
    if (version && !lock.current) void load();
    return () => {
      mounted.current = false;
      ++latest.current;
    };
  }, [load, version]);
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
  const latestMessage = view?.messages.at(-1);
  const latestMessageContent = latestMessage
    ? `${latestMessage.id}:${latestMessage.status}:${latestMessage.text}`
    : "";
  useEffect(() => {
    if (tab !== "chat" || !latestMessageContent) return;
    if (!followingChat.current) return;
    chatEnd.current?.scrollIntoView({
      block: "end",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [latestMessageContent, tab]);
  useEffect(() => {
    const observe = () => {
      const end = chatEnd.current;
      if (end) followingChat.current = end.getBoundingClientRect().top <= window.innerHeight + 200;
    };
    window.addEventListener("scroll", observe, { passive: true });
    return () => window.removeEventListener("scroll", observe);
  }, []);
  useEffect(() => {
    const input = draftInput.current;
    if (!input) return;
    input.style.height = draft ? "auto" : "";
    if (draft) input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
  }, [draft]);
  useEffect(() => {
    const open = !!(preview || deleteFile || entry);
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current?.close();
  }, [preview, deleteFile, entry]);

  useEffect(() => {
    const modal = dialog.current;
    if (!modal || !(preview || deleteFile || entry)) return;
    const fit = () => {
      const viewport = window.visualViewport;
      const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      modal.style.setProperty(
        "--workspace-viewport-height",
        `${(viewport?.height ?? window.innerHeight) / zoom}px`,
      );
      modal.style.setProperty(
        "--workspace-viewport-width",
        `${(viewport?.width ?? window.innerWidth) / zoom}px`,
      );
    };
    fit();
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("resize", fit);
    };
  }, [preview, deleteFile, entry]);

  async function run(key: string, action: (epoch: number) => Promise<void>) {
    if (lock.current) return;
    const epoch = ticket();
    lock.current = true;
    latest.current++;
    setBusy(key);
    setError(null);
    setNotice("");
    try {
      if (!(await verify()) || !current(epoch)) return;
      await action(epoch);
    } catch (cause) {
      if (!alive(epoch)) return;
      const nextError = showError(cause);
      if (nextError.code === "CONFLICT") {
        sendAttempt.current = null;
        await load();
      }
    } finally {
      if (alive(epoch)) {
        lock.current = false;
        setBusy("");
      }
    }
  }
  async function send(event: SyntheticEvent) {
    event.preventDefault();
    if (!view || !draft.trim()) return;
    const text = draft.trim();
    followingChat.current = true;
    await run("send", async (epoch) => {
      if (
        !sendAttempt.current ||
        sendAttempt.current.text !== text ||
        JSON.stringify(sendAttempt.current.selectedFileIds) !== JSON.stringify(selected)
      )
        sendAttempt.current = {
          expectedRevision: view.case.revision,
          text,
          selectedFileIds: selected,
        };
      const next = await api.workspace.sendMessage(caseId, sendAttempt.current);
      if (!(await verify()) || !current(epoch)) return;
      apply(next);
      sendAttempt.current = null;
      setDraft("");
      setSelected([]);
      setNotice("메시지를 저장했어요.");
    });
  }
  async function upload(files: FileList | File[] | null) {
    if (!files?.length) return;
    const chosen = Array.from(files);
    await run("upload", async (epoch) => {
      let completed = 0;
      try {
        for (const file of chosen) {
          if (!current(epoch)) return;
          await api.files.upload(caseId, file);
          if (!current(epoch)) return;
          completed++;
          await load();
        }
        if (!current(epoch)) return;
        setRetryUploads([]);
        setNotice("자료를 저장했어요. 처리 상태와 확인 가능한 범위를 확인해 주세요.");
      } catch (cause) {
        if (!current(epoch)) return;
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
    await run("timeline", async (epoch) => {
      const next = await api.workspace.saveTimeline(caseId, {
        ...(entry?.id ? { id: entry.id } : {}),
        date: String(values.get("date") ?? ""),
        title: String(values.get("title") ?? "").trim(),
        detail: String(values.get("detail") ?? "").trim(),
      });
      if (!(await verify()) || !current(epoch)) return;
      apply(next);
      setEntry(null);
      setNotice("타임라인을 저장했어요.");
    });
  }

  if (view?.case.schemaVersion === "1")
    return (
      <>
        {!ready && (
          <section className="workspace-error" role={error ? "alert" : "status"}>
            <p>{error?.message ?? "계정을 확인하고 있어요."}</p>
            {error && (
              <Button variant="outline" onClick={() => void load()}>
                다시 확인
              </Button>
            )}
          </section>
        )}
        {/* Keep legacy drafts mounted during verification; deny() removes view. */}
        <div hidden={!ready} inert={!ready}>
          <CaseDetail caseId={caseId} />
        </div>
      </>
    );
  const base = `/cases/${encodeURIComponent(caseId)}`;
  const readyFiles = view?.files.filter((file) => file.status === "ready") ?? [];
  const pendingResponse = view?.messages.some((message) => message.status === "pending");
  const readonly = !ready || view?.case.stage !== "active";
  return (
    <div className={`workspace workspace--${tab}`}>
      <CaseNavigation
        caseId={caseId}
        title={(ready ? view?.case.title : null) ?? "사건을 불러오는 중"}
        active={tab}
        fileCount={ready ? view?.files.length : undefined}
      />
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
                : ["UNAUTHENTICATED", "CONSENT_REQUIRED", "NOT_FOUND"].includes(error.code)
                  ? "계정 또는 사건 접근이 바뀌어 이전 내용을 비웠어요."
                  : "입력한 내용은 보존돼요. 확인한 뒤 다시 시도해 주세요."}
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
                  void run("refresh", async (epoch) => {
                    await load();
                    if (!(await verify()) || !current(epoch)) return;
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
      {view && ready && (
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
            <section className="workspace-main" aria-label={tabLabels[tab]}>
              {tab === "chat" && (
                <>
                  {!!view.messages.length && (
                    <div className="workspace-chat-heading">
                      <h2>이어서 대화하기</h2>
                    </div>
                  )}
                  <div
                    className="workspace-messages"
                    role="log"
                    aria-label="사건 대화"
                    aria-live="polite"
                  >
                    {!view.messages.length && (
                      <div className="workspace-chat-welcome">
                        <div className="workspace-welcome-mark">
                          <BrandMark size={52} />
                        </div>
                        <h2>이제, 하나씩 풀어가요.</h2>
                        <p>더 기억나는 일이나 궁금한 점이 있나요?</p>
                        <div className="workspace-suggestions">
                          {["어떤 자료를 준비하면 좋을까요?", "추가로 기억난 일이 있어요"].map(
                            (prompt) => (
                              <Button
                                key={prompt}
                                variant="outline"
                                disabled={!!busy || readonly}
                                onClick={() => {
                                  setDraft(prompt);
                                  draftInput.current?.focus();
                                }}
                              >
                                {prompt}
                                <ArrowRight size={15} />
                              </Button>
                            ),
                          )}
                        </div>
                      </div>
                    )}
                    {view.messages.map((message) => (
                      <article
                        className={`workspace-message workspace-message--${message.role}`}
                        key={message.id}
                      >
                        <div className="workspace-message-label">
                          <span>
                            {message.role !== "user" && <BrandMark size={25} />}
                            {message.role === "user" ? "나" : "BARO"}
                          </span>
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
                                void run(message.id, async (epoch) => {
                                  const next = await api.workspace.retryMessage(caseId, message.id);
                                  if (!(await verify()) || !current(epoch)) return;
                                  apply(next);
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
                    <div className="workspace-chat-end" ref={chatEnd} />
                  </div>
                  <form className="workspace-composer" onSubmit={(event) => void send(event)}>
                    <div className="workspace-composer-surface">
                      {!!readyFiles.length && (
                        <details className="workspace-evidence">
                          <summary>
                            <Paperclip size={15} /> 대화에 사용할 자료{" "}
                            {selected.length > 0 && <span>{selected.length}개 선택</span>}
                            <ChevronDown size={15} />
                          </summary>
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
                        </details>
                      )}
                      <label className="workspace-sr-only" htmlFor="workspace-message">
                        추가 사실 또는 질문
                      </label>
                      <textarea
                        ref={draftInput}
                        id="workspace-message"
                        maxLength={10000}
                        rows={2}
                        value={draft}
                        disabled={readonly || busy === "send"}
                        onChange={(event) => setDraft(event.target.value)}
                        placeholder="추가로 기억나는 사실이나 궁금한 점을 이야기해 주세요."
                        aria-describedby="workspace-chat-notice"
                        onKeyDown={(event) => {
                          if (
                            event.key === "Enter" &&
                            (event.metaKey || event.ctrlKey) &&
                            !event.nativeEvent.isComposing &&
                            !busy &&
                            !pendingResponse &&
                            !readonly &&
                            draft.trim()
                          ) {
                            event.preventDefault();
                            event.currentTarget.form?.requestSubmit();
                          }
                        }}
                      />
                      <div className="workspace-composer-footer">
                        <a className="workspace-attach" href={`${base}/files`}>
                          <Plus size={19} /> 자료 추가
                        </a>
                        <Button
                          className="workspace-send"
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
                    </div>
                    <p className="workspace-chat-notice" id="workspace-chat-notice">
                      BARO는 AI로 사실을 정리하며 법률 판단을 대신하지 않아요.
                      <br className="workspace-mobile-break" /> 중요한 내용은 원본과 전문가에게
                      확인해 주세요.
                    </p>
                  </form>
                </>
              )}
              {tab === "files" && (
                <>
                  <div className="workspace-section-heading">
                    <div>
                      <h2>사건 자료</h2>
                      <p>흩어진 자료를 한곳에 모아두세요.</p>
                    </div>
                  </div>
                  <div className="workspace-upload">
                    <div className="workspace-upload-intro">
                      <span className="workspace-upload-icon">
                        <Upload size={22} />
                      </span>
                      <div>
                        <h3>자료를 추가하세요</h3>
                        <p>문서 · 이미지 · 음성 · 영상</p>
                      </div>
                    </div>
                    <div className="workspace-upload-controls">
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
                      <Button
                        disabled={!!busy || readonly || !uploadConsent}
                        onClick={() => uploadInput.current?.click()}
                      >
                        <Plus size={17} aria-hidden="true" /> 파일 선택
                      </Button>
                      <input
                        ref={uploadInput}
                        id="workspace-upload"
                        aria-label="업로드할 파일 선택"
                        type="file"
                        hidden
                        multiple
                        disabled={!!busy || readonly || !uploadConsent}
                        accept=".txt,.pdf,.doc,.docx,.hwp,.hwpx,.xls,.xlsx,.ppt,.pptx,image/*,audio/*,video/*"
                        onChange={(event) => void upload(event.target.files)}
                      />
                      <p className="workspace-upload-limit">
                        문서·이미지 {V2_LIMITS.documentImageBytes / 1_000_000} MB · 음성·영상{" "}
                        {V2_LIMITS.mediaBytes / 1_000_000_000} GB까지
                      </p>
                    </div>
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
                      <h2>사건의 흐름</h2>
                      <p>언제 어떤 일이 있었는지 차근차근 정리해요.</p>
                    </div>
                    <Button
                      variant="default"
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
                      <p>하나씩 확인하면서 상담을 준비해요.</p>
                    </div>
                    <span className="workspace-count">
                      {view.actions.filter((action) => action.done).length} / {view.actions.length}{" "}
                      완료
                    </span>
                  </div>
                  {!!view.actions.length && (
                    <progress
                      className="workspace-action-progress"
                      aria-label="다음 행동 완료 현황"
                      max={view.actions.length}
                      value={view.actions.filter((action) => action.done).length}
                    />
                  )}
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
                              void run(action.id, async (epoch) => {
                                try {
                                  const next = await api.workspace.setAction(
                                    caseId,
                                    action.id,
                                    done,
                                  );
                                  if (!(await verify()) || !current(epoch)) return;
                                  apply(next);
                                  setNotice(
                                    done ? "완료 표시를 저장했어요." : "완료 표시를 해제했어요.",
                                  );
                                } catch (cause) {
                                  if (current(epoch)) apply(previous);
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
                    <h3>정리한 내용을 상담으로 이어가세요</h3>
                    <p>리포트를 검토한 뒤, 직접 선택한 변호사에게 연락할 수 있어요.</p>
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
            <aside className="workspace-sidebar" aria-label="사건 요약 및 준비 현황">
              <details className="workspace-context">
                <summary>
                  <FileText size={17} />
                  <span>사건 요약과 준비 현황</span>
                  <ChevronDown size={16} />
                </summary>
                <div className="workspace-context-content">
                  <section>
                    <h2>현재까지 정리한 내용</h2>
                    <p className="workspace-summary">
                      {view.case.summary || "확인한 요약이 아직 없어요."}
                    </p>
                    <a href={`${base}/summary`}>
                      요약 검토하기 <ArrowRight size={14} />
                    </a>
                  </section>
                  {!!view.facts?.length && (
                    <section>
                      <h2>확인할 사실</h2>
                      <ul className="workspace-facts">
                        {view.facts.map((fact) => (
                          <li key={fact.id}>
                            <p>{fact.text}</p>
                            <small>
                              {fact.attribution === "user_statement"
                                ? "사용자 진술"
                                : fact.attribution === "official_source"
                                  ? "공식 자료"
                                  : "자료에서 추출"}{" "}
                              ·{" "}
                              {fact.certainty === "uncertain"
                                ? "불확실"
                                : fact.certainty === "observed"
                                  ? "자료에서 관찰"
                                  : "보고된 사실"}
                              {fact.significance === "unfavorable" ? " · 불리한 사실" : ""}
                              {fact.conflictingFactIds.length ? " · 서로 다른 진술 확인 필요" : ""}
                            </small>
                            {fact.references.map((ref) => (
                              <span key={JSON.stringify(ref)} className="workspace-fact-source">
                                {ref.kind === "user_material" ? (
                                  <a href={`${base}/files`}>
                                    자료:{" "}
                                    {view.files.find((file) => file.id === ref.fileId)?.name ??
                                      "원본 범위 확인"}
                                  </a>
                                ) : ref.kind === "user_message" ? (
                                  "대화에서 제공"
                                ) : ref.kind === "intake_answer" ? (
                                  "질문 답변에서 제공"
                                ) : ref.kind === "intake_narrative" ? (
                                  "처음 제공한 이야기"
                                ) : (
                                  "공식 출처"
                                )}
                              </span>
                            ))}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {!!view.people?.length && (
                    <section>
                      <h2>관련 인물</h2>
                      <ul className="workspace-facts">
                        {view.people.map((person) => (
                          <li key={person.id}>
                            <strong>{person.label}</strong>
                            <p>{person.role}</p>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {!!view.unknowns?.length && (
                    <section>
                      <h2>아직 확인할 내용</h2>
                      <ul className="workspace-facts">
                        {view.unknowns.map((unknown) => (
                          <li key={unknown}>{unknown}</li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {view.notices?.map((notice) => (
                    <p key={notice} className="workspace-muted">
                      {notice}
                    </p>
                  ))}
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
                    <p>리포트에서 내용을 검토하고 전달할 자료를 직접 선택할 수 있어요.</p>
                  </section>
                </div>
              </details>
              <div className="workspace-context-footer">
                <p className="workspace-saved">
                  <CheckCheck size={14} />
                  <time
                    dateTime={view.case.updatedAt}
                    title={new Date(view.case.updatedAt).toLocaleString("ko-KR")}
                  >
                    {new Date(view.case.updatedAt).toLocaleString("ko-KR", {
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    저장
                  </time>
                </p>
                <a href="/lawyers">
                  변호사 탐색 <ArrowRight size={14} />
                </a>
              </div>
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
        {preview && ready && (
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
                  void run("original", async (epoch) => {
                    const blob = await api.files.original(caseId, preview.id);
                    if (!(await verify()) || !current(epoch)) return;
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
                      if (!(await verify()) || !current(epoch)) return;
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
        {deleteFile && ready && (
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
                  void run("delete", async (epoch) => {
                    await api.files.remove(caseId, deleteFile.id);
                    if (!(await verify()) || !current(epoch)) return;
                    await load();
                    if (!(await verify()) || !current(epoch)) return;
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
        {entry && ready && (
          <form onSubmit={(event) => void saveEntry(event)}>
            <label htmlFor="timeline-date">날짜 (모르면 비워 두세요)</label>
            <input
              id="timeline-date"
              name="date"
              type="date"
              value={entry.date ?? ""}
              onChange={(event) => setEntry({ ...entry, date: event.target.value })}
            />
            <label htmlFor="timeline-title">어떤 일이 있었나요?</label>
            <input
              id="timeline-title"
              name="title"
              required
              maxLength={300}
              value={entry.title ?? ""}
              onChange={(event) => setEntry({ ...entry, title: event.target.value })}
            />
            <label htmlFor="timeline-detail">상세 내용</label>
            <textarea
              id="timeline-detail"
              name="detail"
              maxLength={1600}
              rows={4}
              value={entry.detail ?? ""}
              onChange={(event) => setEntry({ ...entry, detail: event.target.value })}
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
