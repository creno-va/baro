import { afterEach, expect, test } from "bun:test";
import { createCaseDataCipher } from "../src/server/crypto";
import {
  type BudgetAllocation,
  createV2AccountingRepository,
} from "../src/server/db/v2-accounting";
import { type Actor, createV2Core } from "../src/server/db/v2-core";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import {
  createV2PaidRuntimeRepository,
  type FundingProof,
  type PaidHoldRequest,
  type PricingProof,
  type RuntimeProofVerifier,
  type UsageReceipt,
} from "../src/server/db/v2-paid-runtime";
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

function independent(d: Awaited<ReturnType<typeof dispatch>>): PaidHoldRequest {
  return {
    ...d.r,
    attemptId: crypto.randomUUID(),
    quoteId: crypto.randomUUID(),
    planId: crypto.randomUUID(),
    attempt: 1,
    plan: { ...d.r.plan, invocationId: crypto.randomUUID() },
  };
}
for (const prior of ["reserved", "ambiguous"] as const)
  test(`fresh authenticated logical invocation can dispatch while prior ${prior} exposure remains fully retained`, async () => {
    const f = await fixture(),
      d = await dispatch(f);
    if (prior === "ambiguous")
      expect(
        await f.runtime.recordUsage(
          receipt(d, { transport: "unknown", meteringComplete: false, quantities: [] }),
          NOW,
        ),
      ).toBe(true);
    const r = independent(d),
      paid = await f.runtime.prepareHold(f.actor, r);
    if (!paid) throw new Error("Synthetic independent proof missing");
    expect(await f.runtime.reserveAttempt(f.actor, d.lease, paid)).toBe(true);
    expect(await f.runtime.reserveAttempt(f.actor, d.lease, paid)).toBe(false);
    const handle = await f.runtime.beforeDispatch(f.actor, d.lease, r.attemptId);
    expect(handle).not.toBeNull();
    expect(await f.runtime.beforeDispatch(f.actor, d.lease, r.attemptId)).toBeNull();
    const exposure = await f.runtime.exposure(NOW);
    expect(exposure?.settled_krw).toBe(0);
    expect(exposure?.reserved_krw).toBe(prior === "reserved" ? 2000 : 1000);
    expect(exposure?.ambiguous_krw).toBe(prior === "ambiguous" ? 1000 : 0);
    expect(
      f.db.sqlite
        .query("SELECT state,reserved_krw,charged_krw FROM v2_cost_attempts WHERE id=?")
        .get(d.r.attemptId),
    ).toEqual({ state: prior, reserved_krw: 1000, charged_krw: null });
    expect((await f.accounting.usage(f.actor)).aiResponses.reserved).toBe(1);
    expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_outbox").get()).toEqual({ n: 1 });
    expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });
for (const prior of ["reserved", "ambiguous"] as const)
  test(`duplicate and blind retry of the same ${prior} invocation cannot dispatch or release its hold`, async () => {
    const f = await fixture(),
      d = await dispatch(f);
    if (prior === "ambiguous")
      expect(
        await f.runtime.recordUsage(
          receipt(d, { transport: "unknown", meteringComplete: false, quantities: [] }),
          NOW,
        ),
      ).toBe(true);
    for (const attempt of [1, 2]) {
      const r = { ...independent(d), attempt, plan: { ...d.r.plan } },
        paid = await f.runtime.prepareHold(f.actor, r);
      if (!paid) throw new Error("Synthetic retry proof missing");
      expect(await f.runtime.reserveAttempt(f.actor, d.lease, paid)).toBe(false);
      expect(await f.runtime.beforeDispatch(f.actor, d.lease, r.attemptId)).toBeNull();
    }
    expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_cost_attempts").get()).toEqual({ n: 1 });
    const exposure = await f.runtime.exposure(NOW);
    expect(exposure?.settled_krw).toBe(0);
    expect((exposure?.reserved_krw ?? 0) + (exposure?.ambiguous_krw ?? 0)).toBe(1000);
  });
test("independent holds retain the full additive budget and funding bound under concurrent admission", async () => {
  const f = await fixture(),
    d = await dispatch(f);
  expect(
    await f.runtime.recordUsage(
      receipt(d, { transport: "unknown", meteringComplete: false, quantities: [] }),
      NOW,
    ),
  ).toBe(true);
  const prepared = await Promise.all(
    Array.from({ length: 12 }, () => f.runtime.prepareHold(f.actor, independent(d))),
  );
  const results = await Promise.all(
    prepared.map((p) => (p ? f.runtime.reserveAttempt(f.actor, d.lease, p) : false)),
  );
  expect(results.filter(Boolean)).toHaveLength(9);
  const exposure = await f.runtime.exposure(NOW);
  expect(exposure?.settled_krw).toBe(0);
  expect(exposure?.ambiguous_krw).toBe(1000);
  expect(exposure?.reserved_krw).toBe(9000);
  expect(
    f.db.sqlite
      .query("SELECT count(*) AS n,sum(reserved_krw) AS total FROM v2_cost_attempts")
      .get(),
  ).toEqual({ n: 10, total: 10000 });
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_runtime_usage").get()).toEqual({ n: 1 });
  expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});
test("independent hold cannot bypass a lower immutable funding ceiling or failed transaction", async () => {
  const f = await fixture(),
    d = await dispatch(f);
  const fp = { ...funding(), spendAllowanceKrw: 1500 };
  expect(await f.runtime.putFundingProof(fp, NOW)).toBe(true);
  const denied = await f.runtime.prepareHold(f.actor, { ...independent(d), fundingProofId: fp.id });
  if (!denied) throw new Error("Synthetic funding proof missing");
  expect(await f.runtime.reserveAttempt(f.actor, d.lease, denied)).toBe(false);
  const paid = await f.runtime.prepareHold(f.actor, independent(d));
  if (!paid) throw new Error("Synthetic independent proof missing");
  f.db.sqlite.exec(
    "CREATE TRIGGER reject_hold BEFORE INSERT ON v2_paid_holds BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END",
  );
  await expect(f.runtime.reserveAttempt(f.actor, d.lease, paid)).rejects.toThrow(
    "DB_OPERATION_FAILED",
  );
  expect((await f.runtime.exposure(NOW))?.reserved_krw).toBe(1000);
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_cost_attempts").get()).toEqual({ n: 1 });
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_mutation_claims").get()).toEqual({ n: 0 });
});
