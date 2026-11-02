import { afterEach, expect, test } from "bun:test";
import { createReworkCaseService } from "../src/server/modules/rework/case-context";
import { createReworkStateService } from "../src/server/modules/rework/state";
import { reportFixture } from "./helpers/report-fixture";

const fixtures: Awaited<ReturnType<typeof reportFixture>>[] = [];
afterEach(() => {
  for (const f of fixtures.splice(0)) f.db.close();
});
async function fixture() {
  const f = await reportFixture();
  fixtures.push(f);
  return f;
}

test("context and scope cannot precede the initial workspace revision anchor", async () => {
  const f = await fixture();
  const anchor = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const oldContext = Promise.withResolvers<void>();
  const oldScope = Promise.withResolvers<void>();
  let held = false;
  let scopeStarted = false;
  const core: typeof f.core = {
    ...f.core,
    cipher: {
      ...f.core.cipher,
      async decrypt(envelope, context) {
        if (context.table === "v2_workspaces" && !held) {
          held = true;
          anchor.resolve();
          await release.promise;
        }
        return f.core.cipher.decrypt(envelope, context);
      },
    },
    statement(sql, values = []) {
      const statement = f.core.statement(sql, values);
      const scope = sql.startsWith("SELECT r.id,r.workspace_revision,s.id review_id");
      const context = sql.includes("w.encrypted_payload=?");
      if (scope) scopeStarted = true;
      if (!scope && !context) return statement;
      return new Proxy(statement, {
        get(target, property) {
          if (property === "first")
            return async (...args: Parameters<typeof target.first>) => {
              const value = await target.first(...args);
              if (scope) oldScope.resolve();
              if (context) oldContext.resolve();
              return value;
            };
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
  const result = createReworkStateService(core, { clock: () => f.actor.now }).get(
    f.actor.ownerId,
    f.workspaceId,
  );
  await anchor.promise;
  const launchedBeforeAnchor = scopeStarted;
  try {
    // Exercise the unsafe interleaving without waiting for unlaunched reads in
    // the fixed path. The repository retries its delayed first workspace read.
    if (launchedBeforeAnchor) await Promise.all([oldContext.promise, oldScope.promise]);
    await createReworkCaseService(f.core, { clock: () => f.actor.now }).update(
      f.actor.ownerId,
      f.workspaceId,
      crypto.randomUUID(),
      {
        expectedRevision: f.rev(),
        casePurpose: "respond_to_claim",
        subjectContext: "individual",
        procedure: { kind: "unconfirmed", stage: "unconfirmed", description: null },
      },
    );
  } finally {
    release.resolve();
  }
  const state = await result;
  expect(state.caseContext.casePurpose).toBe("respond_to_claim");
  expect(launchedBeforeAnchor).toBe(false);
});

test("a slow passive checkpoint does not serialize the independent report read", async () => {
  const f = await fixture();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let reportStarted = false;
  const core: typeof f.core = {
    ...f.core,
    statement(sql, values = []) {
      const statement = f.core.statement(sql, values);
      if (!sql.includes("v2_rework_records") || !values.includes("automatic-preparation"))
        return statement;
      return new Proxy(statement, {
        get(target, property) {
          if (property === "first")
            return async (...args: Parameters<typeof target.first>) => {
              entered.resolve();
              await release.promise;
              return target.first(...args);
            };
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
  const result = createReworkStateService(core, {
    clock: () => f.actor.now,
    peekReport: async () => {
      reportStarted = true;
      return null;
    },
  }).get(f.actor.ownerId, f.workspaceId);
  await entered.promise;
  try {
    expect(reportStarted).toBe(true);
  } finally {
    release.resolve();
    await result;
  }
});

test("publication during parallel metadata reads still rejects a mixed revision", async () => {
  const f = await fixture();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const result = createReworkStateService(f.core, {
    clock: () => f.actor.now,
    peekReport: async () => {
      entered.resolve();
      await release.promise;
      return null;
    },
  }).get(f.actor.ownerId, f.workspaceId);
  const outcome = result.then(
    () => ({ completed: true }),
    (error: { code?: string }) => ({ completed: false, code: error.code }),
  );
  await entered.promise;
  f.db.sqlite.query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?").run(f.workspaceId);
  release.resolve();
  expect(await outcome).toEqual({ completed: false, code: "STALE_REVISION" });
});

test("another owner cannot launch the parallel report read", async () => {
  const f = await fixture();
  let reportReads = 0;
  const state = createReworkStateService(f.core, {
    clock: () => f.actor.now,
    peekReport: async () => {
      reportReads++;
      return null;
    },
  });
  await expect(state.get(crypto.randomUUID(), f.workspaceId)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(reportReads).toBe(0);
});
