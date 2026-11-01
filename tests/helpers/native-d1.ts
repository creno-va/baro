import type { Database } from "bun:sqlite";
import { readdir } from "node:fs/promises";
/** Synthetic fixture transfer only; canonical mirrors are rebuilt by migration
 * and source triggers instead of bypassing integrity guards. */
export async function copySyntheticD1(
  binding: D1Database,
  sqlite: Database,
  throughMigration?: string,
) {
  const sourceCursor = sqlite
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='v2_storage_carryover'")
    .get()
    ? (sqlite.query("SELECT cursor_month FROM v2_storage_carryover WHERE id=1").get() as {
        cursor_month: string;
      } | null)
    : null;
  if (sourceCursor && !/^\d{4}-\d{2}$/.test(sourceCursor.cursor_month))
    throw new Error("SYNTHETIC_CURSOR_INVALID");
  for (const name of (await readdir("drizzle"))
    .filter(
      (n) => /^\d{4}_.+\.sql$/.test(n) && (!throughMigration || n <= `${throughMigration}.sql`),
    )
    .sort())
    await binding.batch(
      (name.startsWith("0010_") && sourceCursor
        ? (await Bun.file(`drizzle/${name}`).text()).replace(
            "SELECT strftime('%Y-%m','now','+9 hours') AS month",
            `SELECT '${sourceCursor.cursor_month}' AS month`,
          )
        : await Bun.file(`drizzle/${name}`).text()
      )
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => binding.prepare(s)),
    );
  const statements = [binding.prepare("PRAGMA defer_foreign_keys=ON")];
  const derived = new Set([
    "v2_physical_storage_totals",
    "v2_physical_binding_totals",
    "v2_physical_total_mutations",
    "v2_storage_funding_heads",
    "v2_storage_integrity_faults",
    "v2_storage_carryover",
    "v2_directory_epoch",
    "v2_directory_terms",
    "v2_directory_facets",
    "v2_directory_asset_refs",
  ]);
  const tables = sqlite
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  for (const { name } of tables.sort(
    (a, b) =>
      Number(a.name === "v2_physical_blob_bindings") -
      Number(b.name === "v2_physical_blob_bindings"),
  )) {
    if (derived.has(name)) continue;
    // Explicit historical fixtures copy only columns that existed at that
    // migration. Latest-schema transfers still preserve every source column.
    const historicalColumns = throughMigration
      ? new Set(
          (await binding.prepare(`PRAGMA table_info(${name})`).all<{ name: string }>()).results.map(
            (column) => column.name,
          ),
        )
      : null;
    for (const row of sqlite.query(`SELECT * FROM ${name}`).all() as Record<string, unknown>[]) {
      if (name === "app_metadata" && !String(row.key).startsWith("account-type:")) continue;
      const value = {
        ...Object.fromEntries(
          Object.entries(row).filter(
            ([column]) => !historicalColumns || historicalColumns.has(column),
          ),
        ),
        // Reconstruct only the retired age field of an explicitly synthetic
        // historical fixture; consent versions/time and every actual source row
        // stay unchanged. Current-schema copies never receive this column.
        ...(name === "user_consents" &&
        historicalColumns?.has("over_14_confirmed") &&
        !("over_14_confirmed" in row)
          ? { over_14_confirmed: 1 }
          : {}),
        ...(name === "v2_runtime_controls" ? { phase: "frozen" } : {}),
        ...(name === "v2_physical_storage_capacity" ? { held_bytes: 0 } : {}),
      };
      statements.push(
        binding
          .prepare(
            `INSERT INTO ${name}(${Object.keys(value).join(",")}) VALUES(${Object.keys(value)
              .map(() => "?")
              .join(",")})`,
          )
          .bind(...Object.values(value)),
      );
    }
  }
  for (const row of sqlite
    .query("SELECT month,environment,phase FROM v2_runtime_controls")
    .all() as { month: string; environment: string; phase: string }[])
    statements.push(
      binding
        .prepare("UPDATE v2_runtime_controls SET phase=? WHERE month=? AND environment=?")
        .bind(row.phase, row.month, row.environment),
    );
  await binding.batch(statements);
}
