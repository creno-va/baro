import { expect, test } from "bun:test";
import { ApiError, createMobileAuthClient, type JsonRequestOptions } from "@baro/api-client";
import { resolveMobileConfig } from "../apps/mobile/config/environment";
import { createAccountDeletionModel } from "../apps/mobile/src/features/account-deletion/model";
import type { SessionState } from "../apps/mobile/src/features/session/model";
import {
  createDeletionAttemptStore,
  type PendingDeletionAttempt,
} from "../apps/mobile/src/platform/auth/deletion-attempt";

const id = "15a64c18-fd51-4f83-8205-4c917a245e6b",
  other = "8ab4833d-b89b-4555-95f7-33f03ea46d6b";
const ownerId = "synthetic-owner-a",
  tag = "a".repeat(64),
  verifier = "a".repeat(43);
const pending: PendingDeletionAttempt = {
  state: "pending",
  attemptId: id,
  ownerId,
  ownerTag: tag,
  provider: "apple",
  verifier,
  createdAt: 1,
};
const outcome = {
  contractVersion: 2 as const,
  status: "accepted" as const,
  ownerTag: tag,
  appleRevocation: "unconfirmed" as const,
};
const session = (id = ownerId): SessionState => ({
  phase: "ready",
  session: {
    user: { id, name: id === ownerId ? "합성 A" : "합성 B", accountType: "customer" },
    needsConsent: false,
  },
  role: "customer",
  busy: false,
  consent: null,
  error: null,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function until(test: () => boolean) {
  for (let step = 0; step < 100; step++) {
    if (test()) return;
    await Promise.resolve();
  }
  throw new Error("SYNTHETIC_MODEL_DID_NOT_SETTLE");
}
function fixture() {
  const disk = new Map<string, string>([["operations", "SYNTHETIC_UNSETTLED"]]),
    listeners = new Set<() => void>(),
    calls: string[] = [];
  let state = session(),
    locked = false,
    legacy = false,
    deleted: string | undefined,
    unsaved = false;
  const store = createDeletionAttemptStore({
    key: "deletion",
    storage: {
      getItemAsync: async (key) => {
        if (locked) throw new Error("SYNTHETIC_LOCKED");
        return disk.get(key) ?? null;
      },
      setItemAsync: async (key, value) => {
        if (locked) throw new Error("SYNTHETIC_LOCKED");
        disk.set(key, value);
      },
    },
  });
  const update = (next: SessionState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const client = createMobileAuthClient({
    request: async <T>(request: JsonRequestOptions): Promise<T> => {
      calls.push(request.path);
      if (request.path.endsWith("capabilities")) {
        if (legacy) throw new ApiError("NOT_FOUND", "합성 이전 서버", false, 404);
        return { contractVersion: 2, providers: ["google", "apple"], deletionActivity: 1 } as T;
      }
      expect(request.path).toBe("/api/me/deletion");
      return {
        contractVersion: 2,
        ownerTag: request.expectedOwner === ownerId ? tag : "b".repeat(64),
        recentOAuth: false,
        authenticatedAt: null,
        providers: ["google", "apple"],
      } as T;
    },
    completionRequest: async () => {
      throw new Error("MUST_USE_NATIVE_COORDINATOR_PORT");
    },
  });
  const accept = async () => {
    await store.accept(id, outcome);
    await store.markCleanup(id, "complete");
    return {
      type: "accepted" as const,
      attemptId: id,
      ownerId,
      outcome,
      cleanup: "complete" as const,
      localSaved: true,
    };
  };
  const native: Parameters<typeof createAccountDeletionModel>[0]["native"] = {
    start: async (provider, confirmation, owner) => {
      calls.push("start");
      expect(confirmation).toBe("DELETE");
      expect(owner).toBe(ownerId);
      await store.put({ ...pending, provider });
      deleted = owner;
      if (unsaved) {
        locked = true;
        return {
          type: "accepted",
          attemptId: id,
          ownerId,
          outcome,
          cleanup: "failed",
          localSaved: false,
        };
      }
      return accept();
    },
    status: async () => {
      calls.push("status");
      return { type: "unknown", attemptId: id };
    },
    reconcile: async (id) => native.status(id),
    cancel: async () => {
      calls.push("cancel");
      return { type: "unknown", attemptId: id };
    },
    complete: async () => {
      calls.push("complete");
      return accept();
    },
    clearAnonymousDevice: async () => {
      calls.push("cleanup");
      expect(state.phase).toBe("anonymous");
      await store.markCleanup(id, "complete");
    },
  };
  const dependencies: Parameters<typeof createAccountDeletionModel>[0] = {
    config: resolveMobileConfig({ environment: "preview" }),
    attempts: store,
    client,
    native,
    session: {
      getSnapshot: () => state,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      refresh: async () => {
        calls.push("session");
        if (deleted && state.session?.user?.id === deleted)
          update({ ...state, phase: "anonymous", session: { user: null, needsConsent: false } });
      },
    },
    openAppleHelp: async () => {
      calls.push("help");
    },
  };
  return {
    dependencies,
    disk,
    calls,
    store,
    client,
    native,
    update,
    current: () => state,
    lock: (value: boolean) => {
      locked = value;
    },
    legacy: () => {
      legacy = true;
    },
    unsaved: () => {
      unsaved = true;
    },
    create: () => createAccountDeletionModel(dependencies),
    listeners: () => listeners.size,
  };
}

test("explicit provider/DELETE uses only current-owner deletion and publishes receipt independently of anonymous session", async () => {
  const f = fixture(),
    model = f.create(),
    stop = model.activate();
  await until(() => model.getSnapshot().gate === "ready");
  await model.startDeletion();
  expect(f.calls).not.toContain("start");
  model.select("apple");
  model.confirm("DELETE");
  await model.startDeletion();
  expect(model.getSnapshot()).toMatchObject({
    anonymous: true,
    accountName: null,
    confirmation: "",
    history: [
      { state: "accepted", cleanup: "complete", appleRevocation: "unconfirmed", localSaved: true },
    ],
  });
  expect(f.disk.get("operations")).toBe("SYNTHETIC_UNSETTLED");
  const serialized = JSON.stringify(model.getSnapshot());
  expect(serialized).not.toContain(verifier);
  expect(serialized).not.toContain(ownerId);
  expect(serialized).not.toContain(tag);
  await model.acknowledge(id);
  expect(await f.store.list()).toEqual([]);
  stop();
  expect(f.listeners()).toBe(0);
});

test("an anonymous session and expired result do not prove cancellation or deletion and pending proof is never acknowledged away", async () => {
  const f = fixture();
  await f.store.put(pending);
  f.update({ ...session(), phase: "anonymous", session: { user: null, needsConsent: false } });
  const model = f.create(),
    stop = model.activate();
  await until(() => model.getSnapshot().history.length === 1);
  await model.checkResult(id);
  await model.cancelAttempt(id);
  await model.acknowledge(id);
  expect(model.getSnapshot().history[0]?.state).toBe("pending");
  expect(await f.store.list()).toEqual([pending]);
  await model.startDeletion();
  expect(f.calls).not.toContain("start");
  stop();
});

test("a replacement owner retires private provider reads and the prior DELETE confirmation", async () => {
  const f = fixture(),
    gate = deferred<Awaited<ReturnType<typeof f.client.deletionAccess>>>(),
    base = f.client.deletionAccess;
  f.client.deletionAccess = async (protocol, owner) =>
    owner === ownerId ? gate.promise : base(protocol, owner);
  const model = f.create(),
    stop = model.activate();
  await until(() => f.calls.some((path) => path.endsWith("capabilities")));
  f.update(session("synthetic-owner-b"));
  await until(() => model.getSnapshot().accountName === "합성 B");
  gate.resolve({
    contractVersion: 2,
    ownerTag: tag,
    providers: ["apple"],
    recentOAuth: false,
    authenticatedAt: null,
  });
  await Promise.resolve();
  expect(model.getSnapshot().accountName).toBe("합성 B");
  expect(model.getSnapshot().confirmation).toBe("");
  stop();
  expect(model.getSnapshot().accountName).toBeNull();
});

test("an unsaved valid ACK survives later storage errors and foreground reconstruction until explicit successful recovery", async () => {
  const f = fixture(),
    model = f.create(),
    stop = model.activate();
  await until(() => model.getSnapshot().gate === "ready");
  f.unsaved();
  model.select("apple");
  model.confirm("DELETE");
  await model.startDeletion();
  expect(model.getSnapshot()).toMatchObject({
    history: [{ state: "accepted", localSaved: false, cleanup: "failed" }],
  });
  expect(model.getSnapshot().storageError).toBeTruthy();
  stop();
  f.lock(false);
  const resume = model.activate();
  await until(() => !model.getSnapshot().storageError);
  expect(model.getSnapshot().history[0]).toMatchObject({ state: "accepted", localSaved: false });
  f.native.status = async () => {
    await f.store.accept(id, outcome);
    await f.store.markCleanup(id, "complete");
    return {
      type: "accepted",
      attemptId: id,
      ownerId,
      outcome,
      cleanup: "complete",
      localSaved: true,
    };
  };
  await model.checkResult(id);
  expect(model.getSnapshot().history[0]).toMatchObject({
    state: "accepted",
    localSaved: true,
    cleanup: "complete",
  });
  await model.acknowledge(id);
  expect(model.getSnapshot().history).toEqual([]);
  resume();
});

test("only actual legacy negotiation chooses legacy UI; local proof storage errors prevent new browser deletion", async () => {
  const old = fixture();
  old.legacy();
  const legacy = old.create(),
    stopOld = legacy.activate();
  await until(() => legacy.getSnapshot().gate === "legacy");
  legacy.confirm("DELETE");
  await legacy.startDeletion();
  expect(old.calls).not.toContain("start");
  stopOld();
  const f = fixture();
  f.lock(true);
  const model = f.create(),
    stop = model.activate();
  await until(() => model.getSnapshot().gate === "ready");
  model.select("apple");
  model.confirm("DELETE");
  await model.startDeletion();
  expect(f.calls).not.toContain("start");
  expect(model.getSnapshot().storageError).toBeTruthy();
  stop();
});

test("owned delete returns take priority even on errors, while unknown nonces and unsafe URLs remain untouched", async () => {
  const f = fixture();
  await f.store.put(pending);
  const model = f.create();
  const raw = `baro-preview://auth/callback?attemptId=${id}&code=${"b".repeat(43)}`;
  expect(await model.receiveReturn(raw.replace(id, other))).toBe(false);
  expect(f.calls).not.toContain("complete");
  expect(await model.receiveReturn(`${raw}&cookie=SYNTHETIC_PRIVATE`)).toBe(false);
  f.native.complete = async () => {
    throw new ApiError("UNAVAILABLE", "합성 복귀 실패", true);
  };
  expect(await model.receiveReturn(raw)).toBe(true);
  expect(model.getSnapshot().error).toBeTruthy();
  expect(await f.store.list()).toEqual([pending]);
});

test("manual cold cleanup is unavailable to a logged-in owner and cannot remove pending proof", async () => {
  const f = fixture();
  await f.store.put(pending);
  const model = f.create(),
    stop = model.activate();
  await until(() => model.getSnapshot().history.length === 1);
  await model.clearAnonymous(id);
  expect(f.calls).not.toContain("cleanup");
  await f.store.accept(id, outcome);
  await f.store.markCleanup(id, "failed");
  f.update({ ...session(), phase: "anonymous", session: { user: null, needsConsent: false } });
  await model.refresh();
  await model.clearAnonymous(id);
  expect(f.calls).toContain("cleanup");
  expect(model.getSnapshot().history[0]).toMatchObject({ state: "accepted", cleanup: "complete" });
  stop();
});

test("signed inactive history releases only its owner's pending block, keeps outcome unknown and requires a new DELETE", async () => {
  const f = fixture(),
    signed = { ...pending, activity: { startedAt: 123, activityProof: "d".repeat(64) } },
    observedAt = "2026-10-24T12:00:00.000Z";
  await f.store.put(signed);
  f.native.reconcile = async () => {
    await f.store.observeInactive(id, {
      contractVersion: 2,
      attemptId: id,
      status: "inactive",
      outcome: "unknown",
      observedAt,
    });
    return { type: "inactive", attemptId: id, ownerId, observedAt };
  };
  const model = f.create(),
    stop = model.activate();
  await until(() => model.getSnapshot().gate === "ready");
  model.select("apple");
  model.confirm("DELETE");
  expect(model.getSnapshot().hasOpenRequest).toBe(true);
  await model.checkResult(id);
  expect(model.getSnapshot()).toMatchObject({
    hasOpenRequest: false,
    confirmation: "",
    history: [{ state: "inactive", observedAt, localSaved: true }],
  });
  await model.startDeletion();
  expect(f.calls).not.toContain("start");
  const serialized = JSON.stringify(model.getSnapshot());
  for (const secret of [ownerId, tag, verifier, signed.activity.activityProof])
    expect(serialized).not.toContain(secret);
  expect(await f.store.list()).toEqual([{ ...signed, state: "inactive", observedAt }]);
  await model.acknowledge(id);
  expect(model.getSnapshot().history).toEqual([]);
  stop();
});

test("bare v2 without activity negotiation is unavailable, never legacy or a new delete action", async () => {
  const f = fixture();
  f.client.capabilities = async () => ({ contractVersion: 2, providers: ["apple"] });
  const model = f.create(),
    stop = model.activate();
  await until(() => model.getSnapshot().gate === "error");
  expect(f.calls).not.toContain("/api/me/deletion");
  model.confirm("DELETE");
  await model.startDeletion();
  expect(f.calls).not.toContain("start");
  expect(model.getSnapshot().history).toEqual([]);
  stop();
});
