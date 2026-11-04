import { afterEach, expect, setSystemTime, test } from "bun:test";
import { modelBounds } from "../scripts/provision-ai-budget";
import type { V2CaseContext, V2Fact } from "../src/contracts/v2";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2ReworkRepository } from "../src/server/db/v2-rework";
import { createReportsService } from "../src/server/modules/reports/service";
import { createReworkCaseService } from "../src/server/modules/rework/case-context";
import { preparedAnalysisRecordSchema } from "../src/server/modules/rework/records";
import { createReportContinuation } from "../src/server/modules/rework/report-continuation";
import {
  createReworkStateService,
  preparedAnalysisMatchesScope,
  readPreparedAnalysis,
} from "../src/server/modules/rework/state";
import { createLegalAnalysisJobs } from "../src/server/runtime/rework-analysis";
import { syntheticGatewayInput } from "./helpers/gateway-input";
import observation from "./helpers/gemini-observation";
import { reportFixture } from "./helpers/report-fixture";

const fixtures: Awaited<ReturnType<typeof reportFixture>>[] = [];
afterEach(() => {
  setSystemTime();
  for (const f of fixtures.splice(0)) f.db.close();
});
async function fixture(
  purpose: "prepare_claim" | "respond_to_claim" = "prepare_claim",
  beforeReport?: () => Promise<void>,
  procedure?: V2CaseContext["procedure"],
) {
  const f = await reportFixture();
  fixtures.push(f);
  setSystemTime(new Date(f.actor.now));
  const core = createV2Core(f.db.binding, f.core.cipher, { applicationCostLimitsEnabled: false });
  const fact: V2Fact = {
    id: crypto.randomUUID(),
    text: "상대방과 합성 반환 약속을 주고받았다는 진술입니다.",
    attribution: "user_statement",
    certainty: "reported",
    significance: "neutral",
    conflictingFactIds: [],
    userEdited: false,
    references: [{ kind: "intake_narrative", intakeRevision: 1 }],
  };
  const factRow = crypto.randomUUID();
  f.db.sqlite
    .query(
      "INSERT INTO v2_facts(id,entity_id,workspace_id,revision,summary_revision,encrypted_payload) VALUES(?,?,?,1,1,?)",
    )
    .run(
      factRow,
      fact.id,
      f.workspaceId,
      await core.encrypt("v2_facts", factRow, f.actor.ownerId, 1, fact),
    );
  await createReworkCaseService(core, { clock: () => f.actor.now }).update(
    f.actor.ownerId,
    f.workspaceId,
    crypto.randomUUID(),
    {
      expectedRevision: f.rev(),
      casePurpose: purpose,
      subjectContext: "individual",
      procedure: procedure ?? { kind: "unconfirmed", stage: "unconfirmed", description: null },
    },
  );
  const calls: string[] = [],
    planningBudgets: unknown[] = [],
    continuations: string[] = [],
    pending: Promise<void>[] = [];
  let outage = false,
    retrievalCalls = 0,
    revoke = false;
  const env = {
    APP_ENV: "preview",
    DB: f.db.binding,
    APPLICATION_COST_LIMITS_ENABLED: "false",
    MONTHLY_BUDGET_CAP_ENABLED: "false",
    AI_GATEWAY_ID: "synthetic-rework",
    ...(procedure ? { LAW_API_OC: "synthetic-only" } : {}),
    AI_MODEL_TOKEN_BOUNDS_JSON: JSON.stringify(
      modelBounds(
        { ...observation, checkedAt: f.actor.now, validUntil: "2026-10-07T00:00:00.000Z" },
        "a".repeat(64),
      ),
    ),
    WORKSPACE_PROCESSING: {
      get: async () => {
        throw new Error("Synthetic absent instance");
      },
      create: async ({ id }: { id: string }) => ({ id }),
    },
    AI: {
      run: async (_model: string, raw: Record<string, unknown>) => {
        const { phase, data } = syntheticGatewayInput(raw);
        calls.push(phase);
        planningBudgets.push((data as { sourcePlanBudget?: unknown }).sourcePlanBudget);
        expect(phase).toBe("workspace_legal_plan");
        expect((data as { context: { casePurpose: string } }).context.casePurpose).toBe(purpose);
        if (outage) throw new Error("Synthetic unavailable provider");
        if (revoke)
          f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
        const output = {
          issues: [
            {
              id: "loan-issue",
              title: "반환 약속의 확인",
              factIds: [fact.id],
              requests: [
                { kind: "statute", lawTitle: "민법", articles: [{ number: "598", branch: "0" }] },
                { kind: "precedent", concept: "대여금" },
              ],
            },
          ],
        };
        return {
          id: `synthetic-rework-${calls.length}`,
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
  const reportDeps = {
    ...f.deps,
    readPreparedAnalysis: (actor: typeof f.actor, id: string) =>
      readPreparedAnalysis(core, actor, id),
    preparedAnalysisMatchesScope: (
      actor: typeof f.actor,
      id: string,
      snapshot: NonNullable<Awaited<ReturnType<typeof readPreparedAnalysis>>>,
      scope: { excludedFileIds: readonly string[]; maskIdentifiers: boolean },
    ) =>
      preparedAnalysisMatchesScope(core, actor, id, snapshot, {
        ...scope,
        excludedFileIds: [...scope.excludedFileIds],
      }),
  };
  const reports = createReportsService(core, reportDeps);
  const reportContinuation = createReportContinuation(core, env, {
    clock: () => f.actor.now,
    reportDependencies: async () => reportDeps,
  });
  const service = createLegalAnalysisJobs(core, env, {
    clock: () => f.actor.now,
    ...(procedure
      ? {
          transport: async () => {
            retrievalCalls++;
            return new Response("", { status: 400 });
          },
        }
      : {}),
    waitUntil: (p) => pending.push(p),
    prepareReport: async (owner, caseId, requestId, expectedRevision) => {
      continuations.push(requestId);
      await beforeReport?.();
      await reportContinuation.prepare(owner, caseId, requestId, expectedRevision);
    },
  });
  const execute = async (jobId: string) => {
    const row = f.db.sqlite
      .query("SELECT target_revision,runtime_instance_id FROM v2_jobs WHERE id=?")
      .get(jobId) as { target_revision: number; runtime_instance_id: string };
    const result = await service.execute(
      {
        ownerId: f.actor.ownerId,
        workspaceId: f.workspaceId,
        workspaceRevision: row.target_revision,
        jobId,
      },
      row.runtime_instance_id,
    );
    await Promise.all(pending.splice(0));
    return result;
  };
  return {
    ...f,
    core,
    env,
    service,
    calls,
    planningBudgets,
    retrievalCalls: () => retrievalCalls,
    continuations,
    reports,
    reportContinuation,
    execute,
    outage: () => {
      outage = true;
    },
    revoke: () => {
      revoke = true;
    },
  };
}
test("durable procedure reservation has identical native admission and dispatch within four plans", async () => {
  const f = await fixture("prepare_claim", undefined, {
    kind: "civil",
    stage: "before_filing",
    description: null,
  });
  const admitted = await f.service.admit(f.actor.ownerId, f.workspaceId, {
    requestId: crypto.randomUUID(),
    expectedRevision: f.rev(),
    continueWithReport: true,
  });
  expect(f.calls).toHaveLength(0);
  expect((await f.execute(admitted.operationId))?.status).toBe("completed");
  expect(f.calls).toEqual(["workspace_legal_plan"]);
  expect(f.planningBudgets).toEqual([
    {
      maximumPublicPlans: 4,
      maximumModelRequests: 3,
      reservedProcedurePlans: 1,
    },
  ]);
  expect(f.retrievalCalls()).toBe(4);
  const snapshot = await readPreparedAnalysis(f.core, f.actor, f.workspaceId);
  expect(snapshot?.status).toBe("unavailable");
  expect(snapshot?.availability.filter((s) => s.kind === "official_guide")).toHaveLength(2);
  expect(snapshot?.sourceClaims).toEqual([]);
  expect(
    f.db.sqlite.query("SELECT responses_used,responses_reserved FROM v2_daily_usage").get(),
  ).toEqual({ responses_used: 1, responses_reserved: 0 });
});
for (const purpose of ["prepare_claim", "respond_to_claim"] as const)
  test(`actual paid native plan for ${purpose} stores honest unavailable sources and resumes the report once`, async () => {
    const f = await fixture(purpose),
      requestId = crypto.randomUUID(),
      expectedRevision = f.rev();
    const request = { requestId, expectedRevision, continueWithReport: true };
    const admitted = await f.service.admit(f.actor.ownerId, f.workspaceId, request);
    expect(f.calls).toHaveLength(0);
    expect(await f.service.admit(f.actor.ownerId, f.workspaceId, request)).toEqual(admitted);
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_jobs").get()).toEqual({ n: 1 });
    expect((await f.execute(admitted.operationId))?.status).toBe("completed");
    expect(f.calls).toEqual(["workspace_legal_plan"]);
    const snapshot = await readPreparedAnalysis(f.core, f.actor, f.workspaceId);
    if (!snapshot) throw new Error("Missing actual prepared snapshot");
    expect(snapshot.status).toBe("unavailable");
    expect(snapshot?.availability.every((s) => s.status === "unavailable")).toBe(true);
    expect(snapshot?.citations).toEqual([]);
    expect(snapshot?.sourceClaims).toEqual([]);
    expect(
      (
        await createReworkStateService(f.core, { clock: () => f.actor.now }).get(
          f.actor.ownerId,
          f.workspaceId,
        )
      ).analysis.status,
    ).toBe("unavailable");
    expect(f.continuations).toEqual([requestId]);
    const report = await f.reports.peek(f.actor.ownerId, f.workspaceId);
    if (!report) throw new Error("Missing actual generated report");
    expect(report.analysisReview?.status).toBe("unavailable");
    expect(report?.content).toContain("법적 쟁점과 법 조항");
    const conversation = await createReworkStateService(f.core, {
      clock: () => f.actor.now,
      peekReport: (owner, id) => f.reports.peek(owner, id),
    }).get(f.actor.ownerId, f.workspaceId);
    expect(conversation.report.status).toBe("ready");
    expect(conversation.report.basis).toEqual(snapshot.basis);
    expect(
      (await f.reportContinuation.prepare(f.actor.ownerId, f.workspaceId, requestId, null)).id,
    ).toBe(report.id);
    expect(
      f.db.sqlite.query("SELECT count(*) n FROM v2_reports WHERE id NOT LIKE 'export-%'").get(),
    ).toEqual({ n: 1 });
    await f.execute(admitted.operationId);
    expect(f.continuations).toEqual([requestId]);
    expect(f.calls).toHaveLength(1);
    expect(
      f.db.sqlite.query("SELECT responses_used,responses_reserved FROM v2_daily_usage").get(),
    ).toEqual({ responses_used: 1, responses_reserved: 0 });
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_execution_attempts").get()).toEqual({
      n: 1,
    });
  });
test("AI200 and actual missing configuration stop admission; missing cost observations do not", async () => {
  const f = await fixture();
  f.db.sqlite
    .query("INSERT INTO v2_daily_usage(owner_id,day,responses_used) VALUES(?,?,200)")
    .run(f.actor.ownerId, "2026-10-06");
  await expect(
    f.service.admit(f.actor.ownerId, f.workspaceId, {
      requestId: crypto.randomUUID(),
      expectedRevision: f.rev(),
      continueWithReport: false,
    }),
  ).rejects.toMatchObject({ code: "USER_QUOTA_EXCEEDED" });
  f.db.sqlite.query("UPDATE v2_daily_usage SET responses_used=0").run();
  const missing = createLegalAnalysisJobs(
    f.core,
    { ...f.env, AI_GATEWAY_ID: "" },
    { clock: () => f.actor.now },
  );
  await expect(
    missing.admit(f.actor.ownerId, f.workspaceId, {
      requestId: crypto.randomUUID(),
      expectedRevision: f.rev(),
      continueWithReport: false,
    }),
  ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_jobs").get()).toEqual({ n: 0 });
  expect(f.calls).toHaveLength(0);
});
test("report continuation failure keeps completed analysis and a separate finite diagnostic", async () => {
  const f = await fixture("prepare_claim", async () => {
    throw new Error("private continuation detail");
  });
  const admitted = await f.service.admit(f.actor.ownerId, f.workspaceId, {
    requestId: crypto.randomUUID(),
    expectedRevision: f.rev(),
    continueWithReport: true,
  });
  const result = await f.execute(admitted.operationId);
  expect(result).toMatchObject({
    status: "completed",
    analysisFailure: { stage: "report_continuation", reason: "unknown" },
  });
  expect(JSON.stringify(result)).not.toContain("private continuation detail");
  expect(
    f.db.sqlite.query("SELECT status FROM v2_jobs WHERE id=?").get(admitted.operationId),
  ).toEqual({ status: "completed" });
  expect(await readPreparedAnalysis(f.core, f.actor, f.workspaceId)).toMatchObject({
    status: "unavailable",
  });
});

test("provider failure remains a failed encrypted analysis and retains every admitted execution", async () => {
  const f = await fixture();
  f.outage();
  const admitted = await f.service.admit(f.actor.ownerId, f.workspaceId, {
    requestId: crypto.randomUUID(),
    expectedRevision: f.rev(),
    continueWithReport: false,
  });
  expect(await f.execute(admitted.operationId)).toMatchObject({
    status: "failed",
    analysisFailure: { stage: "planning", reason: "dependency_unavailable" },
  });
  const raw = await createV2ReworkRepository(f.core).read(
    f.actor,
    f.workspaceId,
    "analysis",
    f.workspaceId,
    preparedAnalysisRecordSchema,
  );
  expect(raw?.value.snapshot).toBeNull();
  expect(raw?.value.failure).toBe("MODEL_UNAVAILABLE");
  expect(
    (
      await createReworkStateService(f.core, { clock: () => f.actor.now }).get(
        f.actor.ownerId,
        f.workspaceId,
      )
    ).analysis.status,
  ).toBe("failed");
  expect(f.calls.length).toBeGreaterThan(0);
  expect(f.calls.length).toBeLessThanOrEqual(3);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_execution_job_holds").get()).toEqual({
    n: 1,
  });
});
test("a consent revoked during actual native response cannot publish analysis or a report continuation", async () => {
  const f = await fixture();
  f.revoke();
  const admitted = await f.service.admit(f.actor.ownerId, f.workspaceId, {
    requestId: crypto.randomUUID(),
    expectedRevision: f.rev(),
    continueWithReport: true,
  });
  expect((await f.execute(admitted.operationId))?.status).toBe("stopped");
  expect(
    await createV2ReworkRepository(f.core).head(f.actor, f.workspaceId, "analysis", f.workspaceId),
  ).toBeNull();
  expect(f.continuations).toEqual([]);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_execution_job_holds").get()).toEqual({
    n: 1,
  });
});

test("report continuation preserves a human revision and its original CAS across replay", async () => {
  const f = await fixture(),
    requestId = crypto.randomUUID();
  const admitted = await f.service.admit(f.actor.ownerId, f.workspaceId, {
    requestId,
    expectedRevision: f.rev(),
    continueWithReport: true,
  });
  await f.execute(admitted.operationId);
  const original = await f.reports.peek(f.actor.ownerId, f.workspaceId);
  if (!original) throw new Error("Missing actual generated report");
  const edited = await f.reports.save(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: original.revision,
    content: `${original.content}\n\n사용자 검토 메모`,
    maskIdentifiers: original.maskIdentifiers,
    excludedFileIds: original.excludedFileIds,
  });
  expect(edited.revision).toBe(original.revision + 1);
  const state = () =>
    createReworkStateService(f.core, {
      clock: () => f.actor.now,
      peekReport: (owner, id) => f.reports.peek(owner, id),
    }).get(f.actor.ownerId, f.workspaceId);
  expect((await state()).report.status).toBe("stale");
  expect(
    (await f.reportContinuation.prepare(f.actor.ownerId, f.workspaceId, requestId, null)).id,
  ).toBe(original.id);
  expect((await f.reports.peek(f.actor.ownerId, f.workspaceId))?.id).toBe(edited.id);
  const newRequest = crypto.randomUUID();
  await expect(
    f.reportContinuation.prepare(f.actor.ownerId, f.workspaceId, newRequest, original.revision),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  // Retrying with a newer CAS cannot change the original registered request.
  await expect(
    f.reportContinuation.prepare(f.actor.ownerId, f.workspaceId, newRequest, edited.revision),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  const failed = await state();
  expect(failed.report.status).toBe("failed");
  expect(failed.report.id).toBe(edited.id);
  expect(f.calls).toHaveLength(1);
  expect(
    f.db.sqlite.query("SELECT count(*) n FROM v2_reports WHERE id NOT LIKE 'export-%'").get(),
  ).toEqual({ n: 2 });
});

for (const failed of [false, true])
  test(`atomic ${failed ? "failed" : "completed"} analysis exposes its report request before registration`, async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const f = await fixture("prepare_claim", async () => {
      entered.resolve();
      await release.promise;
    });
    if (failed) f.outage();
    const requestId = crypto.randomUUID();
    const admission = await f.service.admit(f.actor.ownerId, f.workspaceId, {
      requestId,
      expectedRevision: f.rev(),
      continueWithReport: true,
    });
    const execution = f.execute(admission.operationId);
    await entered.promise;
    const stateService = createReworkStateService(f.core, {
      clock: () => f.actor.now,
      peekReport: (owner, id) => f.reports.peek(owner, id),
    });
    try {
      const progress = await stateService.getProgress(f.actor.ownerId, f.workspaceId);
      expect(progress.reportContinuation).toMatchObject({
        phase: "requested",
        requestId,
        expectedReportRevision: null,
      });
      expect(progress.state.analysis.status).toBe(failed ? "failed" : "unavailable");
      expect(progress.state.report.currentJobId).toBeNull();
      expect(progress.state.report.status).not.toBe("pending");
      expect(await stateService.get(f.actor.ownerId, f.workspaceId)).toEqual(progress.state);
      const raw = await createV2ReworkRepository(f.core).read(
        f.actor,
        f.workspaceId,
        "analysis",
        f.workspaceId,
        preparedAnalysisRecordSchema,
      );
      expect(raw?.value.continuationObligation).toEqual({
        requestId,
        expectedReportRevision: null,
      });
    } finally {
      release.resolve();
    }
    await execution;
    const completed = await stateService.getProgress(f.actor.ownerId, f.workspaceId);
    expect(completed.reportContinuation).toBeNull();
    expect(completed.state.report.status).toBe("ready");
    // The queued PDF job is not an active logical body-generation job.
    expect(completed.state.report.currentJobId).toBeNull();
  });
