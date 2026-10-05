import { afterEach, expect, test } from "bun:test";
import type { V2PortfolioAsset } from "../src/contracts/v2";
import {
  createCaseDataCipher,
  type EncryptionContext,
  type EnvelopeCipher,
} from "../src/server/crypto";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2DeletionRepository } from "../src/server/db/v2-deletion";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createV2LawyersRepository } from "../src/server/db/v2-lawyers";
import { type BlobRegistration, createV2StorageRepository } from "../src/server/db/v2-storage";
import type { JobLease } from "../src/server/db/v2-workspace";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const NOW = "2026-10-06T00:00:00.000Z";
const UNTIL = "2026-10-06T00:04:00.000Z";
const ORIGINAL_HASH = "a".repeat(64);
const SANITIZED_HASH = "b".repeat(64);
const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

async function fixture(purpose: "portfolio" | "profile_photo" | "identity" = "profile_photo") {
  const database = await createTestDatabase();
  databases.push(database);
  // Test helper seeds synthetic authentication SQL only; all asset/job writes below
  // use actual repositories and the generated migration with foreign keys enabled.
  const owner = await seedTestSession(database, { now: Date.parse(NOW), consent: true });
  const other = await seedTestSession(database, { now: Date.parse(NOW), consent: true });
  const actor = { ownerId: owner.userId, now: NOW };
  const stranger = { ownerId: other.userId, now: NOW };
  const cipher = await createCaseDataCipher({
    CASE_DATA_KEY_V1: btoa("j".repeat(32)).replace(/=+$/, ""),
  });
  let beforeEncrypt: ((context: EncryptionContext) => void | Promise<void>) | undefined;
  let afterDecrypt: ((context: EncryptionContext) => void | Promise<void>) | undefined;
  const observedCipher: EnvelopeCipher = {
    async encrypt(value, context) {
      await beforeEncrypt?.(context);
      return cipher.encrypt(value, context);
    },
    async decrypt(value, context) {
      const plaintext = await cipher.decrypt(value, context);
      await afterDecrypt?.(context);
      return plaintext;
    },
  };
  const core = createV2Core(database.binding, observedCipher);
  const lawyers = createV2LawyersRepository(core);
  const storage = createV2StorageRepository(core);
  const jobs = createV2JobsRepository(core);
  const deletion = createV2DeletionRepository(core);
  const profileId = crypto.randomUUID();
  expect(await lawyers.createProfile(actor, profileId)).toBe(true);
  const assetId = crypto.randomUUID();
  const reservationId = crypto.randomUUID();
  const admission = {
    operationId: crypto.randomUUID(),
    key: crypto.randomUUID(),
    requestHash: ORIGINAL_HASH,
  };
  const kind = purpose === "portfolio" ? ("pdf" as const) : ("image" as const);
  expect(
    await lawyers.reserveAsset(
      actor,
      profileId,
      1,
      assetId,
      {
        name: "합성 공개 자료",
        purpose,
        byteLength: 100,
        mediaType: kind === "pdf" ? "application/pdf" : "image/png",
      },
      reservationId,
      admission,
    ),
  ).toBe(true);
  const original: BlobRegistration = {
    id: crypto.randomUUID(),
    reservationId,
    kind:
      purpose === "portfolio"
        ? "portfolio_original"
        : purpose === "profile_photo"
          ? "profile_photo_original"
          : "verification",
    visibility: "private",
    logicalBytes: 100,
    cipherBytes: 116,
    cipherHash: "c".repeat(64),
    contentHash: ORIGINAL_HASH,
    keyVersion: "1",
  };
  const sanitized: BlobRegistration = {
    ...original,
    id: crypto.randomUUID(),
    reservationId: crypto.randomUUID(),
    kind: purpose === "portfolio" ? "portfolio_sanitized" : "profile_photo_sanitized",
    visibility: "staging",
    logicalBytes: 60,
    cipherBytes: 76,
    contentHash: SANITIZED_HASH,
  };
  const value: V2PortfolioAsset = {
    id: assetId,
    revision: 2,
    kind,
    status: "ready",
    byteLength: 100,
    originalHash: ORIGINAL_HASH,
    sanitizedDerivative: {
      id: sanitized.id,
      contentHash: SANITIZED_HASH,
      byteLength: 60,
      format: kind === "pdf" ? "pdf" : "png",
    },
    currentJobId: null,
    failure: null,
  };
  async function storeOriginal(blob = original) {
    expect(await storage.registerBlob(actor, blob)).toBe(true);
    expect(await storage.commitReservation(actor, reservationId)).toBe(true);
  }
  async function storeSanitized(blob = sanitized) {
    expect(
      await storage.reserveAssetCopy(actor, {
        id: sanitized.reservationId,
        artifactId: sanitized.id,
        assetId,
        profileId,
        assetRevision: 1,
        byteLength: sanitized.logicalBytes,
      }),
    ).toBe(true);
    expect(await storage.registerBlob(actor, blob)).toBe(true);
    expect(await storage.commitReservation(actor, sanitized.reservationId)).toBe(true);
  }
  const jobId = crypto.randomUUID();
  async function admit() {
    return jobs.admitAsset(actor, { assetId, assetRevision: 1, jobId });
  }
  async function acquire() {
    const result = await jobs.acquire(actor, jobId, crypto.randomUUID(), UNTIL);
    if (!result) throw new Error("Synthetic asset job could not acquire its lease");
    return result;
  }
  function snapshot() {
    return [
      "v2_assets",
      "v2_jobs",
      "v2_operations",
      "v2_outbox",
      "v2_storage_reservations",
      "v2_blobs",
      "v2_storage_usage",
      "v2_mutation_claims",
    ].map((table) => database.sqlite.query(`SELECT * FROM ${table} ORDER BY rowid`).all());
  }
  return {
    database,
    actor,
    stranger,
    core,
    lawyers,
    storage,
    jobs,
    deletion,
    profileId,
    assetId,
    admission,
    original,
    sanitized,
    value,
    jobId,
    storeOriginal,
    storeSanitized,
    admit,
    acquire,
    snapshot,
    onEncrypt(hook: typeof beforeEncrypt) {
      beforeEncrypt = hook;
    },
    onDecrypt(hook: typeof afterDecrypt) {
      afterDecrypt = hook;
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function processing(purpose: "portfolio" | "profile_photo" = "profile_photo") {
  const f = await fixture(purpose);
  await f.storeOriginal();
  expect(await f.admit()).toBe(true);
  const acquired = await f.acquire();
  await f.storeSanitized();
  return { ...f, lease: acquired.lease, job: acquired.job };
}
function save(f: Fixture, lease?: JobLease, value = f.value, actor = f.actor) {
  return f.lawyers.saveAsset(actor, f.assetId, 1, value, f.original.id, f.sanitized.id, lease);
}

async function anotherSource(f: Fixture, differentOwner: boolean) {
  const actor = differentOwner ? f.stranger : f.actor;
  const profileId = differentOwner ? crypto.randomUUID() : f.profileId;
  if (differentOwner) expect(await f.lawyers.createProfile(actor, profileId)).toBe(true);
  const assetId = crypto.randomUUID();
  const reservationId = crypto.randomUUID();
  expect(
    await f.lawyers.reserveAsset(
      actor,
      profileId,
      1,
      assetId,
      {
        name: "합성 별도 자산",
        purpose: "profile_photo",
        byteLength: 100,
        mediaType: "image/png",
      },
      reservationId,
      { operationId: crypto.randomUUID(), key: crypto.randomUUID(), requestHash: ORIGINAL_HASH },
    ),
  ).toBe(true);
  const original = { ...f.original, id: crypto.randomUUID(), reservationId };
  expect(await f.storage.registerBlob(actor, original)).toBe(true);
  expect(await f.storage.commitReservation(actor, reservationId)).toBe(true);
  const sanitized = { ...f.sanitized, id: crypto.randomUUID(), reservationId: crypto.randomUUID() };
  expect(
    await f.storage.reserveAssetCopy(actor, {
      id: sanitized.reservationId,
      artifactId: sanitized.id,
      assetId,
      profileId,
      assetRevision: 1,
      byteLength: sanitized.logicalBytes,
    }),
  ).toBe(true);
  expect(await f.storage.registerBlob(actor, sanitized)).toBe(true);
  expect(await f.storage.commitReservation(actor, sanitized.reservationId)).toBe(true);
  return { original, sanitized };
}

test.each(["profile_photo", "portfolio"] as const)(
  "actual %s asset job preserves operation/source provenance and completion cannot publish an unreviewed profile",
  async (purpose) => {
    const f = await processing(purpose);
    expect(f.job).toMatchObject({
      operationId: f.admission.operationId,
      kind: "portfolio_sanitize",
      target: {
        kind: "profile_asset",
        profileId: f.profileId,
        assetId: f.assetId,
        assetRevision: 1,
      },
    });
    expect(await save(f, f.lease)).toBe(true);
    expect(await f.lawyers.readAsset(f.actor, f.assetId)).toEqual(f.value);
    expect(await f.lawyers.readAsset(f.stranger, f.assetId)).toBeNull();
    expect((await f.jobs.find(f.actor, f.jobId))?.status).toBe("completed");
    expect(
      f.database.sqlite
        .query(
          "SELECT revision,state,original_blob_id,sanitized_blob_id,current_job_id FROM v2_assets WHERE id=?",
        )
        .get(f.assetId),
    ).toEqual({
      revision: 2,
      state: "ready",
      original_blob_id: f.original.id,
      sanitized_blob_id: f.sanitized.id,
      current_job_id: null,
    });
    expect(
      f.database.sqlite
        .query("SELECT state FROM v2_operations WHERE id=?")
        .get(f.admission.operationId),
    ).toEqual({ state: "completed" });
    const reservation = crypto.randomUUID();
    const publicId = crypto.randomUUID();
    expect(
      await f.storage.reserveAssetCopy(f.actor, {
        id: reservation,
        artifactId: publicId,
        profileId: f.profileId,
        assetId: f.assetId,
        assetRevision: 2,
        byteLength: 60,
      }),
    ).toBe(true);
    expect(
      await f.storage.registerApprovedPublicCopy(
        f.actor,
        {
          ...f.sanitized,
          id: publicId,
          reservationId: reservation,
          kind: "public_copy",
          visibility: "public",
          keyVersion: null,
        },
        {
          assetId: f.assetId,
          assetRevision: 2,
          approvedRevisionId: crypto.randomUUID(),
          sourceBlobId: f.sanitized.id,
        },
      ),
    ).toBe(false);
    expect(await f.lawyers.publicProfile(f.profileId)).toBeNull();
    expect(
      f.database.sqlite.query("SELECT id FROM v2_blobs WHERE visibility='public'").all(),
    ).toEqual([]);
    expect(f.database.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  },
);

test("admission requires stored matching private original, owner and revision, and has one winner under contention", async () => {
  const f = await fixture();
  expect(await f.admit()).toBe(false);
  await f.storeOriginal();
  const before = f.snapshot();
  expect(
    await f.jobs.admitAsset(f.stranger, { assetId: f.assetId, assetRevision: 1, jobId: f.jobId }),
  ).toBe(false);
  expect(
    await f.jobs.admitAsset(f.actor, { assetId: f.assetId, assetRevision: 2, jobId: f.jobId }),
  ).toBe(false);
  expect(f.snapshot()).toEqual(before);
  const outcomes = await Promise.all([
    f.admit(),
    f.jobs.admitAsset(f.actor, {
      assetId: f.assetId,
      assetRevision: 1,
      jobId: crypto.randomUUID(),
    }),
  ]);
  expect(outcomes.filter(Boolean)).toHaveLength(1);
  expect(f.database.sqlite.query("SELECT operation_id,target_revision FROM v2_jobs").all()).toEqual(
    [{ operation_id: f.admission.operationId, target_revision: 1 }],
  );
  expect(f.database.sqlite.query("SELECT count(*) AS count FROM v2_outbox").get()).toEqual({
    count: 1,
  });
  expect(f.database.sqlite.query("SELECT * FROM v2_mutation_claims").all()).toEqual([]);
});

test.each(["identity", "wrong-original-kind", "public-original"] as const)(
  "asset admission rejects %s source without a job/outbox side effect",
  async (scenario) => {
    const f = await fixture(scenario === "identity" ? "identity" : "profile_photo");
    if (scenario === "public-original") {
      // Storage itself refuses a public original; no direct insertion circumvents it.
      expect(await f.storage.registerBlob(f.actor, { ...f.original, visibility: "public" })).toBe(
        false,
      );
    } else {
      await f.storeOriginal(
        scenario === "wrong-original-kind"
          ? { ...f.original, kind: "portfolio_original" }
          : f.original,
      );
    }
    const before = f.snapshot();
    expect(await f.admit()).toBe(false);
    expect(f.snapshot()).toEqual(before);
  },
);

test.each([
  "missing-lease",
  "token",
  "fence",
  "job",
  "expired",
  "owner",
  "revision",
  "original-hash",
  "original-bytes",
  "sanitized-hash",
  "sanitized-bytes",
] as const)(
  "saveAsset rejects %s without finishing the job or changing encrypted assets",
  async (scenario) => {
    const f = await processing();
    const before = f.snapshot();
    let lease: JobLease | undefined = { ...f.lease };
    const actor = { ...f.actor };
    const value = structuredClone(f.value);
    if (scenario === "missing-lease") lease = undefined;
    if (scenario === "token" && lease) lease.token = crypto.randomUUID();
    if (scenario === "fence" && lease) lease.fencing++;
    if (scenario === "job" && lease) lease.jobId = crypto.randomUUID();
    if (scenario === "expired") actor.now = UNTIL;
    if (scenario === "owner") actor.ownerId = f.stranger.ownerId;
    if (scenario === "revision") value.revision = 3;
    if (scenario === "original-hash") value.originalHash = "d".repeat(64);
    if (scenario === "original-bytes") value.byteLength = 101;
    if (!value.sanitizedDerivative) throw new Error("Synthetic sanitizer result is missing");
    if (scenario === "sanitized-hash") value.sanitizedDerivative.contentHash = "d".repeat(64);
    if (scenario === "sanitized-bytes") value.sanitizedDerivative.byteLength = 61;
    expect(await save(f, lease, value, actor)).toBe(false);
    expect(f.snapshot()).toEqual(before);
  },
);

test("failure/retry preserves one logical operation and target revision while fencing out the old worker", async () => {
  const f = await processing();
  expect(await f.jobs.fail(f.actor, f.lease, "FILE_PROCESSING_FAILED", true)).toBe(true);
  const failed = f.snapshot();
  expect(await f.jobs.retryAsset(f.stranger, f.jobId)).toBe(false);
  expect(f.snapshot()).toEqual(failed);
  expect(await f.jobs.retryAsset(f.actor, f.jobId)).toBe(true);
  expect(await f.jobs.retryAsset(f.actor, f.jobId)).toBe(false);
  const acquired = await f.acquire();
  expect(acquired.lease.fencing).toBeGreaterThan(f.lease.fencing);
  expect(acquired.job).toMatchObject({
    attempts: 2,
    operationId: f.admission.operationId,
    target: { kind: "profile_asset", assetId: f.assetId, assetRevision: 1 },
  });
  expect(await save(f, f.lease)).toBe(false);
  expect(await save(f, acquired.lease)).toBe(true);
  expect(f.database.sqlite.query("SELECT count(*) AS count FROM v2_operations").get()).toEqual({
    count: 1,
  });
  expect(
    f.database.sqlite.query("SELECT target_id,revision FROM v2_outbox ORDER BY revision").all(),
  ).toEqual([
    { target_id: `${f.jobId}-1`, revision: 1 },
    { target_id: `${f.jobId}-2`, revision: 2 },
  ]);
  expect(f.database.sqlite.query("SELECT * FROM v2_mutation_claims").all()).toEqual([]);
});

test("a failed admitted sanitizer cannot bypass retry fencing by omitting its lease", async () => {
  const f = await processing();
  expect(await f.jobs.fail(f.actor, f.lease, "FILE_PROCESSING_FAILED", true)).toBe(true);
  const before = f.snapshot();
  expect(await save(f)).toBe(false);
  expect(f.snapshot()).toEqual(before);
});

test("expired worker loses its lease to a reclaimer and cannot publish a sanitized result", async () => {
  const f = await processing();
  const actor = { ...f.actor, now: UNTIL };
  const acquired = await f.jobs.acquire(
    actor,
    f.jobId,
    crypto.randomUUID(),
    "2026-10-06T00:06:00.000Z",
  );
  if (!acquired) throw new Error("Synthetic expired lease was not reclaimable");
  expect(acquired.lease.fencing).toBeGreaterThan(f.lease.fencing);
  expect(await save(f, f.lease, f.value, actor)).toBe(false);
  expect(await save(f, acquired.lease, f.value, actor)).toBe(true);
});

test.each(["profile", "asset"] as const)(
  "actual %s deletion stops an acquired sanitizer and leaves no public projection",
  async (target) => {
    const f = await processing();
    expect(
      await (target === "profile"
        ? f.deletion.profile(f.actor, f.profileId, 1)
        : f.deletion.asset(f.actor, f.assetId, 1)),
    ).toBe(true);
    expect(await save(f, f.lease)).toBe(false);
    expect(await f.jobs.retryAsset(f.actor, f.jobId)).toBe(false);
    expect(await f.lawyers.readAsset(f.actor, f.assetId)).toBeNull();
    expect(await f.lawyers.publicProfile(f.profileId)).toBeNull();
    expect(f.database.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  },
);

test("profile deletion during actual AES source decryption prevents late publication", async () => {
  const f = await processing();
  let deleted = false;
  f.onDecrypt(async (context) => {
    if (context.table === "v2_blobs" && context.rowId === f.sanitized.id && !deleted) {
      deleted = true;
      expect(await f.deletion.profile(f.actor, f.profileId, 1)).toBe(true);
    }
  });
  expect(await save(f, f.lease)).toBe(false);
  expect(deleted).toBe(true);
  expect(await f.lawyers.readAsset(f.actor, f.assetId)).toBeNull();
});

test("final publication claim rechecks the active asset job pointer after encryption yields", async () => {
  const f = await processing();
  let changed = false;
  f.onEncrypt((context) => {
    if (context.table === "v2_assets" && !changed) {
      changed = true;
      // Adversarial SQL models an independently replaced pointer between preflight
      // and transaction; it does not fabricate a successful admission or cipher.
      f.database.sqlite
        .query("UPDATE v2_assets SET current_job_id=? WHERE id=?")
        .run(crypto.randomUUID(), f.assetId);
    }
  });
  expect(await save(f, f.lease)).toBe(false);
  expect(changed).toBe(true);
  expect((await f.jobs.find(f.actor, f.jobId))?.status).toBe("running");
  expect(
    f.database.sqlite.query("SELECT revision FROM v2_assets WHERE id=?").get(f.assetId),
  ).toEqual({ revision: 1 });
});

test("another owner cannot acquire or fail a real asset job even with its valid lease", async () => {
  const f = await fixture();
  await f.storeOriginal();
  expect(await f.admit()).toBe(true);
  let before = f.snapshot();
  expect(await f.jobs.acquire(f.stranger, f.jobId, crypto.randomUUID(), UNTIL)).toBeNull();
  expect(f.snapshot()).toEqual(before);
  const acquired = await f.acquire();
  before = f.snapshot();
  expect(await f.jobs.fail(f.stranger, acquired.lease, "FILE_PROCESSING_FAILED", true)).toBe(false);
  expect(f.snapshot()).toEqual(before);
});

for (const differentOwner of [false, true]) {
  test.each(["original", "sanitized"] as const)(
    `${differentOwner ? "another owner's" : "same owner's other asset"} %s source cannot substitute identical bytes and hash`,
    async (source) => {
      const f = await processing();
      const other = await anotherSource(f, differentOwner);
      const before = f.snapshot();
      expect(
        await f.lawyers.saveAsset(
          f.actor,
          f.assetId,
          1,
          f.value,
          source === "original" ? other.original.id : f.original.id,
          source === "sanitized" ? other.sanitized.id : f.sanitized.id,
          f.lease,
        ),
      ).toBe(false);
      expect(f.snapshot()).toEqual(before);
    },
  );
}

test("photo sanitizer cannot complete using a portfolio-kind blob with matching bytes and hash", async () => {
  const f = await fixture();
  await f.storeOriginal();
  expect(await f.admit()).toBe(true);
  const acquired = await f.acquire();
  await f.storeSanitized({ ...f.sanitized, kind: "portfolio_sanitized" });
  const before = f.snapshot();
  expect(await save(f, acquired.lease)).toBe(false);
  expect(f.snapshot()).toEqual(before);
});

test("retry refuses a changed target revision while retaining the actual failed operation", async () => {
  const f = await processing();
  expect(await f.jobs.fail(f.actor, f.lease, "FILE_PROCESSING_FAILED", true)).toBe(true);
  const changed: V2PortfolioAsset = {
    ...f.value,
    status: "failed",
    sanitizedDerivative: null,
    failure: "FILE_PROCESSING_FAILED",
  };
  const payload = await f.core.encrypt("v2_assets", f.assetId, f.actor.ownerId, 2, changed);
  // Adversarial concurrent edit uses real AES and correct AAD, rather than an
  // invalid ciphertext that would reject before target-revision fencing.
  f.database.sqlite
    .query("UPDATE v2_assets SET revision=2, encrypted_payload=? WHERE id=?")
    .run(payload, f.assetId);
  const before = f.snapshot();
  expect(await f.jobs.retryAsset(f.actor, f.jobId)).toBe(false);
  expect(f.snapshot()).toEqual(before);
});

test("concurrent retries admit exactly one next attempt and retain both outbox entries", async () => {
  const f = await processing();
  expect(await f.jobs.fail(f.actor, f.lease, "FILE_PROCESSING_FAILED", true)).toBe(true);
  const results = await Promise.all([
    f.jobs.retryAsset(f.actor, f.jobId),
    f.jobs.retryAsset(f.actor, f.jobId),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(f.database.sqlite.query("SELECT id FROM v2_operations").all()).toHaveLength(1);
  expect(f.database.sqlite.query("SELECT id FROM v2_outbox").all()).toHaveLength(2);
  expect(f.database.sqlite.query("SELECT * FROM v2_mutation_claims").all()).toEqual([]);
});

test("SQLite publication failure rolls back the asset, completed job and operation together", async () => {
  const f = await processing();
  const before = f.snapshot();
  // Real SQLite trigger injects a storage failure inside the actual repository
  // batch; no repository method or transaction implementation is mocked.
  f.database.sqlite.exec(
    "CREATE TEMP TRIGGER synthetic_publication_failure BEFORE UPDATE ON v2_assets BEGIN SELECT RAISE(ABORT, 'SYNTHETIC_ROLLBACK'); END",
  );
  await expect(save(f, f.lease)).rejects.toThrow("DB_OPERATION_FAILED");
  expect(f.snapshot()).toEqual(before);
  expect(f.database.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});
