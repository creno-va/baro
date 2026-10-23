import { ApiError, errorMessage, type UsageSummary } from "@baro/api-client";
import type { AccountType, Provider } from "@baro/client-core";
import type { createNativeAccountClient } from "../../platform/account/client";
import type { SessionModel } from "../session/model";

type Client = ReturnType<typeof createNativeAccountClient>;
export interface SettingsState {
  gate: "checking" | "login" | "ready" | "error";
  profile: { name: string; role: AccountType } | null;
  needsConsent: boolean;
  usage: UsageSummary | null;
  usageBusy: boolean;
  usageError: string | null;
  deletion: { providers: Provider[]; canDelete: boolean } | null;
  deletionState: "none" | "unconfirmed" | "accepted" | null;
  deletionBusy: boolean;
  action: "delete" | "reauthenticate" | null;
  confirmation: string;
  notice: "accepted" | "cleanup-failed" | "unconfirmed" | null;
  error: string | null;
  policyError: string | null;
}
const empty = (): SettingsState => ({
  gate: "checking",
  profile: null,
  needsConsent: false,
  usage: null,
  usageBusy: false,
  usageError: null,
  deletion: null,
  deletionState: null,
  deletionBusy: false,
  action: null,
  confirmation: "",
  notice: null,
  error: null,
  policyError: null,
});
export function createSettingsModel(dependencies: {
  session: Pick<SessionModel, "getSnapshot" | "subscribe" | "refresh">;
  openPolicy(policy: "terms" | "privacy" | "ai"): Promise<unknown>;
  createClient(
    signal: AbortSignal,
    ownerId: string,
    onAccepted: (receipt: { ownerId: string }) => void,
  ): Client;
}) {
  let state = empty(),
    active = false,
    version = 0,
    identity: string | undefined;
  let policyRequest = 0;
  let client: Client | undefined, controller: AbortController | undefined;
  let receipt:
    | { ownerId: string; notice: "accepted" | "cleanup-failed"; cleaning: boolean }
    | undefined;
  let uncertainOwner: string | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: SettingsState) => {
    state = next;
    for (const notify of listeners) notify();
  };
  const retire = () => {
    version++;
    controller?.abort();
    client = undefined;
    identity = undefined;
  };
  const current = (captured: number) =>
    active && captured === version && !controller?.signal.aborted;
  const notice = () => receipt?.notice ?? (uncertainOwner ? "unconfirmed" : null);
  const acceptedReceipt = () => receipt;
  async function refresh() {
    if (
      !active ||
      state.gate !== "ready" ||
      !client ||
      state.action ||
      receipt ||
      state.usageBusy ||
      state.deletionBusy
    )
      return;
    const api = client,
      captured = version;
    publish({
      ...state,
      usage: null,
      usageBusy: !state.needsConsent,
      usageError: null,
      deletion: null,
      deletionState: null,
      deletionBusy: true,
      confirmation: "",
      error: null,
    });
    const lostAuth = () => {
      if (!current(captured) || receipt) return;
      retire();
      publish({ ...empty(), notice: notice() });
      void dependencies.session.refresh();
    };
    // Read durable facts before network IO: a fast 401 must not hide a known
    // unconfirmed intent, and an accepted record must not issue a new account read.
    let pending: SettingsState["deletionState"] = null;
    try {
      pending = await api.deletionState();
      if (!current(captured)) return;
      const ownerId = dependencies.session.getSnapshot().session?.user?.id;
      if (pending === "accepted") {
        if (ownerId) receipt = { ownerId, notice: "cleanup-failed", cleaning: false };
        publish({ ...empty(), gate: "ready", notice: notice(), deletionState: "accepted" });
        return;
      }
      uncertainOwner = pending === "unconfirmed" ? ownerId : undefined;
      publish({ ...state, deletionState: pending, notice: notice() });
    } catch (error) {
      if (!current(captured)) return;
      if (error instanceof ApiError && error.code === "UNAUTHENTICATED") {
        lostAuth();
        return;
      }
      publish({ ...state, deletionBusy: false, error: errorMessage(error) });
    }
    await Promise.all([
      state.needsConsent
        ? Promise.resolve()
        : api
            .usage()
            .then((usage) => {
              if (current(captured) && !receipt) publish({ ...state, usage, usageBusy: false });
            })
            .catch((error: unknown) => {
              if (!current(captured) || receipt) return;
              if (error instanceof ApiError && error.code === "UNAUTHENTICATED") {
                lostAuth();
                return;
              }
              publish({ ...state, usageBusy: false, usageError: errorMessage(error) });
            }),
      pending === null
        ? Promise.resolve()
        : api
            .deletionAccess()
            .then((access) => {
              if (!current(captured) || receipt) return;
              publish({
                ...state,
                deletion: { providers: [...access.providers], canDelete: access.canDelete },
                deletionState: pending,
                deletionBusy: false,
                notice: pending === "unconfirmed" ? "unconfirmed" : null,
              });
            })
            .catch((error: unknown) => {
              if (!current(captured) || receipt) return;
              if (error instanceof ApiError && error.code === "UNAUTHENTICATED") {
                lostAuth();
                return;
              }
              publish({ ...state, deletionBusy: false, error: errorMessage(error) });
            }),
    ]);
  }
  function observe() {
    if (!active) return;
    const session = dependencies.session.getSnapshot(),
      user = session.session?.user;
    if (user && receipt && user.id !== receipt.ownerId) receipt = undefined;
    if (user && uncertainOwner && user.id !== uncertainOwner) uncertainOwner = undefined;
    const ready = ["ready", "consent"].includes(session.phase) && user;
    if (!ready) {
      retire();
      publish({
        ...empty(),
        notice: notice(),
        gate:
          session.phase === "anonymous"
            ? "login"
            : session.phase === "error"
              ? "error"
              : "checking",
      });
      return;
    }
    const next = `${user.id}:${user.accountType}:${session.session?.needsConsent}`;
    if (identity === next && client) return;
    retire();
    identity = next;
    controller = new AbortController();
    const captured = version;
    publish({
      ...empty(),
      gate: "ready",
      notice: notice(),
      action: receipt?.cleaning ? "delete" : null,
      ...(receipt
        ? {}
        : {
            profile: { name: user.name, role: user.accountType },
            needsConsent: session.session?.needsConsent === true,
          }),
    });
    try {
      client = dependencies.createClient(controller.signal, user.id, (accepted) => {
        if (!current(captured) || accepted.ownerId !== user.id) return;
        receipt = { ownerId: user.id, notice: "accepted", cleaning: true };
        uncertainOwner = undefined;
        publish({
          ...empty(),
          gate: "ready",
          notice: "accepted",
          deletionState: "accepted",
          action: "delete",
        });
      });
      void refresh();
    } catch {
      publish({
        ...empty(),
        gate: "error",
        notice: notice(),
        error: "앱의 계정 저장 상태를 확인하지 못했어요.",
      });
    }
  }
  async function remove(retry: boolean) {
    if (
      !active ||
      state.gate !== "ready" ||
      !client ||
      state.action ||
      state.deletionBusy ||
      receipt ||
      state.confirmation !== "DELETE" ||
      !state.deletion?.canDelete ||
      (retry ? state.deletionState !== "unconfirmed" : state.deletionState !== "none")
    )
      return;
    const api = client,
      captured = version,
      ownerId = dependencies.session.getSnapshot().session?.user?.id;
    publish({ ...state, action: "delete", error: null });
    try {
      const result = await (retry
        ? api.retryUnconfirmed(state.confirmation)
        : api.deleteAccount(state.confirmation));
      // The ACK may outlive this screen's foreground epoch. Keep its cleanup result
      // only when the same accepted receipt still belongs to this operation's owner.
      const priorReceipt = acceptedReceipt();
      if (priorReceipt && priorReceipt.ownerId === ownerId) {
        receipt = {
          ownerId: priorReceipt.ownerId,
          notice: result.cleanupFailed ? "cleanup-failed" : "accepted",
          cleaning: false,
        };
        if (!current(captured) && active) publish({ ...state, notice: notice(), action: null });
      }
      if (!current(captured)) return;
      if (ownerId)
        receipt = {
          ownerId,
          notice: result.cleanupFailed ? "cleanup-failed" : "accepted",
          cleaning: false,
        };
      publish({ ...empty(), gate: "ready", notice: notice(), deletionState: "accepted" });
      void dependencies.session.refresh();
    } catch (error) {
      if (!current(captured)) return;
      // Inspect the durable intent; no network retry, timeout or anonymous read can prove success.
      let pending: SettingsState["deletionState"] = null;
      try {
        pending = await api.deletionState();
      } catch {
        /* Preserve uncertainty. */
      }
      if (!current(captured)) return;
      if (pending === "unconfirmed") uncertainOwner = ownerId;
      publish({
        ...state,
        action: null,
        confirmation: "",
        deletionState: pending,
        deletion: null,
        notice: pending === "unconfirmed" ? "unconfirmed" : null,
        error: errorMessage(error),
      });
      if (error instanceof ApiError && error.code === "UNAUTHENTICATED")
        void dependencies.session.refresh();
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
        policyRequest++;
        unsubscribe();
        retire();
        publish({ ...empty(), notice: notice() });
      };
    },
    refresh,
    confirm(value: string) {
      if (active && state.gate === "ready" && !state.action && !receipt)
        publish({ ...state, confirmation: value.slice(0, 6), error: null });
    },
    deleteAccount: () => remove(false),
    retryUnconfirmed: () => remove(true),
    async reauthenticate(provider: Provider) {
      if (
        !active ||
        state.gate !== "ready" ||
        !client ||
        state.action ||
        receipt ||
        !state.deletion?.providers.includes(provider)
      )
        return;
      const api = client,
        captured = version;
      publish({ ...state, action: "reauthenticate", confirmation: "", error: null });
      try {
        await api.reauthenticate(provider);
      } catch (error) {
        if (current(captured)) publish({ ...state, error: errorMessage(error) });
      }
      if (current(captured)) {
        publish({ ...state, action: null });
        await refresh();
      }
    },
    async openPolicy(policy: "terms" | "privacy" | "ai") {
      if (!active) return;
      const captured = ++policyRequest;
      publish({ ...state, policyError: null });
      try {
        await dependencies.openPolicy(policy);
      } catch {
        if (active && policyRequest === captured)
          publish({
            ...state,
            policyError: "정책 문서를 열지 못했어요. 기기의 연결과 브라우저를 확인해 주세요.",
          });
      }
    },
  };
}
export type SettingsModel = ReturnType<typeof createSettingsModel>;
