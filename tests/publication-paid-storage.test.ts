import { expect, test } from "bun:test";
import { usageDateKst } from "../src/server/db/repository";
import { createV2AccountingRepository } from "../src/server/db/v2-accounting";
import {
  createV2PaidRuntimeRepository,
  type PricingProof,
  type RuntimeProofVerifier,
} from "../src/server/db/v2-paid-runtime";
import {
  createStorageBudgetService,
  type StorageCosts,
} from "../src/server/modules/budget/storage-ledger";
import {
  authorizePublicationRead,
  createLawyerPublicationService,
  type PublicationSanitizedInput,
} from "../src/server/modules/lawyers/publication";
import { publicationFixture } from "./helpers/lawyer-publication";

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
  const f = await publicationFixture(),
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
  let current = new Date().toISOString(),
    hook: (() => Promise<void>) | undefined,
    decoderHook: (() => Promise<void>) | undefined,
    afterFails = false,
    prepareHook: (() => Promise<void>) | undefined;
  const calls = { get: 0, head: 0 },
    bridge = createStorageBudgetService({
      core: f.core,
      environment: "preview",
      ownerId: f.owner.userId,
      clock: () => current,
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
  const costs: StorageCosts = {
    async prepare(input) {
      const result = await bridge.prepare(input);
      await prepareHook?.();
      return result;
    },
    async beforeDispatch(admission, access) {
      const result = await bridge.beforeDispatch(admission, access);
      await hook?.();
      return result;
    },
    async after(permit, transport) {
      if (afterFails) throw new Error("Synthetic durable failure");
      await bridge.after(permit, transport);
    },
  };
  let captured: PublicationSanitizedInput | undefined;
  const bucket = {
    put: f.deps.publicBucket.put.bind(f.deps.publicBucket),
    get: f.deps.publicBucket.get.bind(f.deps.publicBucket),
    delete: f.deps.publicBucket.delete.bind(f.deps.publicBucket),
    async head(key: string) {
      calls.head++;
      return f.deps.publicBucket.head(key);
    },
  };
  const service = createLawyerPublicationService(f.core, {
    environment: "preview",
    clock: () => current,
    publicBucket: bucket,
    paidStorage: () => costs,
    fixedLengthStream: f.deps.fixedLengthStream,
    openSanitized: async (input) => {
      captured = input;
      if (!input.approvedReadPermit) throw new Error("Synthetic scoped permit missing");
      expect(await authorizePublicationRead(input)).toBe(true);
      expect(
        await authorizePublicationRead({
          ...input,
          approvedReadPermit: { ...input.approvedReadPermit },
        }),
      ).toBe(false);
      expect(await authorizePublicationRead({ ...input, sourceBlobId: crypto.randomUUID() })).toBe(
        false,
      );
      await decoderHook?.();
      if (!(await authorizePublicationRead(input)))
        throw new Error("Synthetic scoped decoder denied");
      calls.get++;
      const { approvedReadPermit: _cap, ...source } = input;
      return f.deps.openSanitized(source);
    },
  });
  return {
    ...f,
    service,
    costs,
    calls,
    copy: () => service.copyApprovedAsset(f.owner.userId, f.profileId, 2, f.assetId),
    cost: () =>
      f.db.sqlite
        .query("SELECT reserved_krw,ambiguous_krw,settled_krw FROM v2_monthly_budget")
        .get(),
    captured: () => captured,
    setBefore: (value: () => Promise<void>) => {
      hook = value;
    },
    setDecoder: (value: () => Promise<void>) => {
      decoderHook = value;
    },
    setPrepare: (value: () => Promise<void>) => {
      prepareHook = value;
    },
    setNow: (value: string) => {
      current = value;
    },
    setFailure: () => {
      afterFails = true;
    },
  };
}

test("manual approved publication operation funds exact scoped GET+PUT before public receipt; prior durable copy replay makes no HEAD/GET/PUT", async () => {
  const f = await paidFixture(),
    copy = await f.copy();
  expect(f.calls).toEqual({ get: 1, head: 0 });
  expect(f.count()).toBe(1);
  expect(f.cost()).toEqual({ reserved_krw: 2000, ambiguous_krw: 0, settled_krw: 0 });
  const binding = f.db.sqlite
    .query(
      "SELECT r.operation_id AS reservation_operation,h.operation_id AS paid_operation,o.kind FROM v2_storage_reservations r JOIN v2_storage_paid_executions h ON h.reservation_id=r.id JOIN v2_operations o ON o.id=h.operation_id WHERE r.target_id=?",
    )
    .get(copy.blobId) as { reservation_operation: string; paid_operation: string; kind: string };
  expect(binding.kind).toBe("profile_revision");
  expect(binding.reservation_operation).toBe(binding.paid_operation);
  expect(binding.paid_operation).not.toBe("synthetic_upstream");
  expect(await f.copy()).toEqual(copy);
  expect(f.calls).toEqual({ get: 1, head: 0 });
  expect(f.count()).toBe(1);
  const captured = f.captured();
  if (!captured) throw new Error("Synthetic capability missing");
  expect(await authorizePublicationRead(captured)).toBe(false);
  expect((await f.service.finalize(f.owner.userId, f.profileId, 2)).approvedRevision).toBe(2);
});
test("concurrent public copies atomically reserve independent additive exposure and private source authority", async () => {
  const f = await paidFixture();
  const results = await Promise.allSettled([f.copy(), f.copy()]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
  expect(f.calls).toEqual({ get: 2, head: 0 });
  expect(f.cost()).toEqual({ reserved_krw: 4000, ambiguous_krw: 0, settled_krw: 0 });
  expect(f.count()).toBe(2);
});
test("pending SQL failure rolls back public reservation and financial hold before decoder/R2", async () => {
  const f = await paidFixture();
  f.db.sqlite.exec(
    "CREATE TRIGGER reject_public BEFORE INSERT ON v2_blobs WHEN NEW.kind='public_copy' BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  );
  await expect(f.copy()).rejects.toThrow();
  expect(f.calls).toEqual({ get: 0, head: 0 });
  expect(f.count()).toBe(0);
  expect(f.cost()).toEqual({ reserved_krw: 0, ambiguous_krw: 0, settled_krw: 0 });
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_storage_paid_executions").get()).toEqual({
    n: 0,
  });
  expect(await f.repository.publicProfile(f.profileId)).toBeNull();
});
for (const field of ["funding", "outbox", "global_policy"] as const)
  test(`missing ${field} fails before the scoped private read`, async () => {
    const f = await paidFixture();
    if (field === "funding") f.db.sqlite.exec("UPDATE v2_runtime_controls SET phase='frozen'");
    else if (field === "outbox") f.db.sqlite.exec("UPDATE v2_outbox SET state='failed'");
    else f.db.sqlite.exec("DELETE FROM user_consents");
    await expect(f.copy()).rejects.toThrow();
    expect(f.calls).toEqual({ get: 0, head: 0 });
    expect(f.count()).toBe(0);
    expect(f.cost()).toEqual({ reserved_krw: 0, ambiguous_krw: 0, settled_krw: 0 });
  });
test("withdrawal after preparation rolls back immutable approved source admission", async () => {
  const f = await paidFixture();
  f.setPrepare(async () => {
    f.db.sqlite
      .query("UPDATE v2_profile_revisions SET status='withdrawn' WHERE id=?")
      .run(f.revisionId);
  });
  await expect(f.copy()).rejects.toThrow();
  expect(f.calls.get).toBe(0);
  expect(f.cost()).toEqual({ reserved_krw: 0, ambiguous_krw: 0, settled_krw: 0 });
});
for (const stage of ["before_get", "after_get"] as const)
  test(`withdrawal ${stage} denies actual copy and retains committed exposure`, async () => {
    const f = await paidFixture(),
      withdraw = async () => {
        f.db.sqlite
          .query("UPDATE v2_profile_revisions SET status='withdrawn' WHERE id=?")
          .run(f.revisionId);
      };
    if (stage === "before_get") f.setBefore(withdraw);
    else f.setDecoder(withdraw);
    await expect(f.copy()).rejects.toThrow();
    expect(f.count()).toBe(0);
    expect(f.calls.head).toBe(0);
    expect(f.cost()).toEqual({ reserved_krw: 2000, ambiguous_krw: 0, settled_krw: 0 });
  });
test("late public PUT and aggregate durable failure leave captured cleanup without HEAD or public pointer", async () => {
  const f = await paidFixture();
  f.rejectPut();
  await expect(f.copy()).rejects.toThrow();
  expect(f.calls).toEqual({ get: 1, head: 0 });
  expect(f.cost()).toEqual({ reserved_krw: 2000, ambiguous_krw: 0, settled_krw: 0 });
  expect(await f.repository.publicProfile(f.profileId)).toBeNull();
  const g = await paidFixture();
  g.setFailure();
  await expect(g.copy()).rejects.toThrow();
  expect(g.calls).toEqual({ get: 1, head: 0 });
  expect(g.db.sqlite.query("SELECT state FROM v2_blobs WHERE kind='public_copy'").get()).toEqual({
    state: "deleting",
  });
  expect(g.cost()).toEqual({ reserved_krw: 2000, ambiguous_krw: 0, settled_krw: 0 });
  expect(await g.repository.publicProfile(g.profileId)).toBeNull();
});
test("postdispatch expired clock denies the private decoder without refunding its aggregate hold", async () => {
  const f = await paidFixture();
  f.setBefore(async () => {
    f.setNow(new Date(Date.now() + 360000).toISOString());
  });
  await expect(f.copy()).rejects.toThrow();
  expect(f.calls).toEqual({ get: 0, head: 0 });
  expect(f.cost()).toEqual({ reserved_krw: 2000, ambiguous_krw: 0, settled_krw: 0 });
});
