import { expect, test } from "bun:test";
import { sha256 } from "@noble/hashes/sha2.js";
import { createV2DeletionRepository } from "../src/server/db/v2-deletion";
import { createV2StorageRepository } from "../src/server/db/v2-storage";
import { hex } from "../src/server/modules/files/binary";
import { createLawyerPublicationService } from "../src/server/modules/lawyers/publication";
import { publicationFixture } from "./helpers/lawyer-publication";

test("approved actual sanitized copy receipt precedes public pointer; copy and finalize retries are idempotent", async () => {
  const f = await publicationFixture();
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
  const f = await publicationFixture();
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
  const f = await publicationFixture();
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
  const f = await publicationFixture();
  await expect(
    f.service.copyApprovedAsset(f.moderator.userId, f.profileId, 2, f.assetId),
  ).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
  await expect(
    f.service.copyApprovedAsset(f.owner.userId, f.profileId, 1, f.assetId),
  ).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
  const missing = createLawyerPublicationService(f.core, {
    publicBucket: f.deps.publicBucket,
    openSanitized: f.deps.openSanitized,
    fixedLengthStream: f.deps.fixedLengthStream,
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
  const f = await publicationFixture();
  f.setBad();
  await expect(
    f.service.copyApprovedAsset(f.owner.userId, f.profileId, 2, f.assetId),
  ).rejects.toMatchObject({ code: "ASSET_NOT_READY" });
  expect(
    f.db.sqlite.query("SELECT state,cipher_hash FROM v2_blobs WHERE kind='public_copy'").get(),
  ).toEqual({ state: "deleting", cipher_hash: null });
  expect(await f.repository.publicProfile(f.profileId)).toBeNull();
  const g = await publicationFixture();
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
