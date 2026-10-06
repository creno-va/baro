import { expect, test } from "bun:test";
import { createV2DeletionRepository } from "../src/server/db/v2-deletion";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createV2LawyersRepository } from "../src/server/db/v2-lawyers";
import { createAssetProcessingService } from "../src/server/modules/file-processing/assets";
import {
  createProcessorTransport,
  type ProcessingCosts,
} from "../src/server/modules/file-processing/transport";
import { digest } from "../src/server/modules/files/binary";
import type { PrivateBucket } from "../src/server/modules/files/service";
import { createLawyerAssetsService } from "../src/server/modules/lawyers/assets";
import { fixture } from "./helpers/file-processing-fixture";

/** Real SQLite, upload/service, framed AES and D1 intents. Native/paid/R2 are
 * explicit offline ports; actual codecs are proved in separate Linux CI. */
const fixed = (length: number) => {
  let size = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(b, c) {
      size += b.length;
      if (size > length) throw new Error("synthetic fixed limit");
      c.enqueue(b);
    },
    flush() {
      if (size !== length) throw new Error("synthetic incomplete fixed stream");
    },
  });
};
const signal = () => new AbortController().signal;
async function setup(
  options: {
    tamper?: boolean;
    advancingClock?: boolean;
    before?: (input: Parameters<ProcessingCosts["before"]>[0]) => void;
  } = {},
) {
  const f = await fixture();
  let clockCalls = 0;
  const clock = () =>
    new Date(Date.parse(f.actor.now) + (options.advancingClock ? ++clockCalls : 0)).toISOString();
  const bucket = {
    ...f.bucket.port,
    put: async (key: string, body: ReadableStream<Uint8Array> | Uint8Array<ArrayBuffer>) =>
      f.bucket.port.put(
        key,
        body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer()),
      ),
  } as PrivateBucket;
  const lawyers = createV2LawyersRepository(f.core),
    jobs = createV2JobsRepository(f.core);
  const profileId = crypto.randomUUID();
  expect(await lawyers.createProfile(f.actor, profileId)).toBe(true);
  const original = new Uint8Array(
    await Bun.file("tests/fixtures/media/image-markers.png").arrayBuffer(),
  );
  const output = new Uint8Array(
    await Bun.file("tests/fixtures/media/image-markers.jpg").arrayBuffer(),
  );
  const assets = createLawyerAssetsService(f.core, {
    environment: "preview",
    bucket,
    clock,
    storageAdmission: async () => true,
    fixedLengthStream: fixed,
  });
  const reserved = await assets.reserve(
    f.actor.ownerId,
    1,
    crypto.randomUUID(),
    {
      purpose: "profile_photo",
      name: "synthetic.png",
      byteLength: original.length,
      mediaType: "image/png",
    },
    "portfolio",
  );
  await assets.upload(
    f.actor.ownerId,
    reserved.assetId,
    1,
    original.length,
    new Response(original).body,
  );
  const jobId = crypto.randomUUID();
  expect(
    await jobs.admitAsset(f.actor, { assetId: reserved.assetId, assetRevision: 2, jobId }),
  ).toBe(true);
  const granted = await jobs.acquire(
    f.actor,
    jobId,
    crypto.randomUUID(),
    new Date(Date.parse(f.actor.now) + 300000).toISOString(),
  );
  if (!granted) throw new Error("Synthetic actual lease missing");
  const params = {
    ownerId: f.actor.ownerId,
    profileId,
    assetId: reserved.assetId,
    assetRevision: 2,
    jobId,
  };
  const receipts: string[] = [];
  let nativeCalls = 0;
  const costs: ProcessingCosts = {
    before: async (input) => {
      options.before?.(input);
      return { attemptId: crypto.randomUUID(), dispatchToken: null };
    },
    after: async (_, r) => {
      receipts.push(r.transport);
    },
  };
  const processor = createProcessorTransport({
    costs,
    stop: async () => {},
    fetch: async (request) => {
      nativeCalls++;
      expect(new Uint8Array(await request.arrayBuffer())).toEqual(original);
      const manifest = {
        version: 1,
        passes: 2,
        probe: {
          category: "image",
          format: "png",
          byteLength: original.length,
          width: 720,
          height: 420,
        },
        format: "jpeg",
        byteLength: output.length,
        contentHash: await digest(output),
        chunkCount: 1,
      };
      const changed = output.slice();
      if (options.tamper) changed[0] = (changed[0] ?? 0) ^ 1;
      return new Response(
        `${[
          { type: "sanitized_manifest", value: manifest },
          {
            type: "sanitized_chunk",
            pass: 0,
            index: 0,
            data: btoa(String.fromCharCode(...output)),
          },
          {
            type: "sanitized_chunk",
            pass: 1,
            index: 0,
            data: btoa(String.fromCharCode(...changed)),
          },
          { type: "complete" },
        ]
          .map((r) => JSON.stringify(r))
          .join("\n")}\n`,
      );
    },
  });
  const processing = createAssetProcessingService(f.core, {
    environment: "preview",
    instanceId: `${jobId}-1`,
    bucket,
    processor,
    costs,
    clock,
    fixedLength: fixed,
    openOriginal: (input, authorized) => assets.openOriginal(input, authorized),
  });
  return {
    ...f,
    bucketPort: bucket,
    lawyers,
    jobs,
    params,
    lease: granted.lease,
    processing,
    nativeCalls: () => nativeCalls,
    receipts,
    output,
  };
}
test("actual asset upload→lease→two-pass private AES→fenced ready, independent decoder and no public copy", async () => {
  const f = await setup();
  expect(await f.processing.sanitize(f.params, f.lease, signal())).toMatchObject({
    status: "ready",
    revision: 3,
  });
  const value = await f.lawyers.readAsset(f.actor, f.params.assetId);
  if (!value || !("sanitizedDerivative" in value) || !value.sanitizedDerivative)
    throw new Error("Actual ready asset expected");
  const blobId = value.sanitizedDerivative.id;
  const opened = await f.processing.openSanitized({
    ...f.params,
    assetRevision: 3,
    sourceBlobId: blobId,
  });
  expect(new Uint8Array(await new Response(opened.body).arrayBuffer())).toEqual(f.output);
  expect(opened.contentHash).toBe(await digest(f.output));
  expect(
    f.db.sqlite
      .query("SELECT visibility,state,key_version,source_asset_revision FROM v2_blobs WHERE id=?")
      .get(blobId),
  ).toEqual({
    visibility: "staging",
    state: "stored",
    key_version: "asset_sanitized_v1",
    source_asset_revision: 2,
  });
  expect(
    f.db.sqlite.query("SELECT count(*) AS count FROM v2_blobs WHERE visibility='public'").get(),
  ).toEqual({ count: 0 });
  expect(f.db.sqlite.query("SELECT status FROM v2_jobs WHERE id=?").get(f.params.jobId)).toEqual({
    status: "completed",
  });
  expect(f.db.sqlite.query("SELECT count(*) AS count FROM v2_file_observations").get()).toEqual({
    count: 0,
  });
  expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  const gets = f.bucket.calls.get;
  await expect(
    f.processing.openSanitized({
      ...f.params,
      ownerId: "foreign",
      assetRevision: 3,
      sourceBlobId: blobId,
    }),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect(f.bucket.calls.get).toBe(gets);
});
test("foreign owner or expired/fenced lease cannot open private original or invoke native", async () => {
  const f = await setup(),
    gets = f.bucket.calls.get;
  await expect(
    f.processing.sanitize({ ...f.params, ownerId: "foreign" }, f.lease, signal()),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  await expect(
    f.processing.sanitize(f.params, { ...f.lease, fencing: f.lease.fencing + 1 }, signal()),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect(f.nativeCalls()).toBe(0);
  expect(f.bucket.calls.get).toBe(gets);
});
test("advancing real actor timestamps stay within the exact 300-second renewal bound", async () => {
  const f = await setup({ advancingClock: true });
  expect(await f.processing.sanitize(f.params, f.lease, signal())).toMatchObject({
    status: "ready",
    revision: 3,
  });
  expect(f.nativeCalls()).toBe(1);
});
test("source provenance mutation during R2 read stops plaintext before the first sanitized frame", async () => {
  const f = await setup();
  await f.processing.sanitize(f.params, f.lease, signal());
  const value = await f.lawyers.readAsset(f.actor, f.params.assetId);
  if (!value || !("sanitizedDerivative" in value) || !value.sanitizedDerivative)
    throw new Error("Actual ready expected");
  const id = value.sanitizedDerivative.id;
  f.bucket.setGetHook(async () => {
    f.db.sqlite.query("UPDATE v2_blobs SET source_asset_revision=99 WHERE id=?").run(id);
  });
  await expect(
    f.processing.openSanitized({ ...f.params, assetRevision: 3, sourceBlobId: id }),
  ).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
});
test("asset tombstone after decoder creation prevents any sanitized plaintext", async () => {
  const f = await setup();
  await f.processing.sanitize(f.params, f.lease, signal());
  const value = await f.lawyers.readAsset(f.actor, f.params.assetId);
  if (!value || !("sanitizedDerivative" in value) || !value.sanitizedDerivative)
    throw new Error("Actual ready expected");
  const opened = await f.processing.openSanitized({
    ...f.params,
    assetRevision: 3,
    sourceBlobId: value.sanitizedDerivative.id,
  });
  expect(await createV2DeletionRepository(f.core).asset(f.actor, f.params.assetId, 3)).toBeTruthy();
  await expect(new Response(opened.body).arrayBuffer()).rejects.toMatchObject({
    code: "STALE_REVISION",
  });
});
test("changed second-pass bytes fail exact known-length PUT and cannot publish ready", async () => {
  const f = await setup({ tamper: true });
  await expect(f.processing.sanitize(f.params, f.lease, signal())).rejects.toMatchObject({
    code: "FILE_REJECTED",
  });
  expect(f.db.sqlite.query("SELECT state FROM v2_assets WHERE id=?").get(f.params.assetId)).toEqual(
    { state: "sanitizing" },
  );
  expect(
    f.db.sqlite
      .query("SELECT count(*) AS count FROM v2_blobs WHERE visibility='staging' AND state='stored'")
      .get(),
  ).toEqual({ count: 0 });
  expect(f.db.sqlite.query("SELECT count(*) AS count FROM v2_deletion_journals").get()).toEqual({
    count: 1,
  });
});
test("deletion during actual late output PUT prevents ready and requeues captured generation without an unreserved HEAD", async () => {
  const f = await setup();
  f.bucket.setPutHook(async () => {
    await createV2DeletionRepository(f.core).asset(f.actor, f.params.assetId, 2);
  });
  await expect(f.processing.sanitize(f.params, f.lease, signal())).rejects.toThrow();
  expect(
    f.db.sqlite
      .query("SELECT sanitized_blob_id,state FROM v2_assets WHERE id=?")
      .get(f.params.assetId),
  ).toBeNull();
  expect(
    f.db.sqlite
      .query("SELECT target_id FROM v2_tombstones WHERE target_kind='asset' AND target_id=?")
      .get(f.params.assetId),
  ).toEqual({ target_id: f.params.assetId });
  expect(
    f.db.sqlite
      .query("SELECT count(*) AS count FROM v2_blobs WHERE visibility='staging' AND state='stored'")
      .get(),
  ).toEqual({ count: 0 });
  const journals = f.db.sqlite
    .query("SELECT count(*) AS count FROM v2_deletion_journals")
    .get() as { count: number };
  expect(journals.count).toBeGreaterThan(0);
});
