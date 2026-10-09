import { expect, test } from "bun:test";
import { Hono } from "hono";
import { casesApi } from "../src/client/api/cases";
import { meApi } from "../src/server/api/me";
import { createWorkspacesApi } from "../src/server/api/v2/workspaces";
import { customerWorkspaceFixture } from "./helpers/customer-workspace";
import { seedTestSession } from "./helpers/session";

for (const releaseOldBeforeRetry of [false, true]) {
  test(`owner switch creation retry; late old success arrives before retry=${releaseOldBeforeRetry}`, async () => {
    const f = await customerWorkspaceFixture(new Date().toISOString());
    const b = await seedTestSession(f.db, { consent: true });
    const sitekey = process.env.PUBLIC_TURNSTILE_SITE_KEY;
    process.env.PUBLIC_TURNSTILE_SITE_KEY = "synthetic-local-key";
    const originalFetch = globalThis.fetch,
      originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window"),
      originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    const node = () => ({
      setAttribute() {},
      appendChild() {},
      showModal() {},
      close() {},
      remove() {},
      addEventListener() {},
      textContent: "",
      type: "",
      onclick: null,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { createElement: node, body: { appendChild() {} }, head: { appendChild() {} } },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        turnstile: {
          render(_element: unknown, options: { callback: (token: string) => void }) {
            queueMicrotask(() => options.callback("synthetic-local-token"));
            return "synthetic-widget";
          },
          remove() {},
        },
      },
    });
    const env = {
      ...f.owner.env,
      CASE_DATA_KEY_V1: btoa("w".repeat(32)).replace(/=+$/, ""),
      CASE_ACCOUNT_LIMIT: { limit: async () => ({ success: true }) },
      CASE_IP_LIMIT: { limit: async () => ({ success: true }) },
    };
    const app = new Hono()
      .route("/api/me", meApi)
      .route("/api/v2/cases", createWorkspacesApi({ turnstile: async () => true }));
    let cookie = f.owner.cookie,
      holdOld = true,
      dropB = true;
    let releaseOld!: () => void, oldReached!: () => void;
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    const oldReadStarted = new Promise<void>((resolve) => {
      oldReached = resolve;
    });
    const keys: string[] = [];
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url),
        who = cookie;
      const response = await app.request(
        path,
        {
          ...init,
          headers: {
            ...Object.fromEntries(new Headers(init?.headers)),
            cookie: who,
            origin: env.BETTER_AUTH_URL,
            "cf-connecting-ip": "127.0.0.1",
          },
        },
        env,
      );
      if (who === f.owner.cookie && path.endsWith("/intake") && holdOld) {
        holdOld = false;
        expect(response.status).toBe(200);
        oldReached();
        await oldGate;
      }
      if (who === b.cookie && init?.method === "POST" && path === "/api/v2/cases") {
        keys.push(new Headers(init.headers).get("idempotency-key")!);
        if (dropB) {
          dropB = false;
          expect(response.status).toBe(201);
          throw new TypeError("Synthetic committed create ACK loss");
        }
      }
      return response;
    }) as typeof fetch;
    try {
      const input = {
        narrative: `계정 전환 생성 재시도를 확인하는 합성 사건입니다. ${crypto.randomUUID()}`,
        subjectContext: "individual" as const,
      };
      const old = casesApi.create(input);
      await oldReadStarted;
      cookie = b.cookie;
      await expect(casesApi.create(input)).rejects.toMatchObject({ code: "UNAVAILABLE" });
      expect(
        f.db.sqlite.query("SELECT count(*) n FROM v2_workspaces WHERE owner_id=?").get(b.userId),
      ).toEqual({ n: 1 });
      if (releaseOldBeforeRetry) {
        releaseOld();
        await old;
      }
      await casesApi.create(input);
      expect(
        f.db.sqlite.query("SELECT count(*) n FROM v2_workspaces WHERE owner_id=?").get(b.userId),
      ).toEqual({ n: 1 });
      expect(keys[0] === keys[1]).toBe(true);
      if (!releaseOldBeforeRetry) {
        releaseOld();
        await old;
      }
    } finally {
      releaseOld();
      if (sitekey === undefined) delete process.env.PUBLIC_TURNSTILE_SITE_KEY;
      else process.env.PUBLIC_TURNSTILE_SITE_KEY = sitekey;
      globalThis.fetch = originalFetch;
      if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
      else delete (globalThis as any).window;
      if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
      else delete (globalThis as any).document;
      f.db.close();
    }
  });
}
