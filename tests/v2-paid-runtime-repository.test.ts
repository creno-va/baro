import { afterEach, expect, test } from "bun:test";
import { createCaseDataCipher } from "../src/server/crypto";
import {
  type BudgetAllocation,
  createV2AccountingRepository,
} from "../src/server/db/v2-accounting";
import { type Actor, createV2Core } from "../src/server/db/v2-core";
import { createV2FilesRepository } from "../src/server/db/v2-files";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createV2LawyersRepository } from "../src/server/db/v2-lawyers";
import {
  createV2PaidRuntimeRepository,
  type FundingProof,
  type PaidHoldRequest,
  type PricingProof,
  pricingProofSchema,
  type RuntimeProofVerifier,
  runtimeDigest,
  type UsageReceipt,
} from "../src/server/db/v2-paid-runtime";
import { createV2ReportsRepository } from "../src/server/db/v2-reports";
import { createV2StorageRepository } from "../src/server/db/v2-storage";
import { createV2UploadProbeRepository } from "../src/server/db/v2-upload-probe";
import { createProcessingBudgetService } from "../src/server/modules/budget/processing-ledger";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const NOW = "2026-10-06T00:00:00.000Z",
  LATER = "2026-10-06T00:02:00.000Z",
  EXP = "2026-11-01T00:00:00.000Z",
  HASH = "a".repeat(64);
const dbs: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});
// Explicit synthetic authenticator. This is not actual pricing/funding/provider
// evidence, and no network/cloud/model call is performed by this suite.
const verifier: RuntimeProofVerifier = async (kind, _payload, digest) => ({
  digest,
  evidenceHash: "e".repeat(64),
  method:
    kind === "funding"
      ? "authenticated_console"
      : kind === "pricing"
        ? "official_document"
        : kind === "usage" || kind === "maintenance"
          ? "provider_receipt"
          : "authenticated_coordinator",
  verifiedAt: NOW,
});
function allocation(version = 1): BudgetAllocation {
  return {
    month: "2026-10",
    version,
    previewKrw: 10000,
    productionKrw: 20000,
    sharedFixedKrw: 100,
    maintenanceReserveKrw: 100,
    pricingProvenance: "synthetic public pricing",
    fxProvenance: "synthetic FX",
    fundingProvenance: "synthetic console",
    reviewedAt: NOW,
    validUntil: EXP,
    fundingState: "trial_credit",
    fundingValidUntil: EXP,
    manifestHash: HASH,
  };
}
function pricing(): PricingProof {
  return {
    id: crypto.randomUUID(),
    version: 1,
    environment: "preview",
    modelBillingPolicy: {
      contextThresholdTokens: 272000,
      serviceTier: "default",
      processingRegion: "global",
      regionMultiplier: "1",
    },
    prices: [
      {
        sku: "model_input_tokens",
        modelRates: ["short", "long"].flatMap((contextTier) =>
          ["ordinary", "cached_read", "cache_write"].map((cacheClass) => ({
            contextTier: contextTier as "short" | "long",
            cacheClass: cacheClass as "ordinary" | "cached_read" | "cache_write",
            usdPerUnit: "0.999",
          })),
        ),
        provider: "openai",
        model: "openai/gpt-6-sol",
        region: "global",
        plan: "unified_billing",
        billingMode: "metered",
        unit: "tokens",
        unitSize: "1000",
        usdPerUnit: "0.999",
        billingQuantum: "1",
        officialUrl: "https://developers.cloudflare.com/ai-gateway/",
        checkedAt: NOW,
        validUntil: EXP,
      },
      {
        sku: "model_output_tokens",
        modelRates: ["short", "long"].map((contextTier) => ({
          contextTier: contextTier as "short" | "long",
          cacheClass: "not_applicable" as const,
          usdPerUnit: "0.01",
        })),
        provider: "openai",
        model: "openai/gpt-6-sol",
        region: "global",
        plan: "unified_billing",
        billingMode: "metered",
        unit: "tokens",
        unitSize: "1000",
        usdPerUnit: "0.01",
        billingQuantum: "1",
        officialUrl: "https://developers.cloudflare.com/ai-gateway/",
        checkedAt: NOW,
        validUntil: EXP,
      },
    ],
    fx: {
      krwPerUsd: "1000",
      authority: "synthetic authority",
      referenceUrl: "https://example.test/fx",
      asOf: NOW,
      checkedAt: NOW,
      validUntil: EXP,
    },
    taxRatio: "0",
    feeRatio: "0",
    safetyMarginRatio: "0",
    hiddenAttemptMultiplier: 1,
    hiddenRetryReference: "synthetic reviewed bound",
    checkedAt: NOW,
    validUntil: EXP,
  };
}
function funding(): FundingProof {
  return {
    id: crypto.randomUUID(),
    environment: "preview",
    state: "trial_credit",
    existingPaymentPath: true,
    autoRecharge: false,
    spendAllowanceKrw: 10000,
    reference: "synthetic-credit-observation",
    observedAt: NOW,
    validUntil: EXP,
  };
}
async function fixture() {
  const db = await createTestDatabase();
  dbs.push(db);
  const session = await seedTestSession(db, { now: Date.parse(NOW), consent: true });
  const cipher = await createCaseDataCipher({
    CASE_DATA_KEY_V1: btoa("d".repeat(32)).replace(/=+$/u, ""),
  });
  const core = createV2Core(db.binding, cipher),
    actor: Actor = { ownerId: session.userId, now: NOW };
  const accounting = createV2AccountingRepository(core, "preview"),
    jobs = createV2JobsRepository(core),
    runtime = createV2PaidRuntimeRepository(core, "preview", verifier);
  await accounting.ensurePrincipal(actor);
  const a = allocation();
  await accounting.recordAllocation(a);
  for (const environment of ["preview", "production"] as const)
    await accounting.recordAllocationAcknowledgment({
      month: a.month,
      version: a.version,
      environment,
      manifestHash: HASH,
      drainReceiptId: crypto.randomUUID(),
      now: NOW,
    });
  expect(await accounting.activateAllocation(a.month, a.version, NOW)).toBe(true);
  expect(await runtime.initializeControl(a.month, NOW)).toBe(true);
  const ap = { id: crypto.randomUUID(), environment: "preview" as const, allocation: a };
  expect(await runtime.putAllocationProof(ap, NOW)).toBe(true);
  const drain = await runtime.drain(a.month, 1, ap.id, NOW);
  expect(drain).not.toBeNull();
  if (!drain) throw new Error("synthetic fixture drain missing");
  expect(await runtime.putRemoteDrainProof(drain, NOW)).toBe(true);
  const remote = {
    ...drain,
    id: crypto.randomUUID(),
    environment: "production" as const,
    limitKrw: 20000,
  };
  expect(await runtime.putRemoteDrainProof(remote, NOW)).toBe(true);
  expect(await runtime.activate(a.month, 2, ap.id, drain.id, remote.id, NOW)).toBe(true);
  const pp = pricing(),
    fp = funding();
  expect(await runtime.putPricingProof(pp, NOW)).toBe(true);
  expect(await runtime.putFundingProof(fp, NOW)).toBe(true);
  const workspaceId = crypto.randomUUID();
  const envelope = await core.encrypt("v2_workspaces", workspaceId, actor.ownerId, 1, {
    subjectContext: "individual",
    jurisdiction: "KR",
  });
  db.sqlite
    .query(
      "INSERT INTO v2_workspaces(id,owner_id,status,confirmed_summary_revision,encrypted_payload,created_at,updated_at) VALUES(?,?,'active',1,?,?,?)",
    )
    .run(workspaceId, actor.ownerId, envelope, NOW, NOW);
  return { db, core, actor, accounting, jobs, runtime, pp, fp, workspaceId, ap, drain, remote };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function uploadProbeFixture() {
  const f = await fixture();
  f.db.sqlite
    .query("INSERT INTO v2_case_original_usage(workspace_id) VALUES(?)")
    .run(f.workspaceId);
  const uploadId = crypto.randomUUID(),
    fileId = crypto.randomUUID();
  expect(
    await createV2FilesRepository(f.core).reserve(
      { ...f.actor, workspaceId: f.workspaceId, expectedRevision: 1 },
      {
        name: "합성.pdf",
        byteLength: 100,
        mediaType: "application/pdf",
        autoProcessConsentVersion: "synthetic",
      },
      {
        fileId,
        uploadId,
        reservationId: crypto.randomUUID(),
        consentId: crypto.randomUUID(),
        expiresAt: EXP,
        admission: {
          operationId: crypto.randomUUID(),
          key: crypto.randomUUID(),
          requestHash: HASH,
        },
      },
    ),
  ).toBeTruthy();
  const probes = createV2UploadProbeRepository(f.core);
  const p: PricingProof = {
    ...f.pp,
    id: crypto.randomUUID(),
    modelBillingPolicy: null,
    prices: [
      {
        sku: "container_cpu_seconds",
        provider: "cloudflare",
        model: null,
        modelRates: null,
        region: "global",
        plan: "synthetic-paid",
        billingMode: "metered",
        unit: "vcpu_seconds",
        unitSize: "1",
        usdPerUnit: "0.0001",
        billingQuantum: "0.01",
        officialUrl: "https://developers.cloudflare.com/containers/pricing/",
        checkedAt: NOW,
        validUntil: EXP,
      },
    ],
  };
  expect(await f.runtime.putPricingProof(p, NOW)).toBe(true);
  const completePricing: PricingProof = {
    ...p,
    id: crypto.randomUUID(),
    prices: [
      ...p.prices,
      ...(["container_memory_gib_seconds", "container_disk_gb_seconds"] as const).map((sku) => ({
        ...p.prices[0]!,
        sku,
        unit:
          sku === "container_memory_gib_seconds"
            ? ("gib_seconds" as const)
            : ("gb_seconds" as const),
        usdPerUnit: "0.000001",
      })),
    ],
  };
  expect(await f.runtime.putPricingProof(completePricing, NOW)).toBe(true);
  const prepare = async (now = NOW) => {
    const current = await probes.context({ ...f.actor, now }, uploadId, 1);
    if (!current) throw new Error("synthetic upload probe context missing");
    const r: PaidHoldRequest = {
      ...request(f),
      pricingProofId: p.id,
      service: "container",
      targetKind: "file",
      targetId: current.fileId,
      targetRevision: current.fileRevision,
      plan: {
        operationId: current.operationId,
        operationRevision: current.operationRevision,
        requestHash: current.requestHash,
        invocationId: crypto.randomUUID(),
        maximumAttempts: 1,
        deadlineAt: new Date(Date.parse(now) + 300000).toISOString(),
        quantities: [{ sku: "container_cpu_seconds", maximumQuantity: "265" }],
      },
    };
    const paid = await f.runtime.prepareHold({ ...f.actor, now }, r);
    if (!paid) throw new Error("synthetic bounded probe hold missing");
    return { r, paid };
  };
  return { ...f, uploadId, fileId, probes, prepare, containerPricing: completePricing };
}

test("processing cost bridge dispatches only the actual attached hold and retains unmetered native exposure", async () => {
  const f = await uploadProbeFixture();
  const context = await f.probes.context(f.actor, f.uploadId, 1);
  if (!context) throw new Error("synthetic context missing");
  const jobId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const options: Parameters<typeof createProcessingBudgetService>[0] = {
    core: f.core,
    environment: "preview",
    ownerId: f.actor.ownerId,
    clock: () => NOW,
    binding: async () => ({
      ...context,
      jobId,
      targetKind: "file",
      targetId: f.fileId,
      targetRevision: context.fileRevision,
      invocationId: runId,
      maximumAttempts: 1,
      deadlineAt: "2026-10-06T00:05:00.000Z",
      pricingProofId: f.containerPricing.id,
      fundingProofId: f.fp.id,
      allocationProofId: f.ap.id,
    }),
    bounds: async (_input, inputDigest) => ({
      inputDigest,
      evidenceHash: HASH,
      verifiedAt: NOW,
      validUntil: EXP,
      quantities: [
        { sku: "container_cpu_seconds", maximumQuantity: "600" },
        { sku: "container_memory_gib_seconds", maximumQuantity: "3600" },
        { sku: "container_disk_gb_seconds", maximumQuantity: "7200" },
      ],
    }),
  };
  const service = createProcessingBudgetService(options);
  const input = {
    service: "container" as const,
    action: "container_probe" as const,
    identity: `probe:${HASH}:0:0`,
    byteLength: 100,
    durationSeconds: null,
  };
  const admission = await service.prepareInitial(input);
  expect(admission).not.toBeNull();
  if (!admission) throw new Error("synthetic admission missing");
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_paid_holds").get()).toEqual({ n: 0 });
  const lease = await f.probes.attach(
    f.actor,
    { uploadId: f.uploadId, uploadRevision: 1, leaseUntil: "2026-10-06T00:05:00.000Z" },
    admission.paid,
  );
  if (!lease) throw new Error("synthetic lease missing");
  const costs = createProcessingBudgetService({
    ...options,
    initialAttemptId: admission.request.attemptId,
  }).costs(lease);
  const access = { authorize: async () => true, signal: new AbortController().signal };
  expect(await costs.before({ ...input, identity: "substituted" }, access)).toBeNull();
  const permit = await costs.before(input, access);
  expect(permit).not.toBeNull();
  if (!permit) throw new Error("synthetic permit missing");
  expect(await service.costs(lease, admission).before(input, access)).toBeNull();
  await costs.after({ ...permit }, { transport: "response", rawUsage: { chargedUsd: "0" } });
  await costs.after(permit, { transport: "response" });
  expect(
    f.db.sqlite.query("SELECT state FROM v2_cost_attempts WHERE id=?").get(permit.attemptId),
  ).toEqual({ state: "reserved" });
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_runtime_usage").get()).toEqual({ n: 0 });
  expect((await f.runtime.exposure(NOW))?.reserved_krw).toBeGreaterThan(0);
});

test("processing cost bridge denies absent bounds, changed input proof and cancelled access before native dispatch", async () => {
  const f = await uploadProbeFixture();
  const context = await f.probes.context(f.actor, f.uploadId, 1);
  if (!context) throw new Error("synthetic context missing");
  const options = {
    core: f.core,
    environment: "preview" as const,
    ownerId: f.actor.ownerId,
    clock: () => NOW,
    binding: async () => ({
      ...context,
      jobId: crypto.randomUUID(),
      targetKind: "file" as const,
      targetId: f.fileId,
      targetRevision: context.fileRevision,
      invocationId: crypto.randomUUID(),
      maximumAttempts: 1,
      deadlineAt: "2026-10-06T00:05:00.000Z",
      pricingProofId: f.containerPricing.id,
      fundingProofId: f.fp.id,
      allocationProofId: f.ap.id,
    }),
  };
  const input = {
    service: "container" as const,
    action: "container_probe" as const,
    identity: HASH,
    byteLength: 100,
    durationSeconds: null,
  };
  expect(await createProcessingBudgetService(options).prepareInitial(input)).toBeNull();
  const service = createProcessingBudgetService({
    ...options,
    bounds: async () => ({
      inputDigest: "b".repeat(64),
      evidenceHash: HASH,
      verifiedAt: NOW,
      validUntil: EXP,
      quantities: [{ sku: "container_cpu_seconds", maximumQuantity: "600" }],
    }),
  });
  expect(await service.prepareInitial(input)).toBeNull();
  expect(
    await service
      .costs({ jobId: crypto.randomUUID(), token: crypto.randomUUID(), fencing: 1 })
      .before(input, { authorize: async () => false, signal: new AbortController().signal }),
  ).toBeNull();
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_paid_holds").get()).toEqual({ n: 0 });
});

test("inline upload probe reserves real bounded paid hold before dispatch without quota or outbox", async () => {
  const f = await uploadProbeFixture(),
    { r, paid } = await f.prepare();
  const args = { uploadId: f.uploadId, uploadRevision: 1, leaseUntil: "2026-10-06T00:05:00.000Z" };
  expect(await f.probes.attach(f.actor, args)).toBeNull();
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_jobs").get()).toEqual({ n: 0 });
  const lease = await f.probes.attach(f.actor, args, paid);
  expect(lease).not.toBeNull();
  if (!lease) throw new Error("synthetic probe lease missing");
  expect(await f.runtime.beforeDispatch(f.actor, lease, r.attemptId)).not.toBeNull();
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_outbox").get()).toEqual({ n: 0 });
  expect((await f.accounting.usage(f.actor)).aiResponses.reserved).toBe(0);
  expect(
    await f.probes.finish(f.actor, f.uploadId, 1, { ...lease, token: crypto.randomUUID() }, true),
  ).toBe(false);
  expect(await f.probes.finish(f.actor, f.uploadId, 1, lease, true)).toBe(true);
  expect(await f.probes.finish(f.actor, f.uploadId, 1, lease, true)).toBe(false);
  expect(
    f.db.sqlite
      .query("SELECT revision,state,current_job_id FROM v2_files WHERE id=?")
      .get(f.fileId),
  ).toEqual({ revision: 1, state: "reserved", current_job_id: null });
  expect(
    f.db.sqlite.query("SELECT state FROM v2_upload_sessions WHERE id=?").get(f.uploadId),
  ).toEqual({ state: "open" });
  expect(
    f.db.sqlite.query("SELECT state FROM v2_operations WHERE id=?").get(r.plan.operationId),
  ).toEqual({ state: "admitted" });
  expect((await f.runtime.exposure(NOW))?.reserved_krw).toBeGreaterThan(0);
});

test("inline upload probe owner, revision, consent and timeout reject before creating held jobs", async () => {
  const f = await uploadProbeFixture(),
    { paid } = await f.prepare();
  const args = { uploadId: f.uploadId, uploadRevision: 1, leaseUntil: "2026-10-06T00:05:00.000Z" };
  expect(await f.probes.attach({ ...f.actor, ownerId: "foreign-owner" }, args, paid)).toBeNull();
  expect(await f.probes.attach(f.actor, { ...args, uploadRevision: 2 }, paid)).toBeNull();
  expect(
    await f.probes.attach(f.actor, { ...args, leaseUntil: "2026-10-06T00:05:01.000Z" }, paid),
  ).toBeNull();
  f.db.sqlite.query("DELETE FROM v2_consents WHERE file_id=?").run(f.fileId);
  expect(await f.probes.attach(f.actor, args, paid)).toBeNull();
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_paid_holds").get()).toEqual({ n: 0 });
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_jobs").get()).toEqual({ n: 0 });
});

test("inline upload probe expired lease can be replaced without refunding unknown exposure or reviving old results", async () => {
  const f = await uploadProbeFixture(),
    first = await f.prepare();
  const lease = await f.probes.attach(
    f.actor,
    { uploadId: f.uploadId, uploadRevision: 1, leaseUntil: "2026-10-06T00:05:00.000Z" },
    first.paid,
  );
  if (!lease) throw new Error("synthetic first lease missing");
  const later = "2026-10-06T00:05:01.000Z",
    second = await f.prepare(later),
    actor = { ...f.actor, now: later };
  const next = await f.probes.attach(
    actor,
    { uploadId: f.uploadId, uploadRevision: 1, leaseUntil: "2026-10-06T00:10:01.000Z" },
    second.paid,
  );
  expect(next).not.toBeNull();
  expect(await f.probes.finish(actor, f.uploadId, 1, lease, true)).toBe(false);
  expect(await f.runtime.beforeDispatch(actor, lease, first.r.attemptId)).toBeNull();
  expect(
    f.db.sqlite.query("SELECT status,lease_token FROM v2_jobs WHERE id=?").get(lease.jobId),
  ).toEqual({ status: "cancelled", lease_token: null });
  expect(
    f.db.sqlite.query("SELECT count(*) n FROM v2_cost_attempts WHERE state='reserved'").get(),
  ).toEqual({ n: 2 });
});
test("late incomplete usage observations remain durable under the same ambiguous hold without a fictitious monetary transition", async () => {
  const f = await fixture(),
    d = await dispatch(f);
  expect(
    await f.runtime.recordUsage(
      receipt(d, { transport: "unknown", meteringComplete: false, quantities: [] }),
      NOW,
    ),
  ).toBe(true);
  const late = receipt(d, {
    meteringComplete: false,
    modelTokenDetails: null,
    quantities: [{ sku: "model_input_tokens", quantity: "500" }],
  });
  expect(await f.runtime.recordUsage(late, NOW)).toBe(true);
  expect(await f.runtime.recordUsage(late, NOW)).toBe(false);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_runtime_usage").get()).toEqual({ n: 2 });
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_cost_receipts").get()).toEqual({ n: 1 });
  expect((await f.runtime.exposure(NOW))?.ambiguous_krw).toBe(1000);
  expect(await f.runtime.recordUsage(receipt(d, { chargedUsd: "0.75" }), NOW)).toBe(true);
  expect((await f.runtime.exposure(NOW))?.ambiguous_krw).toBe(0);
  expect((await f.runtime.exposure(NOW))?.settled_krw).toBe(750);
});
test("a pricing document cannot impersonate usage proof and settlement SQL failure leaves the complete attempt exposure intact", async () => {
  const f = await fixture(),
    d = await dispatch(f);
  const wrongMethod = createV2PaidRuntimeRepository(
    f.core,
    "preview",
    async (kind, payload, digest) => ({
      ...(await verifier(kind, payload, digest)),
      digest,
      evidenceHash: HASH,
      verifiedAt: NOW,
      method: "official_document",
    }),
  );
  expect(await wrongMethod.recordUsage(receipt(d), NOW)).toBe(false);
  expect((await f.runtime.exposure(NOW))?.reserved_krw).toBe(1000);
  f.db.sqlite.exec(
    "CREATE TRIGGER fail_paid_receipt BEFORE INSERT ON v2_cost_receipts BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  );
  await expect(f.runtime.recordUsage(receipt(d), NOW)).rejects.toMatchObject({
    code: "DB_OPERATION_FAILED",
  });
  for (const table of ["v2_runtime_usage", "v2_cost_receipts", "v2_runtime_claims"])
    expect(f.db.sqlite.query(`SELECT count(*) n FROM ${table}`).get()).toEqual({ n: 0 });
  expect((await f.runtime.exposure(NOW))?.reserved_krw).toBe(1000);
  expect(f.db.sqlite.query("SELECT state FROM v2_paid_holds").get()).toEqual({
    state: "dispatched",
  });
});
test("runtime activation prevents an omitted paid hold from admitting quota/job or acquiring a legacy unpaid job", async () => {
  const f = await fixture(),
    r = request(f);
  expect(
    await f.jobs.admitWorkspace(
      { ...f.actor, workspaceId: f.workspaceId, expectedRevision: 1 },
      { operationId: r.plan.operationId, key: crypto.randomUUID(), requestHash: HASH },
      r.jobId,
      "chat_response",
      {
        id: crypto.randomUUID(),
        request: { expectedRevision: 1, text: "합성 요청", selectedFileIds: [] },
      },
    ),
  ).toBe(false);
  expect((await f.accounting.usage(f.actor)).aiResponses.reserved).toBe(0);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_jobs").get()).toEqual({ n: 0 });
  const a = await admit(f);
  expect(a.ok).toBe(true);
  expect(await f.jobs.acquire(f.actor, a.r.jobId, crypto.randomUUID(), LATER)).toBeNull();
  expect(f.db.sqlite.query("SELECT attempts,status FROM v2_jobs").get()).toEqual({
    attempts: 0,
    status: "queued",
  });
});

test("complete rate matrix rejects ordinary-only reservation and missing rates; exact cache-write and long-context usage settles at classified rates", async () => {
  const f = await fixture(),
    p = pricing(),
    input = p.prices[0],
    output = p.prices[1];
  if (!input || !output) throw new Error("synthetic prices");
  input.unitSize = output.unitSize = "1000000";
  input.usdPerUnit = "5";
  output.usdPerUnit = "15";
  input.modelRates = ["short", "long"].flatMap((contextTier) =>
    ["ordinary", "cached_read", "cache_write"].map((cacheClass) => ({
      contextTier: contextTier as "short" | "long",
      cacheClass: cacheClass as "ordinary" | "cached_read" | "cache_write",
      usdPerUnit:
        contextTier === "short"
          ? cacheClass === "ordinary"
            ? "2"
            : cacheClass === "cached_read"
              ? "0.2"
              : "2.5"
          : cacheClass === "ordinary"
            ? "4"
            : cacheClass === "cached_read"
              ? "0.4"
              : "5",
    })),
  );
  output.modelRates = [
    { contextTier: "short", cacheClass: "not_applicable", usdPerUnit: "10" },
    { contextTier: "long", cacheClass: "not_applicable", usdPerUnit: "15" },
  ];
  expect(
    pricingProofSchema.safeParse({ ...p, prices: [{ ...input, usdPerUnit: "2" }, output] }).success,
  ).toBe(false);
  expect(
    pricingProofSchema.safeParse({
      ...p,
      prices: [{ ...input, modelRates: input.modelRates.slice(1) }, output],
    }).success,
  ).toBe(false);
  expect(await f.runtime.putPricingProof(p, NOW)).toBe(true);
  const r = request(f);
  r.pricingProofId = p.id;
  r.plan.quantities = [
    { sku: "model_input_tokens", maximumQuantity: "300000" },
    { sku: "model_output_tokens", maximumQuantity: "1000" },
  ];
  const a = await admit(f, r);
  expect(a.ok).toBe(true);
  expect(a.paid.reservedKrw).toBe(1515);
  const acquired = await f.jobs.acquire(f.actor, r.jobId, crypto.randomUUID(), LATER, r.attemptId);
  if (!acquired) throw new Error("synthetic lease");
  const handle = await f.runtime.beforeDispatch(f.actor, acquired.lease, r.attemptId);
  if (!handle) throw new Error("synthetic dispatch");
  const base = { ...a, lease: acquired.lease, handle };
  // Full long-context input: 100K ordinary, 100K cached, 100K cache-write.
  expect(
    await f.runtime.recordUsage(
      receipt(base, {
        quantities: [
          { sku: "model_input_tokens", quantity: "300000" },
          { sku: "model_output_tokens", quantity: "1000" },
        ],
        modelTokenDetails: {
          cachedInputTokens: 100000,
          cacheWriteInputTokens: 100000,
          serviceTier: "default",
        },
      }),
      NOW,
    ),
  ).toBe(true);
  expect((await f.runtime.exposure(NOW))?.settled_krw).toBe(955);
});

test("missing cache counts or unsupported actual tier remains ambiguous until an authenticated exact bill", async () => {
  for (const details of [
    null,
    { cachedInputTokens: null, cacheWriteInputTokens: 0, serviceTier: "default" },
    { cachedInputTokens: 0, cacheWriteInputTokens: 0, serviceTier: "priority" },
    { cachedInputTokens: 501, cacheWriteInputTokens: 0, serviceTier: "default" },
  ]) {
    const f = await fixture(),
      d = await dispatch(f);
    expect(await f.runtime.recordUsage(receipt(d, { modelTokenDetails: details }), NOW)).toBe(true);
    expect((await f.runtime.exposure(NOW))?.ambiguous_krw).toBe(1000);
    expect((await f.runtime.exposure(NOW))?.settled_krw).toBe(0);
    expect(
      await f.runtime.recordUsage(
        receipt(d, { modelTokenDetails: details, chargedUsd: "0.75" }),
        NOW,
      ),
    ).toBe(true);
    expect((await f.runtime.exposure(NOW))?.settled_krw).toBe(750);
  }
});
test("maintenance freeze can refresh the same allocation version with a new exact drain generation", async () => {
  const f = await fixture();
  expect(
    await f.runtime.recordMaintenance(
      {
        id: crypto.randomUUID(),
        month: "2026-10",
        referenceHash: HASH,
        amountKrw: 10,
        state: "settled",
      },
      NOW,
    ),
  ).toBe(true);
  const state = f.db.sqlite.query("SELECT revision FROM v2_runtime_controls").get() as {
    revision: number;
  };
  expect(await f.runtime.freeze("2026-10", state.revision, 1, NOW)).toBe(true);
  const local = await f.runtime.drain("2026-10", state.revision + 1, f.ap.id, NOW);
  expect(local).not.toBeNull();
  if (!local) throw new Error("synthetic drain missing");
  expect(local.controlRevision).toBeGreaterThan(f.drain.controlRevision);
  expect(await f.runtime.putRemoteDrainProof(local, NOW)).toBe(true);
  const remote = {
    ...local,
    id: crypto.randomUUID(),
    environment: "production" as const,
    limitKrw: 20000,
    fixedKrw: 0,
  };
  expect(await f.runtime.putRemoteDrainProof(remote, NOW)).toBe(true);
  expect(
    await f.runtime.activate(
      "2026-10",
      local.controlRevision,
      f.ap.id,
      f.drain.id,
      f.remote.id,
      NOW,
    ),
  ).toBe(false);
  expect(
    await f.runtime.activate("2026-10", local.controlRevision, f.ap.id, local.id, remote.id, NOW),
  ).toBe(true);
  expect((await f.runtime.exposure(NOW))?.phase).toBe("active");
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_runtime_drains").get()).toEqual({ n: 2 });
});

test("runtime plan database bounds reject fractional revisions and attempts without altering the retained plan", async () => {
  const f = await fixture(),
    a = await admit(f);
  expect(a.ok).toBe(true);
  const row = f.db.sqlite.query("SELECT * FROM v2_runtime_plans").get() as Record<
    string,
    string | number | null
  >;
  const columns = Object.keys(row);
  for (const key of ["operation_revision", "target_revision", "maximum_attempts", "reserved_krw"]) {
    const bad = { ...row, id: crypto.randomUUID(), [key]: 1.5 };
    expect(() =>
      f.db.sqlite
        .query(
          `INSERT INTO v2_runtime_plans(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
        )
        .run(...columns.map((c) => bad[c] ?? null)),
    ).toThrow();
  }
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_runtime_plans").get()).toEqual({ n: 1 });
  expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});
function request(f: Fixture): PaidHoldRequest {
  return {
    attemptId: crypto.randomUUID(),
    quoteId: crypto.randomUUID(),
    planId: crypto.randomUUID(),
    pricingProofId: f.pp.id,
    fundingProofId: f.fp.id,
    attempt: 1,
    service: "model",
    jobId: crypto.randomUUID(),
    targetKind: "workspace",
    targetId: f.workspaceId,
    targetRevision: 2,
    plan: {
      operationId: crypto.randomUUID(),
      operationRevision: 2,
      requestHash: HASH,
      invocationId: crypto.randomUUID(),
      maximumAttempts: 2,
      deadlineAt: "2026-10-06T00:03:00.000Z",
      quantities: [
        { sku: "model_input_tokens", maximumQuantity: "1000" },
        { sku: "model_output_tokens", maximumQuantity: "100" },
      ],
    },
  };
}
async function admit(f: Fixture, r = request(f)) {
  const paid = await f.runtime.prepareHold(f.actor, r);
  expect(paid).not.toBeNull();
  if (!paid) throw new Error("synthetic hold absent");
  const ok = await f.jobs.admitWorkspace(
    { ...f.actor, workspaceId: f.workspaceId, expectedRevision: 1 },
    { operationId: r.plan.operationId, key: crypto.randomUUID(), requestHash: HASH },
    r.jobId,
    "chat_response",
    {
      id: crypto.randomUUID(),
      request: { expectedRevision: 1, text: "합성 사건 자료 확인", selectedFileIds: [] },
    },
    paid,
  );
  return { ok, r, paid };
}
async function dispatch(f: Fixture) {
  const admitted = await admit(f);
  expect(admitted.ok).toBe(true);
  const lease = await f.jobs.acquire(
    f.actor,
    admitted.r.jobId,
    crypto.randomUUID(),
    LATER,
    admitted.r.attemptId,
  );
  expect(lease).not.toBeNull();
  if (!lease) throw new Error("synthetic lease absent");
  const handle = await f.runtime.beforeDispatch(f.actor, lease.lease, admitted.r.attemptId);
  expect(handle).not.toBeNull();
  if (!handle) throw new Error("synthetic handle absent");
  return { ...admitted, lease: lease.lease, handle };
}
function receipt(
  d: Awaited<ReturnType<typeof dispatch>>,
  overrides: Partial<UsageReceipt> = {},
): UsageReceipt {
  return {
    id: crypto.randomUUID(),
    attemptId: d.r.attemptId,
    invocationId: d.r.plan.invocationId,
    providerRequestId: "synthetic-provider-001",
    dispatchToken: d.handle.dispatchToken,
    observedAt: NOW,
    transport: "response",
    definitiveNoCharge: false,
    meteringComplete: true,
    quantities: [
      { sku: "model_input_tokens", quantity: "500" },
      { sku: "model_output_tokens", quantity: "50" },
    ],
    chargedUsd: null,
    modelTokenDetails: { cachedInputTokens: 0, cacheWriteInputTokens: 0, serviceTier: "default" },
    ...overrides,
  };
}
test("paid chat op/quota/job/outbox and exact-price hold commit atomically, immutable provenance is preserved", async () => {
  const f = await fixture(),
    a = await admit(f);
  expect(a.ok).toBe(true);
  expect(a.paid.reservedKrw).toBe(1000);
  for (const table of [
    "v2_operations",
    "v2_quota_reservations",
    "v2_jobs",
    "v2_outbox",
    "v2_runtime_plans",
    "v2_paid_holds",
    "v2_cost_attempts",
  ])
    expect(f.db.sqlite.query(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 1 });
  expect((await f.accounting.usage(f.actor)).aiResponses).toEqual({
    limit: 30,
    used: 0,
    reserved: 1,
    remaining: 29,
  });
  const saved = f.db.sqlite
    .query("SELECT payload_json,evidence_hash FROM v2_runtime_plans")
    .get() as { payload_json: string; evidence_hash: string };
  expect(JSON.parse(saved.payload_json)).toEqual(a.r);
  expect(saved.evidence_hash).toBe("e".repeat(64));
  expect(() => f.db.sqlite.exec("UPDATE v2_runtime_plans SET request_hash='broken'")).toThrow();
  expect(() => f.db.sqlite.exec("DELETE FROM v2_runtime_proofs")).toThrow();
  expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});
test("same workspace concurrency admits one quota/hold; failed transaction rolls every binding back", async () => {
  const f = await fixture();
  const r = request(f),
    p = await f.runtime.prepareHold(f.actor, r);
  expect(p).not.toBeNull();
  if (!p) throw new Error("fixture");
  f.db.sqlite.exec(
    "CREATE TRIGGER fail_hold BEFORE INSERT ON v2_paid_holds BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  );
  await expect(admit(f, r)).rejects.toMatchObject({ code: "DB_OPERATION_FAILED" });
  for (const table of [
    "v2_operations",
    "v2_quota_reservations",
    "v2_jobs",
    "v2_outbox",
    "v2_runtime_plans",
    "v2_paid_holds",
    "v2_cost_attempts",
  ])
    expect(f.db.sqlite.query(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
  expect((await f.runtime.exposure(NOW))?.reserved_krw).toBe(0);
  f.db.sqlite.exec("DROP TRIGGER fail_hold");
  const results = await Promise.all([admit(f), admit(f)]);
  expect(results.filter((x) => x.ok)).toHaveLength(1);
  expect((await f.runtime.exposure(NOW))?.reserved_krw).toBe(1000);
});
test("no callback, wrong digest/method, foreign environment and unverified free prices cannot produce paid proof", async () => {
  const f = await fixture(),
    disabled = createV2PaidRuntimeRepository(f.core, "preview");
  expect(await disabled.putPricingProof(pricing(), NOW)).toBe(false);
  const bad = createV2PaidRuntimeRepository(f.core, "preview", async () => ({
    digest: HASH,
    evidenceHash: HASH,
    method: "official_document",
    verifiedAt: NOW,
  }));
  expect(await bad.putFundingProof(funding(), NOW)).toBe(false);
  expect(await f.runtime.putFundingProof({ ...funding(), environment: "production" }, NOW)).toBe(
    false,
  );
  const pp = pricing();
  const first = pp.prices[0];
  if (!first) throw new Error("fixture");
  first.billingMode = "verified_free";
  first.usdPerUnit = "0";
  for (const rate of first.modelRates ?? []) rate.usdPerUnit = "0";
  expect(await f.runtime.putPricingProof(pp, NOW)).toBe(true);
  expect(await f.runtime.prepareHold(f.actor, { ...request(f), pricingProofId: pp.id })).toBeNull();
});
test("price/funding expiration and frozen allocation reject admission before quota/job/lease mutation", async () => {
  const f = await fixture(),
    r = request(f),
    paid = await f.runtime.prepareHold(f.actor, r);
  expect(paid).not.toBeNull();
  if (!paid) throw new Error("fixture");
  expect(await f.runtime.freeze("2026-10", 3, 2, NOW)).toBe(true);
  const result = await f.jobs.admitWorkspace(
    { ...f.actor, workspaceId: f.workspaceId, expectedRevision: 1 },
    { operationId: r.plan.operationId, key: crypto.randomUUID(), requestHash: HASH },
    r.jobId,
    "chat_response",
    {
      id: crypto.randomUUID(),
      request: { expectedRevision: 1, text: "합성", selectedFileIds: [] },
    },
    paid,
  );
  expect(result).toBe(false);
  expect((await f.accounting.usage(f.actor)).aiResponses.reserved).toBe(0);
  expect(f.db.sqlite.query("SELECT * FROM v2_jobs").all()).toEqual([]);
  expect(await f.runtime.prepareHold({ ...f.actor, now: EXP }, request(f))).toBeNull();
});
test("paid job refuses unguarded/stale lease, dispatch replay and current target replacement", async () => {
  const f = await fixture(),
    a = await admit(f);
  expect(a.ok).toBe(true);
  expect(await f.jobs.acquire(f.actor, a.r.jobId, crypto.randomUUID(), LATER)).toBeNull();
  const acquired = await f.jobs.acquire(
    f.actor,
    a.r.jobId,
    crypto.randomUUID(),
    LATER,
    a.r.attemptId,
  );
  expect(acquired).not.toBeNull();
  if (!acquired) throw new Error("fixture");
  expect(
    await f.runtime.beforeDispatch(f.actor, { ...acquired.lease, fencing: 99 }, a.r.attemptId),
  ).toBeNull();
  f.db.sqlite.query("UPDATE v2_workspaces SET current_job_id=NULL WHERE id=?").run(f.workspaceId);
  expect(await f.runtime.beforeDispatch(f.actor, acquired.lease, a.r.attemptId)).toBeNull();
  f.db.sqlite
    .query("UPDATE v2_workspaces SET current_job_id=? WHERE id=?")
    .run(a.r.jobId, f.workspaceId);
  expect(await f.runtime.beforeDispatch(f.actor, acquired.lease, a.r.attemptId)).not.toBeNull();
  expect(await f.runtime.beforeDispatch(f.actor, acquired.lease, a.r.attemptId)).toBeNull();
});
test("durable metered response settles before output validation; immutable receipt and concurrent replay are once only", async () => {
  const f = await fixture(),
    d = await dispatch(f),
    r = receipt(d);
  const results = await Promise.all([f.runtime.recordUsage(r, NOW), f.runtime.recordUsage(r, NOW)]);
  expect(results).toEqual([true, false]);
  expect((await f.runtime.exposure(NOW))?.settled_krw).toBe(500);
  expect((await f.runtime.exposure(NOW))?.reserved_krw).toBe(0);
  expect(f.db.sqlite.query("SELECT state,charged_krw FROM v2_cost_attempts").get()).toEqual({
    state: "settled",
    charged_krw: 500,
  });
  expect(f.db.sqlite.query("SELECT outcome FROM v2_runtime_usage").get()).toEqual({
    outcome: "settled",
  });
  expect(() => f.db.sqlite.exec("UPDATE v2_runtime_usage SET payload_json='{}'")).toThrow();
  // Publication hasn't happened: logical response quota remains reserved.
  expect((await f.accounting.usage(f.actor)).aiResponses.used).toBe(0);
});
test("incomplete/unknown response preserves ambiguous cost and refuses blind next attempt; late exact receipt reconciles after account deletion", async () => {
  const f = await fixture(),
    d = await dispatch(f);
  expect(
    await f.runtime.recordUsage(
      receipt(d, { transport: "unknown", meteringComplete: false, quantities: [] }),
      NOW,
    ),
  ).toBe(true);
  expect((await f.runtime.exposure(NOW))?.ambiguous_krw).toBe(1000);
  const next = {
    ...d.r,
    attemptId: crypto.randomUUID(),
    quoteId: crypto.randomUUID(),
    planId: crypto.randomUUID(),
    attempt: 2,
  };
  const prepared = await f.runtime.prepareHold(f.actor, next);
  expect(prepared).not.toBeNull();
  if (!prepared) throw new Error("fixture");
  expect(await f.runtime.reserveAttempt(f.actor, d.lease, prepared)).toBe(false);
  f.db.sqlite.query("DELETE FROM user WHERE id=?").run(f.actor.ownerId);
  expect(f.db.sqlite.query("SELECT * FROM v2_jobs").all()).toEqual([]);
  expect(
    await f.runtime.recordUsage(
      receipt(d, { chargedUsd: "0.125", meteringComplete: false, quantities: [] }),
      NOW,
    ),
  ).toBe(true);
  expect((await f.runtime.exposure(NOW))?.settled_krw).toBe(125);
  expect((await f.runtime.exposure(NOW))?.ambiguous_krw).toBe(0);
  expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});
test("receipt token/invocation/unknown SKU/incomplete completeness and forged verification are rejected without money mutation", async () => {
  const f = await fixture(),
    d = await dispatch(f);
  for (const r of [
    receipt(d, { dispatchToken: crypto.randomUUID() }),
    receipt(d, { invocationId: crypto.randomUUID() }),
    receipt(d, { quantities: [], meteringComplete: true }),
    receipt(d, { quantities: [{ sku: "asr_seconds", quantity: "1" }] }),
  ])
    expect(await f.runtime.recordUsage(r, NOW)).toBe(false);
  expect((await f.runtime.exposure(NOW))?.reserved_krw).toBe(1000);
  expect(f.db.sqlite.query("SELECT * FROM v2_runtime_usage").all()).toEqual([]);
});
test("verified unsent transport releases a prepared hold once, while incomplete response never becomes a zero-cost receipt", async () => {
  const f = await fixture(),
    a = await admit(f);
  expect(a.ok).toBe(true);
  const r: UsageReceipt = {
    id: crypto.randomUUID(),
    attemptId: a.r.attemptId,
    invocationId: a.r.plan.invocationId,
    providerRequestId: null,
    dispatchToken: null,
    observedAt: NOW,
    modelTokenDetails: null,
    transport: "not_sent",
    definitiveNoCharge: true,
    meteringComplete: false,
    quantities: [],
    chargedUsd: null,
  };
  expect(await f.runtime.recordUsage(r, NOW)).toBe(true);
  expect(await f.runtime.recordUsage(r, NOW)).toBe(false);
  expect((await f.runtime.exposure(NOW))?.reserved_krw).toBe(0);
});
test("internal phase reservation has exact current lease and cost, no new logical quota; response failure/retry refuses stale operation state", async () => {
  const f = await fixture(),
    d = await dispatch(f);
  expect(await f.runtime.recordUsage(receipt(d), NOW)).toBe(true);
  const r = {
    ...d.r,
    attemptId: crypto.randomUUID(),
    quoteId: crypto.randomUUID(),
    planId: crypto.randomUUID(),
    attempt: 2,
  };
  const paid = await f.runtime.prepareHold(f.actor, r);
  expect(paid).not.toBeNull();
  if (!paid) throw new Error("fixture");
  expect(await f.runtime.reserveAttempt(f.actor, { ...d.lease, fencing: 999 }, paid)).toBe(false);
  expect(await f.runtime.reserveAttempt(f.actor, d.lease, paid)).toBe(true);
  expect((await f.accounting.usage(f.actor)).aiResponses.reserved).toBe(1);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_outbox").get()).toEqual({ n: 1 });
  expect(await f.runtime.beforeDispatch(f.actor, d.lease, r.attemptId)).not.toBeNull();
  expect((await f.runtime.exposure(NOW))?.reserved_krw).toBe(1000);
});
test("drain cannot acknowledge outstanding holds, increase requires authenticated both environments with unchanged local CAS", async () => {
  const f = await fixture(),
    d = await dispatch(f);
  const a = allocation(2),
    ap = { id: crypto.randomUUID(), environment: "preview" as const, allocation: a };
  expect(await f.accounting.recordAllocation(a)).toBe(true);
  expect(await f.runtime.putAllocationProof(ap, NOW)).toBe(true);
  expect(await f.runtime.freeze(a.month, 3, 2, NOW)).toBe(true);
  expect(await f.runtime.drain(a.month, 4, ap.id, NOW)).toBeNull();
  expect(await f.runtime.recordUsage(receipt(d), NOW)).toBe(true);
  const local = await f.runtime.drain(a.month, 4, ap.id, NOW);
  expect(local).not.toBeNull();
  if (!local) throw new Error("fixture");
  expect(await f.runtime.putRemoteDrainProof(local, NOW)).toBe(true);
  expect(await f.runtime.activate(a.month, 5, ap.id, local.id, crypto.randomUUID(), NOW)).toBe(
    false,
  );
  const remote = {
    ...local,
    id: crypto.randomUUID(),
    environment: "production" as const,
    settledKrw: 0,
    limitKrw: 20000,
  };
  expect(await f.runtime.putRemoteDrainProof(remote, NOW)).toBe(true);
  expect(await f.runtime.activate(a.month, 999, ap.id, local.id, remote.id, NOW)).toBe(false);
  expect(await f.runtime.activate(a.month, 5, ap.id, local.id, remote.id, NOW)).toBe(true);
  expect((await f.runtime.exposure(NOW))?.allocation_version).toBe(2);
});
test("fraction decimal quote proof, ISO normalization, immutable proof replay and digest binding roundtrip", async () => {
  const f = await fixture(),
    p = pricing();
  p.fx.krwPerUsd = "1375.25";
  const first = p.prices[0];
  if (!first) throw new Error("fixture");
  first.usdPerUnit = "0.000001";
  for (const rate of first.modelRates ?? []) rate.usdPerUnit = "0.000001";
  first.unitSize = "1";
  const output = p.prices[1];
  if (!output) throw new Error("fixture");
  output.usdPerUnit = "0.000001";
  for (const rate of output.modelRates ?? []) rate.usdPerUnit = "0.000001";
  output.unitSize = "1";
  p.safetyMarginRatio = "0.125";
  expect(await f.runtime.putPricingProof(p, "2026-10-06T00:00:00Z")).toBe(true);
  expect(await f.runtime.putPricingProof(p, NOW)).toBe(true);
  expect(await f.runtime.putPricingProof({ ...p, version: 2 }, NOW)).toBe(false);
  const saved = await f.runtime.findProof(p.id, NOW);
  expect(saved?.payload).toEqual(p);
  expect(saved?.digest).toBe(await runtimeDigest(p));
  const paid = await f.runtime.prepareHold(f.actor, { ...request(f), pricingProofId: p.id });
  expect(paid?.reservedKrw).toBe(2);
});

test("failed paid job retry reserves the original logical quota and fresh cost together; price gate cannot be bypassed", async () => {
  const f = await fixture(),
    d = await dispatch(f);
  expect(await f.runtime.recordUsage(receipt(d), NOW)).toBe(true);
  expect(await f.jobs.fail(f.actor, d.lease, "MODEL_UNAVAILABLE", true)).toBe(true);
  expect((await f.accounting.usage(f.actor)).aiResponses.reserved).toBe(0);
  const g = { ...f.actor, workspaceId: f.workspaceId, expectedRevision: 3 };
  expect(await f.jobs.retry(g, d.r.jobId)).toBe(false);
  const r = {
    ...d.r,
    attemptId: crypto.randomUUID(),
    quoteId: crypto.randomUUID(),
    planId: crypto.randomUUID(),
    attempt: 2,
    targetRevision: 4,
  };
  const paid = await f.runtime.prepareHold(f.actor, r);
  expect(paid).not.toBeNull();
  if (!paid) throw new Error("fixture");
  const results = await Promise.all([
    f.jobs.retry(g, d.r.jobId, paid),
    f.jobs.retry(g, d.r.jobId, paid),
  ]);
  expect(results).toEqual([true, false]);
  expect((await f.accounting.usage(f.actor)).aiResponses.reserved).toBe(1);
  expect((await f.runtime.exposure(NOW))?.reserved_krw).toBe(1000);
  const lease = await f.jobs.acquire(f.actor, d.r.jobId, crypto.randomUUID(), LATER, r.attemptId);
  expect(lease).not.toBeNull();
  if (!lease) throw new Error("fixture");
  expect(await f.runtime.beforeDispatch(f.actor, d.lease, r.attemptId)).toBeNull();
  expect(await f.runtime.beforeDispatch(f.actor, lease.lease, r.attemptId)).not.toBeNull();
});

test("replayed local not_sent cannot release another worker's dispatched or ambiguous hold", async () => {
  const f = await fixture(),
    d = await dispatch(f);
  const unsent = receipt(d, {
    modelTokenDetails: null,
    transport: "not_sent",
    definitiveNoCharge: true,
    meteringComplete: false,
    quantities: [],
    chargedUsd: null,
  });
  expect(await f.runtime.recordUsage(unsent, NOW)).toBe(false);
  expect((await f.runtime.exposure(NOW))?.reserved_krw).toBe(1000);
  expect(
    await f.runtime.recordUsage(
      receipt(d, { transport: "unknown", meteringComplete: false, quantities: [] }),
      NOW,
    ),
  ).toBe(true);
  expect(await f.runtime.recordUsage({ ...unsent, id: crypto.randomUUID() }, NOW)).toBe(false);
  expect((await f.runtime.exposure(NOW))?.ambiguous_krw).toBe(1000);
});
test("unsent release races dispatch during trusted receipt verification: final CAS preserves exposure", async () => {
  const f = await fixture(),
    a = await admit(f);
  expect(a.ok).toBe(true);
  const acquired = await f.jobs.acquire(
    f.actor,
    a.r.jobId,
    crypto.randomUUID(),
    LATER,
    a.r.attemptId,
  );
  if (!acquired) throw new Error("fixture");
  const runtime = createV2PaidRuntimeRepository(
    f.core,
    "preview",
    async (kind, payload, digest) => {
      if (kind === "usage")
        expect(
          await f.runtime.beforeDispatch(f.actor, acquired.lease, a.r.attemptId),
        ).not.toBeNull();
      return verifier(kind, payload, digest);
    },
  );
  expect(
    await runtime.recordUsage(
      {
        id: crypto.randomUUID(),
        attemptId: a.r.attemptId,
        invocationId: a.r.plan.invocationId,
        providerRequestId: null,
        dispatchToken: null,
        observedAt: NOW,
        modelTokenDetails: null,
        transport: "not_sent",
        definitiveNoCharge: true,
        meteringComplete: false,
        quantities: [],
        chargedUsd: null,
      },
      NOW,
    ),
  ).toBe(false);
  expect((await f.runtime.exposure(NOW))?.reserved_krw).toBe(1000);
  expect(f.db.sqlite.query("SELECT * FROM v2_runtime_usage").all()).toEqual([]);
});

test("dispatch commit then adapter error cannot be released using the caller's stale null-token handle", async () => {
  const f = await fixture(),
    a = await admit(f);
  const acquired = await f.jobs.acquire(
    f.actor,
    a.r.jobId,
    crypto.randomUUID(),
    LATER,
    a.r.attemptId,
  );
  if (!acquired) throw new Error("fixture");
  const adapter = async () => {
    expect(await f.runtime.beforeDispatch(f.actor, acquired.lease, a.r.attemptId)).not.toBeNull();
    throw new Error("synthetic adapter exception after durable dispatch");
  };
  await expect(adapter()).rejects.toThrow("synthetic adapter exception");
  expect(
    await f.runtime.recordUsage(
      {
        id: crypto.randomUUID(),
        attemptId: a.r.attemptId,
        invocationId: a.r.plan.invocationId,
        providerRequestId: null,
        dispatchToken: null,
        observedAt: NOW,
        modelTokenDetails: null,
        transport: "not_sent",
        definitiveNoCharge: true,
        meteringComplete: false,
        quantities: [],
        chargedUsd: null,
      },
      NOW,
    ),
  ).toBe(false);
  expect((await f.runtime.exposure(NOW))?.reserved_krw).toBe(1000);
  expect(f.db.sqlite.query("SELECT * FROM v2_runtime_usage").all()).toEqual([]);
});
test("funding ceiling counts prior-month unresolved holds and ongoing maintenance; no new logical quota from a low verified credit", async () => {
  const f = await fixture();
  f.db.sqlite.exec(
    "INSERT INTO v2_monthly_budget(month,allocation_version,environment,limit_krw,reserved_krw,ambiguous_krw) VALUES('2026-09',1,'preview',10000,9000,50)",
  );
  expect((await f.runtime.exposure(NOW))?.carryover_krw).toBe(9050);
  const fundingLow = { ...funding(), spendAllowanceKrw: 9099 };
  expect(await f.runtime.putFundingProof(fundingLow, NOW)).toBe(true);
  const r = { ...request(f), fundingProofId: fundingLow.id },
    paid = await f.runtime.prepareHold(f.actor, r);
  expect(paid).not.toBeNull();
  if (!paid) throw new Error("fixture");
  expect(
    await f.jobs.admitWorkspace(
      { ...f.actor, workspaceId: f.workspaceId, expectedRevision: 1 },
      { operationId: r.plan.operationId, key: crypto.randomUUID(), requestHash: HASH },
      r.jobId,
      "chat_response",
      {
        id: crypto.randomUUID(),
        request: { expectedRevision: 1, text: "합성", selectedFileIds: [] },
      },
      paid,
    ),
  ).toBe(false);
  expect((await f.accounting.usage(f.actor)).aiResponses.reserved).toBe(0);
  expect(f.db.sqlite.query("SELECT * FROM v2_jobs").all()).toEqual([]);
  const input = {
    id: crypto.randomUUID(),
    month: "2026-09",
    referenceHash: HASH,
    amountKrw: 125,
    state: "reserved" as const,
  };
  expect(await f.runtime.recordMaintenance(input, NOW)).toBe(true);
  expect(await f.runtime.recordMaintenance(input, NOW)).toBe(false);
  expect((await f.runtime.exposure(NOW))?.carryover_krw).toBe(9175);
  expect((await f.runtime.exposure(NOW))?.phase).toBe("frozen");
  expect(await f.runtime.settleMaintenance(input.id, "reserved", 100, NOW)).toBe(true);
  expect(await f.runtime.settleMaintenance(input.id, "reserved", 100, NOW)).toBe(false);
  expect((await f.runtime.exposure(NOW))?.carryover_krw).toBe(9050);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_maintenance_evidence").get()).toEqual({
    n: 2,
  });
  expect(() => f.db.sqlite.exec("DELETE FROM v2_maintenance_evidence")).toThrow();
});
test("late reconciliation settles original month after deadline, allocation freeze and rollover, never a new month or expired lease", async () => {
  const f = await fixture(),
    d = await dispatch(f);
  expect(
    await f.runtime.recordUsage(
      receipt(d, { transport: "unknown", meteringComplete: false, quantities: [] }),
      NOW,
    ),
  ).toBe(true);
  f.db.sqlite.exec(
    "INSERT INTO v2_monthly_budget(month,allocation_version,environment,limit_krw) VALUES('2026-11',1,'preview',10000)",
  );
  const november = "2026-11-01T00:00:00.000Z";
  expect((await f.runtime.exposure(november))?.carryover_krw).toBe(1000);
  expect(await f.runtime.freeze("2026-10", 3, 2, NOW)).toBe(true);
  expect(
    await f.runtime.recordUsage(
      receipt(d, {
        observedAt: november,
        chargedUsd: "0.333",
        meteringComplete: false,
        quantities: [],
      }),
      november,
    ),
  ).toBe(true);
  expect((await f.runtime.exposure(november))?.carryover_krw).toBe(0);
  expect((await f.runtime.exposure(november))?.settled_krw).toBe(0);
  expect((await f.runtime.exposure(NOW))?.settled_krw).toBe(333);
});
test("cross-month hold and ongoing maintenance prohibit drain/decrease below retained exposure; authenticated remote ack cannot override local inventory", async () => {
  const f = await fixture();
  f.db.sqlite.exec(
    "INSERT INTO v2_monthly_budget(month,allocation_version,environment,limit_krw,ambiguous_krw) VALUES('2026-09',1,'preview',10000,2500)",
  );
  const a = { ...allocation(2), previewKrw: 2000 },
    ap = { id: crypto.randomUUID(), environment: "preview" as const, allocation: a };
  expect(await f.accounting.recordAllocation(a)).toBe(true);
  expect(await f.runtime.putAllocationProof(ap, NOW)).toBe(true);
  expect(await f.runtime.freeze(a.month, 3, 2, NOW)).toBe(true);
  expect(await f.runtime.drain(a.month, 4, ap.id, NOW)).toBeNull();
  expect((await f.runtime.exposure(NOW))?.limit_krw).toBe(10000);
  expect((await f.runtime.exposure(NOW))?.phase).toBe("frozen");
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_runtime_drains").get()).toEqual({ n: 1 });
});

function processorPricing(sku: "asr_seconds" | "container_cpu_seconds"): PricingProof {
  const p = pricing(),
    first = p.prices[0];
  if (!first) throw new Error("fixture");
  p.prices = [
    {
      ...first,
      sku,
      modelRates: null,
      provider: "cloudflare",
      model: sku === "asr_seconds" ? "@cf/openai/whisper-large-v3-turbo" : null,
      unit: sku === "asr_seconds" ? "seconds" : "vcpu_seconds",
      unitSize: "1",
      usdPerUnit: "1",
      billingQuantum: "0.5",
    },
  ];
  return p;
}
test("accepted Whisper exact identifier, canonical SKU units and public FX URL exclude aliases and secret URLs", async () => {
  const p = processorPricing("asr_seconds");
  expect(pricingProofSchema.safeParse(p).success).toBe(true);
  const first = p.prices[0];
  if (!first) throw new Error("fixture");
  expect(
    pricingProofSchema.safeParse({ ...p, prices: [{ ...first, model: "@cf/openai/whisper" }] })
      .success,
  ).toBe(false);
  expect(
    pricingProofSchema.safeParse({ ...p, prices: [{ ...first, unit: "tokens" }] }).success,
  ).toBe(false);
  for (const referenceUrl of [
    "https://user:secret@example.test/fx",
    "https://example.test/fx?key=synthetic",
    "https://example.test/fx#token",
  ])
    expect(pricingProofSchema.safeParse({ ...p, fx: { ...p.fx, referenceUrl } }).success).toBe(
      false,
    );
});
test("fractional media admission commits cost and quota together, failed price cannot start processing lease", async () => {
  const f = await fixture(),
    p = processorPricing("asr_seconds");
  expect(await f.runtime.putPricingProof(p, NOW)).toBe(true);
  // Upstream processor probe is synthetic; no R2/ASR/Container execution claimed.
  const fileId = crypto.randomUUID(),
    oldOperation = crypto.randomUUID();
  f.db.sqlite
    .query(
      "INSERT INTO v2_operations(id,owner_id,workspace_id,kind,revision,created_at) VALUES(?,?,?,'file_extract',1,?)",
    )
    .run(oldOperation, f.actor.ownerId, f.workspaceId, NOW);
  const envelope = await f.core.encrypt("v2_files", fileId, f.actor.ownerId, 1, {
    name: "합성 음성.wav",
    declaredMediaType: "audio/wav",
    probe: { category: "audio", format: "wav", byteLength: 100, durationSeconds: 0.5 },
  });
  f.db.sqlite
    .query(
      "INSERT INTO v2_files(id,workspace_id,operation_id,state,declared_bytes,encrypted_payload,created_at,updated_at) VALUES(?,?,?,'uploaded',100,?,?,?)",
    )
    .run(fileId, f.workspaceId, oldOperation, envelope, NOW, NOW);
  const r = {
    ...request(f),
    pricingProofId: p.id,
    service: "asr" as const,
    targetKind: "file" as const,
    targetId: fileId,
    targetRevision: 1,
    plan: {
      ...request(f).plan,
      quantities: [{ sku: "asr_seconds" as const, maximumQuantity: "0.5" }],
    },
  };
  const paid = await f.runtime.prepareHold(f.actor, r);
  expect(paid?.reservedKrw).toBe(500);
  if (!paid) throw new Error("fixture");
  const input = {
    fileId,
    fileRevision: 1,
    jobId: r.jobId,
    admission: { operationId: r.plan.operationId, key: crypto.randomUUID(), requestHash: HASH },
    quotas: [{ kind: "media_processing" as const, originalDurationSeconds: 0.5 }],
  };
  expect(
    await f.jobs.admitFile(
      { ...f.actor, workspaceId: f.workspaceId, expectedRevision: 1 },
      input,
      paid,
    ),
  ).toBe(true);
  expect((await f.accounting.usage(f.actor)).mediaSeconds.reserved).toBe(0.5);
  expect(await f.jobs.acquire(f.actor, r.jobId, crypto.randomUUID(), LATER)).toBeNull();
  expect((await f.accounting.usage(f.actor)).mediaSeconds.used).toBe(0);
  const acquired = await f.jobs.acquire(f.actor, r.jobId, crypto.randomUUID(), LATER, r.attemptId);
  expect(acquired).not.toBeNull();
  expect((await f.accounting.usage(f.actor)).mediaSeconds.used).toBe(0.5);
  if (!acquired) throw new Error("fixture");
  expect(await f.runtime.beforeDispatch(f.actor, acquired.lease, r.attemptId)).not.toBeNull();
});
test("report build admission accepts the same atomic processor hold while preserving immutable reviewed snapshot", async () => {
  const f = await fixture(),
    p = processorPricing("container_cpu_seconds");
  expect(await f.runtime.putPricingProof(p, NOW)).toBe(true);
  const reportId = crypto.randomUUID(),
    base = request(f),
    r = {
      ...base,
      pricingProofId: p.id,
      service: "container" as const,
      targetKind: "report" as const,
      targetId: reportId,
      targetRevision: 1,
      plan: {
        ...base.plan,
        operationRevision: 1,
        quantities: [{ sku: "container_cpu_seconds" as const, maximumQuantity: "1" }],
      },
    };
  const paid = await f.runtime.prepareHold(f.actor, r);
  if (!paid) throw new Error("fixture");
  const reports = createV2ReportsRepository(f.core);
  expect(
    await reports.createSmall(
      { ...f.actor, workspaceId: f.workspaceId, expectedRevision: 1 },
      {
        schemaVersion: "2",
        id: reportId,
        version: 1,
        snapshotRevision: 1,
        summaryRevision: 1,
        createdAt: NOW,
        status: "queued",
        request: {
          expectedRevision: 1,
          selectedFileIds: [],
          editedFields: [],
          maskingChoices: [],
          reviewConfirmed: true,
          includeOriginals: false,
        },
        body: {
          schemaVersion: "2",
          overview: "검토한 합성 리포트",
          parties: [],
          facts: [],
          timeline: [],
          selectedFiles: [],
          unknowns: [],
          actions: [],
          lawyerQuestions: [],
          citations: [],
          legalSourceStatus: "not_requested",
          notices: ["합성 시험"],
          generatedAt: NOW,
        },
        pdf: null,
        originalsZip: null,
        originalManifest: [],
        currentJobId: r.jobId,
        failure: null,
      },
      { operationId: r.plan.operationId, key: crypto.randomUUID(), requestHash: HASH },
      paid,
    ),
  ).toBe(true);
  expect((await f.runtime.exposure(NOW))?.reserved_krw).toBe(1000);
  expect((await reports.read(f.actor, reportId))?.body.overview).toBe("검토한 합성 리포트");
  expect(await f.jobs.acquire(f.actor, r.jobId, crypto.randomUUID(), LATER)).toBeNull();
});
test("profile asset admission binds existing operation request hash and same sanitized-target job/hold", async () => {
  const f = await fixture(),
    p = processorPricing("container_cpu_seconds");
  expect(await f.runtime.putPricingProof(p, NOW)).toBe(true);
  const lawyers = createV2LawyersRepository(f.core),
    storage = createV2StorageRepository(f.core),
    profileId = crypto.randomUUID(),
    assetId = crypto.randomUUID(),
    reservationId = crypto.randomUUID();
  expect(await lawyers.createProfile(f.actor, profileId)).toBe(true);
  const base = request(f),
    admission = { operationId: base.plan.operationId, key: crypto.randomUUID(), requestHash: HASH };
  expect(
    await lawyers.reserveAsset(
      f.actor,
      profileId,
      1,
      assetId,
      { name: "합성 사진.png", purpose: "profile_photo", byteLength: 100, mediaType: "image/png" },
      reservationId,
      admission,
    ),
  ).toBe(true);
  expect(
    await storage.registerBlob(f.actor, {
      id: crypto.randomUUID(),
      reservationId,
      kind: "profile_photo_original",
      visibility: "private",
      logicalBytes: 100,
      cipherBytes: 116,
      cipherHash: HASH,
      contentHash: HASH,
      keyVersion: "1",
    }),
  ).toBe(true);
  expect(await storage.commitReservation(f.actor, reservationId)).toBe(true);
  const r = {
    ...base,
    pricingProofId: p.id,
    service: "container" as const,
    targetKind: "profile_asset" as const,
    targetId: assetId,
    targetRevision: 1,
    plan: {
      ...base.plan,
      operationRevision: 1,
      quantities: [{ sku: "container_cpu_seconds" as const, maximumQuantity: "1" }],
    },
  };
  const paid = await f.runtime.prepareHold(f.actor, r);
  if (!paid) throw new Error("fixture");
  expect(
    await f.jobs.admitAsset(f.actor, { assetId, assetRevision: 1, jobId: r.jobId }, paid),
  ).toBe(true);
  expect((await f.runtime.exposure(NOW))?.reserved_krw).toBe(1000);
  expect(await f.jobs.acquire(f.actor, r.jobId, crypto.randomUUID(), LATER)).toBeNull();
  const lease = await f.jobs.acquire(f.actor, r.jobId, crypto.randomUUID(), LATER, r.attemptId);
  if (!lease) throw new Error("fixture");
  expect(await f.runtime.beforeDispatch(f.actor, lease.lease, r.attemptId)).not.toBeNull();
  expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});

test("legacy settlement cannot bypass trusted paid usage; quote/actor/budget changes and incomplete model footprints fail closed", async () => {
  const f = await fixture(),
    d = await dispatch(f);
  expect(await f.accounting.settleCost(d.r.attemptId, "released", null)).toBe(false);
  expect(await f.accounting.settleCost(d.r.attemptId, "settled", 0)).toBe(false);
  expect((await f.runtime.exposure(NOW))?.reserved_krw).toBe(1000);
  expect(
    await f.runtime.prepareHold(f.actor, {
      ...request(f),
      plan: {
        ...request(f).plan,
        quantities: [{ sku: "model_input_tokens", maximumQuantity: "1" }],
      },
    }),
  ).toBeNull();
  const other = await seedTestSession(f.db, { now: Date.parse(NOW), consent: true });
  expect(
    await f.runtime.beforeDispatch({ ownerId: other.userId, now: NOW }, d.lease, d.r.attemptId),
  ).toBeNull();
});
test("verified over-bound or overflow charge is never discarded: durable usage freezes paid execution", async () => {
  const f = await fixture(),
    d = await dispatch(f);
  expect(
    await f.runtime.recordUsage(
      receipt(d, { chargedUsd: "2", meteringComplete: false, quantities: [] }),
      NOW,
    ),
  ).toBe(true);
  expect((await f.runtime.exposure(NOW))?.settled_krw).toBe(2000);
  expect((await f.runtime.exposure(NOW))?.phase).toBe("frozen");
  const second = await fixture(),
    e = await dispatch(second);
  expect(
    await second.runtime.recordUsage(
      receipt(e, { chargedUsd: "999999999999999999", meteringComplete: false, quantities: [] }),
      NOW,
    ),
  ).toBe(true);
  expect((await second.runtime.exposure(NOW))?.ambiguous_krw).toBe(1000);
  expect((await second.runtime.exposure(NOW))?.phase).toBe("frozen");
  expect(
    second.db.sqlite.query("SELECT outcome,payload_json FROM v2_runtime_usage").get(),
  ).toMatchObject({ outcome: "ambiguous" });
});
