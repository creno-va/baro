import { expect, test } from "bun:test";
import { ApiError, type JsonRequestOptions } from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";
import type { SessionState } from "../apps/mobile/src/features/session/model";
import { createSettingsModel } from "../apps/mobile/src/features/settings/model";
import { createAccountCleanup } from "../apps/mobile/src/platform/account/cleanup";
import { createNativeAccountClient } from "../apps/mobile/src/platform/account/client";
import { createCaseOperationStorage } from "../apps/mobile/src/platform/storage/case-operations";
import { usage } from "./fixtures/contracts/v2";

const tag = "a".repeat(64),
  authAt = "2026-10-23T00:00:00.000Z";
const owner = (id = "owner_a", role: "customer" | "lawyer" = "customer"): SessionState => ({
  phase: "ready",
  role,
  session: { user: { id, name: `합성 ${id}`, accountType: role }, needsConsent: false },
  busy: false,
  consent: null,
  error: null,
});
const fingerprint = async (value: string) =>
  Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString(
    "hex",
  );
function deferred() {
  let resolve!: () => void;
  return {
    promise: new Promise<void>((done) => {
      resolve = done;
    }),
    resolve: () => resolve(),
  };
}
async function until(ready: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (ready()) return;
    await new Promise((done) => setTimeout(done, 1));
  }
  throw new Error("SYNTHETIC_SETTINGS_DID_NOT_ADVANCE");
}
function fixture() {
  const scope = createSessionScope(),
    records = new Map<string, string>(),
    requests: JsonRequestOptions[] = [],
    policies: string[] = [];
  const listeners = new Set<() => void>(),
    signals: AbortSignal[] = [];
  let session = owner(),
    mode = "",
    serverAuthAt = authAt,
    refreshes = 0,
    cleanupCalls = 0,
    credentialResets = 0,
    reauths = 0;
  let fileWait: Promise<void> | undefined, usageWait: Promise<void> | undefined;
  const storage = createCaseOperationStorage({
    namespace: "baro_preview_operations",
    fingerprint,
    storage: {
      get: async (key) => {
        if (mode === "locked") throw new Error("PRIVATE_STACK");
        return records.get(key) ?? null;
      },
      set: async (key, value) => {
        records.set(key, value);
      },
      remove: async (key) => {
        records.delete(key);
      },
    },
  });
  const setSession = (next: SessionState) => {
    scope.invalidate();
    session = next;
    for (const notify of listeners) notify();
  };
  const createModel = () =>
    createSettingsModel({
      session: {
        getSnapshot: () => session,
        subscribe: (notify) => {
          listeners.add(notify);
          return () => {
            listeners.delete(notify);
          };
        },
        refresh: async () => {
          refreshes++;
        },
      },
      openPolicy: async (policy) => {
        if (mode === "policy") throw new Error("PRIVATE_NATIVE_STACK");
        policies.push(policy);
      },
      createClient: (signal, ownerId, onAccepted) => {
        signals.push(signal);
        return createNativeAccountClient({
          scope,
          signal,
          ownerId,
          onAccepted,
          storage,
          fingerprint,
          newKey: () => crypto.randomUUID(),
          readReauthentication: async () => ({
            ownerTag: tag,
            startedAt: Date.parse(serverAuthAt) - 1000,
          }),
          reauthenticate: async () => {
            reauths++;
            setSession({ ...owner(), phase: "authorizing", session: null });
            serverAuthAt = "2026-10-23T00:00:02.000Z";
            setSession(owner());
          },
          request: async <T>(options: JsonRequestOptions) => {
            requests.push(options);
            if (options.path.endsWith("/usage")) {
              await usageWait;
              if (mode === "usage")
                throw new ApiError("UNAVAILABLE", "합성 사용량 조회 실패", true);
              return {
                ...usage,
                aiResponses: { ...usage.aiResponses, used: 3, reserved: 2, remaining: 195 },
              } as T;
            }
            if (options.path.endsWith("/deletion"))
              return {
                ownerTag: tag,
                recentOAuth: true,
                authenticatedAt: serverAuthAt,
                providers: ["google"],
              } as T;
            if (mode === "drop") throw new ApiError("UNAVAILABLE", "합성 응답 유실", true);
            return { status: "accepted" } as T;
          },
          cleanup: createAccountCleanup({
            resetPrivateFiles: async () => {
              cleanupCalls++;
              await fileWait;
              if (mode === "cleanup") throw new Error("PRIVATE_STACK");
            },
            cancelLogin: async () => {
              credentialResets++;
              scope.invalidate();
            },
          }),
        });
      },
    });
  const model = createModel();
  return {
    model,
    createModel,
    records,
    requests,
    policies,
    signals,
    setSession,
    counts: () => ({ refreshes, cleanupCalls, credentialResets, reauths }),
    mode: (value: string) => {
      mode = value;
    },
    fileWait: (value: Promise<void>) => {
      fileWait = value;
    },
    usageWait: (value: Promise<void>) => {
      usageWait = value;
    },
  };
}

test("both native roles read server reservations/reset without issuing a deletion or rendering opaque proof", async () => {
  for (const role of ["customer", "lawyer"] as const) {
    const f = fixture();
    f.setSession(owner("owner_a", role));
    const stop = f.model.start();
    await until(() => !f.model.getSnapshot().deletionBusy && !f.model.getSnapshot().usageBusy);
    expect(f.model.getSnapshot().usage?.aiResponses).toEqual({ used: 5, limit: 200 });
    expect(f.model.getSnapshot().usage?.resetAt).toBe(usage.resetAt);
    expect(f.model.getSnapshot().deletion?.providers).toEqual(["google"]);
    expect(JSON.stringify(f.model.getSnapshot())).not.toContain(tag);
    expect(f.requests.every((request) => request.expectedOwner === "owner_a")).toBe(true);
    expect(f.requests.some((request) => request.method === "DELETE")).toBe(false);
    await f.model.openPolicy("privacy");
    expect(f.policies).toEqual(["privacy"]);
    stop();
  }
});

test("renewed consent blocks usage only; authenticated deletion and policies remain available", async () => {
  const f = fixture();
  f.setSession({
    ...owner(),
    phase: "consent",
    session: {
      user: { id: "owner_a", name: "합성 owner_a", accountType: "customer" },
      needsConsent: true,
    },
  });
  const stop = f.model.start();
  await until(() => !f.model.getSnapshot().deletionBusy);
  expect(f.model.getSnapshot().needsConsent).toBe(true);
  expect(f.requests.some((request) => request.path.endsWith("/usage"))).toBe(false);
  expect(f.model.getSnapshot().deletion?.canDelete).toBe(true);
  stop();
});

test("literal deletion reports validated ACK before delayed cleanup and never claims a second request", async () => {
  const f = fixture(),
    pause = deferred();
  f.fileWait(pause.promise);
  const stop = f.model.start();
  await until(() => !f.model.getSnapshot().deletionBusy);
  f.model.confirm("delete");
  await f.model.deleteAccount();
  expect(f.requests.some((request) => request.method === "DELETE")).toBe(false);
  f.model.confirm("DELETE");
  const task = f.model.deleteAccount();
  await until(() => f.counts().cleanupCalls === 1);
  expect(f.model.getSnapshot()).toMatchObject({
    notice: "accepted",
    action: "delete",
    profile: null,
    usage: null,
    confirmation: "",
  });
  await f.model.deleteAccount();
  expect(f.requests.filter((request) => request.method === "DELETE")).toHaveLength(1);
  pause.resolve();
  await task;
  expect(f.model.getSnapshot()).toMatchObject({ notice: "accepted", action: null });
  expect(f.counts().credentialResets).toBe(1);
  expect(f.records.size).toBe(0);
  f.setSession({ ...owner(), phase: "anonymous", session: null });
  expect(f.model.getSnapshot()).toMatchObject({ gate: "login", notice: "accepted", profile: null });
  stop();
});

test("lost ACK survives screen recreation, requires a later actual OAuth and explicit retry with the original key", async () => {
  const f = fixture();
  f.mode("drop");
  let model = f.model,
    stop = model.start();
  await until(() => !model.getSnapshot().deletionBusy);
  model.confirm("DELETE");
  await model.deleteAccount();
  expect(model.getSnapshot()).toMatchObject({
    notice: "unconfirmed",
    deletionState: "unconfirmed",
    confirmation: "",
  });
  stop();
  model = f.createModel();
  stop = model.start();
  await until(() => !model.getSnapshot().deletionBusy);
  expect(model.getSnapshot().deletion?.canDelete).toBe(false);
  model.confirm("DELETE");
  await model.deleteAccount();
  await model.retryUnconfirmed();
  expect(f.requests.filter((request) => request.method === "DELETE")).toHaveLength(1);
  f.mode("");
  await model.reauthenticate("google");
  await until(() => !model.getSnapshot().deletionBusy);
  expect(model.getSnapshot().deletion?.canDelete).toBe(true);
  expect(model.getSnapshot().confirmation).toBe("");
  model.confirm("DELETE");
  await model.retryUnconfirmed();
  const deletes = f.requests.filter((request) => request.method === "DELETE");
  expect(deletes).toHaveLength(2);
  expect(deletes[0]?.key).toBe(deletes[1]?.key);
  expect(deletes[1]?.body).toEqual({ confirmation: "DELETE" });
  expect(model.getSnapshot().notice).toBe("accepted");
  stop();
});

test("screen background and owner replacement discard late private results and literal input", async () => {
  const f = fixture(),
    pause = deferred();
  f.usageWait(pause.promise);
  const stop = f.model.start();
  await until(() => !f.model.getSnapshot().deletionBusy);
  f.model.confirm("DELETE");
  stop();
  expect(f.signals[0]?.aborted).toBe(true);
  expect(f.model.getSnapshot()).toMatchObject({ profile: null, usage: null, confirmation: "" });
  f.setSession(owner("owner_b", "lawyer"));
  const stopAgain = f.model.start();
  pause.resolve();
  await until(() => !f.model.getSnapshot().usageBusy && !f.model.getSnapshot().deletionBusy);
  expect(f.model.getSnapshot().profile).toEqual({ name: "합성 owner_b", role: "lawyer" });
  expect(f.model.getSnapshot().confirmation).toBe("");
  expect(f.requests.some((request) => request.method === "DELETE")).toBe(false);
  stopAgain();
});

test("usage errors do not block deletion; locked recovery storage prevents every delete", async () => {
  for (const mode of ["usage", "locked"]) {
    const f = fixture();
    f.mode(mode);
    const stop = f.model.start();
    await until(() => !f.model.getSnapshot().deletionBusy && !f.model.getSnapshot().usageBusy);
    if (mode === "usage") expect(f.model.getSnapshot().deletion?.canDelete).toBe(true);
    else {
      expect(f.model.getSnapshot().deletion).toBeNull();
      expect(f.model.getSnapshot().error).toBeString();
      expect(String(f.model.getSnapshot().error)).not.toContain("PRIVATE_STACK");
      f.model.confirm("DELETE");
      await f.model.deleteAccount();
      expect(f.requests.some((request) => request.method === "DELETE")).toBe(false);
    }
    stop();
  }
});

test("file cleanup failure still resets credentials and keeps accepted facts distinct from unknown deletion", async () => {
  const f = fixture();
  f.mode("cleanup");
  const stop = f.model.start();
  await until(() => !f.model.getSnapshot().deletionBusy);
  f.model.confirm("DELETE");
  await f.model.deleteAccount();
  expect(f.model.getSnapshot().notice).toBe("cleanup-failed");
  expect(f.counts().credentialResets).toBe(1);
  expect(JSON.parse([...f.records.values()][0] ?? "{}").state).toBe("accepted");
  stop();
  const restarted = f.createModel(),
    again = restarted.start();
  await until(() => restarted.getSnapshot().notice === "cleanup-failed");
  expect(f.requests.filter((request) => request.method === "DELETE")).toHaveLength(1);
  expect(restarted.getSnapshot().profile).toBeNull();
  f.setSession(owner("owner_b"));
  await until(() => !restarted.getSnapshot().deletionBusy);
  expect(restarted.getSnapshot().notice).toBeNull();
  expect(restarted.getSnapshot().deletionState).toBe("none");
  again();
});

test("a new account during file drain prevents old cleanup from touching its credentials or showing the old receipt", async () => {
  const f = fixture(),
    pause = deferred();
  f.fileWait(pause.promise);
  const stop = f.model.start();
  await until(() => !f.model.getSnapshot().deletionBusy);
  f.model.confirm("DELETE");
  const task = f.model.deleteAccount();
  await until(() => f.counts().cleanupCalls === 1);
  f.setSession(owner("owner_b"));
  pause.resolve();
  await task;
  await until(() => !f.model.getSnapshot().deletionBusy);
  expect(f.counts().credentialResets).toBe(0);
  expect(f.model.getSnapshot().notice).toBeNull();
  expect(f.model.getSnapshot().profile?.name).toBe("합성 owner_b");
  expect(JSON.parse([...f.records.values()][0] ?? "{}").state).toBe("accepted");
  stop();
});

test("validated ACK cleanup result survives foreground replacement without enabling a second action while draining", async () => {
  const f = fixture(),
    pause = deferred();
  f.mode("cleanup");
  f.fileWait(pause.promise);
  const stop = f.model.start();
  await until(() => !f.model.getSnapshot().deletionBusy);
  f.model.confirm("DELETE");
  const task = f.model.deleteAccount();
  await until(() => f.counts().cleanupCalls === 1);
  stop();
  const again = f.model.start();
  expect(f.model.getSnapshot()).toMatchObject({
    notice: "accepted",
    action: "delete",
    profile: null,
  });
  pause.resolve();
  await task;
  expect(f.model.getSnapshot()).toMatchObject({
    notice: "cleanup-failed",
    action: null,
    profile: null,
  });
  expect(f.counts().credentialResets).toBe(1);
  again();
});

test("unconfirmed request stays uncertain through an anonymous read, clears for a peer; public policy failures are safe", async () => {
  const f = fixture();
  f.mode("drop");
  const stop = f.model.start();
  await until(() => !f.model.getSnapshot().deletionBusy);
  f.model.confirm("DELETE");
  await f.model.deleteAccount();
  f.setSession({ ...owner(), phase: "anonymous", session: null });
  expect(f.model.getSnapshot()).toMatchObject({
    gate: "login",
    notice: "unconfirmed",
    profile: null,
  });
  f.mode("policy");
  await f.model.openPolicy("terms");
  expect(f.model.getSnapshot().policyError).toContain("문서를 열지 못했어요");
  expect(f.model.getSnapshot().policyError).not.toContain("PRIVATE_NATIVE");
  f.mode("");
  f.setSession(owner("owner_b"));
  await until(() => !f.model.getSnapshot().deletionBusy);
  expect(f.model.getSnapshot().notice).toBeNull();
  stop();
});
