import { expect, test } from "bun:test";
import { usageDateKst } from "../src/server/db/repository";
import { createV2PaidRuntimeRepository } from "../src/server/db/v2-paid-runtime";
import { createTestDatabase } from "./helpers/d1";
import { admit, fixture, intent, NOW, ready } from "./helpers/storage-capacity";

const migration = await Bun.file("drizzle/0010_bounded_storage_admission.sql").text();

test("0009 upgrade preserves active controls, ambiguous exposure, ciphertext and all source rows", async () => {
  const f = await fixture({ throughMigration: "0009_storage_capacity_maintenance" });
  const i = await intent(f);
  await i.statement().run();
  f.db.sqlite.exec("UPDATE v2_monthly_budget SET reserved_krw=17,ambiguous_krw=23");
  f.db.sqlite.exec(
    "INSERT INTO v2_monthly_budget(month,allocation_version,environment,limit_krw,reserved_krw,ambiguous_krw) VALUES('2020-01',1,'production',10000,31,47)",
  );
  f.db.sqlite.exec(
    `INSERT INTO v2_maintenance_exposure(id,month,reference_hash,amount_krw,state,created_at) VALUES('past','2020-01','${"a".repeat(64)}',19,'ambiguous','2020-01-01T00:00:00Z')`,
  );
  const tables = [
    "session",
    "v2_runtime_controls",
    "v2_monthly_budget",
    "v2_runtime_proofs",
    "v2_blobs",
    "v2_maintenance_exposure",
  ];
  const before = tables.map((t) => f.db.sqlite.query(`SELECT * FROM ${t} ORDER BY rowid`).all());
  f.db.sqlite.transaction(() =>
    migration
      .split("--> statement-breakpoint")
      .filter((sql) => sql.trim())
      .forEach((sql) => {
        f.db.sqlite.query(sql).run();
      }),
  )();
  expect(tables.map((t) => f.db.sqlite.query(`SELECT * FROM ${t} ORDER BY rowid`).all())).toEqual(
    before,
  );
  expect(
    f.db.sqlite
      .query("SELECT live_blob_bytes FROM v2_storage_reservations WHERE id=?")
      .get(i.reservationId),
  ).toEqual({ live_blob_bytes: 100 });
  expect(
    f.db.sqlite.query("SELECT * FROM v2_storage_integrity_faults ORDER BY environment").all(),
  ).toEqual([
    { environment: "preview", blob_id: i.id },
    { environment: "production", blob_id: i.id },
  ]);
  const cursor = usageDateKst(new Date().toISOString()).slice(0, 7);
  expect(
    f.db.sqlite
      .query("SELECT cursor_month,budget_krw,maintenance_krw FROM v2_storage_carryover")
      .get(),
  ).toEqual({
    cursor_month: cursor,
    budget_krw: 78 + (cursor > "2026-10" ? 40 : 0),
    maintenance_krw: 19,
  });
  expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});

test("canonical deltas are once-only, guarded and roll back with the whole pending batch", async () => {
  const f = await ready(),
    i = await intent(f);
  expect(await admit(f, i)).toBe(true);
  const db = f.db.sqlite;
  expect(
    db.query("SELECT held_bytes FROM v2_physical_storage_totals WHERE environment='preview'").get(),
  ).toEqual({ held_bytes: 100 });
  expect(db.query("SELECT * FROM v2_physical_total_mutations").all()).toEqual([]);
  for (const sql of [
    "UPDATE v2_physical_storage_totals SET held_bytes=0 WHERE environment='preview'",
    "DELETE FROM v2_physical_storage_totals WHERE environment='preview'",
    "UPDATE v2_physical_storage_capacity SET held_bytes=0 WHERE environment='preview'",
    "UPDATE v2_physical_binding_totals SET held_bytes=0",
    "DELETE FROM v2_physical_binding_totals",
    `INSERT INTO v2_physical_total_mutations VALUES('preview','${i.id}',100)`,
    `INSERT INTO v2_physical_total_mutations VALUES('preview','${i.id}',-100)`,
  ])
    expect(() => db.exec(sql)).toThrow();
  expect(db.query("SELECT * FROM v2_storage_integrity_faults").all()).toEqual([
    { environment: "production", blob_id: i.id },
  ]);
  const second = await intent(f);
  expect(() =>
    db.transaction(() => {
      db.query(
        "UPDATE v2_storage_reservations SET live_blob_bytes=9007199254740991 WHERE id=?",
      ).run(second.reservationId);
      db.query(
        "INSERT INTO v2_blobs SELECT ?,principal_id,?,kind,visibility,?,state,logical_bytes,cipher_bytes,key_version,encrypted_payload,created_at,deleted_at,source_blob_id,source_asset_revision,approved_revision_id FROM v2_blobs WHERE id=?",
      ).run(second.id, second.reservationId, second.input.objectKey, i.id);
    })(),
  ).toThrow();
  expect(
    db
      .query("SELECT live_blob_bytes FROM v2_storage_reservations WHERE id=?")
      .get(second.reservationId),
  ).toEqual({ live_blob_bytes: 0 });
});

test("reservation bytes and integrity witnesses follow every live transition, including another environment", async () => {
  const f = await fixture(),
    i = await intent(f);
  await i.statement().run();
  const db = f.db.sqlite;
  db.query("UPDATE v2_blobs SET logical_bytes=75 WHERE id=?").run(i.id);
  expect(
    db.query("SELECT live_blob_bytes FROM v2_storage_reservations WHERE id=?").get(i.reservationId),
  ).toEqual({ live_blob_bytes: 75 });
  db.query("UPDATE v2_blobs SET state='deleting' WHERE id=?").run(i.id);
  expect(db.query("SELECT count(*) AS n FROM v2_storage_integrity_faults").get()).toEqual({ n: 2 });
  db.query("UPDATE v2_blobs SET state='deleted',deleted_at=? WHERE id=?").run(NOW, i.id);
  expect(
    db.query("SELECT live_blob_bytes FROM v2_storage_reservations WHERE id=?").get(i.reservationId),
  ).toEqual({ live_blob_bytes: 0 });
  expect(db.query("SELECT * FROM v2_storage_integrity_faults").all()).toEqual([]);
  db.query("DELETE FROM v2_blobs WHERE id=?").run(i.id);
  expect(
    db.query("SELECT live_blob_bytes FROM v2_storage_reservations WHERE id=?").get(i.reservationId),
  ).toEqual({ live_blob_bytes: 0 });
});

test("local database carryover follows late budget and maintenance transitions across environments", async () => {
  const db = await createTestDatabase();
  try {
    db.sqlite.exec(
      "INSERT INTO v2_monthly_budget(month,allocation_version,environment,limit_krw,reserved_krw,ambiguous_krw) VALUES('2026-09',1,'production',10000,17,23)",
    );
    db.sqlite.exec(
      `INSERT INTO v2_maintenance_exposure(id,month,reference_hash,amount_krw,state,created_at) VALUES('past','2026-09','${"a".repeat(64)}',19,'reserved','2026-09-01')`,
    );
    const amounts = () =>
      db.sqlite.query("SELECT budget_krw,maintenance_krw FROM v2_storage_carryover").get();
    expect(amounts()).toEqual({ budget_krw: 40, maintenance_krw: 19 });
    db.sqlite.exec(
      "UPDATE v2_monthly_budget SET reserved_krw=0,ambiguous_krw=40 WHERE month='2026-09'",
    );
    db.sqlite.exec("UPDATE v2_maintenance_exposure SET state='ambiguous' WHERE id='past'");
    expect(amounts()).toEqual({ budget_krw: 40, maintenance_krw: 19 });
    db.sqlite.exec(
      "UPDATE v2_monthly_budget SET ambiguous_krw=0,settled_krw=40 WHERE month='2026-09'",
    );
    db.sqlite.exec("UPDATE v2_maintenance_exposure SET state='settled' WHERE id='past'");
    expect(amounts()).toEqual({ budget_krw: 0, maintenance_krw: 0 });
  } finally {
    db.close();
  }
});

test("new unavailable funding immediately denies physical permission; head cannot regress or be forged", async () => {
  const f = await ready(),
    i = await intent(f);
  expect(await admit(f, i)).toBe(true);
  const next = {
    ...f.fp,
    id: "zz-latest-funding",
    state: "unavailable" as const,
    spendAllowanceKrw: 0,
  };
  expect(await f.runtime.putFundingProof(next, NOW)).toBe(true);
  expect(await f.runtime.putFundingProof(next, NOW)).toBe(true);
  expect(await f.capacity.beginWrite(i.id, 100, NOW)).toBeNull();
  for (const sql of [
    "DELETE FROM v2_storage_funding_heads",
    `UPDATE v2_storage_funding_heads SET proof_id='${f.fp.id}'`,
    "UPDATE v2_storage_funding_heads SET verified_at='2099-01-01'",
    `UPDATE v2_storage_funding_heads SET proof_id='${f.pp.id}'`,
  ])
    expect(() => f.db.sqlite.exec(sql)).toThrow();
});

test("upgrade rejects inconsistent old capacity and rolls back readiness instead of rewriting exposure", async () => {
  const f = await fixture({ throughMigration: "0009_storage_capacity_maintenance" });
  f.db.sqlite.exec(
    "INSERT INTO v2_physical_storage_capacity(environment,capacity_bytes,held_bytes) VALUES('preview',1000,1)",
  );
  expect(() =>
    f.db.sqlite.transaction(() =>
      migration
        .split("--> statement-breakpoint")
        .filter((sql) => sql.trim())
        .forEach((sql) => {
          f.db.sqlite.query(sql).run();
        }),
    )(),
  ).toThrow();
  expect(f.db.sqlite.query("SELECT held_bytes FROM v2_physical_storage_capacity").get()).toEqual({
    held_bytes: 1,
  });
  expect(
    f.db.sqlite.query("SELECT value FROM app_metadata WHERE key='schema_version'").get(),
  ).toEqual({ value: "0009_storage_capacity_maintenance" });
});

test("current-month setup advances atomically, preserves an active control, and future setup cannot move the cursor", async () => {
  const f = await fixture({ throughMigration: "0009_storage_capacity_maintenance" });
  const now = new Date().toISOString(),
    month = usageDateKst(now).slice(0, 7);
  // A deliberately old cursor models a database restored from last month.
  const old = "2000-01";
  f.db.sqlite.transaction(() =>
    migration
      .replace("SELECT strftime('%Y-%m','now','+9 hours') AS month", `SELECT '${old}' AS month`)
      .split("--> statement-breakpoint")
      .filter((s) => s.trim())
      .forEach((s) => {
        f.db.sqlite.query(s).run();
      }),
  )();
  f.db.sqlite
    .query(
      "INSERT INTO v2_monthly_budget(month,allocation_version,environment,limit_krw,reserved_krw) VALUES('2000-02',1,'production',10000,37)",
    )
    .run();
  if (month !== "2026-10")
    f.db.sqlite
      .query(
        "INSERT INTO v2_monthly_budget(month,allocation_version,environment,limit_krw) VALUES(?,1,'preview',10000)",
      )
      .run(month);
  const before = f.db.sqlite.query("SELECT * FROM v2_runtime_controls WHERE month='2026-10'").get();
  expect(await f.runtime.initializeControl(month, now)).toBe(month !== "2026-10");
  expect(
    f.db.sqlite.query("SELECT * FROM v2_runtime_controls WHERE month='2026-10'").get(),
  ).toEqual(before);
  expect(
    f.db.sqlite.query("SELECT cursor_month,budget_krw FROM v2_storage_carryover").get(),
  ).toEqual({ cursor_month: month, budget_krw: 37 });
  const summary = f.db.sqlite.query("SELECT * FROM v2_storage_carryover").get();
  expect(await f.runtime.initializeControl(month, now)).toBe(false);
  expect(f.db.sqlite.query("SELECT * FROM v2_storage_carryover").get()).toEqual(summary);
  f.db.sqlite.exec(
    "INSERT INTO v2_monthly_budget(month,allocation_version,environment,limit_krw) VALUES('2099-01',1,'preview',10000)",
  );
  expect(await f.runtime.initializeControl("2099-01", now)).toBe(true);
  expect(f.db.sqlite.query("SELECT * FROM v2_storage_carryover").get()).toEqual(summary);
});

test("missing summary fails closed without manufacturing a frozen control", async () => {
  const f = await fixture();
  f.db.sqlite.exec("DROP TRIGGER v2_storage_carryover_delete");
  f.db.sqlite.exec("DELETE FROM v2_storage_carryover");
  const before = f.db.sqlite.query("SELECT * FROM v2_runtime_controls").all();
  await expect(f.runtime.initializeControl("2026-10", NOW)).rejects.toThrow("DB_OPERATION_FAILED");
  expect(f.db.sqlite.query("SELECT * FROM v2_runtime_controls").all()).toEqual(before);
});

test("a cursor CAS race rolls back the new control instead of returning an ordinary no-op", async () => {
  const f = await fixture({ throughMigration: "0009_storage_capacity_maintenance" });
  const now = new Date().toISOString(),
    month = usageDateKst(now).slice(0, 7);
  f.db.sqlite.transaction(() => {
    for (const sql of migration
      .replace("SELECT strftime('%Y-%m','now','+9 hours') AS month", "SELECT '2000-01' AS month")
      .split("--> statement-breakpoint")
      .filter((s) => s.trim()))
      f.db.sqlite.query(sql).run();
  })();
  f.db.sqlite.query("DELETE FROM v2_runtime_controls WHERE month=?").run(month);
  if (month !== "2026-10")
    f.db.sqlite
      .query(
        "INSERT INTO v2_monthly_budget(month,allocation_version,environment,limit_krw) VALUES(?,1,'preview',10000)",
      )
      .run(month);
  const raced = createV2PaidRuntimeRepository(
    {
      ...f.core,
      binding: {
        ...f.core.binding,
        async batch(statements: D1PreparedStatement[]) {
          f.db.sqlite.exec("UPDATE v2_storage_carryover SET revision=revision+1 WHERE id=1");
          return f.core.binding.batch(statements);
        },
      },
    },
    "preview",
  );
  await expect(raced.initializeControl(month, now)).rejects.toThrow("DB_OPERATION_FAILED");
  expect(f.db.sqlite.query("SELECT * FROM v2_runtime_controls WHERE month=?").all(month)).toEqual(
    [],
  );
  expect(f.db.sqlite.query("SELECT cursor_month FROM v2_storage_carryover").get()).toEqual({
    cursor_month: "2000-01",
  });
});
