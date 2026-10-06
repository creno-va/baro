import { ApiError } from "../errors";
import type { SessionView } from "../types";
// biome-ignore lint/suspicious/noExplicitAny: Each domain owns input validation at the registered API boundary.
export type MockHandler = (input: any, context: { key: string }) => unknown | Promise<unknown>;
const handlers = new Map<string, MockHandler>();
const memory = new Map<string, string>();
const prefix = "baro-api-mock-v1:";
export function registerMockHandlers(entries: Record<string, MockHandler>) {
  for (const [operation, handler] of Object.entries(entries)) handlers.set(operation, handler);
}
export function readStore<T>(namespace: string, fallback: T): T {
  try {
    const value =
      typeof localStorage === "undefined"
        ? memory.get(namespace)
        : localStorage.getItem(prefix + namespace);
    return value ? (JSON.parse(value) as T) : structuredClone(fallback);
  } catch {
    return structuredClone(fallback);
  }
}
export function writeStore<T>(namespace: string, value: T): void {
  const json = JSON.stringify(value);
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(prefix + namespace, json);
    else memory.set(namespace, json);
  } catch {
    throw new ApiError("QUOTA_EXCEEDED", "예시 저장 공간이 부족해요. 저장한 자료를 정리해 주세요.");
  }
}
export function updateStore<T>(namespace: string, fallback: T, update: (value: T) => T): T {
  const next = update(readStore(namespace, fallback));
  writeStore(namespace, next);
  return next;
}
export function requireSession(): SessionView {
  const session = readStore<SessionView>("session", { user: null, needsConsent: false });
  if (!session.user || readStore<string[]>("deletedAccountIds", []).includes(session.user.id))
    throw new ApiError("UNAUTHENTICATED", "로그인이 필요해요.");
  if (session.needsConsent)
    throw new ApiError("CONSENT_REQUIRED", "시작 전에 필수 확인을 완료해 주세요.");
  return session;
}
const replay = new Map<string, { input: string; value: unknown }>();
export async function mockRequest<T>(operation: string, input: unknown, key: string): Promise<T> {
  const handler = handlers.get(operation);
  if (!handler)
    throw new ApiError(
      "UNAVAILABLE",
      "이 기능을 연결하고 있어요. 잠시 뒤 다시 시도해 주세요.",
      true,
    );
  const identity = `${readStore<SessionView>("session", { user: null, needsConsent: false }).user?.id ?? "visitor"}:${operation}:${key}`;
  const cacheable =
    /\.(create|saveAnswers|saveSummary|confirmSummary|advance|sendMessage|retryMessage|setAction|saveTimeline|upload|retry|remove|save|generate|deleteCase|deleteAccount|saveMine|publishMine)$/.test(
      operation,
    );
  const previous = cacheable ? replay.get(identity) : undefined,
    fingerprint = JSON.stringify(input ?? null);
  if (previous && /^(cases|workspace|files|reports)\./.test(operation)) {
    const session = requireSession();
    const id =
      (input as { id?: string } | undefined)?.id ??
      (previous.value as { id?: string } | undefined)?.id;
    if (
      id &&
      (readStore<string[]>("deletedCaseIds", []).includes(id) ||
        readStore<Record<string, string>>("caseOwners", {})[id] !== session.user?.id)
    )
      throw new ApiError("NOT_FOUND", "삭제했거나 접근할 수 없는 사건이에요.");
  }
  if (previous) {
    if (previous.input !== fingerprint)
      throw new ApiError("CONFLICT", "같은 요청에 다른 내용이 포함됐어요.");
    return structuredClone(previous.value) as T;
  }
  const value = await handler(input, { key });
  if (cacheable) {
    replay.set(identity, { input: fingerprint, value });
    if (replay.size > 100) replay.delete(replay.keys().next().value ?? "");
  }
  return value as T;
}
export function clearMockStore() {
  memory.clear();
  replay.clear();
  if (typeof localStorage !== "undefined")
    for (const key of Object.keys(localStorage))
      if (key.startsWith(prefix)) localStorage.removeItem(key);
}

export type AggregateMockState = Record<string, unknown> & {
  session: SessionView;
  cases: Record<string, import("../types").CaseView>;
  workspace: Record<string, unknown>;
  files: Record<string, import("../types").FileView[]>;
  reports: Record<string, import("../types").ReportView>;
};
function storeNamespaces(): string[] {
  const names = new Set(memory.keys());
  if (typeof localStorage !== "undefined")
    for (const key of Object.keys(localStorage))
      if (key.startsWith(prefix)) names.add(key.slice(prefix.length));
  return [...names];
}
export const mockRuntime = {
  read(): AggregateMockState {
    const state: AggregateMockState = {
      session: { user: null, needsConsent: false },
      cases: {},
      workspace: {},
      files: {},
      reports: {},
    };
    for (const namespace of storeNamespaces()) state[namespace] = readStore(namespace, null);
    return state;
  },
  update<T>(mutate: (state: AggregateMockState) => T): T {
    const state = mockRuntime.read();
    const previous = storeNamespaces();
    const result = mutate(state);
    for (const namespace of previous)
      if (!(namespace in state)) {
        memory.delete(namespace);
        if (typeof localStorage !== "undefined") localStorage.removeItem(prefix + namespace);
      }
    for (const [namespace, value] of Object.entries(state)) writeStore(namespace, value);
    return result;
  },
};
