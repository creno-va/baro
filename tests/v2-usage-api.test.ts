import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { v2UsageSchema } from "../src/contracts/v2";
import { type ApiEnvironment, errorBody } from "../src/server/api/errors";
import { createUsageApi } from "../src/server/api/v2/usage";
import { createTestDatabase, testEnvironment } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});
const app = new Hono<ApiEnvironment>()
  .onError((_error, c) => c.json(errorBody(c, "INTERNAL_ERROR", "요청을 처리하지 못했어요."), 500))
  .use("*", async (c, next) => {
    c.set("requestId", "synthetic-request");
    c.header("x-request-id", "synthetic-request");
    await next();
  })
  .route(
    "/v2/me",
    createUsageApi({ environment: "preview", clock: () => "2026-10-05T15:00:00.000Z" }),
  );
test("actual SQL session/current consent protect own-only usage and all responses are no-store", async () => {
  const database = await createTestDatabase();
  databases.push(database);
  const owner = await seedTestSession(database, { consent: true });
  const before = await app.request("/v2/me/usage", undefined, owner.env);
  expect(before.status).toBe(401);
  expect(before.headers.get("cache-control")).toBe("no-store");
  const result = await app.request(
    "/v2/me/usage",
    { headers: { cookie: owner.cookie } },
    owner.env,
  );
  expect(result.status).toBe(200);
  expect(result.headers.get("cache-control")).toBe("no-store");
  const usage = v2UsageSchema.parse(await result.json());
  expect(usage.day).toBe("2026-10-06");
  expect(usage.newCases.limit).toBe(3);
  expect(usage.waitReasons).toEqual(["monthly_budget"]);
  database.sqlite
    .query("UPDATE user_consents SET privacy_version='old' WHERE user_id=?")
    .run(owner.userId);
  expect(
    (await app.request("/v2/me/usage", { headers: { cookie: owner.cookie } }, owner.env)).status,
  ).toBe(403);
});
test("client cannot supply owner/role/clock/prices/funding or obtain provider budget detail", async () => {
  const database = await createTestDatabase();
  databases.push(database);
  const owner = await seedTestSession(database, { consent: true });
  for (const key of ["ownerId", "role", "now", "quoteVersion", "price", "funding", "caseId"]) {
    const response = await app.request(
      `/v2/me/usage?${key}=attacker`,
      { headers: { cookie: owner.cookie } },
      owner.env,
    );
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("attacker");
  }
  const body = await (
    await app.request("/v2/me/usage", { headers: { cookie: owner.cookie } }, owner.env)
  ).text();
  for (const privateField of ["provider", "pricing", "settledKrw", "allocatedLimit", owner.userId])
    expect(body).not.toContain(privateField);
  expect(
    (
      await app.request(
        "/v2/me/usage",
        { method: "POST", headers: { cookie: owner.cookie } },
        owner.env,
      )
    ).status,
  ).toBe(404);
});
test("closed production fails before auth/database and account tombstone/expired session fail safely", async () => {
  const response = await app.request("/v2/me/usage", undefined, {
    APP_ENV: "production",
    PUBLIC_BETA_ENABLED: "false",
  } as Env);
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const database = await createTestDatabase();
  databases.push(database);
  const owner = await seedTestSession(database, { consent: true });
  database.sqlite
    .query("INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES('account',?,?)")
    .run(owner.userId, new Date().toISOString());
  expect(
    (await app.request("/v2/me/usage", { headers: { cookie: owner.cookie } }, owner.env)).status,
  ).toBe(401);
  database.sqlite.query("UPDATE session SET expires_at=1").run();
  expect(
    (await app.request("/v2/me/usage", { headers: { cookie: owner.cookie } }, owner.env)).status,
  ).toBe(401);
  expect(
    (await app.request("/v2/me/usage", undefined, testEnvironment(database.binding))).status,
  ).toBe(401);
});
