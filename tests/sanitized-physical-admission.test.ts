import { afterEach, expect, test } from "bun:test";
import { createEnvelopeCipher, type EncryptionContext } from "../src/server/crypto";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createV2LawyersRepository } from "../src/server/db/v2-lawyers";
import { type BlobRegistration, createV2StorageRepository } from "../src/server/db/v2-storage";
import { createV2StorageCapacityRepository } from "../src/server/db/v2-storage-capacity";
import { createTestDatabase } from "./helpers/d1";

const NOW = "2026-10-14T00:00:00.000Z";
const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) {
    expect(db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  }
});

async function fixture(purpose: "profile_photo" | "portfolio" = "profile_photo", limit = 396) {
  const db = await createTestDatabase();
  databases.push(db);
  const actor = { ownerId: crypto.randomUUID(), now: NOW };
  const cipher = await createEnvelopeCipher({
    activeKeyId: "synthetic",
    keys: { synthetic: btoa("s".repeat(32)).replace(/=+$/, "") },
  });
  let beforeEncrypt: ((context: EncryptionContext) => void) | undefined;
  const core = createV2Core(
    db.binding,
    {
      encrypt(value, context) {
        beforeEncrypt?.(context);
        return cipher.encrypt(value, context);
      },
      decrypt: cipher.decrypt.bind(cipher),
    },
    { applicationCostLimitsEnabled: false },
  );
  const storage = createV2StorageRepository(core);
  const capacity = createV2StorageCapacityRepository(core, "preview");
  const lawyers = createV2LawyersRepository(core);
  const profileId = crypto.randomUUID(),
    assetId = crypto.randomUUID(),
    jobId = crypto.randomUUID();
  db.sqlite
    .query("INSERT INTO user(id,name,email,created_at,updated_at) VALUES(?,?,?,?,?)")
    .run(
      actor.ownerId,
      "Synthetic",
      `${actor.ownerId}@invalid.test`,
      Date.parse(NOW),
      Date.parse(NOW),
    );
  expect(await lawyers.createProfile(actor, profileId)).toBe(true);
  const original: BlobRegistration = {
    id: crypto.randomUUID(),
    reservationId: crypto.randomUUID(),
    kind: purpose === "profile_photo" ? "profile_photo_original" : "portfolio_original",
    visibility: "private",
    logicalBytes: 100,
    cipherBytes: 320,
    cipherHash: "a".repeat(64),
    contentHash: "b".repeat(64),
    keyVersion: "asset_binary_v1",
  };
  expect(
    await lawyers.reserveAsset(
      actor,
      profileId,
      1,
      assetId,
      {
        purpose,
        name: "합성 자료",
        byteLength: 100,
        mediaType: purpose === "profile_photo" ? "image/png" : "application/pdf",
      },
      original.reservationId,
      {
        operationId: crypto.randomUUID(),
        key: crypto.randomUUID(),
        requestHash: "c".repeat(64),
      },
    ),
  ).toBe(true);
  expect(
    await storage.prepareAssetUpload(actor, {
      assetId,
      assetRevision: 1,
      blobId: original.id,
      reservationId: original.reservationId,
      keyVersion: "asset_binary_v1",
    }),
  ).toBe(true);
  expect(
    await storage.commitAssetUpload(actor, { assetId, assetRevision: 1, blob: original }),
  ).toBe(true);
  // Preserve a historical source object and its actual physical inventory row.
  db.sqlite
    .query(
      "INSERT INTO v2_physical_storage_capacity(environment,capacity_bytes) VALUES('preview',?)",
    )
    .run(limit);
  db.sqlite
    .query(
      "INSERT INTO v2_physical_blob_bindings(blob_id,environment,owner_id,object_key,maximum_cipher_bytes,state,inventory_hash,created_at,writer_state) VALUES(?,'preview',?,?,320,'held',?,?,'stopped')",
    )
    .run(original.id, actor.ownerId, `private/${original.id}`, "d".repeat(64), NOW);
  // Seed the existing DAL job fixture through its legacy no-hold admission;
  // runtime admission itself is covered separately by the actual-runtime suite.
  const jobs = createV2JobsRepository(createV2Core(db.binding, cipher));
  expect(await jobs.admitAsset(actor, { assetId, assetRevision: 2, jobId })).toBe(true);
  const acquired = await jobs.acquire(
    actor,
    jobId,
    crypto.randomUUID(),
    "2026-10-14T00:04:00.000Z",
  );
  if (!acquired) throw new Error("Synthetic sanitizer lease missing");
  const blob: BlobRegistration = {
    id: crypto.randomUUID(),
    reservationId: crypto.randomUUID(),
    kind: purpose === "profile_photo" ? "profile_photo_sanitized" : "portfolio_sanitized",
    visibility: "staging",
    logicalBytes: 60,
    cipherBytes: 76,
    cipherHash: "e".repeat(64),
    contentHash: "f".repeat(64),
    keyVersion: "asset_sanitized_v1",
  };
  const physical = (b = blob) =>
    capacity.prepareCapacity(actor, {
      ownerId: actor.ownerId,
      blobId: b.id,
      objectKey: `private/${b.id}`,
      maximumCipherBytes: b.cipherBytes,
    });
  const prepare = (b = blob) =>
    storage.prepareSanitizedAssetBlob(actor, acquired.lease, b, physical(b));
  return {
    db,
    actor,
    core,
    cipher,
    storage,
    capacity,
    original,
    blob,
    lease: acquired.lease,
    physical,
    prepare,
    beforeEncrypt(callback: (context: EncryptionContext) => void) {
      beforeEncrypt = callback;
    },
  };
}

for (const purpose of ["profile_photo", "portfolio"] as const)
  test(`${purpose} sanitized admission reserves exact physical and logical bytes atomically without financial metadata`, async () => {
    const f = await fixture(purpose);
    const original = f.db.sqlite.query("SELECT * FROM v2_blobs WHERE id=?").get(f.original.id);
    const inventory = f.db.sqlite
      .query("SELECT * FROM v2_physical_blob_bindings WHERE blob_id=?")
      .get(f.original.id);
    expect(await f.prepare()).toBe(true);
    expect(
      f.db.sqlite
        .query("SELECT held_bytes FROM v2_physical_storage_capacity WHERE environment='preview'")
        .get(),
    ).toEqual({ held_bytes: 396 });
    expect(
      f.db.sqlite.query("SELECT reserved_bytes,stored_bytes FROM v2_storage_usage").get(),
    ).toEqual({ reserved_bytes: 60, stored_bytes: 100 });
    expect(
      f.db.sqlite
        .query(
          "SELECT writer_state,maximum_cipher_bytes,state FROM v2_physical_blob_bindings WHERE blob_id=?",
        )
        .get(f.blob.id),
    ).toEqual({ writer_state: "prepared", maximum_cipher_bytes: 76, state: "held" });
    expect(
      f.db.sqlite
        .query("SELECT * FROM v2_storage_integrity_faults WHERE environment='preview'")
        .all(),
    ).toEqual([]);
    for (const table of [
      "v2_runtime_proofs",
      "v2_cost_attempts",
      "v2_cost_quotes",
      "v2_storage_projections",
    ])
      expect(f.db.sqlite.query(`SELECT * FROM ${table}`).all()).toEqual([]);
    expect(f.db.sqlite.query("SELECT * FROM v2_blobs WHERE id=?").get(f.original.id)).toEqual(
      original,
    );
    expect(
      f.db.sqlite
        .query("SELECT * FROM v2_physical_blob_bindings WHERE blob_id=?")
        .get(f.original.id),
    ).toEqual(inventory);
  });

test("sanitized physical admission rejects forged or mismatched capabilities without mutation", async () => {
  const f = await fixture();
  const token = f.physical();
  const before = f.db.sqlite.serialize();
  const stranger = { ...f.actor, ownerId: crypto.randomUUID() };
  const wrongOwner = f.capacity.prepareCapacity(stranger, {
    ...token.binding,
    ownerId: stranger.ownerId,
  });
  for (const physical of [
    { ...token },
    wrongOwner,
    f.capacity.prepareCapacity(f.actor, { ...token.binding, blobId: crypto.randomUUID() }),
    f.capacity.prepareCapacity(f.actor, { ...token.binding, objectKey: "public/wrong" }),
    f.capacity.prepareCapacity(f.actor, { ...token.binding, maximumCipherBytes: 75 }),
    f.capacity.prepareCapacity(f.actor, { ...token.binding, maximumCipherBytes: 77 }),
  ])
    expect(await f.storage.prepareSanitizedAssetBlob(f.actor, f.lease, f.blob, physical)).toBe(
      false,
    );
  const anotherCore = createV2Core(f.db.binding, f.cipher, { applicationCostLimitsEnabled: false });
  const foreign = createV2StorageCapacityRepository(anotherCore, "preview").prepareCapacity(
    f.actor,
    token.binding,
  );
  await expect(
    f.storage.prepareSanitizedAssetBlob(f.actor, f.lease, f.blob, foreign),
  ).rejects.toThrow("DB_OPERATION_FAILED");
  expect(f.db.sqlite.serialize()).toEqual(before);
});

test("sanitized physical and logical ceilings remain independent and concurrent last-slot admissions have one winner", async () => {
  const f = await fixture("profile_photo", 395);
  let before = f.db.sqlite.serialize();
  expect(await f.prepare()).toBe(false);
  expect(f.db.sqlite.serialize()).toEqual(before);
  f.db.sqlite.exec(
    "UPDATE v2_physical_storage_capacity SET capacity_bytes=396 WHERE environment='preview'",
  );
  f.db.sqlite.exec("UPDATE v2_storage_usage SET stored_bytes=9999999941");
  before = f.db.sqlite.serialize();
  expect(await f.prepare()).toBe(false);
  expect(f.db.sqlite.serialize()).toEqual(before);
  f.db.sqlite.exec("UPDATE v2_storage_usage SET stored_bytes=100");
  const other = { ...f.blob, id: crypto.randomUUID(), reservationId: crypto.randomUUID() };
  expect((await Promise.all([f.prepare(), f.prepare(other)])).filter(Boolean)).toHaveLength(1);
  expect(
    f.db.sqlite.query("SELECT count(*) AS n FROM v2_blobs WHERE visibility='staging'").get(),
  ).toEqual({ n: 1 });
  expect(
    f.db.sqlite
      .query("SELECT held_bytes FROM v2_physical_storage_capacity WHERE environment='preview'")
      .get(),
  ).toEqual({ held_bytes: 396 });
});

test("a late physical binding failure rolls back the pending blob, logical reservation, policy and capacity together", async () => {
  const f = await fixture();
  f.db.sqlite.exec(
    "CREATE TRIGGER synthetic_binding_failure BEFORE INSERT ON v2_physical_blob_bindings WHEN NEW.inventory_hash IS NULL BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  );
  const before = f.db.sqlite.serialize();
  await expect(f.prepare()).rejects.toThrow("DB_OPERATION_FAILED");
  expect(f.db.sqlite.serialize()).toEqual(before);
  f.db.sqlite.exec("DROP TRIGGER synthetic_binding_failure");
  expect(await f.prepare()).toBe(true);
  const committed = f.db.sqlite.serialize();
  expect(await f.prepare()).toBe(false);
  expect(f.db.sqlite.serialize()).toEqual(committed);
});

test("sanitized commit requires an exact stopped writer and preserves held capacity after storage", async () => {
  const f = await fixture();
  expect(await f.prepare()).toBe(true);
  const commit = () => f.storage.commitSanitizedAssetBlob(f.actor, f.lease, f.blob);
  let before = f.db.sqlite.serialize();
  expect(await commit()).toBe(false);
  expect(f.db.sqlite.serialize()).toEqual(before);
  const permit = f.capacity.prepareWrite({
    blobId: f.blob.id,
    objectKey: `private/${f.blob.id}`,
    byteLength: 76,
  });
  expect(await f.capacity.beginPreparedWrite(permit, NOW)).toBe(true);
  before = f.db.sqlite.serialize();
  expect(await commit()).toBe(false);
  expect(f.db.sqlite.serialize()).toEqual(before);
  expect(
    await f.capacity.confirmWriterStopped(
      { ...permit },
      { transport: "response", objectKey: permit.objectKey, byteLength: 76 },
      NOW,
    ),
  ).toBe(false);
  expect(
    await f.capacity.confirmWriterStopped(
      permit,
      { transport: "response", objectKey: permit.objectKey, byteLength: 75 },
      NOW,
    ),
  ).toBe(false);
  expect(await commit()).toBe(false);
  expect(
    await f.capacity.confirmWriterStopped(
      permit,
      { transport: "response", objectKey: permit.objectKey, byteLength: 76 },
      NOW,
    ),
  ).toBe(true);
  expect(
    await f.storage.commitSanitizedAssetBlob(f.actor, f.lease, {
      ...f.blob,
      cipherHash: "0".repeat(64),
    }),
  ).toBe(false);
  expect(await commit()).toBe(true);
  expect(await commit()).toBe(false);
  expect(
    f.db.sqlite.query("SELECT reserved_bytes,stored_bytes FROM v2_storage_usage").get(),
  ).toEqual({ reserved_bytes: 0, stored_bytes: 160 });
  expect(
    f.db.sqlite
      .query("SELECT held_bytes FROM v2_physical_storage_capacity WHERE environment='preview'")
      .get(),
  ).toEqual({ held_bytes: 396 });
  expect(
    f.db.sqlite
      .query(
        "SELECT state,writer_state,expected_cipher_bytes FROM v2_physical_blob_bindings WHERE blob_id=?",
      )
      .get(f.blob.id),
  ).toEqual({ state: "held", writer_state: "stopped", expected_cipher_bytes: 76 });
});

test("writer and source guards remain transactional across commit encryption", async () => {
  const f = await fixture();
  expect(await f.prepare()).toBe(true);
  const permit = await f.capacity.beginWrite(f.blob.id, 76, NOW);
  if (!permit) throw new Error("Synthetic writer missing");
  expect(
    await f.capacity.confirmWriterStopped(
      permit,
      { transport: "response", objectKey: permit.objectKey, byteLength: 76 },
      NOW,
    ),
  ).toBe(true);
  f.beforeEncrypt((context) => {
    if (context.table === "v2_blobs")
      f.db.sqlite.query("UPDATE v2_blobs SET state='deleting' WHERE id=?").run(f.original.id);
  });
  expect(await f.storage.commitSanitizedAssetBlob(f.actor, f.lease, f.blob)).toBe(false);
  expect(f.db.sqlite.query("SELECT state FROM v2_blobs WHERE id=?").get(f.blob.id)).toEqual({
    state: "pending",
  });
  expect(
    f.db.sqlite.query("SELECT reserved_bytes,stored_bytes FROM v2_storage_usage").get(),
  ).toEqual({ reserved_bytes: 60, stored_bytes: 100 });
});

test("a stopped writer with a different recorded size cannot publish the pending sanitized tuple", async () => {
  const f = await fixture();
  expect(await f.prepare()).toBe(true);
  // Seed the valid historical writer transitions directly to exercise the DAL
  // guard independently of the capacity API's own exact-size validation.
  f.db.sqlite
    .query(
      "UPDATE v2_physical_blob_bindings SET writer_state='running',writer_token='synthetic-short-writer',expected_cipher_bytes=75 WHERE blob_id=?",
    )
    .run(f.blob.id);
  f.db.sqlite
    .query("UPDATE v2_physical_blob_bindings SET writer_state='stopped' WHERE blob_id=?")
    .run(f.blob.id);
  const before = f.db.sqlite.serialize();
  expect(await f.storage.commitSanitizedAssetBlob(f.actor, f.lease, f.blob)).toBe(false);
  expect(f.db.sqlite.serialize()).toEqual(before);
});

test("failed sanitized commit preserves the stopped writer and exact reserved bytes for recovery", async () => {
  const f = await fixture();
  expect(await f.prepare()).toBe(true);
  const permit = await f.capacity.beginWrite(f.blob.id, 76, NOW);
  if (!permit) throw new Error("Synthetic writer missing");
  expect(
    await f.capacity.confirmWriterStopped(
      permit,
      { transport: "response", objectKey: permit.objectKey, byteLength: 76 },
      NOW,
    ),
  ).toBe(true);
  f.db.sqlite.exec(
    "CREATE TRIGGER synthetic_commit_failure BEFORE UPDATE OF state ON v2_storage_reservations WHEN NEW.state='stored' BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  );
  const before = f.db.sqlite.serialize();
  await expect(f.storage.commitSanitizedAssetBlob(f.actor, f.lease, f.blob)).rejects.toThrow(
    "DB_OPERATION_FAILED",
  );
  expect(f.db.sqlite.serialize()).toEqual(before);
  f.db.sqlite.exec("DROP TRIGGER synthetic_commit_failure");
  expect(await f.storage.commitSanitizedAssetBlob(f.actor, f.lease, f.blob)).toBe(true);
});

test("legacy unbound pending sanitizer recovery retains its existing exact source and lease contract", async () => {
  const f = await fixture();
  expect(await f.storage.prepareSanitizedAssetBlob(f.actor, f.lease, f.blob)).toBe(true);
  expect(
    f.db.sqlite.query("SELECT * FROM v2_physical_blob_bindings WHERE blob_id=?").all(f.blob.id),
  ).toEqual([]);
  expect(
    await f.storage.commitSanitizedAssetBlob(f.actor, { ...f.lease, fencing: 99 }, f.blob),
  ).toBe(false);
  expect(await f.storage.commitSanitizedAssetBlob(f.actor, f.lease, f.blob)).toBe(true);
});
