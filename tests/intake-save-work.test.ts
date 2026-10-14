import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { casesApi } from "../src/client/api/cases";
import { meApi } from "../src/server/api/me";
import { createWorkspacesApi } from "../src/server/api/v2/workspaces";
import { saveAccountType } from "../src/server/auth/account-type";
import { createV2WorkspaceRepository } from "../src/server/db/v2-workspace";
import { createWorkspaceDependencies } from "../src/server/runtime/workspace";
import { customerWorkspaceFixture, runCustomerJob } from "./helpers/customer-workspace";
import { countD1Calls } from "./helpers/d1-call-count";
import { seedTestSession } from "./helpers/session";

const originalFetch = globalThis.fetch;
const databases: Awaited<ReturnType<typeof customerWorkspaceFixture>>["db"][] = [];
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const db of databases.splice(0)) db.close();
});

async function fixture() {
  const f = await customerWorkspaceFixture(new Date().toISOString());
  databases.push(f.db);
  expect((await runCustomerJob(f, "intake_questions", true, undefined, 3)).result.status).toBe(
    "completed",
  );
  await saveAccountType(f.db.binding, f.owner.userId, "customer");
  const before = await f.service.find(f.owner.userId, f.workspace.id);
  const intake = await f.service.intake(f.owner.userId, f.workspace.id);
  const questionId = intake?.batches[0]?.questions[0]?.id;
  if (!intake || !questionId) throw new Error("Missing synthetic question");
  const input = {
    expectedRevision: before.workspaceRevision,
    answers: [
      { questionId, state: "answered" as const, value: "합성 자료의 날짜를 확인했습니다." },
    ],
  };
  const app = new Hono().route("/api/me", meApi).route(
    "/api/v2/cases",
    createWorkspacesApi({
      dependencies: async (env, core) => createWorkspaceDependencies(core, env),
    }),
  );
  const rows: { route: string; method: string; calls: number; statements: number }[] = [];
  let cookie = f.owner.cookie;
  let beforeSql: (statements: string[]) => void = () => {};
  const transport = async (path: string, init?: RequestInit) => {
    if (!path.startsWith("/api/")) throw new Error("External request in synthetic fixture");
    const meter = countD1Calls(f.db.binding);
    meter.before((statements) => beforeSql(statements));
    const row = {
      route: path.endsWith("/session") ? "session" : path.split("/").slice(5).join("/"),
      method: init?.method ?? "GET",
      calls: 0,
      statements: 0,
    };
    rows.push(row);
    const response = await app.request(
      path,
      {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers)),
          cookie,
          origin: f.owner.env.BETTER_AUTH_URL,
        },
      },
      {
        ...f.owner.env,
        DB: meter.binding,
        CASE_DATA_KEY_V1: btoa("w".repeat(32)).replace(/=+$/, ""),
        APPLICATION_COST_LIMITS_ENABLED: "false",
      },
    );
    Object.assign(row, meter.work);
    return response;
  };
  // The actual resumed owner is already onboarded and has a current session.
  expect((await transport("/api/me/session")).ok).toBe(true);
  rows.length = 0;
  globalThis.fetch = ((path, init) => transport(String(path), init)) as typeof fetch;
  return {
    ...f,
    before,
    intake,
    input,
    rows,
    transport,
    setCookie: (value: string) => {
      cookie = value;
    },
    beforeSql: (hook: typeof beforeSql) => {
      beforeSql = hook;
    },
  };
}

test("canonical answer save avoids duplicate reads while verifying the acknowledged snapshot", async () => {
  const f = await fixture();
  // Include the existing UI session checks before and after casesApi.saveAnswers.
  expect((await fetch("/api/me/session")).ok).toBe(true);
  const result = await casesApi.saveAnswers(f.workspace.id, f.input);
  expect((await fetch("/api/me/session")).ok).toBe(true);
  expect(result.questions[0]?.answer).toBe(f.input.answers[0]?.value);
  expect(result.revision).toBe(f.before.workspaceRevision + 1);
  // Same local fixture before this change: 9 HTTP / 76 D1 calls / 85 SQL.
  // Counts measure local D1 method calls, never native rows or network latency.
  expect(f.rows).toHaveLength(8);
  expect(f.rows.reduce((n, r) => n + r.calls, 0)).toBe(62);
  expect(f.rows.reduce((n, r) => n + r.statements, 0)).toBe(74);
  expect(f.rows.filter((r) => r.method === "PUT")).toEqual([
    { route: "intake/answers", method: "PUT", calls: 22, statements: 33 },
  ]);
});

test("a peer answer after the PUT acknowledgment forces a fresh intake read", async () => {
  const f = await fixture();
  globalThis.fetch = (async (path, init) => {
    const response = await f.transport(String(path), init);
    if (init?.method === "PUT") {
      expect(response.ok).toBe(true);
      await f.service.answers(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
        expectedRevision: f.intake.revision + 1,
        answers: [
          {
            questionId: f.input.answers[0]?.questionId,
            status: "answered",
            value: "다른 창에서 수정한 합성 답변",
          },
        ],
      });
    }
    return response;
  }) as typeof fetch;
  const result = await casesApi.saveAnswers(f.workspace.id, f.input);
  expect(result.questions[0]?.answer).toBe("다른 창에서 수정한 합성 답변");
  expect(result.revision).toBe(f.before.workspaceRevision + 2);
  expect(f.rows.filter((r) => r.route === "intake")).toHaveLength(2);
  expect(f.rows.filter((r) => r.method === "PUT")).toHaveLength(1);
});

test("a peer summary publication and confirmation at the same intake revision invalidates the PUT snapshot", async () => {
  const f = await fixture();
  const input = {
    expectedRevision: f.input.expectedRevision,
    answers: f.intake.batches.flatMap((batch) =>
      batch.questions.map((question) => ({
        questionId: question.id,
        state: "unknown" as const,
      })),
    ),
  };
  globalThis.fetch = (async (path, init) => {
    const response = await f.transport(String(path), init);
    if (init?.method === "PUT") {
      expect(response.ok).toBe(true);
      expect((await runCustomerJob(f, "intake_summary")).result.status).toBe("completed");
      const summary = await f.service.intake(f.owner.userId, f.workspace.id);
      await f.service.confirm(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
        expectedRevision: summary?.revision,
        summaryRevision: summary?.summary?.revision,
      });
    }
    return response;
  }) as typeof fetch;
  const result = await casesApi.saveAnswers(f.workspace.id, input);
  expect(result.complete).toBe(true);
  expect(f.rows.filter((r) => r.route === "intake")).toHaveLength(2);
  expect(f.rows.filter((r) => r.method === "PUT")).toHaveLength(1);
});

for (const change of ["deleted", "owner"] as const)
  test(`an acknowledged answer is not returned after ${change} at readback`, async () => {
    const f = await fixture();
    const foreign = change === "owner" ? await seedTestSession(f.db, { consent: true }) : null;
    globalThis.fetch = (async (path, init) => {
      const response = await f.transport(String(path), init);
      if (init?.method === "PUT") {
        expect(response.ok).toBe(true);
        if (foreign) f.setCookie(foreign.cookie);
        else
          f.db.sqlite
            .query(
              "INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES('workspace',?,?)",
            )
            .run(f.workspace.id, f.now);
      }
      return response;
    }) as typeof fetch;
    await expect(casesApi.saveAnswers(f.workspace.id, f.input)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(f.rows.filter((r) => r.method === "PUT")).toHaveLength(1);
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_answers").get()).toEqual({ n: 1 });
  });

test("consent becoming stale after preflight still rejects the answer mutation", async () => {
  const f = await fixture();
  globalThis.fetch = (async (path, init) => {
    if (init?.method === "PUT")
      f.db.sqlite
        .query("UPDATE user_consents SET terms_version='stale' WHERE user_id=?")
        .run(f.owner.userId);
    return f.transport(String(path), init);
  }) as typeof fetch;
  await expect(casesApi.saveAnswers(f.workspace.id, f.input)).rejects.toMatchObject({
    code: "CONSENT_REQUIRED",
  });
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_answers").get()).toEqual({ n: 0 });
  expect((await f.service.find(f.owner.userId, f.workspace.id)).workspaceRevision).toBe(
    f.before.workspaceRevision,
  );
});

for (const change of ["revision", "deleted", "owner"] as const)
  test(`the final answer claim rejects ${change} after all reads`, async () => {
    const f = await fixture();
    const foreign = change === "owner" ? await seedTestSession(f.db, { consent: true }) : null;
    let changed = false;
    f.beforeSql((statements) => {
      if (changed || !statements.some((sql) => sql.startsWith("INSERT INTO v2_mutation_claims")))
        return;
      changed = true;
      if (foreign)
        f.db.sqlite
          .query("UPDATE v2_workspaces SET owner_id=? WHERE id=?")
          .run(foreign.userId, f.workspace.id);
      else if (change === "deleted")
        f.db.sqlite
          .query(
            "INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES('workspace',?,?)",
          )
          .run(f.workspace.id, f.now);
      else
        f.db.sqlite
          .query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?")
          .run(f.workspace.id);
    });
    await expect(casesApi.saveAnswers(f.workspace.id, f.input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(changed).toBe(true);
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_answers").get()).toEqual({ n: 0 });
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_mutation_claims").get()).toEqual({ n: 0 });
  });

for (const change of ["revision", "deleted", "owner"] as const)
  test(`metadata's final fence rejects ${change} after the combined batch read`, async () => {
    const f = await fixture();
    const foreign = change === "owner" ? await seedTestSession(f.db, { consent: true }) : null;
    const meter = countD1Calls(f.db.binding);
    let changed = false;
    meter.after((statements) => {
      if (!statements.some((sql) => sql.startsWith("SELECT a.* FROM v2_answers"))) return;
      changed = true;
      if (foreign)
        f.db.sqlite
          .query("UPDATE v2_workspaces SET owner_id=? WHERE id=?")
          .run(foreign.userId, f.workspace.id);
      else if (change === "deleted")
        f.db.sqlite
          .query(
            "INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES('workspace',?,?)",
          )
          .run(f.workspace.id, f.now);
      else
        f.db.sqlite
          .query("UPDATE v2_intakes SET revision=revision+1 WHERE id=?")
          .run(f.workspace.id);
    });
    const repository = createV2WorkspaceRepository(meter.binding, f.core.cipher);
    expect(
      await repository.metadata({ ownerId: f.owner.userId, now: f.now }, f.workspace.id),
    ).toBeNull();
    expect(changed).toBe(true);
    expect(meter.work).toEqual({ calls: 3, statements: 4 });
  });
