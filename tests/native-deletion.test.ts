import { expect, test } from "bun:test";
import { cleanupAuthData } from "../src/server/auth/cleanup";
import { completeNativeAccountDeletion } from "../src/server/auth/native-account-deletion";
import { nativeAuthChallenge } from "../src/server/auth/native-codes";
import { createNativeDeletionActivityProof } from "../src/server/auth/native-deletion-activity";
import {
  createNativeDeletionReceipts,
  NATIVE_DELETION_RECEIPT_TTL_MS,
} from "../src/server/auth/native-deletion-receipt";
import { createNativeReauthentication } from "../src/server/auth/native-reauth";
import { deletionOwnerTag } from "../src/server/modules/deletion/service";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const verifier = "a".repeat(43);
async function fixture(
  provider: "google" | "apple" = "google",
  appleCount = provider === "apple" ? 1 : 0,
) {
  const db = await createTestDatabase();
  let time = Date.parse("2026-10-24T00:00:00Z");
  const owner = await seedTestSession(db, { now: time - 60000, expiresAt: time + 3600000 });
  const sessionId = crypto.randomUUID();
  db.sqlite
    .query(
      "INSERT INTO session(id,user_id,token,expires_at,created_at,updated_at,oauth_authenticated_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(sessionId, owner.userId, `synthetic-fresh-${sessionId}`, time + 3600000, time, time, time);
  const link = (kind: string, subject: string) =>
    db.sqlite
      .query(
        "INSERT INTO account(id,account_id,provider_id,user_id,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      )
      .run(crypto.randomUUID(), subject, kind, owner.userId, time, time);
  if (provider === "google") link("google", "synthetic-google-subject");
  for (let i = 0; i < appleCount; i++) link("apple", `synthetic-apple-${i}`);
  const options = {
    db: db.binding,
    issuer: owner.env.BETTER_AUTH_URL,
    secret: owner.env.BETTER_AUTH_SECRET,
    now: () => time,
  };
  const auth = createNativeReauthentication(options),
    receipts = createNativeDeletionReceipts(options);
  const input = {
    attemptId: crypto.randomUUID(),
    challenge: await nativeAuthChallenge(verifier),
    provider,
    confirmation: "DELETE" as const,
  };
  const start = {
    attemptId: input.attemptId,
    challenge: input.challenge,
    purpose: "delete-account" as const,
  };
  const proof = { attemptId: input.attemptId, verifier };
  const original = { userId: owner.userId, sessionId: owner.sessionId },
    fresh = { userId: owner.userId, sessionId };
  return {
    db,
    owner,
    auth,
    receipts,
    options,
    input,
    start,
    proof,
    original,
    fresh,
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
    link,
  };
}
function persist(
  f: Awaited<ReturnType<typeof fixture>>,
  handle: { metadata: { key: string; value: string } },
) {
  f.db.sqlite
    .query("INSERT INTO app_metadata(key,value,updated_at) VALUES(?,?,?)")
    .run(handle.metadata.key, handle.metadata.value, new Date(f.now()).toISOString());
}
function userExists(f: Awaited<ReturnType<typeof fixture>>) {
  return f.db.sqlite.query("SELECT id FROM user WHERE id=?").get(f.owner.userId) !== null;
}

test("deletion preparation binds literal confirmation and purpose; legacy normal records stay compatible", async () => {
  const f = await fixture();
  try {
    expect(() =>
      f.auth.prepareDeletion({ ...f.input, confirmation: "delete" }, f.original),
    ).toThrow();
    await f.auth.prepareDeletion(f.input, f.original);
    await expect(f.auth.authorize(f.start, "google", f.fresh)).rejects.toThrow();
    await expect(f.auth.verify(f.proof, f.fresh)).rejects.toThrow();
    await expect(f.auth.cancelDeletion({ ...f.proof, verifier: "b".repeat(43) })).rejects.toThrow();
    expect(await f.auth.cancelDeletion(f.proof)).toBe(true);
    await expect(f.auth.cancelDeletion(f.proof)).rejects.toThrow();
    const normal = {
      attemptId: crypto.randomUUID(),
      challenge: f.input.challenge,
      provider: "google",
    };
    await f.auth.prepare(normal, f.original);
    const row = f.db.sqlite
      .query("SELECT value FROM app_metadata WHERE key LIKE 'native-reauth:v1:%'")
      .get() as { value: string };
    expect(JSON.parse(row.value)).not.toHaveProperty("operation");
    await expect(f.auth.authorizeDeletion(normal, "google", f.fresh)).rejects.toThrow();
    expect(await f.auth.authorize(normal, "google", f.fresh)).toEqual({
      originalSessionId: f.original.sessionId,
    });
    expect(await f.auth.verify({ attemptId: normal.attemptId, verifier }, f.fresh)).toEqual({
      startedAt: f.now(),
    });
  } finally {
    f.db.close();
  }
});

test("receipt is tokenless, encrypted, verifier-bound, single-code-use with recoverable status and monotone completion", async () => {
  const f = await fixture();
  try {
    const handle = await f.receipts.prepareCommit({
      attemptId: f.input.attemptId,
      challenge: f.input.challenge,
      ownerTag: "c".repeat(64),
      appleLinked: true,
    });
    expect(await f.receipts.status(f.proof)).toBeNull();
    persist(f, handle);
    for (const value of [
      verifier,
      f.input.challenge,
      handle.code,
      handle.receiptId,
      "c".repeat(64),
      "unconfirmed",
      f.owner.userId,
    ])
      expect(handle.metadata.value).not.toContain(value);
    expect(await f.receipts.status(f.proof)).toMatchObject({
      status: "accepted",
      appleRevocation: "unconfirmed",
    });
    await expect(f.receipts.status({ ...f.proof, verifier: "b".repeat(43) })).rejects.toThrow();
    await expect(f.receipts.exchange({ ...f.proof, code: "b".repeat(43) })).rejects.toThrow();
    const [exchanged, finished] = await Promise.allSettled([
      f.receipts.exchange({ ...f.proof, code: handle.code }),
      f.receipts.finish(handle, "confirmed"),
    ]);
    expect(finished.status).toBe("fulfilled");
    if (exchanged.status === "rejected")
      await f.receipts.exchange({ ...f.proof, code: handle.code });
    await expect(f.receipts.exchange({ ...f.proof, code: handle.code })).rejects.toThrow();
    expect(await f.receipts.finish(handle, "unconfirmed")).toBe(true);
    expect(await f.receipts.status(f.proof)).toMatchObject({ appleRevocation: "confirmed" });
    expect(
      await f.receipts.finish({ ...handle, receiptId: crypto.randomUUID() }, "confirmed"),
    ).toBe(false);
    // Neither status nor completion creates authentication material.
    expect(
      f.db.sqlite
        .query("SELECT COUNT(*) n FROM app_metadata WHERE key LIKE 'native-auth:v1:%'")
        .get(),
    ).toEqual({ n: 0 });
  } finally {
    f.db.close();
  }
});

for (const alteration of [
  "secret",
  "issuer",
  "attempt",
  "ciphertext",
  "expiry",
  "rollback",
  "expired",
] as const)
  test(`completion proof rejects cryptographic scope or clock changes: ${alteration}`, async () => {
    const f = await fixture();
    try {
      const handle = await f.receipts.prepareCommit({
        attemptId: f.input.attemptId,
        challenge: f.input.challenge,
        ownerTag: "c".repeat(64),
        appleLinked: false,
      });
      persist(f, handle);
      let receipts = f.receipts,
        proof = f.proof;
      if (alteration === "secret")
        receipts = createNativeDeletionReceipts({
          ...f.options,
          secret: "different-issuer-secret-at-least-thirty-two-characters",
        });
      if (alteration === "issuer") {
        receipts = createNativeDeletionReceipts({
          ...f.options,
          issuer: "https://other.example.test",
        });
        const other = await receipts.prepareCommit({
          attemptId: f.input.attemptId,
          challenge: f.input.challenge,
          ownerTag: "c".repeat(64),
          appleLinked: false,
        });
        f.db.sqlite
          .query("INSERT INTO app_metadata(key,value,updated_at) VALUES(?,?,?)")
          .run(other.metadata.key, handle.metadata.value, new Date(f.now()).toISOString());
      }
      if (alteration === "attempt") {
        proof = { ...proof, attemptId: crypto.randomUUID() };
        const other = await receipts.prepareCommit({
          attemptId: proof.attemptId,
          challenge: f.input.challenge,
          ownerTag: "c".repeat(64),
          appleLinked: false,
        });
        f.db.sqlite
          .query("INSERT INTO app_metadata(key,value,updated_at) VALUES(?,?,?)")
          .run(other.metadata.key, handle.metadata.value, new Date(f.now()).toISOString());
      }
      if (alteration === "ciphertext" || alteration === "expiry") {
        const envelope = JSON.parse(handle.metadata.value);
        if (alteration === "ciphertext") {
          // Fixed letters can already match, or differ only in unused base64 padding bits.
          // Flip an authenticated byte so every fixture actually changes the ciphertext.
          const bytes = Buffer.from(envelope.ciphertext, "base64url");
          bytes[0] = (bytes[0] ?? 0) ^ 1;
          envelope.ciphertext = bytes.toString("base64url");
        } else envelope.expiresAt--;
        f.db.sqlite
          .query("UPDATE app_metadata SET value=? WHERE key=?")
          .run(JSON.stringify(envelope), handle.metadata.key);
      }
      if (alteration === "rollback") f.advance(-1);
      if (alteration === "expired") f.advance(NATIVE_DELETION_RECEIPT_TTL_MS);
      await expect(receipts.status(proof)).rejects.toThrow();
    } finally {
      f.db.close();
    }
  });

test("receipt cleanup expires only its namespace; not-linked cannot be upgraded and stale code cannot consume a replacement", async () => {
  const f = await fixture();
  try {
    const handle = await f.receipts.prepareCommit({
      attemptId: f.input.attemptId,
      challenge: f.input.challenge,
      ownerTag: "c".repeat(64),
      appleLinked: false,
    });
    persist(f, handle);
    expect(await f.receipts.finish(handle, "confirmed")).toBe(false);
    const next = await f.receipts.prepareCommit({
      attemptId: f.input.attemptId,
      challenge: f.input.challenge,
      ownerTag: "c".repeat(64),
      appleLinked: true,
    });
    f.db.sqlite
      .query("UPDATE app_metadata SET value=? WHERE key=?")
      .run(next.metadata.value, next.metadata.key);
    expect(await f.receipts.finish(handle, "confirmed")).toBe(false);
    await expect(f.receipts.exchange({ ...f.proof, code: handle.code })).rejects.toThrow();
    f.db.sqlite
      .query("INSERT INTO app_metadata(key,value,updated_at) VALUES('unrelated','keep',?)")
      .run(new Date(f.now()).toISOString());
    f.db.sqlite
      .query(
        "INSERT INTO app_metadata(key,value,updated_at) VALUES('native-deletion:v1:broken','{',?)",
      )
      .run(new Date(f.now()).toISOString());
    f.advance(NATIVE_DELETION_RECEIPT_TTL_MS);
    await cleanupAuthData(f.db.binding, f.now());
    expect(await f.receipts.status(f.proof)).toBeNull();
    expect(
      f.db.sqlite.query("SELECT key FROM app_metadata WHERE key<>'schema_version'").all(),
    ).toEqual([{ key: "unrelated" }]);
  } finally {
    f.db.close();
  }
});

for (const scenario of [
  "none",
  "confirmed",
  "provider-rejects",
  "provider-throws",
  "no-material",
  "wrong-subject",
  "multiple",
  "google-with-apple",
] as const)
  test(`deletion commits before revocation and records only truthful overall outcomes: ${scenario}`, async () => {
    const provider = scenario === "none" || scenario === "google-with-apple" ? "google" : "apple";
    const f = await fixture(provider, scenario === "none" ? 0 : scenario === "multiple" ? 2 : 1);
    try {
      await f.auth.prepareDeletion(f.input, f.original);
      let calls = 0;
      const callback = await completeNativeAccountDeletion(
        f.owner.env,
        f.start,
        provider,
        f.fresh,
        {
          now: f.now,
          material:
            scenario === "no-material"
              ? null
              : {
                  subject: scenario === "wrong-subject" ? "unlinked-apple" : "synthetic-apple-0",
                  refreshToken: "synthetic-request-local-refresh",
                },
          revoke: async () => {
            calls++;
            expect(userExists(f)).toBe(false);
            expect(
              f.db.sqlite
                .query("SELECT COUNT(*) n FROM session WHERE user_id=?")
                .get(f.owner.userId),
            ).toEqual({ n: 0 });
            expect(await f.receipts.status(f.proof)).toMatchObject({
              appleRevocation: "unconfirmed",
            });
            if (scenario === "provider-throws")
              throw new Error("synthetic-provider-private-body-never-retained");
            return scenario === "provider-rejects"
              ? { status: "unconfirmed", reason: "provider_error", httpStatus: 400 }
              : { status: "confirmed", reason: "revoked", httpStatus: 200 };
          },
        },
      );
      expect(userExists(f)).toBe(false);
      expect(calls).toBe(
        ["none", "no-material", "wrong-subject", "google-with-apple"].includes(scenario) ? 0 : 1,
      );
      const expected = {
        contractVersion: 2,
        status: "accepted",
        appleRevocation:
          scenario === "none"
            ? "not_linked"
            : scenario === "confirmed"
              ? "confirmed"
              : "unconfirmed",
      };
      expect(await f.receipts.status(f.proof)).toMatchObject(expected);
      expect(await f.receipts.exchange({ ...f.proof, code: callback.code })).toMatchObject(
        expected,
      );
      expect(await f.receipts.status(f.proof)).toMatchObject(expected);
      await expect(f.auth.cancelDeletion(f.proof)).rejects.toThrow();
      const metadata = JSON.stringify(f.db.sqlite.query("SELECT value FROM app_metadata").all());
      for (const forbidden of [
        "synthetic-request-local-refresh",
        "synthetic-provider-private-body",
        verifier,
        f.owner.userId,
      ])
        expect(metadata).not.toContain(forbidden);
      expect(
        f.db.sqlite.query("SELECT count(*) n FROM deletion_jobs WHERE target_type='account'").get(),
      ).toEqual({ n: 1 });
    } finally {
      f.db.close();
    }
  });

for (const change of [
  "cancelled",
  "original-revoked",
  "fresh-revoked",
  "expired",
  "wrong-owner",
  "wrong-provider",
  "normal-purpose",
] as const)
  test(`invalid completion never deletes or invokes Apple: ${change}`, async () => {
    const f = await fixture("apple");
    try {
      await f.auth.prepareDeletion(f.input, f.original);
      let actor = f.fresh;
      if (change === "cancelled") await f.auth.cancelDeletion(f.proof);
      if (change === "original-revoked")
        f.db.sqlite.query("DELETE FROM session WHERE id=?").run(f.original.sessionId);
      if (change === "fresh-revoked")
        f.db.sqlite.query("DELETE FROM session WHERE id=?").run(f.fresh.sessionId);
      if (change === "expired") f.advance(600000);
      if (change === "wrong-owner") {
        const peer = await seedTestSession(f.db, { now: f.now(), oauthAuthenticatedAt: f.now() });
        actor = { userId: peer.userId, sessionId: peer.sessionId };
      }
      let calls = 0;
      await expect(
        completeNativeAccountDeletion(
          f.owner.env,
          change === "normal-purpose" ? { ...f.start, purpose: "reauthenticate" } : f.start,
          change === "wrong-provider" ? "google" : "apple",
          actor,
          {
            now: f.now,
            material: { subject: "synthetic-apple-0", accessToken: "synthetic" },
            revoke: async () => {
              calls++;
              return { status: "confirmed", reason: "revoked", httpStatus: 200 };
            },
          },
        ),
      ).rejects.toThrow();
      expect(calls).toBe(0);
      expect(userExists(f)).toBe(true);
      expect(f.db.sqlite.query("SELECT count(*) n FROM deletion_jobs").get()).toEqual({ n: 0 });
      expect(await f.receipts.status(f.proof)).toBeNull();
    } finally {
      f.db.close();
    }
  });

for (const change of [
  "cancel-after-authorize",
  "original-revoked",
  "fresh-revoked",
  "apple-unlinked",
  "apple-added",
  "receipt-collision",
  "db-error",
] as const)
  test(`atomic batch rejects state races and rolls back all deletion effects: ${change}`, async () => {
    const f = await fixture(change === "apple-added" ? "google" : "apple");
    try {
      await f.auth.prepareDeletion(f.input, f.original);
      const batch = f.db.binding.batch.bind(f.db.binding);
      let injected = false,
        calls = 0;
      f.db.binding.batch = async (statements) => {
        if (!injected) {
          injected = true;
          if (change === "cancel-after-authorize") await f.auth.cancelDeletion(f.proof);
          if (change === "original-revoked")
            f.db.sqlite.query("DELETE FROM session WHERE id=?").run(f.original.sessionId);
          if (change === "fresh-revoked")
            f.db.sqlite.query("DELETE FROM session WHERE id=?").run(f.fresh.sessionId);
          if (change === "apple-unlinked")
            f.db.sqlite.query("DELETE FROM account WHERE provider_id='apple'").run();
          if (change === "apple-added") f.link("apple", "new-apple-subject");
          if (change === "receipt-collision") {
            const handle = await f.receipts.prepareCommit({
              attemptId: f.input.attemptId,
              challenge: f.input.challenge,
              ownerTag: "c".repeat(64),
              appleLinked: true,
            });
            persist(f, handle);
          }
          if (change === "db-error")
            f.db.sqlite.exec(
              "CREATE TRIGGER synthetic_receipt_failure BEFORE INSERT ON app_metadata WHEN NEW.key LIKE 'native-deletion:v1:%' BEGIN SELECT RAISE(ABORT,'synthetic_failure'); END",
            );
        }
        return batch(statements);
      };
      await expect(
        completeNativeAccountDeletion(f.owner.env, f.start, f.input.provider, f.fresh, {
          now: f.now,
          material: { subject: "synthetic-apple-0", refreshToken: "synthetic" },
          revoke: async () => {
            calls++;
            return { status: "confirmed", reason: "revoked", httpStatus: 200 };
          },
        }),
      ).rejects.toThrow();
      expect(injected).toBe(true);
      expect(calls).toBe(0);
      expect(userExists(f)).toBe(true);
      expect(f.db.sqlite.query("SELECT count(*) n FROM deletion_jobs").get()).toEqual({ n: 0 });
      if (change === "db-error" || change === "receipt-collision") {
        expect(
          f.db.sqlite
            .query("SELECT count(*) n FROM app_metadata WHERE key LIKE 'native-reauth:v1:%'")
            .get(),
        ).toEqual({ n: 1 });
        expect(
          f.db.sqlite.query("SELECT count(*) n FROM session WHERE user_id=?").get(f.owner.userId),
        ).toEqual({ n: 2 });
      }
    } finally {
      f.db.close();
    }
  });

test("concurrent completion has one commit/revoke winner; pending provider response cannot erase acceptance", async () => {
  const f = await fixture("apple");
  try {
    await f.auth.prepareDeletion(f.input, f.original);
    let calls = 0;
    const complete = () =>
      completeNativeAccountDeletion(f.owner.env, f.start, "apple", f.fresh, {
        now: f.now,
        material: { subject: "synthetic-apple-0", refreshToken: "synthetic" },
        revoke: async () => {
          calls++;
          return { status: "confirmed", reason: "revoked", httpStatus: 200 };
        },
      });
    const results = await Promise.allSettled([complete(), complete()]);
    expect(results.filter((v) => v.status === "fulfilled")).toHaveLength(1);
    expect(calls).toBe(1);
    expect(await f.receipts.status(f.proof)).toMatchObject({
      status: "accepted",
      appleRevocation: "confirmed",
    });
  } finally {
    f.db.close();
  }
});

test("a provider success whose final receipt write is lost preserves committed deletion and an honest unconfirmed result", async () => {
  const f = await fixture("apple");
  try {
    await f.auth.prepareDeletion(f.input, f.original);
    f.db.sqlite.exec(
      "CREATE TRIGGER synthetic_completion_write_failure BEFORE UPDATE ON app_metadata WHEN NEW.key LIKE 'native-deletion:v1:%' BEGIN SELECT RAISE(ABORT,'synthetic_failure'); END",
    );
    let calls = 0;
    const completed = await completeNativeAccountDeletion(f.owner.env, f.start, "apple", f.fresh, {
      now: f.now,
      material: { subject: "synthetic-apple-0", refreshToken: "synthetic" },
      revoke: async () => {
        calls++;
        return { status: "confirmed", reason: "revoked", httpStatus: 200 };
      },
    });
    expect(calls).toBe(1);
    expect(userExists(f)).toBe(false);
    expect(await f.receipts.status(f.proof)).toMatchObject({
      status: "accepted",
      appleRevocation: "unconfirmed",
    });
    f.db.sqlite.exec("DROP TRIGGER synthetic_completion_write_failure");
    expect(await f.receipts.exchange({ ...f.proof, code: completed.code })).toMatchObject({
      status: "accepted",
      appleRevocation: "unconfirmed",
    });
  } finally {
    f.db.close();
  }
});

async function activityProof(f: Awaited<ReturnType<typeof fixture>>, startedAt = f.now()) {
  const ownerTag = await deletionOwnerTag(f.options.secret, f.original.userId);
  const activityProof = await createNativeDeletionActivityProof(f.options).sign({
    attemptId: f.input.attemptId,
    challenge: f.input.challenge,
    ownerTag,
    startedAt,
  });
  return { ...f.proof, ownerTag, startedAt, activityProof };
}

test("activity is an observation only; active bytes stay unchanged and expired CAS retires only the delete guard", async () => {
  const f = await fixture();
  try {
    await f.auth.prepareDeletion(f.input, f.original);
    const proof = await activityProof(f);
    const row = f.db.sqlite
      .query("SELECT key,value FROM app_metadata WHERE key LIKE 'native-reauth:v1:%'")
      .get() as { key: string; value: string };
    expect(await f.auth.deletionActivity(proof)).toEqual({
      contractVersion: 2,
      attemptId: f.input.attemptId,
      status: "active",
      outcome: "unknown",
      observedAt: new Date(f.now()).toISOString(),
    });
    expect(f.db.sqlite.query("SELECT value FROM app_metadata WHERE key=?").get(row.key)).toEqual({
      value: row.value,
    });
    f.advance(NATIVE_DELETION_RECEIPT_TTL_MS + 1);
    await expect(f.auth.cancelDeletion(f.proof)).rejects.toThrow();
    await expect(f.auth.authorizeDeletion(f.start, "google", f.fresh)).rejects.toThrow();
    expect(await f.auth.deletionActivity(proof)).toEqual({
      contractVersion: 2,
      attemptId: f.input.attemptId,
      status: "inactive",
      outcome: "unknown",
      observedAt: new Date(f.now()).toISOString(),
    });
    expect(f.db.sqlite.query("SELECT value FROM app_metadata WHERE key=?").get(row.key)).toBeNull();
    expect(userExists(f)).toBe(true);
    expect((await f.auth.deletionActivity(proof)).outcome).toBe("unknown");
  } finally {
    f.db.close();
  }
});

for (const alteration of [
  "signature",
  "verifier",
  "attempt",
  "owner",
  "started",
  "issuer",
  "secret",
  "clock",
] as const)
  test(`activity proof is mandatory even after metadata cleanup and is scoped to its original context: ${alteration}`, async () => {
    const f = await fixture();
    try {
      await f.auth.prepareDeletion(f.input, f.original);
      const signed = await activityProof(f);
      await f.auth.cancelDeletion(f.proof);
      const input = { ...signed };
      let auth = f.auth;
      if (alteration === "signature")
        input.activityProof =
          (signed.activityProof[0] === "a" ? "b" : "a") + signed.activityProof.slice(1);
      if (alteration === "verifier") input.verifier = "b".repeat(43);
      if (alteration === "attempt") input.attemptId = crypto.randomUUID();
      if (alteration === "owner") input.ownerTag = "b".repeat(64);
      if (alteration === "started") input.startedAt--;
      if (alteration === "issuer")
        auth = createNativeReauthentication({
          ...f.options,
          issuer: "https://foreign.example.test",
        });
      if (alteration === "secret")
        auth = createNativeReauthentication({
          ...f.options,
          secret: "different-synthetic-secret-at-least-32-characters",
        });
      if (alteration === "clock") f.advance(-1);
      const queries = f.db.queryCount;
      await expect(auth.deletionActivity(input)).rejects.toThrow();
      expect(f.db.queryCount).toBe(queries);
      expect(userExists(f)).toBe(true);
    } finally {
      f.db.close();
    }
  });

for (const expired of [false, true])
  test(`a valid observation proof never retires ordinary reauthentication: expired=${expired}`, async () => {
    const f = await fixture();
    try {
      await f.auth.prepare(
        { attemptId: f.input.attemptId, challenge: f.input.challenge, provider: "google" },
        f.original,
      );
      const signed = await activityProof(f),
        row = f.db.sqlite
          .query("SELECT value FROM app_metadata WHERE key LIKE 'native-reauth:v1:%'")
          .get();
      if (expired) f.advance(NATIVE_DELETION_RECEIPT_TTL_MS + 1);
      await expect(f.auth.deletionActivity(signed)).rejects.toThrow();
      expect(
        f.db.sqlite
          .query("SELECT value FROM app_metadata WHERE key LIKE 'native-reauth:v1:%'")
          .get(),
      ).toEqual(row);
      if (!expired) {
        await f.auth.authorize(f.start, "google", f.fresh);
        expect(await f.auth.verify(f.proof, f.fresh)).toEqual({ startedAt: signed.startedAt });
      }
    } finally {
      f.db.close();
    }
  });

test("already-deleted/expired receipt is still unknown to activity and receipt expiry is not extended", async () => {
  const f = await fixture();
  try {
    await f.auth.prepareDeletion(f.input, f.original);
    const signed = await activityProof(f);
    await completeNativeAccountDeletion(f.owner.env, f.start, "google", f.fresh, {
      now: f.now,
      material: null,
    });
    expect(userExists(f)).toBe(false);
    const receipt = f.db.sqlite
      .query("SELECT key,value FROM app_metadata WHERE key LIKE 'native-deletion:v1:%'")
      .get() as { key: string; value: string };
    f.advance(NATIVE_DELETION_RECEIPT_TTL_MS + 1);
    await expect(f.receipts.status(f.proof)).rejects.toThrow();
    expect(await f.auth.deletionActivity(signed)).toMatchObject({
      status: "inactive",
      outcome: "unknown",
    });
    expect(
      f.db.sqlite.query("SELECT value FROM app_metadata WHERE key=?").get(receipt.key),
    ).toEqual({ value: receipt.value });
    await expect(f.receipts.status(f.proof)).rejects.toThrow();
  } finally {
    f.db.close();
  }
});

test("expired activity CAS can win after callback authorization and rolls back every deletion effect", async () => {
  const f = await fixture();
  try {
    await f.auth.prepareDeletion(f.input, f.original);
    const signed = await activityProof(f),
      batch = f.db.binding.batch.bind(f.db.binding);
    let intercepted = false;
    f.db.binding.batch = async (statements) => {
      if (!intercepted) {
        intercepted = true;
        f.advance(NATIVE_DELETION_RECEIPT_TTL_MS + 1);
        expect((await f.auth.deletionActivity(signed)).status).toBe("inactive");
      }
      return batch(statements);
    };
    await expect(
      completeNativeAccountDeletion(f.owner.env, f.start, "google", f.fresh, {
        now: f.now,
        material: null,
      }),
    ).rejects.toThrow();
    expect(intercepted).toBe(true);
    expect(userExists(f)).toBe(true);
    expect(await f.receipts.status(f.proof)).toBeNull();
    expect(
      f.db.sqlite.query("SELECT count(*) n FROM v2_tombstones WHERE target_kind='account'").get(),
    ).toEqual({ n: 0 });
  } finally {
    f.db.close();
  }
});

test("a callback commit winning the expired cleanup race yields inactive/unknown, never a fabricated cancellation", async () => {
  const f = await fixture();
  const gate = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };
  const reached = gate(),
    release = gate();
  try {
    await f.auth.prepareDeletion(f.input, f.original);
    const signed = await activityProof(f),
      started = f.now();
    const batch = f.db.binding.batch.bind(f.db.binding);
    f.db.binding.batch = async (statements) => {
      reached.resolve();
      await release.promise;
      return batch(statements);
    };
    const callback = completeNativeAccountDeletion(f.owner.env, f.start, "google", f.fresh, {
      now: () => started,
      material: null,
    });
    await reached.promise;
    f.advance(NATIVE_DELETION_RECEIPT_TTL_MS + 1);
    const prepare = f.db.binding.prepare.bind(f.db.binding);
    f.db.binding.prepare = (sql) => {
      const wrap = (statement: D1PreparedStatement): D1PreparedStatement => ({
        first: statement.first.bind(statement),
        all: statement.all.bind(statement),
        raw: statement.raw.bind(statement),
        bind: (...values: unknown[]) => wrap(statement.bind(...values)),
        run: async <T>() => {
          release.resolve();
          await callback;
          return statement.run<T>();
        },
      });
      const statement = prepare(sql);
      return sql === "DELETE FROM app_metadata WHERE key=? AND value=?"
        ? wrap(statement)
        : statement;
    };
    expect(await f.auth.deletionActivity(signed)).toMatchObject({
      status: "inactive",
      outcome: "unknown",
    });
    expect(userExists(f)).toBe(false);
    expect(
      f.db.sqlite
        .query("SELECT count(*) n FROM app_metadata WHERE key LIKE 'native-deletion:v1:%'")
        .get(),
    ).toEqual({ n: 1 });
    await expect(f.receipts.status(f.proof)).rejects.toThrow();
  } finally {
    release.resolve();
    f.db.close();
  }
});
