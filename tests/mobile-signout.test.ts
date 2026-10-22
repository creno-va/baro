import { expect, test } from "bun:test";
import { createSessionScope } from "@baro/client-core";
import { Hono } from "hono";
import { resolveMobileConfig } from "../apps/mobile/config/environment";
import { createNativeCredentials } from "../apps/mobile/src/platform/auth/credentials";
import { signOutNative } from "../apps/mobile/src/platform/auth/sign-out";
import { api } from "../src/server/api";
import type { ApiEnvironment } from "../src/server/api/errors";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

function fixture() {
  const disk = new Map<string, string>(),
    scope = createSessionScope();
  const credentials = createNativeCredentials({
    scope,
    namespace: "baro_local_auth",
    storage: {
      getItemAsync: async (key) => disk.get(key) ?? null,
      setItemAsync: async (key, value) => {
        disk.set(key, value);
      },
    },
    manageStorage: (storage) => storage,
    codec: {
      header: (value) => (value ? ((JSON.parse(value) as { cookie?: string }).cookie ?? "") : ""),
      merge: (value) => JSON.stringify({ cookie: value }),
    },
  });
  return { scope, credentials };
}
test("native logout clears the local jar, revokes the exact real Hono/SQL session and preserves a peer", async () => {
  const db = await createTestDatabase();
  try {
    const a = await seedTestSession(db),
      b = await seedTestSession(db);
    const app = new Hono<ApiEnvironment>().route("/api", api),
      f = fixture();
    await f.credentials.capture().accept(a.cookie);
    const config = resolveMobileConfig({ environment: "local", apiBaseUrl: a.env.BETTER_AUTH_URL });
    expect(
      await signOutNative({
        config,
        ...f,
        cancelLogin: () => f.credentials.reset(),
        fetch: async (url, init) => {
          expect(await f.credentials.capture().cookie()).toBe("");
          expect(new Headers(init.headers).get("cookie")).toBe(a.cookie);
          expect(new Headers(init.headers).get("origin")).toBe(config.apiBaseUrl);
          expect(init.credentials).toBe("omit");
          expect(init.redirect).toBe("error");
          return app.request(url, init, a.env);
        },
      }),
    ).toEqual({ serverRevoked: true });
    expect(await f.credentials.capture().cookie()).toBe("");
    const old = await app.request("/api/me/session", { headers: { cookie: a.cookie } }, a.env);
    expect(((await old.json()) as { user: unknown }).user).toBeNull();
    const peer = await app.request("/api/me/session", { headers: { cookie: b.cookie } }, b.env);
    expect(((await peer.json()) as { user: { id: string } }).user.id).toBe(b.userId);
  } finally {
    db.close();
  }
});

test("a delayed revocation response cannot refill or clear a new login's jar", async () => {
  const f = fixture();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((done) => {
      release = done;
    }),
    ready = new Promise<void>((done) => {
      entered = done;
    });
  await f.credentials.capture().accept("synthetic=old");
  const pending = signOutNative({
    ...f,
    config: resolveMobileConfig({ environment: "preview" }),
    cancelLogin: () => f.credentials.reset(),
    fetch: async () => {
      entered();
      await gate;
      return Response.json({ success: true }, { headers: { "set-cookie": "synthetic=late" } });
    },
  });
  await ready;
  await f.credentials.capture().accept("synthetic=new");
  release();
  expect(await pending).toEqual({ serverRevoked: true });
  expect(await f.credentials.capture().cookie()).toBe("synthetic=new");
});

test("remote failure reports local-only logout, while failed local clearing never reports success", async () => {
  const f = fixture(),
    config = resolveMobileConfig({ environment: "preview" });
  await f.credentials.capture().accept("synthetic=old");
  expect(
    await signOutNative({
      ...f,
      config,
      cancelLogin: () => f.credentials.reset(),
      fetch: async () => {
        throw new Error("SYNTHETIC_NETWORK");
      },
    }),
  ).toEqual({ serverRevoked: false });
  expect(await f.credentials.capture().cookie()).toBe("");
  let calls = 0;
  await expect(
    signOutNative({
      ...f,
      config,
      cancelLogin: async () => {
        throw new Error("SYNTHETIC_LOCKED");
      },
      fetch: async () => {
        calls++;
        return new Response();
      },
    }),
  ).rejects.toThrow("SYNTHETIC_LOCKED");
  expect(calls).toBe(0);
});

test("a successful HTML or malformed response cannot be treated as a server revocation acknowledgement", async () => {
  for (const response of [
    new Response("<html>synthetic</html>", { headers: { "content-type": "text/html" } }),
    Response.json({ success: false }),
    Response.json({ status: "ok" }),
  ]) {
    const f = fixture();
    await f.credentials.capture().accept("synthetic=old");
    expect(
      await signOutNative({
        ...f,
        config: resolveMobileConfig({ environment: "preview" }),
        cancelLogin: () => f.credentials.reset(),
        fetch: async () => response,
      }),
    ).toEqual({ serverRevoked: false });
    expect(await f.credentials.capture().cookie()).toBe("");
  }
});
