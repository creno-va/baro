import { createSessionScope } from "@baro/client-core";
import { getCookie, getSetCookie, storageAdapter } from "@better-auth/expo/client";
import { resolveMobileConfig } from "../config/environment";
import { getMobileAuthClient } from "../src/composition/mobile-auth";
import { createNativeCredentials } from "../src/platform/auth/credentials";
import { createNativeTransport } from "../src/platform/auth/transport";
import { createMobileApi } from "../src/platform/http";

jest.mock("expo-crypto", () => ({ randomUUID: () => require("node:crypto").randomUUID() }));
jest.mock("../src/composition/api", () => ({ getMobileApi: () => mockApi }));
jest.mock("../src/composition/config", () => ({
  readMobileConfig: () =>
    require("../config/environment").resolveMobileConfig({ environment: "preview" }),
}));
let mockApi: ReturnType<typeof createMobileApi>;
const config = resolveMobileConfig({ environment: "preview" }),
  tag = "a".repeat(64);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  const values = new Map<string, string>(),
    requests: { url: string; init: RequestInit }[] = [],
    scope = createSessionScope();
  let locked = false,
    reads = 0,
    writes = 0;
  const credentials = createNativeCredentials({
    scope,
    namespace: "baro_preview_auth",
    storage: {
      getItemAsync: async (key) => {
        reads++;
        if (locked) throw new Error("SYNTHETIC_LOCKED");
        return values.get(key) ?? null;
      },
      setItemAsync: async (key, value) => {
        writes++;
        if (locked) throw new Error("SYNTHETIC_LOCKED");
        values.set(key, value);
      },
    },
    manageStorage: storageAdapter,
    codec: { header: getCookie, merge: getSetCookie },
  });
  const network = async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    if (url.endsWith("/api/mobile/auth/capabilities"))
      return Response.json({
        contractVersion: 2,
        providers: ["google", "naver", "kakao", "apple"],
      });
    if (url.endsWith("/api/me/deletion"))
      return Response.json({
        contractVersion: 2,
        ownerTag: tag,
        recentOAuth: false,
        authenticatedAt: null,
        providers: ["google", "apple"],
      });
    throw new Error("SYNTHETIC_UNEXPECTED_NETWORK_PATH");
  };
  mockApi = createMobileApi({
    config,
    scope,
    transport: createNativeTransport({ config, credentials, fetch: network }),
    fetch: network,
    newKey: () => "synthetic-key",
  });
  return {
    values,
    requests,
    scope,
    credentials,
    lock: () => {
      locked = true;
    },
    stats: () => ({ reads, writes }),
  };
}

test("capabilities use the actual anonymous requester when SecureStore is locked, while private access still requires the native jar", async () => {
  const f = fixture();
  f.lock();
  const auth = getMobileAuthClient();
  const protocol = await auth.capabilities();
  expect(protocol.providers).toContain("apple");
  expect(f.stats()).toEqual({ reads: 0, writes: 0 });
  expect(f.requests).toHaveLength(1);
  expect(new Headers(f.requests[0]?.init.headers).get("cookie")).toBeNull();
  expect(f.requests[0]?.init.credentials).toBe("omit");
  await expect(auth.deletionAccess(protocol, "synthetic-a")).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  expect(f.requests).toHaveLength(1);
  expect(f.stats().reads).toBeGreaterThan(0);
});

test("private v2 access retains expected-owner/contract/Origin and the actual SDK cookie codec", async () => {
  const f = fixture();
  await f.credentials
    .capture()
    .accept("better-auth.session_token=SYNTHETIC_A; Max-Age=600; HttpOnly");
  expect(
    await getMobileAuthClient().deletionAccess(
      { contractVersion: 2, providers: ["apple"] },
      "synthetic-a",
    ),
  ).toMatchObject({ contractVersion: 2, ownerTag: tag, providers: ["google", "apple"] });
  const request = f.requests[0],
    headers = new Headers(request?.init.headers);
  expect(headers.get("cookie")).toBe("better-auth.session_token=SYNTHETIC_A");
  expect(headers.get("origin")).toBe(config.apiBaseUrl);
  expect(headers.get("x-baro-auth-contract")).toBe("2");
  expect(headers.get("x-baro-expected-owner")).toBe("synthetic-a");
});

test("composed completion survives owner replacement without any new-jar read or Set-Cookie write", async () => {
  const f = fixture(),
    entered = deferred<void>(),
    response = deferred<Response>();
  const fetch = jest.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const headers = new Headers(init?.headers);
    expect([...headers.keys()].sort()).toEqual(["content-type", "origin", "x-baro-auth-contract"]);
    expect(init?.credentials).toBe("omit");
    entered.resolve();
    return response.promise;
  });
  try {
    const pending = getMobileAuthClient().exchangeDeletion(
      {
        attemptId: "15a64c18-fd51-4f83-8205-4c917a245e6b",
        verifier: "a".repeat(43),
        code: "b".repeat(43),
      },
      tag,
    );
    await entered.promise;
    await f.credentials.reset();
    await f.credentials
      .capture()
      .accept("better-auth.session_token=SYNTHETIC_B; Max-Age=600; HttpOnly");
    f.scope.transition("synthetic-b");
    const disk = [...f.values],
      stats = f.stats();
    response.resolve(
      Response.json(
        { contractVersion: 2, status: "accepted", ownerTag: tag, appleRevocation: "unconfirmed" },
        { headers: { "set-cookie": "better-auth.session_token=SYNTHETIC_OLD_A; Max-Age=600" } },
      ),
    );
    expect(await pending).toMatchObject({ status: "accepted", ownerTag: tag });
    expect(f.stats()).toEqual(stats);
    expect([...f.values]).toEqual(disk);
    expect(f.requests).toHaveLength(0);
  } finally {
    fetch.mockRestore();
  }
});
