import { afterEach, expect, spyOn, test } from "bun:test";
import { Hono } from "hono";
import { createWorkspacesApi } from "../src/server/api/v2/workspaces";
import { saveAccountType } from "../src/server/auth/account-type";
import { snapshotStatements } from "../src/server/db/v2-core";
import { createV2DeletionRepository } from "../src/server/db/v2-deletion";
import { createV2WorkspaceRepository } from "../src/server/db/v2-workspace";
import { customerWorkspaceFixture, runCustomerJob } from "./helpers/customer-workspace";
import { countD1Calls } from "./helpers/d1-call-count";
import { seedTestSession } from "./helpers/session";

const databases: Awaited<ReturnType<typeof customerWorkspaceFixture>>["db"][] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

async function fixture(summary = true) {
  const f = await customerWorkspaceFixture(new Date().toISOString());
  databases.push(f.db);
  await saveAccountType(f.db.binding, f.owner.userId, "customer");
  if (summary) {
    await runCustomerJob(f, "intake_questions");
    const intake = await f.service.intake(f.owner.userId, f.workspace.id);
    if (!intake) throw new Error("Missing synthetic intake");
    await f.service.answers(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
      expectedRevision: intake.revision,
      answers: intake.batches[0]?.questions.map((q) => ({ questionId: q.id, status: "unknown" })),
    });
    expect((await runCustomerJob(f, "intake_summary")).result.status).toBe("completed");
  }
  const meter = countD1Calls(f.db.binding);
  const sql: string[] = [];
  meter.before((statements) => sql.push(...statements));
  const app = new Hono().route("/api/v2/cases", createWorkspacesApi());
  const request = (id = f.workspace.id, cookie = f.owner.cookie) =>
    app.request(
      `/api/v2/cases/${id}/summary`,
      { headers: { cookie } },
      {
        ...f.owner.env,
        DB: meter.binding,
        CASE_DATA_KEY_V1: btoa("w".repeat(32)).replace(/=+$/, ""),
        APPLICATION_COST_LIMITS_ENABLED: "false",
      },
    );
  const tombstone = (kind: "workspace" | "account") =>
    f.db.sqlite
      .query("INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES(?,?,?)")
      .run(kind, kind === "workspace" ? f.workspace.id : f.owner.userId, f.now);
  return { ...f, meter, request, sql, tombstone };
}

test("summary preflight uses one owned/alive query without decrypting unrelated intake content", async () => {
  const f = await fixture();
  const repository = createV2WorkspaceRepository(f.meter.binding, {
    ...f.core.cipher,
    decrypt: async () => {
      throw new Error("Preflight must not decrypt");
    },
  });
  expect(
    await repository.summaryAvailable({ ownerId: f.owner.userId, now: f.now }, f.workspace.id),
  ).toBe(true);
  expect(f.meter.work).toEqual({ calls: 1, statements: 1 });
  expect(f.sql[0]).not.toMatch(/encrypted_payload|v2_answers|v2_question_batches|v2_private_parts/);
  f.meter.reset();
  f.sql.length = 0;
  const response = await f.request();
  expect(response.status).toBe(200);
  expect(f.sql.filter((sql) => sql.includes("FROM v2_intakes"))).toHaveLength(1);
  expect(f.sql.some((sql) => /v2_answers|v2_question_batches|v2_private_parts/.test(sql))).toBe(
    false,
  );
  expect(await response.json()).toMatchObject({
    overview: "사용자의 거래 자료 확인 준비를 정리했습니다.",
  });
  expect(f.sql.some((sql) => sql.includes("v2_private_parts"))).toBe(true);
});

for (const condition of [
  "missing",
  "no_summary",
  "foreign",
  "deleted",
  "workspace_tombstone",
  "account_tombstone",
] as const) {
  test(`summary ${condition} remains unavailable before a body stream is returned`, async () => {
    const f = await fixture(condition !== "no_summary");
    let id = f.workspace.id,
      cookie = f.owner.cookie;
    if (condition === "missing") id = crypto.randomUUID();
    if (condition === "foreign") {
      const other = await seedTestSession(f.db, { consent: true });
      await saveAccountType(f.db.binding, other.userId, "customer");
      cookie = other.cookie;
    }
    if (condition === "deleted") {
      const current = await f.service.find(f.owner.userId, f.workspace.id);
      expect(
        await createV2DeletionRepository(f.core).workspace({
          ownerId: f.owner.userId,
          now: f.now,
          workspaceId: f.workspace.id,
          expectedRevision: current.workspaceRevision,
        }),
      ).toBe(true);
    }
    if (condition === "workspace_tombstone") f.tombstone("workspace");
    if (condition === "account_tombstone") f.tombstone("account");
    const response = await f.request(id, cookie);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(f.sql.some((sql) => sql.includes("v2_private_parts"))).toBe(false);
  });
}

test("summary preflight database errors remain closed and are not converted to absence", async () => {
  const f = await fixture();
  f.meter.before((sql) => {
    if (sql.some((s) => s.startsWith("SELECT i.id FROM v2_intakes i JOIN v2_summaries")))
      throw new Error("Synthetic database failure");
  });
  const diagnostic = spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await f.request();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "DEPENDENCY_UNAVAILABLE" } });
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain("Synthetic database failure");
  } finally {
    diagnostic.mockRestore();
  }
});

test("a summary removed after header preflight is rechecked when body reading starts", async () => {
  const f = await fixture();
  const response = await f.request();
  expect(response.status).toBe(200);
  const intake = await f.service.intake(f.owner.userId, f.workspace.id);
  if (!intake) throw new Error("Missing synthetic intake");
  await f.service.answers(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
    expectedRevision: intake.revision,
    answers: intake.batches[0]?.questions.map((q) => ({
      questionId: q.id,
      status: "answered",
      value: "새로 확인한 합성 답변입니다.",
    })),
  });
  await expect(response.text()).rejects.toMatchObject({ code: "STALE_REVISION" });
});

for (const condition of [
  "owner",
  "revision",
  "summary",
  "workspace_tombstone",
  "account_tombstone",
] as const) {
  test(`summary stream rejects ${condition} drift after reading a private part before yielding plaintext`, async () => {
    const f = await fixture();
    const other = condition === "owner" ? await seedTestSession(f.db) : undefined;
    let changed = false;
    f.meter.after((sql) => {
      if (changed || !sql.some((s) => s.startsWith("SELECT * FROM v2_private_parts"))) return;
      changed = true;
      if (condition === "owner" && other)
        f.db.sqlite
          .query("UPDATE v2_workspaces SET owner_id=? WHERE id=?")
          .run(other.userId, f.workspace.id);
      if (condition === "revision")
        f.db.sqlite
          .query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?")
          .run(f.workspace.id);
      if (condition === "summary")
        f.db.sqlite
          .query("UPDATE v2_intakes SET status='collecting',summary_id=NULL WHERE id=?")
          .run(f.workspace.id);
      if (condition === "workspace_tombstone") f.tombstone("workspace");
      if (condition === "account_tombstone") f.tombstone("account");
    });
    const response = await f.request();
    expect(response.status).toBe(200);
    if (!response.body) throw new Error("Missing synthetic response body");
    const reader = response.body.getReader();
    await expect(reader.read()).rejects.toMatchObject({ code: "STALE_REVISION" });
    expect(changed).toBe(true);
  });
}

test("summary preflight does not bypass a missing encrypted body part", async () => {
  const f = await fixture();
  f.db.sqlite
    .query(
      "DELETE FROM v2_private_parts WHERE snapshot_id IN (SELECT snapshot_id FROM v2_summaries WHERE workspace_id=?)",
    )
    .run(f.workspace.id);
  const response = await f.request();
  expect(response.status).toBe(200);
  await expect(response.text()).rejects.toMatchObject({ code: "SNAPSHOT_INVALID" });
});

test("summary existence cannot bypass the stream hash check on same-length altered plaintext", async () => {
  const f = await fixture();
  let altered = false;
  // A test-only cipher fault preserves valid UTF-8 byte length. Published SQL
  // snapshots remain immutable; their stored integrity digest is not changed.
  const repository = createV2WorkspaceRepository(f.meter.binding, {
    ...f.core.cipher,
    decrypt: async (input, context) => {
      const text = await f.core.cipher.decrypt(input, context);
      if (context.table !== "v2_private_parts") return text;
      const changed = text.replace("사용자의", "사용자에");
      altered = changed !== text;
      expect(new TextEncoder().encode(changed).byteLength).toBe(
        new TextEncoder().encode(text).byteLength,
      );
      return changed;
    },
  });
  const actor = { ownerId: f.owner.userId, now: f.now };
  expect(await repository.summaryAvailable(actor, f.workspace.id)).toBe(true);
  await expect(repository.summaryFragments(actor, f.workspace.id).next()).rejects.toMatchObject({
    code: "SNAPSHOT_INVALID",
  });
  expect(altered).toBe(true);
});

for (const kind of ["facts", "parties", "both"] as const) {
  test(`summary stream preserves legacy ${kind} outside the immutable snapshot`, async () => {
    const f = await fixture();
    const intake = await f.repository.readIntake(
      { ownerId: f.owner.userId, now: f.now },
      f.workspace.id,
    );
    if (!intake?.summary) throw new Error("Missing synthetic summary");
    const originalFact = intake.summary.facts[0];
    if (!originalFact) throw new Error("Missing synthetic fact");
    const fact = {
      ...originalFact,
      id: crypto.randomUUID(),
      text: "과거 방식 합성 사실",
    };
    const party = { id: crypto.randomUUID(), label: "합성 인물", role: "과거 방식 합성 역할" };
    for (const [table, value] of [
      ["v2_facts", fact],
      ["v2_parties", party],
    ] as const) {
      if (
        (table === "v2_facts" && kind === "parties") ||
        (table === "v2_parties" && kind === "facts")
      )
        continue;
      const id = crypto.randomUUID();
      const payload = await f.core.encrypt(
        table,
        id,
        f.owner.userId,
        intake.summary.revision,
        value,
      );
      f.db.sqlite
        .query(
          `INSERT INTO ${table}(id,entity_id,workspace_id,revision,summary_revision,encrypted_payload) VALUES(?,?,?,?,?,?)`,
        )
        .run(
          id,
          value.id,
          f.workspace.id,
          intake.summary.revision,
          intake.summary.revision,
          payload,
        );
    }
    const response = await f.request();
    expect(response.status).toBe(200);
    const result = (await response.json()) as typeof intake.summary;
    expect(result.facts).toEqual(
      kind === "parties" ? intake.summary.facts : [...intake.summary.facts, fact],
    );
    expect(result.parties).toEqual(
      kind === "facts" ? intake.summary.parties : [...intake.summary.parties, party],
    );
  });
}

test("a later summary chunk remains fenced after an earlier chunk has been read", async () => {
  const f = await fixture();
  const actor = { ownerId: f.owner.userId, now: f.now };
  const intake = await f.repository.readIntake(actor, f.workspace.id);
  const workspace = await f.service.find(f.owner.userId, f.workspace.id);
  if (!intake?.summary) throw new Error("Missing synthetic summary");
  const snapshotId = crypto.randomUUID();
  const claim = crypto.randomUUID();
  await f.core.binding.batch([
    f.core.claim(
      { ...actor, workspaceId: f.workspace.id, expectedRevision: workspace.workspaceRevision },
      claim,
    ),
    ...(await snapshotStatements(
      f.core,
      {
        id: snapshotId,
        ownerId: actor.ownerId,
        workspaceId: f.workspace.id,
        targetId: f.workspace.id,
        revision: 2,
        purpose: "summary",
        now: f.now,
      },
      {
        ...intake.summary,
        revision: 2,
        unknowns: Array.from({ length: 24 }, () => "가".repeat(1000)),
      },
      claim,
    )),
    f.core.finish(claim),
  ]);
  f.db.sqlite
    .query("UPDATE v2_summaries SET revision=2,snapshot_id=? WHERE workspace_id=?")
    .run(snapshotId, f.workspace.id);
  let parts = 0;
  f.meter.after((sql) => {
    if (!sql.some((s) => s.startsWith("SELECT * FROM v2_private_parts"))) return;
    parts++;
    if (parts === 2)
      f.db.sqlite
        .query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?")
        .run(f.workspace.id);
  });
  const response = await f.request();
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing synthetic stream");
  expect((await reader.read()).done).toBe(false);
  await expect(reader.read()).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect(parts).toBe(2);
});
