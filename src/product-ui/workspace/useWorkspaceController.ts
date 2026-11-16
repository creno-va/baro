import {
  type SyntheticEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api } from "../../client/api";
import { ApiError } from "../../client/api/core";
import { validateUpload } from "../../client/api/files";
import type {
  FileUploadProgress,
  FileView,
  TimelineView,
  WorkspaceView,
} from "../../client/api/types";
import type { CustomerWorkspaceView } from "../../client/api/workspace";
import { confirmAction } from "../../client/confirm";
import { startForegroundPolling } from "../../client/foreground-poll";
import { useCustomerAccess } from "../../components/intake/useCustomerAccess";
import { downloadReviewedReport } from "../../components/reports/download-reviewed";
import type { DisclosureHandle } from "../../components/ui/disclosure";
import {
  beginConversationUpload,
  type ConversationUpload,
  queuedConversationUpload,
  uploadCanonical,
} from "../../components/workspace/conversation-upload";
import { evidenceRequirementStates } from "../../components/workspace/evidence-state";
import { timelineDateInput, timelineEventLength } from "../../components/workspace/timeline-draft";
import type {
  V2ConversationIntent,
  V2ConversationState,
  V2LookupRequest,
  V2MessageRequest,
} from "../../contracts/v2";
import { V2_LIMITS } from "../../contracts/v2";

const materialReflectionRequest =
  "선택한 자료에서 읽은 정보를 먼저 요약하고, 근거가 있는 사실·관련 인물·타임라인에 반영해 주세요. 거래 자료라면 거래일자와 송금일시, 플랫폼·은행, 금액, 거래 상태를 각각 구분하고 계좌는 확인되는 끝 4자리만 표시해 주세요. 기존 내용과 다른 점을 설명하고, 이미 나온 정보는 다시 묻지 말고 자료만으로 확인되지 않는 내용만 알려 주세요. 원문에 없는 내용은 추측하지 마세요.";
function problem(cause: unknown) {
  const error = cause as { code?: string; message?: string; retryable?: boolean };
  const known = [
    "UNAUTHENTICATED",
    "CONSENT_REQUIRED",
    "NOT_FOUND",
    "CONFLICT",
    "QUOTA_EXCEEDED",
    "VALIDATION_ERROR",
    "FILE_REJECTED",
    "UNAVAILABLE",
  ].includes(error?.code ?? "");
  return {
    code: known ? (error.code ?? "UNAVAILABLE") : "UNAVAILABLE",
    message: known
      ? (error.message ?? "요청을 완료하지 못했어요.")
      : "요청을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.",
    retryable: error?.retryable !== false,
    resource: false,
  };
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export type WorkspaceTab = "chat" | "files" | "timeline" | "actions";
export type WorkspaceProps = {
  caseId: string;
  tab?: WorkspaceTab;
  lookupAvailable?: boolean;
};
export function useWorkspaceController({
  caseId,
  tab = "chat",
  lookupAvailable = false,
}: WorkspaceProps) {
  const [view, setView] = useState<CustomerWorkspaceView | null>(null);
  const [contextRequested, setContextRequested] = useState(false);
  const [contextLoaded, setContextLoaded] = useState(false);
  const preparationAttempt = useRef<{
    target: "timeline" | "actions";
    request: V2MessageRequest;
  } | null>(null);
  const previousMessages = useRef<Map<string, string> | null>(null);
  const newestMessageAt = useRef("");
  const [progressiveIds, setProgressiveIds] = useState<Set<string>>(new Set());
  const [incomingActionMessages, setIncomingActionMessages] = useState<Set<string>>(new Set());
  const [conversationRequest, setConversationRequest] = useState<{
    id: string;
    action: V2ConversationIntent;
  } | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [materialsRequest, setMaterialsRequest] = useState(0);
  const composerMenu = useRef<DisclosureHandle>(null);
  const composerTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !composerMenu.current?.contains(event.target))
        composerMenu.current?.close();
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  const reviewOrigin = useRef<HTMLElement | null>(null);
  const [conversationState, setConversationState] = useState<V2ConversationState | null>(null);
  const openMaterials = useCallback(() => {
    setMaterialsRequest((request) => request + 1);
    setMaterialsOpen(true);
  }, []);
  useEffect(() => {
    setMaterialsOpen(window.matchMedia("(min-width: 1200px)").matches);
  }, []);
  const [error, setError] = useState<ReturnType<typeof problem> | null>(null);
  const [busy, setBusy] = useState("");
  const [draft, setDraft] = useState("");
  const draftComposing = useRef(false);
  const messageTooLong = [...draft.trim()].length > 10000;
  const [selected, setSelected] = useState<string[]>([]);
  const [localAttachments, setLocalAttachments] = useState<File[]>([]);
  const [chatAttachments, setChatAttachments] = useState<FileView[]>([]);
  const [queuedSend, setQueuedSend] = useState(false);
  const queuedUpload = useRef<ConversationUpload | null>(null);
  const [conversationRefresh, setConversationRefresh] = useState(0);
  const [notice, setNotice] = useState("");
  const [uploadReadbackPending, setUploadReadbackPending] = useState(false);
  const [preview, setPreview] = useState<FileView | null>(null);
  const [deleteFile, setDeleteFile] = useState<FileView | null>(null);
  const [entry, setEntry] = useState<(Partial<TimelineView> & { expectedRevision: number }) | null>(
    null,
  );
  const [original, setOriginal] = useState<{ url: string; type: string } | null>(null);
  const [uploadConsent, setUploadConsent] = useState(false);
  const uploadForConversation = useRef(tab === "chat");
  const [retryUploads, setRetryUploads] = useState<File[]>([]);
  const [acceptedFileRetries, setAcceptedFileRetries] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState<{
    startedAt: number;
    fileName: string;
    index: number;
    total: number;
    value: FileUploadProgress;
  } | null>(null);
  const sendAttempt = useRef<{
    expectedRevision: number;
    text: string;
    selectedFileIds: string[];
  } | null>(null);
  const [lookupOpen, setLookupOpen] = useState(false);
  const lookupAttempt = useRef<V2MessageRequest | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const linkedFile = useRef("");
  const uploadInput = useRef<HTMLInputElement>(null);
  const uploadChooserScope = useRef<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const reviewDirty = useRef(false);
  const reviewBusy = useRef(false);
  const [reviewState, setReviewState] = useState({ dirty: false, busy: false });
  const fileReviewBusyChanged = useCallback((busy: boolean) => {
    reviewBusy.current = busy;
    setReviewState((old) => ({ ...old, busy }));
  }, []);
  const fileReviewDirtyChanged = useCallback((dirty: boolean) => {
    reviewDirty.current = dirty;
    setReviewState((old) => ({ ...old, dirty }));
  }, []);
  const followingChat = useRef(true);
  const pauseReplyFollowing = useCallback(() => {
    followingChat.current = false;
  }, []);
  const chatMessages = useRef<HTMLDivElement>(null);
  const historyAnchor = useRef<{ top: number; height: number } | null>(null);
  const draftInput = useRef<HTMLTextAreaElement>(null);
  const latest = useRef(0);
  const operationError = useRef<ReturnType<typeof problem> | null>(null);
  const acknowledgedTimeline = useRef(false);
  const [timelineRecovery, setTimelineRecovery] = useState(false);
  const purge = useCallback(() => {
    ++latest.current;
    operationError.current = null;
    acknowledgedTimeline.current = false;
    setTimelineRecovery(false);
    sendAttempt.current = null;
    lookupAttempt.current = null;
    setLookupOpen(false);
    previousMessages.current = null;
    newestMessageAt.current = "";
    setProgressiveIds(new Set());
    setIncomingActionMessages(new Set());
    setConversationRequest(null);
    setAgentBusy(false);
    setConversationState(null);
    setMaterialsOpen(false);
    setMaterialsRequest(0);
    setView(null);
    setContextRequested(false);
    setContextLoaded(false);
    preparationAttempt.current = null;
    draftComposing.current = false;
    setDraft("");
    setSelected([]);
    setLocalAttachments([]);
    setChatAttachments([]);
    setQueuedSend(false);
    queuedUpload.current = null;
    setPreview(null);
    setDeleteFile(null);
    setEntry(null);
    setOriginal(null);
    setUploadConsent(false);
    setRetryUploads([]);
    setUploadReadbackPending(false);
    setAcceptedFileRetries([]);
    setUploadProgress(null);
    uploadChooserScope.current = "revoked";
    setNotice("");
    setBusy("");
    setError(null);
    lock.current = false;
    if (uploadInput.current) uploadInput.current.value = "";
  }, []);
  const access = useCustomerAccess(purge, (cause) => setError(problem(cause)), true);
  const { ready, canMutate, version, verify, ticket, current, alive, deny } = access;
  const readonly = !ready || !canMutate || view?.case.stage !== "active" || agentBusy;
  const privateContent = {
    style: { visibility: ready ? undefined : ("hidden" as const) },
    inert: !ready,
    "aria-hidden": !ready,
  };
  const showError = useCallback(
    (cause: unknown, resource = false) => {
      const next = { ...problem(cause), resource };
      if (next.code === "UNAUTHENTICATED" || (next.code === "NOT_FOUND" && !resource)) deny();
      setError(next);
      return next;
    },
    [deny],
  );

  const apply = useCallback((next: WorkspaceView, animateNew = true) => {
    const previous = previousMessages.current;
    if (previous && animateNew) {
      const added = next.messages.filter(
        (message) =>
          message.role === "assistant" &&
          message.status === "complete" &&
          (previous.get(message.id) === "pending" ||
            (!previous.has(message.id) && message.createdAt >= newestMessageAt.current)),
      );
      if (added.length) setProgressiveIds((ids) => new Set([...ids, ...added.map((m) => m.id)]));
      if (added.length)
        setIncomingActionMessages((ids) => new Set([...ids, ...added.map((m) => m.id)]));
    }
    previousMessages.current = new Map(next.messages.map((m) => [m.id, m.status]));
    newestMessageAt.current = next.messages.reduce(
      (latest, m) => (m.createdAt > latest ? m.createdAt : latest),
      newestMessageAt.current,
    );
    setView(next);
    setChatAttachments((files) =>
      files.map((file) => next.files.find((item) => item.id === file.id) ?? file),
    );
    setAcceptedFileRetries([]);
    setSelected((ids) =>
      ids.filter((id) => next.files.some((file) => file.id === id && file.status === "ready")),
    );
    setPreview((file) => (file ? (next.files.find((item) => item.id === file.id) ?? null) : null));
  }, []);
  const followReply = useCallback(() => {
    const messages = chatMessages.current;
    if (followingChat.current && messages)
      messages.scrollTo({ top: messages.scrollHeight, behavior: "instant" });
  }, []);
  useLayoutEffect(() => {
    const anchor = historyAnchor.current;
    const messages = chatMessages.current;
    historyAnchor.current = null;
    if (anchor && messages) messages.scrollTop = anchor.top + messages.scrollHeight - anchor.height;
  });
  const workspaceLoaded = view !== null;
  useEffect(() => {
    const messages = chatMessages.current;
    if (tab !== "chat" || !workspaceLoaded || !messages) return;
    // Following a reply also follows changes in composer height and panel width.
    // Reading earlier messages keeps the user's scroll position.
    const observer = new ResizeObserver(followReply);
    observer.observe(messages);
    return () => observer.disconnect();
  }, [tab, workspaceLoaded, followReply]);
  const finishReply = useCallback((id: string) => {
    setProgressiveIds((ids) => {
      const next = new Set(ids);
      next.delete(id);
      return next;
    });
  }, []);
  const fileReviewError = useCallback((cause: unknown) => showError(cause, true), [showError]);
  const readView = useCallback(
    () =>
      tab === "files" && !contextRequested
        ? api.workspace.getFiles(caseId)
        : api.workspace.get(caseId),
    [caseId, tab, contextRequested],
  );
  const load = useCallback(async () => {
    const serial = ++latest.current;
    let epoch = ticket();
    try {
      if (!(await verify()) || serial !== latest.current) return false;
      epoch = ticket();
      const next = await readView();
      if (serial !== latest.current || !(await verify())) return false;
      if (current(epoch) && serial === latest.current) {
        apply(next);
        if (tab !== "files" || contextRequested) setContextLoaded(true);
        setUploadReadbackPending(false);
        // A fresh read resolves its own error, not an earlier failed mutation.
        // If a failed mutation's 404 check was interrupted, this read now
        // confirms that the workspace itself still exists for the current owner.
        if (operationError.current?.code === "NOT_FOUND")
          operationError.current = { ...operationError.current, resource: true };
        setError(operationError.current);
        if (acknowledgedTimeline.current) {
          acknowledgedTimeline.current = false;
          setTimelineRecovery(false);
          setEntry(null);
        }
        return next;
      }
    } catch (cause) {
      if (alive(epoch) && serial === latest.current) showError(cause);
    }
    return false;
  }, [readView, apply, verify, ticket, current, alive, showError, tab, contextRequested]);
  useEffect(() => {
    mounted.current = true;
    if (version && !lock.current) void load();
    return () => {
      mounted.current = false;
      ++latest.current;
    };
  }, [load, version]);
  useEffect(() => {
    const renamed = (event: Event) => {
      if ((event as CustomEvent<{ id?: string }>).detail?.id === caseId && !lock.current)
        void load();
    };
    window.addEventListener("baro-case-title-changed", renamed);
    return () => window.removeEventListener("baro-case-title-changed", renamed);
  }, [caseId, load]);
  useEffect(() => {
    if (!view || view.case.schemaVersion === "1") return;
    const pending =
      view.messages.some((message) => message.status === "pending") ||
      view.files.some(
        (file) =>
          !file.uploadRejection && ["uploading", "processing", "waiting"].includes(file.status),
      );
    if (!pending) return;
    return startForegroundPolling(async () => {
      if (!lock.current) await load();
    }, 1800);
  }, [view, load]);
  useEffect(() => {
    if (tab !== "files" || !ready || !view) return;
    const id = new URLSearchParams(window.location.search).get("file");
    const key = `${caseId}:${id}`;
    const file = view.files.find((file) => file.id === id);
    if (file && linkedFile.current !== key) {
      linkedFile.current = key;
      setPreview(file);
    }
  }, [caseId, tab, ready, view]);
  useEffect(() => {
    if (!draft.trim() && !localAttachments.length && !chatAttachments.length) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft, localAttachments.length, chatAttachments.length]);
  const latestMessage = view?.messages.at(-1);
  const latestMessageContent = latestMessage
    ? `${latestMessage.id}:${latestMessage.status}:${latestMessage.text}`
    : "";
  useEffect(() => {
    if (tab !== "chat" || !latestMessageContent) return;
    followReply();
  }, [latestMessageContent, tab, followReply]);

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
    const style = new MutationObserver(fit);
    style.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class"],
    });
    return () => {
      window.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("resize", fit);
      style.disconnect();
    };
  }, [preview, deleteFile, entry]);

  useEffect(() => {
    if (
      !queuedSend ||
      busy ||
      agentBusy ||
      uploadReadbackPending ||
      !ready ||
      !view ||
      localAttachments.length
    )
      return;
    if (
      !canMutate ||
      view.case.stage !== "active" ||
      error ||
      chatAttachments.some(
        (file) =>
          !view.files.some((item) => item.id === file.id) ||
          file.status === "failed" ||
          file.uploadRejection,
      )
    ) {
      setQueuedSend(false);
      queuedUpload.current = null;
      setNotice("첨부 파일을 확인해 주세요. 입력은 보존됐으며 메시지는 보내지 않았어요.");
      return;
    }
    if (
      chatAttachments.every((file) => file.status === "ready") &&
      !view.messages.some((message) => message.status === "pending")
    )
      draftInput.current?.form?.requestSubmit();
  }, [
    queuedSend,
    busy,
    agentBusy,
    uploadReadbackPending,
    ready,
    canMutate,
    view,
    error,
    chatAttachments,
    localAttachments.length,
  ]);

  async function run(key: string, action: (epoch: number) => Promise<void>) {
    const readOrDelete = ["refresh", "history", "original", "delete", "file-preview"].includes(key);
    // Chooser selections and generic controls can complete during a focus check.
    // Each action still needs its fresh owner and read/write access preflight.
    if (
      lock.current ||
      (!["refresh", "upload", "chat-retry", "file-retry", "file-preview"].includes(key) &&
        (!ready ||
          ((key === "reflect-material" ? !canMutate || view?.case.stage !== "active" : readonly) &&
            !readOrDelete)))
    )
      return;
    const epoch = ticket();
    lock.current = true;
    latest.current++;
    setBusy(key);
    if (key !== "refresh") {
      operationError.current = null;
      setError(null);
    }
    setNotice("");
    try {
      if (!(await verify(false, !readOrDelete)) || !current(epoch)) {
        if (["upload", "file-retry"].includes(key) && alive(epoch)) {
          operationError.current = problem({
            code: "UNAVAILABLE",
            message:
              key === "upload"
                ? "계정 확인이 끝나면 선택한 자료의 업로드를 다시 시도해 주세요."
                : "자료 처리 요청을 보내지 못했어요. 계정 확인 후 다시 시도해 주세요.",
          });
          setError(operationError.current);
        }
        return;
      }
      await action(epoch);
    } catch (cause) {
      if (!alive(epoch)) return;
      // A focus-triggered reload must not erase an unsuccessful mutation's error.
      operationError.current = readOrDelete ? null : problem(cause);
      let resource = false;
      if (problem(cause).code === "NOT_FOUND") {
        try {
          const next = await readView();
          if (!(await verify()) || !current(epoch)) return;
          apply(next);
          resource = true;
        } catch (accessError) {
          showError(accessError);
          return;
        }
      }
      const nextError = showError(cause, resource);
      if (
        key.startsWith("update-") &&
        ["CONFLICT", "VALIDATION_ERROR", "FILE_REJECTED"].includes(nextError.code)
      )
        preparationAttempt.current = null;
      if (!readOrDelete && alive(epoch)) operationError.current = nextError;
      if (nextError.code === "CONFLICT") {
        sendAttempt.current = null;
        if (key === "send") {
          queuedUpload.current = null;
          setQueuedSend(false);
        }
        await load();
        if (alive(epoch)) setError(nextError);
      }
    } finally {
      if (alive(epoch)) {
        lock.current = false;
        setBusy("");
      }
    }
  }
  async function refreshPreparation(target: "timeline" | "actions") {
    if (readonly || lock.current || !view || view.case.schemaVersion !== "2") return;
    await run(`update-${target}`, async (epoch) => {
      const snapshot = await api.workspace.get(caseId);
      if (!(await verify()) || !current(epoch)) return;
      apply(snapshot);
      if (
        snapshot.case.stage !== "active" ||
        snapshot.messages.some((message) => message.status === "pending")
      )
        return;
      const label = target === "timeline" ? "타임라인" : "다음 행동";
      if (preparationAttempt.current?.target !== target)
        preparationAttempt.current = {
          target,
          request: {
            expectedRevision: snapshot.case.revision,
            text: `최근 대화와 처리된 자료를 반영해 ${label}을 업데이트해 주세요. 기존에 정리된 항목과 완료한 행동, 직접 수정한 내용은 유지하고, 중복 없이 새로 확인된 내용과 필요한 준비만 추가해 주세요.${target === "actions" ? " 자료에서 수행 완료가 확인되는 기존 행동은 완료로 표시해 주세요. 단순 업로드나 예정·진행 중 상태는 완료로 판단하지 마세요." : ""} 근거가 부족한 날짜나 사실은 추측하지 마세요.`,
            selectedFileIds: snapshot.files
              .filter((file) => file.status === "ready")
              .map((file) => file.id),
          },
        };
      const next = await api.workspace.sendMessage(caseId, preparationAttempt.current.request);
      if (!(await verify()) || !current(epoch)) return;
      apply(next);
      preparationAttempt.current = null;
      if (target === "timeline") setNotice(`${label}에 최신 내용을 반영하도록 요청했어요.`);
    });
  }
  async function toggleAction(actionId: string, done: boolean) {
    if (
      readonly ||
      lock.current ||
      !view ||
      view.messages.some((message) => message.status === "pending")
    )
      return;
    const previous = view;
    await run(actionId, async (epoch) => {
      apply({
        ...view,
        actions: view.actions.map((item) => (item.id === actionId ? { ...item, done } : item)),
      });
      try {
        const next = await api.workspace.setAction(caseId, actionId, done);
        if (!(await verify()) || !current(epoch)) return;
        apply(next);
      } catch (cause) {
        if (current(epoch)) apply(previous);
        throw cause;
      }
    });
  }
  async function saveConversationReport(reportId: string | null, revision: number | null) {
    if (!reportId || revision === null)
      throw new ApiError("NOT_FOUND", "저장할 리포트를 먼저 준비하고 검토해 주세요.");
    const epoch = ticket();
    if (!(await verify(false, false)) || !current(epoch))
      throw new ApiError("UNAUTHENTICATED", "현재 계정으로 다시 확인해 주세요.");
    const session = await api.session.get();
    if (!session.user || !current(epoch))
      throw new ApiError("UNAUTHENTICATED", "이용 계정이 바뀌었어요.");
    await downloadReviewedReport({
      caseId,
      reportId,
      reportRevision: revision,
      expectedOwner: session.user.id,
      verify: async () =>
        mounted.current && current(epoch) && (await verify(false, false)) && current(epoch),
    });
  }
  async function retryFile(fileId: string) {
    await run("file-retry", async (epoch) => {
      let accepted = false;
      try {
        await api.files.retry(
          caseId,
          fileId,
          () => {
            accepted = true;
            if (!alive(epoch)) return;
            setAcceptedFileRetries((ids) => (ids.includes(fileId) ? ids : [...ids, fileId]));
            setNotice("자료 처리 요청이 접수됐어요. 최신 상태를 확인하고 있어요.");
          },
          { metadataOnly: true },
        );
      } catch (cause) {
        if (accepted && alive(epoch))
          setNotice(
            "자료 처리 요청은 접수됐지만 최신 상태를 확인하지 못했어요. 새로고침으로 확인해 주세요.",
          );
        throw cause;
      }
      if (!alive(epoch)) return;
      const next = await load();
      if (!alive(epoch)) return;
      setNotice(
        next
          ? "자료 처리 요청이 접수됐어요. 아래에서 처리 상태를 확인할 수 있어요."
          : "자료 처리 요청은 접수됐지만 최신 상태를 확인하지 못했어요. 새로고침으로 확인해 주세요.",
      );
    });
  }
  function chooseAttachments(files: File[]) {
    if (lock.current || queuedSend || view?.case.stage !== "active") return;
    try {
      const chosen = [...localAttachments];
      for (const file of files) {
        validateUpload(file);
        if (
          !chosen.some(
            (item) =>
              item.name === file.name &&
              item.size === file.size &&
              item.lastModified === file.lastModified,
          )
        )
          chosen.push(file);
      }
      if (chosen.length + chatAttachments.length + selected.length > V2_LIMITS.originalCount)
        throw { code: "VALIDATION_ERROR", message: "한 번에 첨부할 파일은 100개 이하여야 해요." };
      setLocalAttachments(chosen);
      setUploadConsent(false);
    } catch (cause) {
      showError(cause, true);
    }
  }
  function openUploadChooser() {
    uploadChooserScope.current = `${caseId}:${ticket()}`;
    uploadInput.current?.click();
  }
  async function chooseConversationAttachments(files: File[]) {
    const epoch = ticket();
    if (!(await verify(false, true)) || !current(epoch) || !mounted.current) return;
    chooseAttachments(files);
    draftInput.current?.focus();
  }
  async function openConversationFile(fileId: string, origin?: HTMLElement) {
    const confirmEpoch = ticket();
    const file = view?.files.find((file) => file.id === fileId);
    if (!file) {
      showError({ code: "NOT_FOUND", message: "자료가 삭제됐거나 현재 확인할 수 없어요." }, true);
      return;
    }
    if (
      reviewBusy.current ||
      (preview?.id !== file.id &&
        reviewDirty.current &&
        !(await confirmAction(
          "저장하지 않은 교정 내용이 있어요. 내용을 버리고 다른 자료를 열까요?",
        )))
    )
      return;
    if (!current(confirmEpoch) || !mounted.current) return;
    origin?.focus();
    reviewOrigin.current = origin ?? null;
    void run("file-preview", async () => {
      if (tab === "chat") setMaterialsOpen(true);
      setPreview(file);
      setOriginal(null);
    });
  }
  async function send(event: SyntheticEvent) {
    event.preventDefault();
    if (
      readonly ||
      !view ||
      lock.current ||
      messageTooLong ||
      view.messages.some((message) => message.status === "pending") ||
      (!draft.trim() && !selected.length && !localAttachments.length && !chatAttachments.length)
    )
      return;
    if (localAttachments.length) {
      if (!uploadConsent) return;
      if (!queuedUpload.current) {
        let prepared = false;
        await run("queue-prepare", async (epoch) => {
          const [item, progress] = await Promise.all([
            api.cases.get(caseId),
            api.rework.getConversationProgress(caseId),
          ]);
          const state = progress.state;
          if (!(await verify(false, true)) || !current(epoch)) return;
          queuedUpload.current = beginConversationUpload(
            view,
            item,
            state,
            epoch,
            draft.trim() || materialReflectionRequest,
            [...new Set([...selected, ...chatAttachments.map((f) => f.id)])],
          );
          prepared = true;
        });
        if (!prepared) return;
      }
      setQueuedSend(!!queuedUpload.current);
      const complete = await upload(localAttachments);
      if (!complete) setQueuedSend(false);
      else if (!queuedUpload.current)
        setNotice(
          "자료는 저장했어요. 불러온 사건 범위를 확인한 뒤 보존한 입력을 직접 보내 주세요.",
        );
      return;
    }
    if (
      chatAttachments.some(
        (file) =>
          file.status !== "ready" ||
          !view.files.some((item) => item.id === file.id && item.status === "ready"),
      )
    ) {
      setQueuedSend(true);
      return;
    }
    const text = draft.trim() || materialReflectionRequest;
    const fileIds = [...new Set([...selected, ...chatAttachments.map((file) => file.id)])];
    followingChat.current = true;
    await run("send", async (epoch) => {
      let revision = view.case.revision;
      if (queuedUpload.current && !sendAttempt.current) {
        const queue = queuedUpload.current;
        // Review can wait for a large photo's canonical observations. Capture
        // the final workspace revision only after that IO and its access checks.
        const reviewed = new Map<string, FileView["revision"]>();
        for (const id of fileIds) {
          if (queue.files.get(id)?.status === "ready") continue;
          const review = await api.files.review(caseId, id);
          if (!(await verify(false, true)) || !current(epoch)) return;
          if (
            !review.pendingReview &&
            review.nextAfterOrdinal === null &&
            review.observations.every(
              (o) => uploadCanonical(o.value) === uploadCanonical(o.original),
            )
          )
            reviewed.set(id, review.file.revision);
        }
        const progress = await api.rework.getConversationProgress(caseId);
        const state = progress.state;
        if (
          progress.reportContinuation !== null ||
          ["pending", "running"].includes(state.analysis.status) ||
          state.report.status === "pending"
        ) {
          if (!(await verify(false, true)) || !current(epoch)) return;
          setAgentBusy(true);
          // Notify the existing reader once; skip the two workspace/case reads
          // while completion is unconfirmed. This creates no new admission.
          setConversationRefresh((value) => value + 1);
          setNotice("사건과 리포트 준비의 완료 확인을 기다려요. 입력과 자료는 보존돼요.");
          return;
        }
        const [fresh, item] = await Promise.all([api.workspace.get(caseId), api.cases.get(caseId)]);
        if (!(await verify(false, true)) || !current(epoch)) return;
        // A newer W never authorizes an older file review. Keep the exact
        // reviewed revision, frozen source checks and the final server CAS.
        const processed = new Set<string>();
        for (const [id, revision] of reviewed)
          if (revision === fresh.files.find((file) => file.id === id)?.revision) processed.add(id);
        const decision = queuedConversationUpload(
          queue,
          fresh,
          item,
          state,
          epoch,
          text,
          fileIds,
          processed,
          false,
        );
        if (decision === "changed")
          throw new ApiError(
            "CONFLICT",
            "자료를 준비하는 동안 사건이나 입력이 바뀌었어요. 최신 내용과 보존한 입력을 확인해 주세요.",
          );
        apply(fresh);
        if (decision === "waiting") {
          setAgentBusy(true);
          setNotice("자료는 보존돼요. 현재 사건 준비가 끝나면 같은 입력을 이어 보낼게요.");
          return;
        }
        revision = fresh.case.revision;
      }
      setQueuedSend(false);
      if (
        !sendAttempt.current ||
        sendAttempt.current.text !== text ||
        JSON.stringify(sendAttempt.current.selectedFileIds) !== JSON.stringify(fileIds)
      )
        sendAttempt.current = {
          expectedRevision: revision,
          text,
          selectedFileIds: fileIds,
        };
      const next = await api.workspace.sendMessage(caseId, sendAttempt.current);
      if (!(await verify()) || !current(epoch)) return;
      apply(next);
      sendAttempt.current = null;
      queuedUpload.current = null;
      setDraft("");
      setSelected([]);
      setChatAttachments([]);
    });
  }
  async function sendLookup(request: V2LookupRequest) {
    if (
      !lookupAvailable ||
      readonly ||
      !view ||
      view.case.schemaVersion !== "2" ||
      lock.current ||
      view.messages.some((message) => message.status === "pending")
    )
      return false;
    let accepted = false;
    await run("lookup", async (epoch) => {
      lookupAttempt.current ??= {
        expectedRevision: view.case.revision,
        text: `${({ hometax_status: "국세청 사업자 상태", thecheat: "더치트 피해 등록", datahub_property: "데이터허브 부동산 주소", datahub_building: "데이터허브 건축물대장" } as const)[request.tool]} 조회를 요청합니다. 별도로 입력하고 전송에 동의한 대상만 조회해 주세요.`,
        selectedFileIds: [],
        lookupRequests: [request],
      };
      const next = await api.workspace.sendMessage(caseId, lookupAttempt.current);
      if (!(await verify()) || !current(epoch)) return;
      apply(next);
      lookupAttempt.current = null;
      followingChat.current = true;
      setNotice("조회 요청을 저장했어요. 실제 결과와 연결 상태는 대화에서 확인해 주세요.");
      accepted = true;
    });
    return accepted;
  }
  async function reflectMaterial(fileId: string) {
    if (reviewDirty.current || reviewBusy.current) return;
    await run("reflect-material", async (epoch) => {
      const currentView = await api.workspace.get(caseId);
      if (!(await verify(false, true)) || !current(epoch)) return;
      const text = materialReflectionRequest;
      if (
        !sendAttempt.current ||
        sendAttempt.current.selectedFileIds[0] !== fileId ||
        sendAttempt.current.text !== text
      )
        sendAttempt.current = {
          expectedRevision: currentView.case.revision,
          text,
          selectedFileIds: [fileId],
        };
      const next = await api.workspace.sendMessage(caseId, sendAttempt.current);
      if (!(await verify()) || !current(epoch)) return;
      sendAttempt.current = null;
      if (tab === "chat") {
        apply(next);
        setPreview(null);
        setOriginal(null);
        setNotice(
          "자료 내용을 대화에 반영하고 있어요. 확인된 결과가 나오면 이어서 검토할 수 있어요.",
        );
      } else window.location.assign(base);
    });
  }
  async function upload(files: FileList | File[] | null, forConversation = tab === "chat") {
    if (
      (tab === "chat" && !uploadConsent) ||
      view?.case.stage !== "active" ||
      lock.current ||
      !files?.length
    )
      return;
    uploadForConversation.current = forConversation;
    const chosen = Array.from(files);
    let complete = false;
    const uploadEpoch = ticket();
    const startedAt = Date.now();
    const first = chosen[0];
    if (!first) return;
    setUploadProgress({
      startedAt,
      fileName: first.name,
      index: 1,
      total: chosen.length,
      value: { stage: "checking_access", completedBytes: 0, totalBytes: first.size },
    });
    // Preserve choices on a failed/superseded preflight, just like a failed upload.
    // An actual owner/role change still clears them through purge().
    setRetryUploads(chosen);
    await run("upload", async (epoch) => {
      let completed = 0;
      let refreshed = false;
      try {
        for (const file of chosen) {
          if (!current(epoch)) return;
          const uploaded = await api.files.upload(
            caseId,
            file,
            (value) => {
              if (current(epoch))
                setUploadProgress({
                  startedAt,
                  fileName: file.name,
                  index: completed + 1,
                  total: chosen.length,
                  value,
                });
            },
            { metadataOnly: true },
          );
          if (!alive(epoch)) return;
          completed++;
          if (forConversation) {
            if (queuedUpload.current) {
              if (!queuedUpload.current.ids.includes(uploaded.id))
                queuedUpload.current.ids.push(uploaded.id);
              queuedUpload.current.files.set(uploaded.id, { ...uploaded });
            }
            setChatAttachments((items) => [
              ...items.filter((item) => item.id !== uploaded.id),
              uploaded,
            ]);
          }
          setLocalAttachments((items) => items.filter((item) => item !== file));
          // The upload API already checked this exact file after its ACK. A
          // later whole-workspace read failure must never resend accepted files.
          setRetryUploads(chosen.slice(completed));
          setUploadReadbackPending(true);
        }
        // Each accepted upload already has an authorized readback. Refresh the
        // workspace once per batch, rather than delaying every following file.
        if (tab === "chat" && queuedUpload.current) setConversationRefresh((value) => value + 1);
        else refreshed = Boolean(await load());
        if (!alive(epoch)) return;
        if (!refreshed)
          setNotice("자료는 접수됐지만 최신 목록을 확인하지 못했어요. 새로고침으로 확인해 주세요.");
        if (!current(epoch)) return;
        setRetryUploads([]);
        complete = true;
        if (refreshed)
          setNotice("자료를 저장했어요. 처리 상태와 확인 가능한 범위를 확인해 주세요.");
      } catch (cause) {
        if (!current(epoch)) return;
        // A definitive format rejection needs a changed file. Preserve only
        // later selections; ambiguous responses retain the exact same input.
        const rejected = problem(cause).code === "FILE_REJECTED";
        setRetryUploads(chosen.slice(completed + (rejected ? 1 : 0)));
        if (rejected)
          setLocalAttachments((items) => items.filter((item) => item !== chosen[completed]));
        if (completed > 0) {
          await load();
          if (!alive(epoch)) return;
        }
        throw cause;
      }
    });
    if (alive(uploadEpoch)) {
      setUploadProgress(null);
      if (uploadInput.current) uploadInput.current.value = "";
    }
    return complete;
  }
  async function startEntry() {
    if (!view || readonly) return;
    const begin = (revision: number) =>
      setEntry({
        date: "",
        datePrecision: "day",
        title: "",
        detail: "",
        expectedRevision: revision,
      });
    if (!acknowledgedTimeline.current) {
      begin(view.case.revision);
      return;
    }
    // Closing an acknowledged write's recovery dialog does not erase its need
    // for a verified read. A new draft must start from that refreshed snapshot.
    await run("refresh", async (epoch) => {
      const next = await load();
      if (next && current(epoch)) begin(next.case.revision);
    });
  }
  async function closeDialog() {
    const confirmEpoch = ticket();
    if (busy || reviewBusy.current) return false;
    if (
      reviewDirty.current &&
      !(await confirmAction("저장하지 않은 교정 내용이 있어요. 내용을 버리고 닫을까요?"))
    )
      return false;
    if (!current(confirmEpoch) || !mounted.current) return false;
    reviewDirty.current = false;
    setTimelineRecovery(false);
    setPreview(null);
    setDeleteFile(null);
    setEntry(null);
    setOriginal(null);
    if (tab === "chat")
      requestAnimationFrame(() => {
        const origin = reviewOrigin.current;
        if (origin?.isConnected && origin.getClientRects().length)
          origin.focus({ preventScroll: true });
      });
    return true;
  }
  async function saveEntry(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readonly || !entry || timelineEventLength(entry) > 2000) return;
    const values = new FormData(event.currentTarget);
    await run("timeline", async (epoch) => {
      if (acknowledgedTimeline.current) {
        await load();
        return;
      }
      const next = await api.workspace.saveTimeline(caseId, {
        ...(entry?.id ? { id: entry.id } : {}),
        expectedRevision: entry.expectedRevision,
        date:
          !entry?.date || entry.datePrecision === "unknown"
            ? ""
            : entry.datePrecision === "year"
              ? `${entry.date.slice(0, 4)}-01-01`
              : entry.datePrecision === "month"
                ? `${entry.date.slice(0, 7)}-01`
                : entry.date,
        datePrecision: !entry?.date ? "unknown" : (entry.datePrecision ?? "day"),
        title: String(values.get("title") ?? "").trim(),
        detail: String(values.get("detail") ?? "").trim(),
      });
      acknowledgedTimeline.current = true;
      setTimelineRecovery(true);
      if (!(await verify()) || !current(epoch)) return;
      acknowledgedTimeline.current = false;
      setTimelineRecovery(false);
      apply(next);
      setEntry(null);
      setNotice("타임라인을 저장했어요.");
    });
  }

  const base = `/cases/${encodeURIComponent(caseId)}`;
  const readyFiles = view?.files.filter((file) => file.status === "ready") ?? [];
  const evidenceIds = new Set(
    [
      ...(view?.facts?.flatMap((fact) => fact.references) ?? []),
      ...(view?.messages
        .filter((message) => message.role === "assistant" && message.status === "complete")
        .flatMap((message) => message.references ?? []) ?? []),
    ].flatMap((ref) => (ref.kind === "user_material" ? [ref.fileId] : [])),
  );
  const pendingResponse = view?.messages.some((message) => message.status === "pending");
  const missingRequirements =
    ready &&
    conversationState?.snapshot &&
    !["stale", "pending", "running"].includes(conversationState.analysis.status)
      ? evidenceRequirementStates(
          conversationState.snapshot.evidenceRequirements,
          view?.files ?? [],
          view?.facts ?? [],
        )
          .filter((item) => item.status !== "linked")
          .map((item) => item.requirement)
      : [];

  function loadHistory(collection: "messages" | "actions" | "timeline") {
    void run("history", async (epoch) => {
      const next = await api.workspace.loadMore(caseId, collection);
      if (!(await verify()) || !current(epoch)) return;
      if (collection === "messages" && chatMessages.current) {
        followingChat.current = false;
        historyAnchor.current = {
          top: chatMessages.current.scrollTop,
          height: chatMessages.current.scrollHeight,
        };
      }
      apply(next, false);
    });
  }
  function readOriginal() {
    if (!preview) return;
    void run("original", async (epoch) => {
      const blob = await api.files.original(caseId, preview.id);
      if (!(await verify()) || !current(epoch)) return;
      const type = blob.type === "application/octet-stream" ? preview.mimeType : blob.type;
      const safe =
        /^(image\/(png|jpeg|webp|gif|bmp)|audio\/(mpeg|mp4|x-m4a|wav|x-wav|ogg|webm)|video\/(mp4|webm|ogg))$/.test(
          type,
        );
      if (safe) {
        const url = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("원본 미리보기를 불러오지 못했어요."));
          reader.readAsDataURL(new Blob([blob], { type }));
        });
        if (!(await verify()) || !current(epoch)) return;
        setOriginal({ url, type });
      } else download(blob, preview.name);
      setNotice(
        safe ? "원본 미리보기를 불러왔어요." : "원본을 내려받았어요. 파일을 열어 확인하세요.",
      );
    });
  }
  function downloadOriginal() {
    if (!preview) return;
    void run("original", async (epoch) => {
      const blob = await api.files.original(caseId, preview.id);
      if (!(await verify()) || !current(epoch)) return;
      download(blob, preview.name);
      setNotice("원본을 내려받았어요. 파일을 열어 확인하세요.");
    });
  }
  function retryMessage(messageId: string) {
    void run("chat-retry", async (epoch) => {
      const next = await api.workspace.retryMessage(caseId, messageId);
      if (!(await verify()) || !current(epoch)) return;
      apply(next);
      setNotice("응답을 다시 요청했어요.");
    });
  }
  function deleteSelectedFile() {
    if (!deleteFile) return;
    void run("delete", async (epoch) => {
      await api.files.remove(caseId, deleteFile.id);
      if (!(await verify()) || !current(epoch)) return;
      await load();
      if (!(await verify()) || !current(epoch)) return;
      setDeleteFile(null);
      setNotice("자료를 삭제했어요.");
    });
  }
  function changeTimelinePrecision(value: string) {
    if (!entry) return;
    const precision = value as NonNullable<TimelineView["datePrecision"]>;
    setEntry({
      ...entry,
      datePrecision: precision,
      date: timelineDateInput(entry.date ?? "", precision, entry.datePrecision),
    });
  }

  return {
    caseId,
    tab,
    lookupAvailable,
    view,
    setContextRequested,
    contextLoaded,
    progressiveIds,
    incomingActionMessages,
    conversationRequest,
    setConversationRequest,
    setAgentBusy,
    materialsOpen,
    setMaterialsOpen,
    materialsRequest,
    composerMenu,
    composerTrigger,
    conversationState,
    setConversationState,
    openMaterials,
    error,
    busy,
    draft,
    setDraft,
    draftComposing,
    messageTooLong,
    selected,
    setSelected,
    localAttachments,
    setLocalAttachments,
    chatAttachments,
    setChatAttachments,
    queuedSend,
    setQueuedSend,
    queuedUpload,
    conversationRefresh,
    setConversationRefresh,
    notice,
    setNotice,
    uploadReadbackPending,
    preview,
    deleteFile,
    setDeleteFile,
    entry,
    setEntry,
    original,
    uploadConsent,
    setUploadConsent,
    uploadForConversation,
    retryUploads,
    setRetryUploads,
    acceptedFileRetries,
    uploadProgress,
    lookupOpen,
    setLookupOpen,
    lookupAttempt,
    uploadInput,
    uploadChooserScope,
    dialog,
    reviewState,
    fileReviewBusyChanged,
    fileReviewDirtyChanged,
    followingChat,
    pauseReplyFollowing,
    chatMessages,
    draftInput,
    timelineRecovery,
    ready,
    canMutate,
    verify,
    ticket,
    current,
    readonly,
    privateContent,
    followReply,
    finishReply,
    fileReviewError,
    load,
    run,
    refreshPreparation,
    toggleAction,
    saveConversationReport,
    retryFile,
    chooseAttachments,
    openUploadChooser,
    chooseConversationAttachments,
    openConversationFile,
    send,
    sendLookup,
    reflectMaterial,
    upload,
    startEntry,
    closeDialog,
    saveEntry,
    base,
    readyFiles,
    evidenceIds,
    pendingResponse,
    missingRequirements,
    loadHistory,
    readOriginal,
    downloadOriginal,
    retryMessage,
    deleteSelectedFile,
    changeTimelinePrecision,
    conversationClient: api.rework,
  };
}
export type WorkspaceController = ReturnType<typeof useWorkspaceController>;
