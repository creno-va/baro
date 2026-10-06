import { afterEach, expect, test } from "bun:test";
import { z } from "zod";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2AccountingRepository } from "../src/server/db/v2-accounting";
import { createV2Core, readSnapshot, snapshotStatements } from "../src/server/db/v2-core";
import { createV2DeletionRepository } from "../src/server/db/v2-deletion";
import { createV2PaidRuntimeRepository } from "../src/server/db/v2-paid-runtime";
import { createV2WorkspaceRepository } from "../src/server/db/v2-workspace";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const NOW = "2026-10-06T00:00:00.000Z",
  HASH = "a".repeat(64);
const dbs: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});
async function fixture() {
  const db = await createTestDatabase({ throughMigration: "0006_v2_domain_foundation" });
  dbs.push(db);
  const session = await seedTestSession(db, { now: Date.parse(NOW), consent: true });
  const cipher = await createCaseDataCipher({
    CASE_DATA_KEY_V1: btoa("r".repeat(32)).replace(/=+$/u, ""),
  });
  const core = createV2Core(db.binding, cipher),
    actor = { ownerId: session.userId, now: NOW };
  const workspace = createV2WorkspaceRepository(db.binding, cipher),
    workspaceId = crypto.randomUUID();
  expect(
    (
      await workspace.create(
        actor,
        workspaceId,
        {
          narrative: "합성 기존 사건의 온전한 자료와 사용자 서술 😀 원문",
          subjectContext: "company",
          jurisdiction: "KR",
          turnstileToken: "synthetic",
        },
        { operationId: crypto.randomUUID(), key: crypto.randomUUID(), requestHash: HASH },
      )
    ).kind,
  ).toBe("created");
  const accounting = createV2AccountingRepository(core, "preview");
  await accounting.ensurePrincipal(actor);
  db.sqlite
    .query(
      "INSERT INTO v2_monthly_budget(month,allocation_version,environment,limit_krw,ambiguous_krw) VALUES('2026-10',1,'preview',10000,123)",
    )
    .run();
  const quote = crypto.randomUUID(),
    attempt = crypto.randomUUID();
  db.sqlite
    .query(
      "INSERT INTO v2_cost_quotes(id,version,provider_pricing_version,exchange_rate,safety_margin,reviewed_at,valid_until,estimated_krw) VALUES(?,1,'legacy-price',1234.567,1.234,?,'2026-11-01T00:00:00.000Z',123)",
    )
    .run(quote, NOW);
  const principal = db.sqlite
    .query("SELECT id FROM v2_billing_principals WHERE owner_id=?")
    .get(actor.ownerId) as { id: string };
  db.sqlite
    .query(
      "INSERT INTO v2_cost_attempts(id,principal_id,operation_id,invocation_id,attempt,month,quote_id,service,state,reserved_krw,created_at) VALUES(?,?,?,?,1,'2026-10',?,'model','ambiguous',123,?)",
    )
    .run(attempt, principal.id, crypto.randomUUID(), crypto.randomUUID(), quote, NOW);
  const snapshotId = crypto.randomUUID(),
    targetId = crypto.randomUUID(),
    claimId = crypto.randomUUID();
  const value = { name: "보존 원문 😀", entries: ["다른 Unicode", "unchanged"] };
  db.sqlite
    .query("INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) VALUES(?,?,?,1)")
    .run(claimId, actor.ownerId, workspaceId);
  await db.binding.batch(
    await snapshotStatements(
      core,
      {
        id: snapshotId,
        ownerId: actor.ownerId,
        workspaceId,
        purpose: "file_coverage",
        targetId,
        revision: 1,
        now: NOW,
      },
      value,
      claimId,
    ),
  );
  db.sqlite.query("DELETE FROM v2_mutation_claims WHERE id=?").run(claimId);
  return { db, core, cipher, actor, workspace, workspaceId, snapshotId, targetId, value, attempt };
}
const shape = z.strictObject({ name: z.string(), entries: z.array(z.string()) });
test("populated 0006→0007 preserves all 82 old table rows and ciphertext bytes, auth and immutable snapshots", async () => {
  const f = await fixture();
  const tables = (
    f.db.sqlite
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='__drizzle_migrations' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map((row) => row.name);
  expect(tables).toHaveLength(82);
  const rows = new Map(
    tables
      .filter((t) => t !== "app_metadata")
      .map((t) => [t, f.db.sqlite.query(`SELECT * FROM "${t}" ORDER BY rowid`).all()]),
  );
  f.db.sqlite.exec(await Bun.file("drizzle/0007_runtime_paid_execution.sql").text());
  for (const [table, original] of rows)
    expect(f.db.sqlite.query(`SELECT * FROM "${table}" ORDER BY rowid`).all()).toEqual(original);
  expect(
    f.db.sqlite.query("SELECT value FROM app_metadata WHERE key='schema_version'").get(),
  ).toEqual({ value: "0007_runtime_paid_execution" });
  expect((await f.workspace.readIntake(f.actor, f.workspaceId))?.narrative).toBe(
    "합성 기존 사건의 온전한 자료와 사용자 서술 😀 원문",
  );
  expect(
    await readSnapshot(f.core, f.actor, f.snapshotId, "file_coverage", f.targetId, 1, shape),
  ).toEqual(f.value);
  expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});
test("upgraded retained ambiguity prevents paid execution without authenticated proofs; deletion preserves financial exposure", async () => {
  const f = await fixture();
  f.db.sqlite.exec(await Bun.file("drizzle/0007_runtime_paid_execution.sql").text());
  const runtime = createV2PaidRuntimeRepository(f.core, "preview");
  expect(await runtime.initializeControl("2026-10", NOW)).toBe(true);
  expect((await runtime.exposure(NOW))?.phase).toBe("frozen");
  expect((await runtime.exposure(NOW))?.ambiguous_krw).toBe(123);
  expect(
    await createV2DeletionRepository(f.core).workspace({
      ...f.actor,
      workspaceId: f.workspaceId,
      expectedRevision: 1,
    }),
  ).toBe(true);
  expect(
    await readSnapshot(f.core, f.actor, f.snapshotId, "file_coverage", f.targetId, 1, shape),
  ).toBeNull();
  expect(
    f.db.sqlite.query("SELECT state,reserved_krw FROM v2_cost_attempts WHERE id=?").get(f.attempt),
  ).toEqual({ state: "ambiguous", reserved_krw: 123 });
  expect((await runtime.exposure(NOW))?.ambiguous_krw).toBe(123);
  expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
});
