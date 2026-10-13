import { expect, test } from "bun:test";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts/consent";
import { createV2DeletionRepository } from "../src/server/db/v2-deletion";
import type { PricingProof, RuntimeProofVerifier } from "../src/server/db/v2-paid-runtime";
import { createV2StoragePaidRuntimeRepository } from "../src/server/db/v2-storage-paid-runtime";
import { createFilesService, type FileStorageCosts } from "../src/server/modules/files/service";
import { fixture, r2 } from "./helpers/file-processing-fixture";
import { seedStorageAdmissionProjection } from "./helpers/storage-admission";
import { ready } from "./helpers/storage-capacity";

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
  const p = await ready();
  const f = {
    ...p,
    bucket: r2(),
    rev: () =>
      Number(
        (
          p.db.sqlite.query("SELECT revision FROM v2_workspaces WHERE id=?").get(p.workspaceId) as {
            revision: number;
          }
        ).revision,
      ),
  };
  const runtime = f.runtime;
  f.db.sqlite
    .query("INSERT INTO v2_case_original_usage(workspace_id) VALUES(?)")
    .run(f.workspaceId);
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
  seedStorageAdmissionProjection(f.db, {
    pricingId: pricing.id,
    fundingId: funding.id,
    allocationId: ap.id,
    now: NOW,
    expiry: EXP,
  });
  const storage = createV2StoragePaidRuntimeRepository(f.core, "preview", verify);
  let current = NOW,
    beforeHook: (() => Promise<void>) | undefined,
    prepareHook: (() => Promise<void>) | undefined,
    persistenceFails = false;
  const observations: string[] = [];
  const paid: FileStorageCosts = {
    async prepare(input) {
      const request = {
        attemptId: crypto.randomUUID(),
        quoteId: crypto.randomUUID(),
        planId: crypto.randomUUID(),
        pricingProofId: pricing.id,
        fundingProofId: funding.id,
        attempt: input.attemptOrdinal,
        service: input.service,
        targetKind: input.targetKind,
        targetId: input.targetId,
        targetRevision: input.targetRevision,
        reservationId: input.reservationId,
        blobId: input.blobId,
        pending: input.pending,
        intent: input.intent,
        plan: {
          operationId: input.operationId,
          operationRevision: input.operationRevision,
          requestHash: input.requestHash,
          invocationId: input.runId,
          quantities: [{ sku: "r2_class_a_requests" as const, maximumQuantity: "1" }],
          maximumAttempts: input.maximumAttempts,
          deadlineAt: input.deadlineAt,
        },
      };
      const p = await storage.prepareHold({ ...f.actor, now: current }, request);
      await prepareHook?.();
      return p ? { actor: p.actor, paid: p, request: p.request, inputDigest: HASH } : null;
    },
    async beforeDispatch(admission, access) {
      if (!(await access())) return null;
      const permit = await storage.beforeDispatch(
        { ...f.actor, now: current },
        admission.request.attemptId,
      );
      await beforeHook?.();
      return permit;
    },
    async after(permit, transport) {
      observations.push(transport.transport);
      if (persistenceFails) throw new Error("Synthetic durable failure");
      // Local PUT is never authenticated billing evidence: retain full exposure.
      await storage.recordUsage(
        {
          id: crypto.randomUUID(),
          attemptId: permit.attemptId,
          invocationId: (
            f.db.sqlite
              .query("SELECT invocation_id FROM v2_cost_attempts WHERE id=?")
              .get(permit.attemptId) as { invocation_id: string }
          ).invocation_id,
          providerRequestId: null,
          dispatchToken: permit.dispatchToken,
          observedAt: transport.observedAt,
          transport: transport.transport,
          definitiveNoCharge: transport.definitiveNoCharge,
          meteringComplete: false,
          quantities: [],
          chargedUsd: null,
          modelTokenDetails: null,
        },
        current,
      );
    },
  };
  const service = createFilesService(f.core, {
    environment: "preview",
    bucket: f.bucket.port,
    paidStorage: paid,
    clock: () => current,
  });
  const reservation = await service.reserve(
    f.actor.ownerId,
    f.workspaceId,
    f.rev(),
    crypto.randomUUID(),
    {
      name: "합성.txt",
      byteLength: 5,
      mediaType: "text/plain",
      autoProcessConsentVersion: CURRENT_POLICY_VERSIONS.aiNoticeVersion,
    },
  );
  return {
    ...f,
    service,
    paid,
    observations,
    put: () =>
      service.putPart(
        f.actor.ownerId,
        f.workspaceId,
        reservation.fileId,
        reservation.uploadSession,
        0,
        new Response(new Uint8Array(5)).body,
      ),
    cost: () =>
      f.db.sqlite
        .query("SELECT reserved_krw,ambiguous_krw,settled_krw FROM v2_monthly_budget")
        .get(),
    setNow: (value: string) => {
      current = value;
    },
    setBefore: (hook: () => Promise<void>) => {
      beforeHook = hook;
    },
    setPrepare: (hook: () => Promise<void>) => {
      prepareHook = hook;
    },
    setFailure: () => {
      persistenceFails = true;
    },
  };
}

test("actual file consumer atomically binds encrypted pending intent and hold; PUT receipt retains unknown billing", async () => {
  const f = await paidFixture();
  await f.put();
  expect(f.bucket.calls.put).toBe(1);
  expect(f.cost()).toEqual({ reserved_krw: 0, ambiguous_krw: 1000, settled_krw: 0 });
  expect(f.db.sqlite.query("SELECT state FROM v2_storage_paid_executions").get()).toEqual({
    state: "unknown",
  });
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_upload_parts").get()).toEqual({ n: 1 });
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_jobs").get()).toEqual({ n: 0 });
  expect(
    f.db.sqlite.query("SELECT state,writer_state FROM v2_physical_blob_bindings").get(),
  ).toEqual({ state: "held", writer_state: "stopped" });
});
test("pending INSERT failure rolls back financial hold; concurrent uploads admit at most one exact ordinal", async () => {
  const f = await paidFixture();
  f.db.sqlite.exec(
    "CREATE TRIGGER reject_blob BEFORE INSERT ON v2_blobs BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  );
  await expect(f.put()).rejects.toThrow();
  expect(f.cost()).toEqual({ reserved_krw: 0, ambiguous_krw: 0, settled_krw: 0 });
  expect(f.bucket.calls.put).toBe(0);
  f.db.sqlite.exec("DROP TRIGGER reject_blob");
  const results = await Promise.allSettled([f.put(), f.put()]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(f.bucket.calls.put).toBe(1);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_cost_attempts").get()).toEqual({ n: 1 });
});
test("consent removed after prepare denies atomic pending/hold admission", async () => {
  const f = await paidFixture();
  f.setPrepare(async () => {
    f.db.sqlite.exec("DELETE FROM v2_consents");
  });
  await expect(f.put()).rejects.toThrow();
  expect(f.bucket.calls.put).toBe(0);
  expect(f.cost()).toEqual({ reserved_krw: 0, ambiguous_krw: 0, settled_krw: 0 });
});
test("fresh clock after dispatch await denies expired remote PUT without refunding dispatched exposure", async () => {
  const f = await paidFixture();
  f.setBefore(async () => {
    f.setNow("2026-10-06T00:06:00.000Z");
  });
  await expect(f.put()).rejects.toThrow();
  expect(f.bucket.calls.put).toBe(0);
  expect(f.observations).toEqual(["not_sent"]);
  expect(f.cost()).toEqual({ reserved_krw: 1000, ambiguous_krw: 0, settled_krw: 0 });
  expect(f.db.sqlite.query("SELECT writer_state FROM v2_physical_blob_bindings").get()).toEqual({
    writer_state: "stopped",
  });
});
test("actual R2 ambiguity and ledger persistence failure block original receipt publication", async () => {
  const f = await paidFixture();
  f.bucket.setPutAmbiguous(true);
  await expect(f.put()).rejects.toThrow();
  expect(f.observations).toEqual(["unknown"]);
  expect(f.cost()).toEqual({ reserved_krw: 0, ambiguous_krw: 1000, settled_krw: 0 });
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_upload_parts").get()).toEqual({ n: 0 });
  expect(
    f.db.sqlite.query("SELECT state,writer_state FROM v2_physical_blob_bindings").get(),
  ).toEqual({ state: "held", writer_state: "running" });
  const deletion = createV2DeletionRepository(f.core);
  const blob = f.db.sqlite.query("SELECT id FROM v2_blobs").get() as { id: string };
  const journal = await deletion.findByTarget("blob", blob.id);
  if (!journal) throw new Error("Synthetic ambiguous write journal missing");
  const lease = await deletion.acquire(
    journal.id,
    crypto.randomUUID(),
    NOW,
    "2026-10-06T00:04:00.000Z",
  );
  if (!lease) throw new Error("Synthetic cleanup lease missing");
  expect(await f.service.cleanup(lease)).toBe(false);
  expect(f.bucket.calls.delete).toBe(0);
  const g = await paidFixture();
  g.setFailure();
  await expect(g.put()).rejects.toThrow();
  expect(g.cost()).toEqual({ reserved_krw: 1000, ambiguous_krw: 0, settled_krw: 0 });
  expect(g.db.sqlite.query("SELECT state FROM v2_blobs").get()).toEqual({ state: "deleting" });
  expect(g.db.sqlite.query("SELECT count(*) n FROM v2_upload_parts").get()).toEqual({ n: 0 });
  expect(
    g.db.sqlite.query("SELECT state,writer_state FROM v2_physical_blob_bindings").get(),
  ).toEqual({ state: "held", writer_state: "stopped" });
});
test("production cannot use the explicit unmetered offline dependency", async () => {
  const f = await fixture();
  const service = createFilesService(f.core, {
    environment: "production",
    bucket: f.bucket.port,
    testOnlyUnmeteredStorage: true,
  });
  await expect(
    service.reserve(f.actor.ownerId, f.workspaceId, f.rev(), crypto.randomUUID(), {
      name: "합성",
      byteLength: 5,
      mediaType: "text/plain",
      autoProcessConsentVersion: CURRENT_POLICY_VERSIONS.aiNoticeVersion,
    }),
  ).rejects.toThrow("PROCESSING_UNAVAILABLE");
  expect(f.bucket.calls.put).toBe(0);
});

test("missing active controls and substituted physical tuple never create pending blobs or costs", async () => {
  const f = await paidFixture();
  f.db.sqlite.exec("UPDATE v2_runtime_controls SET phase='frozen'");
  await expect(f.put()).rejects.toThrow("CONFLICT");
  expect(f.bucket.calls.put).toBe(0);
  expect(f.cost()).toEqual({ reserved_krw: 0, ambiguous_krw: 0, settled_krw: 0 });
  const g = await paidFixture(),
    prepare = g.paid.prepare.bind(g.paid);
  g.paid.prepare = (input) =>
    prepare({ ...input, pending: { ...input.pending, cipherHash: "b".repeat(64) } });
  await expect(g.put()).rejects.toThrow("CONFLICT");
  expect(g.bucket.calls.put).toBe(0);
  expect(g.cost()).toEqual({ reserved_krw: 0, ambiguous_krw: 0, settled_krw: 0 });
  expect(g.db.sqlite.query("SELECT count(*) n FROM v2_blobs").get()).toEqual({ n: 0 });
});
test("consent withdrawn after dispatch await prevents PUT and preserves committed dispatch exposure", async () => {
  const f = await paidFixture();
  f.setBefore(async () => {
    f.db.sqlite.exec("DELETE FROM v2_consents");
  });
  await expect(f.put()).rejects.toThrow("CONFLICT");
  expect(f.bucket.calls.put).toBe(0);
  expect(f.cost()).toEqual({ reserved_krw: 1000, ambiguous_krw: 0, settled_krw: 0 });
  expect(f.db.sqlite.query("SELECT state FROM v2_storage_paid_executions").get()).toEqual({
    state: "dispatched",
  });
});
test("pending envelope changed after dispatch await cannot send the captured binary", async () => {
  const f = await paidFixture();
  f.setBefore(async () => {
    f.db.sqlite.exec("UPDATE v2_blobs SET encrypted_payload='removed'");
  });
  await expect(f.put()).rejects.toThrow("STORAGE_UNAVAILABLE");
  expect(f.bucket.calls.put).toBe(0);
  expect(f.cost()).toEqual({ reserved_krw: 1000, ambiguous_krw: 0, settled_krw: 0 });
  // The recovery capability cannot attest to a substituted pending envelope.
  expect(f.db.sqlite.query("SELECT writer_state FROM v2_physical_blob_bindings").get()).toEqual({
    writer_state: "running",
  });
});
