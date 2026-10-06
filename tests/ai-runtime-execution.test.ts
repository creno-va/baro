import { afterEach, expect, setSystemTime, test } from "bun:test";
import observation from "../docs/operations/AI-RUNTIME-OBSERVATION.json";
import { modelBounds, observationSchema, provisionAiRuntime } from "../scripts/provision-ai-budget";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2Core } from "../src/server/db/v2-core";
import { ModelError } from "../src/server/modules/llm-gateway/service";
import { executeWorkspace } from "../src/server/modules/workspace/execution";
import type { WorkspaceContext } from "../src/server/modules/workspace/pipeline";
import { createWorkspaceService } from "../src/server/modules/workspace/service";
import {
  createWorkspaceDependencies,
  hasCustomerWorkspaceAccess,
  runWorkspaceRuntime,
} from "../src/server/runtime/workspace";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  setSystemTime();
  for (const database of databases.splice(0)) database.close();
});

/** Only external transport is synthetic: admission, encrypted D1, paid execution,
 * gateway schemas, independent audit, persistence and retries use product code. */
async function fixture() {
  const preview = await createTestDatabase(),
    production = await createTestDatabase();
  databases.push(preview, production);
  const now = new Date().toISOString(),
    observed = observationSchema.parse({
      ...observation,
      checkedAt: now,
      validUntil: new Date(Date.now() + 86400000).toISOString(),
    });
  const provisioned = await provisionAiRuntime(
    { preview: preview.binding, production: production.binding },
    observed,
  );
  const owner = await seedTestSession(preview, { consent: true }),
    key = btoa("w".repeat(32)).replace(/=+$/, "");
  const core = createV2Core(
    preview.binding,
    await createCaseDataCipher({ CASE_DATA_KEY_V1: key }),
    { monthlyBudgetCapEnabled: false },
  );
  const calls: string[] = [];
  let transportError = false,
    invalidDraft = false,
    repeatedQuestions = false,
    rejectedAudit = false,
    phaseDurationMs = 0;
  const env = {
    ...owner.env,
    APP_ENV: "preview",
    MONTHLY_BUDGET_CAP_ENABLED: "false",
    CASE_DATA_KEY_V1: key,
    AI_GATEWAY_ID: "synthetic-gateway",
    AI_MODEL_TOKEN_BOUNDS_JSON: JSON.stringify(modelBounds(observed, provisioned.evidenceHash)),
    WORKSPACE_PROCESSING: {
      get: async () => {
        throw new Error("Synthetic absent workflow instance");
      },
      create: async (input: { id: string }) => ({ id: input.id }),
    },
    AI: {
      async run(_model: string, input: Record<string, unknown>) {
        const wire = input as {
          messages: { content: string }[];
          response_format: { json_schema: { name: string } };
        };
        const phase = wire.response_format.json_schema.name;
        calls.push(phase);
        if (phaseDurationMs) setSystemTime(new Date(Date.now() + phaseDurationMs));
        if (transportError) throw new Error("Synthetic provider unavailable");
        const context = JSON.parse(wire.messages[1]?.content ?? "null").data as WorkspaceContext;
        let output: unknown;
        if (phase.includes("audit")) {
          output = {
            pass: !rejectedAudit,
            findings: rejectedAudit ? [{ severity: "critical", code: "question_repetition" }] : [],
            unsupportedFactIds: [],
            legalClaimsSupported: true,
            strategyDetected: false,
          };
          rejectedAudit = false;
        } else if (phase.includes("questions")) {
          output = {
            questions: [
              {
                id: "placeholder",
                prompt: repeatedQuestions
                  ? context.intake.batches[0]?.questions[0]?.prompt
                  : `자료 확인 단계 ${context.intake.batches.length + 1}에서 확인할 내용은 무엇인가요?`,
                answerType: "text",
                options: [],
              },
            ],
          };
          repeatedQuestions = false;
        } else if (phase.includes("summary")) {
          output = {
            overview: "합성 거래 자료의 확인 준비를 정리했습니다.",
            facts: [
              {
                id: "initial_fact",
                text: context.intake.narrative,
                attribution: "user_statement",
                certainty: "reported",
                significance: "neutral",
                userEdited: false,
                references: [{ kind: "intake_narrative", intakeRevision: context.intake.revision }],
                conflictingFactIds: [],
              },
            ],
            parties: [],
            unknowns: ["거래 날짜 미확인"],
            notices: ["사용자 진술을 정리한 준비 자료입니다."],
          };
        } else {
          output = {
            text: "찾은 자료의 날짜를 확인해 주세요.",
            references: [
              {
                kind: "user_message",
                messageId: context.latestMessage?.id,
                workspaceRevision: context.latestMessage?.workspaceRevision,
              },
            ],
            warnings: [],
            facts: [],
            actions: [],
            parties: [],
            requestedSources: [],
            timeline: [],
          };
        }
        if (invalidDraft) {
          invalidDraft = false;
          output = { invalid: true };
        }
        return {
          id: `synthetic-receipt-${calls.length}`,
          service_tier: "default",
          choices: [{ message: { content: JSON.stringify({ output }) }, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 500,
            completion_tokens: 100,
            prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
          },
        };
      },
    },
  } as unknown as Env;
  const service = createWorkspaceService(core, createWorkspaceDependencies(core, env));
  const workspace = await service.create(owner.userId, crypto.randomUUID(), {
    narrative: "합성 계약 자료의 거래 날짜를 확인하고 상담을 준비하려고 합니다.",
    jurisdiction: "KR",
    subjectContext: "individual",
    turnstileToken: "synthetic",
  });
  const execute = async (jobId: string) => {
    const job = await service.job(owner.userId, workspace.id, jobId);
    if (job.target.kind !== "workspace") throw new Error("Wrong synthetic job target");
    const instance = await core
      .statement("SELECT runtime_instance_id FROM v2_jobs WHERE id=?", [jobId])
      .first<string>("runtime_instance_id");
    const pending: Promise<void>[] = [];
    const result = await runWorkspaceRuntime(
      env,
      {
        ownerId: owner.userId,
        workspaceId: workspace.id,
        workspaceRevision: job.target.workspaceRevision,
        jobId,
      },
      instance ?? "missing",
      (promise) => pending.push(promise),
    );
    await Promise.all(pending);
    return result;
  };
  const advance = async () => {
    const current = await service.find(owner.userId, workspace.id);
    return service.advance(owner.userId, workspace.id, crypto.randomUUID(), {
      expectedRevision: current.workspaceRevision,
    });
  };
  return {
    preview,
    owner,
    core,
    env,
    service,
    workspace,
    calls,
    execute,
    advance,
    failTransport: (value: boolean) => {
      transportError = value;
    },
    invalidateNextDraft: () => {
      invalidDraft = true;
    },
    repeatNextQuestions: () => {
      repeatedQuestions = true;
    },
    rejectNextAudit: () => {
      rejectedAudit = true;
    },
    simulatePhaseDuration: (durationMs: number) => {
      phaseDurationMs = durationMs;
    },
  };
}

test("funded runtime completes three question batches, summary and chat through the real paid gateway", async () => {
  const f = await fixture();
  for (let index = 0; index < 3; index++) {
    const queued = await f.advance();
    expect((await f.execute(queued.jobId)).status).toBe("completed");
    const intake = await f.service.intake(f.owner.userId, f.workspace.id);
    const batch = intake?.batches[index];
    if (!batch || !intake) throw new Error("Question batch missing");
    await f.service.answers(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
      expectedRevision: intake.revision,
      answers: batch.questions.map((question) => ({ questionId: question.id, status: "unknown" })),
    });
  }
  const summaryJob = await f.advance();
  expect((await f.execute(summaryJob.jobId)).status).toBe("completed");
  const intake = await f.service.intake(f.owner.userId, f.workspace.id);
  if (!intake?.summary) throw new Error("Summary missing");
  await f.service.confirm(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
    expectedRevision: intake.revision,
    summaryRevision: intake.summary.revision,
  });
  const current = await f.service.find(f.owner.userId, f.workspace.id);
  const chat = await f.service.send(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
    expectedRevision: current.workspaceRevision,
    text: "새로운 자료를 찾았습니다.",
    selectedFileIds: [],
  });
  expect((await f.execute(chat.jobId)).status).toBe("completed");
  expect(f.calls).toHaveLength(10);
  expect(f.calls.filter((phase) => phase.includes("audit"))).toHaveLength(5);
  expect((await f.service.messages(f.owner.userId, f.workspace.id)).map((m) => m.role)).toContain(
    "assistant",
  );
  expect(
    f.preview.sqlite
      .query("SELECT count(*) AS n FROM v2_cost_attempts WHERE state='settled'")
      .get(),
  ).toEqual({ n: 10 });
  expect((await f.execute(chat.jobId)).status).toBe("completed");
  expect(f.calls).toHaveLength(10);
});

test("schema correction is separately paid and its validated result is published", async () => {
  const f = await fixture();
  f.invalidateNextDraft();
  const queued = await f.advance();
  expect((await f.execute(queued.jobId)).status).toBe("completed");
  expect(f.calls).toHaveLength(3);
  expect(f.calls[2]).toContain("audit");
});

test("a repeated follow-up is regenerated with paid admission and preserves the saved answer", async () => {
  const f = await fixture();
  const first = await f.advance();
  expect((await f.execute(first.jobId)).status).toBe("completed");
  const intake = await f.service.intake(f.owner.userId, f.workspace.id);
  const question = intake?.batches[0]?.questions[0];
  if (!intake || !question) throw new Error("Question missing");
  const answers = [
    { questionId: question.id, status: "answered" as const, value: "계약서는 보관 중입니다." },
  ];
  await f.service.answers(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
    expectedRevision: intake.revision,
    answers,
  });
  f.repeatNextQuestions();
  const followup = await f.advance();
  expect((await f.execute(followup.jobId)).status).toBe("completed");
  const saved = await f.service.intake(f.owner.userId, f.workspace.id);
  expect(saved?.batches).toHaveLength(2);
  expect(saved?.batches[0]?.answers).toEqual(answers);
  expect(saved?.batches[1]?.questions[0]?.prompt).not.toBe(question.prompt);
  expect(f.calls).toHaveLength(5);
  expect(
    f.preview.sqlite
      .query("SELECT count(*) AS n FROM v2_cost_attempts WHERE state='settled'")
      .get(),
  ).toEqual({ n: 5 });
  expect((await f.execute(followup.jobId)).status).toBe("completed");
  expect(f.calls).toHaveLength(5);
});

test("an audit rejection generates and independently audits a new draft under paid execution", async () => {
  const f = await fixture();
  f.rejectNextAudit();
  const queued = await f.advance();
  expect((await f.execute(queued.jobId)).status).toBe("completed");
  expect(f.calls).toHaveLength(4);
  expect(f.calls.filter((phase) => phase.includes("audit"))).toHaveLength(2);
  expect((await f.service.intake(f.owner.userId, f.workspace.id))?.batches).toHaveLength(1);
  expect(
    f.preview.sqlite
      .query("SELECT count(*) AS n FROM v2_cost_attempts WHERE state='settled'")
      .get(),
  ).toEqual({ n: 4 });
});

test("regeneration renews the fenced lease between paid phases when total processing exceeds five minutes", async () => {
  const f = await fixture();
  f.rejectNextAudit();
  f.simulatePhaseDuration(80_000);
  const queued = await f.advance();
  const started = Date.now();
  expect((await f.execute(queued.jobId)).status).toBe("completed");
  expect(Date.now() - started).toBeGreaterThanOrEqual(320_000);
  expect(f.calls).toHaveLength(4);
  expect((await f.service.find(f.owner.userId, f.workspace.id)).currentJobId).toBeNull();
  expect((await f.service.intake(f.owner.userId, f.workspace.id))?.batches).toHaveLength(1);
});

test("a clock tick between lease arguments cannot stop acquisition or renewal", async () => {
  const f = await fixture();
  const queued = await f.advance();
  const job = await f.service.job(f.owner.userId, f.workspace.id, queued.jobId);
  if (job.target.kind !== "workspace") throw new Error("Wrong synthetic job target");
  let ticks = 0,
    reachedPipeline = 0;
  const base = Date.now();
  const rejectDraft = async () => {
    reachedPipeline++;
    throw new ModelError("POLICY_REJECTED");
  };
  const result = await executeWorkspace(
    f.core,
    {
      ownerId: f.owner.userId,
      workspaceId: f.workspace.id,
      workspaceRevision: job.target.workspaceRevision,
      jobId: queued.jobId,
    },
    `${queued.jobId}-1`,
    {
      clock: () => new Date(base + ticks++).toISOString(),
      authorize: (ownerId) => hasCustomerWorkspaceAccess(f.core, ownerId),
      pipeline: async () => ({ questions: rejectDraft, summary: rejectDraft, chat: rejectDraft }),
    },
  );
  // A deliberate draft rejection proves both acquire and the preceding renewal
  // accepted their exact five-minute leases; no timing retry masks a stopped job.
  expect(result.status).toBe("failed");
  expect(reachedPipeline).toBe(1);
  expect((await f.service.job(f.owner.userId, f.workspace.id, queued.jobId)).failure).toBe(
    "POLICY_REJECTED",
  );
});

test("missing gateway configuration fails admission before consuming quota or creating a job", async () => {
  const f = await fixture();
  for (const id of ["", " "]) {
    const service = createWorkspaceService(
      f.core,
      createWorkspaceDependencies(f.core, { ...f.env, AI_GATEWAY_ID: id }),
    );
    await expect(
      service.advance(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
        expectedRevision: f.workspace.workspaceRevision,
      }),
    ).rejects.toThrow("BUDGET_UNAVAILABLE");
  }
  expect(f.preview.sqlite.query("SELECT count(*) AS n FROM v2_jobs").get()).toEqual({ n: 0 });
  expect(f.preview.sqlite.query("SELECT count(*) AS n FROM v2_cost_attempts").get()).toEqual({
    n: 0,
  });
  expect(f.calls).toHaveLength(0);
});

test("provider outage preserves failure and a user retry runs with a new paid admission", async () => {
  const f = await fixture();
  f.failTransport(true);
  const queued = await f.advance();
  expect((await f.execute(queued.jobId)).status).toBe("failed");
  const failed = await f.service.job(f.owner.userId, f.workspace.id, queued.jobId);
  expect(failed.failure).toBe("MODEL_UNAVAILABLE");
  expect(failed.retryable).toBe(true);
  f.failTransport(false);
  const current = await f.service.find(f.owner.userId, f.workspace.id);
  await f.service.retry(f.owner.userId, f.workspace.id, queued.jobId, {
    expectedRevision: current.workspaceRevision,
  });
  expect((await f.execute(queued.jobId)).status).toBe("completed");
  expect(f.calls).toHaveLength(3);
});
