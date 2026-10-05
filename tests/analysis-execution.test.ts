import { afterEach, expect, test } from "bun:test";
import { answersResponseSchema, caseDetailResponseSchema } from "../src/contracts";
import { api } from "../src/server/api";
import { createCaseDataCipher } from "../src/server/crypto";
import {
  createAnalysisExecution,
  type ExecutionPhase,
  reconcileAnalysisTimeouts,
} from "../src/server/modules/case-structure/execution";
import { admitCase, domainRepository } from "../src/server/modules/intake/service";
import { createLegalRetrieval } from "../src/server/modules/legal-retrieval/service";
import { createLlmGateway, type GatewayBinding } from "../src/server/modules/llm-gateway/service";
import { guidance, questions } from "./fixtures/contracts";
import list from "./fixtures/legal/official-list.json";
import detail from "./fixtures/legal/official-sample.json";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
const phases: ExecutionPhase[] = [
  "initialize",
  "minimize",
  "screening",
  "structure",
  "questions",
  "retrieval",
  "generation",
  "validation",
  "finish",
];
export async function analysisFixture(
  mode: "guidance" | "questions" | "out_of_scope" | "urgent_redirect" = "guidance",
) {
  const db = await createTestDatabase();
  databases.push(db);
  const session = await seedTestSession(db, { consent: true });
  const workflow = {
    get: async () => ({ status: async () => ({ status: "complete" }), sendEvent: async () => {} }),
    create: async () => ({}),
  } as unknown as Workflow;
  const env = {
    ...session.env,
    CASE_DATA_KEY_V1: btoa("x".repeat(32)).replace(/=+$/, ""),
    ANALYSIS_WORKFLOW: workflow,
    ANALYSIS_ACCOUNT_LIMIT: { limit: async () => ({ success: true }) },
    LAW_API_OC: "test",
  } as Env;
  const calls: string[] = [],
    wire: unknown[] = [];
  const binding: GatewayBinding = {
    async run(_model, input) {
      const phase = (
        input.response_format as { json_schema: { name: string } }
      ).json_schema.name.replace(/^baro_|_v1$/g, "");
      calls.push(phase);
      wire.push(input);
      const data = JSON.parse((input.messages as { content: string }[])[1]?.content ?? "{}").data;
      let output: unknown;
      if (phase === "minimize")
        output = {
          schemaVersion: "1",
          sentences: ["합성 사용자 A는 지인에게 금전을 대여했다고 진술했습니다."],
          maskingHints: [],
        };
      if (phase === "screening")
        output = {
          schemaVersion: "1",
          inScope: mode !== "out_of_scope",
          urgency: mode === "urgent_redirect" ? "urgent" : "none",
          reasonCode:
            mode === "out_of_scope"
              ? "UNSUPPORTED_CASE_TYPE"
              : mode === "urgent_redirect"
                ? "IMMEDIATE_DANGER"
                : "IN_SCOPE",
        };
      if (phase === "structure")
        output = {
          schemaVersion: "1",
          parties: [],
          amounts: [],
          dates: [],
          agreements: [],
          performance: [],
          evidence: [],
          unknowns: mode === "questions" ? ["반환 약정일"] : [],
        };
      if (phase === "questions") output = { schemaVersion: "1", questions };
      if (phase === "generation")
        output = {
          ...guidance,
          asOfDate: data.asOfDate,
          citations: data.retrieval.chunks.map((c: { citation: unknown }) => c.citation),
          issues: guidance.issues.map((i) => ({
            ...i,
            citationIds: [data.retrieval.chunks[0].citation.id],
          })),
        };
      if (phase === "validation")
        output = { schemaVersion: "1", pass: true, sanitizedResult: data.draft, findings: [] };
      return {
        choices: [{ message: { content: JSON.stringify({ output }) }, finish_reason: "stop" }],
      };
    },
  };
  const gateway = createLlmGateway(
      { AI: binding, AI_GATEWAY_ID: "synthetic" },
      { sleep: async () => {} },
    ),
    repo = await domainRepository(env);
  const legal = createLegalRetrieval(
    env,
    repo,
    async (url) => Response.json(url.includes("lawSearch") ? list : detail),
    async () => {},
  );
  const admitted = await admitCase(
    env,
    session.userId,
    crypto.randomUUID(),
    {
      narrative:
        "합성 사용자 A는 지인에게 금전을 대여했다고 진술했습니다. test@example.test 010-1234-5678",
      turnstileToken: "synthetic",
    },
    new Date().toISOString(),
    async () => true,
  );
  if (admitted.kind !== "created") throw new Error("fixture");
  const identity = { analysisId: admitted.response.analysisId, inputRevision: 1 };
  const execute = (attempt = 1, params = identity, clock?: () => string) =>
    createAnalysisExecution(env, params, `${params.analysisId}-${attempt}`, gateway, legal, clock);
  return {
    db,
    env,
    session,
    repo,
    calls,
    wire,
    identity,
    caseId: admitted.response.caseId,
    execute,
    gateway,
    legal,
  };
}
async function run(execution: ReturnType<typeof createAnalysisExecution>) {
  for (const phase of phases) {
    const result = await execution.phase(phase);
    expect(Object.keys(result).sort()).toEqual(["analysisId", "status"]);
    if (["stopped", "failed", "waiting_for_answers"].includes(result.status)) return result;
  }
  return null;
}
function post(
  f: Awaited<ReturnType<typeof analysisFixture>>,
  path: string,
  body: unknown,
  key = crypto.randomUUID(),
  cookie = f.session.cookie,
) {
  return api.request(
    `/cases/${f.caseId}/${path}`,
    {
      method: "POST",
      headers: {
        cookie,
        origin: f.env.BETTER_AUTH_URL,
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: JSON.stringify(body),
    },
    f.env,
  );
}
test("synthetic admission to official citations/result, checkpoint replay, re-read and delete", async () => {
  const f = await analysisFixture();
  const execution = f.execute();
  await execution.phase("initialize");
  await execution.phase("minimize");
  await f.execute().phase("minimize");
  expect(f.calls).toEqual(["minimize"]);
  expect(JSON.stringify(f.wire)).not.toContain("test@example.test");
  expect(JSON.stringify(f.wire)).not.toContain("010-1234");
  for (const phase of phases.slice(2)) await f.execute().phase(phase);
  const analysis = await f.repo.findCurrentAnalysis(f.session.userId, f.caseId);
  expect(analysis?.status).toBe("completed");
  expect(analysis?.modelId).toBe("openai/gpt-6-sol");
  const result = await api.request(
    `/cases/${f.caseId}`,
    { headers: { cookie: f.session.cookie } },
    f.env,
  );
  expect(result.status).toBe(200);
  const data = caseDetailResponseSchema.parse(await result.json());
  expect(data.result?.kind).toBe("guidance");
  if (data.result?.kind !== "guidance") throw new Error("fixture");
  expect(data.result.citations).toHaveLength(2);
  expect(await f.repo.listCitations(f.session.userId, f.caseId)).toHaveLength(2);
  await f.repo.deleteOwnedCase(
    f.session.userId,
    f.caseId,
    crypto.randomUUID(),
    new Date().toISOString(),
  );
  const count = f.calls.length;
  await run(f.execute());
  expect(f.calls.length).toBe(count);
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM analyses").get()).toEqual({ n: 0 });
});
test("scope and danger stop before structure/retrieval/guidance", async () => {
  for (const mode of ["out_of_scope", "urgent_redirect"] as const) {
    const f = await analysisFixture(mode);
    await run(f.execute());
    expect(f.calls).toEqual(["minimize", "screening"]);
    const result = caseDetailResponseSchema.parse(
      await (
        await api.request(`/cases/${f.caseId}`, { headers: { cookie: f.session.cookie } }, f.env)
      ).json(),
    );
    expect(result.result?.kind).toBe(mode);
  }
});
test("one question batch, unknown/skipped, concurrent replay and revision CAS are atomic", async () => {
  const f = await analysisFixture("questions");
  expect((await run(f.execute()))?.status).toBe("waiting_for_answers");
  const body = {
      inputRevision: 1,
      answers: [
        { questionId: "q1", status: "unknown" },
        { questionId: "q2", status: "skipped" },
      ],
    },
    key = crypto.randomUUID();
  expect((await post(f, "answers", body, key, "")).status).toBe(401);
  expect(
    (
      await post(f, "answers", {
        ...body,
        answers: [{ questionId: "invented", status: "unknown" }],
      })
    ).status,
  ).toBe(400);
  const responses = await Promise.all([
    post(f, "answers", body, key),
    post(f, "answers", body, key),
  ]);
  expect(responses.map((r) => r.status)).toEqual([202, 202]);
  const first = answersResponseSchema.parse(await responses[0]?.json());
  expect(answersResponseSchema.parse(await responses[1]?.json())).toEqual(first);
  expect(
    (
      await post(
        f,
        "answers",
        {
          ...body,
          answers: [
            { questionId: "q1", status: "skipped" },
            { questionId: "q2", status: "skipped" },
          ],
        },
        key,
      )
    ).status,
  ).toBe(409);
  expect((await post(f, "answers", body)).status).toBe(409);
  const current = await f.repo.findCurrentAnalysis(f.session.userId, f.caseId);
  expect(current?.inputRevision).toBe(2);
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM dispatch_outbox").get()).toEqual({ n: 2 });
  const cipher = await createCaseDataCipher(f.env);
  const old = f.db.sqlite
    .query("SELECT encrypted_answers AS value FROM analyses WHERE id=?")
    .get(f.identity.analysisId) as { value: string };
  expect(
    JSON.parse(
      await cipher.decrypt(old.value, {
        table: "analyses",
        column: "encrypted_answers",
        rowId: f.identity.analysisId,
        userId: f.session.userId,
      }),
    ),
  ).toEqual(body.answers);
  const next = f.execute(1, { analysisId: current?.id ?? "", inputRevision: 2 });
  await run(next);
  expect((await f.repo.findCase(f.session.userId, f.caseId))?.questionsAsked).toBe(2);
  expect(f.calls.filter((p) => p === "questions")).toHaveLength(1);
  expect((await f.repo.findCurrentAnalysis(f.session.userId, f.caseId))?.status).toBe("completed");
});
test("answer idempotency write failure rolls back revision, superseding and outbox", async () => {
  const f = await analysisFixture("questions");
  await run(f.execute());
  f.db.sqlite.exec(
    "CREATE TRIGGER reject_answer BEFORE INSERT ON idempotency_records WHEN NEW.route LIKE '%/answers' BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  );
  const response = await post(f, "answers", {
    inputRevision: 1,
    answers: [
      { questionId: "q1", status: "unknown" },
      { questionId: "q2", status: "skipped" },
    ],
  });
  expect(response.status).toBe(500);
  expect((await f.repo.findCase(f.session.userId, f.caseId))?.inputRevision).toBe(1);
  expect((await f.repo.findCurrentAnalysis(f.session.userId, f.caseId))?.status).toBe(
    "waiting_for_answers",
  );
  expect(f.db.sqlite.query("SELECT count(*) AS n FROM analyses").get()).toEqual({ n: 1 });
});
test("24h expiry and process-death timeout; retry capped at two with old instance blocked", async () => {
  const f = await analysisFixture("questions");
  await run(f.execute());
  const analysis = await f.repo.findCurrentAnalysis(f.session.userId, f.caseId);
  await reconcileAnalysisTimeouts(f.env, analysis?.clarificationExpiresAt ?? "");
  expect((await f.repo.findCurrentAnalysis(f.session.userId, f.caseId))?.failureCode).toBe(
    "CLARIFICATION_EXPIRED",
  );
  expect((await post(f, "retry", { inputRevision: 1 })).status).toBe(409);
  const g = await analysisFixture();
  await g.execute().phase("initialize");
  await reconcileAnalysisTimeouts(g.env, new Date(Date.now() + 600_001).toISOString());
  expect((await g.repo.findCurrentAnalysis(g.session.userId, g.caseId))?.failureCode).toBe(
    "ANALYSIS_TIMEOUT",
  );
  for (let attempt = 1; attempt <= 2; attempt++) {
    const key = crypto.randomUUID();
    expect((await post(g, "retry", { inputRevision: 1 }, key)).status).toBe(202);
    expect((await post(g, "retry", { inputRevision: 1 }, key)).status).toBe(202);
    expect((await g.execute(attempt).phase("minimize")).status).toBe("stopped");
    await g.execute(attempt + 1).phase("initialize");
    await reconcileAnalysisTimeouts(g.env, new Date(Date.now() + 600_001).toISOString());
  }
  expect((await post(g, "retry", { inputRevision: 1 })).status).toBe(409);
  expect((await g.repo.findCurrentAnalysis(g.session.userId, g.caseId))?.attempt).toBe(3);
});
test("crash reservations survive a new executor; correction budget and deletion forbid resurrection", async () => {
  const f = await analysisFixture();
  await f.execute().phase("initialize");
  await f.execute().phase("minimize");
  const a = await f.repo.findCurrentAnalysis(f.session.userId, f.caseId);
  if (!a?.encryptedContext) throw new Error("fixture");
  const cipher = await createCaseDataCipher(f.env),
    aad = {
      table: "analyses" as const,
      column: "encrypted_context" as const,
      rowId: a.id,
      userId: f.session.userId,
    };
  const cp = JSON.parse(await cipher.decrypt(a.encryptedContext, aad));
  delete cp.minimize;
  cp.counts.minimize = 3;
  await f.repo.saveCheckpoint(
    {
      ownerId: f.session.userId,
      caseId: f.caseId,
      analysisId: a.id,
      inputRevision: 1,
      attempt: 1,
      expectedStatus: "screening",
    },
    JSON.stringify(cp),
    new Date().toISOString(),
  );
  expect((await f.execute().phase("minimize")).status).toBe("failed");
  expect(f.calls).toEqual(["minimize"]);
  const g = await analysisFixture();
  await g.execute().phase("initialize");
  const execution = createAnalysisExecution(
    g.env,
    g.identity,
    `${g.identity.analysisId}-1`,
    {
      async call(...args) {
        const value = await g.gateway.call(...args);
        await g.repo.deleteOwnedCase(
          g.session.userId,
          g.caseId,
          crypto.randomUUID(),
          new Date().toISOString(),
        );
        return value;
      },
    },
    g.legal,
  );
  expect((await execution.phase("minimize")).status).toBe("stopped");
  expect(g.db.sqlite.query("SELECT count(*) AS n FROM cases").get()).toEqual({ n: 0 });
  expect(g.db.sqlite.query("SELECT count(*) AS n FROM analyses").get()).toEqual({ n: 0 });
});
test("concurrent distinct retry keys claim only one attempt; failed idempotency insert rolls back", async () => {
  const f = await analysisFixture();
  await f.execute().phase("initialize");
  await reconcileAnalysisTimeouts(f.env, new Date(Date.now() + 600_001).toISOString());
  f.db.sqlite.exec(
    "CREATE TRIGGER reject_retry BEFORE INSERT ON idempotency_records WHEN NEW.route LIKE '%/retry' BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  );
  expect((await post(f, "retry", { inputRevision: 1 })).status).toBe(500);
  expect((await f.repo.findCurrentAnalysis(f.session.userId, f.caseId))?.attempt).toBe(1);
  f.db.sqlite.exec("DROP TRIGGER reject_retry");
  const responses = await Promise.all([
    post(f, "retry", { inputRevision: 1 }),
    post(f, "retry", { inputRevision: 1 }),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([202, 409]);
  expect((await f.repo.findCurrentAnalysis(f.session.userId, f.caseId))?.attempt).toBe(2);
});
test("durable legal request budgets and unknown checkpoint version fail closed", async () => {
  const f = await analysisFixture();
  for (const phase of phases.slice(0, 5)) await f.execute().phase(phase);
  const a = await f.repo.findCurrentAnalysis(f.session.userId, f.caseId);
  if (!a?.encryptedContext) throw new Error("fixture");
  const cipher = await createCaseDataCipher(f.env),
    aad = {
      table: "analyses" as const,
      column: "encrypted_context" as const,
      rowId: a.id,
      userId: f.session.userId,
    };
  const cp = JSON.parse(await cipher.decrypt(a.encryptedContext, aad));
  cp.counts["legal:list"] = 3;
  await f.repo.saveCheckpoint(
    {
      ownerId: f.session.userId,
      caseId: f.caseId,
      analysisId: a.id,
      inputRevision: 1,
      attempt: 1,
      expectedStatus: "retrieving",
    },
    JSON.stringify(cp),
    new Date().toISOString(),
  );
  expect((await f.execute().phase("retrieval")).status).toBe("failed");
  expect((await f.repo.findCurrentAnalysis(f.session.userId, f.caseId))?.failureCode).toBe(
    "LEGAL_SOURCE_UNAVAILABLE",
  );
  const g = await analysisFixture();
  await g.execute().phase("initialize");
  await g.execute().phase("minimize");
  const row = await g.repo.findCurrentAnalysis(g.session.userId, g.caseId);
  if (!row?.encryptedContext) throw new Error("fixture");
  const decoded = JSON.parse(
    await cipher.decrypt(row.encryptedContext, { ...aad, rowId: row.id, userId: g.session.userId }),
  );
  decoded.schemaVersion = "2";
  await g.repo.saveCheckpoint(
    {
      ownerId: g.session.userId,
      caseId: g.caseId,
      analysisId: row.id,
      inputRevision: 1,
      attempt: 1,
      expectedStatus: "screening",
    },
    JSON.stringify(decoded),
    new Date().toISOString(),
  );
  expect((await g.execute().phase("minimize")).status).toBe("failed");
  expect((await g.repo.findCurrentAnalysis(g.session.userId, g.caseId))?.failureCode).toBe(
    "MODEL_SCHEMA_INVALID",
  );
});
