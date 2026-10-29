import { expect, test } from "bun:test";
import {
  applicationResetSql,
  prepareSyntheticLawyers,
  RESET_CONFIRMATION,
} from "../scripts/reset-application-data";
import { createSelfProfileService } from "../src/server/modules/lawyers/self-profile";
import { readyFile, reportFixture } from "./helpers/report-fixture";

const schemaFor = (db: Awaited<ReturnType<typeof reportFixture>>["db"]) => {
  db.sqlite.exec(
    "CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY,name TEXT,applied_at TEXT)",
  );
  return db.sqlite
    .query("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string; sql: string }[];
};
const executeReset = (db: Awaited<ReturnType<typeof reportFixture>>["db"], sql: string) =>
  db.sqlite.transaction(() => {
    // Each generated operator statement is terminated by a semicolon/newline.
    // Use prepared execution so an early CHECK failure cannot be hidden by exec.
    for (const statement of sql.split(/;\s*\n/).filter((s) => s.trim()))
      db.sqlite.query(statement).run();
  })();
test("reset removes application data and old sessions, retains physical accounting, and publishes exactly two unverified synthetic profiles", async () => {
  const f = await reportFixture();
  await readyFile(f, "기존 합성 자료");
  const schema = schemaFor(f.db);
  const before = f.db.sqlite.query("SELECT id,logical_bytes FROM v2_blobs ORDER BY id").all();
  expect(before.length).toBeGreaterThan(0);
  const seed = await prepareSyntheticLawyers(f.core.cipher, new Date().toISOString());
  const reset = applicationResetSql(schema, seed);
  executeReset(f.db, reset);
  for (const table of [
    "account",
    "session",
    "cases",
    "v2_workspaces",
    "v2_files",
    "v2_jobs",
    "v2_reports",
    "v2_messages",
  ])
    expect(f.db.sqlite.query(`SELECT count(*) AS n FROM "${table}"`).get()).toEqual({ n: 0 });
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM user").get()).toEqual({ n: 2 });
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_directory_entries").get()).toEqual({
    n: 2,
  });
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_private_snapshots").get()).toEqual({
    n: 2,
  });
  expect(f.db.sqlite.query("SELECT id,logical_bytes FROM v2_blobs ORDER BY id").all()).toEqual(
    before,
  );
  expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  for (const profile of seed.profiles) {
    const actual = await createSelfProfileService(f.core).get(profile.id);
    expect(actual.name).toBe(profile.name);
    expect(actual.verificationStatus).toBe("self_declared");
    expect(actual.introduction).toContain("합성 프로필");
    expect(actual.published).toBe(true);
  }
  const next = await prepareSyntheticLawyers(f.core.cipher, new Date().toISOString());
  executeReset(f.db, applicationResetSql(schema, next));
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM user").get()).toEqual({ n: 2 });
  expect(f.db.sqlite.query("SELECT id,logical_bytes FROM v2_blobs ORDER BY id").all()).toEqual(
    before,
  );
});

test("an executing job aborts the complete reset transaction before deleting data", async () => {
  const f = await reportFixture();
  await readyFile(f, "실행 중 보호를 검증할 합성 자료");
  const schema = schemaFor(f.db);
  f.db.sqlite.exec(
    "INSERT INTO v2_jobs(id,operation_id,runtime_instance_id,workspace_id,target_kind,target_id,target_revision,kind,status,lease_token,lease_until,created_at,updated_at) SELECT 'synthetic-running',operation_id,'synthetic-running',workspace_id,'file',id,revision,'file_processing','running','synthetic-lease','2099-01-01T00:00:00.000Z',created_at,created_at FROM v2_files LIMIT 1",
  );
  expect(
    f.db.sqlite.query("SELECT count(*) AS n FROM v2_jobs WHERE status='running'").get(),
  ).toEqual({ n: 1 });
  const original = f.db.sqlite.query("SELECT count(*) AS n FROM user").get();
  const seed = await prepareSyntheticLawyers(f.core.cipher, new Date().toISOString());
  expect(
    f.db.sqlite
      .query(
        "SELECT EXISTS(SELECT 1 FROM v2_jobs WHERE status IN ('running','validating')) AS active",
      )
      .get(),
  ).toEqual({ active: 1 });
  expect(f.db.sqlite.query("PRAGMA ignore_check_constraints").get()).toEqual({
    ignore_check_constraints: 0,
  });
  expect(() => executeReset(f.db, applicationResetSql(schema, seed))).toThrow();
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM user").get()).toEqual(original);
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM v2_workspaces").get()).toEqual({ n: 1 });
});

test("unknown schema is rejected before any destructive statement is produced", async () => {
  const f = await reportFixture();
  const seed = await prepareSyntheticLawyers(f.core.cipher, new Date().toISOString());
  expect(() =>
    applicationResetSql(
      [
        ...schemaFor(f.db),
        { name: "future_private_records", sql: "CREATE TABLE future_private_records(id TEXT)" },
      ],
      seed,
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
