import { afterEach, beforeEach, expect, test } from "bun:test";
import type { V2LawyerAssetUploadRequest } from "../src/contracts/v2";
import { createEnvelopeCipher, type EncryptionContext } from "../src/server/crypto";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2DeletionRepository } from "../src/server/db/v2-deletion";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createV2LawyersRepository } from "../src/server/db/v2-lawyers";
import { type BlobRegistration, createV2StorageRepository } from "../src/server/db/v2-storage";
import { createTestDatabase } from "./helpers/d1";

const now = "2026-10-06T00:00:00.000Z",
  epoch = Date.parse(now);
const actor = { ownerId: "asset_owner_synthetic", now };
const stranger = { ownerId: "asset_stranger_synthetic", now };
let db: Awaited<ReturnType<typeof createTestDatabase>>;
let core: ReturnType<typeof createV2Core>;
let storage: ReturnType<typeof createV2StorageRepository>;
let lawyers: ReturnType<typeof createV2LawyersRepository>;
let deletion: ReturnType<typeof createV2DeletionRepository>;
let beforeEncrypt: ((context: EncryptionContext) => void) | undefined;
let afterDecrypt: ((context: EncryptionContext) => void) | undefined;
let decryptCount: number;
const intent = {
  assetId: "asset_synthetic",
  assetRevision: 1,
  blobId: "blob_synthetic",
  reservationId: "reservation_synthetic",
  keyVersion: "asset_binary_v1",
};
const blob: BlobRegistration = {
  id: intent.blobId,
  reservationId: intent.reservationId,
  kind: "verification",
  visibility: "private",
  logicalBytes: 100,
  cipherBytes: 320,
  cipherHash: "b".repeat(64),
  contentHash: "a".repeat(64),
  keyVersion: intent.keyVersion,
};

beforeEach(async () => {
  db = await createTestDatabase();
  beforeEncrypt = undefined;
  afterDecrypt = undefined;
  decryptCount = 0;
  const cipher = await createEnvelopeCipher({
    activeKeyId: "synthetic",
    keys: { synthetic: btoa("s".repeat(32)).replace(/=+$/, "") },
  });
  core = createV2Core(db.binding, {
    encrypt(value, context) {
      beforeEncrypt?.(context);
      return cipher.encrypt(value, context);
    },
    async decrypt(value, context) {
      decryptCount++;
      const result = await cipher.decrypt(value, context);
      afterDecrypt?.(context);
      return result;
    },
  });
  storage = createV2StorageRepository(core);
  lawyers = createV2LawyersRepository(core);
  deletion = createV2DeletionRepository(core);
  for (const user of [actor, stranger])
    db.sqlite
      .query("INSERT INTO user(id,name,email,created_at,updated_at) VALUES(?,?,?,?,?)")
      .run(user.ownerId, "Synthetic account", `${user.ownerId}@invalid.test`, epoch, epoch);
  expect(await lawyers.createProfile(actor, "profile_synthetic")).toBe(true);
});
afterEach(() => {
  expect(db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  db.close();
});
async function reserve(purpose: V2LawyerAssetUploadRequest["purpose"] = "identity") {
  expect(
    await lawyers.reserveAsset(
      actor,
      "profile_synthetic",
      1,
      intent.assetId,
      {
        purpose,
        name: "합성 자료",
        byteLength: 100,
        mediaType: purpose === "profile_photo" ? "image/png" : "application/pdf",
      },
      intent.reservationId,
      {
        operationId: "operation_synthetic",
        key: "asset_upload_synthetic_key",
        requestHash: "c".repeat(64),
      },
    ),
  ).toBe(true);
}
function snapshot() {
  return [
    "v2_assets",
    "v2_blobs",
    "v2_storage_reservations",
    "v2_storage_usage",
    "v2_deletion_journals",
    "v2_deletion_targets",
    "v2_mutation_claims",
  ].map((table) => db.sqlite.query(`SELECT * FROM ${table} ORDER BY rowid`).all());
}
function tombstone(kind: string, id: string) {
  db.sqlite
    .query("INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES(?,?,?)")
    .run(kind, id, now);
}

const jobId = "sanitizer_job_synthetic";
const sanitized: BlobRegistration = {
  id: "sanitized_synthetic",
  reservationId: "sanitized_reservation",
  kind: "profile_photo_sanitized",
  visibility: "staging",
  logicalBytes: 60,
  cipherBytes: 76,
  cipherHash: "c".repeat(64),
  contentHash: "d".repeat(64),
  keyVersion: "asset_sanitized_v1",
};
async function processing(purpose: "profile_photo" | "portfolio" = "profile_photo") {
  await reserve(purpose);
  expect(await storage.prepareAssetUpload(actor, intent)).toBe(true);
  const original = {
    ...blob,
    kind:
      purpose === "profile_photo"
        ? ("profile_photo_original" as const)
        : ("portfolio_original" as const),
  };
  expect(
    await storage.commitAssetUpload(actor, {
      assetId: intent.assetId,
      assetRevision: 1,
      blob: original,
    }),
  ).toBe(true);
  const jobs = createV2JobsRepository(core);
  expect(await jobs.admitAsset(actor, { assetId: intent.assetId, assetRevision: 2, jobId })).toBe(
    true,
  );
  const acquired = await jobs.acquire(actor, jobId, "sanitize_lease", "2026-10-06T00:04:00.000Z");
  if (!acquired) throw new Error("Synthetic sanitize lease missing");
  return {
    jobs,
    lease: acquired.lease,
    original,
    sanitized: {
      ...sanitized,
      kind:
        purpose === "profile_photo"
          ? ("profile_photo_sanitized" as const)
          : ("portfolio_sanitized" as const),
    },
    purpose,
  };
}
for (const purpose of ["profile_photo", "portfolio"] as const)
  test(`${purpose} actual asset job prepares separate pending reservation and receipt atomically stores before saveAsset`, async () => {
    const f = await processing(purpose);
    expect(await storage.prepareSanitizedAssetBlob(actor, f.lease, f.sanitized)).toBe(true);
    expect(await storage.findBlob(actor, f.sanitized.id)).toBeNull();
    expect(databaseState()).toEqual({ reserved_bytes: 60, stored_bytes: 100 });
    expect(await storage.findPendingSanitizedAssetBlob(actor, f.lease, f.sanitized.id)).toEqual({
      blob: f.sanitized,
      preparedFencing: f.lease.fencing,
      sourceBlobId: f.original.id,
      assetRevision: 2,
    });
    expect(await storage.commitSanitizedAssetBlob(actor, f.lease, f.sanitized)).toBe(true);
    expect(databaseState()).toEqual({ reserved_bytes: 0, stored_bytes: 160 });
    expect(await storage.commitReservation(actor, f.sanitized.reservationId)).toBe(false);
    const ready = {
      id: intent.assetId,
      revision: 3,
      kind: purpose === "portfolio" ? "pdf" : "image",
      status: "ready",
      byteLength: 100,
      originalHash: f.original.contentHash,
      sanitizedDerivative: {
        id: f.sanitized.id,
        contentHash: f.sanitized.contentHash,
        byteLength: 60,
        format: purpose === "portfolio" ? "pdf" : "png",
      },
      currentJobId: null,
      failure: null,
    } as const;
    expect(
      await lawyers.saveAsset(
        actor,
        intent.assetId,
        2,
        ready,
        f.original.id,
        f.sanitized.id,
        f.lease,
      ),
    ).toBe(true);
    expect(await lawyers.readAsset(actor, intent.assetId)).toEqual(ready);
    expect(db.sqlite.query("SELECT status FROM v2_jobs").get()).toEqual({ status: "completed" });
    expect(await storage.abandonSanitizedAssetBlob(actor, f.sanitized.id)).toBe(false);
  });
function databaseState() {
  return db.sqlite.query("SELECT reserved_bytes,stored_bytes FROM v2_storage_usage").get();
}
for (const guard of [
  "owner",
  "fence",
  "token",
  "expiry",
  "pointer",
  "revision",
  "cancelled",
  "source",
  "asset",
  "profile",
  "account",
] as const)
  test(`sanitized pending admission rejects ${guard} without reservation or plaintext exposure`, async () => {
    const f = await processing();
    let caller = actor,
      lease = f.lease;
    if (guard === "owner") caller = stranger;
    if (guard === "fence") lease = { ...lease, fencing: 99 };
    if (guard === "token") lease = { ...lease, token: "wrong_token" };
    if (guard === "expiry") caller = { ...actor, now: "2026-10-06T00:04:00.000Z" };
    if (guard === "pointer") db.sqlite.query("UPDATE v2_assets SET current_job_id=NULL").run();
    if (guard === "revision") db.sqlite.query("UPDATE v2_assets SET revision=3").run();
    if (guard === "cancelled") db.sqlite.query("UPDATE v2_jobs SET status='cancelled'").run();
    if (guard === "source")
      db.sqlite.query("UPDATE v2_blobs SET state='deleting' WHERE id=?").run(f.original.id);
    if (guard === "asset") tombstone("asset", intent.assetId);
    if (guard === "profile") tombstone("profile", "profile_synthetic");
    if (guard === "account") tombstone("account", actor.ownerId);
    const before = snapshot();
    decryptCount = 0;
    expect(await storage.prepareSanitizedAssetBlob(caller, lease, f.sanitized)).toBe(false);
    expect(await storage.findPendingSanitizedAssetBlob(caller, lease, f.sanitized.id)).toBeNull();
    expect(decryptCount).toBe(0);
    expect(snapshot()).toEqual(before);
  });
test("sanitize reservation enforces purpose/type/key/100MB/account bounds, concurrent winner and rollback", async () => {
  const f = await processing();
  for (const changed of [
    { kind: "portfolio_sanitized" as const },
    { visibility: "private" as const },
    { keyVersion: "different_key" },
    { logicalBytes: 100000001 },
  ])
    expect(
      await storage.prepareSanitizedAssetBlob(actor, f.lease, { ...f.sanitized, ...changed }),
    ).toBe(false);
  db.sqlite.query("UPDATE v2_storage_usage SET stored_bytes=9999999941").run();
  expect(await storage.prepareSanitizedAssetBlob(actor, f.lease, f.sanitized)).toBe(false);
  db.sqlite.query("UPDATE v2_storage_usage SET stored_bytes=100").run();
  db.sqlite.exec(
    "CREATE TRIGGER reject_pending BEFORE INSERT ON v2_blobs WHEN NEW.visibility='staging' BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  );
  const before = snapshot();
  await expect(storage.prepareSanitizedAssetBlob(actor, f.lease, f.sanitized)).rejects.toThrow(
    "DB_OPERATION_FAILED",
  );
  expect(snapshot()).toEqual(before);
  db.sqlite.exec("DROP TRIGGER reject_pending");
  expect(
    (
      await Promise.all([
        storage.prepareSanitizedAssetBlob(actor, f.lease, f.sanitized),
        storage.prepareSanitizedAssetBlob(actor, f.lease, f.sanitized),
      ])
    ).filter(Boolean),
  ).toHaveLength(1);
  expect(
    (
      await Promise.all([
        storage.commitSanitizedAssetBlob(actor, f.lease, f.sanitized),
        storage.commitSanitizedAssetBlob(actor, f.lease, f.sanitized),
      ])
    ).filter(Boolean),
  ).toHaveLength(1);
  expect(databaseState()).toEqual({ reserved_bytes: 0, stored_bytes: 160 });
});
test("sanitized recovery preserves original tuple and cannot adopt an old fence or changed original ciphertext", async () => {
  const f = await processing();
  expect(await storage.prepareSanitizedAssetBlob(actor, f.lease, f.sanitized)).toBe(true);
  for (const changed of [
    { contentHash: "e".repeat(64) },
    { cipherHash: "f".repeat(64) },
    { logicalBytes: 59 },
    { cipherBytes: 77 },
    { reservationId: "wrong_reservation" },
  ])
    expect(
      await storage.commitSanitizedAssetBlob(actor, f.lease, { ...f.sanitized, ...changed }),
    ).toBe(false);
  db.sqlite.query("UPDATE v2_jobs SET fencing=2,lease_token='new_lease'").run();
  const lease = { ...f.lease, fencing: 2, token: "new_lease" };
  expect(await storage.findPendingSanitizedAssetBlob(actor, lease, f.sanitized.id)).toMatchObject({
    preparedFencing: 1,
    sourceBlobId: f.original.id,
    assetRevision: 2,
  });
  expect(await storage.commitSanitizedAssetBlob(actor, lease, f.sanitized)).toBe(false);
  expect(await storage.abandonSanitizedAssetBlob(actor, f.sanitized.id)).toBe(true);
  expect(databaseState()).toEqual({ reserved_bytes: 60, stored_bytes: 100 });
});
test("sanitized publication rechecks original source and asset pointer across AES awaits and rolls back receipt failure", async () => {
  const f = await processing();
  expect(await storage.prepareSanitizedAssetBlob(actor, f.lease, f.sanitized)).toBe(true);
  afterDecrypt = () => {
    afterDecrypt = undefined;
    tombstone("asset", intent.assetId);
  };
  expect(await storage.commitSanitizedAssetBlob(actor, f.lease, f.sanitized)).toBe(false);
  db.sqlite.query("DELETE FROM v2_tombstones").run();
  beforeEncrypt = (context) => {
    if (context.table === "v2_blobs")
      db.sqlite.query("UPDATE v2_assets SET current_job_id=NULL").run();
  };
  expect(await storage.commitSanitizedAssetBlob(actor, f.lease, f.sanitized)).toBe(false);
  beforeEncrypt = undefined;
  db.sqlite.query("UPDATE v2_assets SET current_job_id=?").run(jobId);
  db.sqlite.exec(
    "CREATE TRIGGER reject_stored BEFORE UPDATE OF state ON v2_blobs WHEN NEW.visibility='staging' AND NEW.state='stored' BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  );
  const before = snapshot();
  await expect(storage.commitSanitizedAssetBlob(actor, f.lease, f.sanitized)).rejects.toThrow(
    "DB_OPERATION_FAILED",
  );
  expect(snapshot()).toEqual(before);
});
test("abandoned sanitizer intent refunds only after exact current actual deletion receipt", async () => {
  const f = await processing();
  expect(await storage.prepareSanitizedAssetBlob(actor, f.lease, f.sanitized)).toBe(true);
  expect(await storage.abandonSanitizedAssetBlob(stranger, f.sanitized.id)).toBe(false);
  expect(await storage.abandonSanitizedAssetBlob(actor, f.sanitized.id)).toBe(true);
  const journal = await deletion.findByTarget("blob", f.sanitized.id);
  if (!journal) throw new Error("Synthetic journal missing");
  const lease = await deletion.acquire(
    journal.id,
    "cleanup_lease",
    now,
    "2026-10-06T00:01:00.000Z",
  );
  if (!lease) throw new Error("Synthetic cleanup lease missing");
  expect(databaseState()).toEqual({ reserved_bytes: 60, stored_bytes: 100 });
  expect(
    await storage.confirmBlobDeleted(f.sanitized.id, now, {
      lease,
      receiptId: "wrong_receipt",
      objectKey: `private/${f.sanitized.id}`,
      cipherHash: null,
    }),
  ).toBe(false);
  expect(
    await storage.confirmBlobDeleted(f.sanitized.id, now, {
      lease,
      receiptId: "actual_absence",
      objectKey: `private/${f.sanitized.id}`,
      cipherHash: f.sanitized.cipherHash,
    }),
  ).toBe(true);
  expect(databaseState()).toEqual({ reserved_bytes: 0, stored_bytes: 100 });
  expect(await deletion.finish(lease, now)).toBe(true);
});

for (const accountDeleted of [false, true])
  test(`late sanitized PUT preserves exact hashed cleanup generations after account deletion=${accountDeleted}`, async () => {
    const f = await processing();
    expect(await storage.prepareSanitizedAssetBlob(actor, f.lease, f.sanitized)).toBe(true);
    const captured = await storage.captureSanitizedAssetBlobIntent(actor, f.lease, f.sanitized.id);
    if (!captured) throw new Error("Synthetic captured sanitizer intent missing");
    expect(Object.isFrozen(captured)).toBe(true);
    expect(captured.cipherHash).toBe(f.sanitized.cipherHash);
    expect(captured.cipherBytes).toBe(f.sanitized.cipherBytes);
    expect(
      await storage.captureSanitizedAssetBlobIntent(stranger, f.lease, f.sanitized.id),
    ).toBeNull();
    expect(await storage.abandonSanitizedAssetBlob(actor, f.sanitized.id)).toBe(true);
    const journal = await deletion.findByTarget("blob", f.sanitized.id);
    if (!journal) throw new Error("Synthetic journal missing");
    const first = await deletion.acquire(
      journal.id,
      "first_cleanup",
      now,
      "2026-10-06T00:01:00.000Z",
    );
    if (!first) throw new Error("Synthetic first cleanup lease missing");
    if (accountDeleted) {
      tombstone("account", actor.ownerId);
      db.sqlite.query("DELETE FROM user WHERE id=?").run(actor.ownerId);
    }
    const receipt = (lease: typeof first, receiptId: string) => ({
      lease,
      receiptId,
      objectKey: captured.objectKey,
      cipherHash: captured.cipherHash,
    });
    expect(
      await storage.confirmBlobDeleted(f.sanitized.id, now, receipt(first, "first_absence")),
    ).toBe(true);
    expect(await deletion.finish(first, now)).toBe(true);
    const oldHeader = db.sqlite
      .query("SELECT * FROM v2_deletion_journals WHERE id=?")
      .get(journal.id);
    const oldReceipts = db.sqlite.query("SELECT * FROM v2_cleanup_receipts").all();
    const afterDelete = databaseState() as { reserved_bytes: number; stored_bytes: number };
    // Synthetic actual late PUT/HEAD evidence is supplied by the consumer. The
    // repository only requeues cleanup; it never promotes this object to stored.
    expect(await storage.requeueSanitizedAssetBlobCleanup(actor, { ...captured })).toBeNull();
    expect(await storage.requeueSanitizedAssetBlobCleanup(stranger, captured)).toBeNull();
    const next = await storage.requeueSanitizedAssetBlobCleanup(actor, captured);
    if (!next) throw new Error("Synthetic new cleanup generation missing");
    expect(next).not.toBe(journal.id);
    expect(await storage.requeueSanitizedAssetBlobCleanup(actor, captured)).toBe(next);
    expect(databaseState()).toEqual({
      reserved_bytes: afterDelete.reserved_bytes,
      stored_bytes: afterDelete.stored_bytes + 60,
    });
    expect(
      db.sqlite.query("SELECT * FROM v2_deletion_journals WHERE id=?").get(journal.id),
    ).toEqual(oldHeader);
    expect(db.sqlite.query("SELECT * FROM v2_cleanup_receipts").all()).toEqual(oldReceipts);
    expect(
      db.sqlite
        .query("SELECT target_id,state FROM v2_deletion_targets WHERE journal_id=?")
        .get(next),
    ).toEqual({ target_id: f.sanitized.id, state: "pending" });
    expect(
      await storage.confirmBlobDeleted(f.sanitized.id, now, receipt(first, "first_absence")),
    ).toBe(false);
    const current = await deletion.acquire(next, "fresh_cleanup", now, "2026-10-06T00:01:00.000Z");
    if (!current) throw new Error("Synthetic current cleanup lease missing");
    expect(
      await storage.confirmBlobDeleted(f.sanitized.id, now, receipt(current, "first_absence")),
    ).toBe(false);
    expect(
      await storage.confirmBlobDeleted(f.sanitized.id, now, {
        ...receipt(current, "wrong_hash"),
        cipherHash: "e".repeat(64),
      }),
    ).toBe(false);
    expect(
      await storage.confirmBlobDeleted(f.sanitized.id, now, receipt(current, "fresh_absence")),
    ).toBe(true);
    expect(await deletion.finish(current, now)).toBe(true);
    expect(databaseState()).toEqual(afterDelete);
  });

test("sanitizer capture never grants cleanup authority over a committed winner", async () => {
  const f = await processing();
  expect(await storage.prepareSanitizedAssetBlob(actor, f.lease, f.sanitized)).toBe(true);
  const captured = await storage.captureSanitizedAssetBlobIntent(actor, f.lease, f.sanitized.id);
  if (!captured) throw new Error("Synthetic captured intent missing");
  expect(await storage.commitSanitizedAssetBlob(actor, f.lease, f.sanitized)).toBe(true);
  const before = snapshot();
  expect(await storage.captureSanitizedAssetBlobIntent(actor, f.lease, f.sanitized.id)).toBeNull();
  expect(await storage.requeueSanitizedAssetBlobCleanup(actor, captured)).toBeNull();
  expect(await storage.abandonSanitizedAssetBlob(actor, f.sanitized.id)).toBe(false);
  expect(snapshot()).toEqual(before);
});

test("pending sanitizer recovery rejects a replacement original AES envelope with the same relational identity", async () => {
  const f = await processing();
  expect(await storage.prepareSanitizedAssetBlob(actor, f.lease, f.sanitized)).toBe(true);
  const replacement = await core.encrypt("v2_blobs", f.original.id, actor.ownerId, 1, {
    contentHash: "e".repeat(64),
  });
  db.sqlite
    .query("UPDATE v2_blobs SET encrypted_payload=? WHERE id=?")
    .run(replacement, f.original.id);
  expect(await storage.findPendingSanitizedAssetBlob(actor, f.lease, f.sanitized.id)).toBeNull();
  expect(await storage.commitSanitizedAssetBlob(actor, f.lease, f.sanitized)).toBe(false);
  expect(databaseState()).toEqual({ reserved_bytes: 60, stored_bytes: 100 });
});
