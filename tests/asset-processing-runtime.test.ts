import { expect, test } from "bun:test";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createV2LawyersRepository } from "../src/server/db/v2-lawyers";
import {
  createV2PaidRuntimeRepository,
  paidHoldRequestSchema,
} from "../src/server/db/v2-paid-runtime";
import { createV2StorageRepository } from "../src/server/db/v2-storage";
import { createAssetProcessingRuntime } from "../src/server/modules/budget/asset-runtime";
import { createProcessingBudgetService } from "../src/server/modules/budget/processing-ledger";
import { boundedProcessingResources } from "../src/server/modules/budget/processing-runtime";
import { createAssetProcessingExecution } from "../src/server/modules/file-processing/asset-execution";
import { runAssetProcessing } from "../src/server/modules/file-processing/asset-runner";
import {
  type AssetProcessingBinding,
  createAssetProcessingDispatcher,
} from "../src/server/modules/file-processing/dispatch";
import { nativeJobId } from "../src/server/modules/file-processing/native-identity";
import { createAssetProcessingAdmission } from "../src/server/runtime/asset-admission";
import { readProcessingProofs } from "../src/server/runtime/processing-proofs";
import { fixture } from "./helpers/file-processing-fixture";
import { seedTestSession } from "./helpers/session";

async function setup(admit = true) {
  const f = await fixture();
  const lawyers = createV2LawyersRepository(f.core),
    storage = createV2StorageRepository(f.core);
  const profileId = crypto.randomUUID(),
    assetId = crypto.randomUUID(),
    jobId = nativeJobId("asset");
  const reservationId = crypto.randomUUID(),
    blobId = crypto.randomUUID(),
    operationId = crypto.randomUUID();
  expect(await lawyers.createProfile(f.actor, profileId)).toBe(true);
  expect(
    await lawyers.reserveAsset(
      f.actor,
      profileId,
      1,
      assetId,
      { purpose: "profile_photo", name: "synthetic.png", byteLength: 100, mediaType: "image/png" },
      reservationId,
      { operationId, key: crypto.randomUUID(), requestHash: "a".repeat(64) },
    ),
  ).toBe(true);
  expect(
    await storage.registerBlob(f.actor, {
      id: blobId,
      reservationId,
      kind: "profile_photo_original",
      visibility: "private",
      logicalBytes: 100,
      cipherBytes: 116,
      cipherHash: "b".repeat(64),
      contentHash: "a".repeat(64),
      keyVersion: "asset_binary_v1",
    }),
  ).toBe(true);
  expect(await storage.commitReservation(f.actor, reservationId)).toBe(true);
  // Scope fixture supplies physical metadata; it performs no provider transport.
  f.db.sqlite
    .query("UPDATE v2_assets SET original_blob_id=?,state='uploaded' WHERE id=?")
    .run(blobId, assetId);
  const jobs = createV2JobsRepository(f.core);
  if (admit)
    expect(await jobs.admitAsset(f.actor, { assetId, assetRevision: 1, jobId })).toBe(true);
  const params = { ownerId: f.actor.ownerId, profileId, assetId, assetRevision: 1, jobId };
  return { ...f, jobs, params, operationId };
}

test("actual asset outbox CAS selects the distinct sanitizer binding and exact immutable scope once", async () => {
  const f = await setup();
  const instances = new Map<string, unknown>();
  let calls = 0;
  const binding: AssetProcessingBinding = {
    async get(id) {
      if (!instances.has(id)) throw new Error("Synthetic missing instance");
      return { id, status: async () => ({ status: "running" }) };
    },
    async create({ id, params }) {
      calls++;
      instances.set(id, params);
      return binding.get(id);
    },
  };
  const dispatcher = createAssetProcessingDispatcher(f.core, { binding, clock: () => f.actor.now });
  const results = await Promise.all([dispatcher.dispatch(), dispatcher.dispatch()]);
  expect(results.reduce((n, r) => n + r.dispatched, 0)).toBe(1);
  expect(calls).toBe(1);
  expect(instances.get(`${f.params.jobId}-1`)).toEqual(f.params);
});

test("revoked account policy, foreign profile linkage and source replacement deny asset dispatch", async () => {
  for (const mutation of ["consent", "profile", "source", "deleted"] as const) {
    const f = await setup();
    if (mutation === "consent")
      f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
    if (mutation === "profile") {
      const other = await seedTestSession(f.db, { now: Date.parse(f.actor.now), consent: true });
      const otherProfile = crypto.randomUUID();
      expect(
        await createV2LawyersRepository(f.core).createProfile(
          { ownerId: other.userId, now: f.actor.now },
          otherProfile,
        ),
      ).toBe(true);
      f.db.sqlite
        .query("UPDATE v2_jobs SET profile_id=? WHERE id=?")
        .run(otherProfile, f.params.jobId);
    }
    if (mutation === "source")
      f.db.sqlite
        .query(
          "UPDATE v2_blobs SET state='deleting' WHERE id=(SELECT original_blob_id FROM v2_assets WHERE id=?)",
        )
        .run(f.params.assetId);
    if (mutation === "deleted")
      f.db.sqlite
        .query("INSERT INTO v2_tombstones VALUES('asset',?,?)")
        .run(f.params.assetId, f.actor.now);
    let called = false;
    const result = await createAssetProcessingDispatcher(f.core, {
      clock: () => f.actor.now,
      binding: {
        get: async () => {
          called = true;
          throw new Error("Unexpected dispatch");
        },
        create: async () => {
          called = true;
          throw new Error("Unexpected dispatch");
        },
      },
    }).dispatch();
    expect(result.dispatched).toBe(0);
    expect(called).toBe(false);
  }
});

test("sanitizer execution reuses its current exact lease and never acquires an unpaid queued job", async () => {
  const f = await setup();
  const granted = await f.jobs.acquire(
    f.actor,
    f.params.jobId,
    crypto.randomUUID(),
    new Date(Date.parse(f.actor.now) + 300000).toISOString(),
  );
  if (!granted) throw new Error("Synthetic fixture lease absent");
  let seen: unknown;
  const execution = createAssetProcessingExecution(f.core, f.params, {
    instanceId: `${f.params.jobId}-1`,
    initialAttemptId: null,
    clock: () => f.actor.now,
    completed: async () => null,
    sanitize: async (_input, lease) => {
      seen = lease;
      return { status: "ready", assetId: f.params.assetId, revision: 2 };
    },
  });
  expect((await execution.run(new AbortController().signal)).status).toBe("ready");
  expect(seen).toEqual(granted.lease);
  const queued = await setup();
  const denied = createAssetProcessingExecution(queued.core, queued.params, {
    instanceId: `${queued.params.jobId}-1`,
    initialAttemptId: null,
    clock: () => queued.actor.now,
    completed: async () => null,
    sanitize: async () => {
      throw new Error("Unexpected source read");
    },
  });
  await expect(denied.run(new AbortController().signal)).rejects.toMatchObject({
    code: "BUDGET_UNAVAILABLE",
  });
  expect((await queued.jobs.find(queued.actor, queued.params.jobId))?.status).toBe("queued");
});

test("missing actual pricing/funding cannot enqueue an otherwise owned uploaded asset", async () => {
  const f = await setup(false);
  const admission = createAssetProcessingAdmission(
    f.core,
    { APP_ENV: "preview", ASSET_PROCESSING: {}, FILE_PROCESSOR: {} } as Env,
    {},
    () => f.actor.now,
  );
  expect(await admission.enqueueProcessing?.({ ...f.params, operationId: f.operationId })).toBe(
    false,
  );
  expect(
    f.db.sqlite.query("SELECT count(*) AS n FROM v2_jobs WHERE target_id=?").get(f.params.assetId),
  ).toEqual({ n: 0 });
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_paid_holds").get()).toEqual({ n: 0 });
});

test("bounded sanitizer Workflow sanitizes failure output and clears its request signal", async () => {
  let signal: AbortSignal | undefined;
  const execution = {
    run: async (input: AbortSignal) => {
      signal = input;
      throw new Error("Synthetic private provider failure");
    },
    fail: async () => ({ status: "stopped" as const, code: "FILE_PROCESSING_FAILED" as const }),
  };
  const step = {
    do: async (_name: string, options: unknown, callback: () => Promise<unknown>) => {
      expect(options).toEqual({ retries: { limit: 0, delay: "1 second" }, timeout: "5 minutes" });
      return callback();
    },
  };
  const result = await runAssetProcessing(execution, step as never);
  expect(result).toEqual({ status: "stopped", code: "FILE_PROCESSING_FAILED" });
  expect(signal?.aborted).toBe(true);
  expect(JSON.stringify(result)).not.toContain("private provider");
});

test("actual asset runtime restores the current same-clock retry after null funding becomes observed", async () => {
  const f = await setup(false);
  // Synthetic local transport. Reaching this port proves the real runtime
  // restored and dispatched its exact admission, without any provider call.
  f.actor.now = new Date().toISOString();
  f.core.applicationCostLimitsEnabled = false;
  const env = {
    APP_ENV: "preview",
    APPLICATION_COST_LIMITS_ENABLED: "false",
    DB: f.db.binding,
    CASE_DATA_KEY_V1: btoa("k".repeat(32)).replace(/=+$/, ""),
    CASE_PRIVATE_R2: f.bucket.port,
    ASSET_PROCESSING: {},
    FILE_PROCESSOR: {
      idFromName: (name: string) => name,
      get: () => ({
        prepareCapacity: async () => true,
        fetch: () => {
          throw new Error("Unexpected processor call");
        },
      }),
    },
  } as unknown as Env;
  expect(
    await createAssetProcessingAdmission(f.core, env, {}, () => f.actor.now).enqueueProcessing?.({
      ...f.params,
      operationId: f.operationId,
    }),
  ).toBe(true);
  const old = f.db.sqlite
    .query(
      "SELECT attempt_id,job_id,runtime_instance_id,payload_json FROM v2_execution_admissions WHERE kind='job'",
    )
    .get() as {
    attempt_id: string;
    job_id: string;
    runtime_instance_id: string;
    payload_json: string;
  };
  const original = paidHoldRequestSchema.parse(JSON.parse(old.payload_json));
  expect(original.fundingProofId).toBeNull();
  const firstLease = await f.jobs.acquire(
    f.actor,
    old.job_id,
    crypto.randomUUID(),
    new Date(Date.parse(f.actor.now) + 300000).toISOString(),
    old.attempt_id,
  );
  if (!firstLease) throw new Error("Synthetic first lease absent");
  // Failure before dispatch leaves the old prepared hold intact. Equal clock
  // values cannot identify which immutable runtime owns the retry admission.
  expect(await f.jobs.fail(f.actor, firstLease.lease, "FILE_PROCESSING_FAILED", true)).toBe(true);
  const proofId = crypto.randomUUID();
  const runtime = createV2PaidRuntimeRepository(
    f.core,
    "preview",
    async (_kind, _payload, digest) => ({
      digest,
      evidenceHash: "e".repeat(64),
      method: "authenticated_console",
      verifiedAt: f.actor.now,
    }),
  );
  expect(
    await runtime.putFundingProof(
      {
        id: proofId,
        environment: "preview",
        state: "trial_credit",
        existingPaymentPath: true,
        autoRecharge: false,
        spendAllowanceKrw: 10000,
        reference: "synthetic retry funding observation",
        observedAt: f.actor.now,
        validUntil: new Date(Date.parse(f.actor.now) + 3600000).toISOString(),
      },
      f.actor.now,
    ),
  ).toBe(true);
  const nextInstance = `${old.job_id}-2`;
  const budget = createProcessingBudgetService({
    core: f.core,
    environment: "preview",
    ownerId: f.actor.ownerId,
    clock: () => f.actor.now,
    bounds: boundedProcessingResources,
    binding: async (now) => {
      const proofs = await readProcessingProofs(f.core, "preview", now);
      if (!proofs) return null;
      return {
        ...proofs,
        operationId: f.operationId,
        operationRevision: original.plan.operationRevision,
        requestHash: original.plan.requestHash,
        jobId: old.job_id,
        targetKind: "profile_asset",
        targetId: f.params.assetId,
        targetRevision: 1,
        invocationId: nextInstance,
        maximumAttempts: 1,
        deadlineAt: new Date(Date.parse(now) + 300000).toISOString(),
      };
    },
  });
  const blob = f.db.sqlite
    .query(
      "SELECT id,cipher_hash,cipher_bytes FROM v2_blobs WHERE id=(SELECT original_blob_id FROM v2_assets WHERE id=?)",
    )
    .get(f.params.assetId) as { id: string; cipher_hash: string; cipher_bytes: number };
  f.db.sqlite
    .query(
      "INSERT INTO v2_physical_storage_capacity(environment,capacity_bytes) VALUES('preview',1000000)",
    )
    .run();
  f.db.sqlite
    .query(
      "INSERT INTO v2_physical_blob_bindings(blob_id,environment,owner_id,object_key,maximum_cipher_bytes,state,writer_state,inventory_hash,created_at) SELECT id,'preview',?,object_key,cipher_bytes,'held','stopped','dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',? FROM v2_blobs WHERE id=?",
    )
    .run(f.actor.ownerId, f.actor.now, blob.id);
  const prepared = await budget.prepareInitial({
    service: "requests",
    action: "r2_get",
    identity: `asset-original:${blob.id}:${blob.cipher_hash}`,
    byteLength: blob.cipher_bytes,
    durationSeconds: null,
  });
  if (!prepared) throw new Error("Synthetic retry admission absent");
  expect(prepared.request.fundingProofId).toBe(proofId);
  expect(await f.jobs.retryAsset(prepared.actor, old.job_id, prepared.paid)).toBe(true);
  expect(
    await f.jobs.acquire(
      f.actor,
      old.job_id,
      crypto.randomUUID(),
      new Date(Date.parse(f.actor.now) + 300000).toISOString(),
      old.attempt_id,
    ),
  ).toBeNull();
  const execution = await createAssetProcessingRuntime(
    env,
    { ...f.params, jobId: old.job_id },
    nextInstance,
  );
  await expect(execution.run(new AbortController().signal)).rejects.toMatchObject({
    code: "STORAGE_UNAVAILABLE",
  });
  expect(f.bucket.calls.get).toBe(1);
  expect(
    f.db.sqlite
      .query(
        "SELECT state,runtime_instance_id,dispatch_token FROM v2_execution_admissions WHERE attempt_id=?",
      )
      .get(old.attempt_id),
  ).toEqual({
    state: "prepared",
    runtime_instance_id: old.runtime_instance_id,
    dispatch_token: null,
  });
  expect(
    f.db.sqlite
      .query(
        "SELECT state,runtime_instance_id,transport FROM v2_execution_admissions WHERE attempt_id=?",
      )
      .get(prepared.request.attemptId),
  ).toEqual({ state: "unknown", runtime_instance_id: nextInstance, transport: "unknown" });
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_execution_admissions").get()).toEqual({
    n: 2,
  });
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_cost_attempts").get()).toEqual({ n: 0 });
});
