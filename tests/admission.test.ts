import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { createCaseApi } from "../src/server/api/case-create";
import type { ApiEnvironment } from "../src/server/api/errors";
import { reconcileDispatch } from "../src/server/modules/dispatch/service";
import { admitCase, verifyTurnstile } from "../src/server/modules/intake/service";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});
async function fixture(consent = true) {
  const database = await createTestDatabase();
  databases.push(database);
  const owner = await seedTestSession(database, { consent });
  const env = {
    ...owner.env,
    CASE_DATA_KEY_V1: btoa("x".repeat(32)).replace(/=+$/, ""),
    CASE_IP_LIMIT: { limit: async () => ({ success: true }) },
    CASE_ACCOUNT_LIMIT: { limit: async () => ({ success: true }) },
  } as unknown as Env;
  return { database, owner, env };
}
const input = {
  narrative: "합성 입력입니다. 개인 간 금전 대여 상황을 정리합니다.",
  turnstileToken: "synthetic-challenge",
};
const NOW = "2026-10-05T14:59:59.000Z";
test("Turnstile validates exact hostname/action, fails closed and never stores rejected input", async () => {
  const f = await fixture();
  f.env.TURNSTILE_SECRET_KEY = "synthetic-secret";
  for (const data of [
    { success: true, hostname: "localhost", action: "case_create" },
    { success: false, hostname: "localhost", action: "case_create" },
    { success: true, hostname: "localhost.attacker.test", action: "case_create" },
    { success: true, hostname: "localhost", action: "other" },
  ]) {
    const transport = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeDefined();
      return Response.json(data);
    }) as unknown as typeof fetch;
    expect(await verifyTurnstile(f.env, "synthetic", transport)).toBe(
      data.success && data.hostname === "localhost" && data.action === "case_create",
    );
  }
  expect(
    await verifyTurnstile(f.env, "synthetic", (async () => {
      throw new Error("synthetic timeout");
    }) as unknown as typeof fetch),
  ).toBe(false);
  expect(
    (await admitCase(f.env, f.owner.userId, crypto.randomUUID(), input, NOW, async () => false))
      .kind,
  ).toBe("challenge");
  expect(f.database.sqlite.query("SELECT count(*) AS n FROM cases").get()).toEqual({ n: 0 });
});
test("SQL admission 10/11 concurrent, KST midnight, replay and hash conflict", async () => {
  const f = await fixture();
  let calls = 0;
  const verify = async () => {
    calls++;
    return true;
  };
  const key = crypto.randomUUID();
  const winner = await admitCase(f.env, f.owner.userId, key, input, NOW, verify);
  expect(winner.kind).toBe("created");
  expect(
    await admitCase(
      f.env,
      f.owner.userId,
      key,
      { ...input, turnstileToken: "another" },
      NOW,
      verify,
    ),
  ).toEqual(winner);
  expect(calls).toBe(1);
  expect(
    (
      await admitCase(
        f.env,
        f.owner.userId,
        key,
        { ...input, narrative: "다른 합성 입력입니다. 개인 간 대여 상황입니다." },
        NOW,
        verify,
      )
    ).kind,
  ).toBe("conflict");
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      admitCase(f.env, f.owner.userId, crypto.randomUUID(), input, NOW, verify),
    ),
  );
  expect(results.filter((r) => r.kind === "created")).toHaveLength(9);
  expect(results.filter((r) => r.kind === "quota")).toHaveLength(1);
  for (const table of ["cases", "analyses", "dispatch_outbox", "idempotency_records"])
    expect(f.database.sqlite.query(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 10 });
  expect(
    (
      await admitCase(
        f.env,
        f.owner.userId,
        crypto.randomUUID(),
        input,
        "2026-10-05T15:00:00.000Z",
        verify,
      )
    ).kind,
  ).toBe("created");
});
test("concurrent same key has one winner; failed commit rolls back all dependent writes", async () => {
  const f = await fixture();
  const key = crypto.randomUUID();
  const responses = await Promise.all(
    Array.from({ length: 5 }, () =>
      admitCase(f.env, f.owner.userId, key, input, NOW, async () => true),
    ),
  );
  expect(responses.every((r) => JSON.stringify(r) === JSON.stringify(responses[0]))).toBe(true);
  f.database.sqlite.exec(
    "CREATE TRIGGER injected BEFORE INSERT ON dispatch_outbox BEGIN SELECT RAISE(ABORT, 'synthetic'); END",
  );
  await expect(
    admitCase(f.env, f.owner.userId, crypto.randomUUID(), input, NOW, async () => true),
  ).rejects.toThrow("DB_OPERATION_FAILED");
  expect(f.database.sqlite.query("SELECT count(*) AS n FROM cases").get()).toEqual({ n: 1 });
  expect(f.database.sqlite.query("SELECT analysis_count FROM daily_usage").get()).toEqual({
    analysis_count: 1,
  });
});
test("route auth/consent/origin/strict input and abuse gates precede admission", async () => {
  const f = await fixture(false);
  let called = 0;
  const app = new Hono<ApiEnvironment>()
    .use("*", async (c, next) => {
      c.set("requestId", "synthetic");
      await next();
    })
    .route(
      "/api/cases",
      createCaseApi(async () => {
        called++;
        return true;
      }),
    );
  const headers = {
    origin: f.env.BETTER_AUTH_URL,
    cookie: f.owner.cookie,
    "content-type": "application/json",
    "idempotency-key": crypto.randomUUID(),
    "cf-connecting-ip": "192.0.2.1",
  };
  expect(
    (
      await app.request(
        "/api/cases",
        { method: "POST", headers, body: JSON.stringify(input) },
        f.env,
      )
    ).status,
  ).toBe(403);
  expect(called).toBe(0);
  expect(f.database.sqlite.query("SELECT count(*) AS n FROM cases").get()).toEqual({ n: 0 });
  const g = await fixture();
  expect(
    (
      await app.request(
        "/api/cases",
        {
          method: "POST",
          headers: { ...headers, cookie: g.owner.cookie },
          body: JSON.stringify({ ...input, userId: "attacker" }),
        },
        g.env,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await app.request(
        "/api/cases",
        {
          method: "POST",
          headers: { ...headers, cookie: g.owner.cookie },
          body: JSON.stringify(input),
        },
        { ...g.env, CASE_ACCOUNT_LIMIT: { limit: async () => ({ success: false }) } } as Env,
      )
    ).status,
  ).toBe(429);
  expect(called).toBe(0);
});
test("commit/dispatch crash reconciliation reuses instance and converges within 24h", async () => {
  const f = await fixture();
  await admitCase(f.env, f.owner.userId, crypto.randomUUID(), input, NOW, async () => true);
  let creates = 0;
  const instances = new Set<string>();
  f.env.ANALYSIS_WORKFLOW = {
    create: async (options: { id: string }) => {
      creates++;
      if (instances.has(options.id)) throw new Error("synthetic exists");
      instances.add(options.id);
      throw new Error("synthetic post-dispatch crash");
    },
    get: async (id: string) => ({
      status: async () => {
        if (!instances.has(id)) throw new Error("synthetic absent");
        return { status: "queued" };
      },
    }),
  } as unknown as Env["ANALYSIS_WORKFLOW"];
  await Promise.all([reconcileDispatch(f.env, NOW), reconcileDispatch(f.env, NOW)]);
  expect(creates).toBe(1);
  expect(f.database.sqlite.query("SELECT state FROM dispatch_outbox").get()).toEqual({
    state: "dispatched",
  });
  await admitCase(f.env, f.owner.userId, crypto.randomUUID(), input, NOW, async () => true);
  f.env.ANALYSIS_WORKFLOW = {
    create: async () => {
      throw new Error("synthetic unavailable");
    },
    get: async () => {
      throw new Error("synthetic absent");
    },
  } as unknown as Env["ANALYSIS_WORKFLOW"];
  await reconcileDispatch(f.env, NOW);
  await reconcileDispatch(f.env, "2026-10-06T15:00:00.000Z");
  expect(
    f.database.sqlite.query("SELECT status,failure_code FROM analyses WHERE status='failed'").get(),
  ).toEqual({ status: "failed", failure_code: "DISPATCH_FAILED" });
});
