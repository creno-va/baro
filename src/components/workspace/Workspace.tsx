import {
  ArrowRight,
  CheckCheck,
  ChevronDown,
  Clock3,
  FileText,
  LoaderCircle,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  Upload,
  X,
} from "lucide-react";
import {
  lazy,
  Suspense,
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
import { startForegroundPolling } from "../../client/foreground-poll";
import { accessHref } from "../../client/return-path";
import {
  V2_LIMITS,
  type V2ConversationIntent,
  type V2ConversationState,
  type V2FactReference,
  type V2LookupRequest,
  type V2MessageRequest,
} from "../../contracts/v2";
import { CaseDetail } from "../analysis/CaseDetail";
import { useCustomerAccess } from "../intake/useCustomerAccess";
import { downloadReviewedReport } from "../reports/download-reviewed";
import type { ReportQuestionContext } from "../reports/ReportReview";
import { FollowUpResolution } from "../resolution/FollowUpResolution";
import { BrandMark } from "../ui/brand";
import { CaseWorkspaceFrame } from "../ui/workspace-frame";
import { MaterialsPanel } from "./MaterialsPanel";
import "../../styles/workspace-conversation.css";
import "../../styles/reports.css";
import { Button, ButtonLink } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { CaseMaterials } from "./CaseMaterials";
import { CaseNavigation, type CaseTask } from "./CaseNavigation";
import { ChatAttachments } from "./ChatAttachments";
import {
  ConversationAgent,
  type ConversationPane,
  type ConversationPaneProps,
} from "./ConversationAgent";
import { ConversationPreparation } from "./ConversationPreparation";
import { ConversationReconfirmation } from "./ConversationReconfirmation";
import {
  beginConversationUpload,
  type ConversationUpload,
  queuedConversationUpload,
  uploadCanonical,
} from "./conversation-upload";
import { ElapsedTime } from "./ElapsedTime";
import { EvidencePicker } from "./EvidencePicker";
import { EvidenceRequirements } from "./EvidenceRequirements";
import { FileReview } from "./FileReview";
import { LookupDialog } from "./LookupDialog";
import { ProgressiveReply } from "./ProgressiveReply";
import { uploadProgressLabel } from "./processing-progress";
import { SourceCards } from "./SourceCards";
import { referenceLabel, timelineDateLabel } from "./source-label";
import { TimelineEvidence } from "./TimelineEvidence";
import { timelineDateInput, timelineEventLength } from "./timeline-draft";

export type WorkspaceTab = "chat" | "files" | "timeline" | "actions";
const RetainedReportReview = lazy(() =>
  import("../reports/ReportReview").then((module) => ({ default: module.ReportReview })),
);
const tabLabels = { chat: "대화", files: "자료", timeline: "타임라인", actions: "다음 행동" };
const materialReflectionRequest =
  "선택한 자료에서 읽은 정보를 먼저 요약하고, 근거가 있는 사실·관련 인물·타임라인에 반영해 주세요. 거래 자료라면 거래일자와 송금일시, 플랫폼·은행, 금액, 거래 상태를 각각 구분하고 계좌는 확인되는 끝 4자리만 표시해 주세요. 기존 내용과 다른 점을 설명하고, 이미 나온 정보는 다시 묻지 말고 자료만으로 확인되지 않는 내용만 알려 주세요. 원문에 없는 내용은 추측하지 마세요.";
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

type WorkspaceProps = {
  caseId: string;
  tab?: WorkspaceTab;
  initialTask?: CaseTask;
  lookupAvailable?: boolean;
};
export function Workspace(props: WorkspaceProps) {
  return <WorkspaceContent key={props.caseId} {...props} />;
}
function WorkspaceContent({
  caseId,
  tab: initialTab = "chat",
  initialTask,
  lookupAvailable = false,
}: WorkspaceProps) {
  const [tab, setTab] = useState<WorkspaceTab>(initialTask === "files" ? "files" : initialTab);
  const [activeTask, setActiveTask] = useState<CaseTask | null>(
    initialTask ?? (initialTab === "chat" || initialTab === "files" ? initialTab : null),
  );
  const [chatVisited, setChatVisited] = useState(
    initialTask ? initialTask === "chat" : initialTab === "chat",
  );
  const [filesVisited, setFilesVisited] = useState(
    initialTask === "files" || initialTab === "files",
  );
  const [reportVisited, setReportVisited] = useState(
    initialTask === "reports" || initialTask === "drafts",
  );
  const [reportSection, setReportSection] = useState<"report" | "drafts">(
    initialTask === "drafts" ? "drafts" : "report",
  );
  const [reportQuestion, setReportQuestion] = useState<ReportQuestionContext | null>(null);
  const [reportDirty, setReportDirty] = useState(false);
  const taskScroll = useRef(new Map<string, number>());
  const activeTaskRef = useRef(activeTask);
  activeTaskRef.current = activeTask;
  const root = useRef<HTMLDivElement>(null);
  const navigateTask = useCallback(
    (next: CaseTask, history: "push" | "none" = "push") => {
      const scroller = root.current?.querySelector<HTMLElement>(".case-workspace__content");
      if (scroller) taskScroll.current.set(activeTask ?? tab, scroller.scrollTop);
      if (next === "chat") {
        setChatVisited(true);
        setContextRequested(true);
        setTab("chat");
      } else if (next === "files") {
        setFilesVisited(true);
        setTab("files");
      } else {
        setReportVisited(true);
        setReportSection(next === "drafts" ? "drafts" : "report");
      }
      setActiveTask(next);
      if (history === "push") {
        const base = `/cases/${encodeURIComponent(caseId)}`;
        const url = new URL(window.location.href);
        const reportSearch = url.pathname === `${base}/reports` ? url.search : "?mode=conversation";
        const destination =
          next === "chat"
            ? base
            : next === "files"
              ? `${base}/files`
              : `${base}/reports${reportSearch}${next === "drafts" ? "#document-drafts" : ""}`;
        if (`${url.pathname}${url.search}${url.hash}` !== destination)
          window.history.pushState(
            { ...window.history.state, baroCaseTask: next, baroCaseId: caseId },
            "",
            destination,
          );
      }
    },
    [activeTask, tab, caseId],
  );
  useLayoutEffect(() => {
    const scroller = root.current?.querySelector<HTMLElement>(".case-workspace__content");
    if (scroller) scroller.scrollTop = taskScroll.current.get(activeTask ?? tab) ?? 0;
  }, [activeTask, tab]);
  const locationInitialized = useRef(false);
  useEffect(() => {
    if (!locationInitialized.current) {
      locationInitialized.current = true;
      if (window.location.hash === "#document-drafts") navigateTask("drafts", "none");
    }
    const pop = () => {
      const base = `/cases/${encodeURIComponent(caseId)}`;
      const path = window.location.pathname;
      const task =
        path === base
          ? "chat"
          : path === `${base}/files`
            ? "files"
            : path === `${base}/reports`
              ? window.location.hash === "#document-drafts"
                ? "drafts"
                : "reports"
              : null;
      if (task) navigateTask(task, "none");
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [caseId, navigateTask]);
  const [view, setView] = useState<CustomerWorkspaceView | null>(null);
  const [contextRequested, setContextRequested] = useState(
    initialTask !== "files" && initialTab !== "files",
  );
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
  const [conversationState, setConversationState] = useState<V2ConversationState | null>(null);
  const openMaterials = useCallback(() => navigateTask("files"), [navigateTask]);
  const [error, setError] = useState<ReturnType<typeof problem> | null>(null);
  const [busy, setBusy] = useState("");
  const [draft, setDraft] = useState("");
  const draftComposing = useRef(false);
  const questionContext = reportQuestion
    ? `리포트의 ‘${reportQuestion.sectionTitle}’에서 읽은 내용입니다. 아래 발췌는 질문을 위한 맥락이며 확인된 사실로 단정하지 않습니다.\n${reportQuestion.excerpt}\n\n`
    : "";
  const messageText = `${questionContext}${draft.trim()}`.trim();
  const messageTooLong = [...messageText].length > 10000;
  const [selected, setSelected] = useState<string[]>([]);
  const [localAttachments, setLocalAttachments] = useState<File[]>([]);
  const [chatAttachments, setChatAttachments] = useState<FileView[]>([]);
  const [queuedSend, setQueuedSend] = useState(false);
  const queuedUpload = useRef<ConversationUpload | null>(null);
  const [conversationRefresh, setConversationRefresh] = useState(0);
  const [notice, setNotice] = useState("");
  const [leaveTarget, setLeaveTarget] = useState<string | null>(null);
  const leaveApproved = useRef(false);
  const [uploadReadbackPending, setUploadReadbackPending] = useState(false);
  const [preview, setPreview] = useState<FileView | null>(null);
  const [sourceReference, setSourceReference] = useState<
    Extract<V2FactReference, { kind: "user_material" }> | undefined
  >();
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
  const dialog = useRef<HTMLDialogElement>(null);
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
    setReportVisited(false);
    setReportDirty(false);
    setReportQuestion(null);
    setLeaveTarget(null);
    leaveApproved.current = false;
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
    setSourceReference(undefined);
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
    dialog.current?.close();
  }, []);
  const access = useCustomerAccess(purge, (cause) => setError(problem(cause)), true);
  const { ready, canMutate, version, verify, ticket, current, alive, deny } = access;
  const readonly =
    !ready ||
    !canMutate ||
    view?.case.stage !== "active" ||
    agentBusy ||
    (activeTask === "chat" && !contextLoaded);
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
    if (activeTaskRef.current !== "chat") return;
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
    if (!messageText && !localAttachments.length && !chatAttachments.length && !selected.length)
      return;
    const warn = (event: BeforeUnloadEvent) => {
      if (leaveApproved.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [messageText, localAttachments.length, chatAttachments.length, selected.length]);
  const hasUnstoredWork =
    !!messageText ||
    localAttachments.length > 0 ||
    chatAttachments.length > 0 ||
    selected.length > 0 ||
    reportDirty ||
    reviewState.dirty;
  useEffect(() => {
    const navigate = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link =
        event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self"))
        return;
      const url = new URL(link.href, window.location.href);
      if (!["https:", "http:"].includes(url.protocol)) return;
      const base = `/cases/${encodeURIComponent(caseId)}`;
      if (url.origin === window.location.origin) {
        const task =
          url.pathname === base
            ? "chat"
            : url.pathname === `${base}/files` && !url.search
              ? "files"
              : url.pathname === `${base}/reports`
                ? url.hash === "#document-drafts"
                  ? "drafts"
                  : "reports"
                : null;
        if (task) {
          event.preventDefault();
          navigateTask(task);
          return;
        }
        if (
          url.pathname === window.location.pathname &&
          url.search === window.location.search &&
          url.hash
        )
          return;
      }
      if (!hasUnstoredWork) return;
      event.preventDefault();
      setLeaveTarget(url.href);
    };
    document.addEventListener("click", navigate);
    return () => document.removeEventListener("click", navigate);
  }, [caseId, hasUnstoredWork, navigateTask]);
  const latestMessage = view?.messages.at(-1);
  const latestMessageContent = latestMessage
    ? `${latestMessage.id}:${latestMessage.status}:${latestMessage.text}`
    : "";
  useEffect(() => {
    if (tab !== "chat" || !latestMessageContent) return;
    followReply();
  }, [latestMessageContent, tab, followReply]);
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
  function renderConversationPane(pane: ConversationPane, props: ConversationPaneProps) {
    if (!view) return null;
    if (pane === "reconfirmation")
      return (
        <ConversationReconfirmation
          caseId={caseId}
          pane={props}
          access={{ ticket, current, verify }}
        />
      );
    if (pane === "report")
      return (
        <div className="conversation-report-entry">
          <p>
            준비·실행 상태는 이 대화에서 확인할 수 있어요. 전체 내용의 확인·편집·저장은 리포트
            화면에서 이어가세요.
          </p>
          <ButtonLink href={`${base}/reports?mode=conversation`}>리포트 열기</ButtonLink>
        </div>
      );
    if (pane === "materials") return <Button onClick={openMaterials}>자료 패널 열기</Button>;
    if (pane === "preparation")
      return (
        <ConversationPreparation
          view={view}
          disabled={
            props.disabled ||
            readonly ||
            view.messages.some((message) => message.status === "pending")
          }
          onReviewFile={openConversationFile}
          onActionChange={(id, done) => void toggleAction(id, done)}
          onRefresh={(target) => void refreshPreparation(target)}
          history={{
            timeline: historyButton("timeline", "이전 흐름 더 불러오기"),
            actions: historyButton("actions", "이전 행동 더 불러오기"),
          }}
        />
      );
    if (pane === "followup" || pane === "lawyers")
      return (
        <>
          {props.state.report.status !== "ready" && (
            <div className="workspace-error">
              <p>현재 사건 기준의 리포트를 먼저 준비하고 검토하면 해결 방법을 이어갈 수 있어요.</p>
              <Button
                variant="outline"
                disabled={props.disabled}
                onClick={() =>
                  setConversationRequest({ id: crypto.randomUUID(), action: "prepare_report" })
                }
              >
                리포트 준비로 이어가기
              </Button>
            </div>
          )}
          <FollowUpResolution
            caseId={caseId}
            embedded
            {...(props.state.report.id && props.state.report.revision
              ? { reportId: props.state.report.id, reportRevision: props.state.report.revision }
              : {})}
            disabled={props.readDisabled || props.state.report.status !== "ready"}
            onSaveReport={() =>
              saveConversationReport(props.state.report.id, props.state.report.revision)
            }
            onChanged={() => {
              void props.onChanged();
            }}
            onCancel={props.onCancel}
            onDirtyChange={props.onDirtyChange}
            onBusyChange={props.onBusyChange}
          />
        </>
      );
    return null;
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
  function historyButton(collection: "messages" | "actions" | "timeline", label: string) {
    if (!view?.pagination?.[collection]) return null;
    return (
      <div className="workspace-buttons">
        <p className="workspace-muted">
          불러온 기록 {view[collection].length}개 · 나머지 기록을 이어서 확인할 수 있어요.
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={!!busy}
          onClick={() =>
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
            })
          }
        >
          {label}
        </Button>
      </div>
    );
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
  function openConversationFile(
    fileId: string,
    origin?: HTMLElement,
    reference?: Extract<V2FactReference, { kind: "user_material" }>,
  ) {
    const file = view?.files.find((file) => file.id === fileId);
    if (!file) {
      showError({ code: "NOT_FOUND", message: "자료가 삭제됐거나 현재 확인할 수 없어요." }, true);
      return;
    }
    origin?.focus();
    void run("file-preview", async () => {
      setPreview(file);
      setSourceReference(reference);
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
            messageText || materialReflectionRequest,
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
    const text = messageText || materialReflectionRequest;
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
      setReportQuestion(null);
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
    if (!uploadConsent || view?.case.stage !== "active" || lock.current || !files?.length) return;
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
  function closeDialog() {
    if (busy || reviewBusy.current) return;
    if (
      reviewDirty.current &&
      !window.confirm("저장하지 않은 교정 내용이 있어요. 내용을 버리고 닫을까요?")
    )
      return;
    reviewDirty.current = false;
    setTimelineRecovery(false);
    setPreview(null);
    setSourceReference(undefined);
    setDeleteFile(null);
    setEntry(null);
    setOriginal(null);
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
  const evidenceIds = new Set(
    [
      ...(view?.facts?.flatMap((fact) => fact.references) ?? []),
      ...(view?.messages
        .filter((message) => message.role === "assistant" && message.status === "complete")
        .flatMap((message) => message.references ?? []) ?? []),
    ].flatMap((ref) =>
      ref.kind === "user_material" &&
      view?.files.some(
        (file) =>
          file.id === ref.fileId && file.status === "ready" && file.revision === ref.fileRevision,
      )
        ? [ref.fileId]
        : [],
    ),
  );
  const pendingResponse = view?.messages.some((message) => message.status === "pending");
  const contextSummary = view ? (
    <aside className="workspace-sidebar" aria-label="사건 요약 및 준비 현황" {...privateContent}>
      <details
        className="workspace-context"
        onToggle={(event) => {
          if (event.currentTarget.open && tab === "files") setContextRequested(true);
        }}
      >
        <summary>
          <FileText size={17} />
          <span>사건 요약과 준비 현황</span>
          <ChevronDown size={16} />
        </summary>
        <div className="workspace-context-content">
          {tab === "files" && !contextLoaded ? (
            <p className="workspace-context-notices" role="status">
              사건 요약을 불러오고 있어요…
            </p>
          ) : (
            <>
              <section className="workspace-context-overview">
                <h2>현재까지 정리한 내용</h2>
                <p className="workspace-summary">
                  {view.case.summary || "확인한 요약이 아직 없어요."}
                </p>
                <div className="workspace-summary-review">
                  <ButtonLink href={`${base}/summary?from=${tab}`}>
                    요약 검토하기 <ArrowRight size={16} />
                  </ButtonLink>
                </div>
              </section>
              <section>
                <h2>아직 확인할 내용</h2>
                {view.unknowns?.length ? (
                  <ul className="workspace-facts workspace-unknowns">
                    {view.unknowns.map((unknown) => (
                      <li key={unknown}>{unknown}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="workspace-muted">추가로 확인할 내용이 아직 없어요.</p>
                )}
              </section>
              <section>
                <h2>관련 인물</h2>
                {view.people?.length ? (
                  <ul className="workspace-facts">
                    {view.people.map((person) => (
                      <li key={person.id}>
                        <strong>{person.label}</strong>
                        <p>{person.role}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="workspace-muted">정리된 관련 인물이 아직 없어요.</p>
                )}
              </section>
              <section>
                <h2>준비 현황</h2>
                <p>대화와 자료를 바탕으로 사건의 흐름과 준비할 일을 정리해요.</p>
                <ul className="workspace-preparation-badges" aria-label="준비 현황 바로가기">
                  <li>
                    <a href={`${base}/files`}>
                      자료 <strong>{view.files.length}</strong>
                    </a>
                  </li>
                  <li>
                    <a href={`${base}/timeline`}>
                      타임라인 <strong>{view.timeline.length}</strong>
                    </a>
                  </li>
                  <li>
                    <a href={`${base}/actions`}>
                      남은 다음 행동{" "}
                      <strong>{view.actions.filter((action) => !action.done).length}</strong>
                    </a>
                  </li>
                </ul>
                <CaseMaterials caseId={caseId} files={view.files} facts={view.facts} />
              </section>
              {!!view.notices?.length && (
                <div className="workspace-context-notices">
                  {view.notices.map((notice) => (
                    <p key={notice} className="workspace-muted">
                      {notice}
                    </p>
                  ))}
                </div>
              )}
            </>
          )}
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
      </div>
    </aside>
  ) : null;
  const errorFeedback = error ? (
    <section className="workspace-error" role="alert">
      <strong>{error.message}</strong>
      <p>
        {error.code === "CONFLICT"
          ? "최신 내용을 불러왔어요. 입력은 유지됩니다. 확인한 뒤 다시 저장해 주세요."
          : error.code === "QUOTA_EXCEEDED"
            ? "저장된 사건은 보존돼요. 사용량에서 한도를 확인할 수 있어요."
            : error.code === "FILE_REJECTED"
              ? "수정한 파일을 새로 선택해 주세요. 기존 자료는 목록에서 확인하거나 삭제할 수 있어요."
              : ["UNAUTHENTICATED", "CONSENT_REQUIRED", "NOT_FOUND"].includes(error.code) &&
                  !error.resource
                ? "계정 또는 사건 접근이 바뀌어 이전 내용을 비웠어요."
                : uploadReadbackPending
                  ? "이미 접수된 자료는 다시 업로드하지 않아도 돼요. 새로고침으로 최신 목록을 확인해 주세요."
                  : acceptedFileRetries.length
                    ? "자료 처리 요청은 이미 접수됐어요. 다시 요청하지 말고 새로고침으로 최신 상태를 확인해 주세요."
                    : "입력한 내용은 보존돼요. 확인한 뒤 다시 시도해 주세요."}
      </p>
      <div className="workspace-buttons">
        {error.code === "UNAUTHENTICATED" ? (
          <ButtonLink href={accessHref("login")}>로그인</ButtonLink>
        ) : error.code === "CONSENT_REQUIRED" ? (
          <ButtonLink href={accessHref("consent")}>동의 확인</ButtonLink>
        ) : error.code === "QUOTA_EXCEEDED" ? (
          <ButtonLink href="/settings">사용량 확인</ButtonLink>
        ) : (
          <Button
            variant="outline"
            disabled={!!busy}
            onClick={() =>
              void run("refresh", async (epoch) => {
                if (!(await load())) return;
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
  ) : null;
  const uploadRecovery =
    ready && retryUploads.length > 0 ? (
      <section className="workspace-upload" aria-label="자료 업로드 이어하기">
        <p>업로드가 끝나지 않은 선택 자료가 {retryUploads.length}개 있어요.</p>
        <div className="workspace-buttons">
          <Button
            variant="outline"
            disabled={!!busy || readonly || (tab === "chat" && !uploadConsent)}
            onClick={() => void upload(retryUploads, uploadForConversation.current)}
          >
            업로드 다시 시도
          </Button>
        </div>
      </section>
    ) : null;
  const materialsPanel = view ? (
    <MaterialsPanel
      caseId={caseId}
      files={view.files}
      busy={busy}
      readonly={readonly}
      ready={ready}
      evidenceIds={evidenceIds}
      facts={view.facts ?? []}
      selected={selected}
      selectionDisabled={queuedSend || !!pendingResponse}
      onSelect={(id, checked) =>
        setSelected((ids) =>
          checked ? [...new Set([...ids, id])] : ids.filter((value) => value !== id),
        )
      }
      onAsk={(file) => {
        if (queuedSend || pendingResponse || busy || readonly) return;
        setSelected((ids) => [...new Set([...ids, file.id])]);
        navigateTask("chat");
        setNotice(
          "자료를 다음 메시지에 사용할 수 있도록 선택했어요. 작성 중인 입력을 확인한 뒤 보내기를 눌러주세요.",
        );
        requestAnimationFrame(() => draftInput.current?.focus({ preventScroll: true }));
      }}
      onReview={(file, origin) => {
        origin.focus();
        void run("file-preview", async () => {
          setPreview(file);
          setSourceReference(undefined);
          setOriginal(null);
        });
      }}
      onDelete={(file, origin) => {
        origin.focus();
        setDeleteFile(file);
      }}
      onRetry={(id) => void retryFile(id)}
      acceptedFileRetries={acceptedFileRetries}
      report={conversationState?.report ?? null}
      standalone
      {...(tab === "chat"
        ? { onReportRefresh: () => setConversationRefresh((value) => value + 1) }
        : {})}
    >
      {conversationState?.snapshot &&
        !["stale", "pending", "running"].includes(conversationState.analysis.status) && (
          <div {...privateContent}>
            <EvidenceRequirements
              requirements={conversationState.snapshot.evidenceRequirements}
              files={view.files}
              facts={view.facts ?? []}
              disabled={
                readonly ||
                !!busy ||
                queuedSend ||
                !!localAttachments.length ||
                !!chatAttachments.length
              }
              onAdd={openUploadChooser}
              onReview={openConversationFile}
            />
          </div>
        )}
      <div
        className={`workspace-material-upload${view.files.length ? " workspace-material-upload--compact" : ""}`}
        {...privateContent}
      >
        <EvidencePicker
          scopeKey={`${caseId}:${ticket()}`}
          photoOnly
          compact
          disabled={readonly || !!busy || retryUploads.length > 0}
          onSelect={chooseConversationAttachments}
          onError={fileReviewError}
        />
        <ChatAttachments
          label="업로드할 자료"
          local={localAttachments}
          uploaded={[]}
          disabled={readonly || !!busy}
          removeLocal={(file) => {
            setLocalAttachments((items) => items.filter((item) => item !== file));
            setRetryUploads((items) => items.filter((item) => item !== file));
          }}
          removeUploaded={() => {}}
        />
        {!!localAttachments.length && (
          <>
            <label className="workspace-consent">
              <input
                type="checkbox"
                checked={uploadConsent}
                disabled={readonly || !!busy}
                onChange={(event) => setUploadConsent(event.target.checked)}
              />
              첨부한 파일의 자동 처리에 동의합니다.
            </label>
            <Button
              disabled={readonly || !!busy || !uploadConsent || retryUploads.length > 0}
              onClick={() => void upload(localAttachments, false)}
            >
              선택한 자료 업로드
            </Button>
          </>
        )}
        {!view.files.length && <h3 className="sr-only">아직 자료가 없어요</h3>}
        <button
          type="button"
          className="workspace-upload-target"
          aria-label={view.files.length ? "파일 추가" : "파일 선택"}
          disabled={!!busy || readonly}
          onClick={openUploadChooser}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (!busy && !readonly) chooseAttachments(Array.from(event.dataTransfer.files));
          }}
        >
          <span className="workspace-upload-icon">
            {view.files.length ? <Plus size={20} /> : <Upload size={28} />}
          </span>
          <span className="workspace-upload-title">
            {view.files.length ? "파일 추가" : "파일 선택"}
          </span>
          <span className="workspace-upload-limit">
            문서·이미지 {V2_LIMITS.documentImageBytes / 1_000_000} MB · 음성·영상{" "}
            {V2_LIMITS.mediaBytes / 1_000_000_000} GB까지
          </span>
        </button>
        {busy === "upload" && (
          <div className="workspace-upload-progress" role="status">
            <p>
              <LoaderCircle size={17} className="workspace-spin" />{" "}
              {uploadProgress ? uploadProgressLabel(uploadProgress.value) : "자료 저장 중"}
            </p>
            {uploadProgress && (
              <>
                <p>
                  {uploadProgress.fileName} · {uploadProgress.index}/{uploadProgress.total}개
                </p>
                {uploadProgress.value.stage === "uploading" && (
                  <p>
                    저장 확인된 전송량 {uploadProgress.value.completedBytes.toLocaleString("ko-KR")}{" "}
                    / {uploadProgress.value.totalBytes.toLocaleString("ko-KR")} 바이트
                  </p>
                )}
                <ElapsedTime startedAt={uploadProgress.startedAt} label="업로드 시작 후" />
              </>
            )}
          </div>
        )}
      </div>
    </MaterialsPanel>
  ) : null;
  return (
    <div
      ref={root}
      className={`workspace workspace--${activeTask ?? tab}${activeTask === "chat" && view && !view.messages.length ? " workspace--empty" : ""}`}
    >
      {/* Keep the chooser's original node attached during temporary access checks. */}
      <input
        ref={uploadInput}
        id="workspace-upload"
        aria-label={tab === "chat" ? "사진 또는 파일 첨부" : "업로드할 파일 선택"}
        type="file"
        hidden
        multiple
        disabled={!!busy || view?.case.stage !== "active"}
        accept=".txt,.pdf,.doc,.docx,.hwp,.hwpx,.xls,.xlsx,.ppt,.pptx,image/*,audio/*,video/*"
        onChange={(event) => {
          if (
            uploadChooserScope.current &&
            uploadChooserScope.current !== `${caseId}:${ticket()}`
          ) {
            event.currentTarget.value = "";
            return;
          }
          uploadChooserScope.current = null;
          chooseAttachments(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <CaseWorkspaceFrame
        kind={
          activeTask === "chat" ? "conversation" : activeTask === "files" ? "compare" : "document"
        }
        header={
          <CaseNavigation
            caseId={caseId}
            title={
              (ready ? view?.case.title : null) ??
              (error ? "사건을 확인할 수 없어요" : "사건을 불러오는 중")
            }
            active={tab}
            {...(activeTask ? { activeTask } : {})}
            onNavigate={navigateTask}
            fileCount={ready ? view?.files.length : undefined}
          />
        }
      >
        <div className="workspace-feedback" aria-live="polite" aria-atomic="true">
          {notice || (busy === "file-retry" ? "자료 처리 요청을 확인하고 있어요…" : "")}
        </div>
        {errorFeedback}
        {uploadRecovery}
        {!error && !busy && (acceptedFileRetries.length > 0 || uploadReadbackPending) && (
          <Button
            variant="outline"
            onClick={() =>
              void run("refresh", async (epoch) => {
                const next = await load();
                if (next && current(epoch)) setNotice("접수한 자료의 최신 상태를 확인했어요.");
              })
            }
          >
            접수 상태 다시 확인
          </Button>
        )}
        {!view && !error && (
          <div className="workspace-loading" role="status">
            <LoaderCircle className="workspace-spin" /> 사건과 저장된 자료를 불러오고 있어요.
          </div>
        )}
        {/* Keep the generic retry control mounted above the private content. Focus
          verification hides that content, but must not swallow a pointer click.
          run() still verifies the latest owner and consent before any request. */}
        {tab === "chat" &&
          view?.messages
            .filter((message) => message.status === "failed" && message.retryable !== false)
            .map((message) => (
              <section
                className="workspace-message-failed"
                key={message.id}
                aria-label="응답 재시도"
              >
                <p>완료하지 못한 응답이 있어요. 같은 대화에서 다시 시도할 수 있어요.</p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!!busy || !canMutate || view.case.stage !== "active"}
                  onClick={() =>
                    void run("chat-retry", async (epoch) => {
                      const next = await api.workspace.retryMessage(caseId, message.id);
                      if (!(await verify()) || !current(epoch)) return;
                      apply(next);
                      setNotice("응답을 다시 요청했어요.");
                    })
                  }
                >
                  응답 다시 시도
                </Button>
              </section>
            ))}
        {view && (
          // Only the generic file-preview controls survive a focus check. Their
          // private content has the same gate below; all other tabs keep this gate.
          <div className="workspace-content" {...(tab === "files" ? {} : privateContent)}>
            {!canMutate && (
              <section className="workspace-error" {...privateContent}>
                <p>
                  저장한 사건·자료는 읽을 수 있어요. 새 대화·수정·처리는 최신 동의 확인 후 사용할 수
                  있어요.
                </p>
                <ButtonLink href={accessHref("consent")}>동의 확인하고 계속하기</ButtonLink>
              </section>
            )}
            {view.case.stage !== "active" && (
              <section className="workspace-error" {...privateContent}>
                <p>
                  {view.case.stage === "archived"
                    ? "보관된 사건이에요. 저장된 내용을 확인할 수 있어요."
                    : view.messages.length
                      ? "요약이 변경되어 다시 확인이 필요해요. 확인한 뒤 대화를 이어갈 수 있어요."
                      : "대화를 시작하려면 최신 요약을 확인해 주세요."}
                </p>
                {view.case.stage !== "archived" &&
                  (tab === "chat" && view.case.schemaVersion === "2" ? (
                    <Button
                      variant="outline"
                      onClick={() =>
                        setConversationRequest({
                          id: crypto.randomUUID(),
                          action: "reconfirm_case",
                        })
                      }
                    >
                      요약 확인하기
                    </Button>
                  ) : (
                    <ButtonLink href={`${base}/summary`}>요약 확인하기</ButtonLink>
                  ))}
              </section>
            )}
            <div className="workspace-grid">
              <section
                className="workspace-main"
                aria-label={
                  activeTask === "reports"
                    ? "리포트"
                    : activeTask === "drafts"
                      ? "문서 초안"
                      : tabLabels[tab]
                }
              >
                {chatVisited && (
                  <div
                    data-workspace-task="chat"
                    hidden={activeTask !== "chat"}
                    inert={activeTask !== "chat"}
                    style={{ display: activeTask !== "chat" ? "none" : undefined }}
                  >
                    {!!view.messages.length && (
                      <div className="workspace-chat-heading">
                        <h2>이어서 대화하기</h2>
                      </div>
                    )}
                    <div
                      ref={chatMessages}
                      className="workspace-messages"
                      role="log"
                      // biome-ignore lint/a11y/noNoninteractiveTabindex: The named scroll area must support keyboard scrolling.
                      tabIndex={0}
                      aria-label="사건 대화"
                      aria-live="polite"
                      onScroll={(event) => {
                        if (activeTaskRef.current !== "chat") return;
                        const messages = event.currentTarget;
                        followingChat.current =
                          messages.scrollHeight - messages.clientHeight - messages.scrollTop <= 96;
                      }}
                    >
                      {contextSummary}
                      {!view.messages.length && (
                        <div className="workspace-chat-welcome">
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
                                    setDraft((existing) =>
                                      existing.trim() ? `${existing}\n${prompt}` : prompt,
                                    );
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
                      {historyButton("messages", "이전 대화 더 불러오기")}
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
                          {message.role === "assistant" && message.status === "complete" ? (
                            <ProgressiveReply
                              text={message.text}
                              animate={progressiveIds.has(message.id)}
                              onProgress={followReply}
                              onComplete={() => finishReply(message.id)}
                            />
                          ) : (
                            <p>{message.text}</p>
                          )}
                          {!!message.selectedFileIds?.length && (
                            <ul
                              className="workspace-message-attachments"
                              aria-label="메시지 첨부 파일"
                            >
                              {message.selectedFileIds.map((id) => (
                                <li key={id}>
                                  <a
                                    href={`${base}/files?file=${encodeURIComponent(id)}`}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      openConversationFile(id, event.currentTarget);
                                    }}
                                  >
                                    <Paperclip size={15} />
                                    <span>
                                      {view.files.find((file) => file.id === id)?.name ??
                                        "삭제되었거나 확인할 수 없는 첨부 파일"}
                                    </span>
                                  </a>
                                </li>
                              ))}
                            </ul>
                          )}
                          {message.role === "assistant" &&
                            message.status === "complete" &&
                            message.references?.some((ref) => ref.kind === "user_material") && (
                              <p className="workspace-evidence-notice">
                                첨부 자료를 근거로 활용했어요.{" "}
                                {view.case.schemaVersion === "2" ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      setConversationRequest({
                                        id: crypto.randomUUID(),
                                        action: "add_material",
                                      })
                                    }
                                  >
                                    이 대화에서 자료 확인
                                  </Button>
                                ) : (
                                  <ButtonLink href={`${base}/files`}>자료 확인</ButtonLink>
                                )}
                              </p>
                            )}
                          {!!message.citations?.length && (
                            <SourceCards citations={message.citations} />
                          )}
                          {message.references?.some((ref) => ref.kind === "user_material") && (
                            <ul
                              className="workspace-message-references"
                              aria-label="답변에 사용한 자료"
                            >
                              {message.references
                                .filter((ref) => ref.kind === "user_material")
                                .map((ref) => (
                                  <li key={JSON.stringify(ref)}>
                                    <a
                                      href={`${base}/files?file=${encodeURIComponent(ref.fileId)}`}
                                      onClick={(event) => {
                                        event.preventDefault();
                                        openConversationFile(ref.fileId, event.currentTarget, ref);
                                      }}
                                    >
                                      {view.files.find((f) => f.id === ref.fileId)?.name ??
                                        "참조 자료"}{" "}
                                      · {referenceLabel(ref)}
                                    </a>
                                  </li>
                                ))}
                            </ul>
                          )}
                          {message.status === "pending" && (
                            <span className="workspace-status">
                              <LoaderCircle size={15} className="workspace-spin" /> 응답 준비 중 ·
                              저장된 대화는 유지돼요
                              {message.statusUpdatedAt && (
                                <ElapsedTime
                                  startedAt={message.statusUpdatedAt}
                                  label="· 마지막 상태 변경 후"
                                />
                              )}
                            </span>
                          )}
                          {message.status === "failed" && (
                            <div className="workspace-message-failed">
                              <p>
                                {message.retryable === false
                                  ? "내용을 확인한 뒤 새 메시지를 보내 주세요."
                                  : "같은 대화에서 다시 시도할 수 있어요."}
                              </p>
                            </div>
                          )}
                        </article>
                      ))}
                      {view.case.schemaVersion === "2" && (
                        <ConversationAgent
                          key={`${caseId}:${ticket()}`}
                          workspace={view}
                          active={activeTask === "chat"}
                          client={api.rework}
                          access={{ ready, canMutate, ticket, current, verify }}
                          incomingMessageIds={incomingActionMessages}
                          refreshKey={conversationRefresh}
                          queuedWork={queuedSend}
                          requestedAction={conversationRequest}
                          disabled={
                            !!busy ||
                            queuedSend ||
                            !!pendingResponse ||
                            view.case.stage === "archived"
                          }
                          onChanged={load}
                          onBusyChange={setAgentBusy}
                          onStateChange={setConversationState}
                          onOpenMaterials={openMaterials}
                          reportHref={`${base}/reports?mode=conversation`}
                          onReviewFile={openConversationFile}
                          onPaneOpen={pauseReplyFollowing}
                          renderPane={renderConversationPane}
                        />
                      )}
                    </div>
                    <form
                      className="workspace-composer"
                      onSubmit={(event) => void send(event)}
                      onDragOver={(event) => {
                        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
                      }}
                      onDrop={(event) => {
                        if (event.dataTransfer.files.length) {
                          event.preventDefault();
                          if (!readonly) chooseAttachments(Array.from(event.dataTransfer.files));
                        }
                      }}
                      onPaste={(event) => {
                        if (event.clipboardData.files.length) {
                          event.preventDefault();
                          if (!readonly) chooseAttachments(Array.from(event.clipboardData.files));
                        }
                      }}
                    >
                      <div className="workspace-composer-surface">
                        {reportQuestion && (
                          <section
                            className="workspace-report-question"
                            aria-label="질문용 리포트 참조"
                          >
                            <strong>{reportQuestion.sectionTitle} · 리포트에서 읽은 내용</strong>
                            <p>{reportQuestion.excerpt}</p>
                            <p>
                              궁금한 점을 적고 보내기를 눌러주세요. 참조를 준비해도 메시지는 보내지
                              않아요.
                            </p>
                            <Button
                              type="button"
                              variant="ghost"
                              disabled={!!busy || queuedSend}
                              onClick={() => setReportQuestion(null)}
                            >
                              질문용 참조 제외
                            </Button>
                          </section>
                        )}
                        {messageTooLong && (
                          <p role="alert">
                            리포트 참조와 메시지를 합쳐 10,000자까지 보낼 수 있어요. 입력이나 질문용
                            참조를 줄여주세요.
                          </p>
                        )}
                        <ChatAttachments
                          local={localAttachments}
                          uploaded={chatAttachments}
                          disabled={!!busy || readonly || queuedSend}
                          removeLocal={(file) => {
                            setLocalAttachments((items) => items.filter((item) => item !== file));
                            setRetryUploads((items) => items.filter((item) => item !== file));
                          }}
                          removeUploaded={(id) =>
                            setChatAttachments((items) => items.filter((item) => item.id !== id))
                          }
                        />
                        {!!localAttachments.length && (
                          <label className="workspace-consent">
                            <input
                              type="checkbox"
                              checked={uploadConsent}
                              disabled={!!busy || readonly || queuedSend}
                              onChange={(event) => setUploadConsent(event.target.checked)}
                            />
                            첨부한 파일의 자동 처리에 동의합니다.
                          </label>
                        )}
                        {(busy === "upload" || queuedSend) && (
                          <div className="workspace-chat-upload-status" role="status">
                            {!uploadProgress &&
                            chatAttachments.length > 0 &&
                            chatAttachments.every((file) => file.status === "ready") ? (
                              <Clock3 size={16} />
                            ) : (
                              <LoaderCircle size={16} className="workspace-spin" />
                            )}
                            <span>
                              {uploadProgress
                                ? `${uploadProgress.fileName} · ${uploadProgressLabel(uploadProgress.value)}`
                                : chatAttachments.length > 0 &&
                                    chatAttachments.every((file) => file.status === "ready")
                                  ? "사건과 리포트 준비의 완료 확인을 기다려요. 입력과 자료는 보존돼요."
                                  : "첨부 파일을 처리하고 있어요. 준비되면 메시지를 보내요."}
                              {uploadProgress && (
                                <ElapsedTime
                                  startedAt={uploadProgress.startedAt}
                                  label=" · 전송 시작 후"
                                />
                              )}
                              {!busy &&
                                !chatAttachments.every((file) => file.status === "ready") &&
                                " 파일 전송은 끝났고, 내용을 읽는 중이에요. 큰 문서나 음성·영상은 더 걸릴 수 있어요."}
                            </span>
                            {!busy && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  queuedUpload.current = null;
                                  setQueuedSend(false);
                                }}
                              >
                                전송 대기 취소
                              </Button>
                            )}
                          </div>
                        )}
                        {!!readyFiles.length && (
                          <details className="workspace-evidence">
                            <summary>
                              <Paperclip size={15} /> 대화에 사용할 자료{" "}
                              {selected.length > 0 && <span>{selected.length}개 선택</span>}
                              <ChevronDown size={15} />
                            </summary>
                            <fieldset disabled={!!busy || readonly || queuedSend}>
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
                        <div className="workspace-composer-row">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="workspace-attach"
                            title="사진·파일 첨부"
                            aria-label="사진·파일 첨부"
                            disabled={!!busy || readonly || queuedSend}
                            onClick={openUploadChooser}
                          >
                            <Plus size={19} />
                          </Button>
                          {lookupAvailable && view.case.schemaVersion === "2" && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="workspace-lookup-open"
                              aria-label="외부 조회"
                              title="외부 조회"
                              disabled={!!busy || readonly || queuedSend || pendingResponse}
                              onClick={() => {
                                lookupAttempt.current = null;
                                setLookupOpen(true);
                              }}
                            >
                              <Search size={17} />
                            </Button>
                          )}
                          <label className="workspace-sr-only" htmlFor="workspace-message">
                            추가 사실 또는 질문
                          </label>
                          <textarea
                            ref={draftInput}
                            id="workspace-message"
                            rows={1}
                            // Native maxlength counts UTF-16; the change handler caps Unicode characters.
                            maxLength={20000}
                            value={draft}
                            disabled={readonly || busy === "send" || queuedSend}
                            onChange={(event) => {
                              const value = event.target.value;
                              setDraft(
                                draftComposing.current
                                  ? value
                                  : [...value].slice(0, 10000).join(""),
                              );
                            }}
                            onCompositionStart={() => {
                              draftComposing.current = true;
                            }}
                            onCompositionEnd={(event) => {
                              draftComposing.current = false;
                              setDraft([...event.currentTarget.value].slice(0, 10000).join(""));
                            }}
                            placeholder="메시지"
                            aria-invalid={messageTooLong}
                            onKeyDown={(event) => {
                              if (
                                event.key === "Enter" &&
                                (event.metaKey || event.ctrlKey) &&
                                !event.nativeEvent.isComposing &&
                                !draftComposing.current &&
                                event.nativeEvent.keyCode !== 229 &&
                                !busy &&
                                !pendingResponse &&
                                !readonly &&
                                !queuedSend &&
                                (draft.trim() ||
                                  selected.length ||
                                  localAttachments.length ||
                                  chatAttachments.length) &&
                                (!localAttachments.length || uploadConsent) &&
                                !messageTooLong
                              ) {
                                event.preventDefault();
                                event.currentTarget.form?.requestSubmit();
                              }
                            }}
                          />
                          <Button
                            className="workspace-send"
                            type="submit"
                            disabled={
                              !!busy ||
                              queuedSend ||
                              (!draft.trim() &&
                                !selected.length &&
                                !localAttachments.length &&
                                !chatAttachments.length) ||
                              (!!localAttachments.length && !uploadConsent) ||
                              messageTooLong ||
                              readonly ||
                              pendingResponse ||
                              chatAttachments.some(
                                (file) => file.status === "failed" || !!file.uploadRejection,
                              )
                            }
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
                    </form>
                  </div>
                )}
                {filesVisited && (
                  <div
                    data-workspace-task="files"
                    id="case-materials-panel"
                    hidden={activeTask !== "files"}
                    inert={activeTask !== "files"}
                    style={{ display: activeTask !== "files" ? "none" : undefined }}
                  >
                    {materialsPanel}
                  </div>
                )}
                {reportVisited && (
                  <div
                    data-workspace-task="reports"
                    hidden={activeTask !== "reports" && activeTask !== "drafts"}
                    inert={activeTask !== "reports" && activeTask !== "drafts"}
                    style={{
                      display:
                        activeTask !== "reports" && activeTask !== "drafts" ? "none" : undefined,
                    }}
                  >
                    <Suspense fallback={<p role="status">저장된 리포트 화면을 불러오고 있어요.</p>}>
                      <RetainedReportReview
                        caseId={caseId}
                        rework
                        embedded
                        active={ready && (activeTask === "reports" || activeTask === "drafts")}
                        initialSection={reportSection}
                        onNavigateTask={navigateTask}
                        onDirtyChange={setReportDirty}
                        onAskAboutReport={(context) => {
                          if (
                            reportQuestion &&
                            !window.confirm(
                              "질문용으로 준비한 리포트 참조를 새 내용으로 바꿀까요? 작성 중인 메시지는 그대로 남아요.",
                            )
                          )
                            return;
                          setReportQuestion(context);
                          navigateTask("chat");
                          setNotice(
                            "리포트 내용을 질문용으로 준비했어요. 작성 중인 메시지는 그대로예요. 확인한 뒤 보내기를 눌러주세요.",
                          );
                        }}
                      />
                    </Suspense>
                  </div>
                )}
                {!activeTask && tab === "timeline" && (
                  <>
                    <div className="workspace-section-heading">
                      <div>
                        <h2>사건의 흐름</h2>
                        <p>언제 어떤 일이 있었는지 차근차근 정리해요.</p>
                      </div>
                      <div className="workspace-section-actions">
                        <Button
                          variant="outline"
                          disabled={!!busy || readonly || !!pendingResponse}
                          loading={busy === "update-timeline"}
                          onClick={() => void refreshPreparation("timeline")}
                        >
                          <RefreshCw size={17} /> 새로고침
                        </Button>
                        <Button
                          variant="default"
                          disabled={!!busy || readonly}
                          aria-haspopup="dialog"
                          onClick={(event) => {
                            event.currentTarget.focus();
                            void startEntry();
                          }}
                        >
                          <Plus size={17} />
                          일정 추가
                        </Button>
                      </div>
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
                    {historyButton("timeline", "타임라인 더 불러오기")}
                    <ol className="workspace-timeline">
                      {[...view.timeline]
                        .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"))
                        .map((item) => (
                          <li key={item.id}>
                            <time>{timelineDateLabel(item)}</time>
                            <div>
                              <h3>{item.title}</h3>
                              <p>{item.detail}</p>
                              <TimelineEvidence
                                entry={item}
                                files={view.files}
                                facts={view.facts}
                                base={base}
                              />
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={!!busy || readonly}
                              aria-haspopup="dialog"
                              onClick={(event) => {
                                event.currentTarget.focus();
                                setEntry({
                                  ...item,
                                  expectedRevision: item.revision ?? view.case.revision,
                                });
                              }}
                            >
                              편집
                            </Button>
                          </li>
                        ))}
                    </ol>
                  </>
                )}
                {!activeTask && tab === "actions" && (
                  <>
                    <div className="workspace-section-heading">
                      <div>
                        <h2>다음 행동</h2>
                        <p>
                          확인한 사실과 자료, 아직 모르는 내용을 하나씩 점검하며 준비를 이어가요.
                        </p>
                      </div>
                      <div className="workspace-section-actions">
                        <Button
                          variant="outline"
                          disabled={!!busy || readonly || !!pendingResponse}
                          loading={busy === "update-actions"}
                          onClick={() => void refreshPreparation("actions")}
                        >
                          <RefreshCw size={17} /> 새로고침
                        </Button>
                      </div>
                    </div>
                    {!!view.actions.length && (
                      <div className="workspace-action-status">
                        <span className="workspace-count" aria-live="polite">
                          {view.actions.filter((action) => action.done).length} /{" "}
                          {view.actions.length} 완료
                        </span>
                        <progress
                          className="workspace-action-progress"
                          aria-label="다음 행동 완료 현황"
                          max={view.actions.length}
                          value={view.actions.filter((action) => action.done).length}
                        />
                      </div>
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
                    {historyButton("actions", "행동 더 불러오기")}
                    <ul className="workspace-action-list" aria-busy={!!pendingResponse}>
                      {view.actions.map((action) => (
                        <li key={action.id} className={action.done ? "is-done" : ""}>
                          <label>
                            <input
                              type="checkbox"
                              checked={action.done}
                              disabled={!!busy || readonly || !!pendingResponse}
                              onChange={(event) =>
                                void toggleAction(action.id, event.target.checked)
                              }
                            />
                            <span>
                              <strong>{action.title}</strong>
                              <small>{action.detail}</small>
                              {busy === action.id && (
                                <small role="status">완료 표시를 저장하고 있어요…</small>
                              )}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    <div className="workspace-next">
                      <h3>준비한 내용과 남은 조건을 리포트에서 확인하세요</h3>
                      <p>
                        리포트에서 준비한 내용과 남은 확인 조건을 검토하세요. 직접 준비를
                        이어가거나, 전문가의 도움을 받거나, 리포트만 보관할 수 있어요.
                      </p>
                      <div className="workspace-buttons">
                        <ButtonLink href={`${base}/reports`}>리포트 열기</ButtonLink>
                      </div>
                    </div>
                  </>
                )}
              </section>
              {!activeTask && tab !== "chat" && contextSummary}
            </div>
          </div>
        )}
      </CaseWorkspaceFrame>
      <Dialog
        open={!!leaveTarget}
        title="작성 중인 내용을 두고 이동할까요?"
        onOpenChange={(open) => {
          if (!open) setLeaveTarget(null);
        }}
      >
        <p>
          이 사건의 네 작업 사이에서는 작성 내용을 유지해요. 다른 페이지로 이동하면 아직 보내지 않은
          메시지·자료 선택과 저장하지 않은 편집은 남지 않을 수 있어요.
        </p>
        {localAttachments.length > 0 && (
          <>
            <p>
              아직 업로드하지 않은 파일 {localAttachments.length}개는 이동 후 다시 선택해야 해요.
              파일명만으로 복원하거나 자동으로 업로드하지 않아요.
            </p>
            <ul>
              {localAttachments.map((file) => (
                <li key={`${file.name}:${file.size}:${file.lastModified}`}>{file.name}</li>
              ))}
            </ul>
          </>
        )}
        <div className="workspace-buttons">
          <Button variant="outline" onClick={() => setLeaveTarget(null)}>
            이 화면에서 계속 작성
          </Button>
          {localAttachments.length > 0 && (
            <Button
              variant="outline"
              onClick={() => {
                setLeaveTarget(null);
                navigateTask("files");
              }}
            >
              자료에서 업로드 준비
            </Button>
          )}
          <Button
            variant="destructive"
            onClick={() => {
              if (!leaveTarget) return;
              leaveApproved.current = true;
              window.location.assign(leaveTarget);
              // A browser-level unsaved report warning may still cancel the transition.
              // Never clear the actual input/File handles before a navigation succeeds.
              setTimeout(() => {
                leaveApproved.current = false;
                setLeaveTarget(null);
              }, 0);
            }}
          >
            미저장 내용과 첨부 선택을 버리고 이동
          </Button>
        </div>
      </Dialog>
      {lookupOpen && (
        <LookupDialog
          key={caseId}
          caseId={caseId}
          busy={busy === "lookup"}
          onClose={() => {
            setLookupOpen(false);
            lookupAttempt.current = null;
          }}
          onSubmit={sendLookup}
        />
      )}
      <dialog
        ref={dialog}
        className={`workspace-dialog${preview ? " workspace-dialog--material" : ""}`}
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
          <div className="workspace-preview" hidden={!ready} inert={!ready}>
            <h3>{preview.name}</h3>
            <p>
              {preview.uploadRejection ? "등록 거절" : fileStatus[preview.status]} ·{" "}
              {size(preview.sizeBytes)}
            </p>
            {preview.uploadRejection && (
              <p>
                파일 등록이 거절됐어요. 암호·보호를 해제하거나 지원하는 형식으로 저장한 파일을 새로
                선택해 주세요.
              </p>
            )}
            <h4>처리 범위</h4>
            <p>{preview.coverage || "추출 범위를 아직 확인할 수 없어요."}</p>
            <FileReview
              key={preview.id}
              caseId={caseId}
              fileId={preview.id}
              canEdit={!readonly}
              onChanged={load}
              onError={fileReviewError}
              onDirtyChange={fileReviewDirtyChanged}
              onBusyChange={fileReviewBusyChanged}
              refreshVersion={`${view?.case.revision ?? 0}:${preview.status}`}
              sourceReference={sourceReference}
            />
            {preview.status === "ready" && (
              <div className="workspace-material-apply">
                <p>
                  교정을 저장한 뒤 자료 내용을 대화로 보내면 사건의 사실을 함께 정리해요. 긴 자료는
                  일부만 참고할 수 있으니 전체 원문도 확인하세요. 저장한 리포트는 새 버전에서 갱신할
                  수 있어요.
                </p>
              </div>
            )}
            <div className="workspace-buttons">
              {preview.status === "ready" && (
                <Button
                  disabled={!!busy || readonly || reviewState.dirty || reviewState.busy}
                  onClick={() => void reflectMaterial(preview.id)}
                >
                  자료 내용 반영하기 <ArrowRight size={16} />
                </Button>
              )}
              <Button
                variant="outline"
                disabled={!!busy || !ready || preview.status === "uploading"}
                onClick={() =>
                  void run("original", async (epoch) => {
                    const blob = await api.files.original(caseId, preview.id);
                    if (!(await verify()) || !current(epoch)) return;
                    const type =
                      blob.type === "application/octet-stream" ? preview.mimeType : blob.type;
                    const safe =
                      /^(image\/(png|jpeg|webp|gif|bmp)|audio\/(mpeg|mp4|x-m4a|wav|x-wav|ogg|webm)|video\/(mp4|webm|ogg))$/.test(
                        type,
                      );
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
              {original && (
                <Button
                  variant="outline"
                  disabled={!!busy || !ready}
                  onClick={() =>
                    void run("original", async (epoch) => {
                      const blob = await api.files.original(caseId, preview.id);
                      if (!(await verify()) || !current(epoch)) return;
                      download(blob, preview.name);
                      setNotice("원본을 내려받았어요. 파일을 열어 확인하세요.");
                    })
                  }
                >
                  원본 다운로드
                </Button>
              )}
              <Button variant="ghost" onClick={closeDialog} disabled={!!busy}>
                닫기
              </Button>
            </div>
            {original &&
              (original.type.startsWith("audio/") ? (
                // biome-ignore lint/a11y/useMediaCaption: Private source recording; editable transcript is shown above, no verified timed captions exist.
                <audio controls src={original.url} aria-label={`${preview.name} 원음 듣기`} />
              ) : original.type.startsWith("video/") ? (
                // biome-ignore lint/a11y/useMediaCaption: Private source video; extracted text is shown above, no verified timed captions exist.
                <video controls src={original.url} aria-label={`${preview.name} 원본 영상`} />
              ) : (
                <img src={original.url} alt={`${preview.name} 원본 미리보기`} />
              ))}
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
              이 자료를 포함한 저장 리포트와 서버의 PDF·ZIP 내보내기도 함께 삭제되며 되돌릴 수
              없어요. 필요한 리포트는 먼저 다운로드해 주세요. 이미 저장된 대화 내용과 다운로드한
              파일은 남으므로 다시 검토해 주세요.
            </p>
            <div className="workspace-buttons">
              <Button variant="outline" disabled={!!busy} onClick={closeDialog}>
                취소
              </Button>
              <Button
                variant="destructive"
                disabled={!!busy || !ready || view?.case.stage === "archived"}
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
            <label htmlFor="timeline-precision">날짜를 얼마나 기억하시나요?</label>
            <select
              id="timeline-precision"
              value={entry.datePrecision ?? (entry.date ? "day" : "unknown")}
              disabled={readonly || !!busy}
              onChange={(e) => {
                const precision = e.target.value as NonNullable<TimelineView["datePrecision"]>;
                setEntry({
                  ...entry,
                  datePrecision: precision,
                  date: timelineDateInput(entry.date ?? "", precision, entry.datePrecision),
                });
              }}
            >
              <option value="day">연·월·일</option>
              <option value="month">연·월 (일 미상)</option>
              <option value="year">연도 (월·일 미상)</option>
              <option value="unknown">날짜 미상</option>
            </select>
            <label htmlFor="timeline-date">날짜 (모르면 비워 두세요)</label>
            <input
              id="timeline-date"
              name="date"
              type={
                entry.datePrecision === "year"
                  ? "text"
                  : entry.datePrecision === "month"
                    ? "month"
                    : "date"
              }
              inputMode={entry.datePrecision === "year" ? "numeric" : undefined}
              pattern={entry.datePrecision === "year" ? "[0-9]{4}" : undefined}
              disabled={readonly || !!busy || timelineRecovery || entry.datePrecision === "unknown"}
              value={
                entry.datePrecision === "year"
                  ? (entry.date ?? "").slice(0, 4)
                  : entry.datePrecision === "month"
                    ? (entry.date ?? "").slice(0, 7)
                    : (entry.date ?? "")
              }
              onChange={(event) => setEntry({ ...entry, date: event.target.value })}
            />
            <label htmlFor="timeline-title">어떤 일이 있었나요?</label>
            <input
              id="timeline-title"
              name="title"
              required
              disabled={readonly || !!busy || timelineRecovery}
              value={entry.title ?? ""}
              onChange={(event) => setEntry({ ...entry, title: event.target.value })}
            />
            <label htmlFor="timeline-detail">상세 내용</label>
            <textarea
              id="timeline-detail"
              name="detail"
              rows={4}
              disabled={readonly || !!busy || timelineRecovery}
              value={entry.detail ?? ""}
              onChange={(event) => setEntry({ ...entry, detail: event.target.value })}
            />
            {timelineEventLength(entry) > 2000 && (
              <p role="alert">일어난 일과 상세 내용은 합쳐서 2,000자까지 입력할 수 있어요.</p>
            )}
            <div className="workspace-buttons">
              <Button variant="outline" disabled={!!busy} onClick={closeDialog}>
                취소
              </Button>
              <Button
                type="submit"
                disabled={!!busy || readonly || timelineEventLength(entry) > 2000}
              >
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
