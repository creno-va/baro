import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2StorageCapacityRepository } from "../src/server/db/v2-storage-capacity";
import { copySyntheticD1 } from "./helpers/native-d1";
import { intent, NOW, ready, verifier } from "./helpers/storage-capacity";

const migrationNames = (await readdir("drizzle")).filter((s) => /^\d{4}_.+\.sql$/.test(s)).sort();
const migrationStatements = async (name: string) =>
  (await Bun.file(`drizzle/${name}`).text())
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
const native = (d1Databases = ["DB"]) =>
  new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("synthetic storage")}}',
      compatibilityDate: "2026-10-01",
      d1Databases,
      cf: false,
      unsafeRegisterWorker: false,
    }),
  );

test("native D1 rolls back 0010 backfill and 0011 receipt/trigger/marker failures with the whole migration ledger", async () => {
  const mf = native();
  try {
    const db = await mf.getD1Database("DB");
    for (const name of migrationNames.filter((s) => s < "0010"))
      await db.batch((await migrationStatements(name)).map((sql) => db.prepare(sql)));
    await db
      .prepare(
        "INSERT INTO v2_physical_storage_capacity(environment,capacity_bytes,held_bytes) VALUES('preview',1000,1)",
      )
      .run();
    await db.prepare("CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT UNIQUE)").run();
    await db
      .prepare(
        "INSERT INTO v2_monthly_budget(month,allocation_version,environment,limit_krw,ambiguous_krw) VALUES('2026-10',1,'preview',10000,123)",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO v2_runtime_controls(month,environment,phase,updated_at) VALUES('2026-10','preview','active','2026-10-06')",
      )
      .run();
    const before = await db.prepare("SELECT * FROM v2_runtime_controls").all();
    await expect(
      db.batch([
        ...(await migrationStatements("0010_bounded_storage_admission.sql")).map((sql) =>
          db.prepare(sql),
        ),
        db.prepare("INSERT INTO d1_migrations(name) VALUES('0010_bounded_storage_admission.sql')"),
      ]),
    ).rejects.toThrow();
    expect((await db.prepare("SELECT * FROM v2_runtime_controls").all()).results).toEqual(
      before.results,
    );
    expect(
      await db.prepare("SELECT ambiguous_krw FROM v2_monthly_budget").first("ambiguous_krw"),
    ).toBe(123);
    expect(
      (await db.prepare("SELECT name FROM sqlite_master WHERE name='v2_storage_carryover'").all())
        .results,
    ).toEqual([]);
    expect(
      (await db.prepare("PRAGMA table_info(v2_storage_reservations)").all()).results.some(
        (r: { name: string }) => r.name === "live_blob_bytes",
      ),
    ).toBe(false);
    expect((await db.prepare("SELECT * FROM d1_migrations").all()).results).toEqual([]);
    expect(
      await db.prepare("SELECT value FROM app_metadata WHERE key='schema_version'").first("value"),
    ).toBe("0009_storage_capacity_maintenance");
    // Reuse the same migrated native database to avoid launching another
    // workerd process merely for the next additive upgrade's rollback check.
    await db
      .prepare("UPDATE v2_physical_storage_capacity SET held_bytes=0 WHERE environment='preview'")
      .run();
    await db.batch(
      (await migrationStatements("0010_bounded_storage_admission.sql")).map((sql) =>
        db.prepare(sql),
      ),
    );
    const projectionBefore = await db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='trigger' AND name='v2_storage_projection_immutable'",
      )
      .first("sql");
    await db
      .prepare(
        "CREATE TRIGGER synthetic_failed_0011 BEFORE UPDATE ON app_metadata WHEN NEW.key='schema_version' AND NEW.value='0011_runtime_refresh' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_MIGRATION_FAILURE'); END",
      )
      .run();
    const batch = [
      ...(await migrationStatements("0011_runtime_refresh.sql")).map((sql) => db.prepare(sql)),
      db.prepare("INSERT INTO d1_migrations(name) VALUES('0011_runtime_refresh.sql')"),
    ];
    await expect(db.batch(batch)).rejects.toThrow();
    expect(
      (await db.prepare("SELECT name FROM sqlite_master WHERE name='v2_runtime_refreshes'").all())
        .results,
    ).toEqual([]);
    expect(
      await db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type='trigger' AND name='v2_storage_projection_immutable'",
        )
        .first("sql"),
    ).toBe(projectionBefore);
    expect(
      await db.prepare("SELECT value FROM app_metadata WHERE key='schema_version'").first("value"),
    ).toBe("0010_bounded_storage_admission");
    expect((await db.prepare("SELECT * FROM d1_migrations").all()).results).toEqual([]);
    await db.prepare("DROP TRIGGER synthetic_failed_0011").run();
    await db.batch(batch);
    expect(
      await db.prepare("SELECT value FROM app_metadata WHERE key='schema_version'").first("value"),
    ).toBe("0011_runtime_refresh");
    expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  } finally {
    await mf.dispose();
  }
}, 30000);

test("native D1 migrated physical admission and delta work stays constant at 100 and 10000 historical bindings", async () => {
  const observations: unknown[] = [];
  const metrics: { admissionRead: number; bindingRead: number; bindingWritten: number }[] = [];
  const mf = native(["SMALL", "LARGE"]);
  try {
    for (const [name, count] of [
      ["SMALL", 100],
      ["LARGE", 10000],
    ] as const) {
      const f = await ready(),
        i = await intent(f);
      const db = await mf.getD1Database(name);
      await copySyntheticD1(db as unknown as D1Database, f.db.sqlite);
      // These are actual migrated source tables and triggers, not reduced shapes.
      await db
        .prepare(
          "INSERT INTO v2_storage_reservations(id,principal_id,operation_id,target_id,entity_id,kind,byte_length,created_at) SELECT 'history',id,'history-op','history-target','history-target','derived_report',1000000,? FROM v2_billing_principals WHERE owner_id=?",
        )
        .bind(NOW, f.actor.ownerId)
        .run();
      await db
        .prepare(
          `WITH RECURSIVE n(i) AS(SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<?) INSERT INTO v2_blobs(id,principal_id,reservation_id,kind,visibility,object_key,logical_bytes,cipher_bytes,encrypted_payload,created_at) SELECT 'history-'||i,p.id,'history','original','private','private/history-'||i,1,0,'synthetic',? FROM n CROSS JOIN v2_billing_principals p WHERE p.owner_id=?`,
        )
        .bind(count, NOW, f.actor.ownerId)
        .run();
      await db
        .prepare(
          "INSERT INTO v2_physical_blob_bindings(blob_id,environment,owner_id,object_key,maximum_cipher_bytes,inventory_hash,created_at) SELECT b.id,'preview',?,b.object_key,1,?,? FROM v2_blobs b WHERE b.reservation_id='history'",
        )
        .bind(f.actor.ownerId, "a".repeat(64), NOW)
        .run();
      const core = createV2Core(db as unknown as D1Database, f.core.cipher);
      const capacity = createV2StorageCapacityRepository(core, "preview", verifier);
      const p = capacity.prepareCapacity(f.actor, i.input);
      const query = `SELECT 1 AS allowed WHERE ${p.predicate.sql}`;
      const plan = await db
        .prepare(`EXPLAIN QUERY PLAN ${query}`)
        .bind(...p.predicate.values)
        .all();
      const admitted = await db
        .prepare(query)
        .bind(...p.predicate.values)
        .all();
      expect(admitted.results).toEqual([{ allowed: 1 }]);
      await db
        .prepare(
          "INSERT INTO v2_blobs(id,principal_id,reservation_id,kind,visibility,object_key,logical_bytes,cipher_bytes,encrypted_payload,created_at) SELECT ?,id,?,'original','private',?,100,0,?,? FROM v2_billing_principals WHERE owner_id=?",
        )
        .bind(i.id, i.reservationId, i.input.objectKey, i.encrypted, NOW, f.actor.ownerId)
        .run();
      const bound = await db
        .prepare(
          "INSERT INTO v2_physical_blob_bindings(blob_id,environment,owner_id,object_key,maximum_cipher_bytes,created_at) VALUES(?,'preview',?,?,100,?)",
        )
        .bind(i.id, f.actor.ownerId, i.input.objectKey, NOW)
        .run();
      expect(await capacity.beginWrite(i.id, 100, NOW)).not.toBeNull();
      expect((await db.prepare("SELECT * FROM v2_physical_total_mutations").all()).results).toEqual(
        [],
      );
      expect(
        await db
          .prepare("SELECT held_bytes FROM v2_physical_storage_totals WHERE environment='preview'")
          .first("held_bytes"),
      ).toBe(count + 100);
      // Restore's cold mirror recomputation is idempotent; it does not reapply a delta.
      for (let replay = 0; replay < 2; replay++)
        await db
          .prepare(
            "UPDATE v2_physical_storage_capacity SET held_bytes=(SELECT coalesce(sum(maximum_cipher_bytes),0) FROM v2_physical_blob_bindings WHERE environment='preview' AND state='held') WHERE environment='preview'",
          )
          .run();
      expect(
        await db
          .prepare("SELECT held_bytes FROM v2_physical_storage_totals WHERE environment='preview'")
          .first("held_bytes"),
      ).toBe(count + 100);
      const measured = {
        admissionRead: admitted.meta.rows_read,
        bindingRead: bound.meta.rows_read,
        bindingWritten: bound.meta.rows_written,
      };
      metrics.push(measured);
      observations.push({ count, ...measured, plan: plan.results });
    }
  } finally {
    await mf.dispose();
  }
  expect(metrics[1]).toEqual(metrics[0]);
  // Synthetic local runtime receipt only; auth/files/cleanup total certification
  // belongs to the integrated consumer head, and is intentionally not asserted here.
  console.log(
    JSON.stringify({
      kind: "synthetic-native-d1-storage-summary",
      at: new Date().toISOString(),
      observations,
    }),
  );
}, 60000);
