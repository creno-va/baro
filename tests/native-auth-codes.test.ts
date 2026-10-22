import { afterEach, expect, test } from "bun:test";
import { cleanupAuthData } from "../src/server/auth/cleanup";
import {
  createNativeAuthCodeStore,
  NATIVE_AUTH_CODE_TTL_MS,
  nativeAuthChallenge,
} from "../src/server/auth/native-codes";
import { AUTH_RETENTION_MS } from "../src/server/auth/policy";
import { deleteAccount, replayDeletionJournal } from "../src/server/modules/deletion/service";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
const verifier = "a".repeat(43);
async function fixture(recent = true) {
  const db = await createTestDatabase();
  databases.push(db);
  let time = Date.parse("2026-10-22T00:00:00.000Z");
  const session = await seedTestSession(db, {
    now: time,
    ...(recent ? { oauthAuthenticatedAt: time } : {}),
  });
  const issuer = session.env.BETTER_AUTH_URL;
  const store = createNativeAuthCodeStore({
    db: db.binding,
    issuer,
    secret: session.env.BETTER_AUTH_SECRET,
    now: () => time,
  });
  const attemptId = crypto.randomUUID();
  const input = {
    attemptId,
    challenge: await nativeAuthChallenge(verifier),
    sessionId: session.sessionId,
    userId: session.userId,
    cookie: session.cookie,
  };
  return {
    db,
    session,
    issuer,
    store,
    input,
    now: () => time,
    advance: (amount: number) => {
      time += amount;
    },
  };
}

test("a fresh real SQL OAuth session issues an encrypted single-use grant bound to its PKCE verifier", async () => {
  const f = await fixture();
  const issued = await f.store.issue(f.input);
  const rows = f.db.sqlite
    .query("SELECT key,value FROM app_metadata WHERE key LIKE 'native-auth:v1:%'")
    .all();
  expect(rows).toHaveLength(1);
  expect(JSON.stringify(rows)).not.toContain(f.session.cookie);
  expect(JSON.stringify(rows)).not.toContain(issued.code);
  expect(JSON.stringify(rows)).not.toContain(verifier);
  const input = { ...issued, verifier };
  expect(await f.store.exchange(input)).toBe(f.session.cookie);
  await expect(f.store.exchange(input)).rejects.toMatchObject({ name: "NativeAuthProofError" });
});

test("wrong verifier or attempt cannot burn or redeem the valid grant", async () => {
  const f = await fixture();
  const issued = await f.store.issue(f.input);
  await expect(f.store.exchange({ ...issued, verifier: "b".repeat(43) })).rejects.toMatchObject({
    name: "NativeAuthProofError",
  });
  await expect(
    f.store.exchange({ ...issued, verifier, attemptId: crypto.randomUUID() }),
  ).rejects.toMatchObject({ name: "NativeAuthProofError" });
  expect(await f.store.exchange({ ...issued, verifier })).toBe(f.session.cookie);
});

test("a code expires at exactly one minute and a future grant cannot be accepted after clock rollback", async () => {
  const f = await fixture();
  const issued = await f.store.issue(f.input);
  f.advance(-1);
  await expect(f.store.exchange({ ...issued, verifier })).rejects.toMatchObject({
    name: "NativeAuthProofError",
  });
  f.advance(NATIVE_AUTH_CODE_TTL_MS + 1);
  await expect(f.store.exchange({ ...issued, verifier })).rejects.toMatchObject({
    name: "NativeAuthProofError",
  });
});

for (const change of ["revoked", "expired", "retention", "deleted-account"] as const)
  test(`the exact bound session is rechecked before exchange: ${change}`, async () => {
    const f = await fixture();
    const issued = await f.store.issue(f.input);
    if (change === "revoked")
      f.db.sqlite.query("DELETE FROM session WHERE id=?").run(f.session.sessionId);
    if (change === "expired")
      f.db.sqlite
        .query("UPDATE session SET expires_at=? WHERE id=?")
        .run(f.now(), f.session.sessionId);
    if (change === "retention")
      f.db.sqlite
        .query("UPDATE session SET created_at=? WHERE id=?")
        .run(f.now() - AUTH_RETENTION_MS - 1, f.session.sessionId);
    if (change === "deleted-account")
      f.db.sqlite.query("DELETE FROM user WHERE id=?").run(f.session.userId);
    await expect(f.store.exchange({ ...issued, verifier })).rejects.toMatchObject({
      name: "NativeAuthProofError",
    });
  });

test("concurrent valid exchanges have exactly one winner", async () => {
  const f = await fixture();
  const issued = await f.store.issue(f.input);
  const results = await Promise.allSettled([
    f.store.exchange({ ...issued, verifier }),
    f.store.exchange({ ...issued, verifier }),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
});

test("issuer, secret and encrypted metadata tampering cannot recover a cookie", async () => {
  const f = await fixture();
  const issued = await f.store.issue(f.input);
  const foreign = createNativeAuthCodeStore({
    db: f.db.binding,
    issuer: "https://foreign.example.test",
    secret: f.session.env.BETTER_AUTH_SECRET,
    now: f.now,
  });
  await expect(foreign.exchange({ ...issued, verifier })).rejects.toMatchObject({
    name: "NativeAuthProofError",
  });
  const otherKey = createNativeAuthCodeStore({
    db: f.db.binding,
    issuer: f.issuer,
    secret: "z".repeat(32),
    now: f.now,
  });
  await expect(otherKey.exchange({ ...issued, verifier })).rejects.toMatchObject({
    name: "NativeAuthProofError",
  });
  const row = f.db.sqlite
    .query("SELECT key,value FROM app_metadata WHERE key LIKE 'native-auth:v1:%'")
    .get() as { key: string; value: string };
  const changed = JSON.parse(row.value);
  changed.expiresAt--;
  f.db.sqlite
    .query("UPDATE app_metadata SET value=? WHERE key=?")
    .run(JSON.stringify(changed), row.key);
  await expect(f.store.exchange({ ...issued, verifier })).rejects.toMatchObject({
    name: "NativeAuthProofError",
  });
  f.db.sqlite.query("UPDATE app_metadata SET value=? WHERE key=?").run(row.value, row.key);
  expect(await f.store.exchange({ ...issued, verifier })).toBe(f.session.cookie);
});

test("only completed server OAuth can issue and expiry cleanup preserves other metadata", async () => {
  const old = await fixture(false);
  await expect(old.store.issue(old.input)).rejects.toMatchObject({ name: "NativeAuthProofError" });
  const f = await fixture();
  f.db.sqlite
    .query("INSERT INTO app_metadata(key,value) VALUES(?,?)")
    .run("synthetic-domain-record", "preserve-exactly");
  await f.store.issue(f.input);
  f.advance(NATIVE_AUTH_CODE_TTL_MS);
  await f.store.issue({ ...f.input, attemptId: crypto.randomUUID() });
  expect(
    f.db.sqlite.query("SELECT value FROM app_metadata WHERE key=?").get("synthetic-domain-record"),
  ).toEqual({ value: "preserve-exactly" });
  expect(
    f.db.sqlite
      .query("SELECT count(*) n FROM app_metadata WHERE key LIKE 'native-auth:v1:%'")
      .get(),
  ).toEqual({ n: 1 });
});

test("accepted account deletion removes only the owner's bridge grants atomically", async () => {
  const f = await fixture();
  const peer = await seedTestSession(f.db, { now: f.now(), oauthAuthenticatedAt: f.now() });
  await f.store.issue(f.input);
  await f.store.issue({
    ...f.input,
    sessionId: peer.sessionId,
    userId: peer.userId,
    cookie: peer.cookie,
    attemptId: crypto.randomUUID(),
  });
  expect(await deleteAccount(f.db.binding, f.session.userId, f.session.sessionId, f.now())).toBe(
    true,
  );
  const rows = f.db.sqlite
    .query(
      "SELECT json_extract(value,'$.userId') owner FROM app_metadata WHERE key LIKE 'native-auth:v1:%'",
    )
    .all();
  expect(rows).toEqual([{ owner: peer.userId }]);
});

test("restore journal replay removes grant metadata even after the restored user is gone", async () => {
  const f = await fixture();
  await f.store.issue(f.input);
  f.db.sqlite.query("DELETE FROM user WHERE id=?").run(f.session.userId);
  await replayDeletionJournal(f.db.binding, [
    {
      id: crypto.randomUUID(),
      target_type: "account",
      target_id: f.session.userId,
      deleted_at: new Date(f.now()).toISOString(),
      workflow_instance_ids: [],
      expires_at: new Date(f.now() + 86400000).toISOString(),
    },
  ]);
  expect(
    f.db.sqlite
      .query("SELECT count(*) n FROM app_metadata WHERE key LIKE 'native-auth:v1:%'")
      .get(),
  ).toEqual({ n: 0 });
});

test("scheduled auth cleanup removes expired/malformed grants and preserves other records", async () => {
  const f = await fixture();
  await f.store.issue(f.input);
  f.db.sqlite
    .query("INSERT INTO app_metadata(key,value) VALUES(?,?)")
    .run("native-auth:v1:synthetic-malformed", "invalid-json");
  f.db.sqlite
    .query("INSERT INTO app_metadata(key,value) VALUES(?,?)")
    .run("other-module:synthetic", "preserve-exactly");
  f.advance(NATIVE_AUTH_CODE_TTL_MS);
  await cleanupAuthData(f.db.binding, f.now());
  expect(
    f.db.sqlite
      .query("SELECT count(*) n FROM app_metadata WHERE key LIKE 'native-auth:v1:%'")
      .get(),
  ).toEqual({ n: 0 });
  expect(
    f.db.sqlite.query("SELECT value FROM app_metadata WHERE key=?").get("other-module:synthetic"),
  ).toEqual({ value: "preserve-exactly" });
});

test("expiry is rechecked after asynchronous proof verification before consuming the grant", async () => {
  const f = await fixture();
  let reads = 0;
  const store = createNativeAuthCodeStore({
    db: f.db.binding,
    issuer: f.issuer,
    secret: f.session.env.BETTER_AUTH_SECRET,
    now: () => f.now() + (++reads >= 3 ? NATIVE_AUTH_CODE_TTL_MS : 0),
  });
  const issued = await store.issue(f.input);
  await expect(store.exchange({ ...issued, verifier })).rejects.toMatchObject({
    name: "NativeAuthProofError",
  });
  expect(
    f.db.sqlite
      .query("SELECT count(*) n FROM app_metadata WHERE key LIKE 'native-auth:v1:%'")
      .get(),
  ).toEqual({ n: 1 });
});
