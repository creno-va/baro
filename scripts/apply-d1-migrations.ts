import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";

const migrationName = z.string().regex(/^\d{4}_[a-z0-9_]+\.sql$/);
export const migrationTableSql = `CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);`;

/** The schema and its ledger entry share D1's atomic SQL-file import.
 * Preserve trigger bodies and append-only migration bytes; never split at ';'. */
export function migrationImport(name: string, sql: string): string {
  migrationName.parse(name);
  return `${sql}\nINSERT INTO d1_migrations (name) VALUES ('${name}');\n`;
}

export function pendingMigrations(files: string[], applied: string[]): string[] {
  const ordered = files.map((name) => migrationName.parse(name)).sort();
  const known = new Set(ordered);
  if (applied.some((name) => !known.has(name))) throw new Error("MIGRATION_HISTORY_UNKNOWN");
  const done = new Set(applied);
  let missing = false;
  for (const name of ordered) {
    if (!done.has(name)) missing = true;
    else if (missing) throw new Error("MIGRATION_HISTORY_GAP");
  }
  return ordered.filter((name) => !done.has(name));
}

const resultsSchema = z.array(
  z.object({ success: z.literal(true), results: z.array(z.record(z.string(), z.unknown())) }),
);

/** Only these categories may escape the CLI boundary; never forward SQL or row values. */
export function migrationFailureCategory(output: string) {
  if (/foreign key constraint failed/i.test(output)) return "foreign_key";
  if (/check constraint failed/i.test(output)) return "check_constraint";
  if (/unique constraint failed/i.test(output)) return "unique_constraint";
  if (/no such (?:table|column|trigger)/i.test(output)) return "missing_schema";
  if (/already exists/i.test(output)) return "schema_conflict";
  if (/syntax error|incomplete input/i.test(output)) return "sql_syntax";
  if (/not authorized|authentication error|authorization failed|code: 10000/i.test(output))
    return "authorization";
  if (/SQLITE_TOOBIG|too many (?:SQL variables|terms)|statement too long/i.test(output))
    return "query_limit";
  if (/IMMUTABLE_RUNTIME_EVIDENCE|STORAGE_PROJECTION_IMMUTABLE/i.test(output))
    return "immutable_evidence";
  return "unknown";
}

const failureCodes = new Set([
  "D1_MIGRATION_EXECUTION_FAILED",
  "D1_QUERY_OUTPUT_INVALID",
  "MIGRATION_HISTORY_UNKNOWN",
  "MIGRATION_HISTORY_GAP",
  "MIGRATION_RECEIPT_MISSING",
  "REMOTE_PERSIST_NOT_ALLOWED",
]);
export function migrationFailureCode(error: unknown) {
  return error instanceof Error && failureCodes.has(error.message)
    ? error.message
    : "D1_MIGRATION_FAILED";
}

/** Remote file imports emit Wrangler progress text even with --json.
 * Their authoritative receipt is the separate ledger query, not CLI stdout. */
export function executionOutput(args: string[], code: number, stdout: string) {
  if (code !== 0) throw new Error("D1_MIGRATION_EXECUTION_FAILED");
  if (args.includes("--file")) return [];
  try {
    return resultsSchema.parse(JSON.parse(stdout));
  } catch {
    throw new Error("D1_QUERY_OUTPUT_INVALID");
  }
}

async function main() {
  const environment = z.enum(["preview", "production"]).parse(process.argv[2]);
  const local = process.argv.includes("--local");
  const persistIndex = process.argv.indexOf("--persist-to");
  const persist =
    persistIndex === -1
      ? []
      : [
          "--persist-to",
          z
            .string()
            .min(1)
            .parse(process.argv[persistIndex + 1]),
        ];
  if (!local && persist.length) throw new Error("REMOTE_PERSIST_NOT_ALLOWED");
  const base = [
    "node",
    "--no-warnings",
    resolve("node_modules/wrangler/wrangler-dist/cli.js"),
    "d1",
    "execute",
    "DB",
    "--env",
    environment,
    local ? "--local" : "--remote",
    ...persist,
    "--json",
    "--yes",
  ];
  const run = async (
    stage: "ledger-create" | "history-read" | "migration-import" | "receipt-read",
    args: string[],
  ) => {
    console.log(JSON.stringify({ mode: "d1-migrate", stage, status: "started" }));
    const child = Bun.spawn([...base, ...args], {
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    try {
      // Direct Node execution preserves termination failures hidden by CLI wrappers.
      if (child.signalCode) throw new Error("D1_MIGRATION_EXECUTION_FAILED");
      return executionOutput(args, code, stdout);
    } catch (error) {
      console.error(
        JSON.stringify({
          mode: "d1-migrate",
          stage,
          status: "failed",
          code: migrationFailureCode(error),
          category: migrationFailureCategory(`${stdout}\n${stderr}`),
          exitCode: code,
          terminated: child.signalCode !== null,
        }),
      );
      throw error;
    }
  };
  await run("ledger-create", ["--command", migrationTableSql]);
  const history = await run("history-read", [
    "--command",
    "SELECT name FROM d1_migrations ORDER BY id",
  ]);
  const applied = history.flatMap((result) =>
    result.results.map((row) => migrationName.parse(row.name)),
  );
  const files = (await readdir("drizzle")).filter((name) => name.endsWith(".sql"));
  const pending = pendingMigrations(files, applied);
  const directory = await mkdtemp(join(tmpdir(), "baro-d1-migrations-"));
  try {
    for (const name of pending) {
      const path = join(directory, name);
      await writeFile(path, migrationImport(name, await Bun.file(join("drizzle", name)).text()));
      console.log(JSON.stringify({ mode: "d1-migrate", migration: name }));
      await run("migration-import", ["--file", path]);
      const recorded = await run("receipt-read", [
        "--command",
        `SELECT name FROM d1_migrations WHERE name='${name}'`,
      ]);
      if (recorded.flatMap((result) => result.results).length !== 1)
        throw new Error("MIGRATION_RECEIPT_MISSING");
      console.log(`Applied ${name}`);
    }
    console.log(pending.length ? "D1 migrations complete" : "No migrations to apply");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(migrationFailureCode(error));
    process.exitCode = 1;
  });
}
