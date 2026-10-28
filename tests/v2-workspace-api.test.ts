import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import type { ApiEnvironment } from "../src/server/api/errors";
import { createWorkspacesApi } from "../src/server/api/v2/workspaces";
import { saveAccountType } from "../src/server/auth/account-type";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
async function fixture() {
  const db = await createTestDatabase();
  databases.push(db);
  const owner = await seedTestSession(db, { consent: true });
  const env: Env = {
    ...owner.env,
    CASE_DATA_KEY_V1: btoa("a".repeat(32)).replace(/=+$/, ""),
    CASE_IP_LIMIT: { limit: async () => ({ success: true }) },
    CASE_ACCOUNT_LIMIT: { limit: async () => ({ success: true }) },
    ANALYSIS_ACCOUNT_LIMIT: { limit: async () => ({ success: true }) },
  };
  let verified = 0;
  const app = new Hono<ApiEnvironment>()
    .use("*", async (c, next) => {
      c.set("requestId", "synthetic-workspace-request");
      await next();
    })
    .route("/api/v2/cases", createWorkspacesApi({ turnstile: async () => ++verified === 1 }));
  const input = {
    narrative: "임대차 계약 자료에서 날짜와 연락 내역을 정리하고 상담을 준비합니다.",
    subjectContext: "individual",
    jurisdiction: "KR",
    turnstileToken: "synthetic",
  };
  const headers = {
    cookie: owner.cookie,
    origin: env.BETTER_AUTH_URL,
    "content-type": "application/json",
    "cf-connecting-ip": "192.0.2.1",
  };
  return { db, owner, env, app, input, headers, verified: () => verified };
}
test("a short narrative survives real HTTP, encryption, persisted intake and idempotent replay", async () => {
  const f = await fixture();
  const key = crypto.randomUUID();
  const create = () =>
    f.app.request(
      "/api/v2/cases",
      {
        method: "POST",
        headers: { ...f.headers, "idempotency-key": key },
        body: JSON.stringify({ ...f.input, narrative: "폭행을 당했어요." }),
      },
      f.env,
    );
  const first = await create();
  expect(first.status).toBe(201);
  const value = (await first.json()) as { id: string };
  expect((await create()).status).toBe(201);
  expect(f.verified()).toBe(1);
  const intake = await f.app.request(
    `/api/v2/cases/${value.id}/intake`,
    { headers: { cookie: f.owner.cookie } },
    f.env,
  );
  expect(intake.status).toBe(200);
  expect(await intake.json()).toMatchObject({ narrative: "폭행을 당했어요." });
  expect(f.db.sqlite.query("SELECT count(*) AS count FROM v2_workspaces").get()).toEqual({
    count: 1,
  });
});

test("HTTP creation retries replay before reusing Turnstile; unavailable AI preserves the saved case", async () => {
  const f = await fixture(),
    key = crypto.randomUUID();
  const create = () =>
    f.app.request(
      "/api/v2/cases",
      {
        method: "POST",
        headers: { ...f.headers, "idempotency-key": key },
        body: JSON.stringify(f.input),
      },
      f.env,
    );
  const first = await create();
  expect(first.status).toBe(201);
  const workspace = (await first.json()) as { id: string; workspaceRevision: number };
  expect((await create()).status).toBe(201);
  expect(f.verified()).toBe(1);
  const response = await f.app.request(
    `/api/v2/cases/${workspace.id}/intake/advance`,
    {
      method: "POST",
      headers: { ...f.headers, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ expectedRevision: workspace.workspaceRevision }),
    },
    f.env,
  );
  expect(response.status).toBe(503);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
    "BUDGET_UNAVAILABLE",
  );
  const saved = await f.app.request(
    `/api/v2/cases/${workspace.id}/intake`,
    { headers: { cookie: f.owner.cookie } },
    f.env,
  );
  expect(saved.status).toBe(200);
  expect(((await saved.json()) as { narrative: string }).narrative).toBe(f.input.narrative);
  expect(saved.headers.get("cache-control")).toBe("private, no-store");
});
test("private workspace routes reject unauthenticated owners and foreign origins before creation", async () => {
  const f = await fixture();
  expect((await f.app.request("/api/v2/cases", undefined, f.env)).status).toBe(401);
  expect(
    (
      await f.app.request(
        "/api/v2/cases",
        {
          method: "POST",
          headers: {
            ...f.headers,
            origin: "https://foreign.test",
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify(f.input),
        },
        f.env,
      )
    ).status,
  ).toBe(403);
  expect(f.verified()).toBe(0);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_workspaces").get()).toEqual({ n: 0 });
});

for (const savedPreference of [true, false]) {
  test(`workspace reads resolve the role once and observe later changes (saved preference: ${savedPreference})`, async () => {
    const f = await fixture();
    if (savedPreference) await saveAccountType(f.db.binding, f.owner.userId, "customer");
    const prepare = f.db.binding.prepare.bind(f.db.binding);
    let roleQueries = 0;
    f.db.binding.prepare = (sql) => {
      if (
        sql === "SELECT value FROM app_metadata WHERE key=?" ||
        sql.startsWith("SELECT role FROM v2_role_bindings")
      )
        roleQueries++;
      return prepare(sql);
    };
    const read = () => f.app.request("/api/v2/cases", { headers: f.headers }, f.env);
    const allowed = await read();
    expect(allowed.status).toBe(200);
    expect(roleQueries).toBe(savedPreference ? 1 : 2);
    expect(allowed.headers.get("cache-control")).toBe("private, no-store");

    await saveAccountType(f.db.binding, f.owner.userId, "lawyer");
    const denied = await read();
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: { code: "ROLE_REQUIRED" } });
    expect(roleQueries).toBe(savedPreference ? 2 : 3);
  });
}

for (const change of ["role", "consent"] as const)
  test(`a ${change} change before the shared access snapshot blocks workspace creation`, async () => {
    const f = await fixture();
    await saveAccountType(f.db.binding, f.owner.userId, "customer");
    const prepare = f.db.binding.prepare.bind(f.db.binding);
    let changed = false;
    f.db.binding.prepare = (sql) => {
      if (!changed && sql.includes("AS current_consent")) {
        changed = true;
        if (change === "role")
          f.db.sqlite
            .query("UPDATE app_metadata SET value='lawyer' WHERE key=?")
            .run(`account-type:${f.owner.userId}`);
        else f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.owner.userId);
      }
      return prepare(sql);
    };
    const response = await f.app.request(
      "/api/v2/cases",
      {
        method: "POST",
        headers: { ...f.headers, "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify(f.input),
      },
      f.env,
    );
    expect(changed).toBe(true);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: change === "role" ? "ROLE_REQUIRED" : "CONSENT_REQUIRED" },
    });
    expect(f.verified()).toBe(0);
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_workspaces").get()).toEqual({ n: 0 });
  });
