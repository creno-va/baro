import { expect, test } from "bun:test";
import { createV2AccountingRepository } from "../src/server/db/v2-accounting";
import { createV2LawyersRepository } from "../src/server/db/v2-lawyers";
import {
  createV2PaidRuntimeRepository,
  type PricingProof,
  type RuntimeProofVerifier,
} from "../src/server/db/v2-paid-runtime";
import {
  createStorageBudgetService,
  type StorageCostInput,
  type StorageCosts,
} from "../src/server/modules/budget/storage-ledger";
import { createLawyerAssetsService } from "../src/server/modules/lawyers/assets";
import { fixture } from "./helpers/file-processing-fixture";

const NOW = "2026-10-06T00:00:00.000Z",
  EXP = "2026-11-01T00:00:00.000Z",
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
  const f = await fixture(),
    accounting = createV2AccountingRepository(f.core, "preview"),
    runtime = createV2PaidRuntimeRepository(f.core, "preview", verify);
  const allocation = {
    month: "2026-10",
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
  expect(await runtime.putPricingProof(pricing, NOW)).toBe(true);
  expect(await runtime.putFundingProof(funding, NOW)).toBe(true);
  let current = NOW,
    hook: (() => Promise<void>) | undefined,
    afterFails = false,
    prepareHook: (() => Promise<void>) | undefined;
  const bridge = createStorageBudgetService({
    core: f.core,
    environment: "preview",
    ownerId: f.actor.ownerId,
    clock: () => current,
    bounds: async (_input, inputDigest, now) => ({
      inputDigest,
      evidenceHash: HASH,
      verifiedAt: now,
      validUntil: EXP,
      quantities: [{ sku: "r2_class_a_requests", maximumQuantity: "1" }],
    }),
  });
  const calls = { put: 0, head: 0 },
    objects = new Map<string, Uint8Array>();
  let onPut: (() => Promise<void>) | undefined,
    unknown = false;
  const bucket = {
    async put(key: string, body: ReadableStream<Uint8Array>) {
      calls.put++;
      const data = new Uint8Array(await new Response(body).arrayBuffer());
      await onPut?.();
      objects.set(key, data);
      if (unknown) throw new Error("Synthetic transport");
      return { key, size: data.length };
    },
    async get(key: string) {
      const data = objects.get(key);
      return data ? { key, size: data.length, body: new Response(data.slice()).body } : null;
    },
    async head(key: string) {
      calls.head++;
      const data = objects.get(key);
      return data ? { key, size: data.length } : null;
    },
    async delete(key: string) {
      objects.delete(key);
    },
  } as unknown as Pick<R2Bucket, "put" | "get" | "head" | "delete">;
  const costs: StorageCosts = {
    async prepare(input) {
      const result = await bridge.prepare(input);
      await prepareHook?.();
      return result;
    },
    async beforeDispatch(admission, access) {
      const permit = await bridge.beforeDispatch(admission, access);
      await hook?.();
      return permit;
    },
    async after(permit, transport) {
      if (afterFails) throw new Error("Synthetic durable failure");
      await bridge.after(permit, transport);
    },
  };
  const repository = createV2LawyersRepository(f.core),
    profileId = crypto.randomUUID();
  expect(await repository.createProfile(f.actor, profileId)).toBe(true);
  const queued: Array<{ assetRevision: number; operationId: string }> = [];
  const service = createLawyerAssetsService(f.core, {
    environment: "preview",
    bucket,
    clock: () => current,
    paidStorage: () => costs,
    fixedLengthStream: (length) => {
      let written = 0;
      return new TransformStream<Uint8Array, Uint8Array>({
        transform(v, c) {
          written += v.length;
          if (written > length) throw new Error("Synthetic size");
          c.enqueue(v);
        },
        flush() {
          if (written !== length) throw new Error("Synthetic size");
        },
      });
    },
    enqueueProcessing: async (input) => {
      queued.push(input);
      return true;
    },
  });
  const reservation = await service.reserve(
    f.actor.ownerId,
    1,
    crypto.randomUUID(),
    { purpose: "portfolio", name: "합성.pdf", byteLength: 5, mediaType: "application/pdf" },
    "portfolio",
  );
  return {
    ...f,
    service,
    costs,
    calls,
    objects,
    queued,
    reservation,
    profileId,
    put: () =>
      service.upload(
        f.actor.ownerId,
        reservation.assetId,
        1,
        5,
        new Response(new Uint8Array(5)).body,
      ),
    cost: () =>
      f.db.sqlite
        .query("SELECT reserved_krw,ambiguous_krw,settled_krw FROM v2_monthly_budget")
        .get(),
    setBefore: (value: () => Promise<void>) => {
      hook = value;
    },
    setPrepare: (value: () => Promise<void>) => {
      prepareHook = value;
    },
    setNow: (value: string) => {
      current = value;
    },
    setUnknown: () => {
      unknown = true;
    },
    setFailure: () => {
      afterFails = true;
    },
    setPut: (value: () => Promise<void>) => {
      onPut = value;
    },
  };
}

test("actual bridge→lawyer private binary→atomic uploaded receipt preserves reserved cost without inventing metering; enqueue unchanged", async () => {
  const f = await paidFixture();
  const result = await f.put();
  expect(result.processingQueued).toBe(true);
  expect(f.queued).toHaveLength(1);
  expect(f.queued[0]?.assetRevision).toBe(2);
  expect(f.calls).toEqual({ put: 1, head: 0 });
  expect(f.cost()).toEqual({ reserved_krw: 1000, ambiguous_krw: 0, settled_krw: 0 });
  expect(f.db.sqlite.query("SELECT state FROM v2_storage_paid_executions").get()).toEqual({
    state: "dispatched",
  });
  expect(f.db.sqlite.query("SELECT state FROM v2_blobs").get()).toEqual({ state: "stored" });
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_jobs").get()).toEqual({ n: 0 });
  const opened = await f.service.open(f.actor.ownerId, f.reservation.assetId);
  expect(new Uint8Array(await new Response(opened.body).arrayBuffer())).toEqual(new Uint8Array(5));
});
test("actual pending failure rolls back cost+intent; concurrent original admission has one paid winner", async () => {
  const f = await paidFixture();
  f.db.sqlite.exec(
    "CREATE TRIGGER reject_blob BEFORE INSERT ON v2_blobs BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  );
  await expect(f.put()).rejects.toThrow();
  expect(f.calls.put).toBe(0);
  expect(f.cost()).toEqual({ reserved_krw: 0, ambiguous_krw: 0, settled_krw: 0 });
  f.db.sqlite.exec("DROP TRIGGER reject_blob");
  const results = await Promise.allSettled([f.put(), f.put()]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(f.calls.put).toBe(1);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_cost_attempts").get()).toEqual({ n: 1 });
});
test("current consent removed during trusted prepare leaves neither paid hold nor pending intent", async () => {
  const f = await paidFixture();
  f.setPrepare(async () => {
    f.db.sqlite.exec("DELETE FROM user_consents");
  });
  await expect(f.put()).rejects.toThrow();
  expect(f.calls.put).toBe(0);
  expect(f.cost()).toEqual({ reserved_krw: 0, ambiguous_krw: 0, settled_krw: 0 });
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_blobs").get()).toEqual({ n: 0 });
});
test("advancing consumer clock uses the exact immutable preparation actor for the one-batch pending binding", async () => {
  const f = await paidFixture();
  f.setPrepare(async () => {
    f.setNow("2026-10-06T00:00:01.000Z");
  });
  await f.put();
  expect(f.calls.put).toBe(1);
  expect(f.db.sqlite.query("SELECT created_at FROM v2_storage_paid_executions").get()).toEqual({
    created_at: NOW,
  });
  expect(f.cost()).toEqual({ reserved_krw: 1000, ambiguous_krw: 0, settled_krw: 0 });
});
for (const mutation of ["clock", "policy", "pending"] as const)
  test(`fresh ${mutation} after dispatch await denies R2 and preserves irreversible hold`, async () => {
    const f = await paidFixture();
    f.setBefore(async () => {
      if (mutation === "clock") f.setNow("2026-10-06T00:06:00.000Z");
      else if (mutation === "policy") f.db.sqlite.exec("DELETE FROM user_consents");
      else f.db.sqlite.exec("UPDATE v2_blobs SET encrypted_payload='removed'");
    });
    await expect(f.put()).rejects.toThrow();
    expect(f.calls).toEqual({ put: 0, head: 0 });
    expect(f.cost()).toEqual({ reserved_krw: 1000, ambiguous_krw: 0, settled_krw: 0 });
  });
test("ambiguous sent PUT and durable-after failure journal captured intent without unreserved HEAD or uploaded pointer", async () => {
  const f = await paidFixture();
  f.setUnknown();
  await expect(f.put()).rejects.toThrow();
  expect(f.calls).toEqual({ put: 1, head: 0 });
  expect(f.cost()).toEqual({ reserved_krw: 1000, ambiguous_krw: 0, settled_krw: 0 });
  expect(f.db.sqlite.query("SELECT original_blob_id FROM v2_assets").get()).toEqual({
    original_blob_id: null,
  });
  expect(f.db.sqlite.query("SELECT state FROM v2_blobs").get()).toEqual({ state: "deleting" });
  const g = await paidFixture();
  g.setFailure();
  await expect(g.put()).rejects.toThrow();
  expect(g.calls).toEqual({ put: 1, head: 0 });
  expect(g.queued).toHaveLength(0);
  expect(g.db.sqlite.query("SELECT original_blob_id FROM v2_assets").get()).toEqual({
    original_blob_id: null,
  });
});
test("immutable unknown-hash pending descriptor cannot substitute a paid physical tuple", async () => {
  const f = await paidFixture(),
    prepare = f.costs.prepare.bind(f.costs);
  f.costs.prepare = (input: StorageCostInput) =>
    prepare({ ...input, pending: { ...input.pending, keyVersion: "binary_v1" } });
  await expect(f.put()).rejects.toThrow();
  expect(f.calls.put).toBe(0);
  expect(f.cost()).toEqual({ reserved_krw: 0, ambiguous_krw: 0, settled_krw: 0 });
});
test("policy withdrawn while actual binary PUT is running blocks uploaded pointer and preserves cleanup exposure", async () => {
  const f = await paidFixture();
  f.setPut(async () => {
    f.db.sqlite.exec("DELETE FROM user_consents");
  });
  await expect(f.put()).rejects.toThrow("STALE_REVISION");
  expect(f.calls).toEqual({ put: 1, head: 0 });
  expect(f.db.sqlite.query("SELECT original_blob_id FROM v2_assets").get()).toEqual({
    original_blob_id: null,
  });
  expect(f.cost()).toEqual({ reserved_krw: 1000, ambiguous_krw: 0, settled_krw: 0 });
});
test("production refuses preview-only unmetered dependency before consuming the original body", async () => {
  const f = await paidFixture();
  let reads = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull() {
        reads++;
      },
    },
    { highWaterMark: 0 },
  );
  const service = createLawyerAssetsService(f.core, {
    environment: "production",
    bucket: f.bucket.port,
    testOnlyUnmeteredStorage: true,
  });
  await expect(service.upload(f.actor.ownerId, f.reservation.assetId, 1, 5, body)).rejects.toThrow(
    "PROCESSING_UNAVAILABLE",
  );
  expect(reads).toBe(0);
});
