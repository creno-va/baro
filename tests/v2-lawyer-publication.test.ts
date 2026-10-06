import { afterEach, expect, test } from "bun:test";
import { sha256 } from "@noble/hashes/sha2.js";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2AccountingRepository } from "../src/server/db/v2-accounting";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2DeletionRepository } from "../src/server/db/v2-deletion";
import { createV2LawyersRepository } from "../src/server/db/v2-lawyers";
import { createV2StorageRepository } from "../src/server/db/v2-storage";
import { hex } from "../src/server/modules/files/binary";
import { createLawyerPublicationService } from "../src/server/modules/lawyers/publication";
import { createModerationService } from "../src/server/modules/moderation/service";
import { application, publicLawyer } from "./fixtures/contracts/v2";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
function stream(bytes: Uint8Array) {
  let sent = false;
  return new ReadableStream<Uint8Array>(
    {
      pull(c) {
        if (sent) c.close();
        else {
          sent = true;
          c.enqueue(bytes.slice());
        }
      },
    },
    { highWaterMark: 0 },
  );
}
function fixed(length: number) {
  let size = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(b, c) {
      size += b.length;
      if (size > length) throw new Error("Invalid synthetic fixed length");
      c.enqueue(b);
    },
    flush() {
      if (size !== length) throw new Error("Invalid synthetic fixed length");
    },
  });
}
async function fixture() {
  const db = await createTestDatabase();
  databases.push(db);
  const owner = await seedTestSession(db, { consent: true });
  const moderator = await seedTestSession(db, { consent: true, oauthAuthenticatedAt: Date.now() });
  const env = { ...owner.env, CASE_DATA_KEY_V1: btoa("k".repeat(32)).replace(/=+$/, "") };
  const core = createV2Core(db.binding, await createCaseDataCipher(env));
  const repository = createV2LawyersRepository(core);
  const now = new Date().toISOString();
  db.sqlite
    .query("INSERT INTO v2_role_bindings(owner_id,role,granted_at) VALUES(?,'moderator',?)")
    .run(moderator.userId, now);
  const appId = crypto.randomUUID();
  if (application.status === "draft") throw new Error("Synthetic submitted source required");
  const app = {
    schemaVersion: "2",
    id: appId,
    applicantId: owner.userId,
    revision: 1,
    createdAt: now,
    status: "submitted",
    submittedAt: now,
    content: application.content,
  };
  const appEnvelope = await core.encrypt("v2_applications", appId, owner.userId, 1, app);
  db.sqlite
    .query(
      "INSERT INTO v2_applications(id,owner_id,revision,status,encrypted_payload,submitted_at,created_at) VALUES(?,?,1,'submitted',?,?,?)",
    )
    .run(appId, owner.userId, appEnvelope, now, now);
  await createModerationService(core).decideApplication(
    moderator.userId,
    moderator.sessionId,
    appId,
    {
      expectedRevision: 1,
      decision: "approved",
      reason: "Synthetic manual fixture",
      checklist: { identity: true, lawyerLicense: true, office: true },
    },
  );
  const profileId = crypto.randomUUID();
  expect(await repository.createProfile({ ownerId: owner.userId, now }, profileId)).toBe(true);
  const principal = await createV2AccountingRepository(core).ensurePrincipal({
    ownerId: owner.userId,
    now,
  });
  if (!principal) throw new Error("Synthetic principal required");
  const assetId = crypto.randomUUID();
  const sourceBlobId = crypto.randomUUID();
  const bytes = new Uint8Array([255, 216, 255, 217]);
  const hash = hex(sha256(bytes));
  const reservationId = crypto.randomUUID();
  // Synthetic #59 upstream receipt only. Actual sanitization stays separately
  // verified; all ciphertext metadata below uses real AES and generated SQLite.
  const asset = {
    id: assetId,
    revision: 1,
    kind: "image",
    status: "ready",
    byteLength: bytes.length,
    originalHash: hash,
    sanitizedDerivative: {
      id: sourceBlobId,
      contentHash: hash,
      byteLength: bytes.length,
      format: "jpeg",
    },
    currentJobId: null,
    failure: null,
  };
  const assetEnvelope = await core.encrypt("v2_assets", assetId, owner.userId, 1, asset);
  db.sqlite
    .query(
      "INSERT INTO v2_assets(id,owner_id,profile_id,purpose,state,encrypted_payload,created_at) VALUES(?,?,?,'profile_photo','reserved',?,?)",
    )
    .run(assetId, owner.userId, profileId, assetEnvelope, now);
  db.sqlite
    .query(
      "INSERT INTO v2_storage_reservations(id,principal_id,operation_id,target_id,entity_id,kind,byte_length,state,created_at) VALUES(?,?,'synthetic_upstream',?,?,'lawyer_asset',?,'stored',?)",
    )
    .run(reservationId, principal, sourceBlobId, assetId, bytes.length, now);
  const sourceEnvelope = await core.encrypt("v2_blobs", sourceBlobId, owner.userId, 1, {
    contentHash: hash,
  });
  db.sqlite
    .query(
      "INSERT INTO v2_blobs(id,principal_id,reservation_id,kind,visibility,state,object_key,logical_bytes,cipher_bytes,cipher_hash,key_version,encrypted_payload,created_at) VALUES(?,?,?,'profile_photo_sanitized','staging','stored',?,?,?,?, 'synthetic_fixture_v1',?,?)",
    )
    .run(
      sourceBlobId,
      principal,
      reservationId,
      `staging/${sourceBlobId}`,
      bytes.length,
      bytes.length,
      hash,
      sourceEnvelope,
      now,
    );
  db.sqlite
    .query("UPDATE v2_assets SET state='ready',sanitized_blob_id=? WHERE id=?")
    .run(sourceBlobId, assetId);
  db.sqlite
    .query("UPDATE v2_storage_usage SET stored_bytes=? WHERE principal_id=?")
    .run(bytes.length, principal);
  const content = { ...structuredClone(publicLawyer.content), photoAssetId: assetId };
  const revisionId = crypto.randomUUID();
  expect(
    await repository.saveProfileDraft(
      { ownerId: owner.userId, now },
      profileId,
      1,
      revisionId,
      content,
    ),
  ).toBe(true);
  expect(await repository.submitProfile({ ownerId: owner.userId, now }, profileId, 2, appId)).toBe(
    true,
  );
  await createModerationService(core).decideProfile(
    moderator.userId,
    moderator.sessionId,
    revisionId,
    {
      expectedRevision: 2,
      decision: "approved",
      reason: "Synthetic profile review",
      checklist: {
        identityMatches: true,
        officeMatches: true,
        personalDataReviewed: true,
        advertisingReviewed: true,
        assetsSanitized: true,
      },
    },
  );
  const objects = new Map<string, Uint8Array>();
  let count = 0;
  let bad = false;
  let afterPut: (() => Promise<void>) | undefined;
  let beforeStore: (() => Promise<void>) | undefined;
  let rejectedPut = false;
  let wrongHash = false;
  const bucket = {
    async put(key: string, body: ReadableStream<Uint8Array>) {
      count++;
      if (rejectedPut) throw new Error("Synthetic R2 rejected before consumption");
      const data = new Uint8Array(await new Response(body).arrayBuffer());
      await beforeStore?.();
      objects.set(key, data);
      await afterPut?.();
      return { key, size: bad ? data.length + 1 : data.length };
    },
    async head(key: string) {
      const data = objects.get(key);
      return data ? { key, size: data.length } : null;
    },
    async get(key: string) {
      const data = objects.get(key);
      return data ? { key, size: data.length, body: stream(data) } : null;
    },
    async delete(key: string) {
      objects.delete(key);
    },
  } as unknown as Pick<R2Bucket, "get" | "put" | "head" | "delete">;
  const deps = {
    publicBucket: bucket,
    fixedLengthStream: fixed,
    storageAdmission: async () => true,
    openSanitized: async (input: {
      ownerId: string;
      profileId: string;
      assetId: string;
      assetRevision: number;
      sourceBlobId: string;
    }) => {
      expect(input).toEqual({
        ownerId: owner.userId,
        profileId,
        assetId,
        assetRevision: 1,
        sourceBlobId,
      });
      return {
        byteLength: bytes.length,
        contentHash: wrongHash ? "b".repeat(64) : hash,
        body: stream(bytes),
      };
    },
  };
  return {
    db,
    core,
    repository,
    owner,
    moderator,
    profileId,
    assetId,
    sourceBlobId,
    revisionId,
    bytes,
    objects,
    deps,
    service: createLawyerPublicationService(core, deps),
    count: () => count,
    setBad: () => {
      bad = true;
    },
    afterPut: (callback: () => Promise<void>) => {
      afterPut = callback;
    },
    beforeStore: (callback: () => Promise<void>) => {
      beforeStore = callback;
    },
    rejectPut: () => {
      rejectedPut = true;
    },
    wrongHash: () => {
      wrongHash = true;
    },
  };
}
test("approved actual sanitized copy receipt precedes public pointer; copy and finalize retries are idempotent", async () => {
  const f = await fixture();
  expect(await f.repository.publicProfile(f.profileId)).toBeNull();
  const copy = await f.service.copyApprovedAsset(f.owner.userId, f.profileId, 2, f.assetId);
  expect(f.objects.get(`public/${copy.blobId}`)).toEqual(f.bytes);
  expect(await f.repository.publicProfile(f.profileId)).toBeNull();
  expect(await f.service.copyApprovedAsset(f.owner.userId, f.profileId, 2, f.assetId)).toEqual(
    copy,
  );
  expect(f.count()).toBe(1);
  const published = await f.service.finalize(f.owner.userId, f.profileId, 2);
  expect(published.assets[0]?.contentHash).toBe(hex(sha256(f.bytes)));
  expect((await f.repository.publicProfile(f.profileId))?.approvedRevision).toBe(2);
  expect(await f.service.finalize(f.owner.userId, f.profileId, 2)).toEqual(published);
  expect(
    f.db.sqlite.query("SELECT stored_bytes,reserved_bytes FROM v2_storage_usage").get(),
  ).toEqual({ stored_bytes: f.bytes.length * 2, reserved_bytes: 0 });
});
test("R2 rejection aborts bounded public copying and preserves cleanup intent", async () => {
  const f = await fixture();
  f.rejectPut();
  await expect(
    f.service.copyApprovedAsset(f.owner.userId, f.profileId, 2, f.assetId),
  ).rejects.toThrow("Synthetic R2 rejected");
  expect(f.objects.size).toBe(0);
  expect(
    f.db.sqlite.query("SELECT state,cipher_hash FROM v2_blobs WHERE kind='public_copy'").get(),
  ).toEqual({ state: "deleting", cipher_hash: null });
  expect(await f.repository.publicProfile(f.profileId)).toBeNull();
}, 5000);
test("late public PUT after completed cleanup creates a fresh generation and deletes the actual object once", async () => {
  const f = await fixture();
  const storage = createV2StorageRepository(f.core);
  const deletion = createV2DeletionRepository(f.core);
  let blobId = "",
    oldJournal = "";
  f.beforeStore(async () => {
    const row = f.db.sqlite
      .query("SELECT id FROM v2_blobs WHERE kind='public_copy' AND state='pending'")
      .get() as { id: string };
    blobId = row.id;
    const now = new Date().toISOString();
    expect(await storage.abandonApprovedPublicCopy({ ownerId: f.owner.userId, now }, blobId)).toBe(
      true,
    );
    const journal = await deletion.findByTarget("blob", blobId);
    if (!journal) throw new Error("Synthetic public cleanup journal required");
    oldJournal = journal.id;
    const lease = await deletion.acquire(
      journal.id,
      crypto.randomUUID(),
      now,
      new Date(Date.parse(now) + 60000).toISOString(),
    );
    if (!lease) throw new Error("Current public cleanup lease required");
    expect(await f.deps.publicBucket.head(`public/${blobId}`)).toBeNull();
    expect(await f.service.cleanup(lease)).toBe(true);
    expect(await deletion.finish(lease, now)).toBe(true);
    expect(f.db.sqlite.query("SELECT state FROM v2_blobs WHERE id=?").get(blobId)).toEqual({
      state: "deleted",
    });
    expect(
      f.db.sqlite.query("SELECT stored_bytes,reserved_bytes FROM v2_storage_usage").get(),
    ).toEqual({ stored_bytes: f.bytes.length, reserved_bytes: 0 });
  });
  await expect(
    f.service.copyApprovedAsset(f.owner.userId, f.profileId, 2, f.assetId),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect(f.objects.get(`public/${blobId}`)).toEqual(f.bytes);
  expect(f.db.sqlite.query("SELECT state FROM v2_blobs WHERE id=?").get(blobId)).toEqual({
    state: "deleting",
  });
  const now = new Date().toISOString();
  const pending = await deletion.pending(now, 20);
  expect(pending).toHaveLength(1);
  const next = pending[0];
  if (!next) throw new Error("Fresh public cleanup generation required");
  expect(next.id).not.toBe(oldJournal);
  expect(
    f.db.sqlite
      .query("SELECT count(*) AS n FROM v2_cleanup_receipts WHERE journal_id=?")
      .get(oldJournal),
  ).toEqual({ n: 1 });
  expect(
    f.db.sqlite.query("SELECT stored_bytes,reserved_bytes FROM v2_storage_usage").get(),
  ).toEqual({ stored_bytes: f.bytes.length * 2, reserved_bytes: 0 });
  const lease = await deletion.acquire(
    next.id,
    crypto.randomUUID(),
    now,
    new Date(Date.parse(now) + 60000).toISOString(),
  );
  if (!lease) throw new Error("Fresh public cleanup lease required");
  expect(await f.service.cleanup(lease)).toBe(true);
  expect(await f.deps.publicBucket.head(`public/${blobId}`)).toBeNull();
  expect(await deletion.finish(lease, now)).toBe(true);
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_cleanup_receipts").get()).toEqual({
    n: 2,
  });
  expect(
    f.db.sqlite.query("SELECT stored_bytes,reserved_bytes FROM v2_storage_usage").get(),
  ).toEqual({ stored_bytes: f.bytes.length, reserved_bytes: 0 });
  expect(await f.repository.publicProfile(f.profileId)).toBeNull();
});
test("owner/source/hash/approval mismatch and missing funding fail before public object publication", async () => {
  const f = await fixture();
  await expect(
    f.service.copyApprovedAsset(f.moderator.userId, f.profileId, 2, f.assetId),
  ).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
  await expect(
    f.service.copyApprovedAsset(f.owner.userId, f.profileId, 1, f.assetId),
  ).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
  const missing = createLawyerPublicationService(f.core, {
    publicBucket: f.deps.publicBucket,
    openSanitized: f.deps.openSanitized,
    fixedLengthStream: fixed,
  });
  await expect(
    missing.copyApprovedAsset(f.owner.userId, f.profileId, 2, f.assetId),
  ).rejects.toMatchObject({ code: "PROCESSING_UNAVAILABLE" });
  expect(f.count()).toBe(0);
  f.wrongHash();
  await expect(
    f.service.copyApprovedAsset(f.owner.userId, f.profileId, 2, f.assetId),
  ).rejects.toMatchObject({ code: "ASSET_NOT_READY" });
  expect(f.count()).toBe(0);
  expect(
    f.db.sqlite
      .query("SELECT count(*) AS n FROM v2_blobs WHERE kind='public_copy' AND state='stored'")
      .get(),
  ).toEqual({ n: 0 });
  expect(await f.repository.publicProfile(f.profileId)).toBeNull();
});
test("bad actual receipt and review withdrawal during R2 await leave only a public cleanup intent", async () => {
  const f = await fixture();
  f.setBad();
  await expect(
    f.service.copyApprovedAsset(f.owner.userId, f.profileId, 2, f.assetId),
  ).rejects.toMatchObject({ code: "ASSET_NOT_READY" });
  expect(
    f.db.sqlite.query("SELECT state,cipher_hash FROM v2_blobs WHERE kind='public_copy'").get(),
  ).toEqual({ state: "deleting", cipher_hash: null });
  expect(await f.repository.publicProfile(f.profileId)).toBeNull();
  const g = await fixture();
  g.afterPut(async () => {
    expect(
      await g.repository.withdrawProfile(
        { ownerId: g.owner.userId, now: new Date().toISOString() },
        g.profileId,
        2,
        "publication",
      ),
    ).toBe(false);
    g.db.sqlite
      .query("UPDATE v2_profile_revisions SET status='withdrawn',withdrawn_at=? WHERE id=?")
      .run(new Date().toISOString(), g.revisionId);
  });
  await expect(
    g.service.copyApprovedAsset(g.owner.userId, g.profileId, 2, g.assetId),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect(await g.repository.publicProfile(g.profileId)).toBeNull();
  expect(g.db.sqlite.query("SELECT state FROM v2_blobs WHERE kind='public_copy'").get()).toEqual({
    state: "deleting",
  });
});
