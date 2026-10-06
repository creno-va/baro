import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { v2UsageSchema } from "../src/contracts/v2";
import { api } from "../src/server/api";
import type { ApiEnvironment } from "../src/server/api/errors";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});
const workerApi = new Hono<ApiEnvironment>().route("/api", api);

test("Worker router exposes own usage with signed SQL session and preserves v1 consent", async () => {
  const database = await createTestDatabase();
  databases.push(database);
  const owner = await seedTestSession(database, { consent: true });
  const headers = { cookie: owner.cookie, "x-request-id": "synthetic-router-usage" };
  const response = await workerApi.request("/api/v2/me/usage", { headers }, owner.env);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-request-id")).toBe("synthetic-router-usage");
  const usage = v2UsageSchema.parse(await response.json());
  expect(usage.newCases.limit).toBe(3);
  expect(usage.aiResponses.limit).toBe(30);
  expect(usage.mediaSeconds.limit).toBe(3600);
  expect(usage.waitReasons).toContain("monthly_budget");
  expect((await workerApi.request("/api/me/consent", { headers }, owner.env)).status).toBe(200);

  const unauthenticated = await workerApi.request("/api/v2/me/usage", undefined, owner.env);
  expect(unauthenticated.status).toBe(401);
  expect(unauthenticated.headers.get("cache-control")).toBe("private, no-store");
  const forged = await workerApi.request("/api/v2/me/usage?ownerId=other", { headers }, owner.env);
  expect(forged.status).toBe(400);
  expect(forged.headers.get("cache-control")).toBe("private, no-store");
});

test("Worker production gate blocks usage before bindings and keeps private responses uncached", async () => {
  const response = await workerApi.request("/api/v2/me/usage", undefined, {
    APP_ENV: "production",
    PUBLIC_BETA_ENABLED: "false",
  } as Env);
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toMatchObject({ error: { code: "BETA_NOT_OPEN" } });
});
