import { afterEach, expect, setSystemTime, test } from "bun:test";
import { Hono } from "hono";
import { modelBounds } from "../scripts/provision-ai-budget";
import { EXPECTED_OWNER_HEADER } from "../src/contracts/session";
import {
  type V2ConversationState,
  type V2ResolutionState,
  v2ConversationActionResultSchema,
  v2ResolutionStateSchema,
} from "../src/contracts/v2";
import type { ApiEnvironment } from "../src/server/api/errors";
import { createReworkApi } from "../src/server/api/v2/rework";
import { createV2Core } from "../src/server/db/v2-core";
import { ReportError } from "../src/server/modules/reports/source";
import { createReworkCaseService } from "../src/server/modules/rework/case-context";
import { createReworkResolutionRuntime } from "../src/server/modules/rework/resolution-runtime";
import { createReworkRuntime } from "../src/server/modules/rework/runtime";
import {
  createReworkStateService,
  preparedAnalysisMatchesScope,
  readPreparedAnalysis,
} from "../src/server/modules/rework/state";
import { storedMessageSchema } from "../src/server/modules/workspace/stored-message";
import { runWorkspaceRuntime } from "../src/server/runtime/workspace";
import { signedSessionCookie, testEnvironment } from "./helpers/d1";
import { syntheticGatewayInput } from "./helpers/gateway-input";
import observation from "./helpers/gemini-observation";
import { createSyntheticLegalTransport } from "./helpers/legal-analysis-fixture";
import { syntheticLegalDraft, syntheticLegalPlan } from "./helpers/legal-analysis-model-fixture";
import { readyFile, reportFixture } from "./helpers/report-fixture";
import { seedTestSession } from "./helpers/session";

const fixtures: Awaited<ReturnType<typeof reportFixture>>[] = [];
afterEach(() => {
  setSystemTime();
  for (const f of fixtures.splice(0)) f.db.close();
});
async function fixture(
  purpose: "prepare_claim" | "respond_to_claim" = "prepare_claim",
  legalReady = false,
  apiOptions: Pick<NonNullable<Parameters<typeof createReworkApi>[0]>, "stateDependencies"> = {},
) {
  const f = await reportFixture();
  fixtures.push(f);
  setSystemTime(new Date(f.actor.now));
  const core = createV2Core(f.db.binding, f.core.cipher, { applicationCostLimitsEnabled: false });
  const factId = crypto.randomUUID(),
    rowId = crypto.randomUUID();
  const fact = {
    id: factId,
    text: "합성 계약의 반환 약속을 문자로 주고받았습니다.",
    attribution: "user_statement",
    certainty: "reported",
    significance: "neutral",
    conflictingFactIds: [],
    userEdited: false,
    references: [{ kind: "intake_narrative", intakeRevision: 1 }],
  };
  f.db.sqlite
    .query(
      "INSERT INTO v2_facts(id,entity_id,workspace_id,revision,summary_revision,encrypted_payload) VALUES(?,?,?,1,1,?)",
    )
    .run(
      rowId,
      factId,
      f.workspaceId,
      await core.encrypt("v2_facts", rowId, f.actor.ownerId, 1, fact),
    );
  await createReworkCaseService(core, { clock: () => f.actor.now }).update(
    f.actor.ownerId,
    f.workspaceId,
    crypto.randomUUID(),
    {
      expectedRevision: f.rev(),
      casePurpose: purpose,
      subjectContext: "individual",
      procedure: { kind: "unconfirmed", stage: "unconfirmed", description: null },
    },
  );
  const session = f.db.sqlite
    .query("SELECT id,token FROM session WHERE user_id=?")
    .get(f.actor.ownerId) as { id: string; token: string };
  const foreign = await seedTestSession(f.db, { now: Date.parse(f.actor.now), consent: true });
  const instances = new Map<
      string,
      {
        params: { ownerId: string; workspaceId: string; workspaceRevision: number; jobId: string };
        status: string;
      }
    >(),
    calls: string[] = [];
  let outage = false;
  const env = {
    ...testEnvironment(f.db.binding),
    CASE_DATA_KEY_V1: btoa("k".repeat(32)).replace(/=+$/, ""),
    APP_ENV: "preview",
    APPLICATION_COST_LIMITS_ENABLED: "false",
    MONTHLY_BUDGET_CAP_ENABLED: "false",
    AI_GATEWAY_ID: "synthetic-central",
    ...(legalReady ? { LAW_API_OC: "synthetic-only" } : {}),
    AI_MODEL_TOKEN_BOUNDS_JSON: JSON.stringify(
      modelBounds(
        { ...observation, checkedAt: f.actor.now, validUntil: "2026-10-07T00:00:00.000Z" },
        "a".repeat(64),
      ),
    ),
    ANALYSIS_ACCOUNT_LIMIT: { limit: async () => ({ success: true }) },
    WORKSPACE_PROCESSING: {
      get: async (id: string) => {
        const v = instances.get(id);
        if (!v) throw new Error("Synthetic absent workflow");
        return { id, status: async () => ({ status: v.status }) };
      },
      create: async ({
        id,
        params,
      }: {
        id: string;
        params: { ownerId: string; workspaceId: string; workspaceRevision: number; jobId: string };
      }) => {
        instances.set(id, { params, status: "queued" });
        return { id };
      },
    },
    AI: {
      run: async (_model: string, raw: Record<string, unknown>) => {
        const { phase, data } = syntheticGatewayInput(raw);
        calls.push(phase);
        if (outage) throw new Error("Synthetic provider unavailable");
        const output =
          phase === "workspace_legal_plan"
            ? syntheticLegalPlan(data)
            : phase === "workspace_legal_analysis"
              ? syntheticLegalDraft(data)
              : phase === "workspace_legal_audit"
                ? {
                    pass: true,
                    findings: [],
                    unsupportedFactIds: [],
                    legalClaimsSupported: true,
                    strategyDetected: false,
                  }
                : null;
        if (!output) throw new Error("Unexpected synthetic phase");
        return {
          id: `synthetic-central-${calls.length}`,
          service_tier: "default",
          choices: [
            {
              message: {
                content: JSON.stringify({ output }),
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 100,
            prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
          },
        };
      },
    },
  } as unknown as Env;
  const deps = {
    ...f.deps,
    readPreparedAnalysis: (a: typeof f.actor, id: string) => readPreparedAnalysis(core, a, id),
    preparedAnalysisMatchesScope: (
      a: typeof f.actor,
      id: string,
      s: NonNullable<Awaited<ReturnType<typeof readPreparedAnalysis>>>,
      scope: { excludedFileIds: readonly string[]; maskIdentifiers: boolean },
    ) =>
      preparedAnalysisMatchesScope(core, a, id, s, {
        ...scope,
        excludedFileIds: [...scope.excludedFileIds],
      }),
  };
  const options = {
    clock: () => f.actor.now,
    reportDependencies: async () => deps,
    ...(legalReady ? { transport: createSyntheticLegalTransport() } : {}),
  };
  const runtime = createReworkRuntime(core, env, options);
  const app = new Hono<ApiEnvironment>()
    .use("*", async (c, next) => {
      c.set("requestId", "synthetic-central");
      await next();
    })
    .route(
      "/api/v2/cases",
      createReworkApi({ runtimeOptions: async () => options, ...apiOptions }),
    );
  const cookie = await signedSessionCookie(session.token, env.BETTER_AUTH_SECRET);
  const request = async (
    path: string,
    input?: unknown,
    {
      key = crypto.randomUUID(),
      foreignOwner = false,
      expectedOwner = f.actor.ownerId,
      method,
    }: { key?: string; foreignOwner?: boolean; expectedOwner?: string; method?: string } = {},
  ) => {
    const headers = new Headers({
      cookie: foreignOwner ? foreign.cookie : cookie,
      origin: env.BETTER_AUTH_URL,
      [EXPECTED_OWNER_HEADER]: encodeURIComponent(expectedOwner),
    });
    if (input !== undefined) {
      headers.set("content-type", "application/json");
      headers.set("idempotency-key", key);
    }
    return app.request(
      `/api/v2/cases/${f.workspaceId}/rework/${path}`,
      {
        method: method ?? (input === undefined ? "GET" : "POST"),
        headers,
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      },
      env,
    );
  };
  const drain = async () => {
    for (const [id, entry] of instances) {
      if (entry.status !== "queued") continue;
      entry.status = "running";
      const settlement: Promise<void>[] = [];
      await runWorkspaceRuntime(env, entry.params, id, (p) => settlement.push(p), options);
      await Promise.all(settlement);
      entry.status = "complete";
    }
  };
  return {
    ...f,
    core,
    env,
    runtime,
    request,
    drain,
    calls,
    instances,
    foreign,
    options,
    outage: () => {
      outage = true;
    },
  };
}
test("passive conversation reads retry only a bounded moving snapshot and never admit paid work", async () => {
  for (const writes of [2, 4]) {
    let reads = 0;
    let onPeek: () => Promise<null> = async () => null;
    const f = await fixture("prepare_claim", false, {
      stateDependencies: async () => ({ peekReport: () => onPeek() }),
    });
    onPeek = async () => {
      if (++reads <= writes)
        f.db.sqlite
          .query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?")
          .run(f.workspaceId);
      return null;
    };
    const response = await f.request("conversation");
    expect(response.status).toBe(writes === 2 ? 200 : 409);
    expect(reads).toBe(3);
    if (response.ok)
      expect(((await response.json()) as V2ConversationState).workspaceRevision).toBe(f.rev());
    else
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        "STALE_REVISION",
      );
    expect(f.calls).toHaveLength(0);
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_jobs").get()).toEqual({ n: 0 });
  }
});
test("a snapshot retry rechecks the signed session and cannot outlive logout", async () => {
  let reads = 0;
  let onPeek: () => Promise<null> = async () => null;
  const f = await fixture("prepare_claim", false, {
    stateDependencies: async () => ({ peekReport: () => onPeek() }),
  });
  onPeek = async () => {
    reads++;
    f.db.sqlite.query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?").run(f.workspaceId);
    f.db.sqlite.query("DELETE FROM session WHERE user_id=?").run(f.actor.ownerId);
    return null;
  };
  expect((await f.request("conversation")).status).toBe(401);
  expect(reads).toBe(1);
  expect(f.calls).toHaveLength(0);
});
test("a newly published encrypted intent is a revision race rather than invalid user input", async () => {
  let reads = 0;
  let onPeek: () => Promise<null> = async () => null;
  const f = await fixture("prepare_claim", false, {
    stateDependencies: async () => ({ peekReport: () => onPeek() }),
  });
  const messageId = crypto.randomUUID(),
    operationId = crypto.randomUUID(),
    revision = f.rev() + 1;
  onPeek = async () => {
    if (++reads === 1) {
      const value = storedMessageSchema().parse({
        schemaVersion: "2",
        id: messageId,
        workspaceRevision: revision,
        operationId,
        role: "assistant",
        safety: "validated",
        text: "합성 검증: 준비 상태를 확인할 수 있어요.",
        conversationIntent: "show_preparation",
        references: [],
        citations: [],
        warnings: [],
        createdAt: f.actor.now,
      });
      const encrypted = await f.core.encrypt("v2_messages", messageId, f.actor.ownerId, 1, value);
      f.db.sqlite
        .query(
          "INSERT INTO v2_operations(id,owner_id,workspace_id,kind,revision,created_at) VALUES(?,?,?,'chat',?,?)",
        )
        .run(operationId, f.actor.ownerId, f.workspaceId, revision, f.actor.now);
      f.db.sqlite
        .query(
          "INSERT INTO v2_messages(id,workspace_id,workspace_revision,operation_id,role,safety,encrypted_payload,created_at) VALUES(?,?,?,?,'assistant','validated',?,?)",
        )
        .run(messageId, f.workspaceId, revision, operationId, encrypted, f.actor.now);
      const jobId = crypto.randomUUID();
      f.db.sqlite
        .query(
          "INSERT INTO v2_jobs(id,operation_id,runtime_instance_id,workspace_id,target_kind,target_id,target_revision,kind,status,phase,progress,created_at,updated_at) VALUES(?,?,?,?,'workspace',?,?,'chat_response','completed','finished',100,?,?)",
        )
        .run(
          jobId,
          operationId,
          `${jobId}-1`,
          f.workspaceId,
          f.workspaceId,
          revision,
          f.actor.now,
          f.actor.now,
        );
      f.db.sqlite
        .query("UPDATE v2_workspaces SET revision=? WHERE id=?")
        .run(revision + 1, f.workspaceId);
    }
    return null;
  };
  const response = await f.request("conversation");
  expect(response.status).toBe(200);
  const state = (await response.json()) as V2ConversationState;
  expect(state.workspaceRevision).toBe(revision + 1);
  expect(state.intents).toEqual([
    {
      messageId,
      requestId: `intent-${messageId}`,
      intent: "show_preparation",
      workspaceRevision: revision + 1,
    },
  ]);
  expect(reads).toBe(2);
  expect(f.calls).toHaveLength(0);
});
test("report size and actual storage failures retain their HTTP boundary without snapshot replay", async () => {
  for (const [code, status] of [
    ["EXPORT_LIMIT_EXCEEDED", 413],
    ["STORAGE_UNAVAILABLE", 503],
  ] as const) {
    let reads = 0;
    const f = await fixture("prepare_claim", false, {
      stateDependencies: async () => ({
        peekReport: async () => {
          reads++;
          throw new ReportError(code);
        },
      }),
    });
    const response = await f.request("conversation");
    expect(response.status).toBe(status);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(code);
    expect(reads).toBe(1);
    expect(f.calls).toHaveLength(0);
  }
});
for (const purpose of ["prepare_claim", "respond_to_claim"] as const)
  for (const choice of ["self", "lawyer", "save_report"] as const)
    test(`signed real Hono ${purpose} -> analysis/report -> ${choice}`, async () => {
      const f = await fixture(purpose),
        key = crypto.randomUUID(),
        input = {
          action: "prepare_report",
          requestId: crypto.randomUUID(),
          expectedRevision: f.rev(),
        };
      const response = await f.request("actions", input, { key });
      expect(response.status).toBe(202);
      const admitted = v2ConversationActionResultSchema.parse(await response.json());
      expect(admitted).toMatchObject({ pane: "report", status: "pending" });
      const replay = await f.request("actions", input, { key });
      expect(v2ConversationActionResultSchema.parse(await replay.json())).toEqual(admitted);
      expect(
        (await f.request("actions", { ...input, action: "analyze_legal" }, { key })).status,
      ).toBe(409);
      expect(f.calls).toHaveLength(0);
      await f.drain();
      const stateResponse = await f.request("conversation");
      expect(stateResponse.status).toBe(200);
      const state = (await stateResponse.json()) as V2ConversationState;
      expect(state.analysis.status).toBe("unavailable");
      expect(state.report.status).toBe("ready");
      expect(state.report.basis).toEqual(state.analysis.basis);
      expect(f.calls).toEqual(["workspace_legal_plan"]);
      const selected = await f.request("actions", {
        action: "resolve_followup",
        choice,
        requestId: crypto.randomUUID(),
        expectedRevision: f.rev(),
      });
      expect(selected.status).toBe(200);
      const result = await selected.json();
      expect(result).toMatchObject({ pane: "followup", status: "ready" });
      const resolution = (await (await f.request("resolution")).json()) as V2ResolutionState;
      expect(resolution.selection).toBe(choice);
      expect(resolution.allowedDocumentKinds).toEqual(["fact_statement"]);
      expect(f.calls).toHaveLength(1);
    });
test("a signed foreign owner and expected-owner switch cannot read case evidence or admit actions", async () => {
  const f = await fixture();
  expect(
    (
      await f.request("conversation", undefined, {
        foreignOwner: true,
        expectedOwner: f.foreign.userId,
      })
    ).status,
  ).toBe(404);
  expect(
    (await f.request("conversation", undefined, { expectedOwner: f.foreign.userId })).status,
  ).toBe(401);
  expect(f.calls).toHaveLength(0);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_jobs").get()).toEqual({ n: 0 });
});
test("automatic source intent is durable, bounded and never creates a second current report", async () => {
  const f = await fixture();
  expect((await f.runtime.resume(f.actor.ownerId, f.workspaceId)).status).toBe("analysis");
  await f.drain();
  expect(
    (await createReworkRuntime(f.core, f.env, f.options).resume(f.actor.ownerId, f.workspaceId))
      .status,
  ).toBe("complete");
  await f.runtime.resume(f.actor.ownerId, f.workspaceId);
  expect(f.calls).toHaveLength(1);
  expect(
    f.db.sqlite.query("SELECT count(*) n FROM v2_reports WHERE id NOT LIKE 'export-%'").get(),
  ).toEqual({ n: 1 });
});

test("an unchanged automatic provider failure is preserved without repeating admission", async () => {
  const f = await fixture();
  f.outage();
  await f.runtime.resume(f.actor.ownerId, f.workspaceId);
  await f.drain();
  const state = await f.runtime.state.get(f.actor.ownerId, f.workspaceId);
  expect(state.analysis.status).toBe("failed");
  expect(state.analysis.failure).toBe("MODEL_UNAVAILABLE");
  expect(state.report.status).toBe("ready");
  const before = f.calls.length;
  await f.runtime.resume(f.actor.ownerId, f.workspaceId);
  await f.runtime.resume(f.actor.ownerId, f.workspaceId);
  expect(f.calls).toHaveLength(before);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_execution_job_holds").get()).toEqual({
    n: 1,
  });
});
test("missing native configuration records an honest failure and a limited factual report", async () => {
  const f = await fixture();
  f.env.AI_GATEWAY_ID = "";
  expect((await f.runtime.resume(f.actor.ownerId, f.workspaceId)).status).toBe("failed");
  const state = await f.runtime.state.get(f.actor.ownerId, f.workspaceId);
  expect(state.analysis.status).toBe("failed");
  expect(state.report.status).toBe("ready");
  expect(
    (
      await (
        await f.runtime.reports(f.actor.ownerId, f.workspaceId)
      ).peek(f.actor.ownerId, f.workspaceId)
    )?.analysisReview?.status,
  ).toBe("review_required");
  await f.runtime.resume(f.actor.ownerId, f.workspaceId);
  expect(f.calls).toHaveLength(0);
  expect(
    f.db.sqlite.query("SELECT count(*) n FROM v2_jobs WHERE target_kind='workspace'").get(),
  ).toEqual({ n: 0 });
});

test("actual draft/save handler receipts preserve the factual draft and stored reads after consent withdrawal", async () => {
  const f = await fixture();
  await f.runtime.resume(f.actor.ownerId, f.workspaceId);
  await f.drain();
  await f.request("actions", {
    action: "resolve_followup",
    choice: "self",
    requestId: crypto.randomUUID(),
    expectedRevision: f.rev(),
  });
  const state = (await (await f.request("resolution")).json()) as V2ResolutionState;
  if (!state.basis) throw new Error("Missing actual current resolution basis");
  const request = {
    expectedRevision: state.revision,
    reportId: state.basis.reportId,
    reportRevision: state.basis.reportRevision,
    documentKind: "fact_statement",
    selectedFileIds: state.selectedFileIds,
    maskIdentifiers: state.maskIdentifiers,
    factsConfirmed: true,
  };
  const key = crypto.randomUUID(),
    response = await f.request("resolution/draft", request, { key });
  expect(response.status).toBe(200);
  const drafted = (await response.json()) as V2ResolutionState;
  expect(drafted.draft?.documentKind).toBe("fact_statement");
  expect(drafted.draft?.content).toContain("합성 계약");
  expect(
    v2ResolutionStateSchema.parse(
      await (await f.request("resolution/draft", request, { key })).json(),
    ),
  ).toEqual(drafted);
  if (!drafted.draft) throw new Error("Missing actual draft");
  const savedResponse = await f.request(
    "resolution",
    {
      action: "save_draft",
      expectedRevision: drafted.revision,
      reportId: request.reportId,
      reportRevision: request.reportRevision,
      draftId: drafted.draft.id,
      draftRevision: drafted.draft.revision,
      content: drafted.draft.content,
      reviewed: true,
    },
    { method: "PATCH" },
  );
  expect(savedResponse.status).toBe(200);
  const saved = (await savedResponse.json()) as V2ResolutionState;
  expect(saved.draft?.status).toBe("saved");
  f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
  const readonly = await f.request("resolution");
  expect(readonly.status).toBe(200);
  expect(((await readonly.json()) as V2ResolutionState).draft?.id).toBe(saved.draft?.id);
  expect((await f.request("resolution/draft", request, { key })).status).toBe(403);
  f.db.sqlite.query("DELETE FROM session WHERE user_id=?").run(f.actor.ownerId);
  expect((await f.request("resolution")).status).toBe(401);
  expect(f.calls).toHaveLength(1);
});

test("new evidence invalidates both bases and creates a new report while preserving its predecessor", async () => {
  const f = await fixture();
  await f.runtime.resume(f.actor.ownerId, f.workspaceId);
  await f.drain();
  const before = f.db.sqlite
    .query("SELECT id,snapshot_id,encrypted_payload FROM v2_reports WHERE id NOT LIKE 'export-%'")
    .get();
  await readyFile(f, "합성 추가 증거 원문");
  const stale = await f.runtime.state.get(f.actor.ownerId, f.workspaceId);
  expect(stale.analysis.status).toBe("stale");
  expect(stale.report.status).toBe("stale");
  await f.runtime.resume(f.actor.ownerId, f.workspaceId);
  await f.drain();
  const fresh = await f.runtime.state.get(f.actor.ownerId, f.workspaceId);
  expect(fresh.report.status).toBe("ready");
  expect(fresh.report.basis?.evidenceHash).not.toBe(stale.analysis.basis?.evidenceHash);
  const rows = f.db.sqlite
    .query(
      "SELECT id,snapshot_id,encrypted_payload FROM v2_reports WHERE id NOT LIKE 'export-%' ORDER BY revision",
    )
    .all();
  expect(rows).toHaveLength(2);
  expect(rows[0]).toEqual(before);
  expect(f.calls).toHaveLength(2);
});
test("only an actual daily AI capacity reset resumes a quota-blocked automatic intent with a new report CAS", async () => {
  const f = await fixture();
  f.db.sqlite
    .query("INSERT INTO v2_daily_usage(owner_id,day,responses_used) VALUES(?,?,200)")
    .run(f.actor.ownerId, "2026-10-06");
  await f.runtime.resume(f.actor.ownerId, f.workspaceId);
  expect(f.calls).toHaveLength(0);
  expect((await f.runtime.state.get(f.actor.ownerId, f.workspaceId)).analysis.failure).toBe(
    "USER_QUOTA_EXCEEDED",
  );
  await f.runtime.resume(f.actor.ownerId, f.workspaceId);
  expect(f.calls).toHaveLength(0);
  f.actor.now = "2026-10-07T00:01:00.000Z";
  setSystemTime(new Date(f.actor.now));
  expect((await f.runtime.resume(f.actor.ownerId, f.workspaceId)).status).toBe("analysis");
  await f.drain();
  const state = await f.runtime.state.get(f.actor.ownerId, f.workspaceId);
  expect(state.analysis.status).toBe("unavailable");
  expect(state.report.status).toBe("ready");
  expect(state.report.revision).toBe(2);
  expect(f.calls).toHaveLength(1);
});

for (const purpose of ["prepare_claim", "respond_to_claim"] as const)
  test(`native ${purpose} prepares bound statute/precedent and matches the actual HTML report`, async () => {
    const f = await fixture(purpose, true);
    await f.runtime.resume(f.actor.ownerId, f.workspaceId);
    await f.drain();
    const state = await f.runtime.state.get(f.actor.ownerId, f.workspaceId);
    expect(state.analysis.status).toBe("ready");
    expect(state.report.status).toBe("ready");
    expect(f.calls).toEqual([
      "workspace_legal_plan",
      "workspace_legal_analysis",
      "workspace_legal_audit",
    ]);
    if (!state.snapshot) throw new Error("Missing actual prepared snapshot");
    const reportService = await f.runtime.reports(f.actor.ownerId, f.workspaceId),
      report = await reportService.peek(f.actor.ownerId, f.workspaceId);
    if (!report) throw new Error("Missing actual prepared report");
    const html = await reportService.html(f.actor.ownerId, report.id);
    expect(report.analysisReview?.analysisId).toBe(state.snapshot.id);
    expect(html).toContain("법적 쟁점과 법 조항");
    for (const precedent of state.snapshot.precedents)
      for (const point of [...precedent.commonalities, ...precedent.differences]) {
        expect(report.content).toContain(point.text);
        expect(html).toContain(point.text);
      }
    for (const issue of state.snapshot.issues)
      for (const requirement of issue.requirements) {
        expect(report.content).toContain(requirement.label);
        expect(html).toContain(requirement.label);
      }
    expect(state.snapshot.citations.map((c) => c.kind).sort()).toEqual(["precedent", "statute"]);
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_execution_attempts").get()).toEqual({
      n: 3,
    });
  });

test("automatic preparation retains the real account rate boundary before paid admission", async () => {
  const f = await fixture();
  let allowed = false;
  f.env.ANALYSIS_ACCOUNT_LIMIT = { limit: async () => ({ success: allowed }) } as RateLimit;
  expect((await f.runtime.resume(f.actor.ownerId, f.workspaceId)).status).toBe("waiting");
  expect(f.calls).toHaveLength(0);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_jobs").get()).toEqual({ n: 0 });
  allowed = true;
  expect((await f.runtime.resume(f.actor.ownerId, f.workspaceId)).status).toBe("analysis");
  await f.drain();
  expect((await f.runtime.state.get(f.actor.ownerId, f.workspaceId)).report.status).toBe("ready");
  expect(f.calls).toHaveLength(1);
});

test("opt-in conversation progress preserves the installed DTO and private bounded read gates", async () => {
  const f = await fixture();
  const old = await (await f.request("conversation")).json();
  const response = await f.request("conversation-progress");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  const value = (await response.json()) as {
    contractVersion: string;
    state: unknown;
    reportContinuation: unknown;
  };
  expect(value).toEqual({
    contractVersion: "conversation-report-progress-v1",
    state: old,
    reportContinuation: null,
  });
  expect(Object.hasOwn(old as object, "reportContinuation")).toBe(false);
  expect((await f.request("conversation-progress?unknown=1")).status).toBe(400);
  expect(
    (
      await f.request("conversation-progress", undefined, {
        foreignOwner: true,
        expectedOwner: f.foreign.userId,
      })
    ).status,
  ).toBe(404);
  expect(
    (await f.request("conversation-progress", undefined, { expectedOwner: f.foreign.userId }))
      .status,
  ).toBe(401);
  expect(f.calls).toEqual([]);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_jobs").get()).toEqual({ n: 0 });
});

test("progress cannot return after its exact request session disappears without a W change", async () => {
  let onPeek: () => Promise<null> = async () => null;
  const f = await fixture("prepare_claim", false, {
    stateDependencies: async () => ({ peekReport: () => onPeek() }),
  });
  const before = f.rev();
  onPeek = async () => {
    f.db.sqlite.query("DELETE FROM session WHERE user_id=?").run(f.actor.ownerId);
    return null;
  };
  expect((await f.request("conversation-progress")).status).toBe(401);
  expect(f.rev()).toBe(before);
  expect(f.calls).toEqual([]);
});

test("progress keeps the verified source TTL proof through its final metadata read", async () => {
  const f = await fixture("prepare_claim", true);
  const action = await f.request("actions", {
    requestId: crypto.randomUUID(),
    expectedRevision: f.rev(),
    action: "analyze_legal",
  });
  expect(action.status).toBe(202);
  await f.drain();
  let changed = false;
  const core: typeof f.core = {
    ...f.core,
    statement(sql, values = []) {
      if (sql.includes("entity_id='report-continuation'")) {
        f.db.sqlite
          .query("UPDATE v2_official_sources SET expires_at=?")
          .run(new Date(Date.parse(f.actor.now) + 30_000).toISOString());
        changed = true;
      }
      return f.core.statement(sql, values);
    },
  };
  const state = createReworkStateService(core, {
    clock: () => new Date(Date.parse(f.actor.now) + 60_000).toISOString(),
    peekReport: (owner, id) => f.reports.peek(owner, id),
  });
  await expect(state.getProgress(f.actor.ownerId, f.workspaceId)).rejects.toMatchObject({
    code: "STALE_REVISION",
  });
  expect(changed).toBe(true);
});

for (const change of [
  "body",
  "rights",
  "binding",
  "clock",
  "file",
  "role",
  "owner",
  "report",
  "analysis_parts",
] as const)
  test(`one-request resolution proof rejects late ${change} changes to actual bound analysis`, async () => {
    const f = await fixture("prepare_claim", true);
    if (change === "file") await readyFile(f, "합성 원문 revision 경계 검증 자료입니다.");
    await f.runtime.resume(f.actor.ownerId, f.workspaceId);
    await f.drain();
    const reports = await f.runtime.reports(f.actor.ownerId, f.workspaceId);
    const report = await reports.peek(f.actor.ownerId, f.workspaceId);
    if (!report) throw new Error("missing synthetic report");
    const baseline = createReworkResolutionRuntime(f.core, {
      clock: () => f.actor.now,
      peekReport: (owner, id) => reports.peek(owner, id),
    });
    const state = await baseline.get(f.actor.ownerId, f.workspaceId);
    if (!state.basis) throw new Error("missing current bound analysis basis");
    let changed = false,
      now = f.actor.now;
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
                  if (change === "body")
                    f.db.sqlite.exec("UPDATE v2_official_sources SET body=body||' '");
                  else if (change === "rights")
                    f.db.sqlite.exec("UPDATE v2_official_sources SET rights_provenance='{}'");
                  else if (change === "binding")
                    f.db.sqlite.exec("UPDATE v2_citation_bindings SET citation_json='{}'");
                  else if (change === "clock") now = "2026-10-09T00:00:00.000Z";
                  else if (change === "file")
                    f.db.sqlite
                      .query("UPDATE v2_files SET revision=revision+1 WHERE workspace_id=?")
                      .run(f.workspaceId);
                  else if (change === "role")
                    f.db.sqlite
                      .query(
                        "INSERT INTO app_metadata(key,value,updated_at) VALUES(?,'invalid-role',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                      )
                      .run(`account-type:${f.actor.ownerId}`, f.actor.now);
                  else if (change === "owner")
                    f.db.sqlite
                      .query("UPDATE v2_workspaces SET owner_id=? WHERE id=?")
                      .run(f.foreign.userId, f.workspaceId);
                  else if (change === "report")
                    f.db.sqlite
                      .query("UPDATE v2_reports SET revision=revision+1 WHERE id=?")
                      .run(report.id);
                  else
                    f.db.sqlite
                      .query(
                        "DELETE FROM v2_rework_parts WHERE record_id IN (SELECT id FROM v2_rework_records WHERE workspace_id=? AND kind='analysis')",
                      )
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
      clock: () => now,
      peekReport: (owner, id) => reports.peek(owner, id),
    });
    const result = await runtime
      .update(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
        expectedRevision: state.revision,
        reportId: report.id,
        reportRevision: report.revision,
        action: "select",
        choice: "lawyer",
        selectedFileIds: state.selectedFileIds,
        maskIdentifiers: state.maskIdentifiers,
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
          "SELECT count(*) n FROM v2_rework_records WHERE workspace_id=? AND kind='resolution' AND state='published'",
        )
        .get(f.workspaceId),
    ).toEqual({ n: 0 });
    expect(f.calls).toEqual([
      "workspace_legal_plan",
      "workspace_legal_analysis",
      "workspace_legal_audit",
    ]);
  });

for (const change of ["workspace", "source", "clock"] as const)
  test(`final resolution CAS retains the pinned ${change} guard after staging`, async () => {
    const f = await fixture("prepare_claim", true);
    await f.runtime.resume(f.actor.ownerId, f.workspaceId);
    await f.drain();
    const reports = await f.runtime.reports(f.actor.ownerId, f.workspaceId),
      report = await reports.peek(f.actor.ownerId, f.workspaceId);
    if (!report) throw new Error("missing synthetic report");
    const state = await createReworkResolutionRuntime(f.core, {
      clock: () => f.actor.now,
      peekReport: (owner, id) => reports.peek(owner, id),
    }).get(f.actor.ownerId, f.workspaceId);
    if (!state.basis) throw new Error("missing actual bound basis");
    let changed = false,
      now = f.actor.now;
    const core: typeof f.core = {
      ...f.core,
      cipher: {
        ...f.core.cipher,
        async encrypt(text, context) {
          const value = await f.core.cipher.encrypt(text, context);
          if (context.table === "v2_rework_parts" && !changed) {
            changed = true;
            if (change === "workspace")
              f.db.sqlite
                .query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?")
                .run(f.workspaceId);
            else if (change === "source")
              f.db.sqlite.exec("UPDATE v2_official_sources SET body=body||' '");
            else now = "2026-10-09T00:00:00.000Z";
          }
          return value;
        },
      },
    };
    const runtime = createReworkResolutionRuntime(core, {
      clock: () => now,
      peekReport: (owner, id) => reports.peek(owner, id),
    });
    await expect(
      runtime.update(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
        expectedRevision: state.revision,
        reportId: report.id,
        reportRevision: report.revision,
        action: "select",
        choice: "lawyer",
        selectedFileIds: state.selectedFileIds,
        maskIdentifiers: state.maskIdentifiers,
      }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    expect(changed).toBe(true);
    expect(
      f.db.sqlite
        .query(
          "SELECT count(*) n FROM v2_rework_records WHERE workspace_id=? AND kind='resolution' AND state='published'",
        )
        .get(f.workspaceId),
    ).toEqual({ n: 0 });
  });
