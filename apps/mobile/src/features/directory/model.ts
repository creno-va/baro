import { ApiError, type createDirectoryClient, errorMessage } from "@baro/api-client";
import type { DirectoryItem } from "@baro/contracts/v2/directory";

export interface DirectoryState {
  phase: "idle" | "loading" | "ready" | "error";
  query: string;
  items: DirectoryItem[];
  nextCursor: string | null;
  loadingMore: boolean;
  error: string | null;
}

export function createDirectoryModel(client: ReturnType<typeof createDirectoryClient>) {
  let state: DirectoryState = {
    phase: "idle",
    query: "",
    items: [],
    nextCursor: null,
    loadingMore: false,
    error: null,
  };
  const subscribers = new Set<() => void>();
  let generation = 0;
  let controller: AbortController | undefined;
  let retry: { query: string; append: boolean } | undefined;
  const publish = (next: DirectoryState) => {
    state = next;
    for (const notify of subscribers) notify();
  };
  async function load(query: string, append: boolean) {
    const cursor = append ? state.nextCursor : undefined;
    if (append && (!cursor || state.phase === "loading")) return;
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    const current = ++generation;
    retry = { query, append };
    publish({
      ...state,
      query,
      phase: "loading",
      loadingMore: append,
      error: null,
      ...(!append && query !== state.query ? { items: [], nextCursor: null } : {}),
    });
    try {
      const page = await client.listPage({ query }, cursor ?? undefined, signal);
      if (signal.aborted || current !== generation) return;
      const items = append ? [...state.items, ...page.items] : page.items;
      publish({
        ...state,
        phase: "ready",
        items: [...new Map(items.map((item) => [item.id, item])).values()],
        nextCursor: page.nextCursor,
        loadingMore: false,
        error: null,
      });
    } catch (error) {
      if (signal.aborted || current !== generation) return;
      if (append && error instanceof ApiError && error.code === "VALIDATION_ERROR")
        retry = { query, append: false };
      publish({ ...state, phase: "error", error: errorMessage(error), loadingMore: false });
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(notify: () => void) {
      subscribers.add(notify);
      return () => {
        subscribers.delete(notify);
      };
    },
    search: (query: string) => load(query.trim(), false),
    more: () => load(state.query, true),
    retry: () => (retry ? load(retry.query, retry.append) : load(state.query, false)),
    stop() {
      generation++;
      controller?.abort();
    },
  };
}
