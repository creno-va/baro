import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    "bunx",
    "wrangler",
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
  const run = async (args: string[]) => {
    const child = Bun.spawn([...base, ...args], { stdout: "pipe", stderr: "pipe" });
    const [stdout, , code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    // CLI/API diagnostics can contain query payloads. Expose only a stable code.
    if (code !== 0) throw new Error("D1_MIGRATION_EXECUTION_FAILED");
    return resultsSchema.parse(JSON.parse(stdout));
  };
  await run(["--command", migrationTableSql]);
  const history = await run(["--command", "SELECT name FROM d1_migrations ORDER BY id"]);
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
      await run(["--file", path]);
      const recorded = await run([
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
    console.error(
      error instanceof Error && /^[A-Z_]+$/.test(error.message)
        ? error.message
        : "D1_MIGRATION_FAILED",
    );
    process.exitCode = 1;
  });
}
