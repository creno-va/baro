import { expect, test } from "bun:test";
import { createSessionScope } from "@baro/client-core";
import { CURRENT_POLICY_VERSIONS } from "@baro/contracts/consent";
import { Hono } from "hono";
import { resolveMobileConfig } from "../apps/mobile/config/environment";
import {
  type CredentialStorage,
  createNativeCredentials,
} from "../apps/mobile/src/platform/auth/credentials";
import { createNativeTransport } from "../apps/mobile/src/platform/auth/transport";
import { createMobileApi } from "../apps/mobile/src/platform/http";
import type { ApiEnvironment } from "../src/server/api/errors";
import { meApi } from "../src/server/api/me";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(
  options: { storage?: Partial<Pick<CredentialStorage, "getItemAsync" | "setItemAsync">> } = {},
) {
  const values = new Map<string, string>();
  const scope = createSessionScope();
  const credentials = createNativeCredentials({
    scope,
    namespace: "baro_preview_auth",
    storage: {
      getItemAsync: async (key) => values.get(key) ?? null,
      setItemAsync: async (key, value) => {
        values.set(key, value);
      },
      ...options.storage,
    },
    // This fake reproduces the SDK's swallowed write errors. Actual pinned SDK
    // chunking and cookie expiry are covered by the native Jest integration.
    manageStorage: (storage) => ({
      getItemAsync: (key) => storage.getItemAsync(key),
      setItemAsync: async (key, value) => {
        await storage.setItemAsync(key, value).catch(() => {});
      },
    }),
    codec: {
      header: (value) => (value ? ((JSON.parse(value) as { cookie?: string }).cookie ?? "") : ""),
      merge: (header) => JSON.stringify({ cookie: header }),
    },
  });
  return { scope, values, credentials };
}
const config = resolveMobileConfig({ environment: "preview" });

test("native HTTP owns Cookie/Origin and persists success and failure Set-Cookie exactly once", async () => {
  const f = fixture();
  await f.credentials.capture().accept("synthetic=a");
  const requests: RequestInit[] = [];
  const transport = createNativeTransport({
    config,
    credentials: f.credentials,
    fetch: async (url, init) => {
      expect(url).toBe("https://preview.baro.site/api/me/session");
      requests.push(init);
      return Response.json(
        { user: null, needsConsent: false },
        {
          status: requests.length === 1 ? 200 : 401,
          headers: { "set-cookie": requests.length === 1 ? "synthetic=b" : "" },
        },
      );
    },
  });
  const first = await transport("/api/me/session", {
    headers: { cookie: "untrusted", authorization: "untrusted", origin: "https://foreign.invalid" },
  });
  expect(first.headers.has("set-cookie")).toBe(false);
  expect((await first.json()) as { user: null; needsConsent: boolean }).toEqual({
    user: null,
    needsConsent: false,
  });
  await transport("/api/me/session", {});
  for (const request of requests) {
    const headers = new Headers(request.headers);
    expect(headers.get("origin")).toBe(config.apiBaseUrl);
    expect(headers.has("authorization")).toBe(false);
    expect(request.credentials).toBe("omit");
    expect(request.redirect).toBe("error");
    expect(request.cache).toBe("no-store");
  }
  expect(new Headers(requests[0]?.headers).get("cookie")).toBe("synthetic=a");
  expect(new Headers(requests[1]?.headers).get("cookie")).toBe("synthetic=b");
});

test("a late response cannot repopulate the next account jar and its body is discarded", async () => {
  const f = fixture();
  const response = deferred<Response>(),
    entered = deferred<void>();
  let discarded = false;
  const transport = createNativeTransport({
    config,
    credentials: f.credentials,
    fetch: async () => {
      entered.resolve();
      return response.promise;
    },
  });
  const old = transport("/api/me/session", {});
  void old.catch(() => {});
  await entered.promise;
  await f.credentials.reset();
  await f.credentials.capture().accept("synthetic=new-account");
  response.resolve(
    new Response(
      new ReadableStream({
        cancel() {
          discarded = true;
        },
      }),
      {
        headers: { "set-cookie": "synthetic=previous-account" },
      },
    ),
  );
  await expect(old).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(discarded).toBe(true);
  expect(await f.credentials.capture().cookie()).toBe("synthetic=new-account");
});

test("reset invalidates immediately and an old in-progress disk write finishes before clearing", async () => {
  const disk = new Map<string, string>(),
    entered = deferred<void>(),
    release = deferred<void>();
  let delayed = true;
  const f = fixture({
    storage: {
      getItemAsync: async (key) => disk.get(key) ?? null,
      setItemAsync: async (key, value) => {
        if (delayed) {
          delayed = false;
          entered.resolve();
          await release.promise;
        }
        disk.set(key, value);
      },
    },
  });
  const oldFrame = f.credentials.capture();
  const old = oldFrame.accept("synthetic=old");
  void old.catch(() => {});
  await entered.promise;
  const generation = f.scope.snapshot();
  const reset = f.credentials.reset();
  expect(f.scope.isCurrent(generation)).toBe(false);
  const fresh = f.credentials.capture().cookie();
  release.resolve();
  await expect(old).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  await reset;
  expect(await fresh).toBe("");
  await expect(oldFrame.accept("synthetic=late")).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
  expect(disk.get("baro_preview_auth_cookie")).toBe("{}");
  expect(disk.get("baro_preview_auth_session_data")).toBe("{}");
});

test("swallowed, silent and locked storage failures never grant a usable cookie; reset can recover", async () => {
  for (const mode of ["throw", "silent"] as const) {
    const disk = new Map<string, string>();
    let broken = true;
    const f = fixture({
      storage: {
        getItemAsync: async (key) => disk.get(key) ?? null,
        setItemAsync: async (key, value) => {
          if (broken) {
            if (mode === "throw") throw new Error("SYNTHETIC_PRIVATE_STORAGE_DETAIL");
            return;
          }
          disk.set(key, value);
        },
      },
    });
    const error = await f.credentials
      .capture()
      .accept("synthetic=private")
      .catch((value: unknown) => value);
    expect(error).toMatchObject({ code: "UNAVAILABLE" });
    expect(String(error)).not.toContain("SYNTHETIC_PRIVATE_STORAGE_DETAIL");
    expect(String(error)).not.toContain("synthetic=private");
    await expect(f.credentials.capture().cookie()).rejects.toMatchObject({ code: "UNAVAILABLE" });
    broken = false;
    await f.credentials.reset();
    await f.credentials.capture().accept("synthetic=verified");
    expect(await f.credentials.capture().cookie()).toBe("synthetic=verified");
  }
});

test("credential scopes isolate environment namespaces and reset preserves unresolved operation storage", async () => {
  const f = fixture();
  f.values.set("baro_case_pending_synthetic", "opaque-key");
  f.values.set("baro_production_auth_cookie", JSON.stringify({ cookie: "synthetic=production" }));
  await f.credentials.capture().accept("synthetic=preview");
  await f.credentials.reset();
  expect(f.values.get("baro_case_pending_synthetic")).toBe("opaque-key");
  expect(f.values.get("baro_production_auth_cookie")).toContain("synthetic=production");
});

test("failed and superseded resets keep requests closed until the latest clear is durably verified", async () => {
  let locked = true;
  const disk = new Map<string, string>();
  const f = fixture({
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
  await expect(f.credentials.reset()).rejects.toMatchObject({ code: "UNAVAILABLE" });
  await expect(f.credentials.capture().cookie()).rejects.toMatchObject({ code: "UNAVAILABLE" });
  locked = false;
  const previous = f.credentials.reset();
  const latest = f.credentials.reset();
  await expect(previous).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  await latest;
  await expect(f.credentials.capture().cookie()).resolves.toBe("");
});

test("foreign requests and redirect responses never receive or persist credentials", async () => {
  const f = fixture();
  let calls = 0;
  const transport = createNativeTransport({
    config,
    credentials: f.credentials,
    fetch: async () => {
      calls++;
      const response = new Response(null, { headers: { "set-cookie": "synthetic=foreign" } });
      Object.defineProperty(response, "url", { value: "https://foreign.invalid/api/me/session" });
      return response;
    },
  });
  for (const path of [
    "https://foreign.invalid/api/me",
    "//foreign.invalid/api/me",
    "/login",
    "/api/me#fragment",
    "https://a:b@preview.baro.site/api/me",
  ]) {
    await expect(transport(path, {})).rejects.toMatchObject({ code: "UNAVAILABLE" });
  }
  expect(calls).toBe(0);
  await expect(transport("/api/me/session", {})).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(await f.credentials.capture().cookie()).toBe("");
});

test("public browsing stays anonymous when credential storage is locked", async () => {
  const f = fixture({
    storage: {
      getItemAsync: async () => {
        throw new Error("SYNTHETIC_LOCKED");
      },
    },
  });
  const api = createMobileApi({
    config,
    scope: f.scope,
    newKey: () => crypto.randomUUID(),
    transport: createNativeTransport({
      config,
      credentials: f.credentials,
      fetch: async () => {
        throw new Error("SYNTHETIC_NOT_EXPECTED");
      },
    }),
    fetch: async (_url, init) => {
      expect(new Headers(init.headers).has("cookie")).toBe(false);
      return Response.json({
        items: [],
        nextCursor: null,
        expiresAt: "2026-10-23T00:00:00.000Z",
        rotation: { day: "2026-10-22", algorithm: "daily_sha256_pivot_v1" },
      });
    },
  });
  await expect(api.session.get()).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect((await api.directory.listPage()).items).toEqual([]);
});

test("native transport and the shared session client preserve real Hono role, consent and Origin guards", async () => {
  const db = await createTestDatabase();
  try {
    const seeded = await seedTestSession(db);
    const app = new Hono<ApiEnvironment>().route("/api/me", meApi);
    const local = resolveMobileConfig({
      environment: "local",
      apiBaseUrl: seeded.env.BETTER_AUTH_URL,
    });
    const f = fixture();
    await f.credentials.capture().accept(seeded.cookie);
    const nativeFetch = async (url: string, init: RequestInit) =>
      app.request(url, init, seeded.env);
    const api = createMobileApi({
      config: local,
      scope: f.scope,
      newKey: () => crypto.randomUUID(),
      fetch: nativeFetch,
      transport: createNativeTransport({
        config: local,
        credentials: f.credentials,
        fetch: nativeFetch,
      }),
    });
    expect((await api.session.get()).user?.id).toBe(seeded.userId);
    expect((await api.session.get()).needsConsent).toBe(true);
    await api.session.setAccountType("lawyer");
    await api.session.saveConsent({ ...CURRENT_POLICY_VERSIONS, over14Confirmed: true });
    const live = await api.session.get();
    expect(live.user?.accountType).toBe("lawyer");
    expect(live.needsConsent).toBe(false);
    const denied = await app.request(
      "/api/me/account-type",
      {
        method: "PUT",
        headers: { cookie: seeded.cookie, "content-type": "application/json" },
        body: JSON.stringify({ accountType: "customer" }),
      },
      seeded.env,
    );
    expect(denied.status).toBe(403);
    expect((await api.session.get()).user?.accountType).toBe("lawyer");
    await f.credentials.reset();
    expect((await api.session.get()).user).toBeNull();
  } finally {
    db.close();
  }
});

test("cookie revision retires synchronously on reset and stale accepts cannot replace it; foreground scopes alone do not", async () => {
  const f = fixture();
  await f.credentials.capture().accept("synthetic=a");
  const revision = f.credentials.revision(),
    stale = f.credentials.capture();
  f.scope.invalidate();
  expect(f.credentials.isRevisionCurrent(revision)).toBe(true);
  await expect(stale.accept("synthetic=stale")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(f.credentials.revision()).toBe(revision);
  const reset = f.credentials.reset();
  expect(f.credentials.isRevisionCurrent(revision)).toBe(false);
  const replacement = f.credentials.revision();
  await reset;
  expect(f.credentials.revision()).toBe(replacement);
  await f.credentials.capture().accept(null);
  expect(f.credentials.revision()).toBe(replacement);
});
