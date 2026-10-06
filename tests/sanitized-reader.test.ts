import { expect, test } from "bun:test";
import { usageDateKst } from "../src/server/db/repository";
import { createV2AccountingRepository } from "../src/server/db/v2-accounting";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createV2LawyersRepository } from "../src/server/db/v2-lawyers";
import {
  createV2PaidRuntimeRepository,
  type PricingProof,
  type RuntimeProofVerifier,
} from "../src/server/db/v2-paid-runtime";
import { createStorageBudgetService } from "../src/server/modules/budget/storage-ledger";
import { createAssetProcessingService } from "../src/server/modules/file-processing/assets";
import { createSanitizedEncoder } from "../src/server/modules/file-processing/sanitized-binary";
import {
  createProcessorTransport,
  type ProcessingCosts,
} from "../src/server/modules/file-processing/transport";
import { digest } from "../src/server/modules/files/binary";
import type { PrivateBucket } from "../src/server/modules/files/service";
import { createLawyerAssetsService } from "../src/server/modules/lawyers/assets";
import {
  createLawyerPublicationService,
  type PublicationSanitizedInput,
} from "../src/server/modules/lawyers/publication";
import { createSanitizedReaders } from "../src/server/runtime/sanitized-reader";
import { fixture } from "./helpers/file-processing-fixture";
import { publicationFixture } from "./helpers/lawyer-publication";

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
    beforeReady?: () => void;
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
    testOnlyUnmeteredStorage: true,
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
  const processing = createAssetProcessingService(
    {
      ...f.core,
      encrypt: async (...args: Parameters<typeof f.core.encrypt>) => {
        if (args[0] === "v2_assets" && args[3] === 3) options.beforeReady?.();
        return f.core.encrypt(...args);
      },
    },
    {
      environment: "preview",
      instanceId: `${jobId}-1`,
      bucket,
      processor,
      costs,
      clock,
      fixedLength: fixed,
      openOriginal: (input, authorized) => assets.openOriginal(input, authorized),
    },
  );
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

async function ready() {
  const f = await setup();
  expect(await f.processing.sanitize(f.params, f.lease, signal())).toMatchObject({
    status: "ready",
    revision: 3,
  });
  const asset = await f.lawyers.readAsset(f.actor, f.params.assetId);
  if (!asset || !("sanitizedDerivative" in asset) || !asset.sanitizedDerivative)
    throw new Error("Synthetic ready source required");
  const input = {
    ownerId: f.params.ownerId,
    profileId: f.params.profileId,
    assetId: f.params.assetId,
    assetRevision: 3,
    sourceBlobId: asset.sanitizedDerivative.id,
  };
  return { ...f, input };
}

test("ready moderation reader uses real framed AES and explicit request maintenance approval", async () => {
  const f = await ready();
  const requests: Parameters<ProcessingCosts["before"]>[0][] = [],
    receipts: string[] = [];
  const maintenanceCosts: ProcessingCosts = {
    async before(request, access) {
      requests.push(request);
      expect(await access.authorize()).toBe(true);
      return { attemptId: crypto.randomUUID(), dispatchToken: null };
    },
    async after(_, receipt) {
      receipts.push(receipt.transport);
    },
  };
  const readers = createSanitizedReaders(f.core, {
    environment: "preview",
    bucket: f.bucketPort,
    clock: () => f.actor.now,
    maintenanceCosts,
  });
  const opened = await readers.moderation(f.input);
  expect(new Uint8Array(await new Response(opened.body).arrayBuffer())).toEqual(f.output);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    service: "requests",
    action: "r2_get",
    durationSeconds: null,
  });
  expect(receipts).toEqual(["response"]);
  expect(f.nativeCalls()).toBe(1); // Only the explicit fixture's earlier sanitize.
  expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});

test("missing maintenance budget denies actual R2 GET for ready source", async () => {
  const f = await ready(),
    count = f.bucket.calls.get;
  const readers = createSanitizedReaders(f.core, {
    environment: "preview",
    bucket: f.bucketPort,
    clock: () => f.actor.now,
  });
  await expect(readers.moderation(f.input)).rejects.toMatchObject({ code: "BUDGET_UNAVAILABLE" });
  expect(f.bucket.calls.get).toBe(count);
});

test("missing and cloned publication permits deny before GET and plaintext decryption", async () => {
  const f = await ready(),
    count = f.bucket.calls.get;
  let decrypts = 0;
  const readers = createSanitizedReaders(
    {
      ...f.core,
      decrypt: async (...args) => {
        decrypts++;
        return f.core.decrypt(...args);
      },
    },
    { environment: "preview", bucket: f.bucketPort, clock: () => f.actor.now },
  );
  await expect(readers.publication(f.input)).rejects.toMatchObject({ code: "BUDGET_UNAVAILABLE" });
  await expect(
    readers.publication({
      ...f.input,
      approvedReadPermit: {
        attemptId: crypto.randomUUID(),
        dispatchToken: crypto.randomUUID(),
      },
    }),
  ).rejects.toMatchObject({ code: "BUDGET_UNAVAILABLE" });
  expect(f.bucket.calls.get).toBe(count);
  expect(decrypts).toBe(0);
});

test("source revocation during maintenance approval prevents GET", async () => {
  const f = await ready(),
    count = f.bucket.calls.get;
  const readers = createSanitizedReaders(f.core, {
    environment: "preview",
    bucket: f.bucketPort,
    clock: () => f.actor.now,
    maintenanceCosts: {
      async before() {
        f.db.sqlite
          .query("INSERT INTO v2_tombstones VALUES('asset',?,?)")
          .run(f.input.assetId, f.actor.now);
        return { attemptId: crypto.randomUUID(), dispatchToken: null };
      },
      async after() {},
    },
  });
  await expect(readers.moderation(f.input)).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect(f.bucket.calls.get).toBe(count);
});

test("ready reader stops the first plaintext frame after source tombstone", async () => {
  const f = await ready();
  const readers = createSanitizedReaders(f.core, {
    environment: "preview",
    bucket: f.bucketPort,
    clock: () => f.actor.now,
    maintenanceCosts: {
      before: async () => ({ attemptId: crypto.randomUUID(), dispatchToken: null }),
      after: async () => {},
    },
  });
  const opened = await readers.moderation(f.input);
  f.db.sqlite
    .query("INSERT INTO v2_tombstones VALUES('asset',?,?)")
    .run(f.input.assetId, f.actor.now);
  await expect(opened.body.getReader().read()).rejects.toMatchObject({ code: "STALE_REVISION" });
});

const NOW = new Date().toISOString(),
  EXP = new Date(Date.now() + 30 * 86400000).toISOString(),
  HASH = "a".repeat(64);
// Synthetic evidence only; the actual migrated SQLite/AES/R2 adapter consumer is tested.
const verify: RuntimeProofVerifier = async (kind, _value, digest) => ({
  digest,
  evidenceHash: HASH,
  verifiedAt: NOW,
  method:
    kind === "funding"
      ? "authenticated_console"
      : kind === "pricing"
        ? "official_document"
        : kind === "usage"
          ? "provider_receipt"
          : "authenticated_coordinator",
});
async function paidFixture() {
  const f = await framedPublicationFixture(),
    accounting = createV2AccountingRepository(f.core, "preview"),
    runtime = createV2PaidRuntimeRepository(f.core, "preview", verify);
  const allocation = {
    month: usageDateKst(NOW).slice(0, 7),
    version: 1,
    previewKrw: 10000,
    productionKrw: 20000,
    sharedFixedKrw: 100,
    maintenanceReserveKrw: 100,
    pricingProvenance: "synthetic",
    fxProvenance: "synthetic",
    fundingProvenance: "synthetic",
    reviewedAt: NOW,
    validUntil: EXP,
    fundingState: "trial_credit" as const,
    fundingValidUntil: EXP,
    manifestHash: HASH,
  };
  await accounting.recordAllocation(allocation);
  for (const environment of ["preview", "production"] as const)
    await accounting.recordAllocationAcknowledgment({
      month: allocation.month,
      version: 1,
      environment,
      manifestHash: HASH,
      drainReceiptId: crypto.randomUUID(),
      now: NOW,
    });
  expect(await accounting.activateAllocation(allocation.month, 1, NOW)).toBe(true);
  expect(await runtime.initializeControl(allocation.month, NOW)).toBe(true);
  const ap = { id: crypto.randomUUID(), environment: "preview" as const, allocation };
  expect(await runtime.putAllocationProof(ap, NOW)).toBe(true);
  const drain = await runtime.drain(allocation.month, 1, ap.id, NOW);
  if (!drain) throw new Error("Synthetic drain missing");
  expect(await runtime.putRemoteDrainProof(drain, NOW)).toBe(true);
  const remote = {
    ...drain,
    id: crypto.randomUUID(),
    environment: "production" as const,
    limitKrw: 20000,
  };
  expect(await runtime.putRemoteDrainProof(remote, NOW)).toBe(true);
  expect(await runtime.activate(allocation.month, 2, ap.id, drain.id, remote.id, NOW)).toBe(true);
  const pricing: PricingProof = {
    id: crypto.randomUUID(),
    version: 1,
    environment: "preview",
    modelBillingPolicy: null,
    prices: [
      {
        sku: "r2_class_a_requests",
        provider: "cloudflare",
        model: null,
        modelRates: null,
        region: "global",
        plan: "synthetic",
        billingMode: "metered",
        unit: "requests",
        unitSize: "1",
        usdPerUnit: "1",
        billingQuantum: "1",
        officialUrl: "https://developers.cloudflare.com/r2/pricing/",
        checkedAt: NOW,
        validUntil: EXP,
      },
    ],
    fx: {
      krwPerUsd: "1000",
      authority: "synthetic",
      referenceUrl: "https://example.test/fx",
      asOf: NOW,
      checkedAt: NOW,
      validUntil: EXP,
    },
    taxRatio: "0",
    feeRatio: "0",
    safetyMarginRatio: "0",
    hiddenAttemptMultiplier: 1,
    hiddenRetryReference: "synthetic",
    checkedAt: NOW,
    validUntil: EXP,
  };
  const funding = {
    id: crypto.randomUUID(),
    environment: "preview" as const,
    state: "trial_credit" as const,
    existingPaymentPath: true as const,
    autoRecharge: false as const,
    spendAllowanceKrw: 10000,
    reference: "synthetic",
    observedAt: NOW,
    validUntil: EXP,
  };
  const price = pricing.prices[0];
  if (!price) throw new Error("Synthetic price missing");
  pricing.prices.push({ ...price, sku: "r2_class_b_requests" });
  expect(await runtime.putPricingProof(pricing, NOW)).toBe(true);
  expect(await runtime.putFundingProof(funding, NOW)).toBe(true);
  const costs = createStorageBudgetService({
    core: f.core,
    environment: "preview",
    ownerId: f.owner.userId,
    bounds: async (_input, inputDigest, now) => ({
      inputDigest,
      evidenceHash: HASH,
      verifiedAt: now,
      validUntil: EXP,
      quantities: [
        { sku: "r2_class_a_requests", maximumQuantity: "1" },
        { sku: "r2_class_b_requests", maximumQuantity: "1" },
      ],
    }),
  });
  return { ...f, costs };
}

async function framedPublicationFixture() {
  const f = await publicationFixture();
  // Synthetic upstream sanitized bytes; real independent frame AES and actual
  // manual-profile DAL approval are exercised, not a native codec or live R2.
  const bytes = new Uint8Array(1_048_580).fill(7),
    hash = await digest(bytes),
    originalId = crypto.randomUUID(),
    now = new Date().toISOString();
  const source = f.db.sqlite
    .query("SELECT principal_id,reservation_id FROM v2_blobs WHERE id=?")
    .get(f.sourceBlobId) as { principal_id: string; reservation_id: string };
  const originalPayload = await f.core.encrypt("v2_blobs", originalId, f.owner.userId, 1, {
    contentHash: hash,
  });
  f.db.sqlite
    .query(
      "INSERT INTO v2_blobs(id,principal_id,reservation_id,kind,visibility,state,object_key,logical_bytes,cipher_bytes,cipher_hash,key_version,encrypted_payload,created_at) VALUES(?,?,?,'profile_photo_original','private','stored',?,?,?,?, 'asset_binary_v1',?,?)",
    )
    .run(
      originalId,
      source.principal_id,
      source.reservation_id,
      `private/${originalId}`,
      bytes.length,
      bytes.length + 16,
      HASH,
      originalPayload,
      now,
    );
  const asset = {
    id: f.assetId,
    revision: 2,
    kind: "image",
    status: "ready",
    byteLength: bytes.length,
    originalHash: hash,
    sanitizedDerivative: {
      id: f.sourceBlobId,
      contentHash: hash,
      byteLength: bytes.length,
      format: "jpeg",
    },
    currentJobId: null,
    failure: null,
  };
  const assetPayload = await f.core.encrypt("v2_assets", f.assetId, f.owner.userId, 2, asset);
  const sourcePayload = await f.core.encrypt("v2_blobs", f.sourceBlobId, f.owner.userId, 1, {
    contentHash: hash,
  });
  const encoder = await createSanitizedEncoder(
    f.core.cipher,
    {
      environment: "preview",
      ownerId: f.owner.userId,
      profileId: f.profileId,
      assetId: f.assetId,
      assetRevision: 1,
      sourceBlobId: originalId,
      blobId: f.sourceBlobId,
    },
    {
      version: 1,
      passes: 2,
      probe: { category: "image", format: "png", byteLength: bytes.length, width: 10, height: 10 },
      format: "jpeg",
      byteLength: bytes.length,
      contentHash: hash,
      chunkCount: 2,
    },
  );
  await encoder.observe(0, bytes.slice(0, 1_048_576));
  await encoder.observe(1, bytes.slice(1_048_576));
  const receipt = encoder.seal(),
    first = await encoder.replay(0, bytes.slice(0, 1_048_576)),
    second = await encoder.replay(1, bytes.slice(1_048_576));
  const cipherBytes = new Uint8Array(first.length + second.length);
  cipherBytes.set(first);
  cipherBytes.set(second, first.length);
  f.db.sqlite
    .query("UPDATE v2_assets SET revision=2,encrypted_payload=?,original_blob_id=? WHERE id=?")
    .run(assetPayload, originalId, f.assetId);
  f.db.sqlite
    .query("UPDATE v2_profile_revision_assets SET asset_revision=2 WHERE asset_id=?")
    .run(f.assetId);
  f.db.sqlite
    .query("UPDATE v2_storage_reservations SET byte_length=? WHERE id=?")
    .run(bytes.length, source.reservation_id);
  f.db.sqlite
    .query(
      "UPDATE v2_blobs SET logical_bytes=?,cipher_bytes=?,cipher_hash=?,key_version='asset_sanitized_v1',object_key=?,source_blob_id=?,source_asset_revision=1,encrypted_payload=? WHERE id=?",
    )
    .run(
      bytes.length,
      receipt.cipherBytes,
      receipt.cipherHash,
      `private/${f.sourceBlobId}`,
      originalId,
      sourcePayload,
      f.sourceBlobId,
    );
  f.db.sqlite
    .query("UPDATE v2_storage_usage SET stored_bytes=? WHERE principal_id=?")
    .run(bytes.length * 2, source.principal_id);
  let gets = 0,
    getHook: (() => void) | undefined;
  const privateBucket = {
    ...f.deps.publicBucket,
    async get(key: string) {
      gets++;
      getHook?.();
      return key === `private/${f.sourceBlobId}`
        ? { key, size: cipherBytes.length, body: new Response(cipherBytes.slice()).body }
        : null;
    },
  } as PrivateBucket;
  return {
    ...f,
    bytes,
    privateBucket,
    gets: () => gets,
    setGetHook: (hook: () => void) => {
      getHook = hook;
    },
  };
}

test("actual paid publisher capability decodes frames without a second billing hold and rejects its clone", async () => {
  const f = await paidFixture(),
    readers = createSanitizedReaders(f.core, { environment: "preview", bucket: f.privateBucket });
  let input: PublicationSanitizedInput | undefined;
  const service = createLawyerPublicationService(f.core, {
    environment: "preview",
    publicBucket: f.deps.publicBucket,
    paidStorage: () => f.costs,
    fixedLengthStream: f.deps.fixedLengthStream,
    openSanitized: async (value) => {
      input = value;
      if (!value.approvedReadPermit) throw new Error("Synthetic issued cap required");
      await expect(
        readers.publication({ ...value, approvedReadPermit: { ...value.approvedReadPermit } }),
      ).rejects.toMatchObject({ code: "BUDGET_UNAVAILABLE" });
      await expect(
        readers.publication({ ...value, sourceBlobId: crypto.randomUUID() }),
      ).rejects.toMatchObject({ code: "BUDGET_UNAVAILABLE" });
      return readers.publication(value);
    },
  });
  const copy = await service.copyApprovedAsset(f.owner.userId, f.profileId, 2, f.assetId);
  expect(f.objects.get(`public/${copy.blobId}`)).toEqual(f.bytes);
  expect(f.gets()).toBe(1);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_storage_paid_executions").get()).toEqual({
    n: 1,
  });
  expect(
    f.db.sqlite.query("SELECT reserved_krw,ambiguous_krw,settled_krw FROM v2_monthly_budget").get(),
  ).toEqual({ reserved_krw: 2000, ambiguous_krw: 0, settled_krw: 0 });
  if (!input) throw new Error("Synthetic captured input required");
  await expect(readers.publication(input)).rejects.toMatchObject({ code: "BUDGET_UNAVAILABLE" });
});

test("withdrawal during actual private GET denies the issued publication capability", async () => {
  const f = await paidFixture(),
    readers = createSanitizedReaders(f.core, { environment: "preview", bucket: f.privateBucket });
  f.setGetHook(() =>
    f.db.sqlite
      .query("UPDATE v2_profile_revisions SET status='withdrawn',withdrawn_at=? WHERE id=?")
      .run(new Date().toISOString(), f.revisionId),
  );
  const service = createLawyerPublicationService(f.core, {
    environment: "preview",
    publicBucket: f.deps.publicBucket,
    paidStorage: () => f.costs,
    fixedLengthStream: f.deps.fixedLengthStream,
    openSanitized: readers.publication,
  });
  await expect(
    service.copyApprovedAsset(f.owner.userId, f.profileId, 2, f.assetId),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect(f.objects.size).toBe(0);
});

test("publication authority is checked again before the second decrypted frame", async () => {
  const f = await paidFixture(),
    readers = createSanitizedReaders(f.core, { environment: "preview", bucket: f.privateBucket });
  const service = createLawyerPublicationService(f.core, {
    environment: "preview",
    publicBucket: f.deps.publicBucket,
    paidStorage: () => f.costs,
    fixedLengthStream: f.deps.fixedLengthStream,
    openSanitized: async (input) => {
      const decoded = await readers.publication(input),
        source = decoded.body.getReader();
      const first = await source.read();
      expect(first.value?.length).toBe(1_048_576);
      f.db.sqlite
        .query("DELETE FROM v2_role_bindings WHERE owner_id=? AND role='verified_lawyer'")
        .run(f.owner.userId);
      await expect(source.read()).rejects.toMatchObject({ code: "STALE_REVISION" });
      throw new Error("Synthetic expected revoked stream");
    },
  });
  await expect(
    service.copyApprovedAsset(f.owner.userId, f.profileId, 2, f.assetId),
  ).rejects.toThrow("Synthetic expected revoked stream");
  expect(f.objects.size).toBe(0);
});
