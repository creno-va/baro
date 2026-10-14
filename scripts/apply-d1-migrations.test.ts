import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import migrationJournal from "../drizzle/meta/_journal.json";
import {
  executionOutput,
  migrationFailureCategory,
  migrationFailureCode,
  migrationImport,
  migrationTableSql,
  pendingMigrations,
} from "./apply-d1-migrations";

test("migration diagnostics retain stable D1 codes without SQL, private rows or arbitrary errors", () => {
  for (const [raw, expected] of [
    ["private SQL: FOREIGN KEY constraint failed", "foreign_key"],
    ["CHECK constraint failed: private row", "check_constraint"],
    ["UNIQUE constraint failed: private column", "unique_constraint"],
    ["no such table: private_table", "missing_schema"],
    ["private table already exists", "schema_conflict"],
    ["near private: syntax error", "sql_syntax"],
    ["private token authentication error", "authorization"],
    ["private SQL: too many SQL variables", "query_limit"],
    ["private row IMMUTABLE_RUNTIME_EVIDENCE", "immutable_evidence"],
    ["private unknown provider error", "unknown"],
  ] as const) {
    expect(migrationFailureCategory(raw)).toBe(expected);
  }
  expect(migrationFailureCode(new Error("D1_MIGRATION_EXECUTION_FAILED"))).toBe(
    "D1_MIGRATION_EXECUTION_FAILED",
  );
  expect(migrationFailureCode(new Error("D1_QUERY_OUTPUT_INVALID"))).toBe(
    "D1_QUERY_OUTPUT_INVALID",
  );
  expect(migrationFailureCode(new Error("PRIVATE_ROW_OR_SQL"))).toBe("D1_MIGRATION_FAILED");
  expect(migrationFailureCode({ message: "MIGRATION_HISTORY_GAP" })).toBe("D1_MIGRATION_FAILED");
});

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
      value: migrationJournal.entries.at(-1)?.tag,
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
