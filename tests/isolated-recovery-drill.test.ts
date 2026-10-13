import { Database, type SQLQueryBindings } from "bun:sqlite";
import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DrillCommandError, type runDrillWrangler } from "../scripts/isolated-drill-process";
import {
  type DrillEvidence,
  type DrillStorage,
  privateDrillStorage,
  runRecoveryDrill,
} from "../scripts/isolated-recovery-drill";
import { loadDrillMigrations } from "../scripts/isolated-recovery-drill-fixture";
import {
  configuredDatabases,
  DRILL_ACCOUNT,
  DRILL_CLEANUP_MS,
  DRILL_WORK_MS,
  type DrillPlan,
  drillPlanSchema,
  IsolatedD1,
} from "../scripts/isolated-recovery-drill-platform";

const plan: DrillPlan = {
  candidateSha: "a".repeat(40),
  runId: "12345678901",
  runAttempt: "1",
  repository: "creno-va/baro",
  ref: "refs/heads/main",
  event: "workflow_dispatch",
  confirmation: "CREATE_AND_RESTORE_SYNTHETIC_D1",
};
const id = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const bookmark = `00000001-00000001-00000001-${"a".repeat(32)}`;
const protectedDatabases = configuredDatabases(await Bun.file("wrangler.jsonc").json());
const migrations = await loadDrillMigrations();

// Only the HTTP platform boundary is synthetic. Migrations, SQL/FKs/triggers,
// deleteAccount, encrypted fixture and journal validation/replay are the real implementation.
function cloud(
  options: {
    existing?: boolean;
    createId?: string;
    wrongReadback?: boolean;
    noRestore?: boolean;
    createTimeout?: boolean;
    restoreTimeout?: boolean;
    deleteDenied?: boolean;
    retainedAfterDelete?: boolean;
    failQuery?: boolean;
    failQueryAt?: number;
    invalidQueryResult?: boolean;
    failImportAt?: number;
    lostImportResponse?: boolean;
    noImport?: boolean;
  } = {},
) {
  let sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  let exists = options.existing ?? false;
  let snapshot: Uint8Array | undefined;
  let queryCount = 0;
  let importCount = 0;
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const name = `baro-drill-d1-${plan.runId}`;
  const metadata = () => ({ uuid: options.createId ?? id, name, version: "production" });
  const ok = (result: unknown) => Response.json({ success: true, result });
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)),
      method = init?.method ?? "GET";
    const base = `/client/v4/accounts/${DRILL_ACCOUNT}/d1/database`;
    expect(url.origin).toBe("https://api.cloudflare.com");
    expect(url.pathname.startsWith(base)).toBe(true);
    expect(init?.redirect).toBe("error");
    const path = url.pathname.slice(base.length);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    if (path === "" && method === "GET") {
      expect(url.searchParams.get("name")).toBe(name);
      return ok(exists ? [metadata()] : []);
    }
    if (path === "" && method === "POST") {
      expect(body).toEqual({ name });
      exists = true;
      if (options.createTimeout) throw new Error("sensitive transport diagnostic");
      return ok(metadata());
    }
    if (path === `/${id}` && method === "GET")
      return ok({ ...metadata(), ...(options.wrongReadback ? { uuid: otherId } : {}) });
    if (path === `/${id}/query` && method === "POST") {
      queryCount++;
      if (options.failQuery || queryCount === options.failQueryAt) {
        if (options.invalidQueryResult) return ok([]);
        return Response.json(
          { success: false, errors: [{ message: "secret SQL/row diagnostic" }] },
          { status: 403 },
        );
      }
      const batch = body.batch as { sql: string; params: SQLQueryBindings[] }[];
      const results = sqlite.transaction(() =>
        batch.map(({ sql, params }) => {
          const before = sqlite.query("SELECT total_changes() AS n").get() as { n: number };
          const results = sqlite.query(sql).all(...params);
          const after = sqlite.query("SELECT total_changes() AS n").get() as { n: number };
          return { success: true, results, meta: { changes: after.n - before.n } };
        }),
      )();
      return ok(results);
    }
    if (path === `/${id}/time_travel/bookmark` && method === "GET") {
      snapshot = sqlite.serialize();
      return ok({ bookmark });
    }
    if (path === `/${id}/time_travel/restore` && method === "POST") {
      expect(url.searchParams.get("bookmark")).toBe(bookmark);
      if (!snapshot) throw new Error("fixture snapshot missing");
      if (!options.noRestore) {
        sqlite.close();
        sqlite = Database.deserialize(snapshot);
        sqlite.exec("PRAGMA foreign_keys=ON");
      }
      if (options.restoreTimeout) throw new Error("restore response was lost after mutation");
      return ok({ bookmark, previous_bookmark: bookmark.replace(/a/g, "b") });
    }
    if (path === `/${id}` && method === "DELETE") {
      if (options.deleteDenied)
        return Response.json(
          { success: false, errors: [{ message: "private provider diagnostic" }] },
          { status: 403 },
        );
      exists = options.retainedAfterDelete ?? false;
      return ok(null);
    }
    throw new Error("unexpected synthetic platform request");
  }) as typeof fetch;
  return {
    fetcher,
    runWrangler: (async (args, timeout, environment) => {
      expect(args.slice(0, 3)).toEqual(["d1", "execute", "DRILL_DB"]);
      expect(args).toContain("--remote");
      expect(timeout).toBeGreaterThan(0);
      expect(timeout).toBeLessThanOrEqual(90_000);
      expect(environment?.CLOUDFLARE_ACCOUNT_ID).toBe(DRILL_ACCOUNT);
      const configPath = args[args.indexOf("--config") + 1] ?? "";
      const sqlPath = args[args.indexOf("--file") + 1] ?? "";
      const config = JSON.parse(await readFile(configPath, "utf8"));
      expect(config.d1_databases).toEqual([
        { binding: "DRILL_DB", database_name: name, database_id: id },
      ]);
      expect((await stat(configPath)).mode & 0o777).toBe(0o600);
      expect((await stat(sqlPath)).mode & 0o777).toBe(0o600);
      const observation = {
        runtime: "node" as const,
        exitCode: 0,
        signal: null,
        timedOut: false,
        durationMs: 1,
        stdoutBytes: 0,
        stderrBytes: 0,
      };
      importCount++;
      calls.push({
        method: "IMPORT",
        path: `/${id}/import`,
        body: { ordinal: importCount, configPath, sqlPath },
      });
      if (options.failImportAt === importCount)
        throw new DrillCommandError("WRANGLER_COMMAND_FAILED", { ...observation, exitCode: 1 });
      const source = await readFile(sqlPath, "utf8");
      if (!options.noImport) sqlite.transaction(() => sqlite.exec(source))();
      if (options.lostImportResponse)
        throw new DrillCommandError("WRANGLER_OUTCOME_UNKNOWN", {
          ...observation,
          exitCode: null,
          signal: "SIGTERM",
        });
      return observation;
    }) satisfies typeof runDrillWrangler,
    calls,
    get exists() {
      return exists;
    },
    close: () => sqlite.close(),
  };
}
function memoryStore(
  change?: (manifest: unknown, read: number) => unknown,
): DrillStorage & { reports: DrillEvidence[]; journal: unknown } {
  let reads = 0;
  return {
    journal: null,
    reports: [],
    async writeJournal(manifest) {
      this.journal = structuredClone(manifest);
    },
    async readJournal() {
      return change
        ? change(structuredClone(this.journal), ++reads)
        : structuredClone(this.journal);
    },
    async writeEvidence(report) {
      this.reports.push(structuredClone(report));
    },
  };
}
async function execute(options: Parameters<typeof cloud>[0] = {}, storage = memoryStore()) {
  const fixture = cloud(options);
  const platform = new IsolatedD1(
    plan,
    "synthetic-test-token",
    protectedDatabases,
    fixture.fetcher,
    undefined,
    fixture.runWrangler,
  );
  try {
    const report = await runRecoveryDrill(plan, platform, storage, migrations);
    return { report, calls: fixture.calls, storage, exists: fixture.exists, platform };
  } finally {
    fixture.close();
  }
}

test("only a first manual main run in the trusted repo with explicit scope and immutable SHA can run", () => {
  for (const override of [
    { candidateSha: "main" },
    { ref: "refs/heads/feature" },
    { repository: "fork/baro" },
    { event: "pull_request" },
    { runAttempt: "2" },
    { confirmation: "true" },
    { runId: "../preview" },
    { databaseId: id },
  ])
    expect(() => drillPlanSchema.parse({ ...plan, ...override })).toThrow();
  expect(drillPlanSchema.parse(plan)).toEqual(plan);
  expect(() => new IsolatedD1(plan, "", protectedDatabases)).toThrow("DRILL_TOKEN_MISSING");
  expect(() => configuredDatabases({})).toThrow("DRILL_PROTECTED_DATABASES_MISSING");
});

test("configured denylist includes every D1 environment and normalizes UUID case", () => {
  const config = {
    d1_databases: [{ database_id: id, database_name: "baro-preview" }],
    env: {
      future: {
        d1_databases: [
          { database_id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", database_name: "New-Production" },
        ],
      },
    },
  };
  const result = configuredDatabases(config);
  expect([...result.ids]).toContain("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  expect([...result.names]).toContain("new-production");
});

test("real product SQL deletion, snapshot restoration and external journal replay preserve the other encrypted owner", async () => {
  const { report, storage, exists } = await execute();
  expect(report.status).toBe("success");
  expect(report.cleanup).toBe("confirmed-absent");
  expect(exists).toBe(false);
  expect(report.steps.map((s) => s.name)).toEqual([
    "created-and-identity-verified",
    "schema-installed",
    "baseline-observed",
    "bookmark-captured",
    "account-deletion-observed",
    "external-journal-verified",
    "bookmark-restore-observed",
    "journal-replay-observed",
    "repeat-replay-observed",
    "database-cleanup-observed",
  ]);
  expect(
    report.steps.find((s) => s.name === "bookmark-restore-observed")?.observations.target,
  ).toEqual([1, 2, 1, 1, 1]);
  expect(
    report.steps.find((s) => s.name === "journal-replay-observed")?.observations.target,
  ).toEqual([0, 0, 0, 0, 0]);
  expect(
    report.steps.find((s) => s.name === "repeat-replay-observed")?.observations.pendingCleanup,
  ).toBe(1);
  expect(report.unverified).toContain("full-release-acceptance");
  const evidence = JSON.stringify(storage.reports);
  for (const secret of [
    "synthetic-test-token",
    "example.invalid",
    "workflow_instance_ids",
    "encrypted_input",
    "target_id",
    bookmark,
    "isolated synthetic recovery fixture",
  ])
    expect(evidence).not.toContain(secret);
});

test("interrupted intermediate evidence cannot claim success before cleanup and the terminal timestamp", async () => {
  const { storage } = await execute();
  const successes = storage.reports.filter((report) => report.status === "success");
  expect(successes).toHaveLength(1);
  expect(successes[0]?.cleanup).toBe("confirmed-absent");
  expect(successes[0]?.finishedAt).not.toBeNull();
  expect(storage.reports.slice(0, -1).every((report) => report.status === "running")).toBe(true);
});

test("prior drill DBs are not adopted; protected IDs (including uppercase) never reach data or delete endpoints", async () => {
  const existing = await execute({ existing: true });
  expect(existing.report.status).toBe("failure");
  expect(existing.report.errorCode).toBe("DRILL_DATABASE_ALREADY_EXISTS");
  expect(existing.calls.every((c) => c.method === "GET")).toBe(true);
  for (const createId of [
    "e8cdcf75-5bd8-469e-848e-f31816df4327",
    "D315E93F-2FAC-4CC2-BF99-E9D6EB31523F",
  ]) {
    const r = await execute({ createId });
    expect(r.report.status).toBe("failure");
    expect(r.report.cleanup).toBe("unconfirmed");
    expect(r.calls.every((c) => c.path === "")).toBe(true);
  }
});

test("metadata read-back mismatch stops SQL and cleanup without accepting another identity", async () => {
  const r = await execute({ wrongReadback: true });
  expect(r.report.status).toBe("failure");
  expect(r.report.errorCode).toBe("DRILL_RESOURCE_IDENTITY_CHANGED");
  expect(r.report.cleanup).toBe("unconfirmed");
  expect(r.calls.some((c) => c.path.endsWith("/query") || c.method === "DELETE")).toBe(false);
});

test("a newly configured protected ID cannot be adopted even with an allowed name", async () => {
  const fixture = cloud();
  try {
    const protectedScope = {
      ids: new Set([...protectedDatabases.ids, id]),
      names: protectedDatabases.names,
    };
    const platform = new IsolatedD1(plan, "synthetic-test-token", protectedScope, fixture.fetcher);
    await expect(platform.create()).rejects.toThrow("DRILL_PROTECTED_RESOURCE");
    expect(fixture.calls.every((c) => c.path === "")).toBe(true);
  } finally {
    fixture.close();
  }
});

test("identity is checked again before SQL, file import, restore and deletion after a valid creation", async () => {
  const fixture = cloud();
  let changed = false;
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    if (changed && String(url).endsWith(`/${id}`) && init?.method === "GET")
      return Response.json({
        success: true,
        result: { uuid: id, name: "baro-preview", version: "production" },
      });
    return fixture.fetcher(url, init);
  }) as typeof fetch;
  try {
    const platform = new IsolatedD1(
      plan,
      "synthetic-test-token",
      protectedDatabases,
      fetcher,
      undefined,
      fixture.runWrangler,
    );
    await platform.create();
    await platform.captureBookmark();
    changed = true;
    await expect(platform.database().prepare("SELECT 1").run()).rejects.toThrow();
    await expect(platform.importMigration("0000_test.sql", "SELECT 1;")).rejects.toThrow();
    await expect(platform.restore()).rejects.toThrow();
    await expect(platform.destroy()).rejects.toThrow();
    expect(
      fixture.calls.some(
        (c) =>
          c.path.endsWith("/query") ||
          c.path.endsWith("/restore") ||
          c.method === "DELETE" ||
          c.method === "IMPORT",
      ),
    ).toBe(false);
  } finally {
    fixture.close();
  }
});

test("a successful restore API response that did not restore rows cannot pass", async () => {
  const r = await execute({ noRestore: true });
  expect(r.report.status).toBe("failure");
  expect(r.report.errorCode).toBe("DRILL_OWNER_STATE_MISMATCH");
  expect(r.report.stage).toBe("time-travel-restore");
  expect(r.report.steps.some((s) => s.name === "journal-replay-observed")).toBe(false);
});

test("missing, stale, tampered or different-scope external journals stop before destructive restore", async () => {
  for (const change of [
    () => null,
    (m: unknown) => ({ ...(m as object), candidateSha: "b".repeat(40) }),
    (m: unknown) => ({ ...(m as object), exportedAt: "2000-01-01T00:00:00.000Z" }),
    (m: unknown) => ({ ...(m as object), journal: [] }),
  ]) {
    const r = await execute({}, memoryStore(change));
    expect(r.report.status).toBe("failure");
    expect(r.report.stage).toBe("journal-export");
    expect(r.calls.some((c) => c.path.endsWith("/restore"))).toBe(false);
  }
});

test("journal corruption after restore is detected from the external file and never reported as replay success", async () => {
  const r = await execute(
    {},
    memoryStore((m, read) => (read === 1 ? m : null)),
  );
  expect(r.report.status).toBe("failure");
  expect(r.report.steps.some((s) => s.name === "bookmark-restore-observed")).toBe(true);
  expect(r.report.steps.some((s) => s.name === "journal-replay-observed")).toBe(false);
});

test("unknown create and restore mutations are not blindly retried", async () => {
  const created = await execute({ createTimeout: true });
  expect(created.report.errorCode).toBe("DRILL_API_OUTCOME_UNKNOWN");
  expect(created.report.databaseId).toBeNull();
  expect(created.report.creationAttempted).toBe(true);
  expect(created.report.cleanup).toBe("unconfirmed");
  expect(created.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  await expect(created.platform.create()).rejects.toThrow("DRILL_CREATE_ALREADY_ATTEMPTED");
  const restored = await execute({ restoreTimeout: true });
  expect(restored.report.status).toBe("failure");
  expect(restored.calls.filter((c) => c.path.endsWith("/restore"))).toHaveLength(1);
  await expect(restored.platform.restore()).rejects.toThrow("DRILL_RESTORE_NOT_ALLOWED");
});

test("SQL errors and unconfirmed cleanup preserve failure and redact upstream diagnostics", async () => {
  for (const options of [
    { failQuery: true },
    { deleteDenied: true },
    { retainedAfterDelete: true },
  ]) {
    const r = await execute(options);
    expect(r.report.status).toBe("failure");
    if (!options.failQuery) expect(r.report.cleanup).toBe("unconfirmed");
    expect(JSON.stringify(r.storage.reports)).not.toMatch(/secret SQL|private provider|diagnostic/);
  }
});

test("file import failure identifies the last migration without replaying partial or unknown mutations", async () => {
  const failed = await execute({ failImportAt: 10 });
  expect(failed.report).toMatchObject({
    status: "failure",
    stage: "schema-install",
    errorCode: "WRANGLER_COMMAND_FAILED",
    cleanup: "confirmed-absent",
    schemaProgress: {
      phase: "migration-import",
      migrationOrdinal: 10,
      migrationCount: 10,
      statementOffset: 0,
      statementCount: 17,
      confirmedStatements: 322,
      confirmedMigrations: 9,
    },
    lastImport: { runtime: "node", exitCode: 1, signal: null },
  });
  expect(failed.calls.filter((call) => call.method === "IMPORT")).toHaveLength(10);
  const lost = await execute({ lostImportResponse: true });
  expect(lost.report).toMatchObject({
    status: "failure",
    errorCode: "WRANGLER_OUTCOME_UNKNOWN",
    cleanup: "confirmed-absent",
    schemaProgress: { phase: "migration-import", confirmedMigrations: 0 },
    lastImport: { runtime: "node", exitCode: null, signal: "SIGTERM" },
  });
  expect(lost.calls.filter((call) => call.method === "IMPORT")).toHaveLength(1);
  for (const result of [failed, lost]) {
    expect(result.calls.some((call) => call.path.endsWith("/restore"))).toBe(false);
    for (const call of result.calls.filter((call) => call.method === "IMPORT")) {
      const paths = call.body as { configPath: string; sqlPath: string };
      expect(await Bun.file(paths.configPath).exists()).toBe(false);
      expect(await Bun.file(paths.sqlPath).exists()).toBe(false);
    }
    expect(JSON.stringify(result.storage.reports)).not.toMatch(
      /synthetic-test-token|CREATE TABLE|SELECT |migration.sql|wrangler.json/,
    );
  }
});

test("exit0 without an independently observed migration ledger cannot pass schema installation", async () => {
  const result = await execute({ noImport: true });
  expect(result.report).toMatchObject({
    status: "failure",
    stage: "schema-install",
    errorCode: "DRILL_MIGRATION_RECEIPT_MISMATCH",
    cleanup: "confirmed-absent",
    lastImport: { exitCode: 0 },
    schemaProgress: { phase: "record-migration", confirmedMigrations: 0 },
  });
  expect(result.calls.filter((call) => call.method === "IMPORT")).toHaveLength(1);
  expect(result.calls.some((call) => call.path.endsWith("/restore"))).toBe(false);
});

test("schema receipts identify the confirmed prefix and rejected ledger response without SQL or retry", async () => {
  for (const invalidQueryResult of [false, true]) {
    // Six migrations are confirmed; the seventh import's ledger read is rejected.
    const r = await execute({ failQueryAt: 8, invalidQueryResult });
    expect(r.report.status).toBe("failure");
    expect(r.report.stage).toBe("schema-install");
    expect(r.report.errorCode).toBe(
      invalidQueryResult ? "AI_RUNTIME_D1_INVALID_RESPONSE" : "AI_RUNTIME_D1_UNAVAILABLE",
    );
    expect(r.report.schemaProgress).toEqual({
      phase: "record-migration",
      migrationOrdinal: 7,
      migrationCount: 10,
      statementOffset: 0,
      statementCount: 0,
      confirmedStatements: 41,
      confirmedMigrations: 6,
    });
    expect(r.calls.filter((c) => c.path.endsWith("/query"))).toHaveLength(8);
    expect(r.calls.some((c) => c.path.endsWith("/restore"))).toBe(false);
    expect(r.report.cleanup).toBe("confirmed-absent");
    expect(
      r.storage.reports.some(
        (report) =>
          report.status === "running" &&
          report.schemaProgress?.phase === "migration-import" &&
          report.schemaProgress?.migrationOrdinal === 7 &&
          report.schemaProgress?.confirmedStatements === 41,
      ),
    ).toBe(true);
    expect(JSON.stringify(r.storage.reports)).not.toMatch(
      /CREATE TABLE|SELECT |secret SQL|diagnostic/,
    );
  }
});

test("initial schema, fixture seeding and baseline observation failures have separate stages", async () => {
  for (const [failQueryAt, stage] of [
    [1, "schema-install"],
    [13, "fixture-seed"],
    [17, "fixture-observe"],
  ] as const) {
    const r = await execute({ failQueryAt });
    expect(r.report.stage).toBe(stage);
    expect(r.report.errorCode).toBe("AI_RUNTIME_D1_UNAVAILABLE");
    expect(r.report.schemaProgress?.phase).toBe(failQueryAt === 1 ? "create-ledger" : "complete");
    expect(r.report.cleanup).toBe("confirmed-absent");
    expect(r.calls.filter((c) => c.path.endsWith("/query"))).toHaveLength(failQueryAt);
  }
});

test("evidence disk failure after creation cannot skip the independent cleanup attempt", async () => {
  const fixture = cloud();
  let writes = 0;
  const storage = memoryStore();
  storage.writeEvidence = async () => {
    if (++writes > 1) throw new Error("private disk failure");
  };
  try {
    const platform = new IsolatedD1(
      plan,
      "synthetic-test-token",
      protectedDatabases,
      fixture.fetcher,
      undefined,
      fixture.runWrangler,
    );
    await expect(runRecoveryDrill(plan, platform, storage, migrations)).rejects.toThrow();
    expect(fixture.exists).toBe(false);
    expect(fixture.calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
  } finally {
    fixture.close();
  }
});

test("journal files live outside D1 with mode600, cannot be overwritten, and are separate from sanitized evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "baro-drill-test-"));
  try {
    const source = await execute();
    const storage = await privateDrillStorage(directory, join(directory, "evidence.json"));
    await storage.writeJournal(
      source.storage.journal as Parameters<DrillStorage["writeJournal"]>[0],
    );
    await storage.writeEvidence(source.report);
    expect((await stat(join(directory, "latest-journal.json"))).mode & 0o777).toBe(0o600);
    expect(await storage.readJournal()).toEqual(source.storage.journal);
    await expect(
      storage.writeJournal(source.storage.journal as Parameters<DrillStorage["writeJournal"]>[0]),
    ).rejects.toThrow();
    expect(await readFile(join(directory, "evidence.json"), "utf8")).not.toContain("target_id");
    await chmod(join(directory, "latest-journal.json"), 0o644);
    await expect(storage.readJournal()).rejects.toThrow("DRILL_PRIVATE_JOURNAL_INVALID");
    await chmod(join(directory, "latest-journal.json"), 0o600);
    await writeFile(join(directory, "latest-journal.json"), "corrupt");
    await expect(storage.readJournal()).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the overall work deadline stops new SQL while preserving a separate cleanup window", async () => {
  const fixture = cloud();
  let clock = 0;
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const response = await fixture.fetcher(url, init);
    if (String(url).endsWith("/query")) clock = DRILL_WORK_MS;
    return response;
  }) as typeof fetch;
  try {
    const platform = new IsolatedD1(
      plan,
      "synthetic-test-token",
      protectedDatabases,
      fetcher,
      () => clock,
      fixture.runWrangler,
    );
    const report = await runRecoveryDrill(plan, platform, memoryStore(), migrations);
    expect(report.status).toBe("failure");
    expect(report.errorCode).toBe("DRILL_WORK_DEADLINE_EXCEEDED");
    expect(report.cleanup).toBe("confirmed-absent");
    expect(fixture.calls.filter((c) => c.path.endsWith("/query"))).toHaveLength(1);
    expect(fixture.calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
  } finally {
    fixture.close();
  }
});

test("cleanup has its own deadline and cannot claim absence after exhausting it", async () => {
  const fixture = cloud();
  let clock = 0;
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const response = await fixture.fetcher(url, init);
    if (String(url).endsWith("/query")) clock = DRILL_WORK_MS;
    else if (clock >= DRILL_WORK_MS) clock += DRILL_CLEANUP_MS;
    return response;
  }) as typeof fetch;
  try {
    const platform = new IsolatedD1(
      plan,
      "synthetic-test-token",
      protectedDatabases,
      fetcher,
      () => clock,
      fixture.runWrangler,
    );
    const report = await runRecoveryDrill(plan, platform, memoryStore(), migrations);
    expect(report.status).toBe("failure");
    expect(report.cleanup).toBe("unconfirmed");
    expect(fixture.exists).toBe(true);
    expect(fixture.calls.some((c) => c.method === "DELETE")).toBe(false);
  } finally {
    fixture.close();
  }
});

test("an in-flight request uses the remaining overall time instead of another full30seconds", async () => {
  let clock = 0,
    aborted = false;
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const fallback = setTimeout(() => reject(new Error("unbounded request")), 500);
      init?.signal?.addEventListener(
        "abort",
        () => {
          aborted = true;
          clearTimeout(fallback);
          reject(new Error("synthetic abort"));
        },
        { once: true },
      );
    })) as typeof fetch;
  const platform = new IsolatedD1(
    plan,
    "synthetic-test-token",
    protectedDatabases,
    fetcher,
    () => clock,
  );
  clock = DRILL_WORK_MS - 10;
  await expect(platform.create()).rejects.toThrow("DRILL_API_OUTCOME_UNKNOWN");
  expect(aborted).toBe(true);
  expect(platform.creationAttempted).toBe(false);
});

test("drill workflow is manual/main-only, uses existing preview secrets without deployments, and uploads no journal", async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file(".github/workflows/isolated-recovery-drill.yml").text(),
  ) as {
    on: Record<string, unknown>;
    permissions: Record<string, string>;
    concurrency: { "cancel-in-progress": boolean };
    jobs: {
      drill: {
        if: string;
        "timeout-minutes": number;
        environment: unknown;
        steps: {
          uses?: string;
          run?: string;
          env?: Record<string, string>;
          with?: Record<string, unknown>;
          if?: string;
          "timeout-minutes": number;
        }[];
      };
    };
  };
  expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
  expect(workflow.permissions).toEqual({ contents: "read", actions: "read" });
  expect(workflow.concurrency["cancel-in-progress"]).toBe(false);
  expect(workflow.jobs.drill.if).toContain("github.ref == 'refs/heads/main'");
  expect(workflow.jobs.drill.environment).toEqual({ name: "preview", deployment: false });
  for (const s of workflow.jobs.drill.steps)
    if (s.uses) expect(s.uses).toMatch(/^[\w-]+\/[\w-]+@[a-f0-9]{40}$/);
  const runner = workflow.jobs.drill.steps.find(
    (s) => s.run === "bun scripts/isolated-recovery-drill.ts",
  );
  expect(runner?.env).toEqual({
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression
    CLOUDFLARE_API_TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN }}",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression
    DRILL_CONFIRMATION: "${{ inputs.confirmation }}",
  });
  expect(DRILL_WORK_MS + DRILL_CLEANUP_MS).toBeLessThan(
    (runner?.["timeout-minutes"] ?? 0) * 60_000,
  );
  expect(
    workflow.jobs.drill.steps.reduce((sum, step) => sum + step["timeout-minutes"], 0),
  ).toBeLessThan(workflow.jobs.drill["timeout-minutes"]);
  const upload = workflow.jobs.drill.steps.find((s) =>
    s.uses?.startsWith("actions/upload-artifact@"),
  );
  expect(upload?.if).toBe("always()");
  expect(upload?.with?.path).toBe(".wrangler/isolated-recovery-drill/evidence.json");
});
