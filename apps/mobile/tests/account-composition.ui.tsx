import { createHash } from "node:crypto";
import type { JsonRequestOptions } from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";
import { getCookie, getSetCookie, storageAdapter } from "@better-auth/expo/client";
import { resolveMobileConfig } from "../config/environment";
import { createNativeAccount } from "../src/composition/account";
import { createPendingAuthStore } from "../src/platform/auth/attempt";
import { createNativeCredentials } from "../src/platform/auth/credentials";
import { createNativeLogin } from "../src/platform/auth/login";
import { createReauthenticationStore } from "../src/platform/auth/reauthentication";
import { createCaseOperationStorage } from "../src/platform/storage/case-operations";

jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: async (_algorithm: string, value: string) =>
    require("node:crypto").createHash("sha256").update(value).digest("hex"),
  randomUUID: () => require("node:crypto").randomUUID(),
}));
jest.mock("../src/composition/credentials", () => ({
  getMobileCredentials: () => mockCredentials,
}));
jest.mock("../src/composition/auth-attempt", () => ({ getReauthenticationStore: () => mockProof }));
jest.mock("../src/composition/cases", () => ({ getCaseOperationStorage: () => mockStorage }));
jest.mock("../src/composition/api", () => ({ getMobileApi: () => ({ request: mockRequest }) }));
jest.mock("../src/composition/files", () => ({ resetPrivateFiles: () => mockResetFiles() }));
jest.mock("../src/composition/login", () => ({ getNativeLogin: () => mockLogin }));
jest.mock("../src/composition/session", () => ({ getSessionModel: () => mockSession }));

let mockCredentials: {
  scope: ReturnType<typeof createSessionScope>;
  credentials: ReturnType<typeof createNativeCredentials>;
};
let mockProof: ReturnType<typeof createReauthenticationStore>,
  mockStorage: ReturnType<typeof createCaseOperationStorage>,
  mockLogin: ReturnType<typeof createNativeLogin>;
let mockRequest: <T>(options: JsonRequestOptions) => Promise<T>,
  mockResetFiles: () => Promise<void>;
let mockSession: {
  loadReauthentication(): Promise<void>;
  reauthenticate(): Promise<void>;
  getSnapshot(): { session: { user: { id: string } } };
};
const tag = "a".repeat(64),
  time = Date.parse("2026-10-23T00:00:00.000Z");
const fingerprint = async (value: string) => createHash("sha256").update(value).digest("hex");
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
  throw new Error("SYNTHETIC_ACCOUNT_DID_NOT_ADVANCE");
}
async function fixture() {
  const disk = new Map<string, string>(),
    scope = createSessionScope(),
    requests: JsonRequestOptions[] = [];
  let fileCalls = 0;
  const storage = {
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
    storage,
    manageStorage: storageAdapter,
    codec: { header: getCookie, merge: getSetCookie },
  });
  const attempts = createPendingAuthStore({ key: "pending_auth", now: () => time, storage });
  mockProof = createReauthenticationStore({ key: "reauth_proof", storage });
  mockStorage = createCaseOperationStorage({
    namespace: "baro_preview_operations",
    fingerprint,
    storage: {
      get: storage.getItemAsync,
      set: storage.setItemAsync,
      remove: storage.deleteItemAsync,
    },
  });
  mockCredentials = { scope, credentials };
  mockLogin = createNativeLogin({
    config: resolveMobileConfig({ environment: "preview" }),
    attempts,
    now: () => time,
    newId: () => "15a64c18-fd51-4f83-8205-4c917a245e6b",
    proof: async () => ({ verifier: "v".repeat(43), challenge: "q".repeat(43) }),
    resetCredentials: () => credentials.reset(),
    authorize: async () => ({ url: "https://synthetic.invalid/authorize" }),
    openBrowser: async () => ({ type: "cancelled" }),
    dismissBrowser: jest.fn(),
    exchange: async () => {
      throw new Error("NO_EXCHANGE");
    },
    readSession: async () => ({ user: null, needsConsent: false }),
    setAccountType: async () => {},
    reauthentication: {
      proof: mockProof,
      prepare: async () => {},
      verify: async () => {},
      access: async () => ({ ownerTag: tag }),
    },
  });
  mockResetFiles = async () => {
    fileCalls++;
  };
  mockSession = {
    loadReauthentication: async () => {},
    reauthenticate: jest.fn(async () => {}),
    getSnapshot: () => ({ session: { user: { id: "owner_a" } } }),
  };
  mockRequest = async <T,>(options: JsonRequestOptions) => {
    requests.push(options);
    return (
      options.path.endsWith("/deletion")
        ? {
            ownerTag: tag,
            recentOAuth: true,
            authenticatedAt: new Date(time).toISOString(),
            providers: ["google"],
          }
        : { status: "accepted" }
    ) as T;
  };
  await credentials
    .capture()
    .accept(`better-auth.session_token=${"synthetic".repeat(600)}; Max-Age=3600`);
  await attempts.put({
    attemptId: "15a64c18-fd51-4f83-8205-4c917a245e6b",
    verifier: "v".repeat(43),
    createdAt: time,
    accountType: "customer",
    provider: "google",
    purpose: "login",
  });
  await mockProof.put({
    attemptId: "8ab4833d-b89b-4555-95f7-33f03ea46d6b",
    ownerTag: tag,
    startedAt: time - 1000,
  });
  await mockStorage.setItem("baro-workspace-job:case_peer", "job_peer");
  disk.set("unrelated_key", "preserved");
  return { scope, credentials, disk, attempts, requests, fileCalls: () => fileCalls };
}

test("actual account composition drains files then NativeLogin, pinned cookie chunks/proof/attempts; recovery and unrelated keys survive", async () => {
  const f = await fixture(),
    accepted = jest.fn(),
    pause = deferred();
  mockResetFiles = async () => {
    await pause.promise;
  };
  const client = createNativeAccount(new AbortController().signal, "owner_a", accepted),
    task = client.deleteAccount("DELETE");
  await until(() => accepted.mock.calls.length === 1);
  expect(await f.credentials.capture().cookie()).toContain("synthetic");
  pause.resolve();
  expect(await task).toEqual({ status: "accepted", cleanupFailed: false });
  expect(await f.credentials.capture().cookie()).toBe("");
  expect([...f.disk.values()].join("")).not.toContain("synthetic");
  expect(await mockProof.load()).toBeNull();
  expect(await f.attempts.load()).toBeNull();
  expect(await mockStorage.getItem("baro-workspace-job:case_peer")).toBe("job_peer");
  expect(f.disk.get("unrelated_key")).toBe("preserved");
  expect(f.requests.filter((request) => request.method === "DELETE")).toHaveLength(1);
  expect(f.requests.every((request) => request.expectedOwner === "owner_a")).toBe(true);
});

test("native file cleanup failure cannot skip credential/proof reset or reverse validated ACK", async () => {
  const f = await fixture();
  mockResetFiles = async () => {
    throw new Error("PRIVATE_NATIVE_STACK");
  };
  expect(
    await createNativeAccount(new AbortController().signal, "owner_a", jest.fn()).deleteAccount(
      "DELETE",
    ),
  ).toEqual({ status: "accepted", cleanupFailed: true });
  expect(await f.credentials.capture().cookie()).toBe("");
  expect(await mockProof.load()).toBeNull();
  expect([...f.disk.values()].some((value) => value.includes('"state":"accepted"'))).toBe(true);
  expect(await mockStorage.getItem("baro-workspace-job:case_peer")).toBe("job_peer");
});

test("an auth replacement during file drain protects the new pinned SDK jar, proof and pending attempt", async () => {
  const f = await fixture(),
    pause = deferred(),
    accepted = jest.fn();
  mockResetFiles = async () => {
    await pause.promise;
  };
  const task = createNativeAccount(new AbortController().signal, "owner_a", accepted).deleteAccount(
    "DELETE",
  );
  await until(() => accepted.mock.calls.length === 1);
  await f.credentials.reset();
  await f.credentials.capture().accept("better-auth.session_token=synthetic_peer; Max-Age=3600");
  await mockProof.put({
    attemptId: "a309809a-752b-4375-8baf-c1677c07c975",
    ownerTag: "b".repeat(64),
    startedAt: time,
  });
  pause.resolve();
  expect(await task).toEqual({ status: "accepted", cleanupFailed: true });
  expect(await f.credentials.capture().cookie()).toContain("synthetic_peer");
  expect((await mockProof.load())?.ownerTag).toBe("b".repeat(64));
  expect(await f.attempts.load()).not.toBeNull();
});

test("reauthentication awaiting fresh provider lookup cannot launch for a replacement owner", async () => {
  const f = await fixture();
  mockSession.loadReauthentication = async () => {
    f.scope.invalidate();
  };
  await expect(
    createNativeAccount(new AbortController().signal, "owner_a", jest.fn()).reauthenticate(
      "google",
    ),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(mockSession.reauthenticate).not.toHaveBeenCalled();
  expect(await f.credentials.capture().cookie()).toContain("synthetic");
});
