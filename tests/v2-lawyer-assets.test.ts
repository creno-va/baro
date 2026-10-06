import { afterEach, expect, test } from "bun:test";
import { sha256 } from "@noble/hashes/sha2.js";
import { V2_LIMITS } from "../src/contracts/v2";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2DeletionRepository } from "../src/server/db/v2-deletion";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createV2LawyersRepository } from "../src/server/db/v2-lawyers";
import { createV2StorageRepository } from "../src/server/db/v2-storage";
import { hex } from "../src/server/modules/files/binary";
import {
  type AssetIdentity,
  decryptAssetBinary,
  prepareAssetBinary,
} from "../src/server/modules/lawyers/asset-binary";
import { createLawyerAssetsService } from "../src/server/modules/lawyers/assets";
import { createLawyersService } from "../src/server/modules/lawyers/service";
import { createModerationService } from "../src/server/modules/moderation/service";
import { application } from "./fixtures/contracts/v2";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
const fixed = (length: number) => {
  let size = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(v, c) {
      size += v.length;
      if (size > length) throw new Error("Fixed length exceeded");
      c.enqueue(v);
    },
    flush() {
      if (size !== length) throw new Error("Fixed length incomplete");
    },
  });
};
const stream = (bytes: Uint8Array, width = 65536) => {
  let at = 0;
  return new ReadableStream<Uint8Array>(
    {
      pull(c) {
        if (at === bytes.length) {
          c.close();
          return;
        }
        const end = Math.min(at + width, bytes.length);
        c.enqueue(bytes.slice(at, end));
        at = end;
      },
    },
    { highWaterMark: 0 },
  );
};
async function fixture() {
  const db = await createTestDatabase();
  databases.push(db);
  const owner = await seedTestSession(db, { consent: true });
  const other = await seedTestSession(db, { consent: true });
  const cipher = await createCaseDataCipher({
    ...owner.env,
    CASE_DATA_KEY_V1: btoa("k".repeat(32)).replace(/=+$/, ""),
  });
  const core = createV2Core(db.binding, cipher);
  const repository = createV2LawyersRepository(core);
  const objects = new Map<string, Uint8Array>();
  let badReceipt = false;
  let rejectedPut = false;
  let onPut: (() => void) | null = null;
  let beforeStore: (() => Promise<void>) | null = null;
  const bucket = {
    async put(key: string, value: ReadableStream<Uint8Array>) {
      if (rejectedPut) throw new Error("Synthetic R2 transport failure");
      const data = new Uint8Array(await new Response(value).arrayBuffer());
      await beforeStore?.();
      objects.set(key, data);
      onPut?.();
      return { key, size: badReceipt ? data.length + 1 : data.length };
    },
    async get(key: string) {
      const data = objects.get(key);
      return data ? { key, size: data.length, body: stream(data) } : null;
    },
    async head(key: string) {
      const data = objects.get(key);
      return data ? { key, size: data.length } : null;
    },
    async delete(key: string) {
      objects.delete(key);
    },
  } as unknown as Pick<R2Bucket, "get" | "put" | "head" | "delete">;
  const profileId = crypto.randomUUID();
  expect(
    await repository.createProfile(
      { ownerId: owner.userId, now: new Date().toISOString() },
      profileId,
    ),
  ).toBe(true);
  const service = createLawyerAssetsService(core, {
    environment: "preview",
    bucket,
    testOnlyUnmeteredStorage: true,
    fixedLengthStream: fixed,
  });
  return {
    db,
    owner,
    other,
    cipher,
    core,
    repository,
    objects,
    bucket,
    service,
    profileId,
    setBad: () => {
      badReceipt = true;
    },
    setRejectedPut: () => {
      rejectedPut = true;
    },
    putHook: (fn: () => void) => {
      onPut = fn;
    },
    beforeStore: (fn: () => Promise<void>) => {
      beforeStore = fn;
    },
  };
}
test("original assets use real AES framed stream and atomic receipt/counters, never client ready", async () => {
  const f = await fixture();
  const bytes = new TextEncoder().encode("Synthetic identity image bytes");
  const input = {
    name: "private_신분증.png",
    byteLength: bytes.length,
    mediaType: "image/png",
    purpose: "identity",
  };
  const reserved = await f.service.reserve(
    f.owner.userId,
    1,
    "synthetic_asset_key_001",
    input,
    "verification",
  );
  const replay = await f.service.reserve(
    f.owner.userId,
    1,
    "synthetic_asset_key_001",
    input,
    "verification",
  );
  expect(replay.assetId).toBe(reserved.assetId);
  const uploaded = await f.service.upload(
    f.owner.userId,
    reserved.assetId,
    1,
    bytes.length,
    stream(bytes),
  );
  expect(uploaded.revision).toBe(2);
  expect(uploaded.value).toMatchObject({ status: "uploaded", contentHash: hex(sha256(bytes)) });
  expect(uploaded.processingQueued).toBe(false);
  const stored = [...f.objects.values()][0];
  expect(stored).toBeDefined();
  expect(new TextDecoder().decode(stored)).not.toContain(input.name);
  expect(new TextDecoder().decode(stored)).not.toContain("Synthetic identity");
  const download = await f.service.open(f.owner.userId, reserved.assetId);
  expect(download.contentHash).toBe(hex(sha256(bytes)));
  expect(new Uint8Array(await new Response(download.body).arrayBuffer())).toEqual(bytes);
  const originalInput = {
    ownerId: f.owner.userId,
    profileId: f.profileId,
    assetId: reserved.assetId,
    assetRevision: 2,
  };
  const processingOriginal = await f.service.openOriginal(originalInput);
  expect(processingOriginal.contentHash).toBe(hex(sha256(bytes)));
  expect(new Uint8Array(await new Response(processingOriginal.body).arrayBuffer())).toEqual(bytes);
  await expect(
    f.service.openOriginal({ ...originalInput, profileId: crypto.randomUUID() }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    f.service.openOriginal({ ...originalInput, assetRevision: 1 }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  let leaseAlive = true;
  const guarded = await f.service.openOriginal(originalInput, async () => leaseAlive);
  leaseAlive = false;
  await expect(new Response(guarded.body).arrayBuffer()).rejects.toMatchObject({
    message: "INVALID_ASSET_BINARY",
  });
  await expect(f.service.open(f.other.userId, reserved.assetId)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(
    f.service.upload(f.owner.userId, reserved.assetId, 1, bytes.length, stream(bytes)),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  const usage = f.db.sqlite.query("SELECT stored_bytes,reserved_bytes FROM v2_storage_usage").get();
  expect(usage).toEqual({ stored_bytes: bytes.length, reserved_bytes: 0 });
  await expect(
    f.service.reserve(
      f.owner.userId,
      1,
      "synthetic_asset_key_001",
      { ...input, byteLength: bytes.length + 1 },
      "verification",
    ),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
});
test("missing trusted funding, owner/revision and exact length reject before body read", async () => {
  const f = await fixture();
  const input = {
    name: "synthetic.png",
    byteLength: 20,
    mediaType: "image/png",
    purpose: "profile_photo",
  };
  const closed = createLawyerAssetsService(f.core, {
    environment: "preview",
    bucket: f.bucket,
    fixedLengthStream: fixed,
  });
  await expect(
    closed.reserve(f.owner.userId, 1, "synthetic_missing_funding", input, "portfolio"),
  ).rejects.toMatchObject({ code: "PROCESSING_UNAVAILABLE" });
  const r = await f.service.reserve(
    f.owner.userId,
    1,
    "synthetic_asset_bounds",
    input,
    "portfolio",
  );
  let pulls = 0;
  const body = () =>
    new ReadableStream<Uint8Array>(
      {
        pull(c) {
          pulls++;
          c.enqueue(new Uint8Array(20));
          c.close();
        },
      },
      { highWaterMark: 0 },
    );
  await expect(f.service.upload(f.other.userId, r.assetId, 1, 20, body())).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(f.service.upload(f.owner.userId, r.assetId, 2, 20, body())).rejects.toMatchObject({
    code: "STALE_REVISION",
  });
  await expect(f.service.upload(f.owner.userId, r.assetId, 1, 21, body())).rejects.toMatchObject({
    code: "ASSET_NOT_READY",
  });
  expect(pulls).toBe(0);
});
test("concurrent same idempotency key reserves one asset and replays the committed winner", async () => {
  const f = await fixture();
  const request = {
    name: "synthetic.png",
    byteLength: 100,
    mediaType: "image/png",
    purpose: "identity",
  };
  const results = await Promise.all(
    [1, 2].map(() =>
      f.service.reserve(f.owner.userId, 1, "synthetic_same_key_race", request, "verification"),
    ),
  );
  expect(results[0]?.assetId).toBe(results[1]?.assetId);
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_assets").get()).toEqual({ n: 1 });
  expect(f.db.sqlite.query("SELECT reserved_bytes FROM v2_storage_usage").get()).toEqual({
    reserved_bytes: 100,
  });
});
test("R2 rejection before consuming ciphertext aborts producer and leaves durable pending cleanup", async () => {
  const f = await fixture();
  const r = await f.service.reserve(
    f.owner.userId,
    1,
    "synthetic_transport_failure",
    { name: "😀".repeat(255), byteLength: 100, mediaType: "image/png", purpose: "identity" },
    "verification",
  );
  f.setRejectedPut();
  await expect(
    f.service.upload(f.owner.userId, r.assetId, 1, 100, stream(new Uint8Array(100))),
  ).rejects.toThrow();
  expect(
    f.db.sqlite.query("SELECT state,original_blob_id FROM v2_assets WHERE id=?").get(r.assetId),
  ).toEqual({ state: "reserved", original_blob_id: null });
  expect(f.db.sqlite.query("SELECT state,cipher_hash FROM v2_blobs").get()).toEqual({
    state: "deleting",
    cipher_hash: null,
  });
}, 5000);
test("actual admitted and acquired sanitizer reads the scoped original while its lease remains current", async () => {
  const f = await fixture();
  const bytes = new Uint8Array([255, 216, 255, 217]);
  const reserved = await f.service.reserve(
    f.owner.userId,
    1,
    "synthetic_sanitizer_original",
    {
      name: "synthetic.jpeg",
      byteLength: bytes.length,
      mediaType: "image/jpeg",
      purpose: "profile_photo",
    },
    "portfolio",
  );
  await f.service.upload(f.owner.userId, reserved.assetId, 1, bytes.length, stream(bytes));
  const jobs = createV2JobsRepository(f.core),
    now = new Date().toISOString(),
    jobId = crypto.randomUUID();
  const actor = { ownerId: f.owner.userId, now };
  expect(await jobs.admitAsset(actor, { assetId: reserved.assetId, assetRevision: 2, jobId })).toBe(
    true,
  );
  const acquired = await jobs.acquire(
    actor,
    jobId,
    crypto.randomUUID(),
    new Date(Date.parse(now) + 60000).toISOString(),
  );
  if (!acquired) throw new Error("Actual synthetic sanitizer lease required");
  expect(f.db.sqlite.query("SELECT state FROM v2_assets WHERE id=?").get(reserved.assetId)).toEqual(
    { state: "sanitizing" },
  );
  const authorized = async () =>
    !!(await f.core
      .statement(
        "SELECT id FROM v2_jobs WHERE id=? AND lease_token=? AND fencing=? AND status IN ('running','validating') AND lease_until>?",
        [jobId, acquired.lease.token, acquired.lease.fencing, new Date().toISOString()],
      )
      .first());
  const input = {
    ownerId: f.owner.userId,
    profileId: f.profileId,
    assetId: reserved.assetId,
    assetRevision: 2,
  };
  const original = await f.service.openOriginal(input, authorized);
  expect(original.contentHash).toBe(hex(sha256(bytes)));
  expect(new Uint8Array(await new Response(original.body).arrayBuffer())).toEqual(bytes);
  const stale = await f.service.openOriginal(input, authorized);
  f.db.sqlite.query("UPDATE v2_jobs SET fencing=fencing+1 WHERE id=?").run(jobId);
  await expect(new Response(stale.body).arrayBuffer()).rejects.toThrow("INVALID_ASSET_BINARY");
  await expect(f.service.openOriginal(input, authorized)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});
test("late PUT after completed cleanup uses captured intent to create a new durable cleanup generation", async () => {
  const f = await fixture();
  const storage = createV2StorageRepository(f.core);
  const deletion = createV2DeletionRepository(f.core);
  const r = await f.service.reserve(
    f.owner.userId,
    1,
    "synthetic_late_put_generation",
    { name: "synthetic.png", byteLength: 20, mediaType: "image/png", purpose: "identity" },
    "verification",
  );
  let oldJournal = "";
  let blobId = "";
  f.beforeStore(async () => {
    const row = f.db.sqlite.query("SELECT id FROM v2_blobs WHERE state='pending'").get() as {
      id: string;
    };
    blobId = row.id;
    const time = new Date().toISOString();
    expect(await storage.abandonAssetUpload({ ownerId: f.owner.userId, now: time }, blobId)).toBe(
      true,
    );
    const journal = await deletion.findByTarget("blob", blobId);
    if (!journal) throw new Error("Synthetic cleanup journal required");
    oldJournal = journal.id;
    const lease = await deletion.acquire(
      journal.id,
      crypto.randomUUID(),
      time,
      new Date(Date.parse(time) + 60000).toISOString(),
    );
    if (!lease) throw new Error("Synthetic current lease required");
    await f.bucket.delete(`private/${blobId}`);
    expect(await f.bucket.head(`private/${blobId}`)).toBeNull();
    expect(
      await storage.confirmBlobDeleted(blobId, time, {
        lease,
        receiptId: crypto.randomUUID(),
        objectKey: `private/${blobId}`,
        cipherHash: null,
      }),
    ).toBe(true);
    expect(await deletion.finish(lease, time)).toBe(true);
  });
  await expect(
    f.service.upload(f.owner.userId, r.assetId, 1, 20, stream(new Uint8Array(20))),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect(f.objects.has(`private/${blobId}`)).toBe(true);
  expect(f.db.sqlite.query("SELECT state FROM v2_blobs WHERE id=?").get(blobId)).toEqual({
    state: "deleting",
  });
  const time = new Date().toISOString();
  const pending = await deletion.pending(time, 20);
  expect(pending).toHaveLength(1);
  const newJournal = pending[0];
  if (!newJournal) throw new Error("Fresh generation required");
  expect(newJournal.id).not.toBe(oldJournal);
  expect(
    f.db.sqlite
      .query("SELECT count(*) AS n FROM v2_cleanup_receipts WHERE journal_id=?")
      .get(oldJournal),
  ).toEqual({ n: 1 });
  const lease = await deletion.acquire(
    newJournal.id,
    crypto.randomUUID(),
    time,
    new Date(Date.parse(time) + 60000).toISOString(),
  );
  if (!lease) throw new Error("Fresh generation lease required");
  await f.bucket.delete(`private/${blobId}`);
  expect(await f.bucket.head(`private/${blobId}`)).toBeNull();
  expect(
    await storage.confirmBlobDeleted(blobId, time, {
      lease,
      receiptId: crypto.randomUUID(),
      objectKey: `private/${blobId}`,
      cipherHash: null,
    }),
  ).toBe(true);
  expect(await deletion.finish(lease, time)).toBe(true);
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_cleanup_receipts").get()).toEqual({
    n: 2,
  });
  expect(
    f.db.sqlite.query("SELECT state,original_blob_id FROM v2_assets WHERE id=?").get(r.assetId),
  ).toEqual({ state: "reserved", original_blob_id: null });
  expect(
    f.db.sqlite.query("SELECT stored_bytes,reserved_bytes FROM v2_storage_usage").get(),
  ).toEqual({ stored_bytes: 0, reserved_bytes: 20 });
});
test("failed R2 receipt or mid-put deletion never promotes pointer and pending object remains journalled", async () => {
  const f = await fixture();
  const input = {
    name: "synthetic.png",
    byteLength: 20,
    mediaType: "image/png",
    purpose: "identity",
  };
  const r = await f.service.reserve(
    f.owner.userId,
    1,
    "synthetic_wrong_receipt",
    input,
    "verification",
  );
  f.setBad();
  await expect(
    f.service.upload(f.owner.userId, r.assetId, 1, 20, stream(new Uint8Array(20))),
  ).rejects.toMatchObject({ code: "ASSET_NOT_READY" });
  expect(
    f.db.sqlite.query("SELECT state,original_blob_id FROM v2_assets WHERE id=?").get(r.assetId),
  ).toEqual({ state: "reserved", original_blob_id: null });
  expect(f.db.sqlite.query("SELECT state,cipher_hash FROM v2_blobs").get()).toEqual({
    state: "deleting",
    cipher_hash: null,
  });
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_deletion_journals").get()).toEqual({
    n: 1,
  });
  const usage = f.db.sqlite.query("SELECT reserved_bytes FROM v2_storage_usage").get();
  expect(usage).toEqual({ reserved_bytes: 20 });
  const g = await fixture();
  const t = await g.service.reserve(
    g.owner.userId,
    1,
    "synthetic_mid_put_delete",
    input,
    "verification",
  );
  g.putHook(() => {
    g.db.sqlite
      .query("INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES('asset',?,?)")
      .run(t.assetId, new Date().toISOString());
  });
  await expect(
    g.service.upload(g.owner.userId, t.assetId, 1, 20, stream(new Uint8Array(20))),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect(
    g.db.sqlite.query("SELECT original_blob_id FROM v2_assets WHERE id=?").get(t.assetId),
  ).toEqual({ original_blob_id: null });
});
test("truncated/oversized input and tampered ciphertext are rejected, deleting stops an existing read", async () => {
  const f = await fixture();
  const input = {
    name: "synthetic.pdf",
    byteLength: 20,
    mediaType: "application/pdf",
    purpose: "office",
  };
  const r = await f.service.reserve(
    f.owner.userId,
    1,
    "synthetic_truncated",
    input,
    "verification",
  );
  await expect(
    f.service.upload(f.owner.userId, r.assetId, 1, 20, stream(new Uint8Array(19))),
  ).rejects.toThrow();
  const r2 = await f.service.reserve(
    f.owner.userId,
    1,
    "synthetic_oversized",
    input,
    "verification",
  );
  await expect(
    f.service.upload(f.owner.userId, r2.assetId, 1, 20, stream(new Uint8Array(21))),
  ).rejects.toThrow();
  const r3 = await f.service.reserve(
    f.owner.userId,
    1,
    "synthetic_valid_tamper",
    input,
    "verification",
  );
  await f.service.upload(f.owner.userId, r3.assetId, 1, 20, stream(new Uint8Array(20)));
  const key = f.db.sqlite
    .query(
      "SELECT b.object_key FROM v2_assets a JOIN v2_blobs b ON b.id=a.original_blob_id WHERE a.id=?",
    )
    .get(r3.assetId) as { object_key: string };
  const data = f.objects.get(key.object_key);
  if (!data) throw new Error("Synthetic ciphertext missing");
  data[data.length - 1] = (data[data.length - 1] ?? 0) ^ 1;
  const altered = await f.service.open(f.owner.userId, r3.assetId);
  await expect(new Response(altered.body).arrayBuffer()).rejects.toThrow();
  data[data.length - 1] = (data[data.length - 1] ?? 0) ^ 1;
  const open = await f.service.open(f.owner.userId, r3.assetId);
  expect(
    await createV2DeletionRepository(f.core).asset(
      { ownerId: f.owner.userId, now: new Date().toISOString() },
      r3.assetId,
      2,
    ),
  ).toBe(true);
  await expect(new Response(open.body).arrayBuffer()).rejects.toThrow();
});
test("real max100MB encoder remains bounded; authenticated frames preserve full exact bytes", async () => {
  const f = await fixture();
  const total = 100_000_000;
  const id: AssetIdentity = {
    environment: "preview",
    ownerId: f.owner.userId,
    assetId: "synthetic_max_asset",
    assetRevision: 1,
    blobId: "synthetic_max_blob",
    byteLength: total,
  };
  const binary = await prepareAssetBinary(f.cipher, id);
  let produced = 0;
  let maxSource = 0;
  let cipherBytes = 0;
  let maxFrame = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(c) {
        const size = Math.min(65536, total - produced);
        if (!size) {
          c.close();
          return;
        }
        const b = new Uint8Array(size).fill(71);
        maxSource = Math.max(maxSource, size);
        produced += size;
        c.enqueue(b);
      },
    },
    { highWaterMark: 0 },
  );
  // The sink hashes/counts each frame rather than collecting 100MB in a fixture.
  const writer = new WritableStream<Uint8Array>({
    write(b) {
      cipherBytes += b.length;
      maxFrame = Math.max(maxFrame, b.length);
    },
  }).getWriter();
  const receipt = await binary.write(body, writer);
  expect(produced).toBe(total);
  expect(cipherBytes).toBe(binary.cipherBytes);
  expect(maxFrame).toBeLessThanOrEqual(V2_LIMITS.chunkBytes + 16);
  expect(maxSource).toBe(65536);
  expect(receipt.contentHash).toHaveLength(64);
  const short = new Uint8Array(V2_LIMITS.chunkBytes + 2).fill(37);
  const roundId = { ...id, byteLength: short.length };
  const format = await prepareAssetBinary(f.cipher, roundId);
  const pipe = fixed(format.cipherBytes);
  const collected = new Response(pipe.readable).arrayBuffer();
  const hashes = await format.write(stream(short), pipe.writable.getWriter());
  const encrypted = new Uint8Array(await collected);
  const decrypted = decryptAssetBinary(
    f.cipher,
    roundId,
    stream(encrypted),
    hashes,
    async () => true,
  );
  expect(new Uint8Array(await new Response(decrypted).arrayBuffer())).toEqual(short);
  const wrong = decryptAssetBinary(
    f.cipher,
    { ...roundId, environment: "production" },
    stream(encrypted),
    hashes,
    async () => true,
  );
  await expect(new Response(wrong).arrayBuffer()).rejects.toThrow();
}, 30000);
test("submitted verification download is confined to fresh moderator/application links and stops after decision", async () => {
  const f = await fixture();
  const moderator = await seedTestSession(f.db, {
    consent: true,
    oauthAuthenticatedAt: Date.now(),
  });
  f.db.sqlite
    .query("INSERT INTO v2_role_bindings(owner_id,role,granted_at) VALUES(?,'moderator',?)")
    .run(moderator.userId, new Date().toISOString());
  const bytes = new Uint8Array(25).fill(72);
  const r = await f.service.reserve(
    f.owner.userId,
    1,
    "synthetic_ready_evidence",
    {
      name: "synthetic_identity.png",
      byteLength: bytes.length,
      mediaType: "image/png",
      purpose: "identity",
    },
    "verification",
  );
  const uploaded = await f.service.upload(
    f.owner.userId,
    r.assetId,
    1,
    bytes.length,
    stream(bytes),
  );
  const raw = f.db.sqlite
    .query("SELECT original_blob_id FROM v2_assets WHERE id=?")
    .get(r.assetId) as { original_blob_id: string };
  // A synthetic trusted processor receipt enables the next database state; no
  // client endpoint or actual human identity verification is substituted.
  if (!uploaded.value || "request" in uploaded.value || !("purpose" in uploaded.value))
    throw new Error("Verification DTO expected");
  expect(
    await f.repository.saveAsset(
      { ownerId: f.owner.userId, now: new Date().toISOString() },
      r.assetId,
      2,
      { ...uploaded.value, status: "ready" },
      raw.original_blob_id,
      null,
    ),
  ).toBe(true);
  const service = createLawyersService(f.core);
  const initial = await service.createApplication(f.owner.userId);
  if (application.status === "draft") throw new Error("Full synthetic application required");
  const edited = await service.saveApplication(f.owner.userId, {
    expectedRevision: initial.revision,
    content: {
      name: "Synthetic lawyer",
      licenseNumber: "SYNTHETIC",
      office: application.content.office,
      verificationAssetIds: [r.assetId],
    },
  });
  const submitted = await service.submitApplication(f.owner.userId, edited.revision);
  if (!submitted) throw new Error("Submitted fixture expected");
  const moderatorBody = await f.service.moderatorOpen(
    moderator.userId,
    moderator.sessionId,
    submitted.id,
    r.assetId,
  );
  expect(new Uint8Array(await new Response(moderatorBody.body).arrayBuffer())).toEqual(bytes);
  await expect(
    f.service.moderatorOpen(f.other.userId, f.other.sessionId, submitted.id, r.assetId),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    f.service.moderatorOpen(
      moderator.userId,
      moderator.sessionId,
      "foreign_application",
      r.assetId,
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const current = await f.service.moderatorOpen(
    moderator.userId,
    moderator.sessionId,
    submitted.id,
    r.assetId,
  );
  await createModerationService(f.core).decideApplication(
    moderator.userId,
    moderator.sessionId,
    submitted.id,
    {
      expectedRevision: edited.revision,
      decision: "approved",
      reason: "Synthetic review",
      checklist: { identity: true, lawyerLicense: true, office: true },
    },
  );
  await expect(new Response(current.body).arrayBuffer()).rejects.toThrow();
  expect(
    await f.repository.roles({ ownerId: f.owner.userId, now: new Date().toISOString() }),
  ).toContain("verified_lawyer");
});
