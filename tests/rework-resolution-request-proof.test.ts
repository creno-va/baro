import { afterEach, expect, setSystemTime, test } from "bun:test";
import { z } from "zod";
import { createV2ReworkRepository } from "../src/server/db/v2-rework";
import { analysisBasis } from "../src/server/modules/legal-retrieval/analysis/context";
import { loadAnalysisInput } from "../src/server/modules/rework/analysis-input";
import { createReworkCaseService } from "../src/server/modules/rework/case-context";
import { preparedAnalysisRecordSchema } from "../src/server/modules/rework/records";
import { createReworkResolutionRuntime } from "../src/server/modules/rework/resolution-runtime";
import { reportFixture } from "./helpers/report-fixture";

const fixtures: Awaited<ReturnType<typeof reportFixture>>[] = [];
afterEach(() => {
  setSystemTime();
  for (const f of fixtures.splice(0)) f.db.close();
});

async function failedAnalysis(f: Awaited<ReturnType<typeof fixture>>) {
  const loaded = await loadAnalysisInput(f.core, f.actor, f.workspaceId);
  if (!loaded.input) throw new Error("missing synthetic input");
  const record = await createV2ReworkRepository(f.core, { clock: () => f.actor.now }).write(
    { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() },
    {
      kind: "analysis",
      expectedVersion: 0,
      bumpWorkspace: false,
      schema: preparedAnalysisRecordSchema,
      value: {
        format: "prepared-legal-analysis-v1",
        basis: await analysisBasis(loaded.input),
        scope: loaded.input.scope,
        snapshot: null,
        failure: "MODEL_UNAVAILABLE",
        completedAt: f.actor.now,
        procedureCitations: [],
      },
    },
  );
  if (!record) throw new Error("missing synthetic analysis");
  return record;
}

for (const change of [
  "manifest",
  "part",
  "part_delete",
  "session",
  "consent",
  "report",
  "analysis_head",
] as const)
  test(`the original source proof rejects a late ${change} change, including a null basis`, async () => {
    const f = await fixture();
    const record = await failedAnalysis(f);
    const session = f.db.sqlite
      .query("SELECT id FROM session WHERE user_id=?")
      .get(f.actor.ownerId) as { id: string };
    let changed = false;
    const core: typeof f.core = {
      ...f.core,
      statement(sql, values = []) {
        const statement = f.core.statement(sql, values);
        if (
          !sql.startsWith(
            "SELECT w.id FROM v2_workspaces w WHERE w.id=? AND w.owner_id=? AND w.revision=?",
          ) ||
          !sql.includes("SELECT id FROM v2_reports")
        )
          return statement;
        return new Proxy(statement, {
          get(target, property) {
            if (property === "first")
              return async (...args: Parameters<typeof target.first>) => {
                const value = await target.first(...args);
                if (!changed) {
                  changed = true;
                  if (change === "manifest") {
                    // Forced corruption checks exact bytes; normal published UPDATE is forbidden.
                    f.db.sqlite.exec("DROP TRIGGER v2_rework_record_immutable");
                    f.db.sqlite
                      .query(
                        "UPDATE v2_rework_records SET encrypted_payload=encrypted_payload||'x' WHERE id=?",
                      )
                      .run(record.id);
                  } else if (change === "part") {
                    f.db.sqlite.exec("DROP TRIGGER v2_rework_part_immutable");
                    f.db.sqlite
                      .query(
                        "UPDATE v2_rework_parts SET encrypted_payload=encrypted_payload||'x' WHERE record_id=?",
                      )
                      .run(record.id);
                  } else if (change === "part_delete")
                    f.db.sqlite
                      .query("DELETE FROM v2_rework_parts WHERE record_id=?")
                      .run(record.id);
                  else if (change === "session")
                    f.db.sqlite.query("DELETE FROM session WHERE id=?").run(session.id);
                  else if (change === "consent")
                    f.db.sqlite
                      .query("DELETE FROM user_consents WHERE user_id=?")
                      .run(f.actor.ownerId);
                  else if (change === "report")
                    f.db.sqlite
                      .query(
                        "UPDATE v2_reports SET encrypted_payload=encrypted_payload||'x' WHERE id=?",
                      )
                      .run(f.report.id);
                  else {
                    const next = await createV2ReworkRepository(f.core, {
                      clock: () => f.actor.now,
                    }).write(
                      { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() },
                      {
                        kind: "analysis",
                        expectedVersion: record.revision,
                        bumpWorkspace: false,
                        schema: preparedAnalysisRecordSchema,
                        value: record.value,
                      },
                    );
                    if (!next) throw new Error("missing later synthetic head");
                  }
                }
                return value;
              };
            const value = Reflect.get(target, property);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    };
    const runtime = createReworkResolutionRuntime(core, {
      clock: () => f.actor.now,
      sessionId: session.id,
      peekReport: (owner, id) => f.reports.peek(owner, id),
    });
    const result = await runtime
      .update(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
        expectedRevision: 1,
        reportId: f.report.id,
        reportRevision: f.report.revision,
        action: "select",
        choice: "lawyer",
        selectedFileIds: [],
        maskIdentifiers: false,
      })
      .then(
        () => "completed",
        (error: { code: string }) => error.code,
      );
    expect(["STALE_REVISION", "NOT_FOUND", "CONSENT_REQUIRED"]).toContain(result);
    expect(changed).toBe(true);
    expect(
      f.db.sqlite
        .query(
          "SELECT count(*) n FROM v2_rework_records WHERE kind='resolution' AND state='published'",
        )
        .get(),
    ).toEqual({ n: 0 });
  });

test("each request reconstructs independently and the stored resolution CAS admits only one concurrent selection", async () => {
  const f = await fixture();
  await failedAnalysis(f);
  let peeks = 0;
  const runtime = createReworkResolutionRuntime(f.core, {
    clock: () => f.actor.now,
    peekReport: async (owner, id) => {
      peeks++;
      return f.reports.peek(owner, id);
    },
  });
  const input = {
    expectedRevision: 1,
    reportId: f.report.id,
    reportRevision: f.report.revision,
    action: "select" as const,
    choice: "lawyer" as const,
    selectedFileIds: [],
    maskIdentifiers: false,
  };
  const results = await Promise.allSettled([
    runtime.update(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), input),
    runtime.update(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), input),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  expect(peeks).toBe(2);
  const state = await runtime.get(f.actor.ownerId, f.workspaceId);
  expect(state).toMatchObject({ revision: 2, selection: "lawyer", basis: null });
  expect(peeks).toBe(3);
});

test("post-save authorization cannot acknowledge a disappeared request session or remove the committed record", async () => {
  const f = await fixture();
  const session = f.db.sqlite
    .query("SELECT id FROM session WHERE user_id=?")
    .get(f.actor.ownerId) as { id: string };
  let changed = false;
  const core: typeof f.core = {
    ...f.core,
    statement(sql, values = []) {
      if (
        !changed &&
        sql.startsWith(
          "SELECT w.id FROM v2_workspaces w WHERE w.id=? AND w.owner_id=? AND w.revision=?",
        ) &&
        sql.includes("SELECT id FROM v2_reports") &&
        (
          f.db.sqlite
            .query(
              "SELECT count(*) n FROM v2_rework_records WHERE kind='resolution' AND state='published'",
            )
            .get() as { n: number }
        ).n === 1
      ) {
        changed = true;
        f.db.sqlite.query("DELETE FROM session WHERE id=?").run(session.id);
      }
      return f.core.statement(sql, values);
    },
  };
  const runtime = createReworkResolutionRuntime(core, {
    clock: () => f.actor.now,
    sessionId: session.id,
    peekReport: (owner, id) => f.reports.peek(owner, id),
  });
  await expect(
    runtime.update(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
      expectedRevision: 1,
      reportId: f.report.id,
      reportRevision: f.report.revision,
      action: "select",
      choice: "lawyer",
      selectedFileIds: [],
      maskIdentifiers: false,
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(changed).toBe(true);
  expect(
    f.db.sqlite
      .query(
        "SELECT count(*) n FROM v2_rework_records WHERE kind='resolution' AND state='published'",
      )
      .get(),
  ).toEqual({ n: 1 });
});

test("a replay retains its committed bytes after W changes without reconstructing or granting new source authority", async () => {
  const f = await fixture();
  let peeks = 0;
  const runtime = createReworkResolutionRuntime(f.core, {
    clock: () => f.actor.now,
    peekReport: async (owner, id) => {
      peeks++;
      return f.reports.peek(owner, id);
    },
  });
  const key = crypto.randomUUID(),
    input = {
      expectedRevision: 1,
      reportId: f.report.id,
      reportRevision: f.report.revision,
      action: "select" as const,
      choice: "lawyer" as const,
      selectedFileIds: [],
      maskIdentifiers: false,
    };
  const first = await runtime.update(f.actor.ownerId, f.workspaceId, key, input);
  f.db.sqlite.query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?").run(f.workspaceId);
  expect(await runtime.update(f.actor.ownerId, f.workspaceId, key, input)).toEqual(first);
  expect(peeks).toBe(1);
  expect(
    f.db.sqlite
      .query(
        "SELECT count(*) n FROM v2_rework_records WHERE kind='resolution' AND state='published'",
      )
      .get(),
  ).toEqual({ n: 1 });
});

for (const size of [720_000, 900_000])
  test(`a ${size}-byte generic record remains readable across the private proof bound`, async () => {
    const f = await fixture();
    const repository = createV2ReworkRepository(f.core, { clock: () => f.actor.now });
    const schema = z.strictObject({ text: z.string() });
    const written = await repository.write(
      { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() },
      {
        kind: "checkpoint",
        entityId: "private-proof-bound",
        expectedVersion: 0,
        bumpWorkspace: false,
        value: { text: "x".repeat(size) },
        schema,
      },
    );
    if (!written) throw new Error("missing large synthetic record");
    let called = false,
      reusable = false;
    const read = await repository.read(
      f.actor,
      f.workspaceId,
      "checkpoint",
      "private-proof-bound",
      schema,
      undefined,
      (proof) => {
        called = true;
        reusable = proof !== null;
      },
    );
    expect(called).toBe(true);
    expect(reusable).toBe(size === 720_000);
    expect(read?.value.text).toBe("x".repeat(size));
  });

test("large prepared records use full reconstruction without changing the existing accepted input", async () => {
  const f = await fixture();
  await createReworkCaseService(f.core, { clock: () => f.actor.now }).update(
    f.actor.ownerId,
    f.workspaceId,
    crypto.randomUUID(),
    {
      expectedRevision: f.rev(),
      casePurpose: "prepare_claim",
      subjectContext: "individual",
      procedure: { kind: "unconfirmed", stage: "unconfirmed", description: null },
    },
  );
  const loaded = await loadAnalysisInput(f.core, f.actor, f.workspaceId);
  if (!loaded.input) throw new Error("missing synthetic input");
  const basis = await analysisBasis(loaded.input);
  const text = "가".repeat(1000);
  const record = await createV2ReworkRepository(f.core, { clock: () => f.actor.now }).write(
    { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() },
    {
      kind: "analysis",
      expectedVersion: 0,
      bumpWorkspace: false,
      schema: preparedAnalysisRecordSchema,
      value: {
        format: "prepared-legal-analysis-v1",
        basis,
        scope: loaded.input.scope,
        failure: null,
        completedAt: f.actor.now,
        procedureCitations: [],
        snapshot: {
          contractVersion: "conversation-report-v1",
          id: crypto.randomUUID(),
          basis,
          context: loaded.input.context,
          basedOnFactIds: [],
          includedEvidence: loaded.input.includedEvidence,
          asOfDate: f.actor.now.slice(0, 10),
          checkedAt: f.actor.now,
          status: "unavailable",
          citations: [],
          retrievalHash: "a".repeat(64),
          availability: [
            { kind: "statute", status: "unavailable", reason: "configuration_missing" },
          ],
          issues: [],
          precedents: [],
          evidenceRequirements: [],
          sourceClaims: [],
          limitations: Array(100).fill(text),
          perspective: {
            casePurpose: "prepare_claim",
            weaknesses: Array(30).fill(text),
            claimGaps: Array(30).fill(text),
            responsePoints: Array(10).fill({
              opponentPosition: text,
              ourExplanation: text,
              conflictingFactIds: [],
              sourceClaimIds: [],
              additionalMaterials: Array(30).fill(text),
            }),
            additionalMaterials: [],
          },
        },
      },
    },
  );
  if (!record) throw new Error("missing large prepared analysis");
  let peeks = 0;
  const runtime = createReworkResolutionRuntime(f.core, {
    clock: () => f.actor.now,
    peekReport: async (owner, id) => {
      peeks++;
      return f.reports.peek(owner, id);
    },
  });
  const state = await runtime.update(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: 1,
    reportId: f.report.id,
    reportRevision: f.report.revision,
    action: "select",
    choice: "lawyer",
    selectedFileIds: [],
    maskIdentifiers: false,
  });
  expect(state).toMatchObject({
    revision: 2,
    basis: null,
    selection: "lawyer",
    status: "not_ready",
  });
  expect(peeks).toBeGreaterThan(1);
});
async function fixture() {
  const f = await reportFixture();
  fixtures.push(f);
  setSystemTime(new Date(f.actor.now));
  const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
  return { ...f, report };
}

test("a selection cannot adopt a later workspace after loading its original limited source", async () => {
  const f = await fixture();
  let changed = false;
  const core: typeof f.core = {
    ...f.core,
    statement(sql, values = []) {
      const statement = f.core.statement(sql, values);
      if (
        !sql.startsWith(
          "SELECT w.id FROM v2_workspaces w WHERE w.id=? AND w.owner_id=? AND w.revision=?",
        ) ||
        !sql.includes("SELECT id FROM v2_reports")
      )
        return statement;
      return new Proxy(statement, {
        get(target, property) {
          if (property === "first")
            return async (...args: Parameters<typeof target.first>) => {
              const value = await target.first(...args);
              if (!changed) {
                changed = true;
                f.db.sqlite
                  .query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?")
                  .run(f.workspaceId);
              }
              return value;
            };
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
  const runtime = createReworkResolutionRuntime(core, {
    clock: () => f.actor.now,
    peekReport: (owner, id) => f.reports.peek(owner, id),
  });
  await expect(
    runtime.update(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
      expectedRevision: 1,
      reportId: f.report.id,
      reportRevision: f.report.revision,
      action: "select",
      choice: "lawyer",
      selectedFileIds: [],
      maskIdentifiers: false,
    }),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect(changed).toBe(true);
  expect(
    f.db.sqlite
      .query(
        "SELECT count(*) n FROM v2_rework_records WHERE kind='resolution' AND state='published'",
      )
      .get(),
  ).toEqual({ n: 0 });
});
