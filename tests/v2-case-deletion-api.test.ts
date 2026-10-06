import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import type { ApiEnvironment } from "../src/server/api/errors";
import { workspaceDeleteApi } from "../src/server/api/v2/delete";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2WorkspaceRepository } from "../src/server/db/v2-workspace";
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
  const peer = await seedTestSession(db, { consent: true });
  const cipher = await createCaseDataCipher({
    CASE_DATA_KEY_V1: btoa("d".repeat(32)).replace(/=+$/, ""),
  });
  const workspace = createV2WorkspaceRepository(db.binding, cipher);
  const id = crypto.randomUUID();
  const created = await workspace.create(
    { ownerId: owner.userId, now: new Date().toISOString() },
    id,
    {
      narrative: "삭제 API를 검증하는 합성 사건입니다.",
      subjectContext: "individual",
      jurisdiction: "KR",
      turnstileToken: "synthetic",
    },
    { operationId: crypto.randomUUID(), key: crypto.randomUUID(), requestHash: "a".repeat(64) },
  );
  expect(created.kind).toBe("created");
  const app = new Hono<ApiEnvironment>()
    .onError((_error, c) => c.json({ error: { code: "UNAVAILABLE" } }, 503))
    .use("*", async (c, next) => {
      c.set("requestId", "synthetic-delete-request");
      await next();
    })
    .route("/api/v2/cases", workspaceDeleteApi);
  const key = crypto.randomUUID();
  function remove(
    options: {
      cookie?: string;
      origin?: string;
      body?: string;
      key?: string;
      query?: string;
      production?: boolean;
    } = {},
  ) {
    const headers = new Headers({
      cookie: options.cookie ?? owner.cookie,
      origin: options.origin ?? owner.env.BETTER_AUTH_URL,
    });
    headers.set("idempotency-key", options.key ?? key);
    return app.request(
      `${owner.env.BETTER_AUTH_URL}/api/v2/cases/${id}${options.query ?? ""}`,
      { method: "DELETE", headers, ...(options.body !== undefined ? { body: options.body } : {}) },
      {
        ...owner.env,
        ...(options.production ? { APP_ENV: "production", PUBLIC_BETA_ENABLED: "false" } : {}),
      },
    );
  }
  return { db, owner, peer, id, key, remove, workspace };
}
test("real v2 owner deletion atomically removes the workspace and records cleanup/tombstone; duplicate key replays accepted", async () => {
  const f = await fixture();
  f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.owner.userId);
  expect((await f.remove()).status).toBe(202);
  expect((await f.remove()).status).toBe(202);
  expect(f.db.sqlite.query("SELECT id FROM v2_workspaces WHERE id=?").get(f.id)).toBeNull();
  expect(
    f.db.sqlite
      .query(
        "SELECT target_kind,target_id,state FROM v2_deletion_journals WHERE target_kind='workspace' AND target_id=?",
      )
      .get(f.id),
  ).toMatchObject({ target_kind: "workspace", target_id: f.id, state: "pending" });
  expect(
    f.db.sqlite
      .query("SELECT target_kind FROM v2_tombstones WHERE target_kind='workspace' AND target_id=?")
      .get(f.id),
  ).toEqual({ target_kind: "workspace" });
  expect(
    f.db.sqlite
      .query("SELECT count(*) AS n FROM idempotency_records WHERE user_id=? AND route=?")
      .get(f.owner.userId, `/api/v2/cases/${f.id}`),
  ).toEqual({ n: 1 });
  expect((await f.remove({ key: crypto.randomUUID() })).status).toBe(404);
});
test("other owner, anonymous and foreign Origin cannot delete or learn private workspace state", async () => {
  const f = await fixture();
  expect((await f.remove({ cookie: f.peer.cookie })).status).toBe(404);
  expect((await f.remove({ cookie: "" })).status).toBe(401);
  expect((await f.remove({ origin: "https://invalid.example" })).status).toBe(403);
  expect(f.db.sqlite.query("SELECT id FROM v2_workspaces WHERE id=?").get(f.id)).toEqual({
    id: f.id,
  });
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_deletion_journals").get()).toEqual({
    n: 0,
  });
});
test("invalid mutation key, body/query and closed production preserve the case", async () => {
  const f = await fixture();
  expect((await f.remove({ key: "invalid" })).status).toBe(400);
  expect((await f.remove({ body: "{}" })).status).toBe(400);
  expect((await f.remove({ query: "?force=true" })).status).toBe(400);
  expect((await f.remove({ production: true })).status).toBe(503);
  expect(f.db.sqlite.query("SELECT id FROM v2_workspaces WHERE id=?").get(f.id)).toEqual({
    id: f.id,
  });
});
test("delete SQL transaction failure rolls back the receipt and keeps the original workspace retryable", async () => {
  const f = await fixture();
  f.db.sqlite.exec(
    "CREATE TRIGGER synthetic_delete_failure BEFORE DELETE ON v2_workspaces BEGIN SELECT RAISE(ABORT,'SYNTHETIC_FAILURE'); END",
  );
  expect((await f.remove()).status).toBe(503);
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM idempotency_records").get()).toEqual({
    n: 0,
  });
  expect(f.db.sqlite.query("SELECT id FROM v2_workspaces WHERE id=?").get(f.id)).toEqual({
    id: f.id,
  });
  f.db.sqlite.exec("DROP TRIGGER synthetic_delete_failure");
  expect((await f.remove()).status).toBe(202);
});
test("late creation with a deleted workspace id cannot resurrect the case", async () => {
  const f = await fixture();
  expect((await f.remove()).status).toBe(202);
  const result = await f.workspace.create(
    { ownerId: f.owner.userId, now: new Date().toISOString() },
    f.id,
    {
      narrative: "삭제 이후 늦게 도착한 합성 생성 작업입니다.",
      subjectContext: "individual",
      jurisdiction: "KR",
      turnstileToken: "synthetic",
    },
    { operationId: crypto.randomUUID(), key: crypto.randomUUID(), requestHash: "b".repeat(64) },
  );
  expect(result.kind).not.toBe("created");
  expect(f.db.sqlite.query("SELECT id FROM v2_workspaces WHERE id=?").get(f.id)).toBeNull();
});
