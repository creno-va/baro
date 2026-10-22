import { expect, test } from "bun:test";
import { createCasesClient, createJsonRequester, type OperationRequest } from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";
import { Hono } from "hono";
import { resolveMobileConfig } from "../apps/mobile/config/environment";
import { createChallengeModel } from "../apps/mobile/src/platform/challenge/model";
import type { ApiEnvironment } from "../src/server/api/errors";
import { meApi } from "../src/server/api/me";
import { createWorkspacesApi } from "../src/server/api/v2/workspaces";
import { verifyTurnstile } from "../src/server/modules/intake/service";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const fakeFetch = (handler: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>) =>
  Object.assign(handler, { preconnect: fetch.preconnect });

test("native proof reaches actual case admission once; replay precedes provider verification and a new key cannot reuse proof", async () => {
  const db = await createTestDatabase();
  try {
    const owner = await seedTestSession(db, { consent: true });
    const env: Env = {
      ...owner.env,
      CASE_DATA_KEY_V1: btoa("a".repeat(32)).replace(/=+$/, ""),
      TURNSTILE_SECRET_KEY: "synthetic-secret",
      CASE_IP_LIMIT: { limit: async () => ({ success: true }) },
      CASE_ACCOUNT_LIMIT: { limit: async () => ({ success: true }) },
    };
    let verified = 0,
      createdBody: unknown,
      createdKey = "";
    const used = new Set<string>();
    const app = new Hono<ApiEnvironment>().route("/api/me", meApi).route(
      "/api/v2/cases",
      createWorkspacesApi({
        turnstile: (binding, token) =>
          verifyTurnstile(
            binding,
            token,
            fakeFetch(async (url, init) => {
              verified++;
              expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
              const body = init?.body as URLSearchParams;
              expect(body.get("secret")).toBe("synthetic-secret");
              expect(body.get("response")).toBe(token);
              const success = token === "synthetic-widget-token" && !used.has(token);
              used.add(token);
              return Response.json({
                success,
                hostname: new URL(env.BETTER_AUTH_URL).hostname,
                action: "case_create",
              });
            }),
          ),
      }),
    );
    const scope = createSessionScope(),
      secret = "s".repeat(43);
    const challenge = createChallengeModel({
      config: resolveMobileConfig({ environment: "local", apiBaseUrl: env.BETTER_AUTH_URL }),
      scope,
      newId: () => crypto.randomUUID(),
      newSecret: async () => secret,
    });
    const request = createJsonRequester({
      scope,
      newKey: () => crypto.randomUUID(),
      transport: async (path, init) => {
        const headers = new Headers(init.headers);
        headers.set("cookie", owner.cookie);
        headers.set("origin", env.BETTER_AUTH_URL);
        headers.set("cf-connecting-ip", "192.0.2.1");
        if (init.method === "POST") {
          createdBody = JSON.parse(String(init.body));
          createdKey = headers.get("idempotency-key") ?? "";
        }
        return app.request(path, { ...init, headers }, env);
      },
    });
    const operation: OperationRequest = (_action, _input, options = {}) =>
      request({ ...options, path: options.path ?? "/invalid" });
    const records = new Map<string, string>();
    const cases = createCasesClient({
      scope,
      request: operation,
      mode: "real",
      persistence: "required",
      newKey: () => crypto.randomUUID(),
      fingerprint: async (value) =>
        Buffer.from(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
        ).toString("hex"),
      storage: {
        getItem: (key) => records.get(key) ?? null,
        setItem: (key, value) => {
          records.set(key, value);
        },
        removeItem: (key) => {
          records.delete(key);
        },
      },
      challenge: challenge.request,
    });
    let opened!: () => void;
    const ready = new Promise<void>((done) => {
      opened = done;
    });
    const unsubscribe = challenge.subscribe(() => {
      if (challenge.getSnapshot().kind === "active") opened();
    });
    const narrative = "임대차 자료와 대화 날짜를 정리해 상담을 준비하려는 합성 사건입니다.";
    const pending = cases.create({ narrative, subjectContext: "individual" });
    await ready;
    expect(verified).toBe(0);
    expect(createdBody).toBeUndefined();
    expect(JSON.stringify([...records])).not.toContain(narrative);
    const state = challenge.getSnapshot();
    if (state.kind !== "active") throw new Error("SYNTHETIC_CHALLENGE_NOT_ACTIVE");
    challenge.load(state.attemptId, state.uri);
    challenge.message(
      state.attemptId,
      state.uri,
      JSON.stringify({
        type: "token",
        attemptId: state.attemptId,
        secret,
        token: "synthetic-widget-token",
      }),
    );
    const result = await pending;
    unsubscribe();
    expect(result.id).toBeTruthy();
    expect(verified).toBe(1);
    expect(records.size).toBe(0);
    const send = (key: string) =>
      app.request(
        "/api/v2/cases",
        {
          method: "POST",
          headers: {
            cookie: owner.cookie,
            origin: env.BETTER_AUTH_URL,
            "content-type": "application/json",
            "idempotency-key": key,
            "cf-connecting-ip": "192.0.2.1",
          },
          body: JSON.stringify(createdBody),
        },
        env,
      );
    expect((await send(createdKey)).status).toBe(201);
    expect(verified).toBe(1);
    expect((await send(crypto.randomUUID())).status).toBe(403);
    expect(verified).toBe(2);
    expect(db.sqlite.query("SELECT count(*) n FROM v2_workspaces").get()).toEqual({ n: 1 });
  } finally {
    db.close();
  }
});

test("well-formed native messages cannot replace server hostname/action/expiry/provider validation", async () => {
  const env = {
    TURNSTILE_SECRET_KEY: "synthetic",
    BETTER_AUTH_URL: "https://preview.baro.site",
  } as Env;
  for (const body of [
    { success: false, hostname: "preview.baro.site", action: "case_create" },
    { success: true, hostname: "foreign.invalid", action: "case_create" },
    { success: true, hostname: "preview.baro.site", action: "other" },
    { success: true },
  ])
    expect(
      await verifyTurnstile(
        env,
        "synthetic",
        fakeFetch(async () => Response.json(body)),
      ),
    ).toBe(false);
  expect(
    await verifyTurnstile(
      env,
      "synthetic",
      fakeFetch(async () => {
        throw new Error("SYNTHETIC_PROVIDER_OUTAGE");
      }),
    ),
  ).toBe(false);
  expect(
    await verifyTurnstile(
      env,
      "synthetic",
      fakeFetch(async () =>
        Response.json(
          { success: true, hostname: "preview.baro.site", action: "case_create" },
          { status: 503 },
        ),
      ),
    ),
  ).toBe(false);
});
