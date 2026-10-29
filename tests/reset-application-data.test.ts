import { expect, test } from "bun:test";
import { unlink } from "node:fs/promises";
import {
  applicationResetSql,
  prepareSyntheticLawyers,
  RESET_CONFIRMATION,
  resetMigrations,
} from "../scripts/reset-application-data";
import { createV2Core } from "../src/server/db/v2-core";
import { createSelfProfileService } from "../src/server/modules/lawyers/self-profile";
import { createTestDatabase } from "./helpers/d1";
import { readyFile, reportFixture } from "./helpers/report-fixture";

const capacity = { environment: "preview" as const, bytes: 100000000000 };
const schemaFor = (db: Awaited<ReturnType<typeof createTestDatabase>>) => {
  db.sqlite.exec(
    "CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY,name TEXT,applied_at TEXT)",
  );
  return db.sqlite
    .query(
      "SELECT name,sql,type FROM sqlite_master WHERE type IN ('table','trigger','view') AND name NOT LIKE 'sqlite_%'",
    )
    .all() as { name: string; sql: string }[];
};
// Use Node's sqlite3_exec semantics: stop on the first error and roll back all DDL.
async function resetSnapshot(db: Awaited<ReturnType<typeof createTestDatabase>>, sql: string) {
  const file = `.wrangler/reset-test-${crypto.randomUUID()}.sqlite`;
  await Bun.write(file, db.sqlite.serialize());
  const script = `import {DatabaseSync} from 'node:sqlite';import{readFileSync}from'node:fs';const input=JSON.parse(readFileSync(0,'utf8'));const db=new DatabaseSync(input.file);db.exec('PRAGMA foreign_keys=ON');let failed=false;let reason='';try{db.exec('BEGIN IMMEDIATE');db.exec(input.sql);db.exec('COMMIT')}catch(error){db.exec('ROLLBACK');failed=true;reason=error.message}db.close();process.stdout.write(JSON.stringify({failed,reason}));`;
  try {
    const child = Bun.spawnSync(["node", "--no-warnings", "--input-type=module", "-e", script], {
      stdin: new TextEncoder().encode(JSON.stringify({ file, sql })),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(child.exitCode).toBe(0);
    const { failed, reason } = JSON.parse(child.stdout.toString()) as {
      failed: boolean;
      reason: string;
    };
    return {
      failed,
      reason,
      db: await createTestDatabase({
        snapshot: new Uint8Array(await Bun.file(file).arrayBuffer()),
      }),
    };
  } finally {
    await unlink(file);
  }
}

test("full D1 reset removes all old application/ledger/blob rows and publishes exactly ten synthetic profiles", async () => {
  const f = await reportFixture();
  await readyFile(f, "기존 합성 자료");
  const schema = schemaFor(f.db);
  f.db.sqlite.exec("INSERT INTO d1_migrations VALUES(1,'historical-migration','2026-10-01')");
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_blobs").get()).not.toEqual({ n: 0 });
  const migrations = await resetMigrations();
  const seed = await prepareSyntheticLawyers(f.core.cipher, new Date().toISOString());
  expect(seed.profiles).toHaveLength(10);
  const result = await resetSnapshot(f.db, applicationResetSql(schema, seed, migrations, capacity));
  try {
    expect(result.failed, result.reason).toBe(false);
    for (const table of [
      "account",
      "session",
      "cases",
      "v2_workspaces",
      "v2_files",
      "v2_jobs",
      "v2_reports",
      "v2_messages",
      "v2_blobs",
      "v2_cost_attempts",
      "v2_paid_holds",
      "legacy_ai_attempts",
    ])
      expect(result.db.sqlite.query(`SELECT count(*) AS n FROM "${table}"`).get()).toEqual({
        n: 0,
      });
    for (const table of ["user", "v2_profiles", "v2_private_snapshots", "v2_directory_entries"])
      expect(result.db.sqlite.query(`SELECT count(*) AS n FROM "${table}"`).get()).toEqual({
        n: 10,
      });
    expect(result.db.sqlite.query("SELECT * FROM d1_migrations").all()).toEqual([
      { id: 1, name: "historical-migration", applied_at: "2026-10-01" },
    ]);
    expect(result.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
    const core = createV2Core(result.db.binding, f.core.cipher);
    for (const item of seed.profiles) {
      const p = await createSelfProfileService(core).get(item.id);
      expect(p.name).toBe(item.name);
      expect(p.verificationStatus).toBe("self_declared");
      expect(p.introduction).toContain("합성 프로필");
    }
  } finally {
    result.db.close();
  }
});

test("a running job rolls back the entire schema/data reset before any table is dropped", async () => {
  const f = await reportFixture();
  await readyFile(f, "실행 중 보호 합성 자료");
  const schema = schemaFor(f.db);
  f.db.sqlite.exec(
    "INSERT INTO v2_jobs(id,operation_id,runtime_instance_id,workspace_id,target_kind,target_id,target_revision,kind,status,lease_token,lease_until,created_at,updated_at) SELECT 'synthetic-running',operation_id,'synthetic-running',workspace_id,'file',id,revision,'file_processing','running','synthetic-lease','2099-01-01T00:00:00.000Z',created_at,created_at FROM v2_files LIMIT 1",
  );
  const seed = await prepareSyntheticLawyers(f.core.cipher, new Date().toISOString());
  const result = await resetSnapshot(
    f.db,
    applicationResetSql(schema, seed, await resetMigrations(), capacity),
  );
  try {
    expect(result.failed).toBe(true);
    expect(
      result.db.sqlite.query("SELECT count(*) AS n FROM v2_jobs WHERE status='running'").get(),
    ).toEqual({ n: 1 });
    expect(result.db.sqlite.query("SELECT count(*) AS n FROM v2_workspaces").get()).toEqual({
      n: 1,
    });
  } finally {
    result.db.close();
  }
});

test("schema drift is rejected before producing a destructive plan", async () => {
  const f = await reportFixture();
  const seed = await prepareSyntheticLawyers(f.core.cipher, new Date().toISOString());
  const migrations = await resetMigrations();
  expect(() =>
    applicationResetSql(
      [
        ...schemaFor(f.db),
        { name: "future_private_records", sql: "CREATE TABLE future_private_records(id TEXT)" },
      ],
      seed,
      migrations,
      capacity,
    ),
  ).toThrow("RESET_SCHEMA_DRIFT");
});

test("operator workflow fences both environments to exact main, explicit confirmation and preview success", async () => {
  const workflow = (
    await Bun.file(".github/workflows/reset-application-data.yml").text()
  ).replaceAll("\r\n", "\n");
  expect(workflow).toContain("workflow_dispatch:");
  expect(workflow).not.toMatch(/^ {2}(push|pull_request|schedule):/m);
  expect(workflow.match(/github\.sha == inputs\.target_sha/g)).toHaveLength(2);
  expect(workflow.match(/github\.ref == 'refs\/heads\/main'/g)).toHaveLength(2);
  expect(workflow.match(/github\.triggering_actor == 'hyunhomon'/g)).toHaveLength(2);
  expect(workflow).toContain(`inputs.confirmation == '${RESET_CONFIRMATION}'`);
  expect(workflow).toContain("production:\n    needs: preview");
  expect(workflow).toContain("name: preview\n      deployment: false");
  expect(workflow).toContain("name: production\n      deployment: false");
  expect(workflow).toContain("secrets.CASE_DATA_KEY_V1");
  expect(workflow).not.toMatch(/wrangler deploy|secret put|secret bulk|path:.*\.sql/);
  expect(workflow.match(/path: \.wrangler\/reset\/receipt-/g)).toHaveLength(2);
});
