import { afterEach, expect, setSystemTime, test } from "bun:test";
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
async function fixture() {
  const f = await reportFixture();
  fixtures.push(f);
  setSystemTime(new Date(f.actor.now));
  await f.reports.get(f.actor.ownerId, f.workspaceId);
  return f;
}

for (const change of ["workspace", "session"] as const)
  test(`a limited resolution read rejects ${change} changes after its input anchor`, async () => {
    const f = await fixture();
    const session = f.db.sqlite
      .query("SELECT id FROM session WHERE user_id=?")
      .get(f.actor.ownerId) as { id: string };
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const runtime = createReworkResolutionRuntime(f.core, {
      clock: () => f.actor.now,
      sessionId: session.id,
      peekReport: async (owner, id) => {
        const report = await f.reports.peek(owner, id);
        entered.resolve();
        await release.promise;
        return report;
      },
    });
    const outcome = runtime.get(f.actor.ownerId, f.workspaceId).then(
      () => ({ completed: true }),
      (error: { code?: string }) => ({ completed: false, code: error.code }),
    );
    await entered.promise;
    if (change === "workspace")
      f.db.sqlite
        .query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?")
        .run(f.workspaceId);
    else f.db.sqlite.query("DELETE FROM session WHERE id=?").run(session.id);
    release.resolve();
    expect(await outcome).toEqual({ completed: false, code: "STALE_REVISION" });
  });

for (const change of ["report", "analysis"] as const)
  test(`a late ${change} publication cannot escape through a null analysis basis`, async () => {
    const f = await fixture();
    if (change === "analysis")
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
    let changed = false;
    const core: typeof f.core = {
      ...f.core,
      statement(sql, values = []) {
        const statement = f.core.statement(sql, values);
        if (!sql.startsWith("SELECT revision,snapshot_id,encrypted_payload,")) return statement;
        return new Proxy(statement, {
          get(target, property) {
            if (property === "first")
              return async (...args: Parameters<typeof target.first>) => {
                const value = await target.first(...args);
                if (change === "report")
                  f.db.sqlite
                    .query("UPDATE v2_reports SET revision=revision+1 WHERE workspace_id=?")
                    .run(f.workspaceId);
                else {
                  const loaded = await loadAnalysisInput(f.core, f.actor, f.workspaceId);
                  if (!loaded.input) throw new Error("missing synthetic input");
                  await createV2ReworkRepository(f.core, { clock: () => f.actor.now }).write(
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
                }
                changed = true;
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
    await expect(runtime.get(f.actor.ownerId, f.workspaceId)).rejects.toMatchObject({
      code: "STALE_REVISION",
    });
    expect(changed).toBe(true);
  });

test("a current limited report remains readable without inventing an analysis basis", async () => {
  const f = await fixture();
  const runtime = createReworkResolutionRuntime(f.core, {
    clock: () => f.actor.now,
    peekReport: (owner, id) => f.reports.peek(owner, id),
  });
  const state = await runtime.get(f.actor.ownerId, f.workspaceId);
  expect(state).toMatchObject({ revision: 1, basis: null, status: "not_ready", draft: null });
  expect(state.allowedDocumentKinds).toEqual(["fact_statement"]);
  expect(state.citations).toEqual([]);
});
