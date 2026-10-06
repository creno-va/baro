import { afterEach, beforeEach, expect, test } from "bun:test";
import type { V2LawyerAssetUploadRequest } from "../src/contracts/v2";
import { createEnvelopeCipher, type EncryptionContext } from "../src/server/crypto";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2DeletionRepository } from "../src/server/db/v2-deletion";
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

test("pending intent is not object evidence and actual receipt atomically publishes uploaded asset + stored bytes", async () => {
  await reserve();
  expect(await storage.prepareAssetUpload(actor, intent)).toBe(true);
  expect(db.sqlite.query("SELECT state,cipher_hash,cipher_bytes FROM v2_blobs").get()).toEqual({
    state: "pending",
    cipher_hash: null,
    cipher_bytes: 0,
  });
  expect(await storage.findBlob(actor, blob.id)).toBeNull();
  expect(await lawyers.readAsset(actor, intent.assetId)).toMatchObject({
    request: { purpose: "identity" },
  });
  expect(
    await storage.commitAssetUpload(actor, { assetId: intent.assetId, assetRevision: 1, blob }),
  ).toBe(true);
  expect(await lawyers.readAsset(actor, intent.assetId)).toEqual({
    id: intent.assetId,
    purpose: "identity",
    status: "uploaded",
    byteLength: 100,
    contentHash: blob.contentHash,
  });
  expect(db.sqlite.query("SELECT revision,state,original_blob_id FROM v2_assets").get()).toEqual({
    revision: 2,
    state: "uploaded",
    original_blob_id: blob.id,
  });
  expect(db.sqlite.query("SELECT reserved_bytes,stored_bytes FROM v2_storage_usage").get()).toEqual(
    { reserved_bytes: 0, stored_bytes: 100 },
  );
  expect(db.sqlite.query("SELECT state FROM v2_storage_reservations").get()).toEqual({
    state: "stored",
  });
  expect((await storage.findBlob(actor, blob.id))?.cipher_hash).toBe(blob.cipherHash);
  const before = snapshot();
  expect(
    await storage.commitAssetUpload(actor, { assetId: intent.assetId, assetRevision: 1, blob }),
  ).toBe(false);
  expect(await storage.abandonAssetUpload(actor, blob.id)).toBe(false);
  expect(snapshot()).toEqual(before);
});
for (const purpose of ["profile_photo", "portfolio"] as const)
  test(`${purpose} commit constructs authoritative uploaded DTO without a sanitized or public projection`, async () => {
    await reserve(purpose);
    expect(await storage.prepareAssetUpload(actor, intent)).toBe(true);
    const receipt = {
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
        blob: receipt,
      }),
    ).toBe(true);
    expect(await lawyers.readAsset(actor, intent.assetId)).toEqual({
      id: intent.assetId,
      revision: 2,
      kind: purpose === "profile_photo" ? "image" : "pdf",
      status: "uploaded",
      byteLength: 100,
      originalHash: blob.contentHash,
      sanitizedDerivative: null,
      currentJobId: null,
      failure: null,
    });
    expect(db.sqlite.query("SELECT count(*) AS n FROM v2_public_profiles").get()).toEqual({ n: 0 });
  });
test("foreign owner rejects before any private decryption, and prepare rejects duplicate concurrent intents", async () => {
  await reserve();
  decryptCount = 0;
  expect(await storage.prepareAssetUpload(stranger, intent)).toBe(false);
  expect(
    await storage.commitAssetUpload(stranger, { assetId: intent.assetId, assetRevision: 1, blob }),
  ).toBe(false);
  expect(decryptCount).toBe(0);
  const results = await Promise.all([
    storage.prepareAssetUpload(actor, intent),
    storage.prepareAssetUpload(actor, { ...intent, blobId: "competing_blob" }),
  ]);
  expect(results.filter(Boolean).length).toBe(1);
  expect(db.sqlite.query("SELECT count(*) AS n FROM v2_blobs").get()).toEqual({ n: 1 });
});
test("actual receipt requires prepared exact owner/revision/reservation/purpose/bytes/key and unexpired intent", async () => {
  await reserve();
  expect(
    await storage.commitAssetUpload(actor, { assetId: intent.assetId, assetRevision: 1, blob }),
  ).toBe(false);
  expect(await storage.prepareAssetUpload(actor, intent)).toBe(true);
  const before = snapshot();
  for (const changed of [
    { kind: "portfolio_original" as const },
    { visibility: "staging" as const },
    { logicalBytes: 99 },
    { keyVersion: "binary_v1" },
    { reservationId: "other_reservation" },
    { id: "other_blob" },
  ]) {
    expect(
      await storage.commitAssetUpload(actor, {
        assetId: intent.assetId,
        assetRevision: 1,
        blob: { ...blob, ...changed },
      }),
    ).toBe(false);
  }
  expect(
    await storage.commitAssetUpload(actor, { assetId: intent.assetId, assetRevision: 2, blob }),
  ).toBe(false);
  expect(
    await storage.commitAssetUpload(
      { ...actor, now: "2026-10-06T00:05:00.000Z" },
      { assetId: intent.assetId, assetRevision: 1, blob },
    ),
  ).toBe(false);
  expect(snapshot()).toEqual(before);
});
for (const target of ["account", "profile", "asset"] as const)
  test(`upload ${target} tombstone prevents preparation and commit, including decrypt-await races`, async () => {
    await reserve();
    expect(await storage.prepareAssetUpload(actor, intent)).toBe(true);
    afterDecrypt = () => {
      afterDecrypt = undefined;
      tombstone(
        target,
        target === "account"
          ? actor.ownerId
          : target === "profile"
            ? "profile_synthetic"
            : intent.assetId,
      );
    };
    expect(
      await storage.commitAssetUpload(actor, { assetId: intent.assetId, assetRevision: 1, blob }),
    ).toBe(false);
    expect(db.sqlite.query("SELECT state FROM v2_blobs").get()).toEqual({ state: "pending" });
    expect(
      db.sqlite.query("SELECT reserved_bytes,stored_bytes FROM v2_storage_usage").get(),
    ).toEqual({ reserved_bytes: 100, stored_bytes: 0 });
    afterDecrypt = undefined;
    expect(await storage.prepareAssetUpload(actor, { ...intent, blobId: "late_blob" })).toBe(false);
  });
test("changed same-revision admitted request cannot complete a pending upload", async () => {
  await reserve();
  expect(await storage.prepareAssetUpload(actor, intent)).toBe(true);
  const replacement = await core.encrypt("v2_assets", intent.assetId, actor.ownerId, 1, {
    request: {
      name: "수정 자료",
      purpose: "identity",
      mediaType: "application/pdf",
      byteLength: 100,
    },
  });
  db.sqlite.query("UPDATE v2_assets SET encrypted_payload=?").run(replacement);
  expect(
    await storage.commitAssetUpload(actor, { assetId: intent.assetId, assetRevision: 1, blob }),
  ).toBe(false);
});
test("final receipt publication rechecks request ciphertext after output encryption and rolls back SQL failure atomically", async () => {
  await reserve();
  expect(await storage.prepareAssetUpload(actor, intent)).toBe(true);
  db.sqlite.exec(
    "CREATE TRIGGER fail_asset_storage BEFORE UPDATE OF state ON v2_storage_reservations WHEN NEW.state='stored' BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  );
  const before = snapshot();
  await expect(
    storage.commitAssetUpload(actor, { assetId: intent.assetId, assetRevision: 1, blob }),
  ).rejects.toMatchObject({ code: "DB_OPERATION_FAILED" });
  expect(snapshot()).toEqual(before);
  db.sqlite.exec("DROP TRIGGER fail_asset_storage");
  const replacement = await core.encrypt("v2_assets", intent.assetId, actor.ownerId, 1, {
    request: {
      name: "수정 자료",
      purpose: "identity",
      mediaType: "application/pdf",
      byteLength: 100,
    },
  });
  beforeEncrypt = (context) => {
    if (context.table === "v2_assets")
      db.sqlite.query("UPDATE v2_assets SET encrypted_payload=?").run(replacement);
  };
  expect(
    await storage.commitAssetUpload(actor, { assetId: intent.assetId, assetRevision: 1, blob }),
  ).toBe(false);
  expect(db.sqlite.query("SELECT state FROM v2_blobs").get()).toEqual({ state: "pending" });
});
test("unknown-hash pending cleanup requires current actual receipt and preserves live asset reservation for retry", async () => {
  await reserve();
  expect(await storage.prepareAssetUpload(actor, intent)).toBe(true);
  expect(await storage.abandonAssetUpload(stranger, blob.id)).toBe(false);
  expect(await storage.abandonAssetUpload(actor, blob.id)).toBe(true);
  const journal = await deletion.findByTarget("blob", blob.id);
  if (!journal) throw new Error("Synthetic journal missing");
  const lease = await deletion.acquire(
    journal.id,
    "lease_synthetic",
    now,
    "2026-10-06T00:01:00.000Z",
  );
  if (!lease) throw new Error("Synthetic lease missing");
  expect(
    await storage.confirmBlobDeleted(blob.id, now, {
      lease,
      receiptId: "wrong_hash_receipt",
      objectKey: `private/${blob.id}`,
      cipherHash: blob.cipherHash,
    }),
  ).toBe(false);
  expect(
    await storage.confirmBlobDeleted(blob.id, now, {
      lease,
      receiptId: "actual_absence_receipt",
      objectKey: `private/${blob.id}`,
      cipherHash: null,
    }),
  ).toBe(true);
  expect(db.sqlite.query("SELECT reserved_bytes,stored_bytes FROM v2_storage_usage").get()).toEqual(
    { reserved_bytes: 100, stored_bytes: 0 },
  );
  expect(db.sqlite.query("SELECT state FROM v2_storage_reservations").get()).toEqual({
    state: "reserved",
  });
  expect(await storage.prepareAssetUpload(actor, { ...intent, blobId: "retry_blob" })).toBe(true);
  expect(
    await storage.commitAssetUpload(actor, {
      assetId: intent.assetId,
      assetRevision: 1,
      blob: { ...blob, id: "retry_blob" },
    }),
  ).toBe(true);
});
test("concurrent actual receipt publication has exactly one winner and one storage transfer", async () => {
  await reserve();
  expect(await storage.prepareAssetUpload(actor, intent)).toBe(true);
  const results = await Promise.all([
    storage.commitAssetUpload(actor, { assetId: intent.assetId, assetRevision: 1, blob }),
    storage.commitAssetUpload(actor, { assetId: intent.assetId, assetRevision: 1, blob }),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(db.sqlite.query("SELECT reserved_bytes,stored_bytes FROM v2_storage_usage").get()).toEqual(
    { reserved_bytes: 0, stored_bytes: 100 },
  );
  expect(db.sqlite.query("SELECT count(*) AS n FROM v2_mutation_claims").get()).toEqual({ n: 0 });
});
test("cancelled admission and profile deletion during intent encryption cannot leave a new pending object reference", async () => {
  await reserve();
  db.sqlite.query("UPDATE v2_operations SET state='cancelled'").run();
  expect(await storage.prepareAssetUpload(actor, intent)).toBe(false);
  db.sqlite.query("UPDATE v2_operations SET state='admitted'").run();
  beforeEncrypt = (context) => {
    if (context.table === "v2_blobs") tombstone("profile", "profile_synthetic");
  };
  expect(await storage.prepareAssetUpload(actor, intent)).toBe(false);
  expect(db.sqlite.query("SELECT count(*) AS n FROM v2_blobs").get()).toEqual({ n: 0 });
});
test("deleted asset nullable intent cleanup releases storage only after identity-bound receipt", async () => {
  await reserve();
  expect(await storage.prepareAssetUpload(actor, intent)).toBe(true);
  expect(await deletion.asset(actor, intent.assetId, 1)).toBe(true);
  const journal = await deletion.findByTarget("asset", intent.assetId);
  if (!journal) throw new Error("Synthetic journal missing");
  const lease = await deletion.acquire(
    journal.id,
    "lease_synthetic",
    now,
    "2026-10-06T00:01:00.000Z",
  );
  if (!lease) throw new Error("Synthetic lease missing");
  expect(db.sqlite.query("SELECT reserved_bytes FROM v2_storage_usage").get()).toEqual({
    reserved_bytes: 100,
  });
  expect(
    await storage.confirmBlobDeleted(blob.id, now, {
      lease,
      receiptId: "wrong_key_receipt",
      objectKey: "private/foreign_blob",
      cipherHash: null,
    }),
  ).toBe(false);
  expect(
    await storage.confirmBlobDeleted(blob.id, now, {
      lease,
      receiptId: "actual_deleted_receipt",
      objectKey: `private/${blob.id}`,
      cipherHash: null,
    }),
  ).toBe(true);
  expect(db.sqlite.query("SELECT reserved_bytes,stored_bytes FROM v2_storage_usage").get()).toEqual(
    { reserved_bytes: 0, stored_bytes: 0 },
  );
});
