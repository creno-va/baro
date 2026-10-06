import { afterEach, expect, test } from "bun:test";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts";
import { createCaseDataCipher } from "../src/server/crypto";
import {
  type BudgetAllocation,
  createV2AccountingRepository,
  quotaStatements,
} from "../src/server/db/v2-accounting";
import { type Actor, createV2Core, sqlClaim } from "../src/server/db/v2-core";
import { stopExpiredUndispatchedJob } from "../src/server/db/v2-expired-undispatched-job";
import { createV2FilesRepository } from "../src/server/db/v2-files";
import { createV2JobsRepository, jobInsertStatements } from "../src/server/db/v2-jobs";
import { createV2LawyersRepository } from "../src/server/db/v2-lawyers";
import {
  createV2PaidRuntimeRepository,
  type FundingProof,
  type PaidHoldRequest,
  type PricingProof,
  type RuntimeProofVerifier,
  type UsageReceipt,
} from "../src/server/db/v2-paid-runtime";
import type { StoragePaidHoldRequest } from "../src/server/db/v2-storage-paid-contracts";
import { createV2StoragePaidRuntimeRepository } from "../src/server/db/v2-storage-paid-runtime";
import { createAssetProcessingExecution } from "../src/server/modules/file-processing/asset-execution";
import { createFileProcessingExecution } from "../src/server/modules/file-processing/execution";
import {
  createProcessorTransport,
  type ProcessingCosts,
} from "../src/server/modules/file-processing/transport";
import { createFilesService, type PrivateBucket } from "../src/server/modules/files/service";
import { createMediaGateway } from "../src/server/modules/llm-gateway/transcription";
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

async function queued(kind: "file" | "profile_asset" = "file") {
  const f = await originalFixture(kind === "file" ? "case_original" : "lawyer_original"),
    jobId = crypto.randomUUID();
  const request: PaidHoldRequest = {
    attemptId: f.r.attemptId,
    quoteId: f.r.quoteId,
    planId: f.r.planId,
    pricingProofId: f.r.pricingProofId,
    fundingProofId: f.r.fundingProofId,
    attempt: f.r.attempt,
    jobId,
    targetKind: kind,
    targetId: f.r.targetId,
    targetRevision: f.r.targetRevision,
    service: "requests",
    plan: f.r.plan,
  };
  const paid = await f.runtime.prepareHold(f.actor, request);
  expect(paid).not.toBeNull();
  if (!paid) throw new Error("Synthetic paid hold missing");
  if (kind === "profile_asset") {
    // Upstream R2 upload is represented by synthetic stored metadata only.
    // The actual queued asset admission and paid binding below use DAL methods.
    const blobId = crypto.randomUUID();
    f.db.sqlite
      .query(
        "INSERT INTO v2_blobs(id,principal_id,reservation_id,kind,visibility,state,object_key,logical_bytes,cipher_bytes,cipher_hash,key_version,encrypted_payload,created_at) SELECT ?,principal_id,id,'portfolio_original','private','stored',?,100,116,?,'asset_binary_v1',?,? FROM v2_storage_reservations WHERE id=?",
      )
      .run(
        blobId,
        `private/${blobId}`,
        HASH,
        await f.core.encrypt("v2_blobs", blobId, f.actor.ownerId, 1, { contentHash: HASH }),
        NOW,
        f.r.reservationId,
      );
    f.db.sqlite
      .query("UPDATE v2_assets SET state='uploaded',original_blob_id=? WHERE id=?")
      .run(blobId, f.r.targetId);
    expect(
      await f.jobs.admitAsset(f.actor, { assetId: f.r.targetId, assetRevision: 1, jobId }, paid),
    ).toBe(true);
  } else {
    // Synthetic processor-ready source fixture; no real R2 or Container call.
    // Job/quota/initial paid hold are committed through real bounded primitives.
    const c = crypto.randomUUID();
    expect(
      await f.core.changed([
        f.core.statement(
          `INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) SELECT ?,?,?,1 WHERE ${paid.predicate.sql}`,
          [c, f.actor.ownerId, f.r.targetId, ...paid.predicate.values],
        ),
        ...quotaStatements(
          f.core,
          f.actor,
          request.plan.operationId,
          { kind: "media_processing", originalDurationSeconds: 0.5 },
          c,
        ),
        ...jobInsertStatements(
          f.core,
          f.actor,
          {
            schemaVersion: "2",
            id: jobId,
            operationId: request.plan.operationId,
            target: { kind: "file", caseId: f.workspaceId, fileId: f.r.targetId, fileRevision: 1 },
            kind: "file_processing",
            status: "queued",
            phase: "admission",
            progressPercent: 0,
            attempts: 0,
            failure: null,
            retryable: false,
            updatedAt: NOW,
          },
          c,
        ),
        f.core.statement(
          `UPDATE v2_files SET state='queued',current_job_id=? WHERE id=? AND ${sqlClaim}`,
          [jobId, f.r.targetId, c],
        ),
        ...paid.statements(f.core, f.actor, c),
        f.core.finish(c),
      ]),
    ).toBe(true);
  }
  return {
    ...f,
    jobId,
    request,
    stop: { ownerId: f.actor.ownerId, jobId, instanceId: `${jobId}-1`, now: LATER },
  };
}
type Queued = Awaited<ReturnType<typeof queued>>;
function money(f: Queued) {
  return f.db.sqlite
    .query(
      "SELECT reserved_krw,ambiguous_krw,settled_krw FROM v2_monthly_budget WHERE month='2026-10'",
    )
    .get();
}
for (const kind of ["file", "profile_asset"] as const)
  test(`expired undispatched ${kind} returns its real hold and marks exact target retryable once`, async () => {
    const f = await queued(kind);
    expect(await stopExpiredUndispatchedJob(f.core, "preview", f.stop)).toBe(true);
    expect(money(f)).toEqual({ reserved_krw: 0, ambiguous_krw: 0, settled_krw: 0 });
    expect(
      f.db.sqlite
        .query("SELECT status,failure_code,retryable FROM v2_jobs WHERE id=?")
        .get(f.jobId),
    ).toEqual({ status: "failed", failure_code: "BUDGET_UNAVAILABLE", retryable: 1 });
    const table = kind === "file" ? "v2_files" : "v2_assets";
    expect(
      f.db.sqlite
        .query(`SELECT state,failure_code,current_job_id FROM ${table} WHERE id=?`)
        .get(f.r.targetId),
    ).toEqual({ state: "failed", failure_code: "BUDGET_UNAVAILABLE", current_job_id: null });
    expect(
      f.db.sqlite
        .query("SELECT state FROM v2_operations WHERE id=?")
        .get(f.request.plan.operationId),
    ).toEqual({ state: "failed" });
    expect(
      f.db.sqlite
        .query(
          "SELECT json_extract(payload_json,'$.transport') transport,outcome FROM v2_runtime_usage",
        )
        .get(),
    ).toEqual({ transport: "not_sent", outcome: "released" });
    if (kind === "file")
      expect(
        f.db.sqlite.query("SELECT media_reserved,media_used FROM v2_daily_usage").get(),
      ).toEqual({ media_reserved: 0, media_used: 0 });
    expect(await stopExpiredUndispatchedJob(f.core, "preview", f.stop)).toBe(false);
    expect(
      await f.jobs.acquire(
        { ...f.actor, now: LATER },
        f.jobId,
        crypto.randomUUID(),
        "2026-10-06T00:04:00.000Z",
        f.request.attemptId,
      ),
    ).toBeNull();
  });
for (const invalid of [
  "wrong_owner",
  "wrong_instance",
  "not_expired",
  "wrong_environment",
  "operation_revision",
  "target_revision",
  "target_pointer",
  "tombstone",
  "running",
] as const)
  test(`expired cleanup rejects ${invalid} and preserves the full attempt`, async () => {
    const f = await queued();
    let value = f.stop;
    if (invalid === "wrong_owner") value = { ...value, ownerId: crypto.randomUUID() };
    if (invalid === "wrong_instance") value = { ...value, instanceId: crypto.randomUUID() };
    if (invalid === "not_expired") value = { ...value, now: NOW };
    if (invalid === "operation_revision")
      f.db.sqlite
        .query("UPDATE v2_operations SET revision=revision+1 WHERE id=?")
        .run(f.request.plan.operationId);
    if (invalid === "target_revision")
      f.db.sqlite.query("UPDATE v2_files SET revision=revision+1 WHERE id=?").run(f.r.targetId);
    if (invalid === "target_pointer")
      f.db.sqlite.query("UPDATE v2_files SET current_job_id=NULL WHERE id=?").run(f.r.targetId);
    if (invalid === "tombstone")
      f.db.sqlite.query("INSERT INTO v2_tombstones VALUES('file',?,?)").run(f.r.targetId, NOW);
    if (invalid === "running")
      expect(
        await f.jobs.acquire(f.actor, f.jobId, crypto.randomUUID(), LATER, f.request.attemptId),
      ).not.toBeNull();
    expect(
      await stopExpiredUndispatchedJob(
        f.core,
        invalid === "wrong_environment" ? "production" : "preview",
        value,
      ),
    ).toBe(false);
    expect(money(f)).toEqual({ reserved_krw: 1000, ambiguous_krw: 0, settled_krw: 0 });
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_runtime_usage").get()).toEqual({ n: 0 });
  });
test("actual concurrent acquire/dispatch wins the refund CAS and can never be converted to zero", async () => {
  const f = await queued(),
    batch = f.core.binding.batch.bind(f.core.binding);
  let injected = false;
  f.core.binding.batch = async <T>(statements: D1PreparedStatement[]) => {
    if (!injected) {
      injected = true;
      const lease = await f.jobs.acquire(
        f.actor,
        f.jobId,
        crypto.randomUUID(),
        LATER,
        f.request.attemptId,
      );
      if (!lease) throw new Error("Synthetic raced lease missing");
      expect(
        await f.runtime.beforeDispatch(f.actor, lease.lease, f.request.attemptId),
      ).not.toBeNull();
    }
    return batch<T>(statements);
  };
  expect(await stopExpiredUndispatchedJob(f.core, "preview", f.stop)).toBe(false);
  expect(money(f)).toEqual({ reserved_krw: 1000, ambiguous_krw: 0, settled_krw: 0 });
  expect(
    f.db.sqlite
      .query("SELECT state FROM v2_paid_holds WHERE attempt_id=?")
      .get(f.request.attemptId),
  ).toEqual({ state: "dispatched" });
});
test("unknown actual attempt is never released even after adversarial queued state restoration", async () => {
  const f = await queued(),
    lease = await f.jobs.acquire(f.actor, f.jobId, crypto.randomUUID(), LATER, f.request.attemptId);
  if (!lease) throw new Error("Synthetic lease missing");
  const dispatched = await f.runtime.beforeDispatch(f.actor, lease.lease, f.request.attemptId);
  if (!dispatched) throw new Error("Synthetic dispatch missing");
  const r: UsageReceipt = {
    id: crypto.randomUUID(),
    attemptId: f.request.attemptId,
    invocationId: f.request.plan.invocationId,
    providerRequestId: null,
    dispatchToken: dispatched.dispatchToken,
    observedAt: NOW,
    transport: "unknown",
    definitiveNoCharge: false,
    meteringComplete: false,
    quantities: [],
    chargedUsd: null,
    modelTokenDetails: null,
  };
  expect(await f.runtime.recordUsage(r, NOW)).toBe(true);
  f.db.sqlite
    .query("UPDATE v2_jobs SET status='queued',lease_token=NULL,lease_until=NULL WHERE id=?")
    .run(f.jobId);
  expect(await stopExpiredUndispatchedJob(f.core, "preview", f.stop)).toBe(false);
  expect(money(f)).toEqual({ reserved_krw: 0, ambiguous_krw: 1000, settled_krw: 0 });
});
test("final transaction failure preserves queued targets and durable refund resumes without duplication", async () => {
  const f = await queued();
  f.db.sqlite.exec(
    "CREATE TRIGGER synthetic_stop_failure BEFORE UPDATE OF state ON v2_files WHEN NEW.state='failed' BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  );
  await expect(stopExpiredUndispatchedJob(f.core, "preview", f.stop)).rejects.toThrow(
    "DB_OPERATION_FAILED",
  );
  expect(money(f)).toEqual({ reserved_krw: 0, ambiguous_krw: 0, settled_krw: 0 });
  expect(f.db.sqlite.query("SELECT status FROM v2_jobs WHERE id=?").get(f.jobId)).toEqual({
    status: "queued",
  });
  expect(
    f.db.sqlite.query("SELECT state FROM v2_operations WHERE id=?").get(f.request.plan.operationId),
  ).toEqual({ state: "admitted" });
  f.db.sqlite.exec("DROP TRIGGER synthetic_stop_failure");
  expect(await stopExpiredUndispatchedJob(f.core, "preview", f.stop)).toBe(true);
  expect(
    f.db.sqlite.query("SELECT count(*) n FROM v2_runtime_usage WHERE outcome='released'").get(),
  ).toEqual({ n: 1 });
});
test("runtime/fencing replacement after refund cannot stop a new generation", async () => {
  const f = await queued(),
    batch = f.core.binding.batch.bind(f.core.binding);
  let replaced = false;
  f.core.binding.batch = async <T>(statements: D1PreparedStatement[]) => {
    if (
      !replaced &&
      f.db.sqlite.query("SELECT 1 FROM v2_cost_attempts WHERE state='released'").get()
    ) {
      replaced = true;
      f.db.sqlite
        .query(
          "UPDATE v2_jobs SET runtime_instance_id='synthetic_new_runtime',fencing=fencing+1 WHERE id=?",
        )
        .run(f.jobId);
    }
    return batch<T>(statements);
  };
  expect(await stopExpiredUndispatchedJob(f.core, "preview", f.stop)).toBe(false);
  expect(
    f.db.sqlite.query("SELECT status,runtime_instance_id FROM v2_jobs WHERE id=?").get(f.jobId),
  ).toEqual({ status: "queued", runtime_instance_id: "synthetic_new_runtime" });
  expect(f.db.sqlite.query("SELECT state FROM v2_files WHERE id=?").get(f.r.targetId)).toEqual({
    state: "queued",
  });
});

test("actual asset Workflow run stops expired initial admission before sanitizer transport", async () => {
  const f = await queued("profile_asset");
  const asset = f.db.sqlite
    .query("SELECT profile_id FROM v2_assets WHERE id=?")
    .get(f.r.targetId) as { profile_id: string };
  let sanitizerCalls = 0;
  const execution = createAssetProcessingExecution(
    f.core,
    {
      ownerId: f.actor.ownerId,
      profileId: asset.profile_id,
      assetId: f.r.targetId,
      assetRevision: 1,
      jobId: f.jobId,
    },
    {
      environment: "preview",
      instanceId: f.stop.instanceId,
      initialAttemptId: f.request.attemptId,
      clock: () => LATER,
      completed: async () => null,
      sanitize: async () => {
        sanitizerCalls++;
        throw new Error("Synthetic transport must not dispatch");
      },
    },
  );
  await expect(execution.run(new AbortController().signal)).rejects.toMatchObject({
    code: "BUDGET_UNAVAILABLE",
  });
  expect(sanitizerCalls).toBe(0);
  expect(
    f.db.sqlite.query("SELECT state,current_job_id FROM v2_assets WHERE id=?").get(f.r.targetId),
  ).toEqual({ state: "failed", current_job_id: null });
  expect(f.db.sqlite.query("SELECT status,retryable FROM v2_jobs WHERE id=?").get(f.jobId)).toEqual(
    { status: "failed", retryable: 1 },
  );
  expect(money(f)).toEqual({ reserved_krw: 0, ambiguous_krw: 0, settled_krw: 0 });
});

test("actual file Workflow initialize stops expired initial admission without R2/native/model calls", async () => {
  const f = await queued();
  let externalCalls = 0;
  const costs: ProcessingCosts = {
    before: async () => {
      externalCalls++;
      return null;
    },
    after: async () => {
      externalCalls++;
    },
  };
  const bucket: PrivateBucket = {
    get: async () => {
      externalCalls++;
      return null;
    },
    head: async () => {
      externalCalls++;
      return null;
    },
    put: async () => {
      externalCalls++;
      throw new Error("Synthetic PUT must not dispatch");
    },
    delete: async () => {
      externalCalls++;
    },
  };
  const processor = createProcessorTransport({
    costs,
    stop: async () => {
      externalCalls++;
    },
    fetch: async () => {
      externalCalls++;
      throw new Error("Synthetic native must not dispatch");
    },
  });
  const media = createMediaGateway(
    {
      AI_GATEWAY_ID: "synthetic",
      AI: {
        run: async () => {
          externalCalls++;
          throw new Error("Synthetic model must not dispatch");
        },
      },
    },
    {
      costs,
      waitUntil: () => {
        externalCalls++;
      },
    },
  );
  const execution = createFileProcessingExecution(
    f.core,
    {
      ownerId: f.actor.ownerId,
      workspaceId: f.workspaceId,
      fileId: f.r.targetId,
      fileRevision: 1,
      jobId: f.jobId,
    },
    {
      environment: "preview",
      instanceId: f.stop.instanceId,
      initialAttemptId: f.request.attemptId,
      clock: () => LATER,
      files: createFilesService(f.core, { environment: "preview", bucket }),
      bucket,
      processor,
      media,
      costs,
    },
  );
  await expect(execution.initialize()).rejects.toMatchObject({ code: "BUDGET_UNAVAILABLE" });
  expect(externalCalls).toBe(0);
  expect(
    f.db.sqlite.query("SELECT state,current_job_id FROM v2_files WHERE id=?").get(f.r.targetId),
  ).toEqual({ state: "failed", current_job_id: null });
  expect(f.db.sqlite.query("SELECT status,retryable FROM v2_jobs WHERE id=?").get(f.jobId)).toEqual(
    { status: "failed", retryable: 1 },
  );
  expect(f.db.sqlite.query("SELECT media_used,media_reserved FROM v2_daily_usage").get()).toEqual({
    media_used: 0,
    media_reserved: 0,
  });
  expect(money(f)).toEqual({ reserved_krw: 0, ambiguous_krw: 0, settled_krw: 0 });
});
