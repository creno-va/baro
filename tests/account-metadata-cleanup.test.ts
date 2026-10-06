import { expect, test } from "bun:test";
import { api } from "../src/server/api";
import { saveAccountType } from "../src/server/auth/account-type";
import {
  deleteAccount,
  deletionOwnerTag,
  replayDeletionJournal,
} from "../src/server/modules/deletion/service";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

test("signed peer session cannot accept another account's deletion confirmation", async () => {
  const db = await createTestDatabase();
  try {
    const owner = await seedTestSession(db, { consent: true, oauthAuthenticatedAt: Date.now() }),
      peer = await seedTestSession(db, { consent: true, oauthAuthenticatedAt: Date.now() });
    const response = await api.request(
      "/me",
      {
        method: "DELETE",
        headers: {
          cookie: peer.cookie,
          origin: peer.env.BETTER_AUTH_URL,
          "content-type": "application/json",
          "x-baro-deletion-owner": await deletionOwnerTag(
            owner.env.BETTER_AUTH_SECRET,
            owner.userId,
          ),
        },
        body: JSON.stringify({ confirmation: "DELETE" }),
      },
      peer.env,
    );
    expect(response.status).toBe(403);
    expect(db.sqlite.query("SELECT count(*) n FROM user").get()).toEqual({ n: 2 });
    expect(db.sqlite.query("SELECT count(*) n FROM deletion_jobs").get()).toEqual({ n: 0 });
  } finally {
    db.close();
  }
});

test("metadata cleanup rolls back with user deletion and never authorizes a stale OAuth", async () => {
  const db = await createTestDatabase();
  try {
    const now = Date.now();
    const owner = await seedTestSession(db, { consent: true, oauthAuthenticatedAt: now });
    await saveAccountType(db.binding, owner.userId, "lawyer");
    db.sqlite.exec(
      "CREATE TRIGGER synthetic_delete_failure BEFORE DELETE ON user BEGIN SELECT RAISE(ABORT, 'synthetic'); END",
    );
    await expect(deleteAccount(db.binding, owner.userId, owner.sessionId, now)).rejects.toThrow();
    expect(
      db.sqlite
        .query("SELECT value FROM app_metadata WHERE key=?")
        .get(`account-type:${owner.userId}`),
    ).toEqual({ value: "lawyer" });
    expect(db.sqlite.query("SELECT count(*) AS n FROM deletion_jobs").get()).toEqual({ n: 0 });
    db.sqlite.exec("DROP TRIGGER synthetic_delete_failure");
    db.sqlite.query("UPDATE session SET oauth_authenticated_at=0 WHERE id=?").run(owner.sessionId);
    expect(await deleteAccount(db.binding, owner.userId, owner.sessionId, now)).toBe(false);
    expect(
      db.sqlite
        .query("SELECT value FROM app_metadata WHERE key=?")
        .get(`account-type:${owner.userId}`),
    ).toEqual({ value: "lawyer" });
  } finally {
    db.close();
  }
});

test("restore replay removes owner metadata even when user is already absent, preserving peers and global metadata", async () => {
  const db = await createTestDatabase();
  try {
    const owner = await seedTestSession(db, { consent: true, oauthAuthenticatedAt: Date.now() });
    const peer = await seedTestSession(db, { consent: true, oauthAuthenticatedAt: Date.now() });
    await saveAccountType(db.binding, owner.userId, "lawyer");
    await saveAccountType(db.binding, peer.userId, "customer");
    const journal = [
      {
        id: crypto.randomUUID(),
        target_type: "account",
        target_id: owner.userId,
        deleted_at: new Date().toISOString(),
        workflow_instance_ids: [],
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      },
    ];
    await replayDeletionJournal(db.binding, journal);
    db.sqlite
      .query("INSERT INTO app_metadata(key,value) VALUES(?,?)")
      .run(`account-type:${owner.userId}`, "lawyer");
    await replayDeletionJournal(db.binding, journal);
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
    expect(db.sqlite.query("SELECT id FROM user WHERE id=?").get(peer.userId)).not.toBeNull();
  } finally {
    db.close();
  }
});
