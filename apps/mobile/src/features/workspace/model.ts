import {
  ApiError,
  type createWorkspaceClient,
  errorMessage,
  type WorkspaceAcknowledgement,
} from "@baro/api-client";
import type {
  ActionView,
  TimelineView,
  WorkspaceCollection,
  WorkspaceView,
} from "@baro/client-core";
import { opaqueIdSchema } from "@baro/contracts/v1";
import { v2TimelineEditRequestSchema } from "@baro/contracts/v2";
import type { SessionModel, SessionState } from "../session/model";

type Client = Pick<
  ReturnType<typeof createWorkspaceClient>,
  "get" | "sendMessage" | "retryMessage" | "setAction" | "saveTimeline" | "loadMore"
>;
type TimelineDraft = Omit<TimelineView, "id"> & { id?: string; expectedRevision: number };
type Pending =
  | {
      kind: "message";
      input: { expectedRevision: number; text: string; selectedFileIds: string[] };
    }
  | { kind: "retry"; id: string; revision: number }
  | { kind: "action"; id: string; revision: number; done: boolean }
  | { kind: "timeline"; entry: TimelineDraft };
export interface WorkspaceState {
  gate: "checking" | "login" | "consent" | "role" | "ready" | "error";
  value: WorkspaceView | null;
  text: string;
  selectedFileIds: string[];
  timeline: TimelineDraft | null;
  pending: Pending | null;
  busy: boolean;
  conflict: boolean;
  error: string | null;
}
const empty = (): WorkspaceState => ({
  gate: "checking",
  value: null,
  text: "",
  selectedFileIds: [],
  timeline: null,
  pending: null,
  busy: false,
  conflict: false,
  error: null,
});
function access(session: SessionState): WorkspaceState["gate"] {
  if (session.phase === "error") return "error";
  if (session.phase !== "ready")
    return session.phase === "anonymous"
      ? "login"
      : session.phase === "consent"
        ? "consent"
        : "checking";
  if (!session.session?.user) return "login";
  if (session.session.needsConsent) return "consent";
  return session.session.user.accountType === "customer" ? "ready" : "role";
}
export function createWorkspaceModel(dependencies: {
  caseId: string;
  session: Pick<SessionModel, "getSnapshot" | "subscribe" | "refresh">;
  createClient(
    signal: AbortSignal,
    ownerId: string,
    acknowledged: (value: WorkspaceAcknowledgement) => void,
  ): Client;
  schedule?: (callback: () => void, ms: number) => () => void;
}) {
  const id = opaqueIdSchema.safeParse(dependencies.caseId);
  let state = empty(),
    owner: string | undefined,
    version = 0;
  let client: Client | undefined,
    controller: AbortController | undefined,
    cancelPoll: (() => void) | undefined;
  let parked: { owner: string; state: WorkspaceState } | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: WorkspaceState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const schedule =
    dependencies.schedule ??
    ((callback, ms) => {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    });
  const current = (captured: number) =>
    captured === version && state.gate === "ready" && !controller?.signal.aborted;
  function retire() {
    version++;
    cancelPoll?.();
    cancelPoll = undefined;
    controller?.abort();
    client = undefined;
  }
  function renew() {
    retire();
    controller = new AbortController();
    const captured = version;
    if (owner)
      client = dependencies.createClient(controller.signal, owner, (receipt) => {
        if (
          !current(captured) ||
          receipt.caseId !== dependencies.caseId ||
          state.pending?.kind !== receipt.kind
        )
          return;
        // Accepted mutation survives a failed projection read. Never offer it as a new operation.
        publish({
          ...state,
          pending: null,
          ...(receipt.kind === "message" ? { text: "", selectedFileIds: [] } : {}),
          ...(receipt.kind === "timeline" ? { timeline: null } : {}),
        });
      });
  }
  function poll() {
    cancelPoll?.();
    cancelPoll = undefined;
    if (
      state.value?.messages.some((message) => message.status === "pending") &&
      state.gate === "ready" &&
      !state.pending
    )
      cancelPoll = schedule(() => {
        void refresh();
      }, 3000);
  }
  function apply(value: WorkspaceView) {
    const changed = Boolean(
      state.timeline && state.value && state.value.case.revision !== value.case.revision,
    );
    publish({
      ...state,
      value,
      busy: false,
      conflict: state.conflict || changed,
      error: changed
        ? "다른 화면의 변경이 있어요. 입력을 확인하고 최신 내용으로 다시 시작해 주세요."
        : null,
    });
    poll();
  }
  function fail(captured: number, cause: unknown) {
    if (!current(captured)) return;
    cancelPoll?.();
    cancelPoll = undefined;
    if (cause instanceof ApiError && ["UNAUTHENTICATED", "CONSENT_REQUIRED"].includes(cause.code)) {
      if (owner) parked = { owner, state: { ...state, busy: false } };
      retire();
      publish(empty());
      void dependencies.session.refresh();
      return;
    }
    if (cause instanceof ApiError && cause.code === "NOT_FOUND") {
      parked = undefined;
      publish({
        ...empty(),
        gate: "ready",
        error: "사건을 찾을 수 없어요. 내 사건 목록에서 다시 확인해 주세요.",
      });
      return;
    }
    publish({
      ...state,
      busy: false,
      error: errorMessage(cause),
      conflict: state.conflict || (cause instanceof ApiError && cause.code === "CONFLICT"),
    });
  }
  async function refresh(discard = false) {
    if (state.gate !== "ready" || state.busy || !id.success) return;
    if (!client) renew();
    const api = client,
      captured = version;
    if (!api) return;
    cancelPoll?.();
    publish({
      ...state,
      busy: true,
      error: null,
      ...(discard
        ? { timeline: null, pending: null, conflict: false, text: "", selectedFileIds: [] }
        : {}),
    });
    try {
      const value = await api.get(id.data);
      if (current(captured)) apply(value);
    } catch (cause) {
      fail(captured, cause);
    }
  }
  function sync() {
    const session = dependencies.session.getSnapshot(),
      gate = access(session);
    if (gate !== "ready") {
      if (state.gate === "ready" && owner) parked = { owner, state: { ...state, busy: false } };
      retire();
      if (gate === "login" || gate === "role") {
        owner = undefined;
        parked = undefined;
      }
      publish({ ...empty(), gate, error: gate === "error" ? session.error : null });
      return;
    }
    const nextOwner = session.session?.user?.id;
    if (!nextOwner || (owner === nextOwner && state.gate === "ready")) return;
    const restored = parked?.owner === nextOwner ? parked.state : empty();
    owner = nextOwner;
    parked = undefined;
    publish({
      ...restored,
      gate: "ready",
      busy: false,
      error: id.success ? null : "사건 주소를 확인해 주세요.",
    });
    if (id.success) {
      renew();
      void refresh();
    }
  }
  async function submit(pending: Pending) {
    if (state.gate !== "ready" || state.busy || state.conflict || !id.success) return;
    if (!client) renew();
    const api = client,
      captured = version;
    if (!api) return;
    cancelPoll?.();
    publish({ ...state, pending, busy: true, error: null });
    try {
      const value =
        pending.kind === "message"
          ? await api.sendMessage(id.data, pending.input)
          : pending.kind === "retry"
            ? await api.retryMessage(id.data, pending.id, pending.revision)
            : pending.kind === "action"
              ? await api.setAction(id.data, pending.id, pending.done, pending.revision)
              : await api.saveTimeline(id.data, pending.entry);
      if (current(captured)) {
        publish({ ...state, pending: null });
        apply(value);
      }
    } catch (cause) {
      fail(captured, cause);
    }
  }
  const editable = () => state.gate === "ready" && !state.busy && !state.pending && !state.conflict;
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      const unsubscribe = dependencies.session.subscribe(sync);
      sync();
      return () => {
        unsubscribe();
        // A blurred route cannot observe logout/account changes. Never restore an unwatched draft.
        parked = undefined;
        owner = undefined;
        retire();
        publish(empty());
      };
    },
    refresh,
    setText(text: string) {
      if (editable()) publish({ ...state, text });
    },
    selectFile(fileId: string) {
      if (
        !editable() ||
        !state.value?.files.some((file) => file.id === fileId && file.status === "ready")
      )
        return;
      const selectedFileIds = state.selectedFileIds.includes(fileId)
        ? state.selectedFileIds.filter((value) => value !== fileId)
        : [...state.selectedFileIds, fileId];
      if (selectedFileIds.length <= 100) publish({ ...state, selectedFileIds });
    },
    send() {
      const value = state.value;
      if (
        !editable() ||
        !value ||
        value.case.schemaVersion !== "2" ||
        value.case.stage !== "active" ||
        value.case.summaryNeedsConfirmation ||
        value.messages.some((message) => message.status === "pending") ||
        !state.text.trim() ||
        state.text.length > 10000
      )
        return Promise.resolve();
      return submit({
        kind: "message",
        input: {
          expectedRevision: value.case.revision,
          text: state.text.trim(),
          selectedFileIds: [...state.selectedFileIds],
        },
      });
    },
    retry(messageId: string) {
      const value = state.value;
      if (
        !editable() ||
        value?.case.stage === "archived" ||
        !value?.messages.some(
          (message) => message.id === messageId && message.status === "failed" && message.retryable,
        )
      )
        return Promise.resolve();
      return submit({ kind: "retry", id: messageId, revision: value.case.revision });
    },
    replay() {
      return state.pending ? submit(state.pending) : Promise.resolve();
    },
    setAction(action: ActionView) {
      if (
        !editable() ||
        state.value?.case.stage === "archived" ||
        action.revision === undefined ||
        !state.value?.actions.some(
          (value) => value.id === action.id && value.revision === action.revision,
        )
      )
        return Promise.resolve();
      return submit({
        kind: "action",
        id: action.id,
        revision: action.revision,
        done: !action.done,
      });
    },
    editTimeline(entry?: TimelineView) {
      if (
        !editable() ||
        !state.value ||
        state.value.case.schemaVersion !== "2" ||
        state.value.case.stage === "archived"
      )
        return;
      if (entry && entry.revision === undefined) return;
      publish({
        ...state,
        timeline: entry
          ? { ...entry, expectedRevision: entry.revision as number }
          : {
              date: "",
              datePrecision: "unknown",
              title: "",
              detail: "",
              expectedRevision: state.value.case.revision,
            },
      });
    },
    changeTimeline(
      fields: Partial<Pick<TimelineView, "date" | "datePrecision" | "title" | "detail">>,
    ) {
      if (editable() && state.timeline)
        publish({ ...state, timeline: { ...state.timeline, ...fields } });
    },
    closeTimeline() {
      if (editable()) publish({ ...state, timeline: null });
    },
    saveTimeline() {
      const entry = state.timeline;
      if (!editable() || !entry) return Promise.resolve();
      const parsed = v2TimelineEditRequestSchema.safeParse({
        expectedRevision: entry.expectedRevision,
        date: entry.date || null,
        datePrecision: entry.datePrecision ?? "unknown",
        event: entry.detail ? `${entry.title}\n${entry.detail}` : entry.title,
      });
      if (!parsed.success) {
        publish({
          ...state,
          error:
            "날짜와 정밀도, 기록 내용을 확인해 주세요. 월은 YYYY-MM-01, 연도는 YYYY-01-01로 입력해 주세요.",
        });
        return Promise.resolve();
      }
      return submit({ kind: "timeline", entry: { ...entry } });
    },
    async more(collection: WorkspaceCollection) {
      if (
        state.gate !== "ready" ||
        state.busy ||
        !state.value?.pagination?.[collection] ||
        !client ||
        !id.success
      )
        return;
      const api = client,
        captured = version;
      cancelPoll?.();
      publish({ ...state, busy: true, error: null });
      try {
        const value = await api.loadMore(id.data, collection);
        if (current(captured)) apply(value);
      } catch (cause) {
        fail(captured, cause);
      }
    },
    cancel() {
      if (state.gate !== "ready") return;
      renew();
      publish({
        ...state,
        busy: false,
        error: "요청을 중단했어요. 결과가 불확실한 요청은 같은 요청으로 다시 확인해 주세요.",
      });
    },
  };
}
export type WorkspaceModel = ReturnType<typeof createWorkspaceModel>;
