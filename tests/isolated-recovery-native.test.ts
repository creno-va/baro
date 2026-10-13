import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { migrationImport, migrationTableSql } from "../scripts/apply-d1-migrations";
import { runDrillWrangler } from "../scripts/isolated-drill-process";
import { loadDrillMigrations, seedDrillFixture } from "../scripts/isolated-recovery-drill-fixture";
import { remoteBudgetD1 } from "../scripts/remote-budget-d1";

test("Node Wrangler SQL-file import preserves migration triggers and the native local D1 fixture", async () => {
  const directory = await mkdtemp(join(tmpdir(), "baro-drill-native-"));
  let mf: Miniflare | undefined;
  try {
    const id = crypto.randomUUID();
    const config = join(directory, "wrangler.json");
    const file = join(directory, "migrations.sql");
    const persistence = join(directory, "state");
    const migrations = await loadDrillMigrations();
    await writeFile(
      config,
      JSON.stringify({
        name: "baro-local-drill-test",
        compatibility_date: "2026-10-01",
        d1_databases: [
          { binding: "DRILL", database_name: "baro-local-drill-test", database_id: id },
        ],
      }),
      { mode: 0o600 },
    );
    await writeFile(
      file,
      `${migrationTableSql};\n${migrations.map(({ name, sql }) => migrationImport(name, sql)).join("\n")}`,
      { mode: 0o600 },
    );
    const command = await runDrillWrangler(
      [
        "d1",
        "execute",
        "DRILL",
        "--local",
        "--config",
        config,
        "--persist-to",
        persistence,
        "--file",
        file,
        "--yes",
        "--json",
      ],
      20_000,
    );
    expect(command.runtime).toBe("node");
    expect(command.exitCode).toBe(0);
    expect(command.signal).toBeNull();
    mf = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: 'export default { fetch() { return new Response("local drill regression"); } }',
        compatibilityDate: "2026-10-01",
        d1Databases: { DRILL: id },
        resourcePersistencePath: join(persistence, "v3"),
        cf: false,
        unsafeRegisterWorker: false,
      }),
    );
    const native = (await mf.getD1Database("DRILL")) as unknown as D1Database;
    const ledger = await native
      .prepare("SELECT name FROM d1_migrations ORDER BY name")
      .all<{ name: string }>();
    expect(ledger.results.map(({ name }) => name)).toEqual(migrations.map(({ name }) => name));
    expect(
      await native
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'v2_physical_binding_insert'",
        )
        .first(),
    ).not.toBeNull();
    const fetcher = (async (_url: unknown, init: RequestInit) => {
      const { batch } = JSON.parse(String(init.body)) as {
        batch: { sql: string; params: unknown[] }[];
      };
      return Response.json({
        success: true,
        result: await native.batch(
          batch.map(({ sql, params }) => native.prepare(sql).bind(...params)),
        ),
      });
    }) as typeof fetch;
    const db = remoteBudgetD1("synthetic-test-token", "local-account", "local-database", fetcher);
    const fixture = await seedDrillFixture(db, Date.now());
    const observed = await fixture.observe(false);
    expect(observed.target).toEqual([1, 2, 1, 1, 1]);
    expect(observed.control).toEqual([1, 1, 1, 1, 1]);
  } finally {
    await mf?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
