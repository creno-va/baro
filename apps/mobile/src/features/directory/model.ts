import {
  ApiError,
  type createDirectoryClient,
  type DirectoryFilters,
  errorMessage,
} from "@baro/api-client";
import type { DirectoryItem } from "@baro/contracts/v2/directory";

export interface DirectoryState {
  phase: "idle" | "loading" | "ready" | "error";
  query: string;
  region: string;
  practiceArea: string;
  items: DirectoryItem[];
  nextCursor: string | null;
  loadingMore: boolean;
  error: string | null;
}

export function createDirectoryModel(client: ReturnType<typeof createDirectoryClient>) {
  let state: DirectoryState = {
    phase: "idle",
    query: "",
    region: "",
    practiceArea: "",
    items: [],
    nextCursor: null,
    loadingMore: false,
    error: null,
  };
  const subscribers = new Set<() => void>();
  let generation = 0;
  let controller: AbortController | undefined;
  let retry: { filters: DirectoryFilters; append: boolean } | undefined;
  const publish = (next: DirectoryState) => {
    state = next;
    for (const notify of subscribers) notify();
  };
  async function load(filters: DirectoryFilters, append: boolean) {
    const query = filters.query?.trim() ?? "",
      region = filters.region ?? "",
      practiceArea = filters.practiceArea ?? "";
    filters = { query, region, practiceArea };
    const cursor = append ? state.nextCursor : undefined;
    if (append && (!cursor || state.phase === "loading")) return;
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    const current = ++generation;
    retry = { filters, append };
    publish({
      ...state,
      query,
      region,
      practiceArea,
      phase: "loading",
      loadingMore: append,
      error: null,
      ...(!append ? { items: [], nextCursor: null } : {}),
    });
    try {
      const page = await client.listPage(filters, cursor ?? undefined, signal);
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
        retry = { filters, append: false };
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
    search: (filters: string | DirectoryFilters) =>
      load(typeof filters === "string" ? { query: filters } : filters, false),
    refresh: () =>
      load({ query: state.query, region: state.region, practiceArea: state.practiceArea }, false),
    more: () =>
      load({ query: state.query, region: state.region, practiceArea: state.practiceArea }, true),
    retry: () => (retry ? load(retry.filters, retry.append) : load({}, false)),
    stop() {
      generation++;
      controller?.abort();
    },
  };
}
