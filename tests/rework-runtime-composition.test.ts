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
import { createReworkCaseService } from "../src/server/modules/rework/case-context";
import { createReworkRuntime } from "../src/server/modules/rework/runtime";
import {
  preparedAnalysisMatchesScope,
  readPreparedAnalysis,
} from "../src/server/modules/rework/state";
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
    .route("/api/v2/cases", createReworkApi({ runtimeOptions: async () => options }));
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
