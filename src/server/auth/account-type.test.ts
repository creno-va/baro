import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { createTestDatabase } from "../../../tests/helpers/d1";
import { seedTestSession } from "../../../tests/helpers/session";
import type { ApiEnvironment } from "../api/errors";
import { meApi } from "../api/me";
import { readAccountType, saveAccountType } from "./account-type";

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
async function fixture() {
  const db = await createTestDatabase();
  databases.push(db);
  const owner = await seedTestSession(db, { consent: true });
  const app = new Hono<ApiEnvironment>().route("/api/me", meApi);
  return { db, owner, app };
}
test("account type persists without granting or replacing verified/moderator roles", async () => {
  const { db, owner } = await fixture();
  db.sqlite
    .query("INSERT INTO v2_role_bindings(owner_id,role,granted_at) VALUES(?,'moderator',?)")
    .run(owner.userId, new Date().toISOString());
  db.sqlite
    .query("INSERT INTO v2_role_bindings(owner_id,role,granted_at) VALUES(?,'verified_lawyer',?)")
    .run(owner.userId, new Date().toISOString());
  expect(await readAccountType(db.binding, owner.userId)).toBe("lawyer");
  await saveAccountType(db.binding, owner.userId, "customer");
  expect(await readAccountType(db.binding, owner.userId)).toBe("customer");
  await saveAccountType(db.binding, owner.userId, "lawyer");
  expect(await readAccountType(db.binding, owner.userId)).toBe("lawyer");
  expect(
    db.sqlite
      .query("SELECT role FROM v2_role_bindings WHERE owner_id=? ORDER BY role")
      .all(owner.userId),
  ).toEqual([{ role: "moderator" }, { role: "verified_lawyer" }]);
});
test("account type requires signed owner session and configured origin; rejects elevated and forged input", async () => {
  const { db, owner, app } = await fixture();
  const put = (body: unknown, origin = owner.env.BETTER_AUTH_URL, cookie = owner.cookie) =>
    app.request(
      "/api/me/account-type",
      {
        method: "PUT",
        headers: { origin, cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      owner.env,
    );
  expect((await put({ accountType: "lawyer" }, owner.env.BETTER_AUTH_URL, "")).status).toBe(401);
  expect((await put({ accountType: "lawyer" }, "https://foreign.test")).status).toBe(403);
  expect((await put({ accountType: "moderator" })).status).toBe(400);
  expect((await put({ accountType: "lawyer", ownerId: "foreign" })).status).toBe(400);
  expect((await put({ accountType: "lawyer" })).status).toBe(200);
  const view = await app.request(
    "/api/me/session",
    { headers: { cookie: owner.cookie } },
    owner.env,
  );
  expect(await view.json()).toMatchObject({
    user: { id: owner.userId, accountType: "lawyer" },
    needsConsent: false,
  });
  expect(db.sqlite.query("SELECT count(*) n FROM v2_role_bindings").get()).toEqual({ n: 0 });
  expect(
    (await (await app.request("/api/me/session", undefined, owner.env)).json()) as unknown,
  ).toEqual({
    user: null,
    needsConsent: false,
  });
});
