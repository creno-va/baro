import { expect, spyOn, test } from "bun:test";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2StorageCapacityRepository } from "../src/server/db/v2-storage-capacity";
import { createStorageMaintenance } from "../src/server/modules/budget/storage-maintenance";
import { countD1Calls } from "./helpers/d1-call-count";
import { admit, held, intent, NOW, ready } from "./helpers/storage-capacity";

const NEXT_MONTH = "2026-11-02T00:00:00.000Z";
const actions = ["get", "head", "delete"] as const;

async function stored(applicationCostLimitsEnabled = false) {
  const f = await ready({}, { applicationCostLimitsEnabled });
  const blob = await intent(f);
  expect(await admit(f, blob)).toBe(true);
  const writer = await f.capacity.beginWrite(blob.id, 100, NOW);
  if (!writer) throw Error("Synthetic writer missing");
  expect(
    await f.capacity.confirmWriterStopped(
      writer,
      { transport: "response", objectKey: blob.input.objectKey, byteLength: 100 },
      NOW,
    ),
  ).toBe(true);
  f.db.sqlite
    .query("UPDATE v2_blobs SET state='stored',key_version='v1',cipher_bytes=100 WHERE id=?")
    .run(blob.id);
  const meter = countD1Calls(f.db.binding);
  const core = createV2Core(meter.binding, f.core.cipher, { applicationCostLimitsEnabled });
  return {
    ...f,
    blob,
    meter,
    capacity: createV2StorageCapacityRepository(core, "preview"),
    maintenance: createStorageMaintenance(core, "preview", () => NEXT_MONTH),
  };
}

function failMonth(f: Awaited<ReturnType<typeof stored>>) {
  // Real SQLite transaction failure confined to the optional calendar bucket.
  f.db.sqlite.exec(`CREATE TRIGGER synthetic_month_failure BEFORE INSERT ON v2_monthly_budget
    BEGIN SELECT RAISE(ABORT,'synthetic monthly observation unavailable'); END;`);
}

for (const action of actions) {
  test(`false maintenance ${action} isolates only the monthly observation write failure`, async () => {
    const f = await stored();
    if (action === "delete")
      f.db.sqlite.query("UPDATE v2_blobs SET state='deleting' WHERE id=?").run(f.blob.id);
    const tables = [
      "v2_monthly_budget",
      "v2_runtime_proofs",
      "v2_paid_holds",
      "v2_storage_projections",
      "v2_physical_blob_bindings",
    ];
    const snapshot = () => tables.map((table) => f.db.sqlite.query(`SELECT * FROM ${table}`).all());
    const before = snapshot();
    // Verify required synchronization independently of already being in false mode.
    f.db.sqlite.exec("UPDATE v2_cost_execution_policy SET limits_enabled=1");
    failMonth(f);
    const output = spyOn(console, "error").mockImplementation(() => {});
    try {
      const permit = await f.capacity.beforeMaintenanceIO(
        { blobId: f.blob.id, action },
        NEXT_MONTH,
      );
      expect(permit).not.toBeNull();
      if (!permit) throw Error("Synthetic maintenance permit missing");
      expect(await f.capacity.consumeMaintenanceIO({ ...permit }, NEXT_MONTH)).toBe(false);
      expect(await f.capacity.consumeMaintenanceIO(permit, NEXT_MONTH)).toBe(true);
      expect(await f.capacity.consumeMaintenanceIO(permit, NEXT_MONTH)).toBe(false);
      expect(snapshot()).toEqual(before);
      expect(held(f).held_bytes).toBe(100);
      expect(
        f.db.sqlite.query("SELECT limits_enabled FROM v2_cost_execution_policy").get(),
      ).toEqual({ limits_enabled: 0 });
      expect(
        f.db.sqlite
          .query("SELECT gets,heads,deletes FROM v2_storage_io_counters WHERE month='2026-11'")
          .get(),
      ).toEqual({
        gets: action === "get" ? 1 : 0,
        heads: action === "head" ? 1 : 0,
        deletes: action === "delete" ? 1 : 0,
      });
      expect(output.mock.calls).toEqual([
        [
          JSON.stringify({
            event: "cost_observation_failure",
            phase: "month_bucket",
            category: "unknown",
          }),
        ],
      ]);
    } finally {
      output.mockRestore();
    }
  });
}

for (const enabled of [false, true]) {
  test(`canonical maintenance counts preserve cost limits=${enabled} behavior`, async () => {
    const f = await stored(enabled);
    f.meter.reset();
    const permit = await f.capacity.beforeMaintenanceIO({ blobId: f.blob.id, action: "get" }, NOW);
    if (!permit) throw Error("Synthetic maintenance permit missing");
    expect(await f.capacity.consumeMaintenanceIO(permit, NOW)).toBe(true);
    // Original false mode was 4 calls / 5 SQL. Isolating the optional write adds
    // one method call without another query, snapshot cache, or financial read.
    expect(f.meter.work).toEqual({ calls: enabled ? 3 : 5, statements: enabled ? 3 : 5 });
  });
}

for (const table of ["v2_cost_execution_policy", "v2_storage_io_counters"]) {
  test(`false maintenance preserves required ${table} write failure`, async () => {
    const f = await stored();
    f.db.sqlite.exec(`CREATE TRIGGER synthetic_required_failure BEFORE INSERT ON ${table}
      BEGIN SELECT RAISE(ABORT,'synthetic required write unavailable'); END;`);
    await expect(
      f.capacity.beforeMaintenanceIO({ blobId: f.blob.id, action: "get" }, NEXT_MONTH),
    ).rejects.toMatchObject({ code: "DB_OPERATION_FAILED" });
    expect(f.db.sqlite.query("SELECT * FROM v2_storage_io_counters").all()).toEqual([]);
  });
}

test("false maintenance preserves physical read failures and final authorization", async () => {
  const f = await stored();
  const physicalError = new Error("synthetic physical read unavailable");
  f.meter.before((statements) => {
    if (statements.some((sql) => sql.startsWith("SELECT binding.object_key"))) throw physicalError;
  });
  await expect(
    f.capacity.beforeMaintenanceIO({ blobId: f.blob.id, action: "get" }, NEXT_MONTH),
  ).rejects.toMatchObject({ code: "DB_OPERATION_FAILED" });
  expect(f.db.sqlite.query("SELECT * FROM v2_storage_io_counters").all()).toEqual([]);
  f.meter.before(() => {});
  let authorizationCalls = 0;
  expect(
    await f.maintenance.admit(f.blob.id, f.blob.input.objectKey, "get", async () => {
      authorizationCalls++;
      return false;
    }),
  ).toBe(false);
  expect(authorizationCalls).toBe(1);
  expect(
    await f.maintenance.admit(f.blob.id, "private/wrong-object", "get", async () => {
      authorizationCalls++;
      return true;
    }),
  ).toBe(false);
  expect(authorizationCalls).toBe(1);
});

test("optional month failure preserves physical corruption and pre-IO state fences", async () => {
  const f = await stored();
  failMonth(f);
  const output = spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(
      await f.capacity.beforeMaintenanceIO({ blobId: "foreign-blob", action: "get" }, NEXT_MONTH),
    ).toBeNull();
    expect(
      await f.capacity.beforeMaintenanceIO({ blobId: f.blob.id, action: "delete" }, NEXT_MONTH),
    ).toBeNull();
    const permit = await f.capacity.beforeMaintenanceIO(
      { blobId: f.blob.id, action: "get" },
      NEXT_MONTH,
    );
    if (!permit) throw Error("Synthetic maintenance permit missing");
    f.db.sqlite.query("UPDATE v2_blobs SET state='deleting' WHERE id=?").run(f.blob.id);
    expect(await f.capacity.consumeMaintenanceIO(permit, NEXT_MONTH)).toBe(false);
    f.db.sqlite.query("UPDATE v2_blobs SET state='stored' WHERE id=?").run(f.blob.id);
    expect(await f.capacity.consumeMaintenanceIO(permit, NEXT_MONTH)).toBe(false);
    f.db.sqlite.exec(
      "INSERT INTO v2_storage_integrity_faults(environment,blob_id) VALUES('preview','synthetic')",
    );
    expect(
      await f.capacity.beforeMaintenanceIO({ blobId: f.blob.id, action: "head" }, NEXT_MONTH),
    ).toBeNull();
    expect(held(f).held_bytes).toBe(100);
  } finally {
    output.mockRestore();
  }
});

test("diagnostic failure does not replace an optional monthly write failure", async () => {
  const f = await stored();
  failMonth(f);
  const output = spyOn(console, "error").mockImplementation(() => {
    throw Error("synthetic diagnostic unavailable");
  });
  try {
    expect(
      await f.maintenance.admit(f.blob.id, f.blob.input.objectKey, "get", async () => true),
    ).toBe(true);
  } finally {
    output.mockRestore();
  }
});
