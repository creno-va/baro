import { expect, test } from "bun:test";
import { saveAccountType } from "../../src/server/auth/account-type";
import { deleteAccount } from "../../src/server/modules/deletion/service";
import { createTestDatabase } from "../helpers/d1";
import { seedTestSession } from "../helpers/session";

// No external OAuth request: SQL session and identifiers are wholly synthetic.
test("real account deletion also removes owner-scoped account-type metadata", async () => {
  const db = await createTestDatabase();
  try {
    const owner = await seedTestSession(db, { consent: true, oauthAuthenticatedAt: Date.now() });
    const peer = await seedTestSession(db, { consent: true, oauthAuthenticatedAt: Date.now() });
    await saveAccountType(db.binding, owner.userId, "lawyer");
    await saveAccountType(db.binding, peer.userId, "customer");
    expect(await deleteAccount(db.binding, owner.userId, owner.sessionId, Date.now())).toBe(true);
    expect(db.sqlite.query("SELECT id FROM user WHERE id=?").get(owner.userId)).toBeNull();
    expect(
      db.sqlite
        .query("SELECT value FROM app_metadata WHERE key=?")
        .get(`account-type:${owner.userId}`),
    ).toBeNull();
    expect(
      db.sqlite
        .query("SELECT value FROM app_metadata WHERE key=?")
        .get(`account-type:${peer.userId}`),
    ).toEqual({ value: "customer" });
  } finally {
    db.close();
  }
});

test("record currently unmounted real report, timeline-create and file-retry routes", async () => {
  const { api } = await import("../../src/server/api");
  const db = await createTestDatabase();
  try {
    const owner = await seedTestSession(db, { consent: true, oauthAuthenticatedAt: Date.now() });
    const id = crypto.randomUUID();
    const routes = [
      ["GET", `/v2/cases/${id}/reports`],
      ["PATCH", `/v2/cases/${id}/reports`],
      ["POST", `/v2/cases/${id}/reports`],
      ["GET", `/v2/reports/${id}/pdf`],
      ["POST", `/v2/reports/${id}/zip`],
      ["POST", `/v2/cases/${id}/timeline`],
      ["POST", `/v2/cases/${id}/files/${crypto.randomUUID()}/retry`],
    ] as const;
    for (const [method, path] of routes) {
      const response = await api.request(
        path,
        {
          method,
          headers: {
            cookie: owner.cookie,
            origin: owner.env.BETTER_AUTH_URL,
            "content-type": "application/json",
          },
          ...(method !== "GET" ? { body: "{}" } : {}),
        },
        owner.env,
      );
      expect(response.status, `${method} ${path} remains unmounted`).toBe(404);
    }
  } finally {
    db.close();
  }
});
