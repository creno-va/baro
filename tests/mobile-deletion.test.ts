import { expect, test } from "bun:test";
import { ApiError, createMobileAuthClient, type JsonRequestOptions } from "@baro/api-client";
import type { MobileProvider } from "@baro/client-core";
import { resolveMobileConfig } from "../apps/mobile/config/environment";
import { createNativeDeletion } from "../apps/mobile/src/platform/auth/deletion";
import {
  createDeletionAttemptStore,
  type PendingDeletionAttempt,
} from "../apps/mobile/src/platform/auth/deletion-attempt";

const id = "15a64c18-fd51-4f83-8205-4c917a245e6b",
  other = "8ab4833d-b89b-4555-95f7-33f03ea46d6b";
const ownerId = "synthetic-a",
  tag = "a".repeat(64),
  verifier = "a".repeat(43),
  challenge = "c".repeat(43),
  code = "b".repeat(43);
const callback = `baro-preview://auth/callback?attemptId=${id}&code=${code}`;
const input: PendingDeletionAttempt = {
  state: "pending",
  attemptId: id,
  ownerId,
  ownerTag: tag,
  provider: "apple",
  verifier,
  createdAt: 1000,
  activity: { startedAt: 999, activityProof: "d".repeat(64) },
};
const outcome = {
  contractVersion: 2 as const,
  status: "accepted" as const,
  ownerTag: tag,
  appleRevocation: "unconfirmed" as const,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(provider: MobileProvider = "apple") {
  const pendingInput = { ...input, provider };
  const disk = new Map<string, string>([
      ["cookie", "SYNTHETIC_COOKIE"],
      ["operations", "SYNTHETIC_UNSETTLED"],
    ]),
    calls: string[] = [];
  let available = true,
    legacy = false,
    feature = true,
    signed = true,
    linked = true,
    current = true,
    failPrepare = false,
    swapAfterPrepare = false,
    failExchange = false,
    failStorage = false,
    failCleanup = false,
    cleanupResult: "complete" | "skipped" = "complete";
  let statusError: number | undefined,
    cancelMode: "cancelled" | "accepted" | "unknown" = "cancelled",
    browser: "success" | "cancelled" | "lost" | "wrong" = "success";
  let exchangeGate: ReturnType<typeof deferred<void>> | undefined,
    entered: ReturnType<typeof deferred<void>> | undefined;
  const store = createDeletionAttemptStore({
    key: "deletion",
    storage: {
      getItemAsync: async (key) => disk.get(key) ?? null,
      setItemAsync: async (key, value) => {
        if (failStorage) throw new Error("SYNTHETIC_LOCKED");
        disk.set(key, value);
      },
    },
  });
  const client = createMobileAuthClient({
    request: async <T>(request: JsonRequestOptions): Promise<T> => {
      calls.push(request.path);
      if (request.path === "/api/mobile/auth/capabilities") {
        if (legacy) throw new ApiError("NOT_FOUND", "합성 이전 서버", false, 404);
        return {
          contractVersion: 2,
          ...(feature ? { deletionActivity: 1 } : {}),
          providers: available
            ? ["google", "naver", "kakao", "apple"]
            : ["google", "naver", "kakao"],
        } as T;
      }
      expect(request.expectedOwner).toBe(ownerId);
      expect(request.headers).toEqual({
        "x-baro-auth-contract": "2",
        ...(request.path.endsWith("/prepare") ? { "x-baro-deletion-activity": "1" } : {}),
      });
      if (request.path === "/api/me/deletion")
        return {
          contractVersion: 2,
          ownerTag: tag,
          recentOAuth: false,
          authenticatedAt: null,
          providers: linked ? [provider] : ["google"],
        } as T;
      expect(request.path).toBe("/api/mobile/auth/deletion/prepare");
      expect(await store.list()).toEqual([]);
      expect(request.body).toEqual({
        attemptId: id,
        provider,
        challenge,
        confirmation: "DELETE",
      });
      if (failPrepare) throw new ApiError("UNAVAILABLE", "합성 준비 응답 유실", true);
      if (swapAfterPrepare) current = false;
      return {
        ownerTag: tag,
        startedAt: 999,
        ...(signed ? { activityProof: "d".repeat(64) } : {}),
      } as T;
    },
    completionRequest: async <T>(request: JsonRequestOptions): Promise<T> => {
      calls.push(request.path);
      expect(request.expectedOwner).toBeUndefined();
      expect(request.headers).toEqual({ "x-baro-auth-contract": "2" });
      expect(request.method).toBe("POST");
      if (request.path.endsWith("/exchange")) {
        expect(request.body).toEqual({ attemptId: id, verifier, code });
        entered?.resolve();
        await exchangeGate?.promise;
        if (failExchange) throw new ApiError("UNAVAILABLE", "합성 교환 응답 유실", true);
        return outcome as T;
      }
      expect(request.body).toEqual({ attemptId: id, verifier });
      if (request.path.endsWith("/cancel")) {
        if (cancelMode === "unknown")
          throw new ApiError("UNAVAILABLE", "합성 취소 응답 유실", true);
        return (cancelMode === "cancelled" ? { status: "cancelled" } : outcome) as T;
      }
      expect(request.path).toBe("/api/mobile/auth/deletion/status");
      if (statusError)
        throw new ApiError(
          statusError === 401
            ? "UNAUTHENTICATED"
            : statusError === 404
              ? "NOT_FOUND"
              : "UNAVAILABLE",
          "합성 결과 미확인",
          true,
          statusError,
        );
      return outcome as T;
    },
  });
  const dependencies: Parameters<typeof createNativeDeletion>[0] = {
    config: resolveMobileConfig({ environment: "preview" }),
    client,
    attempts: store,
    now: () => 1000,
    newId: () => id,
    proof: async () => ({ verifier, challenge }),
    begin: (id) => {
      expect(id).toBe(ownerId);
      return {
        ensureCurrent: () => {
          if (!current) throw new ApiError("UNAUTHENTICATED", "합성 owner 변경");
        },
      };
    },
    authorize: async (request, ensure) => {
      calls.push("authorize");
      ensure?.();
      expect(await store.list()).toEqual([pendingInput]);
      const target = new URL(request.callbackURL);
      expect(target.protocol).toBe("baro-preview:");
      expect(Object.fromEntries(target.searchParams)).toEqual({
        attemptId: id,
        challenge,
        purpose: "delete-account",
      });
      expect(new URL(request.errorCallbackURL).searchParams.get("error")).toBe("oauth");
      expect(request.callbackURL).not.toContain(verifier);
      expect(request.callbackURL).not.toContain(ownerId);
      return { url: "https://appleid.apple.com/auth/authorize?state=synthetic" };
    },
    openBrowser: async (url, returnURL) => {
      calls.push("browser");
      expect(new URL(url).origin).toBe("https://preview.baro.site");
      expect(new URL(url).pathname).toBe("/api/auth/expo-authorization-proxy");
      expect(returnURL).toBe("baro-preview://auth/callback");
      if (browser === "lost") throw new Error("SYNTHETIC_BROWSER_RETURN_LOST");
      return browser === "cancelled"
        ? { type: "cancelled" }
        : { type: "success", url: browser === "wrong" ? callback.replace(id, other) : callback };
    },
    cleanup: async () => {
      calls.push("cleanup");
      expect((await store.list())[0]).toMatchObject({ state: "accepted" });
      if (failCleanup) throw new Error("SYNTHETIC_CLEANUP_FAILED");
      return cleanupResult;
    },
  };
  return {
    disk,
    calls,
    store,
    dependencies,
    create: () => createNativeDeletion(dependencies),
    set(value: {
      available?: boolean;
      legacy?: boolean;
      feature?: boolean;
      signed?: boolean;
      linked?: boolean;
      failPrepare?: boolean;
      swapAfterPrepare?: boolean;
      failExchange?: boolean;
      statusError?: number;
      cancelMode?: typeof cancelMode;
      browser?: typeof browser;
      failStorage?: boolean;
      failCleanup?: boolean;
      cleanupResult?: typeof cleanupResult;
    }) {
      if (value.available !== undefined) available = value.available;
      if (value.legacy !== undefined) legacy = value.legacy;
      if (value.feature !== undefined) feature = value.feature;
      if (value.signed !== undefined) signed = value.signed;
      if (value.linked !== undefined) linked = value.linked;
      if (value.failPrepare !== undefined) failPrepare = value.failPrepare;
      if (value.swapAfterPrepare !== undefined) swapAfterPrepare = value.swapAfterPrepare;
      if (value.failExchange !== undefined) failExchange = value.failExchange;
      if (value.statusError !== undefined) statusError = value.statusError;
      if (value.cancelMode !== undefined) cancelMode = value.cancelMode;
      if (value.browser !== undefined) browser = value.browser;
      if (value.failStorage !== undefined) failStorage = value.failStorage;
      if (value.failCleanup !== undefined) failCleanup = value.failCleanup;
      if (value.cleanupResult !== undefined) cleanupResult = value.cleanupResult;
    },
    delayExchange() {
      exchangeGate = deferred<void>();
      entered = deferred<void>();
      const gate = exchangeGate;
      return { entered: entered.promise, release: () => gate.resolve() };
    },
  };
}

for (const provider of ["google", "naver", "kakao", "apple"] as const) {
  test(`v2 deletion persists signed prepare receipt before OAuth/browser and accepts only the receipt before cleanup: ${provider}`, async () => {
    const f = fixture(provider);
    expect(await f.create().start(provider, "DELETE", ownerId)).toMatchObject({
      type: "accepted",
      outcome,
      cleanup: "complete",
      localSaved: true,
    });
    expect(f.calls).toEqual([
      "/api/mobile/auth/capabilities",
      "/api/me/deletion",
      "/api/mobile/auth/deletion/prepare",
      "authorize",
      "browser",
      "/api/mobile/auth/deletion/exchange",
      "cleanup",
    ]);
    expect(f.disk.get("cookie")).toBe("SYNTHETIC_COOKIE");
    expect(f.disk.get("operations")).toBe("SYNTHETIC_UNSETTLED");
  });
}

test("literal DELETE, advertised v2 and linked provider are required before intent/OAuth", async () => {
  const invalid = fixture();
  await expect(invalid.create().start("apple", "delete", ownerId)).rejects.toMatchObject({
    code: "VALIDATION_ERROR",
  });
  expect(invalid.calls).toEqual([]);
  for (const settings of [
    { available: false },
    { legacy: true },
    { linked: false },
    { feature: false },
  ]) {
    const f = fixture();
    f.set(settings);
    await expect(f.create().start("apple", "DELETE", ownerId)).rejects.toBeInstanceOf(ApiError);
    expect(await f.store.list()).toEqual([]);
    expect(
      f.calls.some(
        (path) => path.endsWith("prepare") || path === "authorize" || path === "browser",
      ),
    ).toBe(false);
  }
});

test("prepare loss, absent signature or owner change never starts OAuth or leaves an unsigned blocked journal", async () => {
  for (const settings of [{ failPrepare: true }, { signed: false }, { swapAfterPrepare: true }]) {
    const f = fixture();
    f.set(settings);
    await expect(f.create().start("apple", "DELETE", ownerId)).rejects.toBeInstanceOf(ApiError);
    expect(await f.store.list()).toEqual([]);
    expect(f.calls).not.toContain("authorize");
    expect(f.calls).not.toContain("browser");
  }
});

test("browser cancellation is only confirmed by the server; a deletion winner stays accepted", async () => {
  for (const cancelMode of ["cancelled", "accepted", "unknown"] as const) {
    const f = fixture();
    f.set({ browser: "cancelled", cancelMode });
    const result = await f.create().start("apple", "DELETE", ownerId);
    expect(result.type).toBe(cancelMode === "unknown" ? "unknown" : cancelMode);
    expect(f.calls.filter((path) => path.endsWith("/cancel"))).toHaveLength(1);
    expect((await f.store.list())[0]?.state).toBe(
      cancelMode === "unknown" ? "pending" : cancelMode,
    );
  }
});

test("a lost code body recovers with the exact receipt proof once, never an auth exchange or delete replay", async () => {
  const f = fixture();
  f.set({ failExchange: true });
  expect(await f.create().start("apple", "DELETE", ownerId)).toMatchObject({
    type: "accepted",
    outcome,
  });
  expect(f.calls.filter((path) => path.endsWith("/exchange"))).toEqual([
    "/api/mobile/auth/deletion/exchange",
  ]);
  expect(f.calls.filter((path) => path.endsWith("/status"))).toEqual([
    "/api/mobile/auth/deletion/status",
  ]);
  expect(f.calls.filter((path) => path.endsWith("/prepare"))).toHaveLength(1);
});

test("401/404/503 status, expired receipt and lost browser return cannot fabricate cancellation or acceptance", async () => {
  for (const statusError of [401, 404, 503]) {
    const f = fixture();
    f.set({ failExchange: true, statusError });
    expect(await f.create().start("apple", "DELETE", ownerId)).toEqual({
      type: "unknown",
      attemptId: id,
    });
    expect(await f.store.list()).toEqual([input]);
    expect(f.calls).not.toContain("cleanup");
  }
  for (const browser of ["lost", "wrong"] as const) {
    const f = fixture();
    f.set({ browser });
    expect(await f.create().start("apple", "DELETE", ownerId)).toEqual({
      type: "unknown",
      attemptId: id,
    });
    expect(await f.store.list()).toEqual([input]);
    expect(f.calls.some((p) => /deletion\/(exchange|cancel)$/.test(p))).toBe(false);
  }
});

test("cold/warm duplicate returns share one deletion exchange; unknown nonce/unsafe URLs do not touch network", async () => {
  const f = fixture();
  await f.store.put(input);
  const gate = f.delayExchange(),
    native = f.create();
  const first = native.complete(callback),
    second = native.complete(callback);
  await gate.entered;
  gate.release();
  expect((await Promise.all([first, second])).map((r) => r.type)).toEqual(["accepted", "accepted"]);
  expect(f.calls.filter((p) => p.endsWith("/exchange"))).toHaveLength(1);
  expect(f.calls.filter((p) => p === "cleanup")).toHaveLength(1);
  const before = [...f.calls];
  expect(await native.complete(callback.replace(id, other))).toEqual({ type: "ignored" });
  expect(await native.complete(`${callback}&cookie=SYNTHETIC_PRIVATE`)).toEqual({
    type: "ignored",
  });
  expect(f.calls).toEqual(before);
});

test("a valid ACK survives cleanup/storage failure and preserves recovery; local skip never erases another owner's cookie", async () => {
  const f = fixture();
  await f.store.put(input);
  f.set({ failStorage: true });
  expect(await f.create().complete(callback)).toMatchObject({
    type: "accepted",
    outcome,
    localSaved: false,
    cleanup: "failed",
  });
  expect(f.calls).not.toContain("cleanup");
  f.set({ failStorage: false, failCleanup: true });
  expect(await f.create().status(id)).toMatchObject({
    type: "accepted",
    cleanup: "failed",
    localSaved: true,
  });
  f.set({ failCleanup: false, cleanupResult: "skipped" });
  expect(await f.create().status(id)).toMatchObject({ type: "accepted", cleanup: "skipped" });
  expect(f.disk.get("cookie")).toBe("SYNTHETIC_COOKIE");
  expect(f.disk.get("operations")).toBe("SYNTHETIC_UNSETTLED");
});

test("even well-shaped foreign-owner receipts cannot acknowledge deletion or trigger cleanup", async () => {
  const f = fixture();
  await f.store.put(input);
  f.dependencies.client.exchangeDeletion = async () => ({ ...outcome, ownerTag: "b".repeat(64) });
  f.dependencies.client.deletionStatus = async () => ({ ...outcome, ownerTag: "b".repeat(64) });
  expect(await f.create().complete(callback)).toEqual({ type: "unknown", attemptId: id });
  expect(await f.store.list()).toEqual([input]);
  expect(f.calls).not.toContain("cleanup");
});

const observation = {
  contractVersion: 2 as const,
  attemptId: id,
  status: "inactive" as const,
  outcome: "unknown" as const,
  observedAt: "2026-10-24T12:00:00.000Z",
};
test("explicit expired reconciliation retains original signed proof and unknown outcome; a different nonce can start", async () => {
  const f = fixture();
  await f.store.put(input);
  f.dependencies.client.deletionStatus = async () => {
    f.calls.push("status");
    throw new ApiError("UNAUTHENTICATED", "SYNTHETIC_EXPIRED", false, 401);
  };
  f.dependencies.client.deletionActivity = async (value) => {
    f.calls.push("activity");
    expect(value).toEqual({ attemptId: id, verifier, ownerTag: tag, ...input.activity });
    return observation;
  };
  expect(await f.create().reconcile(id)).toEqual({
    type: "inactive",
    attemptId: id,
    ownerId,
    observedAt: observation.observedAt,
  });
  expect(f.calls).toEqual(["status", "activity", "status"]);
  expect(await f.store.list()).toEqual([
    {
      ...input,
      activity: { startedAt: 999, activityProof: "d".repeat(64) },
      state: "inactive",
      observedAt: observation.observedAt,
    },
  ]);
  await f.store.put({ ...input, attemptId: other });
  expect((await f.store.list()).map((record) => record.state)).toEqual(["inactive", "pending"]);
  expect(f.calls).not.toContain("cleanup");
  expect(f.disk.get("cookie")).toBe("SYNTHETIC_COOKIE");
});

for (const mode of ["active", "error", "legacy"] as const) {
  test(`reconciliation cannot invent an inactive/cancelled/deleted result: ${mode}`, async () => {
    const f = fixture();
    const { activity: _activity, ...legacy } = input;
    const record = mode === "legacy" ? legacy : input;
    await f.store.put(record);
    let reads = 0;
    f.dependencies.client.deletionStatus = async () => {
      reads++;
      throw new Error("SYNTHETIC_EXPIRED");
    };
    f.dependencies.client.deletionActivity = async () => {
      f.calls.push("activity");
      if (mode !== "active") throw new Error("SYNTHETIC_UNAVAILABLE");
      return { ...observation, status: "active" };
    };
    expect(await f.create().reconcile(id)).toEqual({ type: "unknown", attemptId: id });
    expect(await f.store.list()).toEqual([record]);
    expect(reads).toBe(1);
    expect(f.calls).toEqual(mode === "legacy" ? [] : ["activity"]);
    await expect(f.store.acknowledge(id)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(f.store.put({ ...input, attemptId: other })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
}

test("commit winning during activity observation remains accepted; no fabricated cancellation or inactive downgrade", async () => {
  for (const concurrentSave of [false, true]) {
    const f = fixture();
    await f.store.put(input);
    let reads = 0;
    f.dependencies.client.deletionStatus = async () => {
      if (++reads === 1 || concurrentSave) throw new Error("SYNTHETIC_RESPONSE_LOST");
      return outcome;
    };
    f.dependencies.client.deletionActivity = async () => {
      if (concurrentSave) await f.store.accept(id, outcome);
      return observation;
    };
    expect(await f.create().reconcile(id)).toMatchObject({
      type: "accepted",
      outcome,
      cleanup: "complete",
    });
    expect((await f.store.list())[0]?.state).toBe("accepted");
    expect(reads).toBe(2);
    expect(f.calls).toEqual(["cleanup"]);
  }
});

test("inactive record can still recover a valid late receipt, but no missing response erases its unknown observation", async () => {
  const f = fixture();
  await f.store.put(input);
  await f.store.observeInactive(id, observation);
  f.set({ statusError: 401 });
  expect(await f.create().complete(callback)).toMatchObject({
    type: "inactive",
    observedAt: observation.observedAt,
  });
  expect(f.calls.some((path) => path.endsWith("/exchange"))).toBe(false);
  f.set({ statusError: 0 });
  expect(await f.create().reconcile(id)).toMatchObject({ type: "accepted", outcome });
  expect(f.calls).toContain("cleanup");
});

test("pending collision and storage write failure stop before OAuth; signed pending is required before browser", async () => {
  const duplicate = fixture();
  await duplicate.store.put({ ...input, attemptId: other });
  await expect(duplicate.create().start("apple", "DELETE", ownerId)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(duplicate.calls.some((path) => path.endsWith("/prepare"))).toBe(false);
  const locked = fixture();
  locked.set({ failStorage: true });
  await expect(locked.create().start("apple", "DELETE", ownerId)).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  expect(await locked.store.list()).toEqual([]);
  expect(locked.calls).not.toContain("authorize");
  expect(locked.calls).not.toContain("browser");
});
