import { ApiError, errorMessage, type MobileAuthClient } from "@baro/api-client";
import type { MobileProvider } from "@baro/client-core";
import type { MobileConfig } from "../../../config/environment";
import { parseNativeAuthReturn } from "../../platform/auth/attempt";
import type { NativeDeletion, NativeDeletionResult } from "../../platform/auth/deletion";
import type {
  DeletionAttemptRecord,
  DeletionAttemptStore,
} from "../../platform/auth/deletion-attempt";
import type { SessionModel } from "../session/model";

export interface DeletionHistory {
  attemptId: string;
  relation: "current" | "previous" | "unverified";
  state: "pending" | "accepted" | "cancelled";
  cleanup?: "pending" | "complete" | "skipped" | "failed";
  appleRevocation?: "not_linked" | "confirmed" | "unconfirmed";
  localSaved: boolean;
}
export interface AccountDeletionState {
  gate: "checking" | "ready" | "login" | "legacy" | "error";
  accountName: string | null;
  providers: MobileProvider[];
  provider: MobileProvider | null;
  confirmation: string;
  busy: "authorizing" | "result" | "cancel" | "cleanup" | null;
  loading: boolean;
  anonymous: boolean;
  hasOpenRequest: boolean;
  history: DeletionHistory[];
  error: string | null;
  storageError: string | null;
}
type Fact = Omit<DeletionHistory, "relation"> & { ownerId: string };
const initial = (): AccountDeletionState => ({
  gate: "checking",
  accountName: null,
  providers: [],
  provider: null,
  confirmation: "",
  busy: null,
  loading: false,
  anonymous: false,
  hasOpenRequest: false,
  history: [],
  error: null,
  storageError: null,
});
export function createAccountDeletionModel(dependencies: {
  config: MobileConfig;
  session: Pick<SessionModel, "getSnapshot" | "subscribe" | "refresh">;
  client: MobileAuthClient;
  native: NativeDeletion & { clearAnonymousDevice(attemptId: string): Promise<void> };
  attempts: DeletionAttemptStore;
  openAppleHelp(): Promise<void>;
}) {
  let state = initial(),
    active = false,
    version = 0,
    recordVersion = 0,
    watching = 0;
  let refreshVersion = 0;
  let identity: string | undefined, stopSession: (() => void) | undefined;
  let working = false,
    authorizing = false,
    incoming = 0;
  let actionKind: AccountDeletionState["busy"] = null;
  let activeView: symbol | undefined;
  let facts = new Map<string, Fact>();
  const unsaved = new Map<string, Fact>(),
    listeners = new Set<() => void>();
  const owner = () => {
    const session = dependencies.session.getSnapshot();
    return ["ready", "consent"].includes(session.phase) ? session.session?.user : undefined;
  };
  const publish = (next: AccountDeletionState) => {
    const user = owner();
    state = {
      ...next,
      busy: working ? actionKind : incoming ? "result" : authorizing ? "authorizing" : null,
      anonymous: dependencies.session.getSnapshot().phase === "anonymous",
      hasOpenRequest: [...facts.values()].some(
        (record) => record.ownerId === user?.id && record.state !== "cancelled",
      ),
      history: [...facts.values()].map(({ ownerId, ...record }) => ({
        ...record,
        relation: !user ? "unverified" : ownerId === user.id ? "current" : "previous",
      })),
    };
    for (const listener of listeners) listener();
  };
  const idle = () => (authorizing ? ("authorizing" as const) : null);
  const protectedWork = () => working || authorizing || incoming > 0;
  const readRecords = async () => {
    const captured = ++recordVersion;
    try {
      const records = await dependencies.attempts.list();
      if (captured !== recordVersion) return;
      facts = new Map(
        records.map((record): [string, Fact] => [
          record.attemptId,
          {
            attemptId: record.attemptId,
            ownerId: record.ownerId,
            state: record.state,
            localSaved: true,
            ...(record.state === "accepted"
              ? { cleanup: record.cleanup, appleRevocation: record.outcome.appleRevocation }
              : {}),
          },
        ]),
      );
      for (const [id, record] of unsaved) facts.set(id, record);
      publish({ ...state, storageError: null });
    } catch (error) {
      if (captured === recordVersion) publish({ ...state, storageError: errorMessage(error) });
    }
  };
  const receiveResult = async (result: NativeDeletionResult) => {
    if (result.type === "accepted") {
      const fact: Fact = {
        attemptId: result.attemptId,
        ownerId: result.ownerId,
        state: "accepted",
        cleanup: result.cleanup,
        appleRevocation: result.outcome.appleRevocation,
        localSaved: result.localSaved,
      };
      if (!result.localSaved) unsaved.set(result.attemptId, fact);
      else unsaved.delete(result.attemptId);
      facts.set(result.attemptId, fact);
      publish({ ...state, confirmation: "" });
    } else if (result.type === "unknown") {
      publish({
        ...state,
        confirmation: "",
        error:
          "삭제 결과를 확인하지 못했어요. 자동으로 다시 요청하지 않아요. 저장된 요청의 결과나 취소 상태를 다시 확인해 주세요.",
      });
    }
    await readRecords();
  };
  async function refresh() {
    const requestedVersion = version,
      refresh = ++refreshVersion;
    await readRecords();
    if (
      !active ||
      requestedVersion !== version ||
      refresh !== refreshVersion ||
      protectedWork() ||
      state.loading
    )
      return;
    const user = owner();
    if (!user) {
      const phase = dependencies.session.getSnapshot().phase;
      publish({
        ...state,
        gate:
          phase === "checking" || phase === "authorizing"
            ? "checking"
            : phase === "error"
              ? "error"
              : "login",
        accountName: null,
        providers: [],
        provider: null,
        confirmation: "",
      });
      return;
    }
    const captured = ++version;
    publish({
      ...state,
      gate: "checking",
      accountName: null,
      providers: [],
      provider: null,
      confirmation: "",
      loading: true,
      error: null,
    });
    let privateRead = false;
    try {
      const protocol = await dependencies.client.capabilities();
      if (!active || captured !== version || owner()?.id !== user.id) return;
      if (protocol.contractVersion === 1) {
        publish({ ...state, gate: "legacy", accountName: user.name, loading: false });
        return;
      }
      privateRead = true;
      const access = await dependencies.client.deletionAccess(protocol, user.id);
      if (!active || captured !== version || owner()?.id !== user.id) return;
      const providers = access.providers.filter((provider) =>
        protocol.providers.some((value) => value === provider),
      );
      publish({
        ...state,
        gate: "ready",
        accountName: user.name,
        providers,
        provider: providers.length === 1 ? (providers[0] ?? null) : null,
        loading: false,
      });
    } catch (error) {
      if (!active || captured !== version) return;
      publish({
        ...state,
        gate: "error",
        accountName: null,
        providers: [],
        provider: null,
        loading: false,
        error: errorMessage(error),
      });
      if (privateRead && error instanceof ApiError && error.code === "UNAUTHENTICATED")
        void dependencies.session.refresh();
    }
  }
  const observe = () => {
    const session = dependencies.session.getSnapshot(),
      user = owner();
    const next = user
      ? `${user.id}:${user.accountType}:${session.session?.needsConsent}`
      : session.phase;
    if (identity === next) return;
    identity = next;
    version++;
    publish({
      ...state,
      gate:
        user || session.phase === "checking" || session.phase === "authorizing"
          ? "checking"
          : session.phase === "error"
            ? "error"
            : "login",
      accountName: null,
      providers: [],
      provider: null,
      confirmation: "",
      loading: false,
    });
    if (active && !protectedWork()) void refresh();
  };
  const watchSession = () => {
    watching++;
    if (!stopSession) {
      stopSession = dependencies.session.subscribe(observe);
      observe();
    }
    let live = true;
    return () => {
      if (!live) return;
      live = false;
      if (--watching === 0) {
        stopSession?.();
        stopSession = undefined;
      }
    };
  };
  const act = async (
    kind: "result" | "cancel" | "cleanup",
    attemptId: string,
    task: () => Promise<NativeDeletionResult> | Promise<void>,
  ) => {
    if (working || incoming || !facts.has(attemptId)) return;
    actionKind = kind;
    working = true;
    publish({ ...state, busy: kind, error: null });
    try {
      const result = await task();
      if (result) await receiveResult(result);
      else await readRecords();
    } catch (error) {
      publish({ ...state, error: errorMessage(error) });
      await readRecords();
    } finally {
      working = false;
      actionKind = null;
      publish({ ...state, busy: idle() });
    }
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    watchSession,
    activate() {
      const view = Symbol();
      activeView = view;
      const stop = watchSession();
      active = true;
      void refresh();
      return () => {
        if (activeView !== view) {
          stop();
          return;
        }
        activeView = undefined;
        active = false;
        version++;
        publish({
          ...state,
          gate: "checking",
          accountName: null,
          providers: [],
          provider: null,
          confirmation: "",
          loading: false,
        });
        stop();
      };
    },
    refresh,
    select(provider: MobileProvider) {
      if (!protectedWork() && state.gate === "ready" && state.providers.includes(provider))
        publish({ ...state, provider, confirmation: "" });
    },
    confirm(value: string) {
      if (!protectedWork() && state.gate === "ready")
        publish({ ...state, confirmation: value.slice(0, 6) });
    },
    async startDeletion() {
      const user = owner(),
        provider = state.provider;
      if (
        !active ||
        protectedWork() ||
        state.loading ||
        state.storageError ||
        state.gate !== "ready" ||
        !user ||
        !provider ||
        !state.providers.includes(provider) ||
        state.confirmation !== "DELETE" ||
        state.hasOpenRequest ||
        facts.size >= 4
      )
        return;
      authorizing = true;
      publish({ ...state, busy: "authorizing", error: null });
      try {
        await receiveResult(await dependencies.native.start(provider, "DELETE", user.id));
      } catch (error) {
        publish({ ...state, error: errorMessage(error) });
        await readRecords();
      } finally {
        authorizing = false;
        publish({ ...state, busy: null, confirmation: "" });
        void dependencies.session.refresh();
      }
    },
    checkResult: (attemptId: string) =>
      act("result", attemptId, () => dependencies.native.status(attemptId)),
    cancelAttempt: (attemptId: string) =>
      act("cancel", attemptId, () => dependencies.native.cancel(attemptId)),
    async clearAnonymous(attemptId: string) {
      if (!state.anonymous || facts.get(attemptId)?.state !== "accepted") return;
      await act("cleanup", attemptId, () => dependencies.native.clearAnonymousDevice(attemptId));
    },
    acknowledge: (attemptId: string) =>
      act("result", attemptId, async () => {
        if (authorizing) return;
        await dependencies.attempts.acknowledge(attemptId);
        unsaved.delete(attemptId);
        facts.delete(attemptId);
      }),
    async receiveReturn(raw: string) {
      const returned = parseNativeAuthReturn(raw, dependencies.config);
      if (!returned) return false;
      let records: DeletionAttemptRecord[];
      try {
        records = await dependencies.attempts.list();
      } catch (error) {
        publish({ ...state, storageError: errorMessage(error) });
        return false;
      }
      if (!records.some((record) => record.attemptId === returned.attemptId)) return false;
      incoming++;
      publish({ ...state, busy: "result", error: null });
      try {
        await receiveResult(await dependencies.native.complete(raw));
      } catch (error) {
        publish({ ...state, error: errorMessage(error) });
      } finally {
        incoming--;
        publish({ ...state, busy: idle() });
      }
      return true;
    },
    async openAppleHelp() {
      try {
        await dependencies.openAppleHelp();
      } catch {
        publish({
          ...state,
          error: "Apple 계정 관리 안내를 열지 못했어요. 연결과 브라우저를 확인해 주세요.",
        });
      }
    },
  };
}
export type AccountDeletionModel = ReturnType<typeof createAccountDeletionModel>;
