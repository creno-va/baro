import { expect, test } from "bun:test";
import type { V2ConversationActionResult } from "../src/contracts/v2";
import {
  type ConversationAgentDependencies,
  ConversationAgentError,
  createConversationAgent,
} from "../src/server/modules/workspace/conversation-agent";
import { conversationJourneyCases } from "./fixtures/conversation-agent";
import { conversationState, limitedConversationState } from "./helpers/conversation-state";

function fixture(state = conversationState()) {
  let authorized = true;
  const loaded = { state, canMutate: true, archived: false, workspaceJobId: null as string | null };
  const calls: { kind: string; input: unknown }[] = [];
  const receipts = new Map<string, { hash: string; result: Promise<V2ConversationActionResult> }>();
  const deps: ConversationAgentDependencies = {
    authorize: async () => authorized,
    load: async () => loaded,
    once: async (input, work) => {
      const key = `${input.ownerId}:${input.caseId}:${input.request.requestId}`;
      const hash = JSON.stringify(input.request);
      const prior = receipts.get(key);
      if (prior) {
        if (prior.hash !== hash) throw new Error("IDEMPOTENCY_CONFLICT");
        return prior.result;
      }
      const result = work();
      receipts.set(key, { hash, result });
      return result;
    },
    analyze: async (input, options) => {
      calls.push({ kind: "analysis", input: { ...input, options } });
      return { operationId: "analysis-operation", workspaceRevision: state.workspaceRevision };
    },
    prepareReport: async (input) => {
      calls.push({ kind: "report", input });
      state.report = {
        status: "ready",
        id: "prepared-report",
        revision: 1,
        basis: state.analysis.basis,
        currentJobId: null,
        failure: null,
      };
      return { operationId: null, workspaceRevision: state.workspaceRevision };
    },
    selectResolution: async (input) => {
      calls.push({ kind: "resolution", input });
      return { operationId: null, workspaceRevision: state.workspaceRevision };
    },
  };
  const agent = createConversationAgent(deps);
  const execute = (
    action: string,
    extra: Record<string, unknown> = {},
    requestId: string = crypto.randomUUID(),
  ) =>
    agent.execute("owner", "case", {
      requestId,
      expectedRevision: state.workspaceRevision,
      action,
      ...extra,
    });
  return {
    agent,
    execute,
    calls,
    loaded,
    deps,
    revoke: () => {
      authorized = false;
    },
  };
}

test("server allowlist rejects unknown actions and arbitrary execution payloads before an adapter runs", async () => {
  const f = fixture();
  for (const request of [
    { action: "execute_sql", sql: "SELECT synthetic" },
    { action: "add_material", url: "https://example.test/private" },
    { action: "analyze_legal", code: "synthetic()" },
    { action: "resolve_followup", choice: "submit_on_behalf" },
  ])
    await expect(f.execute(request.action, request)).rejects.toThrow();
  expect(f.calls).toEqual([]);
});

test("opening upload, reconfirmation, preparation and follow-up never invokes analysis or sends anything", async () => {
  const f = fixture();
  for (const [action, pane] of [
    ["add_material", "materials"],
    ["reconfirm_case", "reconfirmation"],
    ["show_preparation", "preparation"],
    ["resolve_followup", "followup"],
    ["open_lawyers", "lawyers"],
  ])
    expect(await f.execute(action ?? "")).toMatchObject({ pane, operationId: null });
  expect(f.calls).toEqual([]);
});

test("confirmation, processing and the current workspace job gate expensive actions without a question/search loop", async () => {
  const f = fixture();
  f.loaded.state.summaryConfirmed = false;
  expect(await f.execute("prepare_report")).toMatchObject({
    pane: "reconfirmation",
    status: "require_confirmation",
  });
  f.loaded.state.summaryConfirmed = true;
  f.loaded.state.pendingEvidenceIds = ["contract-photo"];
  expect(await f.execute("analyze_legal")).toMatchObject({ pane: "materials", status: "blocked" });
  f.loaded.state.pendingEvidenceIds = [];
  f.loaded.workspaceJobId = "existing-chat-job";
  expect(await f.execute("prepare_report")).toMatchObject({
    status: "pending",
    operationId: "existing-chat-job",
  });
  expect(f.calls).toEqual([]);
});

test("parallel delivery and reconnect replay one request and one durable analysis admission", async () => {
  const f = fixture();
  const requestId = "one-user-intent";
  const results = await Promise.all(
    Array.from({ length: 4 }, () => f.execute("prepare_report", {}, requestId)),
  );
  expect(new Set(results.map((r) => r.operationId))).toEqual(new Set(["analysis-operation"]));
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]).toMatchObject({ input: { options: { continueWithReport: true } } });
  const original = results[0];
  if (!original) throw new Error("Missing accepted result");
  expect(await f.execute("prepare_report", {}, requestId)).toEqual(original);
  await expect(f.execute("analyze_legal", {}, requestId)).rejects.toThrow("IDEMPOTENCY_CONFLICT");
});

test("report intent on running analysis registers a durable continuation; ordinary analysis queries do not re-admit", async () => {
  const f = fixture();
  f.loaded.state.analysis = {
    status: "running",
    basis: {
      researchRevision: 7,
      summaryRevision: 2,
      evidenceHash: "a".repeat(64),
      casePurpose: "prepare_claim",
    },
    currentJobId: "same-analysis-job",
    missingItems: [],
    failure: null,
  };
  f.loaded.workspaceJobId = "same-analysis-job";
  expect(await f.execute("analyze_legal")).toMatchObject({
    status: "pending",
    operationId: "same-analysis-job",
  });
  expect(f.calls).toHaveLength(0);
  expect(await f.execute("prepare_report")).toMatchObject({ status: "pending" });
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]).toMatchObject({ input: { options: { continueWithReport: true } } });
});

test.each(["consent", "archive", "revision"] as const)(
  "%s changes stop a new execution",
  async (change) => {
    const f = fixture();
    if (change === "consent") f.loaded.canMutate = false;
    if (change === "archive") f.loaded.archived = true;
    await expect(
      f.execute("analyze_legal", change === "revision" ? { expectedRevision: 1 } : {}),
    ).rejects.toBeInstanceOf(ConversationAgentError);
    expect(f.calls).toEqual([]);
  },
);

test("account or deletion revocation fences both a cached receipt and a late admitted result", async () => {
  const f = fixture();
  await f.execute("show_preparation", {}, "receipt");
  f.revoke();
  await expect(f.execute("show_preparation", {}, "receipt")).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  const late = fixture();
  late.deps.analyze = async () => {
    late.revoke();
    return { operationId: "accepted-job", workspaceRevision: 8 };
  };
  await expect(late.execute("analyze_legal")).rejects.toMatchObject({ code: "NOT_FOUND" });
});

test("quota and ambiguous timeouts are propagated and never silently replaced by a report or retry", async () => {
  for (const code of ["USER_QUOTA_EXCEEDED", "JOB_TIMEOUT"]) {
    const f = fixture();
    f.deps.analyze = async () => {
      throw Object.assign(new Error(code), { code });
    };
    await expect(f.execute("prepare_report")).rejects.toMatchObject({ code });
    expect(f.calls).toEqual([]);
  }
});

test("an explicit analysis retry after failure admits once and replays the same request", async () => {
  const f = fixture(limitedConversationState());
  f.loaded.state.analysis = {
    ...f.loaded.state.analysis,
    status: "failed",
    failure: "MODEL_UNAVAILABLE",
    missingItems: ["공급자 응답을 확인하지 못했어요."],
  };
  const first = await f.execute("analyze_legal", {}, "explicit-retry");
  expect(first).toMatchObject({ status: "pending", operationId: "analysis-operation" });
  expect(await f.execute("analyze_legal", {}, "explicit-retry")).toEqual(first);
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]).toMatchObject({ input: { options: { continueWithReport: false } } });
});

test("a report request after analysis failure preserves its limits without another model call", async () => {
  const f = fixture(limitedConversationState());
  f.loaded.state.analysis.status = "failed";
  f.loaded.state.analysis.failure = "MODEL_UNAVAILABLE";
  f.loaded.state.analysis.missingItems = ["공급자 오류로 법률 조사를 완료하지 못했어요."];
  expect(await f.execute("prepare_report")).toMatchObject({
    pane: "report",
    status: "ready",
    missingItems: ["공급자 오류로 법률 조사를 완료하지 못했어요."],
  });
  expect(f.calls.map((call) => call.kind)).toEqual(["report"]);
});

for (const journey of conversationJourneyCases)
  test(`${journey.casePurpose} → limited report → ${journey.followup} preserves unknowns without re-search`, async () => {
    const f = fixture(limitedConversationState(journey.casePurpose));
    expect(await f.execute("analyze_legal")).toMatchObject({
      status: "ready",
      missingItems: f.loaded.state.analysis.missingItems,
    });
    expect(f.calls).toEqual([]);
    const report = await f.execute("prepare_report");
    expect(report.missingItems.join(" ")).toContain(journey.unknown);
    expect(f.calls.map((c) => c.kind)).toEqual(["report"]);
    f.loaded.state.report = {
      status: "ready",
      id: "reviewed-report",
      revision: 3,
      basis: f.loaded.state.analysis.basis,
      currentJobId: null,
      failure: null,
    };
    expect(await f.execute("resolve_followup", { choice: journey.followup })).toMatchObject({
      pane: "followup",
      status: "ready",
    });
    expect(f.calls.map((c) => c.kind)).toEqual(["report", "resolution"]);
    expect(f.loaded.state.snapshot?.limitations).toEqual(f.loaded.state.analysis.missingItems);
    expect(f.loaded.state.snapshot?.citations).toEqual([]);
  });

test("saving fixes both the reviewed report identity and its exact revision", async () => {
  const f = fixture(limitedConversationState());
  f.loaded.state.report = {
    status: "ready",
    id: "report",
    revision: 3,
    basis: f.loaded.state.analysis.basis,
    currentJobId: null,
    failure: null,
  };
  await expect(
    f.execute("save_report", { reportId: "report", reportRevision: 2 }),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect(await f.execute("save_report", { reportId: "report", reportRevision: 3 })).toMatchObject({
    status: "require_confirmation",
    pane: "report",
  });
  expect(f.calls).toEqual([]);
});

test("an admission alone never makes a missing report complete", async () => {
  const f = fixture(limitedConversationState());
  f.deps.prepareReport = async () => ({ operationId: null, workspaceRevision: 8 });
  expect(await f.execute("prepare_report")).toMatchObject({ pane: "report", status: "blocked" });
  expect(f.loaded.state.report.id).toBeNull();
});

test.each(["wrong-request", "old-revision", "pending-without-job"] as const)(
  "a corrupt receipt cannot publish %s",
  async (failure) => {
    const f = fixture();
    f.deps.once = async (input) => ({
      contractVersion: "conversation-report-v1",
      requestId: failure === "wrong-request" ? "other" : input.request.requestId,
      workspaceRevision: failure === "old-revision" ? 1 : 8,
      pane: "analysis",
      status: failure === "pending-without-job" ? "pending" : "ready",
      missingItems: [],
      operationId: null,
    });
    await expect(f.execute("show_preparation")).rejects.toMatchObject({ code: "INVALID_STATE" });
  },
);
