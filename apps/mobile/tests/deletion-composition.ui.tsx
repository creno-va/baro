import { createJsonRequester, createMobileAuthClient } from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";
import { getCookie, getSetCookie, storageAdapter } from "@better-auth/expo/client";
import * as WebBrowser from "expo-web-browser";
import { resolveMobileConfig } from "../config/environment";
import { createNativeDeletionCoordinator } from "../src/composition/deletion";
import type { SessionState } from "../src/features/session/model";
import { createPendingAuthStore } from "../src/platform/auth/attempt";
import { createNativeCredentials } from "../src/platform/auth/credentials";
import { createDeletionAttemptStore } from "../src/platform/auth/deletion-attempt";
import { createNativeDeletionTransport } from "../src/platform/auth/deletion-transport";
import { createNativeLogin } from "../src/platform/auth/login";
import { createReauthenticationStore } from "../src/platform/auth/reauthentication";
import { createNativeTransport } from "../src/platform/auth/transport";
import { createMobileApi } from "../src/platform/http";

jest.mock("expo-crypto", () => ({ randomUUID: () => "15a64c18-fd51-4f83-8205-4c917a245e6b" }));
jest.mock("expo-constants", () => {
  const actual = jest.requireActual("expo-constants");
  return {
    ...actual,
    __esModule: true,
    default: {
      ...actual.default,
      expoConfig: { scheme: "baro-preview", hostUri: "127.0.0.1:8081" },
      linkingUri: "baro-preview://",
    },
  };
});
jest.mock("../src/composition/config", () => ({
  readMobileConfig: () =>
    require("../config/environment").resolveMobileConfig({ environment: "preview" }),
}));
jest.mock("../src/composition/credentials", () => ({
  getMobileCredentials: () => mockCredentials,
}));
jest.mock("../src/composition/auth-attempt", () => ({
  getDeletionAttemptStore: () => mockDeletionStore,
  newNativeProof: async () => ({ verifier: "a".repeat(43), challenge: "c".repeat(43) }),
}));
jest.mock("../src/composition/files", () => ({ resetPrivateFiles: () => mockResetFiles() }));
jest.mock("../src/composition/login", () => ({ getNativeLogin: () => mockLogin }));
jest.mock("../src/composition/mobile-auth", () => ({ getMobileAuthClient: () => mockAuth }));
jest.mock("../src/composition/session", () => ({
  getSessionModel: () => ({ getSnapshot: () => mockSession }),
}));
let mockCredentials: {
  scope: ReturnType<typeof createSessionScope>;
  credentials: ReturnType<typeof createNativeCredentials>;
};
let mockDeletionStore: ReturnType<typeof createDeletionAttemptStore>,
  mockLogin: ReturnType<typeof createNativeLogin>,
  mockAuth: ReturnType<typeof createMobileAuthClient>;
let mockSession: SessionState, mockResetFiles: () => Promise<void>;
const id = "15a64c18-fd51-4f83-8205-4c917a245e6b",
  tag = "a".repeat(64),
  verifier = "a".repeat(43),
  config = resolveMobileConfig({ environment: "preview" });
const callback = `baro-preview://auth/callback?attemptId=${id}&code=${"b".repeat(43)}`;
const owner = (id = "synthetic-a"): SessionState => ({
  phase: "ready",
  session: { user: { id, name: "합성", accountType: "customer" }, needsConsent: false },
  busy: false,
  role: "customer",
  consent: null,
  error: null,
});
async function fixture(
  mode:
    | "normal"
    | "new-owner"
    | "lost-browser"
    | "expired"
    | "prepare-lost"
    | "unsigned-prepare" = "normal",
) {
  const disk = new Map<string, string>([["operations", "SYNTHETIC_UNSETTLED"]]),
    requests: string[] = [];
  let reads = 0,
    writes = 0,
    files = 0,
    afterReplacement: { reads: number; writes: number; disk: [string, string][] } | undefined;
  const scope = createSessionScope(),
    storage = {
      getItemAsync: async (key: string) => disk.get(key) ?? null,
      setItemAsync: async (key: string, value: string) => {
        disk.set(key, value);
      },
      deleteItemAsync: async (key: string) => {
        disk.delete(key);
      },
    };
  const credentials = createNativeCredentials({
    scope,
    namespace: "baro_preview_auth",
    storage: {
      getItemAsync: async (key) => {
        reads++;
        return storage.getItemAsync(key);
      },
      setItemAsync: async (key, value) => {
        writes++;
        return storage.setItemAsync(key, value);
      },
    },
    manageStorage: storageAdapter,
    codec: { header: getCookie, merge: getSetCookie },
  });
  await credentials
    .capture()
    .accept("better-auth.session_token=SYNTHETIC_A; Max-Age=600; HttpOnly");
  mockCredentials = { scope, credentials };
  mockSession = owner();
  mockDeletionStore = createDeletionAttemptStore({ key: "deletion", storage });
  const normal = createPendingAuthStore({ key: "normal", now: () => Date.now(), storage });
  const proof = createReauthenticationStore({ key: "reauth", storage });
  mockLogin = createNativeLogin({
    config,
    attempts: normal,
    now: Date.now,
    newId: () => id,
    proof: async () => ({ verifier, challenge: "c".repeat(43) }),
    resetCredentials: () => credentials.reset(),
    authorize: async () => {
      throw new Error("MUST_NOT_START_NORMAL_AUTH");
    },
    openBrowser: async () => {
      throw new Error("MUST_NOT_OPEN_NORMAL_AUTH");
    },
    dismissBrowser: () => {},
    exchange: async () => {
      throw new Error("MUST_NOT_EXCHANGE_AUTH");
    },
    readSession: async () => {
      throw new Error("MUST_NOT_READ_SESSION_FROM_RECEIPT");
    },
    setAccountType: async () => {
      throw new Error("MUST_NOT_CHANGE_ROLE");
    },
    reauthentication: {
      proof,
      prepare: async () => {
        throw new Error("MUST_NOT_PREPARE_REAUTH");
      },
      verify: async () => {
        throw new Error("MUST_NOT_VERIFY_REAUTH");
      },
      access: async () => {
        throw new Error("MUST_NOT_READ_REAUTH");
      },
    },
  });
  mockResetFiles = async () => {
    files++;
    expect(disk.get("operations")).toBe("SYNTHETIC_UNSETTLED");
  };
  const network = async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    requests.push(path);
    const headers = new Headers(init.headers);
    if (path.endsWith("capabilities")) {
      expect(headers.get("cookie")).toBeNull();
      return Response.json({
        contractVersion: 2,
        providers: ["google", "apple"],
        deletionActivity: 1,
      });
    }
    if (path === "/api/me/deletion") {
      expect(headers.get("cookie")).toContain("SYNTHETIC_A");
      return Response.json({
        contractVersion: 2,
        ownerTag: tag,
        recentOAuth: false,
        authenticatedAt: null,
        providers: ["apple"],
      });
    }
    if (path.endsWith("/prepare")) {
      expect(await mockDeletionStore.list()).toEqual([]);
      expect(headers.get("x-baro-deletion-activity")).toBe("1");
      expect(headers.get("x-baro-expected-owner")).toBe("synthetic-a");
      if (mode === "prepare-lost") throw new Error("SYNTHETIC_PREPARE_RESPONSE_LOST");
      return Response.json({
        ownerTag: tag,
        startedAt: Date.now(),
        ...(mode === "unsigned-prepare" ? {} : { activityProof: "d".repeat(64) }),
      });
    }
    if (path === "/api/auth/sign-in/social") {
      expect((await mockDeletionStore.list())[0]).toMatchObject({
        state: "pending",
        activity: { activityProof: "d".repeat(64) },
      });
      const body = JSON.parse(String(init.body));
      expect(body.provider).toBe("apple");
      expect(body.disableRedirect).toBe(true);
      expect(body.idToken).toBeUndefined();
      expect(new URL(body.callbackURL).searchParams.get("purpose")).toBe("delete-account");
      expect(body.callbackURL).not.toContain(verifier);
      return Response.json(
        { url: "https://appleid.apple.com/auth/authorize?state=synthetic", redirect: true },
        {
          headers: {
            "set-cookie": "better-auth.oauth_state=SYNTHETIC_BROWSER_STATE; Max-Age=600; HttpOnly",
          },
        },
      );
    }
    expect([
      "/api/mobile/auth/deletion/exchange",
      "/api/mobile/auth/deletion/status",
      "/api/mobile/auth/deletion/activity",
    ]).toContain(path);
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("origin")).toBe(config.apiBaseUrl);
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("error");
    if (mode === "expired") {
      if (path.endsWith("/activity")) {
        const record = (await mockDeletionStore.list())[0];
        if (record?.state !== "pending") throw new Error("SYNTHETIC_NO_PROOF");
        expect(JSON.parse(String(init.body))).toEqual({
          attemptId: id,
          verifier,
          ownerTag: tag,
          ...record.activity,
        });
        return Response.json({
          contractVersion: 2,
          attemptId: id,
          status: "inactive",
          outcome: "unknown",
          observedAt: "2026-10-24T12:00:00.000Z",
        });
      }
      return Response.json(
        { error: { code: "UNAUTHENTICATED", message: "SYNTHETIC_EXPIRED" } },
        { status: 401 },
      );
    }
    return Response.json(
      { contractVersion: 2, status: "accepted", ownerTag: tag, appleRevocation: "confirmed" },
      { headers: { "set-cookie": "better-auth.session_token=SYNTHETIC_STALE_A; Max-Age=600" } },
    );
  };
  const api = createMobileApi({
    config,
    scope,
    newKey: () => id,
    fetch: network,
    transport: createNativeTransport({ config, credentials, fetch: network }),
  });
  mockAuth = createMobileAuthClient({
    request: (options) =>
      options.path.endsWith("capabilities") ? api.publicRequest(options) : api.request(options),
    completionRequest: createJsonRequester({
      newKey: () => id,
      transport: createNativeDeletionTransport({ config, fetch: network }),
    }),
  });
  const fetch = jest
    .spyOn(globalThis, "fetch")
    .mockImplementation((url, init) => network(String(url), init ?? {}));
  const browser = jest.spyOn(WebBrowser, "openAuthSessionAsync").mockImplementation(async () => {
    if (mode === "lost-browser" || mode === "expired") throw new Error("SYNTHETIC_RETURN_LOST");
    if (mode === "new-owner") {
      await credentials.reset();
      await credentials
        .capture()
        .accept("better-auth.session_token=SYNTHETIC_B; Max-Age=600; HttpOnly");
      scope.transition("synthetic-b");
      mockSession = owner("synthetic-b");
      afterReplacement = {
        reads,
        writes,
        disk: [...disk].filter(([key]) => key.startsWith("baro_preview_auth")),
      };
    } else {
      scope.invalidate();
      mockSession = { ...mockSession, phase: "checking", session: null };
    }
    return { type: "success", url: callback };
  });
  return {
    disk,
    credentials,
    requests,
    stats: () => ({ reads, writes, files }),
    replacement: () => afterReplacement,
    close: () => {
      fetch.mockRestore();
      browser.mockRestore();
    },
  };
}

test("actual coordinator/SDK/native login reset persist a receipt before clearing the warm original jar", async () => {
  const f = await fixture();
  try {
    expect(
      await createNativeDeletionCoordinator().start("apple", "DELETE", "synthetic-a"),
    ).toMatchObject({
      type: "accepted",
      cleanup: "complete",
      localSaved: true,
      outcome: { appleRevocation: "confirmed" },
    });
    expect(await f.credentials.capture().cookie()).toBe("");
    expect(f.stats().files).toBe(1);
    expect((await mockDeletionStore.list())[0]).toMatchObject({
      state: "accepted",
      cleanup: "complete",
    });
    expect(f.disk.get("operations")).toBe("SYNTHETIC_UNSETTLED");
    expect(f.requests).not.toContain("/api/mobile/auth/exchange");
  } finally {
    f.close();
  }
});

test("a new owner during the system browser keeps its real SDK cookie jar and files unchanged on old completion", async () => {
  const f = await fixture("new-owner");
  try {
    expect(
      await createNativeDeletionCoordinator().start("apple", "DELETE", "synthetic-a"),
    ).toMatchObject({ type: "accepted", cleanup: "skipped" });
    const replacement = f.replacement();
    expect(replacement).toBeDefined();
    expect(f.stats()).toEqual({ reads: replacement?.reads, writes: replacement?.writes, files: 0 });
    expect([...f.disk].filter(([key]) => key.startsWith("baro_preview_auth"))).toEqual(
      replacement?.disk,
    );
    expect(await f.credentials.capture().cookie()).toContain("SYNTHETIC_B");
    expect(f.disk.get("operations")).toBe("SYNTHETIC_UNSETTLED");
  } finally {
    f.close();
  }
});

test("cold recovery keeps accepted distinct from unknown cleanup and requires verified-anonymous manual action", async () => {
  const f = await fixture("lost-browser");
  try {
    expect(await createNativeDeletionCoordinator().start("apple", "DELETE", "synthetic-a")).toEqual(
      { type: "unknown", attemptId: id },
    );
    expect((await mockDeletionStore.list())[0]).toMatchObject({
      state: "pending",
      activity: { activityProof: "d".repeat(64) },
    });
    mockSession = { ...mockSession, phase: "checking", session: null };
    const cold = createNativeDeletionCoordinator(),
      before = f.stats();
    expect(await cold.complete(callback)).toMatchObject({
      type: "accepted",
      cleanup: "failed",
      localSaved: true,
    });
    expect(f.stats()).toEqual(before);
    await expect(cold.clearAnonymousDevice(id)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    mockSession = {
      ...mockSession,
      phase: "anonymous",
      session: { user: null, needsConsent: false },
    };
    await cold.clearAnonymousDevice(id);
    expect(await f.credentials.capture().cookie()).toBe("");
    expect((await mockDeletionStore.list())[0]).toMatchObject({
      state: "accepted",
      cleanup: "complete",
    });
  } finally {
    f.close();
  }
});

test("actual completion transport observes an expired proof without reading/resetting the current SDK jar or files", async () => {
  const f = await fixture("expired");
  try {
    const coordinator = createNativeDeletionCoordinator();
    expect(await coordinator.start("apple", "DELETE", "synthetic-a")).toEqual({
      type: "unknown",
      attemptId: id,
    });
    const original = (await mockDeletionStore.list())[0],
      before = f.stats();
    expect(await coordinator.reconcile(id)).toEqual({
      type: "inactive",
      attemptId: id,
      ownerId: "synthetic-a",
      observedAt: "2026-10-24T12:00:00.000Z",
    });
    expect(f.requests.slice(-3)).toEqual([
      "/api/mobile/auth/deletion/status",
      "/api/mobile/auth/deletion/activity",
      "/api/mobile/auth/deletion/status",
    ]);
    expect(f.stats()).toEqual(before);
    expect(await mockDeletionStore.list()).toEqual([
      { ...original, state: "inactive", observedAt: "2026-10-24T12:00:00.000Z" },
    ]);
    expect(f.disk.get("operations")).toBe("SYNTHETIC_UNSETTLED");
    expect(f.requests).not.toContain("/api/mobile/auth/deletion/exchange");
  } finally {
    f.close();
  }
});

for (const mode of ["prepare-lost", "unsigned-prepare"] as const) {
  test(`actual coordinator refuses OAuth and leaves no unsigned pending on ${mode}`, async () => {
    const f = await fixture(mode);
    try {
      await expect(
        createNativeDeletionCoordinator().start("apple", "DELETE", "synthetic-a"),
      ).rejects.toMatchObject({ code: "UNAVAILABLE" });
      expect(await mockDeletionStore.list()).toEqual([]);
      expect(f.requests).not.toContain("/api/auth/sign-in/social");
      expect(f.requests).not.toContain("/api/mobile/auth/deletion/exchange");
      expect(f.stats().files).toBe(0);
      expect(await f.credentials.capture().cookie()).toContain("SYNTHETIC_A");
    } finally {
      f.close();
    }
  });
}
