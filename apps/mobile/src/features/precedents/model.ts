import { ApiError, type createPrecedentsClient, errorMessage } from "@baro/api-client";
import { opaqueIdSchema } from "@baro/contracts/common";
import {
  type V2PrecedentReadResponse,
  type V2PrecedentResearchContext,
  type V2PrecedentSearchResponse,
  type V2PrecedentTopic,
  v2PrecedentTopicSchema,
} from "@baro/contracts/v2/precedent-research";
import type { SessionModel, SessionState } from "../session/model";

type Client = ReturnType<typeof createPrecedentsClient>;
export interface PrecedentsState {
  gate: "checking" | "login" | "consent" | "role" | "ready" | "error";
  context: V2PrecedentResearchContext | null;
  topics: V2PrecedentTopic[];
  result: V2PrecedentSearchResponse | null;
  article: V2PrecedentReadResponse | null;
  busy: "context" | "search" | "read" | "open" | null;
  conflict: boolean;
  error: string | null;
}
const empty = (): PrecedentsState => ({
  gate: "checking",
  context: null,
  topics: [],
  result: null,
  article: null,
  busy: null,
  conflict: false,
  error: null,
});
function access(state: SessionState): PrecedentsState["gate"] {
  if (state.phase === "error") return "error";
  if (state.phase === "anonymous") return "login";
  if (state.phase === "consent" || state.session?.needsConsent) return "consent";
  if (state.phase !== "ready" || !state.session?.user) return "checking";
  return state.session.user.accountType === "customer" ? "ready" : "role";
}
export function createPrecedentsModel(dependencies: {
  caseId: string;
  session: Pick<SessionModel, "getSnapshot" | "subscribe" | "refresh">;
  createClient(signal: AbortSignal, ownerId: string): Client;
  openUrl(url: string): Promise<unknown>;
}) {
  const parsed = opaqueIdSchema.safeParse(dependencies.caseId);
  let state = empty(),
    active = false,
    owner: string | undefined,
    version = 0,
    sequence = 0;
  let controller: AbortController | undefined,
    operation: AbortController | undefined,
    client: Client | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: PrecedentsState) => {
    state = next;
    for (const notify of listeners) notify();
  };
  const retire = () => {
    version++;
    sequence++;
    operation?.abort();
    controller?.abort();
    client = undefined;
  };
  const begin = () => {
    operation?.abort();
    operation = new AbortController();
    const signal = operation.signal,
      captured = version,
      request = ++sequence;
    return {
      signal,
      current: () =>
        active &&
        state.gate === "ready" &&
        captured === version &&
        request === sequence &&
        !signal.aborted &&
        !controller?.signal.aborted,
    };
  };
  function fail(error: unknown) {
    if (error instanceof ApiError && ["UNAUTHENTICATED", "CONSENT_REQUIRED"].includes(error.code)) {
      retire();
      owner = undefined;
      publish(empty());
      void dependencies.session.refresh();
      return;
    }
    const conflict = error instanceof ApiError && error.code === "CONFLICT";
    publish({
      ...state,
      context: null,
      result: null,
      article: null,
      busy: null,
      conflict,
      error: conflict
        ? "사건이나 요약이 바뀌었어요. 최신 요약을 확인한 뒤 검색 조건을 다시 불러와 주세요."
        : errorMessage(error),
    });
  }
  async function refresh() {
    if (!active || state.gate !== "ready" || !client || !parsed.success) return;
    const api = client,
      request = begin(),
      selected = [...state.topics];
    publish({
      ...state,
      context: null,
      result: null,
      article: null,
      busy: "context",
      error: null,
      conflict: false,
    });
    try {
      const context = await api.context(parsed.data, request.signal);
      if (!request.current()) return;
      publish({
        ...state,
        context,
        topics: selected.length ? selected : context.recommendedTopics.slice(0, 2),
        busy: null,
      });
    } catch (error) {
      if (request.current()) fail(error);
    }
  }
  function observe() {
    if (!active) return;
    const session = dependencies.session.getSnapshot(),
      gate = access(session),
      nextOwner = session.session?.user?.id;
    if (gate !== "ready" || !nextOwner || !parsed.success) {
      retire();
      owner = undefined;
      publish({
        ...empty(),
        gate: parsed.success ? gate : "error",
        ...(!parsed.success ? { error: "사건 주소를 확인해 주세요." } : {}),
      });
      return;
    }
    if (owner === nextOwner && client) return;
    retire();
    owner = nextOwner;
    controller = new AbortController();
    publish({ ...empty(), gate: "ready" });
    try {
      client = dependencies.createClient(controller.signal, owner);
      void refresh();
    } catch {
      publish({ ...empty(), gate: "error", error: "이용 상태를 확인하지 못했어요." });
    }
  }
  async function search() {
    if (
      !active ||
      state.gate !== "ready" ||
      !state.context ||
      !client ||
      !parsed.success ||
      !state.topics.length
    )
      return;
    const api = client,
      basis = state.context,
      topics = [...state.topics],
      request = begin();
    publish({ ...state, result: null, article: null, busy: "search", error: null });
    try {
      const result = await api.search(
        parsed.data,
        {
          expectedRevision: basis.workspaceRevision,
          summaryRevision: basis.summaryRevision,
          topics,
        },
        request.signal,
      );
      if (!request.current()) return;
      if (
        result.workspaceRevision !== basis.workspaceRevision ||
        result.summaryRevision !== basis.summaryRevision ||
        JSON.stringify([...result.topics].sort()) !== JSON.stringify([...topics].sort())
      )
        throw new ApiError("CONFLICT", "검색 기준이 바뀌었어요.");
      publish({ ...state, result, busy: null });
    } catch (error) {
      if (request.current()) fail(error);
    }
  }
  async function read(id: string, open = false) {
    if (!active || state.gate !== "ready" || !client || !parsed.success || !state.result) return;
    const item = state.result.items.find((value) => value.id === id);
    if (!item) return;
    const api = client,
      basis = state.result,
      request = begin();
    publish({ ...state, article: null, busy: open ? "open" : "read", error: null });
    try {
      const article = await api.read(
        parsed.data,
        { expectedRevision: basis.workspaceRevision, readToken: item.readToken },
        request.signal,
      );
      if (!request.current()) return;
      if (
        article.workspaceRevision !== basis.workspaceRevision ||
        article.citation.id !== item.id ||
        article.citation.sourceId !== item.citation.sourceId ||
        article.citation.contentHash !== item.citation.contentHash ||
        article.citation.officialId !== item.citation.officialId ||
        article.citation.url !== item.citation.url ||
        !/^\d{1,12}$/.test(article.citation.officialId) ||
        article.citation.url !==
          `https://www.law.go.kr/LSW/precInfoP.do?precSeq=${article.citation.officialId}`
      )
        throw new ApiError("CONFLICT", "출처가 바뀌었어요.");
      publish({ ...state, article });
      if (open) {
        if (!request.current()) return;
        try {
          await dependencies.openUrl(article.citation.url);
        } catch {
          if (request.current())
            publish({
              ...state,
              busy: null,
              error: "공식 원문을 열지 못했어요. 기기의 브라우저를 확인해 주세요.",
            });
          return;
        }
      }
      if (request.current()) publish({ ...state, busy: null });
    } catch (error) {
      if (request.current()) fail(error);
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    start() {
      active = true;
      const unsubscribe = dependencies.session.subscribe(observe);
      observe();
      return () => {
        active = false;
        unsubscribe();
        retire();
        owner = undefined;
        publish(empty());
      };
    },
    refresh,
    search,
    read: (id: string) => read(id),
    openOfficial: (id: string) => read(id, true),
    select(topic: V2PrecedentTopic) {
      if (
        !active ||
        state.gate !== "ready" ||
        !state.context ||
        !v2PrecedentTopicSchema.safeParse(topic).success
      )
        return;
      const topics = state.topics.includes(topic)
        ? state.topics.filter((value) => value !== topic)
        : [...state.topics, topic];
      if (topics.length > 2) {
        publish({ ...state, error: "검색 주제는 최대 2개를 선택해 주세요." });
        return;
      }
      operation?.abort();
      sequence++;
      publish({ ...state, topics, result: null, article: null, busy: null, error: null });
    },
    cancel() {
      operation?.abort();
      sequence++;
      publish({ ...state, busy: null, article: null, error: null });
    },
  };
}
export type PrecedentsModel = ReturnType<typeof createPrecedentsModel>;
