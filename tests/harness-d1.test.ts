import { expect, test } from "bun:test";
import { api } from "../src/server/api";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

test("real migration database batch preserves order/bindings and rolls back every statement on SQL failure", async () => {
  const db = await createTestDatabase();
  const other = await createTestDatabase();
  try {
    db.sqlite.exec("CREATE TABLE harness_batch (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const insert = db.binding.prepare(
      "INSERT INTO harness_batch(id,value) VALUES(?,?) RETURNING id,value",
    );
    const results = await db.binding.batch([
      insert.bind("a", "first"),
      insert.bind("b", "second"),
      db.binding.prepare("SELECT value FROM harness_batch WHERE id=?").bind("a"),
    ]);
    expect(results[0]?.results).toEqual([{ id: "a", value: "first" }]);
    expect(results[1]?.meta.changes).toBe(1);
    expect(results[2]?.results).toEqual([{ value: "first" }]);
    await expect(
      db.binding.batch([insert.bind("c", "rollback"), insert.bind("a", "duplicate")]),
    ).rejects.toThrow();
    expect(await db.binding.prepare("SELECT * FROM harness_batch WHERE id='c'").first()).toBeNull();
    await expect(
      db.binding.batch([insert.bind("d", "rollback"), other.binding.prepare("SELECT 1")]),
    ).rejects.toThrow("another test database");
    expect(await db.binding.prepare("SELECT * FROM harness_batch WHERE id='d'").first()).toBeNull();
    await expect(
      db.binding
        .prepare(
          "INSERT INTO session(id,user_id,token,expires_at,created_at,updated_at) VALUES('bad','missing','bad',1,1,1)",
        )
        .run(),
    ).rejects.toThrow();
  } finally {
    db.close();
    other.close();
  }
});

test("test-only signed session seed uses actual SQL sessions and isolates two owners", async () => {
  const db = await createTestDatabase();
  try {
    const first = await seedTestSession(db, { consent: true });
    const second = await seedTestSession(db);
    expect(first.userId).not.toBe(second.userId);
    expect(
      db.sqlite.query("SELECT oauth_authenticated_at FROM session WHERE id=?").get(first.sessionId),
    ).toEqual({ oauth_authenticated_at: null });
    const recent = await seedTestSession(db, { oauthAuthenticatedAt: 1234 });
    expect(
      db.sqlite
        .query("SELECT oauth_authenticated_at FROM session WHERE id=?")
        .get(recent.sessionId),
    ).toEqual({ oauth_authenticated_at: 1234 });
    expect(first.browserCookie.name).toBe("better-auth.session_token");
    expect(first.browserCookie.httpOnly).toBe(true);
    const request = (session: typeof first, cookie = session.cookie) =>
      api.request("/me/consent", { headers: { cookie } }, session.env);
    expect(((await (await request(first)).json()) as { needsConsent: boolean }).needsConsent).toBe(
      false,
    );
    expect(((await (await request(second)).json()) as { needsConsent: boolean }).needsConsent).toBe(
      true,
    );
    expect((await request(first, `${first.cookie}tampered`)).status).toBe(401);
    db.sqlite.query("UPDATE session SET expires_at=1 WHERE id=?").run(first.sessionId);
    expect((await request(first)).status).toBe(401);
    expect((await request(second)).status).toBe(200);
    db.sqlite.query("DELETE FROM user WHERE id=?").run(second.userId);
    expect((await request(second)).status).toBe(401);
    expect(
      db.sqlite.query("SELECT * FROM session WHERE user_id=?").all(second.userId),
    ).toHaveLength(0);
    const production = { ...first.env, APP_ENV: "production", PUBLIC_BETA_ENABLED: "false" } as Env;
    expect(
      (await api.request("/me/consent", { headers: { cookie: first.cookie } }, production)).status,
    ).toBe(503);
  } finally {
    db.close();
  }
});
