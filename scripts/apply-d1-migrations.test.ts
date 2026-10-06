import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import {
  executionOutput,
  migrationImport,
  migrationTableSql,
  pendingMigrations,
} from "./apply-d1-migrations";

test("SQL-file import preserves multi-statement triggers and records the same atomic migration", async () => {
  const db = new Database(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=ON");
    db.exec(migrationTableSql);
    const files = [...new Bun.Glob("*.sql").scanSync("drizzle")].sort();
    for (const name of files) {
      const sql = await Bun.file(`drizzle/${name}`).text();
      db.transaction(() => db.exec(migrationImport(name, sql)))();
    }
    expect(db.query("SELECT name FROM d1_migrations ORDER BY id").all()).toEqual(
      files.map((name) => ({ name })),
    );
    expect(db.query("SELECT value FROM app_metadata WHERE key='schema_version'").get()).toEqual({
      value: "0009_storage_capacity_maintenance",
    });
    expect(
      db
        .query(
          "SELECT name FROM sqlite_master WHERE type='trigger' AND name='v2_physical_binding_insert'",
        )
        .get(),
    ).not.toBeNull();
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db.close();
  }
});

test("failed imports leave neither partial schema nor an applied ledger entry", () => {
  const db = new Database(":memory:");
  try {
    db.exec(migrationTableSql);
    expect(() =>
      db.transaction(() =>
        db.exec(
          migrationImport(
            "0010_failed.sql",
            "CREATE TABLE probe(id TEXT); INSERT INTO missing VALUES(1);",
          ),
        ),
      )(),
    ).toThrow();
    expect(db.query("SELECT name FROM d1_migrations").all()).toEqual([]);
    expect(db.query("SELECT name FROM sqlite_master WHERE name='probe'").all()).toEqual([]);
  } finally {
    db.close();
  }
});

test("applied history is an ordered known prefix and retries skip recorded files", () => {
  const files = ["0001_next.sql", "0000_foundation.sql", "0002_domain.sql"];
  expect(pendingMigrations(files, ["0000_foundation.sql"])).toEqual([
    "0001_next.sql",
    "0002_domain.sql",
  ]);
  expect(() => pendingMigrations(files, ["0001_next.sql"])).toThrow("MIGRATION_HISTORY_GAP");
  expect(() => pendingMigrations(files, ["9999_unknown.sql"])).toThrow("MIGRATION_HISTORY_UNKNOWN");
  expect(() => migrationImport("../invalid.sql", "SELECT 1;")).toThrow();
});

test("remote file-import progress cannot mask success, while query receipts remain strict", () => {
  const progress =
    "│ Checking if file needs uploading\n│ Uploading complete.\n[unknown import summary]";
  expect(executionOutput(["--file", "/tmp/migration.sql"], 0, progress)).toEqual([]);
  expect(() => executionOutput(["--file", "/tmp/migration.sql"], 1, progress)).toThrow(
    "D1_MIGRATION_EXECUTION_FAILED",
  );
  const rows = executionOutput(
    ["--command", "SELECT name"],
    0,
    JSON.stringify([
      { success: true, results: [{ name: "0009_storage_capacity_maintenance.sql" }] },
    ]),
  );
  expect(rows.flatMap((r) => r.results)).toEqual([
    { name: "0009_storage_capacity_maintenance.sql" },
  ]);
  expect(() => executionOutput(["--command", "SELECT name"], 0, progress)).toThrow(
    "D1_QUERY_OUTPUT_INVALID",
  );
  expect(() =>
    executionOutput(
      ["--command", "SELECT name"],
      0,
      JSON.stringify([{ success: false, results: [] }]),
    ),
  ).toThrow("D1_QUERY_OUTPUT_INVALID");
});
