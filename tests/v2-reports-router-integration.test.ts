import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { api } from "../src/server/api";
import type { ApiEnvironment } from "../src/server/api/errors";
import { reportHttpFixture } from "./helpers/report-http-fixture";
import { seedTestSession } from "./helpers/session";

const databases: Awaited<ReturnType<typeof reportHttpFixture>>["db"][] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});
const workerApi = new Hono<ApiEnvironment>().route("/api", api);

// SQLite supplies real rows/crypto/signed sessions; only the D1 billing metadata
// shape is synthetic. This is no remote scan or pricing/funding receipt.
function withSyntheticBillingMetadata(binding: D1Database): D1Database {
  const originals = new WeakMap<object, D1PreparedStatement>();
  const receipt = <T>(result: D1Result<T>): D1Result<T> => ({
    ...result,
    meta: {
      ...result.meta,
      rows_read: result.results.length,
      rows_written: result.meta.changes,
    },
  });
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const value = {
      bind: (...values: unknown[]) => wrap(statement.bind(...values)),
      all: async <T>() => receipt(await statement.all<T>()),
      run: async <T>() => receipt(await statement.run<T>()),
      first: <T>(column?: string) => statement.first<T>(column),
      raw: <T>(options?: { columnNames?: boolean }) => statement.raw<T>(options),
    } as D1PreparedStatement;
    originals.set(value, statement);
    return value;
  };
  return {
    prepare: (sql: string) => wrap(binding.prepare(sql)),
    batch: async <T>(statements: D1PreparedStatement[]) =>
      (await binding.batch<T>(statements.map((s) => originals.get(s) ?? s))).map(receipt),
  } as D1Database;
}

test("global report router uses native composition with signed owner SQL and fails closed without billing metadata", async () => {
  const f = await reportHttpFixture();
  databases.push(f.db);
  const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
  const paths = [`/api/v2/cases/${f.workspaceId}/reports`, `/api/v2/reports/${report.id}/pdf`];
  for (const path of paths) {
    const response = await workerApi.request(path, undefined, f.env);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  }
  const originalCalls = { ...f.bucket.calls };
  const headers = { cookie: f.cookie, "x-request-id": "synthetic-report-router" };
  const missing = await workerApi.request(paths[0] as string, { headers }, f.env);
  expect(missing.status).toBe(503);
  expect(await missing.json()).toMatchObject({ error: { code: "STORAGE_UNAVAILABLE" } });
  const env = { ...f.env, DB: withSyntheticBillingMetadata(f.env.DB) };
  const own = await workerApi.request(paths[0] as string, { headers }, env);
  expect(own.status).toBe(200);
  expect(own.headers.get("cache-control")).toBe("private, no-store");
  expect(own.headers.get("x-request-id")).toBe("synthetic-report-router");
  expect(await own.json()).toMatchObject({ id: report.id, caseId: f.workspaceId });
  const other = await seedTestSession(f.db, { consent: true });
  const denied = await workerApi.request(
    paths[0] as string,
    { headers: { cookie: other.cookie } },
    env,
  );
  expect(denied.status).toBe(404);
  const csrf = await workerApi.request(
    paths[0] as string,
    {
      method: "PATCH",
      headers: {
        ...headers,
        origin: "https://untrusted.example",
        "content-type": "application/json",
      },
      body: "{",
    },
    env,
  );
  expect(csrf.status).toBe(403);
  f.db.sqlite
    .query("UPDATE app_metadata SET value='lawyer' WHERE key=?")
    .run(`account-type:${f.actor.ownerId}`);
  expect((await workerApi.request(paths[0] as string, { headers }, env)).status).toBe(403);
  expect(f.bucket.calls).toEqual(originalCalls);
  expect((await workerApi.request("/api/v2/lawyers", undefined, env)).status).toBe(200);
});

test("global production gate keeps every report route private and blocks before bindings", async () => {
  for (const [path, method] of [
    ["/api/v2/cases/synthetic-case/reports", "GET"],
    ["/api/v2/cases/synthetic-case/reports", "PATCH"],
    ["/api/v2/cases/synthetic-case/reports", "POST"],
    ["/api/v2/reports/synthetic-report/pdf", "GET"],
    ["/api/v2/reports/synthetic-report/zip", "POST"],
  ]) {
    const response = await workerApi.request(path as string, { method }, {
      APP_ENV: "production",
      PUBLIC_BETA_ENABLED: "false",
    } as Env);
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.json()).toMatchObject({ error: { code: "BETA_NOT_OPEN" } });
  }
});
