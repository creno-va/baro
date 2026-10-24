import { afterEach, expect, setSystemTime, test } from "bun:test";
import { modelBounds, observationSchema, provisionAiRuntime } from "../scripts/provision-ai-budget";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2Core } from "../src/server/db/v2-core";
import type { prepareGatewayWireInput } from "../src/server/modules/llm-gateway/service";
import { createWorkspaceService } from "../src/server/modules/workspace/service";
import { createWorkspaceDependencies, runWorkspaceRuntime } from "../src/server/runtime/workspace";
import { createTestDatabase } from "./helpers/d1";
import { countD1Calls } from "./helpers/d1-call-count";
import { syntheticGatewayInput } from "./helpers/gateway-input";
import observation from "./helpers/gemini-observation";
import { seedTestSession } from "./helpers/session";

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  setSystemTime();
  for (const db of databases.splice(0)) db.close();
});

async function fixture(before: string, after: string, priced = false) {
  setSystemTime(new Date(before));
  const db = await createTestDatabase();
  databases.push(db);
  const observed = observationSchema.parse({
    ...observation,
    checkedAt: before,
    validUntil: new Date(Date.parse(after) + 86400000).toISOString(),
  });
  let evidence = "a".repeat(64);
  if (priced) {
    const production = await createTestDatabase();
    databases.push(production);
    evidence = (
      await provisionAiRuntime({ preview: db.binding, production: production.binding }, observed)
    ).evidenceHash;
  }
  const owner = await seedTestSession(db, { consent: true });
  const key = btoa("w".repeat(32)).replace(/=+$/, "");
  const meter = countD1Calls(db.binding);
  const core = createV2Core(meter.binding, await createCaseDataCipher({ CASE_DATA_KEY_V1: key }), {
    applicationCostLimitsEnabled: priced,
    monthlyBudgetCapEnabled: false,
  });
  const calls: { phase: string; data: Record<string, unknown> }[] = [];
  let providerReject = false;
  const env = {
    ...owner.env,
    DB: meter.binding,
    APP_ENV: "preview",
    APPLICATION_COST_LIMITS_ENABLED: String(priced),
    MONTHLY_BUDGET_CAP_ENABLED: "false",
    CASE_DATA_KEY_V1: key,
    AI_GATEWAY_ID: "synthetic-calendar",
    AI_MODEL_TOKEN_BOUNDS_JSON: JSON.stringify(modelBounds(observed, evidence)),
    WORKSPACE_PROCESSING: {
      get: async () => {
        throw new Error("Synthetic absent instance");
      },
      create: async (input: { id: string }) => ({ id: input.id }),
    },
    AI: {
      run: async (_model: string, input: ReturnType<typeof prepareGatewayWireInput>) => {
        const { name: phase, data } = syntheticGatewayInput(input);
        calls.push({ phase, data });
        if (providerReject)
          throw Object.assign(new Error("Synthetic definitive provider error"), { status: 401 });
        const output = phase.includes("audit")
          ? {
              pass: true,
              findings: [],
              unsupportedFactIds: [],
              legalClaimsSupported: true,
              strategyDetected: false,
            }
          : {
              questions: [
                {
                  id: "placeholder",
                  prompt: "자료에서 확인할 날짜가 있나요?",
                  answerType: "text",
                  options: [],
                },
              ],
            };
        return {
          id: `synthetic_calendar_${calls.length}`,
          service_tier: "default",
          choices: [{ message: { content: JSON.stringify({ output }) }, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
          },
        };
      },
    },
  } as unknown as Env;
  const service = createWorkspaceService(core, createWorkspaceDependencies(core, env));
  const workspace = await service.create(owner.userId, crypto.randomUUID(), {
    narrative: "합성 자료의 날짜를 확인하고 상담을 준비합니다.",
    jurisdiction: "KR",
    subjectContext: "individual",
    turnstileToken: "synthetic",
  });
  let reads = 0;
  let crossed = false;
  const duringPrepare = (secondDisagreement = false) =>
    meter.after((sqls) => {
      if (!crossed && sqls.some((sql) => sql.startsWith("SELECT b.id FROM v2_citation_bindings"))) {
        crossed = true;
        setSystemTime(new Date(after));
      }
      if (
        sqls.some((sql) => sql.startsWith("SELECT p.id FROM v2_billing_principals p JOIN user u"))
      ) {
        reads++;
        // Deliberate synthetic clock regression tests the second-disagreement guard.
        if (secondDisagreement && reads === 1) setSystemTime(new Date(before));
      }
    });
  const advance = () =>
    service.advance(owner.userId, workspace.id, crypto.randomUUID(), {
      expectedRevision: workspace.workspaceRevision,
    });
  const execute = async (jobId: string) => {
    meter.after(() => {});
    const job = await service.job(owner.userId, workspace.id, jobId);
    if (job.target.kind !== "workspace") throw new Error("Synthetic job target");
    const instance = db.sqlite
      .query("SELECT runtime_instance_id FROM v2_jobs WHERE id=?")
      .get(jobId) as { runtime_instance_id: string };
    const pending: Promise<void>[] = [];
    const result = await runWorkspaceRuntime(
      env,
      {
        ownerId: owner.userId,
        workspaceId: workspace.id,
        workspaceRevision: job.target.workspaceRevision,
        jobId,
      },
      instance.runtime_instance_id,
      (promise) => pending.push(promise),
    );
    await Promise.all(pending);
    return result;
  };
  return {
    db,
    service,
    workspace,
    owner,
    calls,
    duringPrepare,
    advance,
    execute,
    reads: () => reads,
    rejectProvider: (value: boolean) => {
      providerReject = value;
    },
  };
}

const crossings = [
  ["2026-10-14T14:59:59.900Z", "2026-10-14T15:00:00.100Z", "2026-10-14", "2026-10-15"],
  ["2026-10-31T14:59:59.900Z", "2026-10-31T15:00:00.100Z", "2026-10-31", "2026-11-01"],
  ["2026-12-31T14:59:59.900Z", "2026-12-31T15:00:00.100Z", "2026-12-31", "2027-01-01"],
] as const;

for (const mode of ["dispatch", "prepare"] as const) {
  test.each(crossings)(
    `${mode} crosses %s without changing the immutable admission wire`,
    async (before, after, beforeDate, afterDate) => {
      const f = await fixture(before, after);
      if (mode === "prepare") f.duringPrepare();
      const queued = await f.advance();
      expect(f.calls).toHaveLength(0);
      const plans = f.db.sqlite
        .query("SELECT created_at FROM v2_execution_job_plans WHERE job_id=?")
        .all(queued.jobId) as { created_at: string }[];
      expect(plans).toEqual([{ created_at: mode === "prepare" ? after : before }]);
      if (mode === "prepare") expect(f.reads()).toBe(2);
      setSystemTime(new Date(after));
      expect((await f.execute(queued.jobId)).status).toBe("completed");
      expect(f.calls).toHaveLength(2);
      const calendar = {
        localDate: mode === "prepare" ? afterDate : beforeDate,
        timeZone: "Asia/Seoul",
      };
      expect(f.calls[0]?.data.calendar).toEqual(calendar);
      expect(f.calls[1]?.data.context).toMatchObject({ calendar });
      expect((await f.service.intake(f.owner.userId, f.workspace.id))?.batches).toHaveLength(1);
    },
  );
}

test("a second calendar disagreement creates no job, hold, admission or provider call", async () => {
  const row = crossings[0];
  const f = await fixture(row[0], row[1]);
  f.duringPrepare(true);
  await expect(f.advance()).rejects.toMatchObject({ code: "BUDGET_UNAVAILABLE" });
  expect(f.reads()).toBe(2);
  expect(f.calls).toHaveLength(0);
  for (const table of [
    "v2_jobs",
    "v2_paid_holds",
    "v2_runtime_plans",
    "v2_execution_admissions",
    "v2_cost_attempts",
  ])
    expect(f.db.sqlite.query(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
});

test("the priced-mode admission also keeps its actual created-at day across dispatch", async () => {
  const row = crossings[0];
  const f = await fixture(row[0], row[1], true);
  const queued = await f.advance();
  const original = f.db.sqlite
    .query("SELECT created_at FROM v2_runtime_plans WHERE job_id=?")
    .get(queued.jobId);
  expect(original).toEqual({ created_at: row[0] });
  setSystemTime(new Date(row[1]));
  expect((await f.execute(queued.jobId)).status).toBe("completed");
  expect(f.calls[0]?.data.calendar).toEqual({ localDate: row[2], timeZone: "Asia/Seoul" });
  expect(f.calls[1]?.data.context).toMatchObject({ calendar: f.calls[0]?.data.calendar });
  expect(
    f.db.sqlite
      .query("SELECT created_at FROM v2_runtime_plans WHERE job_id=? ORDER BY created_at LIMIT 1")
      .get(queued.jobId),
  ).toEqual(original);
});

test("an explicit retry takes the new admission day while preserving the old attempt timestamp", async () => {
  const row = crossings[0];
  const f = await fixture(row[0], row[1]);
  const queued = await f.advance();
  f.rejectProvider(true);
  expect((await f.execute(queued.jobId)).status).toBe("failed");
  const before = f.db.sqlite
    .query("SELECT attempt_id,created_at,state FROM v2_execution_admissions WHERE job_id=?")
    .all(queued.jobId);
  expect(before).toHaveLength(1);
  f.rejectProvider(false);
  setSystemTime(new Date(row[1]));
  const current = await f.service.find(f.owner.userId, f.workspace.id);
  expect(
    (
      await f.service.retry(f.owner.userId, f.workspace.id, queued.jobId, {
        expectedRevision: current.workspaceRevision,
      })
    ).status,
  ).toBe("queued");
  expect((await f.execute(queued.jobId)).status).toBe("completed");
  expect(f.calls).toHaveLength(3);
  expect(f.calls[0]?.data.calendar).toEqual({ localDate: row[2], timeZone: "Asia/Seoul" });
  expect(f.calls[1]?.data.calendar).toEqual({ localDate: row[3], timeZone: "Asia/Seoul" });
  expect(f.calls[2]?.data.context).toMatchObject({ calendar: f.calls[1]?.data.calendar });
  expect(
    f.db.sqlite
      .query(
        "SELECT attempt_id,created_at,state FROM v2_execution_admissions WHERE job_id=? AND created_at=?",
      )
      .all(queued.jobId, row[0]),
  ).toEqual(before);
});
