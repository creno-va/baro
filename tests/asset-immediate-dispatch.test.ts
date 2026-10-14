import { expect, test } from "bun:test";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createV2LawyersRepository } from "../src/server/db/v2-lawyers";
import { createV2StorageRepository } from "../src/server/db/v2-storage";
import { boundedProcessingResources } from "../src/server/modules/budget/processing-runtime";
import {
  type AssetProcessingBinding,
  createAssetProcessingDispatcher,
} from "../src/server/modules/file-processing/dispatch";
import { nativeJobId } from "../src/server/modules/file-processing/native-identity";
import { createAssetProcessingAdmission } from "../src/server/runtime/asset-admission";
import { fixture } from "./helpers/file-processing-fixture";
import { ready } from "./helpers/storage-capacity";

async function setup(admit = true, funded = false) {
  const f = funded
    ? await ready(
        {},
        {
          pricing: (initial) => {
            const first = initial.prices[0];
            if (!first) throw new Error("Synthetic pricing fixture missing");
            return {
              ...initial,
              prices: [
                ...initial.prices,
                {
                  ...first,
                  sku: "container_cpu_seconds",
                  unit: "vcpu_seconds",
                },
              ],
            };
          },
        },
      )
    : await fixture();
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

function workflow() {
  const instances = new Map<string, unknown>();
  const inputs: Parameters<AssetProcessingBinding["create"]>[0][] = [];
  let gets = 0,
    creates = 0;
  const binding: AssetProcessingBinding = {
    async get(id) {
      gets++;
      if (!instances.has(id)) throw new Error("Synthetic missing instance");
      return { id, status: async () => ({ status: "running" }) };
    },
    async create(input) {
      const { id, params } = input;
      inputs.push(structuredClone(input));
      creates++;
      instances.set(id, params);
      return { id, status: async () => ({ status: "running" }) };
    },
  };
  return { binding, instances, inputs, calls: () => ({ gets, creates }) };
}
const target = (f: Awaited<ReturnType<typeof setup>>) => ({
  ownerId: f.actor.ownerId,
  jobId: f.params.jobId,
  instanceId: `${f.params.jobId}-1`,
});

test("exact wake rejects a foreign owner, job or runtime then races cron through one claim", async () => {
  const f = await setup();
  const w = workflow();
  const dispatcher = createAssetProcessingDispatcher(f.core, {
    binding: w.binding,
    clock: () => f.actor.now,
  });
  for (const mismatch of [
    { ownerId: "foreign-owner" },
    { jobId: "foreign-job" },
    { instanceId: `${f.params.jobId}-2` },
  ]) {
    expect((await dispatcher.dispatchOne({ ...target(f), ...mismatch })).dispatched).toBe(0);
  }
  expect(w.calls()).toEqual({ gets: 0, creates: 0 });
  const results = await Promise.all([dispatcher.dispatch(), dispatcher.dispatchOne(target(f))]);
  expect(results.reduce((total, result) => total + result.dispatched, 0)).toBe(1);
  expect(w.calls().creates).toBe(1);
  expect(w.instances.get(target(f).instanceId)).toEqual(f.params);
  expect((await dispatcher.dispatchOne(target(f))).dispatched).toBe(0);
  expect(w.calls().creates).toBe(1);
});

test("preview profile asset creation has no file Workflow placement hint", async () => {
  const f = await setup(),
    w = workflow();
  const result = await createAssetProcessingDispatcher(f.core, {
    binding: w.binding,
    environment: "preview",
    clock: () => f.actor.now,
  }).dispatchOne(target(f));
  expect(result.dispatched).toBe(1);
  expect(w.inputs).toEqual([{ id: target(f).instanceId, params: f.params }]);
  expect(w.inputs[0]).not.toHaveProperty("locationHint");
});

for (const mutation of [
  "consent",
  "tombstone",
  "source",
  "lease_expired",
  "claim_replaced",
] as const) {
  test(`exact wake rechecks ${mutation} after its claim and before create`, async () => {
    const f = await setup();
    let creates = 0;
    const binding: AssetProcessingBinding = {
      async get() {
        if (mutation === "consent")
          f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
        if (mutation === "tombstone")
          f.db.sqlite
            .query("INSERT INTO v2_tombstones VALUES('asset',?,?)")
            .run(f.params.assetId, f.actor.now);
        if (mutation === "source")
          f.db.sqlite
            .query(
              "UPDATE v2_blobs SET state='deleting' WHERE id=(SELECT original_blob_id FROM v2_assets WHERE id=?)",
            )
            .run(f.params.assetId);
        if (mutation === "lease_expired")
          f.actor.now = new Date(Date.parse(f.actor.now) + 60001).toISOString();
        if (mutation === "claim_replaced")
          f.db.sqlite
            .query("UPDATE v2_outbox SET attempts=attempts+1 WHERE job_id=?")
            .run(f.params.jobId);
        throw new Error("Synthetic missing instance");
      },
      async create({ id }) {
        creates++;
        return { id, status: async () => ({ status: "running" }) };
      },
    };
    const result = await createAssetProcessingDispatcher(f.core, {
      binding,
      clock: () => f.actor.now,
    }).dispatchOne(target(f));
    expect(result).toMatchObject({ dispatched: 0, pending: 1 });
    expect(creates).toBe(0);
    expect(
      f.db.sqlite.query("SELECT state FROM v2_outbox WHERE job_id=?").get(f.params.jobId),
    ).toEqual({ state: "pending" });
  });
}

test("ambiguous create keeps one immutable instance and cron recovers only that instance", async () => {
  const f = await setup();
  const w = workflow();
  let visible = false;
  const binding: AssetProcessingBinding = {
    get: async (id) => {
      if (!visible) throw new Error("Synthetic unknown lookup");
      return w.binding.get(id);
    },
    create: async (input) => {
      await w.binding.create(input);
      throw new Error("Synthetic response lost");
    },
  };
  const dispatcher = createAssetProcessingDispatcher(f.core, { binding, clock: () => f.actor.now });
  expect(await dispatcher.dispatchOne(target(f))).toMatchObject({ dispatched: 0, pending: 1 });
  expect(w.calls().creates).toBe(1);
  expect((await dispatcher.dispatchOne(target(f))).dispatched).toBe(0);
  expect(w.calls().creates).toBe(1);
  visible = true;
  f.actor.now = new Date(Date.parse(f.actor.now) + 60001).toISOString();
  expect((await dispatcher.dispatch()).dispatched).toBe(1);
  expect(w.calls().creates).toBe(1);
  expect(w.instances.size).toBe(1);
});

test("successful observation-only admission registers one inert exact wake after its durable outbox", async () => {
  const f = await setup(false);
  f.core.applicationCostLimitsEnabled = false;
  const w = workflow(),
    tasks: Array<() => Promise<void>> = [];
  const admission = createAssetProcessingAdmission(
    f.core,
    { APP_ENV: "preview", ASSET_PROCESSING: w.binding, FILE_PROCESSOR: {} } as unknown as Env,
    {},
    () => f.actor.now,
    (task) => {
      expect(
        f.db.sqlite.query("SELECT count(*) n FROM v2_outbox WHERE kind='job_dispatch'").get(),
      ).toEqual({ n: 1 });
      tasks.push(task);
    },
  );
  expect(await admission.enqueueProcessing?.({ ...f.params, operationId: f.operationId })).toBe(
    true,
  );
  expect(tasks.length).toBe(1);
  expect(w.calls()).toEqual({ gets: 0, creates: 0 });
  expect(await admission.enqueueProcessing?.({ ...f.params, operationId: f.operationId })).toBe(
    false,
  );
  expect(tasks.length).toBe(1);
  await tasks[0]?.();
  expect(w.calls().creates).toBe(1);
  const job = f.db.sqlite
    .query("SELECT id,runtime_instance_id FROM v2_jobs WHERE target_id=?")
    .get(f.params.assetId) as { id: string; runtime_instance_id: string };
  expect(w.instances.get(job.runtime_instance_id)).toEqual({ ...f.params, jobId: job.id });
});

test("failed final admission and true-mode success never register immediate work", async () => {
  const denied = await setup(false);
  denied.core.applicationCostLimitsEnabled = false;
  let tasks = 0;
  const blocked = createAssetProcessingAdmission(
    denied.core,
    { APP_ENV: "preview", ASSET_PROCESSING: {}, FILE_PROCESSOR: {} } as Env,
    {
      bounds: async (...args) => {
        denied.db.sqlite
          .query("INSERT INTO v2_tombstones VALUES('asset',?,?)")
          .run(denied.params.assetId, denied.actor.now);
        return boundedProcessingResources(...args);
      },
    },
    () => denied.actor.now,
    () => {
      tasks++;
    },
  );
  expect(
    await blocked.enqueueProcessing?.({ ...denied.params, operationId: denied.operationId }),
  ).toBe(false);
  expect(tasks).toBe(0);
  expect(denied.db.sqlite.query("SELECT count(*) n FROM v2_outbox").get()).toEqual({ n: 0 });
  const funded = await setup(false, true);
  const legacy = createAssetProcessingAdmission(
    funded.core,
    { APP_ENV: "preview", ASSET_PROCESSING: {}, FILE_PROCESSOR: {} } as Env,
    {},
    () => funded.actor.now,
    () => {
      tasks++;
    },
  );
  expect(
    await legacy.enqueueProcessing?.({ ...funded.params, operationId: funded.operationId }),
  ).toBe(true);
  expect(tasks).toBe(0);
  expect(
    funded.db.sqlite.query("SELECT state FROM v2_outbox WHERE kind='job_dispatch'").get(),
  ).toEqual({ state: "pending" });
});

test("registration and background failure cannot turn committed admission into failure", async () => {
  for (const mode of ["registration", "dispatch"] as const) {
    const f = await setup(false);
    f.core.applicationCostLimitsEnabled = false;
    const tasks: Array<() => Promise<void>> = [];
    const admission = createAssetProcessingAdmission(
      f.core,
      { APP_ENV: "preview", ASSET_PROCESSING: {}, FILE_PROCESSOR: {} } as Env,
      {},
      () => f.actor.now,
      (task) => {
        if (mode === "registration") throw new Error("Synthetic unavailable execution context");
        tasks.push(task);
      },
    );
    expect(await admission.enqueueProcessing?.({ ...f.params, operationId: f.operationId })).toBe(
      true,
    );
    // The unavailable binding fails after the exact outbox claim. Keep the
    // same pending journal and lease for scheduled recovery.
    if (mode === "dispatch") {
      await expect(tasks[0]?.()).resolves.toBeUndefined();
    }
    expect(
      f.db.sqlite.query("SELECT state,attempts FROM v2_outbox WHERE kind='job_dispatch'").get(),
    ).toEqual({ state: "pending", attempts: mode === "dispatch" ? 1 : 0 });
  }
});
