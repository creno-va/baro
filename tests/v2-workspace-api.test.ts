import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import type { ApiEnvironment } from "../src/server/api/errors";
import { createWorkspacesApi } from "../src/server/api/v2/workspaces";
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
