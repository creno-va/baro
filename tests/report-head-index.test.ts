import type { Database, SQLQueryBindings } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2AccountingRepository } from "../src/server/db/v2-accounting";
import { createV2Core } from "../src/server/db/v2-core";
import { createFilesService } from "../src/server/modules/files/service";
import { readAnalysisScope } from "../src/server/modules/rework/analysis-input";
import { createReworkStateService } from "../src/server/modules/rework/state";
import { createTestDatabase } from "./helpers/d1";
import { r2 } from "./helpers/file-processing-fixture";
import { reportFixture } from "./helpers/report-fixture";
import { seedTestSession } from "./helpers/session";

const INDEX = "v2_reports_workspace_head_idx";
const MIGRATION = "drizzle/0023_report_head_index.sql";
const NOW = "2026-10-06T00:00:00.000Z";
type Captured = { sql: string; values: SQLQueryBindings[] };
type Plan = { id: number; parent: number; detail: string };

async function fixture() {
  const db = await createTestDatabase({ throughMigration: "0022_conversation_rework" });
  try {
    const owner = await seedTestSession(db, { now: Date.parse(NOW), consent: true });
    const cipher = await createCaseDataCipher({
      CASE_DATA_KEY_V1: btoa("k".repeat(32)).replace(/=+$/, ""),
    });
    const core = createV2Core(db.binding, cipher);
    const actor = { ownerId: owner.userId, now: NOW };
    await createV2AccountingRepository(core).ensurePrincipal(actor);
    const workspaceId = crypto.randomUUID();
    const payload = await core.encrypt("v2_workspaces", workspaceId, actor.ownerId, 1, {
      subjectContext: "individual",
      jurisdiction: "KR",
    });
    db.sqlite
      .query(
        "INSERT INTO v2_workspaces(id,owner_id,status,confirmed_summary_revision,encrypted_payload,created_at,updated_at) VALUES(?,?,'active',1,?,?,?)",
      )
      .run(workspaceId, actor.ownerId, payload, NOW, NOW);
    db.sqlite.query("INSERT INTO v2_case_original_usage(workspace_id) VALUES(?)").run(workspaceId);
    const bucket = r2();
    const service = createFilesService(core, {
      environment: "preview",
      bucket: bucket.port,
      clock: () => NOW,
      testOnlyUnmeteredStorage: true,
    });
    const rev = () =>
      (
        db.sqlite.query("SELECT revision FROM v2_workspaces WHERE id=?").get(workspaceId) as {
          revision: number;
        }
      ).revision;
    const f = await reportFixture({ db, core, actor, workspaceId, bucket, service, rev });
    const captured: Captured[] = [];
    const statement = core.statement;
    core.statement = (sql, values = []) => {
      captured.push({ sql, values: values as SQLQueryBindings[] });
      return statement(sql, values);
    };
    const report = await f.reports.get(actor.ownerId, workspaceId);
    await readAnalysisScope(core, actor, workspaceId);
    await createReworkStateService(core, {
      clock: () => NOW,
      peekReport: (ownerId, id) => f.reports.peek(ownerId, id),
    }).getProgress(actor.ownerId, workspaceId);
    core.statement = statement;
    const find = (predicate: (sql: string) => boolean) => {
      const query = captured.find(({ sql }) => predicate(sql));
      if (!query) throw new Error("MISSING_PRODUCT_REPORT_QUERY");
      return query;
    };
    const queries = {
      latest: find((sql) =>
        sql.startsWith("SELECT id,revision FROM v2_reports WHERE workspace_id=?"),
      ),
      scope: find((sql) =>
        sql.startsWith("SELECT r.id,r.workspace_revision,s.id review_id FROM v2_reports"),
      ),
      review: find(
        (sql) => sql.startsWith("SELECT r.*") && sql.includes("AS latest_canonical_revision"),
      ),
      final: find(
        (sql) =>
          sql.startsWith("SELECT w.id FROM v2_workspaces w") &&
          sql.includes("kind='checkpoint' AND entity_id='report-continuation'"),
      ),
    };
    const peer = await seedTestSession(db, { now: Date.parse(NOW), consent: true });
    const otherWorkspace = crypto.randomUUID();
    db.sqlite
      .query(
        "INSERT INTO v2_workspaces(id,owner_id,status,confirmed_summary_revision,encrypted_payload,created_at,updated_at) SELECT ?,?,'active',1,encrypted_payload,created_at,updated_at FROM v2_workspaces WHERE id=?",
      )
      .run(otherWorkspace, peer.userId, workspaceId);
    const emptyWorkspace = crypto.randomUUID();
    db.sqlite
      .query(
        "INSERT INTO v2_workspaces(id,owner_id,status,confirmed_summary_revision,encrypted_payload,created_at,updated_at) SELECT ?,owner_id,'active',1,encrypted_payload,created_at,updated_at FROM v2_workspaces WHERE id=?",
      )
      .run(emptyWorkspace, workspaceId);
    // Deliberately bounded metadata-only candidates. Their cloned body anchors
    // are never accepted as full report bodies; the real seed above exercises
    // AES/snapshot reads separately. These rows test only the captured SQL heads.
    const candidate = (id: string, revision: number, createdAt = NOW, workspace = workspaceId) =>
      db.sqlite
        .query(
          "INSERT INTO v2_reports(id,workspace_id,revision,workspace_revision,summary_revision,snapshot_id,operation_id,state,current_job_id,encrypted_payload,created_at) SELECT ?,?,?,workspace_revision,summary_revision,snapshot_id,operation_id,'queued',current_job_id,encrypted_payload,? FROM v2_reports WHERE id=?",
        )
        .run(id, workspace, revision, createdAt, report.id);
    db.sqlite.transaction(() => {
      for (let index = 0; index < 1000; index++)
        candidate(`other-${String(index).padStart(4, "0")}`, 1000 + index, NOW, otherWorkspace);
    })();
    const apply = async () => {
      const migration = await Bun.file(MIGRATION).text();
      db.sqlite.transaction(() => db.sqlite.exec(migration))();
    };
    return { ...f, owner, peer, otherWorkspace, emptyWorkspace, report, queries, candidate, apply };
  } catch (error) {
    db.close();
    throw error;
  }
}

function rows(db: Database, query: Captured, values = query.values) {
  return db.query(query.sql).all(...values);
}
function plan(db: Database, query: Captured) {
  return db.query(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.values) as Plan[];
}
function digest(value: unknown) {
  return new Bun.CryptoHasher("sha256").update(JSON.stringify(value)).digest("hex");
}
function domainSnapshot(db: Database) {
  const tables = db
    .query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as { name: string }[];
  return Object.fromEntries(
    tables.map(({ name }) => {
      const values = db
        .query(
          `SELECT * FROM "${name.replaceAll('"', '""')}"${name === "app_metadata" ? " WHERE key!='schema_version'" : ""}`,
        )
        .all();
      values.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
      return [name, { count: values.length, digest: digest(values) }];
    }),
  );
}

test("fresh report head index is full, nonunique and ordered by the actual four lookup keys", async () => {
  const db = await createTestDatabase();
  try {
    const list = db.sqlite.query("PRAGMA index_list('v2_reports')").all() as {
      name: string;
      unique: number;
      partial: number;
    }[];
    expect(list.find(({ name }) => name === INDEX)).toMatchObject({ unique: 0, partial: 0 });
    const keys = (
      db.sqlite.query(`PRAGMA index_xinfo('${INDEX}')`).all() as {
        name: string | null;
        desc: number;
        coll: string;
        key: number;
      }[]
    ).filter(({ key }) => key === 1);
    expect(keys.map(({ name, desc, coll }) => ({ name, desc, coll }))).toEqual([
      { name: "workspace_id", desc: 0, coll: "BINARY" },
      { name: "revision", desc: 1, coll: "BINARY" },
      { name: "created_at", desc: 1, coll: "BINARY" },
      { name: "id", desc: 1, coll: "BINARY" },
    ]);
    expect(
      db.sqlite.query("SELECT value FROM app_metadata WHERE key='schema_version'").get(),
    ).toEqual({ value: "0023_report_head_index" });
  } finally {
    db.close();
  }
});

test("upgrade preserves all domain/auth/receipt bytes and decrypts the existing report identically", async () => {
  const f = await fixture();
  try {
    expect(
      (f.db.sqlite.query("PRAGMA index_list('v2_reports')").all() as { name: string }[]).some(
        ({ name }) => name === INDEX,
      ),
    ).toBe(false);
    const readBefore = await f.reports.peek(f.actor.ownerId, f.workspaceId);
    const before = domainSnapshot(f.db.sqlite);
    const beforeQueries = Object.fromEntries(
      Object.entries(f.queries).map(([key, query]) => [key, rows(f.db.sqlite, query)]),
    );
    await f.apply();
    expect(domainSnapshot(f.db.sqlite)).toEqual(before);
    expect(
      Object.fromEntries(
        Object.entries(f.queries).map(([key, query]) => [key, rows(f.db.sqlite, query)]),
      ),
    ).toEqual(beforeQueries);
    expect(await f.reports.peek(f.actor.ownerId, f.workspaceId)).toEqual(readBefore);
    expect(domainSnapshot(f.db.sqlite)).toEqual(before);
    expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(
      f.db.sqlite.query("SELECT value FROM app_metadata WHERE key='schema_version'").get(),
    ).toEqual({ value: "0023_report_head_index" });
  } finally {
    f.db.close();
  }
});

test("actual canonical latest and scope queries retain revision, timestamp, ID ties and export exclusion", async () => {
  const f = await fixture();
  try {
    f.candidate("canonical-lower-revision", 7, "2026-12-31T00:00:00.000Z");
    f.candidate("canonical-earlier-time", 8, "2026-10-05T00:00:00.000Z");
    f.candidate("canonical-tie-a", 8);
    f.candidate("canonical-tie-z", 8);
    f.candidate("export-newest", 9999, "2026-12-31T00:00:00.000Z");
    const expected = [{ id: "canonical-tie-z", revision: 8 }];
    expect(rows(f.db.sqlite, f.queries.latest)).toEqual(expected);
    expect(rows(f.db.sqlite, f.queries.scope)).toMatchObject([{ id: "canonical-tie-z" }]);
    const before = Object.fromEntries(
      Object.entries(f.queries).map(([key, query]) => [key, rows(f.db.sqlite, query)]),
    );
    await f.apply();
    expect(rows(f.db.sqlite, f.queries.latest)).toEqual(expected);
    expect(
      Object.fromEntries(
        Object.entries(f.queries).map(([key, query]) => [key, rows(f.db.sqlite, query)]),
      ),
    ).toEqual(before);
  } finally {
    f.db.close();
  }
});

test("real head queries use the workspace index without a report-order temp sort after upgrade", async () => {
  const f = await fixture();
  try {
    const queries = [f.queries.latest, f.queries.scope, f.queries.review, f.queries.final];
    const before = queries.map((query) => plan(f.db.sqlite, query));
    expect(before[0]?.some(({ detail }) => detail.includes("SCAN v2_reports"))).toBe(true);
    expect(before[0]?.some(({ detail }) => detail.includes("USE TEMP B-TREE FOR ORDER BY"))).toBe(
      true,
    );
    await f.apply();
    for (const query of queries) {
      const details = plan(f.db.sqlite, query);
      const indexedReads = details.filter(
        ({ detail }) => detail.includes(INDEX) && detail.includes("workspace_id=?"),
      );
      expect(indexedReads.length).toBeGreaterThan(0);
      for (const indexed of indexedReads) {
        // The final progress fence also fingerprints files with a different
        // ORDER BY. Do not claim this report index removes that separate sort.
        expect(
          details.filter(
            ({ parent, detail }) =>
              parent === indexed.parent && detail.includes("USE TEMP B-TREE FOR ORDER BY"),
          ),
        ).toEqual([]);
      }
    }
  } finally {
    f.db.close();
  }
});

test("tombstone predicates stay distinct: scope skips a deleted head while the report entry rejects it", async () => {
  const f = await fixture();
  try {
    f.candidate("canonical-live", 7);
    f.candidate("canonical-tombstoned", 8);
    f.db.sqlite
      .query("INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES('report',?,?)")
      .run("canonical-tombstoned", NOW);
    for (const indexed of [false, true]) {
      if (indexed) await f.apply();
      // Preserve the two existing product predicates rather than introducing
      // tombstone filtering into service.latest as part of an index change.
      expect(rows(f.db.sqlite, f.queries.latest)).toEqual([
        { id: "canonical-tombstoned", revision: 8 },
      ]);
      expect(rows(f.db.sqlite, f.queries.scope)).toMatchObject([{ id: "canonical-live" }]);
      expect(rows(f.db.sqlite, f.queries.final)).toEqual([]);
      await expect(f.reports.peek(f.actor.ownerId, f.workspaceId)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    }
  } finally {
    f.db.close();
  }
});

test("foreign owner, absent case and account/workspace tombstones cannot pass indexed source or final fences", async () => {
  const f = await fixture();
  try {
    const checks = () => {
      expect(rows(f.db.sqlite, f.queries.scope, [f.workspaceId, f.peer.userId])).toEqual([]);
      expect(
        rows(f.db.sqlite, f.queries.scope, ["synthetic-missing-case", f.actor.ownerId]),
      ).toEqual([]);
      expect(rows(f.db.sqlite, f.queries.latest, ["synthetic-missing-case"])).toEqual([]);
      expect(rows(f.db.sqlite, f.queries.latest, [f.emptyWorkspace])).toEqual([]);
      expect(rows(f.db.sqlite, f.queries.scope, [f.emptyWorkspace, f.actor.ownerId])).toEqual([]);
    };
    checks();
    expect(await f.reports.peek(f.actor.ownerId, f.emptyWorkspace)).toBeNull();
    await expect(f.reports.peek(f.peer.userId, f.workspaceId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await f.apply();
    checks();
    expect(await f.reports.peek(f.actor.ownerId, f.emptyWorkspace)).toBeNull();
    await expect(f.reports.peek(f.peer.userId, f.workspaceId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    for (const kind of ["workspace", "account"] as const) {
      const target = kind === "workspace" ? f.workspaceId : f.actor.ownerId;
      f.db.sqlite
        .query("INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES(?,?,?)")
        .run(kind, target, NOW);
      expect(rows(f.db.sqlite, f.queries.scope)).toEqual([]);
      expect(rows(f.db.sqlite, f.queries.final)).toEqual([]);
      await expect(f.reports.peek(f.actor.ownerId, f.workspaceId)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      f.db.sqlite
        .query("DELETE FROM v2_tombstones WHERE target_kind=? AND target_id=?")
        .run(kind, target);
    }
  } finally {
    f.db.close();
  }
});
