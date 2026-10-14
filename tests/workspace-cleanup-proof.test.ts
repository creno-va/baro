import { afterEach, expect, test } from "bun:test";
import observation from "../docs/operations/AI-RUNTIME-OBSERVATION.json";
import { modelBounds, observationSchema } from "../scripts/provision-ai-budget";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts/consent";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2DeletionRepository } from "../src/server/db/v2-deletion";
import {
  type CleanupFailureEvent,
  createV2DeletionReconciler,
} from "../src/server/modules/deletion/v2-reconcile";
import { provesWorkspaceOnlyCleanup } from "../src/server/modules/deletion/workspace-cleanup-proof";
import { createFilesService } from "../src/server/modules/files/service";
import { createWorkspaceService } from "../src/server/modules/workspace/service";
import { createWorkspaceDependencies } from "../src/server/runtime/workspace";
import { createTestDatabase } from "./helpers/d1";
import { r2 } from "./helpers/file-processing-fixture";
import { seedTestSession } from "./helpers/session";
import {
  deletedCleanupResult,
  missingCleanupWorkflow as missing,
} from "./helpers/workflow-cleanup";

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
type Row = Record<string, unknown>;
async function fixture(withAnchor = true) {
  const db = await createTestDatabase();
  databases.push(db);
  const owner = await seedTestSession(db, { consent: true });
  const core = createV2Core(
    db.binding,
    await createCaseDataCipher({ CASE_DATA_KEY_V1: btoa("w".repeat(32)).replace(/=+$/, "") }),
    { applicationCostLimitsEnabled: false },
  );
  const env = {
    ...owner.env,
    DB: db.binding,
    APP_ENV: "preview",
    APPLICATION_COST_LIMITS_ENABLED: "false",
    MONTHLY_BUDGET_CAP_ENABLED: "false",
    AI_GATEWAY_ID: "synthetic-cleanup",
    AI_MODEL_TOKEN_BOUNDS_JSON: JSON.stringify(
      modelBounds(observationSchema.parse(observation), "a".repeat(64)),
    ),
    AI: {
      run: async () => {
        throw new Error("synthetic provider must not be called");
      },
    },
    WORKSPACE_PROCESSING: {
      get: async () => {
        throw new Error("synthetic missing");
      },
      create: async (input: { id: string }) => ({ id: input.id }),
    },
  } as unknown as Env;
  const service = createWorkspaceService(core, createWorkspaceDependencies(core, env));
  const workspace = await service.create(owner.userId, crypto.randomUUID(), {
    narrative: "합성 계약 자료의 날짜와 사건 경위를 정리하여 상담을 준비합니다.",
    jurisdiction: "KR",
    subjectContext: "individual",
    turnstileToken: "synthetic",
  });
  if (withAnchor) {
    await createFilesService(core, {
      environment: "preview",
      testOnlyUnmeteredStorage: true,
      bucket: r2().port,
    }).reserve(owner.userId, workspace.id, workspace.workspaceRevision, crypto.randomUUID(), {
      name: "합성 원본.txt",
      byteLength: 10,
      mediaType: "text/plain",
      autoProcessConsentVersion: CURRENT_POLICY_VERSIONS.aiNoticeVersion,
    });
  }
  const current = await service.find(owner.userId, workspace.id);
  const admitted = await service.advance(owner.userId, workspace.id, crypto.randomUUID(), {
    expectedRevision: current.workspaceRevision,
  });
  const job = db.sqlite
    .query("SELECT runtime_instance_id FROM v2_jobs WHERE id=?")
    .get(admitted.jobId) as { runtime_instance_id: string };
  const before = db.sqlite
    .query("SELECT * FROM v2_execution_admissions WHERE runtime_instance_id=?")
    .all(job.runtime_instance_id) as Row[];
  expect(before.length).toBeGreaterThan(0);
  const latest = await service.find(owner.userId, workspace.id);
  expect(
    await createV2DeletionRepository(core).workspace({
      ownerId: owner.userId,
      workspaceId: workspace.id,
      expectedRevision: latest.workspaceRevision,
      now: new Date().toISOString(),
    }),
  ).toBe(true);
  const journal = db.sqlite
    .query(
      "SELECT id,created_at FROM v2_deletion_journals WHERE target_kind='workspace' AND target_id=?",
    )
    .get(workspace.id) as { id: string; created_at: string };
  expect(db.sqlite.query("SELECT id FROM v2_jobs WHERE id=?").get(admitted.jobId)).toBeNull();
  expect(
    db.sqlite
      .query("SELECT * FROM v2_execution_admissions WHERE runtime_instance_id=?")
      .all(job.runtime_instance_id),
  ).toEqual(before);
  let at = new Date(Math.max(Date.now(), Date.parse(journal.created_at)) + 1000).toISOString();
  return {
    db,
    core,
    owner,
    workspace,
    jobId: admitted.jobId,
    runtimeId: job.runtime_instance_id,
    journal,
    before,
    clock: () => at,
    advance: () => {
      at = new Date(Date.parse(at) + 61000).toISOString();
    },
  };
}
async function leased(f: Awaited<ReturnType<typeof fixture>>) {
  const lease = await createV2DeletionRepository(f.core).acquire(
    f.journal.id,
    crypto.randomUUID(),
    f.clock(),
    new Date(Date.parse(f.clock()) + 60000).toISOString(),
  );
  if (!lease) throw new Error("synthetic lease missing");
  return lease;
}
function faultCore(f: Awaited<ReturnType<typeof fixture>>, alter: (rows: Row[]) => Row[]) {
  return createV2Core(
    {
      ...f.db.binding,
      prepare(sql: string) {
        const prepared = f.db.binding.prepare(sql);
        return {
          ...prepared,
          bind(...values: unknown[]) {
            const statement = prepared.bind(...values);
            return {
              ...statement,
              async all() {
                const result = await statement.all<Row>();
                return sql.includes("FROM v2_execution_admissions a")
                  ? { ...result, results: alter(structuredClone(result.results)) }
                  : result;
              },
            };
          },
        };
      },
    } as D1Database,
    f.core.cipher,
    { applicationCostLimitsEnabled: false },
  );
}

for (const failure of ["later namespace", "lost delete response"] as const)
  test(`actual admission and deletion capture recover a workspace after deletion and ${failure}`, async () => {
    const f = await fixture();
    let present = true,
      failProfile = true,
      deletes = 0;
    const events: CleanupFailureEvent[] = [];
    const runner = createV2DeletionReconciler(f.core, {
      environment: "preview",
      clock: f.clock,
      testOnlyUnmeteredStorage: true,
      workflows: [
        missing,
        missing,
        {
          deleteBatch: async (ids: string[]) => {
            if (!present) return missing.deleteBatch(ids);
            present = false;
            deletes++;
            if (failure === "lost delete response") throw new Error("synthetic lost receipt");
            return deletedCleanupResult(ids);
          },
        },
        {
          deleteBatch: async (ids: string[]) => {
            if (failProfile && failure === "later namespace")
              throw new Error("synthetic namespace transport");
            return missing.deleteBatch(ids);
          },
        },
      ],
      onFailure: (event) => events.push(event),
    });
    await runner.run();
    expect(deletes).toBe(1);
    expect(
      events.some(
        (event) => event.namespace === (failure === "later namespace" ? "profile" : "workspace"),
      ),
    ).toBe(true);
    expect(
      f.db.sqlite
        .query(
          "SELECT state FROM v2_deletion_targets WHERE journal_id=? AND kind='job' AND target_id=?",
        )
        .get(f.journal.id, f.runtimeId),
    ).toEqual({ state: "pending" });
    expect(
      f.db.sqlite
        .query("SELECT count(*) n FROM v2_cleanup_receipts WHERE journal_id=? AND kind='job'")
        .get(f.journal.id),
    ).toEqual({ n: 0 });
    failProfile = false;
    f.advance();
    await runner.run();
    expect(
      f.db.sqlite
        .query(
          "SELECT state FROM v2_deletion_targets WHERE journal_id=? AND kind='job' AND target_id=?",
        )
        .get(f.journal.id, f.runtimeId),
    ).toEqual({ state: "completed" });
    expect(
      f.db.sqlite
        .query(
          "SELECT count(*) n FROM v2_cleanup_receipts WHERE journal_id=? AND kind='job' AND target_id=?",
        )
        .get(f.journal.id, f.runtimeId),
    ).toEqual({ n: 1 });
    expect(
      f.db.sqlite
        .query("SELECT * FROM v2_execution_admissions WHERE runtime_instance_id=?")
        .all(f.runtimeId),
    ).toEqual(f.before);
  });

test("historical evidence survives its execution deadline without treating it as a new execution permit", async () => {
  const f = await fixture();
  const deadline = Math.max(...f.before.map((row) => Date.parse(String(row.deadline_at))));
  while (Date.parse(f.clock()) <= deadline) f.advance();
  const lease = await leased(f);
  expect(Date.parse(f.clock())).toBeGreaterThan(deadline);
  expect(await provesWorkspaceOnlyCleanup(f.core, lease, f.runtimeId, "preview", f.clock)).toBe(
    true,
  );
});

for (const [name, alter] of [
  ["forged digest", (r: Row) => ({ ...r, digest: "0".repeat(64) })],
  ["foreign owner", (r: Row) => ({ ...r, owner_id: crypto.randomUUID() })],
  ["foreign principal", (r: Row) => ({ ...r, principal_id: crypto.randomUUID() })],
  ["foreign workspace", (r: Row) => ({ ...r, target_id: crypto.randomUUID() })],
  ["foreign job", (r: Row) => ({ ...r, job_id: crypto.randomUUID() })],
  ["foreign runtime", (r: Row) => ({ ...r, runtime_instance_id: `${crypto.randomUUID()}-1` })],
  ["unknown kind", (r: Row) => ({ ...r, kind: "unknown" })],
  ["wrong environment", (r: Row) => ({ ...r, environment: "production" })],
  ["native classification", (r: Row) => ({ ...r, target_kind: "file", service: "container" })],
  ["postdated admission", (r: Row) => ({ ...r, created_at: "2099-01-01T00:00:00.000Z" })],
  ["postdated verification", (r: Row) => ({ ...r, verified_at: "2099-01-01T00:00:00.000Z" })],
  ["invalid payload", (r: Row) => ({ ...r, payload_json: "not-json" })],
  [
    "inconsistent payload",
    (r: Row) => ({
      ...r,
      payload_json: JSON.stringify({
        ...JSON.parse(String(r.payload_json)),
        targetId: crypto.randomUUID(),
      }),
    }),
  ],
] as const) {
  test(`retained proof rejects ${name}`, async () => {
    const f = await fixture();
    const lease = await leased(f);
    const core = faultCore(f, (rows) => rows.map((row) => alter(row)));
    expect(await provesWorkspaceOnlyCleanup(core, lease, f.runtimeId, "preview", f.clock)).toBe(
      false,
    );
    expect(
      f.db.sqlite
        .query("SELECT count(*) n FROM v2_cleanup_receipts WHERE journal_id=?")
        .get(f.journal.id),
    ).toEqual({ n: 0 });
  });
}

test("matching contradictory rows, absent evidence, and oversized evidence sets cannot select a convenient proof", async () => {
  const f = await fixture();
  const lease = await leased(f);
  for (const alter of [
    () => [],
    (rows: Row[]) => [...rows, { ...rows[0], target_kind: "file" }],
    (rows: Row[]) => Array.from({ length: 65 }, () => ({ ...rows[0] })),
  ])
    expect(
      await provesWorkspaceOnlyCleanup(faultCore(f, alter), lease, f.runtimeId, "preview", f.clock),
    ).toBe(false);
});

test("text-only capture without an independent owner anchor and non-workspace journal remain quarantined", async () => {
  const f = await fixture(false);
  const lease = await leased(f);
  expect(await provesWorkspaceOnlyCleanup(f.core, lease, f.runtimeId, "preview", f.clock)).toBe(
    false,
  );
  const g = await fixture();
  const otherLease = await leased(g);
  g.db.sqlite
    .query("UPDATE v2_deletion_journals SET target_kind='account' WHERE id=?")
    .run(g.journal.id);
  expect(
    await provesWorkspaceOnlyCleanup(g.core, otherLease, g.runtimeId, "preview", g.clock),
  ).toBe(false);
});

test("a lease expiring during proof hashing and deletion of the anchored owner retain pending inventory", async () => {
  const f = await fixture();
  const lease = await leased(f);
  const core = faultCore(f, (rows) => {
    f.advance();
    return rows;
  });
  expect(await provesWorkspaceOnlyCleanup(core, lease, f.runtimeId, "preview", f.clock)).toBe(
    false,
  );
  const g = await fixture();
  const valid = await leased(g);
  g.db.sqlite.query("DELETE FROM user WHERE id=?").run(g.owner.userId);
  expect(await provesWorkspaceOnlyCleanup(g.core, valid, g.runtimeId, "preview", g.clock)).toBe(
    false,
  );
});

test("current native namespace presence cannot be overridden by valid workspace history", async () => {
  const f = await fixture();
  const events: CleanupFailureEvent[] = [];
  await createV2DeletionReconciler(f.core, {
    environment: "preview",
    clock: f.clock,
    testOnlyUnmeteredStorage: true,
    workflows: [
      { deleteBatch: async (ids) => deletedCleanupResult(ids) },
      missing,
      missing,
      missing,
    ],
    onFailure: (event) => events.push(event),
  }).run();
  expect(events.some((event) => event.reason === "CLEANUP_LEGACY_RUNTIME_PROOF_REQUIRED")).toBe(
    true,
  );
  expect(
    f.db.sqlite
      .query("SELECT state FROM v2_deletion_targets WHERE journal_id=? AND kind='job'")
      .all(f.journal.id),
  ).toEqual([{ state: "pending" }]);
  expect(
    f.db.sqlite
      .query("SELECT count(*) n FROM v2_cleanup_receipts WHERE journal_id=? AND kind='job'")
      .get(f.journal.id),
  ).toEqual({ n: 0 });
});

test("uncaptured runtime, changed journal target, and missing tombstone cannot reuse a valid admission", async () => {
  const f = await fixture();
  const lease = await leased(f);
  expect(await provesWorkspaceOnlyCleanup(f.core, lease, `${f.jobId}-2`, "preview", f.clock)).toBe(
    false,
  );
  f.db.sqlite
    .query("UPDATE v2_deletion_journals SET target_id=? WHERE id=?")
    .run(crypto.randomUUID(), f.journal.id);
  expect(await provesWorkspaceOnlyCleanup(f.core, lease, f.runtimeId, "preview", f.clock)).toBe(
    false,
  );
  f.db.sqlite
    .query("UPDATE v2_deletion_journals SET target_id=? WHERE id=?")
    .run(f.workspace.id, f.journal.id);
  f.db.sqlite
    .query("DELETE FROM v2_tombstones WHERE target_kind='workspace' AND target_id=?")
    .run(f.workspace.id);
  expect(await provesWorkspaceOnlyCleanup(f.core, lease, f.runtimeId, "preview", f.clock)).toBe(
    false,
  );
});

test("a foreign captured owner anchor and an owner removed during hashing cannot authorize replay", async () => {
  const f = await fixture(),
    g = await fixture();
  const lease = await leased(f);
  // Independent fixture principal IDs cannot match even when a forged admission
  // read claims that foreign principal and owner consistently.
  const foreign = g.before[0];
  const core = faultCore(f, (rows) =>
    rows.map((row) => ({ ...row, principal_id: foreign?.principal_id, owner_id: g.owner.userId })),
  );
  expect(await provesWorkspaceOnlyCleanup(core, lease, f.runtimeId, "preview", f.clock)).toBe(
    false,
  );
  const changing = faultCore(f, (rows) => {
    f.db.sqlite.query("DELETE FROM user WHERE id=?").run(f.owner.userId);
    return rows;
  });
  expect(await provesWorkspaceOnlyCleanup(changing, lease, f.runtimeId, "preview", f.clock)).toBe(
    false,
  );
});

test("retained runtime and principal identities cannot be rewritten after workspace deletion", async () => {
  const f = await fixture();
  expect(() =>
    f.db.sqlite
      .query("UPDATE v2_execution_admissions SET runtime_instance_id=? WHERE job_id=?")
      .run(`${crypto.randomUUID()}-1`, f.jobId),
  ).toThrow();
  expect(() =>
    f.db.sqlite
      .query("UPDATE v2_execution_admissions SET principal_id=? WHERE job_id=?")
      .run(crypto.randomUUID(), f.jobId),
  ).toThrow();
  expect(() =>
    f.db.sqlite.query("DELETE FROM v2_execution_admissions WHERE job_id=?").run(f.jobId),
  ).toThrow();
  expect(
    f.db.sqlite.query("SELECT * FROM v2_execution_admissions WHERE job_id=?").all(f.jobId),
  ).toEqual(f.before);
});

test("canonical payload ordering preserves proof while an unresolved captured owner anchor rejects it", async () => {
  const f = await fixture();
  const lease = await leased(f);
  const reordered = faultCore(f, (rows) =>
    rows.map((row) => ({
      ...row,
      payload_json: JSON.stringify(
        Object.fromEntries(Object.entries(JSON.parse(String(row.payload_json))).reverse()),
        null,
        2,
      ),
    })),
  );
  expect(await provesWorkspaceOnlyCleanup(reordered, lease, f.runtimeId, "preview", f.clock)).toBe(
    true,
  );
  f.db.sqlite
    .query(
      "INSERT INTO v2_deletion_targets(journal_id,kind,target_id,ordinal) SELECT ?,'blob',?,coalesce(max(ordinal),0)+1 FROM v2_deletion_targets WHERE journal_id=?",
    )
    .run(f.journal.id, crypto.randomUUID(), f.journal.id);
  expect(await provesWorkspaceOnlyCleanup(f.core, lease, f.runtimeId, "preview", f.clock)).toBe(
    false,
  );
});

test("historical priced plans without exact runtime binding remain quarantined", async () => {
  const f = await fixture();
  const lease = await leased(f);
  expect(await provesWorkspaceOnlyCleanup(f.core, lease, f.runtimeId, "preview", f.clock)).toBe(
    true,
  );
  const pricing = crypto.randomUUID(),
    funding = crypto.randomUUID();
  // Synthetic retained ledger only. No monetary/provider evidence is asserted.
  for (const [id, kind] of [
    [pricing, "pricing"],
    [funding, "funding"],
  ] as const)
    f.db.sqlite
      .query(
        "INSERT INTO v2_runtime_proofs(id,kind,environment,digest,payload_json,evidence_hash,verification_method,verified_at,valid_until) VALUES(?,?,'preview',?,'{}',?,'official_document',?,?)",
      )
      .run(
        id,
        kind,
        "a".repeat(64),
        "b".repeat(64),
        f.journal.created_at,
        "2099-01-01T00:00:00.000Z",
      );
  f.db.sqlite
    .query(`INSERT INTO v2_runtime_plans(id,operation_id,operation_revision,request_hash,invocation_id,pricing_proof_id,funding_proof_id,job_id,target_kind,target_id,target_revision,digest,payload_json,evidence_hash,verified_at,maximum_attempts,reserved_krw,deadline_at,created_at)
    SELECT ?,operation_id,operation_revision,request_hash,invocation_id,?,?,job_id,target_kind,target_id,target_revision,digest,payload_json,evidence_hash,verified_at,1,0,deadline_at,created_at FROM v2_execution_admissions WHERE job_id=? LIMIT 1`)
    .run(crypto.randomUUID(), pricing, funding, f.jobId);
  expect(await provesWorkspaceOnlyCleanup(f.core, lease, f.runtimeId, "preview", f.clock)).toBe(
    false,
  );
});
