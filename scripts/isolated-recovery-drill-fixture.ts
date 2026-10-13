import { readdir } from "node:fs/promises";
import { createCaseDataCipher } from "../src/server/crypto";
import { deletionJournalSchema } from "../src/server/modules/deletion/service";
import { migrationTableSql } from "./apply-d1-migrations";

export async function loadDrillMigrations() {
  const names = (await readdir("drizzle"))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  if (!names.length) throw new Error("DRILL_MIGRATIONS_MISSING");
  return Promise.all(
    names.map(async (name) => ({ name, sql: await Bun.file(`drizzle/${name}`).text() })),
  );
}
export type DrillMigrations = Awaited<ReturnType<typeof loadDrillMigrations>>;
export type DrillSchemaProgress = {
  phase: "create-ledger" | "migration-import" | "record-migration" | "verify-ledger" | "complete";
  migrationOrdinal: number;
  migrationCount: number;
  statementOffset: number;
  statementCount: number;
  confirmedStatements: number;
  confirmedMigrations: number;
};
export async function installDrillSchema(
  db: D1Database,
  migrations: DrillMigrations,
  importMigration: (name: string, sql: string) => Promise<void>,
  observe: (progress: DrillSchemaProgress) => Promise<void> = async () => {},
) {
  let confirmedStatements = 0,
    confirmedMigrations = 0;
  const progress = async (
    phase: DrillSchemaProgress["phase"],
    migrationOrdinal = 0,
    statementOffset = 0,
    statementCount = 0,
  ) =>
    observe({
      phase,
      migrationOrdinal,
      migrationCount: migrations.length,
      statementOffset,
      statementCount,
      confirmedStatements,
      confirmedMigrations,
    });
  await progress("create-ledger");
  await db.prepare(migrationTableSql).run();
  for (const [index, migration] of migrations.entries()) {
    // Count immutable source blocks for diagnostics only. Trigger DDL uses the
    // proven SQL-file import + ledger contract, never the REST query parser.
    const statements = migration.sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    await progress("migration-import", index + 1, 0, statements.length);
    await importMigration(migration.name, migration.sql);
    await progress("record-migration", index + 1);
    if (
      !(await db
        .prepare("SELECT name FROM d1_migrations WHERE name=?")
        .bind(migration.name)
        .first())
    )
      throw new Error("DRILL_MIGRATION_RECEIPT_MISMATCH");
    confirmedStatements += statements.length;
    confirmedMigrations++;
  }
  await progress("verify-ledger");
  const actual = (
    await db.prepare("SELECT name FROM d1_migrations ORDER BY id").all<{ name: string }>()
  ).results;
  if (
    JSON.stringify(actual.map((row) => row.name)) !== JSON.stringify(migrations.map((m) => m.name))
  )
    throw new Error("DRILL_MIGRATION_RECEIPT_MISMATCH");
  await progress("complete");
}

export async function seedDrillFixture(db: D1Database, now: number) {
  // Independent ephemeral key and synthetic SQL sessions, never an OAuth login or key recovery claim.
  const cipher = await createCaseDataCipher({
    CASE_DATA_KEY_V1: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url"),
  });
  const at = new Date(now).toISOString();
  const plaintext = "isolated synthetic recovery fixture";
  const createOwner = () => ({
    owner: crypto.randomUUID(),
    session: crypto.randomUUID(),
    caseId: crypto.randomUUID(),
    analysis: crypto.randomUUID(),
  });
  const target = createOwner(),
    control = createOwner();
  const owners = [target, control];
  for (const [index, owner] of owners.entries()) {
    const ciphertext = await cipher.encrypt(plaintext, {
      table: "cases",
      column: "encrypted_input",
      rowId: owner.caseId,
      userId: owner.owner,
    });
    await db.batch([
      db
        .prepare(
          "INSERT INTO user(id,name,email,created_at,updated_at) VALUES(?,'Synthetic recovery owner',?,?,?)",
        )
        .bind(owner.owner, `${owner.owner}@example.invalid`, now, now),
      db
        .prepare(
          "INSERT INTO session(id,user_id,token,created_at,updated_at,expires_at,oauth_authenticated_at) VALUES(?,?,?,?,?,?,?)",
        )
        .bind(owner.session, owner.owner, crypto.randomUUID(), now, now, now + 3_600_000, now),
      db
        .prepare("INSERT INTO app_metadata(key,value) VALUES(?,'customer')")
        .bind(`account-type:${owner.owner}`),
      db
        .prepare(
          "INSERT INTO cases(id,user_id,status,encrypted_input,created_at,updated_at) VALUES(?,?,'queued',?,?,?)",
        )
        .bind(owner.caseId, owner.owner, ciphertext, at, at),
      db
        .prepare(
          "INSERT INTO analyses(id,case_id,workflow_instance_id,input_revision,status,created_at,updated_at) VALUES(?,?,?,1,'queued',?,?)",
        )
        .bind(owner.analysis, owner.caseId, `${owner.analysis}-1`, at, at),
    ]);
    if (index === 0)
      await db
        .prepare(
          "INSERT INTO session(id,user_id,token,created_at,updated_at,expires_at,oauth_authenticated_at) VALUES(?,?,?,?,?,?,?)",
        )
        .bind(crypto.randomUUID(), owner.owner, crypto.randomUUID(), now, now, now + 3_600_000, now)
        .run();
  }
  const schemaVersion = await db
    .prepare("SELECT value FROM app_metadata WHERE key='schema_version'")
    .first<string>("value");
  if (!schemaVersion) throw new Error("DRILL_SCHEMA_VERSION_MISSING");
  async function observe(deleted: boolean) {
    const queries = [
      "SELECT count(*) AS n FROM user WHERE id=?",
      "SELECT count(*) AS n FROM session WHERE user_id=?",
      "SELECT count(*) AS n FROM cases WHERE user_id=?",
      "SELECT count(*) AS n FROM analyses WHERE case_id IN (SELECT id FROM cases WHERE user_id=?)",
      "SELECT count(*) AS n FROM app_metadata WHERE key='account-type:'||?",
    ];
    const counts = await db.batch<{ n: number }>([
      ...queries.map((sql) => db.prepare(sql).bind(target.owner)),
      ...queries.map((sql) => db.prepare(sql).bind(control.owner)),
    ]);
    const actual = counts.map((r) => r.results[0]?.n);
    const expected = [...(deleted ? [0, 0, 0, 0, 0] : [1, 2, 1, 1, 1]), 1, 1, 1, 1, 1];
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error("DRILL_OWNER_STATE_MISMATCH");
    const foreignKeys = await db.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeys.results.length) throw new Error("DRILL_FOREIGN_KEY_VIOLATIONS");
    if (
      (await db
        .prepare("SELECT value FROM app_metadata WHERE key='schema_version'")
        .first("value")) !== schemaVersion
    )
      throw new Error("DRILL_SCHEMA_CHANGED");
    const rows = await db
      .prepare("SELECT encrypted_input FROM cases WHERE id=? AND user_id=?")
      .bind(control.caseId, control.owner)
      .first<{ encrypted_input: string }>();
    if (
      !rows ||
      (await cipher.decrypt(rows.encrypted_input, {
        table: "cases",
        column: "encrypted_input",
        rowId: control.caseId,
        userId: control.owner,
      })) !== plaintext
    )
      throw new Error("DRILL_CONTROL_DECRYPT_FAILED");
    const journalCount = await db
      .prepare("SELECT count(*) AS n FROM deletion_jobs")
      .first<number>("n");
    const pending = await db
      .prepare(
        "SELECT count(*) AS n FROM deletion_jobs WHERE target_type='account' AND target_id=? AND primary_state='deleted' AND cleanup_state='pending' AND attempts=0",
      )
      .bind(target.owner)
      .first<number>("n");
    if (journalCount !== (deleted ? 1 : 0) || pending !== (deleted ? 1 : 0))
      throw new Error("DRILL_JOURNAL_STATE_MISMATCH");
    return {
      target: actual.slice(0, 5),
      control: actual.slice(5),
      foreignKeyViolations: 0,
      journalCount,
      pendingCleanup: pending,
      controlDecrypt: "verified",
      schemaVersion,
    };
  }
  async function exportJournal() {
    const rows = (
      await db
        .prepare(
          "SELECT id,target_type,target_id,deleted_at,workflow_instance_ids,expires_at FROM deletion_jobs WHERE primary_state='deleted' ORDER BY id",
        )
        .all<Record<string, unknown>>()
    ).results;
    const journal = deletionJournalSchema.parse(
      rows.map((r) => ({
        ...r,
        workflow_instance_ids: JSON.parse(String(r.workflow_instance_ids)),
      })),
    );
    if (
      journal.length !== 1 ||
      journal[0]?.target_type !== "account" ||
      journal[0]?.target_id !== target.owner ||
      JSON.stringify(journal[0]?.workflow_instance_ids) !== JSON.stringify([`${target.analysis}-1`])
    )
      throw new Error("DRILL_JOURNAL_EXPORT_MISMATCH");
    return journal;
  }
  return { target, observe, exportJournal };
}
