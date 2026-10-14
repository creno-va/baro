import { expect, test } from "bun:test";
import { admit, held, intent, NOW, ready } from "./helpers/storage-capacity";

test("observation-only storage survives expired cost proofs, next month, and exhausted prepaid IO", async () => {
  const f = await ready(
    { getLimit: 1, headLimit: 0, deleteLimit: 0 },
    { applicationCostLimitsEnabled: false },
  );
  const beforeProofs = f.db.sqlite.query("SELECT * FROM v2_runtime_proofs ORDER BY id").all();
  const beforeProjection = f.db.sqlite.query("SELECT * FROM v2_storage_projections").all();
  const oldBudget = f.db.sqlite.query("SELECT * FROM v2_monthly_budget").all();
  const later = "2026-11-02T00:00:00.000Z";
  f.actor.now = later;
  const i = await intent(f);
  expect(await admit(f, i)).toBe(true);
  const writer = await f.capacity.beginWrite(i.id, 100, later);
  expect(writer).not.toBeNull();
  if (!writer) throw Error("missing writer");
  expect(
    await f.capacity.confirmWriterStopped(
      writer,
      { transport: "response", objectKey: i.input.objectKey, byteLength: 100 },
      later,
    ),
  ).toBe(true);
  f.db.sqlite
    .query("UPDATE v2_blobs SET state='stored',key_version='v1',cipher_bytes=100 WHERE id=?")
    .run(i.id);
  for (let n = 0; n < 55; n++) {
    const permit = await f.capacity.beforeMaintenanceIO({ blobId: i.id, action: "get" }, later);
    expect(permit).not.toBeNull();
    if (!permit) throw Error("missing get permit");
    expect(await f.capacity.consumeMaintenanceIO({ ...permit }, later)).toBe(false);
    expect(await f.capacity.consumeMaintenanceIO(permit, later)).toBe(true);
    expect(await f.capacity.consumeMaintenanceIO(permit, later)).toBe(false);
  }
  const head = await f.capacity.beforeMaintenanceIO({ blobId: i.id, action: "head" }, later);
  expect(head).not.toBeNull();
  expect(
    await f.capacity.beforeMaintenanceIO({ blobId: i.id, action: "delete" }, later),
  ).toBeNull();
  f.db.sqlite.query("UPDATE v2_blobs SET state='deleting' WHERE id=?").run(i.id);
  const remove = await f.capacity.beforeMaintenanceIO({ blobId: i.id, action: "delete" }, later);
  expect(remove).not.toBeNull();
  if (remove) expect(await f.capacity.consumeMaintenanceIO(remove, later)).toBe(true);
  expect(
    await f.capacity.beforeMaintenanceIO({ blobId: "foreign-blob", action: "get" }, later),
  ).toBeNull();
  expect(
    f.db.sqlite
      .query(
        "SELECT gets,heads,deletes FROM v2_storage_io_counters WHERE environment='preview' AND month='2026-11'",
      )
      .get(),
  ).toEqual({ gets: 55, heads: 1, deletes: 1 });
  expect(f.db.sqlite.query("SELECT * FROM v2_runtime_proofs ORDER BY id").all()).toEqual(
    beforeProofs,
  );
  expect(f.db.sqlite.query("SELECT * FROM v2_storage_projections").all()).toEqual(beforeProjection);
  expect(f.db.sqlite.query("SELECT * FROM v2_monthly_budget WHERE month='2026-10'").all()).toEqual(
    oldBudget,
  );
  expect(held(f).held_bytes).toBe(100);
  f.db.sqlite
    .query(
      "INSERT INTO v2_storage_integrity_faults(environment,blob_id) VALUES('preview','synthetic')",
    )
    .run();
  expect(await f.capacity.beforeMaintenanceIO({ blobId: i.id, action: "head" }, later)).toBeNull();
});

test("0015 upgrade preserves all existing data and supports transaction rollback", async () => {
  const f = await ready({}, { throughMigration: "0014_cost_observation_bounds" });
  expect(await admit(f, await intent(f))).toBe(true);
  const tables = (
    f.db.sqlite
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name!='app_metadata' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map((v) => v.name);
  const snapshot = () => tables.map((t) => f.db.sqlite.query(`SELECT * FROM "${t}"`).all());
  const before = snapshot();
  const migration = await Bun.file("drizzle/0015_cost_observation_only.sql").text();
  expect(() =>
    f.db.sqlite.transaction(() => {
      f.db.sqlite.exec(migration);
      f.db.sqlite.exec("SELECT json('invalid')");
    })(),
  ).toThrow();
  expect(snapshot()).toEqual(before);
  expect(
    f.db.sqlite.query("SELECT value FROM app_metadata WHERE key='schema_version'").get(),
  ).toEqual({ value: "0014_cost_observation_bounds" });
  f.db.sqlite.transaction(() => f.db.sqlite.exec(migration))();
  expect(snapshot()).toEqual(before);
  expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(f.db.sqlite.query("SELECT * FROM v2_cost_execution_policy").all()).toEqual([]);
  expect(
    await f.capacity.beforeMaintenanceIO({ blobId: "missing", action: "get" }, NOW),
  ).toBeNull();
});
