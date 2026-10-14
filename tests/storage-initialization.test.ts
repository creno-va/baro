import { expect, test } from "bun:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import historical from "../docs/operations/AI-RUNTIME-OBSERVATION.json";
import { initializeEmptyStorage } from "../scripts/initialize-storage";
import {
  inspectAiRuntime,
  observationSchema,
  observeAiRuntime,
} from "../scripts/provision-ai-budget";
import { copySyntheticD1 } from "./helpers/native-d1";
import { fixture, intent } from "./helpers/storage-capacity";

const SHA = "a".repeat(40);
async function setup() {
  const f = await fixture();
  const now = new Date().toISOString(),
    validUntil = new Date(Date.now() + 3600000).toISOString();
  const observation = observationSchema.parse({
    ...historical,
    checkedAt: now,
    validUntil,
    spendAllowanceKrw: 1000000,
    fx: { ...historical.fx, asOf: now },
    pricing: {
      ...historical.pricing,
      checkedAt: now,
      validUntil,
      fx: { ...historical.pricing.fx, asOf: now, checkedAt: now, validUntil },
      prices: [...historical.pricing.prices, ...f.pp.prices].map((p) => ({
        ...p,
        checkedAt: now,
        validUntil,
      })),
    },
  });
  const configuration = {
    expectedControlRevision: 3,
    expectedReleaseSha: SHA,
    capacityBytes: 100000000000,
    getLimit: 2,
    headLimit: 2,
    deleteLimit: 4,
    workerCpuMsPerIO: 100,
    d1RowsReadPerIO: 100,
    d1RowsWrittenPerIO: 100,
    inventory: {
      environment: "preview",
      checkedAt: now,
      privateBucketObjects: 0,
      publicBucketObjects: 0,
      authority: "authenticated_cloudflare_console",
    },
  };
  const run = (config: unknown = configuration, obs: unknown = observation) =>
    initializeEmptyStorage(
      f.db.binding,
      "preview",
      obs,
      config,
      "synthetic-storage-initialization",
      SHA,
    );
  return { f, observation, configuration, run };
}

test("empty storage bootstrap preserves holds, reserves capacity frozen, then same-allocation refresh activates without clearing exposure", async () => {
  const { f, observation, configuration, run } = await setup();
  f.db.sqlite.exec("UPDATE v2_monthly_budget SET reserved_krw=123,ambiguous_krw=456");
  const first = await run();
  expect(first.activatedByThisOperation).toBe(false);
  expect(f.db.sqlite.query("SELECT phase,revision FROM v2_runtime_controls").get()).toEqual({
    phase: "frozen",
    revision: 5,
  });
  const count = () => f.db.sqlite.query("SELECT count(*) AS n FROM v2_maintenance_exposure").get();
  const before = count();
  expect((await run()).replayed).toBe(true);
  expect(count()).toEqual(before);
  expect(
    f.db.sqlite.query("SELECT capacity_bytes FROM v2_physical_storage_capacity").get(),
  ).toEqual({ capacity_bytes: 100000000000 });
  expect(
    f.db.sqlite.query("SELECT reserved_krw,ambiguous_krw FROM v2_monthly_budget").get(),
  ).toEqual({ reserved_krw: 123, ambiguous_krw: 456 });
  const refreshed = await observeAiRuntime(
    { preview: f.db.binding },
    observation,
    "refresh",
    "synthetic-initial-storage-resume",
  );
  expect(refreshed.results[0]?.refreshCommitted).toBe(true);
  const active = f.db.sqlite.query("SELECT * FROM v2_runtime_controls").get();
  const maintenance = count();
  expect((await run()).replayed).toBe(true);
  expect(f.db.sqlite.query("SELECT * FROM v2_runtime_controls").get()).toEqual(active);
  expect(count()).toEqual(maintenance);
  const beforeHistoricalReplay = f.db.sqlite.serialize();
  expect(
    (
      await initializeEmptyStorage(
        f.db.binding,
        "preview",
        observation,
        configuration,
        "synthetic-storage-initialization",
        SHA,
        () => new Date(Date.now() + 600000).toISOString(),
      )
    ).replayed,
  ).toBe(true);
  expect(f.db.sqlite.serialize()).toEqual(beforeHistoricalReplay);
  expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(JSON.stringify(await inspectAiRuntime({ preview: f.db.binding }))).not.toMatch(
    /email|owner_id|object_key|payload_json/,
  );
});

for (const lostBatch of [1, 2])
  test(`exact bootstrap safely replays a committed lost batch ${lostBatch} without duplicate maintenance`, async () => {
    const { f, run } = await setup();
    const batch = f.db.binding.batch.bind(f.db.binding);
    let calls = 0;
    f.db.binding.batch = async <T>(statements: D1PreparedStatement[]) => {
      const result = await batch<T>(statements);
      if (++calls === lostBatch) throw new Error("SYNTHETIC_COMMITTED_RESPONSE_LOST");
      return result;
    };
    await expect(run()).rejects.toThrow(
      lostBatch === 1 ? "SYNTHETIC_COMMITTED_RESPONSE_LOST" : "DB_OPERATION_FAILED",
    );
    await run();
    const before = f.db.sqlite.query("SELECT * FROM v2_maintenance_exposure").all();
    expect(before).toHaveLength(1);
    expect((await run()).replayed).toBe(true);
    expect(f.db.sqlite.query("SELECT * FROM v2_maintenance_exposure").all()).toEqual(before);
    expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_storage_projections").get()).toEqual({
      n: 1,
    });
  });

test("wrong environment/release, stale/future or nonempty console observations reject before any mutation", async () => {
  const { f, configuration, run } = await setup();
  const before = f.db.sqlite.serialize();
  for (const config of [
    { ...configuration, expectedReleaseSha: "b".repeat(40) },
    { ...configuration, inventory: { ...configuration.inventory, environment: "production" } },
    {
      ...configuration,
      inventory: {
        ...configuration.inventory,
        checkedAt: new Date(Date.now() - 300001).toISOString(),
      },
    },
    {
      ...configuration,
      inventory: {
        ...configuration.inventory,
        checkedAt: new Date(Date.now() + 60000).toISOString(),
      },
    },
    { ...configuration, inventory: { ...configuration.inventory, privateBucketObjects: 1 } },
  ])
    await expect(run(config)).rejects.toThrow();
  expect(f.db.sqlite.serialize()).toEqual(before);
});

test("a genuine existing pending blob is preserved and requires explicit nonempty inventory reconciliation", async () => {
  const { f, run } = await setup();
  const pending = await intent(f);
  await pending.statement().run();
  const rows = f.db.sqlite.query("SELECT * FROM v2_blobs").all();
  const control = f.db.sqlite.query("SELECT * FROM v2_runtime_controls").all();
  await expect(run()).rejects.toThrow("STORAGE_INITIALIZATION_INVENTORY_RECONCILIATION_REQUIRED");
  expect(f.db.sqlite.query("SELECT * FROM v2_blobs").all()).toEqual(rows);
  expect(f.db.sqlite.query("SELECT * FROM v2_runtime_controls").all()).toEqual(control);
  expect(f.db.sqlite.query("SELECT * FROM v2_storage_projections").all()).toEqual([]);
});

test("bootstrap keeps unfinished producers blocked but records exposure above the observed funding amount", async () => {
  const { f, configuration, observation, run } = await setup();
  const operation = crypto.randomUUID(),
    job = crypto.randomUUID();
  const now = new Date().toISOString();
  f.db.sqlite
    .query(
      "INSERT INTO v2_operations(id,owner_id,workspace_id,kind,created_at) VALUES(?,?,?,'chat',?)",
    )
    .run(operation, f.actor.ownerId, f.workspaceId, now);
  f.db.sqlite
    .query(
      "INSERT INTO v2_jobs(id,operation_id,runtime_instance_id,workspace_id,target_kind,target_id,target_revision,kind,status,phase,created_at,updated_at) VALUES(?,?,?,?,'workspace',?,1,'chat_response','queued','admission',?,?)",
    )
    .run(job, operation, crypto.randomUUID(), f.workspaceId, f.workspaceId, now, now);
  const prior = f.db.sqlite.query("SELECT * FROM v2_jobs").all();
  await expect(run()).rejects.toThrow("STORAGE_INITIALIZATION_INVENTORY_RECONCILIATION_REQUIRED");
  expect(f.db.sqlite.query("SELECT * FROM v2_jobs").all()).toEqual(prior);
  expect(f.db.sqlite.query("SELECT phase,revision FROM v2_runtime_controls").get()).toEqual({
    phase: "active",
    revision: 3,
  });
  f.db.sqlite.query("UPDATE v2_jobs SET status='cancelled' WHERE id=?").run(job);
  f.db.sqlite.exec("UPDATE v2_monthly_budget SET reserved_krw=123,ambiguous_krw=456");
  expect(
    (await run(configuration, { ...observation, spendAllowanceKrw: 1 })).activatedByThisOperation,
  ).toBe(false);
  expect(
    f.db.sqlite.query("SELECT reserved_krw,ambiguous_krw FROM v2_monthly_budget").get(),
  ).toEqual({ reserved_krw: 123, ambiguous_krw: 456 });
  expect(f.db.sqlite.query("SELECT * FROM v2_storage_projections").all()).toHaveLength(1);
  expect(f.db.sqlite.query("SELECT * FROM v2_maintenance_exposure").all()).toHaveLength(1);
  expect(
    f.db.sqlite
      .query(
        "SELECT json_extract(p.payload_json,'$.spendAllowanceKrw') AS allowance FROM v2_storage_funding_heads h JOIN v2_runtime_proofs p ON p.id=h.proof_id",
      )
      .get(),
  ).toEqual({ allowance: 1 });
});

test("a concurrent pending object between observation and freeze cannot acquire an empty-inventory receipt", async () => {
  const { f, run } = await setup();
  const pending = await intent(f),
    batch = f.db.binding.batch.bind(f.db.binding);
  let inserted = false;
  f.db.binding.batch = async <T>(statements: D1PreparedStatement[]) => {
    if (!inserted) {
      inserted = true;
      await pending.statement().run();
    }
    return batch<T>(statements);
  };
  await expect(run()).rejects.toThrow("STORAGE_INITIALIZATION_FREEZE_CONFLICT");
  expect(f.db.sqlite.query("SELECT * FROM v2_storage_projections").all()).toEqual([]);
  expect(f.db.sqlite.query("SELECT phase,revision FROM v2_runtime_controls").get()).toEqual({
    phase: "active",
    revision: 3,
  });
  expect(
    f.db.sqlite
      .query("SELECT count(*) AS n FROM app_metadata WHERE key LIKE 'storage-initialization:%'")
      .get(),
  ).toEqual({ n: 0 });
});

test("a rejected projection batch leaves only the exact frozen receipt and retry safely completes", async () => {
  const { f, run } = await setup();
  f.db.sqlite.exec(
    "CREATE TRIGGER synthetic_reject_projection BEFORE INSERT ON v2_storage_projections BEGIN SELECT RAISE(ABORT,'synthetic projection failure'); END",
  );
  await expect(run()).rejects.toThrow();
  expect(f.db.sqlite.query("SELECT * FROM v2_storage_projections").all()).toEqual([]);
  expect(f.db.sqlite.query("SELECT * FROM v2_maintenance_exposure").all()).toEqual([]);
  expect(f.db.sqlite.query("SELECT phase,revision FROM v2_runtime_controls").get()).toEqual({
    phase: "frozen",
    revision: 4,
  });
  f.db.sqlite.exec("DROP TRIGGER synthetic_reject_projection");
  expect((await run()).replayed).toBe(true);
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_maintenance_exposure").get()).toEqual({
    n: 1,
  });
});

test("changed configuration and a stale control revision cannot replace a projection or steal another freeze", async () => {
  const { f, configuration, run } = await setup();
  await expect(run({ ...configuration, expectedControlRevision: 2 })).rejects.toThrow(
    "STORAGE_INITIALIZATION_FREEZE_CONFLICT",
  );
  expect(f.db.sqlite.query("SELECT phase,revision FROM v2_runtime_controls").get()).toEqual({
    phase: "active",
    revision: 3,
  });
  await run();
  const before = f.db.sqlite.query("SELECT * FROM v2_storage_projections").all();
  await expect(run({ ...configuration, capacityBytes: 10000000000 })).rejects.toThrow(
    "STORAGE_INITIALIZATION_EXISTING_PROJECTION",
  );
  expect(f.db.sqlite.query("SELECT * FROM v2_storage_projections").all()).toEqual(before);
});

test("native D1 applies exact empty inventory freeze/projection and same-allocation resume with unresolved holds retained", async () => {
  const { f, observation, configuration } = await setup();
  f.db.sqlite.exec("UPDATE v2_monthly_budget SET reserved_krw=123,ambiguous_krw=456");
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("synthetic initialization")}}',
      compatibilityDate: "2026-10-01",
      d1Databases: ["DB"],
      cf: false,
      unsafeRegisterWorker: false,
    }),
  );
  try {
    const binding = (await mf.getD1Database("DB")) as unknown as D1Database;
    await copySyntheticD1(binding, f.db.sqlite);
    await initializeEmptyStorage(
      binding,
      "preview",
      observation,
      configuration,
      "native-empty-storage",
      SHA,
    );
    expect(
      await binding.prepare("SELECT phase FROM v2_runtime_controls").first<string>("phase"),
    ).toBe("frozen");
    expect(
      (
        await observeAiRuntime(
          { preview: binding },
          observation,
          "refresh",
          "native-empty-storage-resume",
        )
      ).results[0]?.refreshCommitted,
    ).toBe(true);
    expect(
      await binding.prepare("SELECT phase FROM v2_runtime_controls").first<string>("phase"),
    ).toBe("active");
    expect(
      await binding
        .prepare("SELECT reserved_krw,ambiguous_krw FROM v2_monthly_budget")
        .first<{ reserved_krw: number; ambiguous_krw: number }>(),
    ).toEqual({ reserved_krw: 123, ambiguous_krw: 456 });
    expect((await binding.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  } finally {
    await mf.dispose();
  }
}, 30000);
