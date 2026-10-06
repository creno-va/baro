import { afterEach, expect, test } from "bun:test";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts";
import { createCaseDataCipher } from "../src/server/crypto";
import {
  type BudgetAllocation,
  createV2AccountingRepository,
} from "../src/server/db/v2-accounting";
import { type Actor, createV2Core, sqlClaim } from "../src/server/db/v2-core";
import { createV2FilesRepository } from "../src/server/db/v2-files";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createV2LawyersRepository } from "../src/server/db/v2-lawyers";
import {
  createV2PaidRuntimeRepository,
  type FundingProof,
  type PricingProof,
  type RuntimeProofVerifier,
  runtimeDigest,
  type UsageReceipt,
} from "../src/server/db/v2-paid-runtime";
import type { StoragePaidHoldRequest } from "../src/server/db/v2-storage-paid-contracts";
import { createV2StoragePaidRuntimeRepository } from "../src/server/db/v2-storage-paid-runtime";
import {
  createStorageBudgetService,
  type StorageAdmission,
  type StorageBounds,
  type StorageCostInput,
} from "../src/server/modules/budget/storage-ledger";
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
    prices: ["r2_class_a_requests", "r2_class_b_requests", "r2_storage_gb_months"].map((sku) => ({
      sku: sku as "r2_class_a_requests" | "r2_class_b_requests" | "r2_storage_gb_months",
      modelRates: null,
      provider: "cloudflare" as const,
      model: null,
      region: "global",
      plan: "synthetic",
      billingMode: "metered" as const,
      unit: sku === "r2_storage_gb_months" ? ("gb_months" as const) : ("requests" as const),
      unitSize: "1",
      usdPerUnit: "1",
      billingQuantum: "1",
      officialUrl: "https://developers.cloudflare.com/r2/pricing/",
      checkedAt: NOW,
      validUntil: EXP,
    })),
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
async function fixture(
  options: { throughMigration?: string; skipPricing?: boolean; skipFunding?: boolean } = {},
) {
  const db = await createTestDatabase(options);
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
  if (!options.skipPricing) expect(await runtime.putPricingProof(pp, NOW)).toBe(true);
  if (!options.skipFunding) expect(await runtime.putFundingProof(fp, NOW)).toBe(true);
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

async function originalFixture(
  kind: "case_original" | "lawyer_original" = "case_original",
  options: { skipPricing?: boolean; skipFunding?: boolean } = {},
) {
  const f = await fixture(options),
    id = crypto.randomUUID(),
    reservationId = crypto.randomUUID(),
    uploadId = crypto.randomUUID();
  if (kind === "case_original") {
    const files = createV2FilesRepository(f.core);
    f.db.sqlite
      .query("INSERT INTO v2_case_original_usage(workspace_id) VALUES(?)")
      .run(f.workspaceId);
    expect(
      await files.reserve(
        { ...f.actor, workspaceId: f.workspaceId, expectedRevision: 1 },
        {
          name: "합성 원본",
          byteLength: 100,
          mediaType: "application/pdf",
          autoProcessConsentVersion: CURRENT_POLICY_VERSIONS.aiNoticeVersion,
        },
        {
          fileId: id,
          uploadId,
          reservationId,
          consentId: crypto.randomUUID(),
          expiresAt: EXP,
          admission: {
            operationId: crypto.randomUUID(),
            key: crypto.randomUUID(),
            requestHash: HASH,
          },
        },
      ),
    ).not.toBeNull();
  } else {
    const lawyers = createV2LawyersRepository(f.core),
      profileId = crypto.randomUUID();
    expect(await lawyers.createProfile(f.actor, profileId)).toBe(true);
    expect(
      await lawyers.reserveAsset(
        f.actor,
        profileId,
        1,
        id,
        {
          purpose: "portfolio",
          name: "합성 포트폴리오",
          byteLength: 100,
          mediaType: "application/pdf",
        },
        reservationId,
        { operationId: crypto.randomUUID(), key: crypto.randomUUID(), requestHash: HASH },
      ),
    ).toBe(true);
  }
  const o = f.db.sqlite
    .query(
      "SELECT o.id,o.revision FROM v2_operations o JOIN v2_storage_reservations r ON r.operation_id=o.id WHERE r.id=?",
    )
    .get(reservationId) as { id: string; revision: number };
  const r: StoragePaidHoldRequest = {
    attemptId: crypto.randomUUID(),
    quoteId: crypto.randomUUID(),
    planId: crypto.randomUUID(),
    pricingProofId: f.pp.id,
    fundingProofId: f.fp.id,
    attempt: 1,
    service: "requests",
    targetKind: kind === "case_original" ? "file" : "profile_asset",
    targetId: id,
    targetRevision: 1,
    reservationId,
    blobId: crypto.randomUUID(),
    intent: kind === "case_original" ? { kind, uploadId, uploadRevision: 1, ordinal: 0 } : { kind },
    pending: {
      logicalBytes: 100,
      cipherBytes: kind === "case_original" ? 120 : 0,
      cipherHash: kind === "case_original" ? HASH : null,
      keyVersion: kind === "case_original" ? "binary_v1" : "asset_binary_v1",
    },
    plan: {
      operationId: o.id,
      operationRevision: o.revision,
      requestHash: HASH,
      invocationId: crypto.randomUUID(),
      maximumAttempts: 2,
      deadlineAt: LATER,
      quantities: [{ sku: "r2_class_a_requests", maximumQuantity: "1" }],
    },
  };
  return {
    ...f,
    r,
    storageRuntime: createV2StoragePaidRuntimeRepository(f.core, "preview", verifier),
  };
}

type Fixture = Awaited<ReturnType<typeof originalFixture>>;
function input(f: Fixture): StorageCostInput {
  return {
    runId: "synthetic_storage_run",
    attemptOrdinal: 1,
    maximumAttempts: 2,
    deadlineAt: LATER,
    action: "r2_put",
    service: "requests",
    operationId: f.r.plan.operationId,
    operationRevision: f.r.plan.operationRevision,
    requestHash: HASH,
    targetKind: f.r.targetKind,
    targetId: f.r.targetId,
    targetRevision: f.r.targetRevision,
    reservationId: f.r.reservationId,
    blobId: f.r.blobId,
    pending: f.r.pending,
    intent: f.r.intent,
  };
}
const bounds = async (
  _input: Readonly<StorageCostInput>,
  inputDigest: string,
  now: string,
): Promise<StorageBounds> => ({
  inputDigest,
  evidenceHash: HASH,
  verifiedAt: now,
  validUntil: LATER,
  quantities: [{ sku: "r2_class_a_requests", maximumQuantity: "1" }],
});
async function admitted(f: Fixture, a: StorageAdmission) {
  const c = crypto.randomUUID(),
    r = a.request;
  const payload = await f.core.encrypt("v2_blobs", r.blobId, a.actor.ownerId, 1, {
    contentHash: HASH,
  });
  expect(
    await f.core.changed([
      f.core.statement(
        `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,?,?,? WHERE ${a.paid.predicate.sql}`,
        [c, a.actor.ownerId, r.targetId, r.targetRevision, ...a.paid.predicate.values],
      ),
      f.core.statement(
        `INSERT INTO v2_blobs(id,principal_id,reservation_id,kind,visibility,state,object_key,logical_bytes,cipher_bytes,cipher_hash,key_version,encrypted_payload,created_at) SELECT ?,principal_id,id,?,'private','pending',?,?,?,?,?,?,? FROM v2_storage_reservations WHERE id=? AND ${sqlClaim}`,
        [
          r.blobId,
          r.intent.kind === "case_original" ? "original" : "portfolio_original",
          `private/${r.blobId}`,
          r.pending.logicalBytes,
          r.pending.cipherBytes,
          r.pending.cipherHash,
          r.pending.keyVersion,
          payload,
          a.actor.now,
          r.reservationId,
          c,
        ],
      ),
      ...(await a.paid.statements(f.core, a.actor, c, payload)),
      f.core.finish(c),
    ]),
  ).toBe(true);
}
function money(f: Fixture) {
  return f.db.sqlite
    .query(
      "SELECT reserved_krw,ambiguous_krw,settled_krw FROM v2_monthly_budget WHERE month='2026-10'",
    )
    .get();
}
async function prepared(
  service: ReturnType<typeof createStorageBudgetService>,
  v: StorageCostInput,
) {
  const a = await service.prepare(v);
  expect(a).not.toBeNull();
  if (!a) throw new Error("Synthetic admission missing");
  return a;
}
test("trusted current DB proofs compose real pending and financial admission with frozen advancing actor", async () => {
  const f = await originalFixture();
  let now = NOW;
  const costs = createStorageBudgetService({
    core: f.core,
    environment: "preview",
    ownerId: f.actor.ownerId,
    clock: () => now,
    bounds,
  });
  const v = input(f),
    a = await prepared(costs, v);
  v.pending.cipherHash = "b".repeat(64);
  expect(a.request.pending.cipherHash).toBe(HASH);
  expect(Object.isFrozen(a.actor)).toBe(true);
  now = "2026-10-06T00:00:00.010Z";
  await admitted(f, a);
  const p = await costs.beforeDispatch(a, async () => true);
  expect(p).not.toBeNull();
  expect(await costs.beforeDispatch(a, async () => true)).toBeNull();
  expect(money(f)).toEqual({ reserved_krw: 1000, ambiguous_krw: 0, settled_krw: 0 });
  if (!p) throw new Error("Synthetic dispatch missing");
  await costs.after(p, { transport: "response", definitiveNoCharge: false, observedAt: now });
  expect(money(f)).toEqual({ reserved_krw: 1000, ambiguous_krw: 0, settled_krw: 0 });
});
for (const failure of [
  "missing_bounds",
  "wrong_digest",
  "future_verified",
  "expired_bounds",
  "unverified_retention",
  "frozen",
  "missing_funding",
  "missing_pricing",
  "wrong_environment",
] as const)
  test(`jobless bridge denies ${failure} without fake billing or jobs`, async () => {
    const f = await originalFixture("case_original", {
      skipFunding: failure === "missing_funding",
      skipPricing: failure === "missing_pricing",
    });
    if (failure === "frozen")
      f.db.sqlite.query("UPDATE v2_runtime_controls SET phase='frozen'").run();
    const port =
      failure === "missing_bounds"
        ? undefined
        : async (v: Readonly<StorageCostInput>, hash: string, now: string) => {
            const p = await bounds(v, hash, now);
            return failure === "wrong_digest"
              ? { ...p, inputDigest: "b".repeat(64) }
              : failure === "future_verified"
                ? { ...p, verifiedAt: LATER }
                : failure === "expired_bounds"
                  ? { ...p, validUntil: NOW }
                  : p;
          };
    const costs = createStorageBudgetService({
      core: f.core,
      environment: failure === "wrong_environment" ? "production" : "preview",
      ownerId: f.actor.ownerId,
      clock: () => NOW,
      ...(port ? { bounds: port } : {}),
    });
    expect(
      await costs.prepare({
        ...input(f),
        ...(failure === "unverified_retention" ? { service: "storage" as const } : {}),
      }),
    ).toBeNull();
    expect(money(f)).toEqual({ reserved_krw: 0, ambiguous_krw: 0, settled_krw: 0 });
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_jobs").get()).toEqual({ n: 0 });
  });
test("cloned admissions/permits and changed action do not acquire closure authority", async () => {
  const f = await originalFixture(),
    costs = createStorageBudgetService({
      core: f.core,
      environment: "preview",
      ownerId: f.actor.ownerId,
      clock: () => NOW,
      bounds,
    }),
    a = await prepared(costs, input(f));
  await admitted(f, a);
  expect(await costs.beforeDispatch({ ...a }, async () => true)).toBeNull();
  expect(await costs.prepare({ ...input(f), action: "public_copy" })).toBeNull();
  const p = await costs.beforeDispatch(a, async () => true);
  if (!p) throw new Error("Synthetic permit missing");
  await costs.after({ ...p }, { transport: "not_sent", definitiveNoCharge: true, observedAt: NOW });
  expect(money(f)).toEqual({ reserved_krw: 1000, ambiguous_krw: 0, settled_krw: 0 });
});
test("retry keeps exact immutable logical invocation and cannot replace unknown exposure", async () => {
  const f = await originalFixture(),
    costs = createStorageBudgetService({
      core: f.core,
      environment: "preview",
      ownerId: f.actor.ownerId,
      clock: () => NOW,
      bounds,
    });
  const a = await prepared(costs, input(f));
  await admitted(f, a);
  const p = await costs.beforeDispatch(a, async () => true);
  expect(p).not.toBeNull();
  const retry = await prepared(costs, { ...input(f), attemptOrdinal: 2 });
  expect(retry.request.plan.invocationId).toBe(a.request.plan.invocationId);
  expect(retry.request.attemptId).not.toBe(a.request.attemptId);
  const c = crypto.randomUUID();
  expect(
    await f.core.changed([
      f.core.statement(
        `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,?,?,? WHERE ${retry.paid.predicate.sql}`,
        [c, f.actor.ownerId, f.r.targetId, 1, ...retry.paid.predicate.values],
      ),
      f.core.finish(c),
    ]),
  ).toBe(false);
  expect(money(f)).toEqual({ reserved_krw: 1000, ambiguous_krw: 0, settled_krw: 0 });
});
for (const stage of ["proof_await", "dispatch_await", "access_await"] as const)
  test(`fresh clock rejects expiry during ${stage} and retains the complete admitted hold`, async () => {
    const f = await originalFixture();
    let now = NOW;
    const costs = createStorageBudgetService({
        core: f.core,
        environment: "preview",
        ownerId: f.actor.ownerId,
        clock: () => now,
        bounds,
      }),
      a = await prepared(costs, input(f));
    await admitted(f, a);
    let calls = 0;
    const access = async () => {
      calls++;
      if ((stage === "proof_await" && calls === 2) || (stage === "access_await" && calls === 1))
        now = LATER;
      if (
        stage === "dispatch_await" &&
        f.db.sqlite.query("SELECT 1 FROM v2_storage_paid_executions WHERE state='dispatched'").get()
      )
        now = LATER;
      return true;
    };
    expect(await costs.beforeDispatch(a, access)).toBeNull();
    expect(money(f)).toEqual({ reserved_krw: 1000, ambiguous_krw: 0, settled_krw: 0 });
  });
test("rights withdrawn after proof await reject actual one-time dispatch", async () => {
  const f = await originalFixture(),
    costs = createStorageBudgetService({
      core: f.core,
      environment: "preview",
      ownerId: f.actor.ownerId,
      clock: () => NOW,
      bounds,
    }),
    a = await prepared(costs, input(f));
  await admitted(f, a);
  let checks = 0;
  expect(await costs.beforeDispatch(a, async () => ++checks < 3)).toBeNull();
  expect(f.db.sqlite.query("SELECT state FROM v2_storage_paid_executions").get()).toEqual({
    state: "prepared",
  });
});
test("actual authenticated late receipt settles after owner deletion without new permission or fake zero", async () => {
  const f = await originalFixture();
  let now = NOW;
  const costs = createStorageBudgetService({
      core: f.core,
      environment: "preview",
      ownerId: f.actor.ownerId,
      clock: () => now,
      bounds,
      async metering(r, p, t, observed) {
        const receipt: UsageReceipt = {
          id: crypto.randomUUID(),
          attemptId: r.attemptId,
          invocationId: r.plan.invocationId,
          dispatchToken: p.dispatchToken,
          providerRequestId: "synthetic_actual_billing",
          observedAt: observed,
          transport: t.transport,
          definitiveNoCharge: t.definitiveNoCharge,
          meteringComplete: t.transport === "response",
          quantities:
            t.transport === "response" ? [{ sku: "r2_class_a_requests", quantity: "1" }] : [],
          chargedUsd: t.transport === "response" ? "0.5" : null,
          modelTokenDetails: null,
        };
        const hash = await runtimeDigest(receipt);
        return {
          receipt,
          evidence: {
            digest: hash,
            evidenceHash: HASH,
            method: "provider_receipt",
            verifiedAt: observed,
          },
        };
      },
    }),
    a = await prepared(costs, input(f));
  await admitted(f, a);
  const p = await costs.beforeDispatch(a, async () => true);
  if (!p) throw new Error("Synthetic dispatch missing");
  await costs.after(p, { transport: "not_sent", definitiveNoCharge: true, observedAt: now });
  expect(money(f)).toEqual({ reserved_krw: 1000, ambiguous_krw: 0, settled_krw: 0 });
  await costs.after(p, { transport: "unknown", definitiveNoCharge: false, observedAt: now });
  expect(money(f)).toEqual({ reserved_krw: 0, ambiguous_krw: 1000, settled_krw: 0 });
  f.db.sqlite.query("DELETE FROM user WHERE id=?").run(f.actor.ownerId);
  now = "2026-11-01T00:00:00.000Z";
  await costs.after(p, { transport: "response", definitiveNoCharge: false, observedAt: now });
  expect(money(f)).toEqual({ reserved_krw: 0, ambiguous_krw: 0, settled_krw: 500 });
  await costs.after(p, { transport: "response", definitiveNoCharge: false, observedAt: now });
  expect(money(f)).toEqual({ reserved_krw: 0, ambiguous_krw: 0, settled_krw: 500 });
});
