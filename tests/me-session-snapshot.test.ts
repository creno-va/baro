import { afterEach, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/d1";
import { api } from "../src/server/api";
import { readAccountType, saveAccountType } from "../src/server/auth/account-type";
import { SESSION_EXPIRES_SECONDS, SESSION_UPDATE_SECONDS } from "../src/server/auth/policy";
import * as schema from "../src/server/db/schema";
import { hasCurrentConsent } from "../src/server/modules/consent/service";
import { createTestDatabase } from "./helpers/d1";
import { countD1Calls } from "./helpers/d1-call-count";
import { seedTestSession } from "./helpers/session";

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
async function sessionBody(response: Response) {
  return (await response.json()) as {
    user: { id: string; name: string; accountType: string } | null;
    needsConsent: boolean;
  };
}
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});
async function fixture() {
  const db = await createTestDatabase();
  databases.push(db);
  const owner = await seedTestSession(db, { consent: true });
  await saveAccountType(db.binding, owner.userId, "customer");
  const meter = countD1Calls(db.binding);
  const request = () =>
    api.request(
      "/me/session",
      { headers: { cookie: owner.cookie } },
      {
        ...owner.env,
        DB: meter.binding,
      },
    );
  expect((await request()).ok).toBe(true);
  meter.reset();
  return { db, owner, meter, request };
}

test("session keeps Better Auth verification and reads owner flags in one batch", async () => {
  const f = await fixture();
  const response = await f.request();
  expect(await sessionBody(response)).toEqual({
    user: { id: f.owner.userId, name: "Synthetic test owner", accountType: "customer" },
    needsConsent: false,
  });
  expect(f.meter.work).toEqual({ calls: 3, statements: 5 });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

for (const [preference, role] of [
  ["customer", "verified_lawyer"],
  ["lawyer", null],
  [null, "lawyer_applicant"],
  ["invalid", "verified_lawyer"],
  [null, "moderator"],
  ["invalid", null],
] as const)
  test(`session preserves ${preference ?? "missing"} preference with ${role ?? "no"} role`, async () => {
    const f = await fixture();
    if (preference === null)
      f.db.sqlite
        .query("DELETE FROM app_metadata WHERE key=?")
        .run(`account-type:${f.owner.userId}`);
    else
      f.db.sqlite
        .query("UPDATE app_metadata SET value=? WHERE key=?")
        .run(preference, `account-type:${f.owner.userId}`);
    if (role)
      f.db.sqlite
        .query("INSERT INTO v2_role_bindings(owner_id,role,granted_at) VALUES(?,?,?)")
        .run(f.owner.userId, role, new Date().toISOString());
    const expected = await readAccountType(f.db.binding, f.owner.userId);
    const response = await f.request();
    expect((await sessionBody(response)).user?.accountType).toBe(expected);
    expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_role_bindings").get()).toEqual({
      n: role ? 1 : 0,
    });
  });

for (const change of ["terms", "privacy", "ai_notice", "missing", "over14"] as const)
  test(`session requires current consent after ${change} changes before its batch`, async () => {
    const f = await fixture();
    let changed = false;
    f.meter.before((statements) => {
      if (changed || statements.length !== 3) return;
      changed = true;
      if (change === "missing")
        f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.owner.userId);
      else if (change === "over14") {
        // Simulate a malformed legacy row in this isolated database only.
        f.db.sqlite.exec("PRAGMA ignore_check_constraints = ON");
        f.db.sqlite
          .query("UPDATE user_consents SET over_14_confirmed=0 WHERE user_id=?")
          .run(f.owner.userId);
        f.db.sqlite.exec("PRAGMA ignore_check_constraints = OFF");
      } else
        f.db.sqlite
          .query(`UPDATE user_consents SET ${change}_version='stale' WHERE user_id=?`)
          .run(f.owner.userId);
    });
    const response = await f.request();
    expect(changed).toBe(true);
    expect((await sessionBody(response)).needsConsent).toBe(true);
    expect(await hasCurrentConsent(drizzle(f.db.binding, { schema }), f.owner.userId)).toBe(false);
  });

for (const change of ["deleted", "role"] as const)
  test(`session observes ${change} after Better Auth and before the owner snapshot`, async () => {
    const f = await fixture();
    let changed = false;
    f.meter.before((statements) => {
      if (changed || statements.length !== 3) return;
      changed = true;
      if (change === "deleted")
        f.db.sqlite
          .query(
            "INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES('account',?,?)",
          )
          .run(f.owner.userId, new Date().toISOString());
      else
        f.db.sqlite
          .query("UPDATE app_metadata SET value='lawyer' WHERE key=?")
          .run(`account-type:${f.owner.userId}`);
    });
    const body = await sessionBody(await f.request());
    expect(changed).toBe(true);
    if (change === "deleted") expect(body).toEqual({ user: null, needsConsent: false });
    else expect(body.user?.accountType).toBe("lawyer");
  });

test("session snapshot never borrows another owner's consent, role or tombstone", async () => {
  const f = await fixture();
  const foreign = await seedTestSession(f.db, { consent: true });
  await saveAccountType(f.db.binding, foreign.userId, "lawyer");
  f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.owner.userId);
  f.db.sqlite
    .query("INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES('account',?,?)")
    .run(foreign.userId, new Date().toISOString());
  expect(await sessionBody(await f.request())).toEqual({
    user: { id: f.owner.userId, name: "Synthetic test owner", accountType: "customer" },
    needsConsent: true,
  });
});

test("session still forwards sliding and expired cookies without refreshing OAuth freshness", async () => {
  const f = await fixture();
  const now = Date.now();
  const oauthTimestamp = now - 3_600_000;
  f.db.sqlite
    .query("UPDATE session SET updated_at=?,expires_at=?,oauth_authenticated_at=? WHERE id=?")
    .run(
      now - SESSION_UPDATE_SECONDS * 1_000 - 1,
      now + (SESSION_EXPIRES_SECONDS - SESSION_UPDATE_SECONDS) * 1_000 - 1,
      oauthTimestamp,
      f.owner.sessionId,
    );
  const response = await f.request();
  expect(response.status).toBe(200);
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith("better-auth.session_token="));
  expect(cookie).toContain(`Max-Age=${SESSION_EXPIRES_SECONDS}`);
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Lax");
  const row = f.db.sqlite
    .query("SELECT updated_at,expires_at,oauth_authenticated_at FROM session WHERE id=?")
    .get(f.owner.sessionId) as {
    updated_at: number;
    expires_at: number;
    oauth_authenticated_at: number;
  };
  expect(row.updated_at).toBeGreaterThanOrEqual(now);
  expect(row.expires_at).toBeGreaterThanOrEqual(now + SESSION_EXPIRES_SECONDS * 1_000);
  expect(row.oauth_authenticated_at).toBe(oauthTimestamp);
  f.db.sqlite.query("UPDATE session SET expires_at=1 WHERE id=?").run(f.owner.sessionId);
  const expired = await f.request();
  expect(await sessionBody(expired)).toEqual({ user: null, needsConsent: false });
  expect(
    expired.headers.getSetCookie().find((value) => value.startsWith("better-auth.session_token=")),
  ).toContain("Max-Age=0");
});
