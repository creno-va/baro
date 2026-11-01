import { afterEach, expect, setSystemTime, spyOn, test } from "bun:test";
import { modelBounds } from "../scripts/provision-ai-budget";
import type { V2Summary } from "../src/contracts/v2";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createV2WorkspaceRepository } from "../src/server/db/v2-workspace";
import * as gatewayBudget from "../src/server/modules/budget/gateway-ledger";
import * as gatewayWire from "../src/server/modules/llm-gateway/service";
import { createReworkCaseService } from "../src/server/modules/rework/case-context";
import { createReconciliationRuntime } from "../src/server/runtime/rework-reconciliation";
import { syntheticGatewayInput } from "./helpers/gateway-input";
import observation from "./helpers/gemini-observation";
import { reportFixture } from "./helpers/report-fixture";

const spies: { mockRestore(): void }[] = [];
const fixtures: Awaited<ReturnType<typeof reportFixture>>[] = [];
afterEach(() => {
  setSystemTime();
  for (const spy of spies.splice(0)) spy.mockRestore();
  for (const f of fixtures.splice(0)) f.db.close();
});
async function fixture(
  purpose: "prepare_claim" | "respond_to_claim" = "prepare_claim",
  initial = false,
) {
  const f = await reportFixture();
  fixtures.push(f);
  setSystemTime(new Date(f.actor.now));
  const wires: unknown[] = [];
  const originalWire = gatewayWire.prepareGatewayWireInput;
  spies.push(
    spyOn(gatewayWire, "prepareGatewayWireInput").mockImplementation((phase, input) => {
      if (phase === "workspace_summary_reconciliation") wires.push(structuredClone(input));
      return originalWire(phase, input);
    }),
  );
  const ledgerStages: string[] = [];
  const originalBudget = gatewayBudget.createGatewayBudgetService;
  spies.push(
    spyOn(gatewayBudget, "createGatewayBudgetService").mockImplementation((options) => {
      const budget = originalBudget(options);
      return {
        ...budget,
        restoreAdmission: async (...args) => {
          const value = await budget.restoreAdmission(...args);
          ledgerStages.push(value ? "restored" : "restore-denied");
          return value;
        },
        createLedger: (input) => {
          const ledger = budget.createLedger(input);
          return {
            ...ledger,
            beforeDispatch: async (request) => {
              try {
                const handle = await ledger.beforeDispatch(request);
                ledgerStages.push(handle ? "admitted" : "dispatch-denied");
                return handle;
              } catch (e) {
                ledgerStages.push(`dispatch-${(e as { code?: string })?.code ?? "unknown"}`);
                throw e;
              }
            },
            confirmDispatch: async (handle) => {
              const sent = await ledger.confirmDispatch(handle);
              ledgerStages.push(sent ? "confirmed" : "confirm-denied");
              return sent;
            },
          };
        },
      };
    }),
  );
  const core = createV2Core(f.db.binding, f.core.cipher, { applicationCostLimitsEnabled: false });
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
  if (initial) {
    f.db.sqlite
      .query("UPDATE v2_workspaces SET status='intake',confirmed_summary_revision=NULL WHERE id=?")
      .run(f.workspaceId);
    f.db.sqlite
      .query(
        "UPDATE v2_intakes SET status='reviewing_summary',confirmed_summary_revision=NULL WHERE id=?",
      )
      .run(f.workspaceId);
  }
  const calls: string[] = [],
    pending: Promise<void>[] = [],
    confirmed: string[] = [];
  let auditPass = true;
  const env = {
    APP_ENV: "preview",
    DB: f.db.binding,
    AI_GATEWAY_ID: "synthetic-reconciliation",
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
        const input = data as {
          request: { id: string; input: { explanation: string } };
          before: V2Summary;
          context: {
            conversation: { caseContext: { casePurpose: string } };
            latestMessage: { id: string; workspaceRevision: number; text: string };
          };
        };
        expect(input.context.conversation.caseContext.casePurpose).toBe(purpose);
        const output = phase.endsWith("_audit")
          ? {
              pass: auditPass,
              findings: [],
              unsupportedFactIds: [],
              legalClaimsSupported: auditPass,
              strategyDetected: false,
            }
          : {
              after: {
                ...input.before,
                revision: input.before.revision + 1,
                overview: `${input.before.overview} 추가 진술을 구분했습니다.`,
                facts: [
                  ...input.before.facts,
                  {
                    id: `correction-${input.request.id}`,
                    text: input.context.latestMessage.text,
                    attribution: "user_statement",
                    certainty: "reported",
                    significance: "neutral",
                    references: [
                      {
                        kind: "user_message",
                        messageId: input.context.latestMessage.id,
                        workspaceRevision: input.context.latestMessage.workspaceRevision,
                      },
                    ],
                    conflictingFactIds: [],
                    userEdited: false,
                  },
                ],
              },
              reasons: ["기존 원문과 추가 진술을 함께 보존했습니다."],
            };
        return {
          id: `synthetic-reconciliation-${calls.length}`,
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
  const options = {
    clock: () => f.actor.now,
    waitUntil: (p: Promise<void>) => pending.push(p),
    confirmed: async (_owner: string, caseId: string) => {
      confirmed.push(caseId);
    },
  };
  const runtime = createReconciliationRuntime(core, env, options),
    owner = { ownerId: f.actor.ownerId, caseId: f.workspaceId };
  const execute = async (jobId: string) => {
    const row = f.db.sqlite
      .query("SELECT target_revision,runtime_instance_id FROM v2_jobs WHERE id=?")
      .get(jobId) as { target_revision: number; runtime_instance_id: string };
    const result = await runtime.execute(
      {
        ownerId: owner.ownerId,
        workspaceId: owner.caseId,
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
    options,
    runtime,
    owner,
    calls,
    wires,
    ledgerStages,
    confirmed,
    execute,
    rejectAudit: () => {
      auditPass = false;
    },
  };
}
for (const purpose of ["prepare_claim", "respond_to_claim"] as const)
  test(`native generation + independent audit for ${purpose} proposes before explicit confirmation and replays after runtime recreation`, async () => {
    const f = await fixture(purpose),
      key = crypto.randomUUID(),
      input = {
        expectedRevision: f.rev(),
        summaryRevision: 1,
        kind: "addition" as const,
        explanation: "추가로 계약 당시 문자 대화도 남아 있다는 합성 진술입니다.",
      };
    const before = await createV2WorkspaceRepository(f.core.binding, f.core.cipher).readIntake(
      f.actor,
      f.workspaceId,
    );
    if (!before?.summary) throw new Error("Missing canonical summary");
    const requested = await f.runtime.service.request(f.owner, key, input);
    expect(requested.status).toBe("pending");
    expect(f.calls).toEqual([]);
    expect(
      await createReconciliationRuntime(f.core, f.env, f.options).service.request(
        f.owner,
        key,
        input,
      ),
    ).toEqual(requested);
    if (!requested.currentJobId) throw new Error("Missing actual reconciliation job");
    const executed = await f.execute(requested.currentJobId);
    const changes = (a: unknown, b: unknown, path = "input"): string[] => {
      if (JSON.stringify(a) === JSON.stringify(b)) return [];
      if (a && b && typeof a === "object" && typeof b === "object") {
        const left = a as Record<string, unknown>,
          right = b as Record<string, unknown>;
        if (Object.keys(left).join() !== Object.keys(right).join()) return [`${path}.$keys`];
        return Object.keys(left).flatMap((key) => changes(left[key], right[key], `${path}.${key}`));
      }
      return [path];
    };
    expect(f.wires.length).toBeGreaterThan(1);
    expect(f.wires.flatMap((value) => changes(f.wires[0], value))).toEqual([]);
    expect(f.ledgerStages).not.toContain("restore-denied");
    expect(f.ledgerStages).not.toContain("dispatch-denied");
    expect(f.ledgerStages).toEqual(["restored", "admitted", "confirmed", "admitted", "confirmed"]);

    expect(executed?.status).toBe("completed");
    expect(f.calls).toEqual([
      "workspace_summary_reconciliation",
      "workspace_summary_reconciliation_audit",
    ]);
    const proposed = await f.runtime.service.read(f.owner);
    expect(proposed.state.status).toBe("proposed");
    expect(proposed.summary).toEqual(before.summary);
    if (!proposed.state.proposal) throw new Error("Missing actual proposal");
    const confirmKey = crypto.randomUUID(),
      confirmInput = {
        expectedRevision: f.rev(),
        proposalId: proposed.state.proposal.id,
        summaryRevision: 1,
      };
    const final = await f.runtime.service.confirm(f.owner, confirmKey, confirmInput);
    expect(final.status).toBe("confirmed");
    expect(final.confirmedSummaryRevision).toBe(2);
    const recreated = createReconciliationRuntime(f.core, f.env, f.options);
    expect(await recreated.service.confirm(f.owner, confirmKey, confirmInput)).toEqual(final);
    expect((await recreated.service.read(f.owner)).state.status).toBe("confirmed");
    expect(f.confirmed).toEqual([f.workspaceId]);
    expect(
      (
        await createV2WorkspaceRepository(f.core.binding, f.core.cipher).readIntake(
          f.actor,
          f.workspaceId,
        )
      )?.summary?.facts.at(-1)?.text,
    ).toBe(input.explanation);
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_jobs").get()).toEqual({ n: 1 });
    expect(
      f.db.sqlite.query("SELECT responses_used,responses_reserved FROM v2_daily_usage").get(),
    ).toEqual({ responses_used: 1, responses_reserved: 0 });
  });
test("initial summary can be reconciled without restarting the two-round question intake", async () => {
  const f = await fixture("respond_to_claim", true);
  const state = await f.runtime.service.request(f.owner, crypto.randomUUID(), {
    expectedRevision: f.rev(),
    summaryRevision: 1,
    kind: "correction",
    explanation: "처음 설명한 거래 날짜는 아직 원문 확인이 필요합니다.",
  });
  if (!state.currentJobId) throw new Error("Missing admitted initial reconciliation");
  await f.execute(state.currentJobId);
  const proposed = (await f.runtime.service.read(f.owner)).state;
  if (!proposed.proposal) throw new Error("Missing initial proposal");
  await f.runtime.service.confirm(f.owner, crypto.randomUUID(), {
    expectedRevision: f.rev(),
    proposalId: proposed.proposal.id,
    summaryRevision: 1,
  });
  expect(
    (
      await createV2WorkspaceRepository(f.core.binding, f.core.cipher).findWorkspace(
        f.actor,
        f.workspaceId,
      )
    )?.confirmedSummaryRevision,
  ).toBe(2);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_question_batches").get()).toEqual({ n: 0 });
  expect(f.calls).toHaveLength(2);
});
test("an independent audit rejection fails the job and preserves canonical summary", async () => {
  const f = await fixture();
  f.rejectAudit();
  const request = await f.runtime.service.request(f.owner, crypto.randomUUID(), {
    expectedRevision: f.rev(),
    summaryRevision: 1,
    kind: "addition",
    explanation: "새로운 자료 보관 위치를 추가로 설명합니다.",
  });
  if (!request.currentJobId) throw new Error("Missing job");
  expect((await f.execute(request.currentJobId))?.status).toBe("failed");
  const final = await f.runtime.service.read(f.owner);
  expect(final.state.failure).toBe("POLICY_REJECTED");
  expect(final.state.proposal).toBeNull();
  expect(final.summary.revision).toBe(1);
  expect(f.confirmed).toEqual([]);
});
test("a second request runtime cancels another isolate's actual paid worker and preserves the hold", async () => {
  const f = await fixture();
  const request = await f.runtime.service.request(f.owner, crypto.randomUUID(), {
    expectedRevision: f.rev(),
    summaryRevision: 1,
    kind: "addition",
    explanation: "추가 설명을 제출한 뒤 실행을 중단합니다.",
  });
  if (!request.currentJobId || !request.request) throw new Error("Missing admitted request");
  const attemptId = (
    f.db.sqlite
      .query("SELECT attempt_id FROM v2_execution_job_holds WHERE job_id=?")
      .get(request.currentJobId) as { attempt_id: string }
  ).attempt_id;
  const lease = await createV2JobsRepository(f.core).acquire(
    f.actor,
    request.currentJobId,
    "other-reconciliation-worker",
    "2026-10-06T00:04:00.000Z",
    attemptId,
  );
  if (!lease) throw new Error("Missing other isolate lease");
  const key = crypto.randomUUID(),
    input = { expectedRevision: f.rev(), requestId: request.request.id };
  const next = createReconciliationRuntime(f.core, f.env, f.options);
  const cancelled = await next.service.cancel(f.owner, key, input);
  expect(cancelled.status).toBe("cancelled");
  expect(
    await createReconciliationRuntime(f.core, f.env, f.options).service.cancel(f.owner, key, input),
  ).toEqual(cancelled);
  expect((await createV2JobsRepository(f.core).find(f.actor, request.currentJobId))?.status).toBe(
    "cancelled",
  );
  expect(f.calls).toEqual([]);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_execution_job_holds").get()).toEqual({
    n: 1,
  });
  expect((await next.service.read(f.owner)).summary.revision).toBe(1);
});
