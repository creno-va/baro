import { afterEach, expect, test } from "bun:test";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts";
import { createCaseDataCipher } from "../src/server/crypto";
import {
  type BudgetAllocation,
  createV2AccountingRepository,
  operationStatements,
} from "../src/server/db/v2-accounting";
import { type Actor, createV2Core, safe, sqlClaim } from "../src/server/db/v2-core";
import { createV2FilesRepository } from "../src/server/db/v2-files";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createV2LawyersRepository } from "../src/server/db/v2-lawyers";
import {
  createV2PaidRuntimeRepository,
  type FundingProof,
  type PricingProof,
  type RuntimeProofVerifier,
  type UsageReceipt,
} from "../src/server/db/v2-paid-runtime";
import { storageReservationStatements } from "../src/server/db/v2-storage";
import type { StoragePaidHoldRequest } from "../src/server/db/v2-storage-paid-contracts";
import {
  createV2StoragePaidRuntimeRepository,
  isPreparedStoragePaidHold,
  type PreparedStoragePaidHold,
} from "../src/server/db/v2-storage-paid-runtime";
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
async function fixture(options: { throughMigration?: string } = {}) {
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

async function originalFixture(kind: "case_original" | "lawyer_original" = "case_original") {
  const f = await fixture(),
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
type StorageFixture = Awaited<ReturnType<typeof originalFixture>>;
async function publicFixture() {
  const f = await originalFixture("lawyer_original"),
    a = f.r.targetId,
    db = f.db.sqlite;
  const profileId = (
    db.query("SELECT profile_id FROM v2_assets WHERE id=?").get(a) as { profile_id: string }
  ).profile_id;
  const principal = (
    db.query("SELECT id FROM v2_billing_principals WHERE owner_id=?").get(f.actor.ownerId) as {
      id: string;
    }
  ).id;
  const source = crypto.randomUUID(),
    sourceReservation = crypto.randomUUID(),
    app = crypto.randomUUID(),
    revision = crypto.randomUUID(),
    publish = crypto.randomUUID();
  const sourcePayload = await f.core.encrypt("v2_blobs", source, f.actor.ownerId, 1, {
    contentHash: HASH,
  });
  const assetPayload = await f.core.encrypt("v2_assets", a, f.actor.ownerId, 2, {
    id: a,
    revision: 2,
    kind: "pdf",
    status: "ready",
    byteLength: 100,
    originalHash: HASH,
    sanitizedDerivative: { id: source, byteLength: 60, contentHash: HASH, format: "pdf" },
    currentJobId: null,
    failure: null,
  });
  // Synthetic upstream processor and human moderation rows. No real R2/manual
  // verification or publication is asserted by these DB-focused fixtures.
  db.query(
    "INSERT INTO v2_storage_reservations(id,principal_id,entity_id,target_id,kind,state,byte_length,operation_id,created_at) VALUES(?,?,?,?,'lawyer_asset','stored',60,?,?)",
  ).run(sourceReservation, principal, a, source, f.r.plan.operationId, NOW);
  db.query(
    "INSERT INTO v2_blobs(id,principal_id,reservation_id,kind,visibility,state,object_key,logical_bytes,cipher_bytes,cipher_hash,key_version,encrypted_payload,created_at) VALUES(?,?,?,'portfolio_sanitized','staging','stored',?,60,76,?,'asset_sanitized_v1',?,?)",
  ).run(source, principal, sourceReservation, `private/${source}`, HASH, sourcePayload, NOW);
  db.query(
    "UPDATE v2_assets SET revision=2,state='ready',sanitized_blob_id=?,encrypted_payload=? WHERE id=?",
  ).run(source, assetPayload, a);
  db.query("UPDATE v2_storage_usage SET stored_bytes=stored_bytes+60 WHERE principal_id=?").run(
    principal,
  );
  db.query(
    "INSERT INTO v2_applications(id,owner_id,status,encrypted_payload,submitted_at,decided_at,created_at) VALUES(?,?,'approved',?,?,?,?)",
  ).run(
    app,
    f.actor.ownerId,
    await f.core.encrypt("v2_applications", app, f.actor.ownerId, 1, {}),
    NOW,
    NOW,
    NOW,
  );
  db.query(
    "INSERT INTO v2_profile_revisions(id,profile_id,revision,status,application_id,encrypted_payload,submitted_at,decided_at,created_at) VALUES(?,?,1,'approved',?,?,?,?,?)",
  ).run(
    revision,
    profileId,
    app,
    await f.core.encrypt("v2_profile_revisions", revision, f.actor.ownerId, 1, {}),
    NOW,
    NOW,
    NOW,
  );
  db.query("INSERT INTO v2_profile_revision_assets VALUES(?,?,2,0)").run(revision, a);
  db.query(
    "INSERT INTO v2_role_bindings(owner_id,role,granted_at) VALUES(?,'verified_lawyer',?)",
  ).run(f.actor.ownerId, NOW);
  db.query(
    "INSERT INTO v2_moderation_decisions(id,target_kind,target_id,target_revision,reviewer_id,owner_id,decision,encrypted_payload,oauth_authenticated_at,created_at) VALUES(?,'profile',?,1,?,?,'approve',?,?,?)",
  ).run(
    crypto.randomUUID(),
    revision,
    "synthetic_other_reviewer",
    f.actor.ownerId,
    await f.core.encrypt("v2_moderation_decisions", "synthetic_decision", f.actor.ownerId, 1, {}),
    NOW,
    NOW,
  );
  const claim = crypto.randomUUID();
  await f.core.changed([
    f.core.statement("INSERT INTO v2_mutation_claims VALUES(?,?,?,1,1)", [
      claim,
      f.actor.ownerId,
      profileId,
    ]),
    ...operationStatements(
      f.core,
      f.actor,
      {
        id: publish,
        workspaceId: null,
        kind: "profile_revision",
        revision: 1,
        route: "/internal/publication",
        key: crypto.randomUUID(),
        requestHash: HASH,
      },
      claim,
    ),
    f.core.statement(
      "INSERT INTO v2_outbox(id,operation_id,kind,target_id,revision,next_attempt_at,created_at) VALUES(?,?,'profile_publish',?,1,?,?)",
      [crypto.randomUUID(), publish, profileId, NOW, NOW],
    ),
    f.core.finish(claim),
  ]);
  f.r = {
    ...f.r,
    targetRevision: 2,
    reservationId: crypto.randomUUID(),
    blobId: crypto.randomUUID(),
    intent: { kind: "approved_public_copy", approvedRevisionId: revision, sourceBlobId: source },
    pending: { logicalBytes: 60, cipherBytes: 0, cipherHash: null, keyVersion: null },
    plan: { ...f.r.plan, operationId: publish, operationRevision: 1 },
  };
  return { ...f, profileId, sourceReservation };
}
async function prepare(f: StorageFixture, r = f.r) {
  const p = await f.storageRuntime.prepareHold(f.actor, r);
  expect(p).not.toBeNull();
  if (!p) throw new Error("Synthetic prepared hold missing");
  return p;
}
async function admit(
  f: StorageFixture,
  p: PreparedStoragePaidHold,
  options: { skipPending?: boolean; wrongPayload?: boolean; reusePending?: boolean } = {},
) {
  const actor = p.actor,
    r = p.request,
    claim = crypto.randomUUID(),
    payload = options.reusePending
      ? (
          f.db.sqlite.query("SELECT encrypted_payload FROM v2_blobs WHERE id=?").get(r.blobId) as {
            encrypted_payload: string;
          }
        ).encrypted_payload
      : await f.core.encrypt("v2_blobs", r.blobId, actor.ownerId, 1, { contentHash: HASH });
  const statements = [
    f.core.statement(
      `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,?,?,? WHERE ${p.predicate.sql}`,
      [claim, actor.ownerId, r.targetId, r.targetRevision, ...p.predicate.values],
    ),
  ];
  if (r.intent.kind === "approved_public_copy") {
    const profileId = (
      f.db.sqlite.query("SELECT profile_id FROM v2_assets WHERE id=?").get(r.targetId) as {
        profile_id: string;
      }
    ).profile_id;
    statements.push(
      ...storageReservationStatements(
        f.core,
        actor,
        {
          id: r.reservationId,
          kind: "lawyer_asset",
          profileId,
          assetId: r.targetId,
          byteLength: r.pending.logicalBytes,
          state: "reserved",
        },
        (
          f.db.sqlite
            .query("SELECT operation_id FROM v2_storage_reservations WHERE target_id=?")
            .get(r.intent.sourceBlobId) as { operation_id: string }
        ).operation_id,
        claim,
        r.blobId,
      ),
    );
  }
  const kind =
      r.intent.kind === "case_original"
        ? "original"
        : r.intent.kind === "lawyer_original"
          ? "portfolio_original"
          : "public_copy",
    publicCopy = r.intent.kind === "approved_public_copy";
  if (!options.skipPending && !options.reusePending)
    statements.push(
      f.core.statement(
        `INSERT INTO v2_blobs(id,principal_id,reservation_id,kind,visibility,state,object_key,logical_bytes,cipher_bytes,cipher_hash,key_version,encrypted_payload,created_at,source_blob_id,source_asset_revision,approved_revision_id) SELECT ?,principal_id,id,?,?,'pending',?,?,?,?,?,?,?,?,?,? FROM v2_storage_reservations WHERE id=? AND ${sqlClaim}`,
        [
          r.blobId,
          kind,
          publicCopy ? "public" : "private",
          `${publicCopy ? "public" : "private"}/${r.blobId}`,
          r.pending.logicalBytes,
          r.pending.cipherBytes,
          r.pending.cipherHash,
          r.pending.keyVersion,
          options.wrongPayload ? "mismatched_envelope" : payload,
          actor.now,
          publicCopy ? r.intent.sourceBlobId : null,
          publicCopy ? r.targetRevision : null,
          publicCopy ? r.intent.approvedRevisionId : null,
          r.reservationId,
          claim,
        ],
      ),
    );
  statements.push(...(await p.statements(f.core, actor, claim, payload)), f.core.finish(claim));
  return safe(() => f.core.changed(statements));
}
function cost(f: StorageFixture) {
  return f.db.sqlite
    .query("SELECT reserved_krw,ambiguous_krw,settled_krw FROM v2_monthly_budget WHERE month=?")
    .get("2026-10");
}
function usage(
  f: StorageFixture,
  token: string | null,
  patch: Partial<UsageReceipt> = {},
): UsageReceipt {
  return {
    id: crypto.randomUUID(),
    attemptId: f.r.attemptId,
    invocationId: f.r.plan.invocationId,
    providerRequestId: "synthetic_provider_receipt",
    dispatchToken: token,
    observedAt: NOW,
    transport: "response",
    definitiveNoCharge: false,
    meteringComplete: true,
    quantities: [{ sku: "r2_class_a_requests", quantity: "1" }],
    chargedUsd: null,
    modelTokenDetails: null,
    ...patch,
  };
}

for (const kind of ["case_original", "lawyer_original"] as const)
  test(`${kind} atomic actual pending scope has no fabricated job and one-time paid dispatch`, async () => {
    const f = await originalFixture(kind),
      p = await prepare(f);
    expect(Object.isFrozen(p.actor)).toBe(true);
    expect(isPreparedStoragePaidHold(p)).toBe(true);
    expect(isPreparedStoragePaidHold({ ...p })).toBe(false);
    expect(await admit(f, p)).toBe(true);
    expect(cost(f)).toEqual({ reserved_krw: 1000, ambiguous_krw: 0, settled_krw: 0 });
    expect(f.db.sqlite.query("SELECT count(*) count FROM v2_jobs").get()).toEqual({ count: 0 });
    const d = await f.storageRuntime.beforeDispatch(f.actor, f.r.attemptId);
    expect(d).not.toBeNull();
    if (!d) throw new Error("Synthetic dispatch missing");
    expect(await f.storageRuntime.beforeDispatch(f.actor, f.r.attemptId)).toBeNull();
    expect(await f.storageRuntime.recordUsage(usage(f, d.dispatchToken), NOW)).toBe(true);
    expect(cost(f)).toEqual({ reserved_krw: 0, ambiguous_krw: 0, settled_krw: 1000 });
    expect(await f.storageRuntime.recordUsage(usage(f, d.dispatchToken), NOW)).toBe(false);
    expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });
test("public copy binds actual approved source and publication operation distinct from completed sanitize source", async () => {
  const f = await publicFixture();
  f.db.sqlite
    .query(
      "UPDATE v2_operations SET state='completed' WHERE id=(SELECT operation_id FROM v2_storage_reservations WHERE id=?)",
    )
    .run(f.sourceReservation);
  const p = await prepare(f);
  expect(await admit(f, p)).toBe(true);
  const d = await f.storageRuntime.beforeDispatch(f.actor, f.r.attemptId);
  expect(d).not.toBeNull();
  const binding = f.db.sqlite
    .query("SELECT scope,operation_id,payload_json,anchor_json FROM v2_storage_paid_executions")
    .get() as { scope: string; operation_id: string; payload_json: string; anchor_json: string };
  expect(binding.scope).toBe("approved_public_copy");
  expect(binding.operation_id).toBe(f.r.plan.operationId);
  expect(binding.anchor_json).toMatch(
    /^\{"source":"[a-f0-9]{64}","pendingPayload":"[a-f0-9]{64}"\}$/,
  );
  expect(binding.payload_json).not.toContain("encrypted_payload");
  expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});
for (const defect of ["skipPending", "wrongPayload"] as const)
  test(`atomic ${defect} pending fails and rolls back all costs/storage`, async () => {
    const f = await originalFixture();
    const p = await prepare(f);
    const before = cost(f);
    await expect(admit(f, p, { [defect]: true })).rejects.toThrow("DB_OPERATION_FAILED");
    expect(cost(f)).toEqual(before);
    expect(f.db.sqlite.query("SELECT count(*) count FROM v2_blobs").get()).toEqual({ count: 0 });
    expect(f.db.sqlite.query("SELECT count(*) count FROM v2_cost_attempts").get()).toEqual({
      count: 0,
    });
  });
test("frozen admission actor survives advancing consumer clock and mutable input", async () => {
  const f = await originalFixture();
  const p = await prepare(f);
  f.r.pending.logicalBytes = 99;
  expect(p.request.pending.logicalBytes).toBe(100);
  await expect(
    p.statements(f.core, { ...p.actor, now: LATER }, "synthetic_claim", "cipher"),
  ).rejects.toThrow("RUNTIME_HOLD_ACTOR_MISMATCH");
  expect(await admit(f, p)).toBe(true);
});
test("owner, request hash, operation revision, pending type, expired price and absent verifier fail before mutation", async () => {
  const f = await originalFixture();
  expect(
    await f.storageRuntime.prepareHold({ ...f.actor, ownerId: "foreign_owner" }, f.r),
  ).toBeNull();
  for (const r of [
    { ...f.r, plan: { ...f.r.plan, requestHash: "b".repeat(64) } },
    { ...f.r, plan: { ...f.r.plan, operationRevision: 999 } },
    { ...f.r, pending: { ...f.r.pending, keyVersion: "asset_binary_v1" } },
    { ...f.r, plan: { ...f.r.plan, deadlineAt: EXP } },
  ])
    expect(await f.storageRuntime.prepareHold(f.actor, r)).toBeNull();
  expect(
    await createV2StoragePaidRuntimeRepository(f.core, "preview").prepareHold(f.actor, f.r),
  ).toBeNull();
  expect(f.db.sqlite.query("SELECT count(*) count FROM v2_cost_attempts").get()).toEqual({
    count: 0,
  });
});
test("concurrent independent R2 scopes retain additive holds within exact funding and allocation", async () => {
  const f = await originalFixture(),
    plans: PreparedStoragePaidHold[] = [];
  for (let i = 0; i < 12; i++) {
    const fileId = crypto.randomUUID(),
      uploadId = crypto.randomUUID(),
      reservationId = crypto.randomUUID(),
      operationId = crypto.randomUUID();
    const workspace = f.db.sqlite
      .query("SELECT revision FROM v2_workspaces WHERE id=?")
      .get(f.workspaceId) as { revision: number };
    expect(
      await createV2FilesRepository(f.core).reserve(
        { ...f.actor, workspaceId: f.workspaceId, expectedRevision: workspace.revision },
        {
          name: "합성 독립 원본",
          byteLength: 100,
          mediaType: "application/pdf",
          autoProcessConsentVersion: CURRENT_POLICY_VERSIONS.aiNoticeVersion,
        },
        {
          fileId,
          uploadId,
          reservationId,
          consentId: crypto.randomUUID(),
          expiresAt: EXP,
          admission: { operationId, key: crypto.randomUUID(), requestHash: HASH },
        },
      ),
    ).not.toBeNull();
    const operation = f.db.sqlite
      .query("SELECT revision FROM v2_operations WHERE id=?")
      .get(operationId) as { revision: number };
    plans.push(
      await prepare(f, {
        ...f.r,
        attemptId: crypto.randomUUID(),
        quoteId: crypto.randomUUID(),
        planId: crypto.randomUUID(),
        blobId: crypto.randomUUID(),
        targetId: fileId,
        reservationId,
        intent: { kind: "case_original", uploadId, uploadRevision: 1, ordinal: 0 },
        plan: {
          ...f.r.plan,
          operationId,
          operationRevision: operation.revision,
          invocationId: crypto.randomUUID(),
        },
      }),
    );
  }
  const winners = (await Promise.all(plans.map((p) => admit(f, p)))).filter(Boolean);
  expect(winners).toHaveLength(10);
  expect(cost(f)).toEqual({ reserved_krw: 10000, ambiguous_krw: 0, settled_krw: 0 });
  expect(f.db.sqlite.query("SELECT count(*) count FROM v2_cost_attempts").get()).toEqual({
    count: 10,
  });
});
test("unknown hold blocks same authenticated invocation retry but retains distinct logical exposure", async () => {
  const f = await originalFixture(),
    p = await prepare(f);
  expect(await admit(f, p)).toBe(true);
  const d = await f.storageRuntime.beforeDispatch(f.actor, f.r.attemptId);
  if (!d) throw new Error("Synthetic dispatch missing");
  expect(
    await f.storageRuntime.recordUsage(
      usage(f, d.dispatchToken, { transport: "unknown", meteringComplete: false, quantities: [] }),
      NOW,
    ),
  ).toBe(true);
  const retry = await prepare(f, {
    ...f.r,
    attempt: 2,
    attemptId: crypto.randomUUID(),
    quoteId: crypto.randomUUID(),
    planId: crypto.randomUUID(),
  });
  expect(await admit(f, retry, { reusePending: true })).toBe(false);
  const fresh = await prepare(f, {
    ...f.r,
    attemptId: crypto.randomUUID(),
    quoteId: crypto.randomUUID(),
    planId: crypto.randomUUID(),
    plan: { ...f.r.plan, invocationId: crypto.randomUUID() },
  });
  expect(await admit(f, fresh, { reusePending: true })).toBe(true);
  expect(f.db.sqlite.query("SELECT count(*) count FROM v2_blobs").get()).toEqual({ count: 1 });
  expect(cost(f)).toEqual({ reserved_krw: 1000, ambiguous_krw: 1000, settled_krw: 0 });
});
test("another pending object cannot exceed the actual reservation or account capacity", async () => {
  const f = await originalFixture(),
    p = await prepare(f);
  expect(await admit(f, p)).toBe(true);
  expect(
    await f.storageRuntime.prepareHold(f.actor, {
      ...f.r,
      blobId: crypto.randomUUID(),
      attemptId: crypto.randomUUID(),
      quoteId: crypto.randomUUID(),
      planId: crypto.randomUUID(),
      plan: { ...f.r.plan, invocationId: crypto.randomUUID() },
    }),
  ).toBeNull();
  expect(
    await f.storageRuntime.prepareHold(f.actor, {
      ...f.r,
      pending: { ...f.r.pending, cipherHash: "b".repeat(64) },
    }),
  ).toBeNull();
  f.db.sqlite.query("UPDATE v2_storage_usage SET stored_bytes=10000000000").run();
  expect(await f.storageRuntime.beforeDispatch(f.actor, f.r.attemptId)).toBeNull();
  expect(cost(f)).toEqual({ reserved_krw: 1000, ambiguous_krw: 0, settled_krw: 0 });
});
test("shared canonical Worker and D1 units remain part of the authenticated R2 footprint", async () => {
  const f = await originalFixture();
  const basePrice = f.pp.prices[0];
  if (!basePrice) throw new Error("Synthetic pricing missing");
  const pp: PricingProof = {
    ...f.pp,
    id: crypto.randomUUID(),
    version: 2,
    prices: [
      ...f.pp.prices,
      ...(["worker_cpu_ms", "d1_rows_read", "d1_rows_written"] as const).map((sku) => ({
        ...basePrice,
        sku,
        unit: sku === "worker_cpu_ms" ? ("milliseconds" as const) : ("rows" as const),
      })),
    ],
  };
  expect(await f.runtime.putPricingProof(pp, NOW)).toBe(true);
  const p = await prepare(f, {
    ...f.r,
    pricingProofId: pp.id,
    plan: {
      ...f.r.plan,
      quantities: [
        ...f.r.plan.quantities,
        ...(["worker_cpu_ms", "d1_rows_read", "d1_rows_written"] as const).map((sku) => ({
          sku,
          maximumQuantity: "1",
        })),
      ],
    },
  });
  expect(p.reservedKrw).toBe(4000);
  expect(await admit(f, p)).toBe(true);
});
for (const guard of [
  "terms_changed",
  "privacy_changed",
  "ai_notice_changed",
  "file_consent_changed",
  "file_consent_revoked",
  "file_consent_owner_changed",
])
  test(`current consent guard rejects ${guard} at storage dispatch`, async () => {
    const f = await originalFixture(),
      p = await prepare(f);
    expect(await admit(f, p)).toBe(true);
    if (guard === "terms_changed")
      f.db.sqlite.query("UPDATE user_consents SET terms_version='old'").run();
    else if (guard === "privacy_changed")
      f.db.sqlite.query("UPDATE user_consents SET privacy_version='old'").run();
    else if (guard === "ai_notice_changed")
      f.db.sqlite.query("UPDATE user_consents SET ai_notice_version='old'").run();
    else if (guard === "file_consent_changed")
      f.db.sqlite.query("UPDATE v2_consents SET version='old'").run();
    else if (guard === "file_consent_revoked") f.db.sqlite.query("DELETE FROM v2_consents").run();
    else {
      const foreign = await seedTestSession(f.db, { now: Date.parse(NOW) });
      f.db.sqlite.query("UPDATE v2_consents SET owner_id=?").run(foreign.userId);
    }
    expect(await f.storageRuntime.beforeDispatch(f.actor, f.r.attemptId)).toBeNull();
    expect(cost(f)).toEqual({ reserved_krw: 1000, ambiguous_krw: 0, settled_krw: 0 });
  });
for (const kind of ["lawyer_original", "approved_public_copy"] as const)
  test(`${kind} requires current account policy before both prepare and dispatch`, async () => {
    const f = kind === "lawyer_original" ? await originalFixture(kind) : await publicFixture();
    const p = await prepare(f);
    expect(await admit(f, p)).toBe(true);
    f.db.sqlite.query("DELETE FROM user_consents").run();
    expect(await f.storageRuntime.prepareHold(f.actor, f.r)).toBeNull();
    expect(await f.storageRuntime.beforeDispatch(f.actor, f.r.attemptId)).toBeNull();
    expect(cost(f)).toEqual({ reserved_krw: 1000, ambiguous_krw: 0, settled_krw: 0 });
  });
test("consent withdrawal after preparation rolls back storage and financial admission", async () => {
  const f = await originalFixture(),
    p = await prepare(f);
  f.db.sqlite.query("DELETE FROM v2_consents").run();
  expect(await admit(f, p)).toBe(false);
  expect(cost(f)).toEqual({ reserved_krw: 0, ambiguous_krw: 0, settled_krw: 0 });
  expect(f.db.sqlite.query("SELECT count(*) count FROM v2_blobs").get()).toEqual({ count: 0 });
});
test("consent withdrawal while dispatch awaits its atomic claim cannot grant remote permission", async () => {
  const f = await originalFixture(),
    p = await prepare(f);
  expect(await admit(f, p)).toBe(true);
  const batch = f.core.binding.batch.bind(f.core.binding);
  f.core.binding.batch = async <T>(statements: D1PreparedStatement[]) => {
    f.db.sqlite.query("UPDATE user_consents SET privacy_version='old'").run();
    return batch<T>(statements);
  };
  expect(await f.storageRuntime.beforeDispatch(f.actor, f.r.attemptId)).toBeNull();
  expect(f.db.sqlite.query("SELECT state FROM v2_storage_paid_executions").get()).toEqual({
    state: "prepared",
  });
  expect(cost(f)).toEqual({ reserved_krw: 1000, ambiguous_krw: 0, settled_krw: 0 });
});
for (const guard of [
  "tombstone",
  "upload_expired",
  "payload_changed",
  "blob_hash_changed",
  "operation_changed",
  "frozen",
] as const)
  test(`storage dispatch rejects ${guard} without releasing admitted exposure`, async () => {
    const f = await originalFixture(),
      p = await prepare(f);
    expect(await admit(f, p)).toBe(true);
    if (guard === "tombstone")
      f.db.sqlite.query("INSERT INTO v2_tombstones VALUES('file',?,?)").run(f.r.targetId, NOW);
    else if (guard === "upload_expired")
      f.db.sqlite.query("UPDATE v2_upload_sessions SET expires_at=?").run(NOW);
    else if (guard === "payload_changed")
      f.db.sqlite.query("UPDATE v2_blobs SET encrypted_payload=?").run(
        await f.core.encrypt("v2_blobs", f.r.blobId, f.actor.ownerId, 1, {
          contentHash: "b".repeat(64),
        }),
      );
    else if (guard === "blob_hash_changed")
      f.db.sqlite.query("UPDATE v2_blobs SET cipher_hash=?").run("b".repeat(64));
    else if (guard === "operation_changed")
      f.db.sqlite.query("UPDATE v2_operations SET revision=revision+1").run();
    else f.db.sqlite.query("UPDATE v2_runtime_controls SET phase='frozen'").run();
    expect(await f.storageRuntime.beforeDispatch(f.actor, f.r.attemptId)).toBeNull();
    expect(cost(f)).toEqual({ reserved_krw: 1000, ambiguous_krw: 0, settled_krw: 0 });
  });
for (const guard of [
  "withdrawal",
  "role_revoke",
  "source_change",
  "source_delete",
  "target_delete",
] as const)
  test(`approved public copy dispatch rejects ${guard}`, async () => {
    const f = await publicFixture(),
      p = await prepare(f);
    expect(await admit(f, p)).toBe(true);
    if (guard === "withdrawal")
      f.db.sqlite
        .query("UPDATE v2_profile_revisions SET status='withdrawn' WHERE id=?")
        .run(f.r.intent.kind === "approved_public_copy" ? f.r.intent.approvedRevisionId : "");
    else if (guard === "role_revoke")
      f.db.sqlite.query("DELETE FROM v2_role_bindings WHERE role='verified_lawyer'").run();
    else if (guard === "source_change")
      f.db.sqlite
        .query("UPDATE v2_blobs SET encrypted_payload=? WHERE id=?")
        .run(
          await f.core.encrypt(
            "v2_blobs",
            f.r.intent.kind === "approved_public_copy" ? f.r.intent.sourceBlobId : "",
            f.actor.ownerId,
            1,
            { contentHash: "b".repeat(64) },
          ),
          f.r.intent.kind === "approved_public_copy" ? f.r.intent.sourceBlobId : "",
        );
    else if (guard === "source_delete")
      f.db.sqlite
        .query("UPDATE v2_blobs SET state='deleting' WHERE id=?")
        .run(f.r.intent.kind === "approved_public_copy" ? f.r.intent.sourceBlobId : "");
    else f.db.sqlite.query("INSERT INTO v2_tombstones VALUES('asset',?,?)").run(f.r.targetId, NOW);
    expect(await f.storageRuntime.beforeDispatch(f.actor, f.r.attemptId)).toBeNull();
  });
test("verified not_sent releases only prepared attempt and can never erase another worker dispatch", async () => {
  const f = await originalFixture(),
    p = await prepare(f);
  expect(await admit(f, p)).toBe(true);
  const d = await f.storageRuntime.beforeDispatch(f.actor, f.r.attemptId);
  if (!d) throw new Error("Synthetic dispatch missing");
  expect(
    await f.storageRuntime.recordUsage(
      usage(f, null, {
        transport: "not_sent",
        definitiveNoCharge: true,
        meteringComplete: false,
        quantities: [],
      }),
      NOW,
    ),
  ).toBe(false);
  expect(cost(f)).toEqual({ reserved_krw: 1000, ambiguous_krw: 0, settled_krw: 0 });
});
test("late authenticated receipt after deletion, deadline and month rollover settles retained original month only", async () => {
  const f = await originalFixture(),
    p = await prepare(f);
  expect(await admit(f, p)).toBe(true);
  const d = await f.storageRuntime.beforeDispatch(f.actor, f.r.attemptId);
  if (!d) throw new Error("Synthetic dispatch missing");
  expect(
    await f.storageRuntime.recordUsage(
      usage(f, d.dispatchToken, { transport: "unknown", meteringComplete: false, quantities: [] }),
      NOW,
    ),
  ).toBe(true);
  f.db.sqlite.query("INSERT INTO v2_tombstones VALUES('account',?,?)").run(f.actor.ownerId, NOW);
  f.db.sqlite.query("DELETE FROM user WHERE id=?").run(f.actor.ownerId);
  expect(
    await f.storageRuntime.recordUsage(
      usage(f, d.dispatchToken, { observedAt: EXP, chargedUsd: "0.5" }),
      EXP,
    ),
  ).toBe(true);
  expect(cost(f)).toEqual({ reserved_krw: 0, ambiguous_krw: 0, settled_krw: 500 });
  expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  const b = f.db.sqlite
    .query("SELECT anchor_json,payload_json FROM v2_storage_paid_executions")
    .get() as { anchor_json: string; payload_json: string };
  expect(b.anchor_json).not.toContain("enc");
  expect(b.payload_json).not.toContain("합성");
});
test("storage execution immutable plan/anchors and final SQL failure preserve complete exposure", async () => {
  const f = await originalFixture(),
    p = await prepare(f);
  expect(await admit(f, p)).toBe(true);
  for (const field of [
    "operation_id",
    "reservation_id",
    "blob_id",
    "digest",
    "anchor_json",
    "payload_json",
  ])
    expect(() =>
      f.db.sqlite.exec(`UPDATE v2_storage_paid_executions SET ${field}='changed'`),
    ).toThrow();
  expect(() => f.db.sqlite.exec("DELETE FROM v2_storage_paid_executions")).toThrow();
  f.db.sqlite.exec(
    "CREATE TRIGGER reject_dispatch BEFORE UPDATE ON v2_storage_paid_executions WHEN NEW.state='dispatched' BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END",
  );
  await expect(f.storageRuntime.beforeDispatch(f.actor, f.r.attemptId)).rejects.toThrow(
    "DB_OPERATION_FAILED",
  );
  expect(cost(f)).toEqual({ reserved_krw: 1000, ambiguous_krw: 0, settled_krw: 0 });
  expect(f.db.sqlite.query("SELECT state FROM v2_storage_paid_executions").get()).toEqual({
    state: "prepared",
  });
});

test("prepared unsent release is once-only and missing meters retain full unresolved cost", async () => {
  const f = await originalFixture(),
    p = await prepare(f);
  expect(await admit(f, p)).toBe(true);
  const unsent = usage(f, null, {
    transport: "not_sent",
    definitiveNoCharge: true,
    meteringComplete: false,
    quantities: [],
  });
  expect(await f.storageRuntime.recordUsage(unsent, NOW)).toBe(true);
  expect(await f.storageRuntime.recordUsage(unsent, NOW)).toBe(false);
  expect(cost(f)).toEqual({ reserved_krw: 0, ambiguous_krw: 0, settled_krw: 0 });
  const other = await originalFixture(),
    next = await prepare(other);
  expect(await admit(other, next)).toBe(true);
  const d = await other.storageRuntime.beforeDispatch(other.actor, other.r.attemptId);
  if (!d) throw new Error("Synthetic dispatch missing");
  expect(
    await other.storageRuntime.recordUsage(
      usage(other, d.dispatchToken, {
        transport: "response",
        meteringComplete: false,
        quantities: [],
      }),
      NOW,
    ),
  ).toBe(true);
  expect(cost(other)).toEqual({ reserved_krw: 0, ambiguous_krw: 1000, settled_krw: 0 });
});

test("deletion after dispatch commit before guarded read retains exposure and returns no permission", async () => {
  const f = await originalFixture(),
    p = await prepare(f);
  expect(await admit(f, p)).toBe(true);
  const batch = f.core.binding.batch.bind(f.core.binding);
  let injected = false;
  f.core.binding.batch = async <T>(statements: D1PreparedStatement[]) => {
    const result = await batch<T>(statements);
    if (
      !injected &&
      f.db.sqlite.query("SELECT 1 FROM v2_storage_paid_executions WHERE state='dispatched'").get()
    ) {
      injected = true;
      f.db.sqlite.query("INSERT INTO v2_tombstones VALUES('file',?,?)").run(f.r.targetId, NOW);
    }
    return result;
  };
  expect(await f.storageRuntime.beforeDispatch(f.actor, f.r.attemptId)).toBeNull();
  expect(cost(f)).toEqual({ reserved_krw: 1000, ambiguous_krw: 0, settled_krw: 0 });
  expect(
    await f.storageRuntime.recordUsage(
      usage(f, null, {
        transport: "not_sent",
        definitiveNoCharge: true,
        meteringComplete: false,
        quantities: [],
      }),
      NOW,
    ),
  ).toBe(false);
});

test("0007 populated upgrade adds only jobless storage schema and preserves old auth/AAD/proofs/rows", async () => {
  const f = await fixture({ throughMigration: "0007_runtime_paid_execution" }),
    id = crypto.randomUUID();
  const context = {
    table: "cases",
    column: "encrypted_input",
    userId: f.actor.ownerId,
    rowId: id,
  } as const;
  const encrypted = await f.core.cipher.encrypt("합성 v1 원문", context);
  f.db.sqlite
    .query(
      "INSERT INTO cases(id,user_id,status,encrypted_input,created_at,updated_at) VALUES(?,?,'queued',?,?,?)",
    )
    .run(id, f.actor.ownerId, encrypted, NOW, NOW);
  const tables = (
    f.db.sqlite
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name!='app_metadata' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map((t) => t.name);
  const before = tables.map((name) => [
    name,
    f.db.sqlite.query(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
  ]);
  expect(
    f.db.sqlite.query("SELECT value FROM app_metadata WHERE key='schema_version'").get(),
  ).toEqual({ value: "0007_runtime_paid_execution" });
  f.db.sqlite.exec(await Bun.file("drizzle/0008_storage_paid_execution.sql").text());
  expect(
    f.db.sqlite.query("SELECT value FROM app_metadata WHERE key='schema_version'").get(),
  ).toEqual({ value: "0008_storage_paid_execution" });
  expect(
    tables.map((name) => [name, f.db.sqlite.query(`SELECT * FROM "${name}" ORDER BY rowid`).all()]),
  ).toEqual(before);
  expect(await f.core.cipher.decrypt(encrypted, context)).toBe("합성 v1 원문");
  await expect(
    f.core.cipher.decrypt(encrypted, { ...context, rowId: "other_row" }),
  ).rejects.toThrow();
  expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(
    f.db.sqlite
      .query(
        "SELECT count(*) count FROM sqlite_master WHERE type='table' AND name='v2_storage_paid_executions'",
      )
      .get(),
  ).toEqual({ count: 1 });
});
