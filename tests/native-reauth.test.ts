import { expect, test } from "bun:test";
import { cleanupAuthData } from "../src/server/auth/cleanup";
import { nativeAuthChallenge } from "../src/server/auth/native-codes";
import {
  createNativeReauthentication,
  NATIVE_REAUTH_TTL_MS,
} from "../src/server/auth/native-reauth";
import { deleteAccount, replayDeletionJournal } from "../src/server/modules/deletion/service";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const verifier = "a".repeat(43);
async function fixture() {
  const db = await createTestDatabase();
  let now = Date.parse("2026-10-23T00:00:00Z");
  const owner = await seedTestSession(db, { now: now - 60000, expiresAt: now + 3600000 });
  const newSessionId = crypto.randomUUID();
  db.sqlite
    .query(
      "INSERT INTO account(id,account_id,provider_id,user_id,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    )
    .run(crypto.randomUUID(), "synthetic-provider-id", "google", owner.userId, now, now);
  db.sqlite
    .query(
      "INSERT INTO session(id,user_id,token,expires_at,created_at,updated_at,oauth_authenticated_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(newSessionId, owner.userId, `synthetic-new-${newSessionId}`, now + 3600000, now, now, now);
  const actor = { userId: owner.userId, sessionId: owner.sessionId },
    oauth = { userId: owner.userId, sessionId: newSessionId };
  const store = createNativeReauthentication({
    db: db.binding,
    issuer: owner.env.BETTER_AUTH_URL,
    secret: owner.env.BETTER_AUTH_SECRET,
    now: () => now,
  });
  const input = {
    attemptId: crypto.randomUUID(),
    challenge: await nativeAuthChallenge(verifier),
    provider: "google" as const,
  };
  return {
    db,
    owner,
    actor,
    oauth,
    store,
    input,
    now: () => now,
    advance(value: number) {
      now += value;
    },
  };
}
test("preparation requires a real linked native session but not old OAuth freshness; only the exact fresh new session can prove completion", async () => {
  const f = await fixture();
  try {
    const prepared = await f.store.prepare(f.input, f.actor);
    await expect(
      f.store.verify({ attemptId: f.input.attemptId, verifier }, f.actor),
    ).rejects.toThrow();
    await expect(f.store.authorize(f.input, "naver", f.oauth)).rejects.toThrow();
    await f.store.authorize(f.input, "google", f.oauth);
    await expect(
      f.store.verify({ attemptId: f.input.attemptId, verifier: "b".repeat(43) }, f.oauth),
    ).rejects.toThrow();
    expect(await f.store.verify({ attemptId: f.input.attemptId, verifier }, f.oauth)).toEqual(
      prepared,
    );
    await expect(
      f.store.verify({ attemptId: f.input.attemptId, verifier }, f.actor),
    ).rejects.toThrow();
    const text = JSON.stringify(
      f.db.sqlite.query("SELECT value FROM app_metadata WHERE key LIKE 'native-reauth:v1:%'").all(),
    );
    expect(text.includes(f.input.challenge)).toBe(false);
    expect(text.includes(verifier)).toBe(false);
  } finally {
    f.db.close();
  }
});
test("a new preparation retires only its original session's prior attempt, and duplicate authorization has one winner", async () => {
  const f = await fixture();
  try {
    await f.store.prepare(f.input, f.actor);
    const next = { ...f.input, attemptId: crypto.randomUUID() };
    await f.store.prepare(next, f.actor);
    await expect(f.store.authorize(f.input, "google", f.oauth)).rejects.toThrow();
    const results = await Promise.allSettled([
      f.store.authorize(next, "google", f.oauth),
      f.store.authorize(next, "google", f.oauth),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    await expect(f.store.prepare(next, f.actor)).rejects.toThrow();
    expect(await f.store.verify({ attemptId: next.attemptId, verifier }, f.oauth)).toEqual({
      startedAt: f.now(),
    });
  } finally {
    f.db.close();
  }
});
for (const change of [
  "revoked-original",
  "revoked-new",
  "expired",
  "rollback",
  "tampered",
  "deleted-owner",
] as const)
  test(`stale or corrupted preparation cannot authorize/prove a reauthentication: ${change}`, async () => {
    const f = await fixture();
    try {
      await f.store.prepare(f.input, f.actor);
      if (change === "revoked-original")
        f.db.sqlite.query("DELETE FROM session WHERE id=?").run(f.actor.sessionId);
      if (change === "revoked-new")
        f.db.sqlite.query("DELETE FROM session WHERE id=?").run(f.oauth.sessionId);
      if (change === "expired") f.advance(NATIVE_REAUTH_TTL_MS);
      if (change === "rollback") f.advance(-1);
      if (change === "deleted-owner")
        f.db.sqlite.query("DELETE FROM user WHERE id=?").run(f.owner.userId);
      if (change === "tampered")
        f.db.sqlite
          .query(
            "UPDATE app_metadata SET value=json_set(value,'$.userId','forged-owner') WHERE key LIKE 'native-reauth:v1:%'",
          )
          .run();
      await expect(f.store.authorize(f.input, "google", f.oauth)).rejects.toThrow();
      await expect(
        f.store.verify({ attemptId: f.input.attemptId, verifier }, f.oauth),
      ).rejects.toThrow();
    } finally {
      f.db.close();
    }
  });
test("accepted account deletion and restore replay remove its reauthentication metadata; expiry cleanup preserves unrelated records", async () => {
  const f = await fixture();
  try {
    await f.store.prepare(f.input, f.actor);
    await f.store.authorize(f.input, "google", f.oauth);
    const row = f.db.sqlite
      .query("SELECT key,value,updated_at FROM app_metadata WHERE key LIKE 'native-reauth:v1:%'")
      .get() as { key: string; value: string; updated_at: string };
    const peer = await seedTestSession(f.db, { now: f.now() });
    f.db.sqlite
      .query(
        "INSERT INTO account(id,account_id,provider_id,user_id,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      )
      .run(crypto.randomUUID(), "synthetic-peer", "google", peer.userId, f.now(), f.now());
    await f.store.prepare(
      { ...f.input, attemptId: crypto.randomUUID() },
      { userId: peer.userId, sessionId: peer.sessionId },
    );
    f.db.sqlite
      .query(
        "INSERT INTO app_metadata(key,value,updated_at) VALUES('synthetic-unrelated','keep',?)",
      )
      .run(new Date(f.now()).toISOString());
    expect(await deleteAccount(f.db.binding, f.owner.userId, f.oauth.sessionId, f.now())).toBe(
      true,
    );
    expect(
      f.db.sqlite
        .query("SELECT count(*) n FROM app_metadata WHERE key LIKE 'native-reauth:v1:%'")
        .get(),
    ).toEqual({ n: 1 });
    f.db.sqlite
      .query("INSERT INTO app_metadata(key,value,updated_at) VALUES(?,?,?)")
      .run(row.key, row.value, row.updated_at);
    const journal = f.db.sqlite
      .query("SELECT id FROM deletion_jobs WHERE target_type='account'")
      .get() as { id: string };
    await replayDeletionJournal(f.db.binding, [
      {
        id: journal.id,
        target_type: "account",
        target_id: f.owner.userId,
        deleted_at: new Date(f.now()).toISOString(),
        workflow_instance_ids: [],
        expires_at: new Date(f.now() + 86400000).toISOString(),
      },
    ]);
    expect(
      f.db.sqlite
        .query("SELECT count(*) n FROM app_metadata WHERE key LIKE 'native-reauth:v1:%'")
        .get(),
    ).toEqual({ n: 1 });
    f.db.sqlite
      .query("INSERT INTO app_metadata(key,value,updated_at) VALUES(?,?,?)")
      .run(row.key, row.value, row.updated_at);
    f.advance(NATIVE_REAUTH_TTL_MS);
    await cleanupAuthData(f.db.binding, f.now());
    expect(
      f.db.sqlite
        .query("SELECT count(*) n FROM app_metadata WHERE key LIKE 'native-reauth:v1:%'")
        .get(),
    ).toEqual({ n: 0 });
    expect(
      f.db.sqlite.query("SELECT value FROM app_metadata WHERE key='synthetic-unrelated'").get(),
    ).toEqual({ value: "keep" });
  } finally {
    f.db.close();
  }
});
