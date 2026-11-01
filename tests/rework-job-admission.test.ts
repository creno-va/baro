import { expect, test } from "bun:test";
import { z } from "zod";
import { createV2AccountingRepository } from "../src/server/db/v2-accounting";
import { createV2Core, sqlClaim } from "../src/server/db/v2-core";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { researchRevisionBase } from "../src/server/db/v2-research-revision";
import { createV2ReworkRepository } from "../src/server/db/v2-rework";
import { createV2ReworkJobsRepository } from "../src/server/db/v2-rework-jobs";
import { completeLeaseStatements } from "../src/server/db/v2-workspace";
import { createGatewayExecutionPlanner } from "../src/server/modules/budget/execution-plan";
import { createGatewayBudgetService } from "../src/server/modules/budget/gateway-ledger";
import { MODEL_ID } from "../src/server/modules/llm-gateway/prompts";
import {
  gatewayWireIdentity,
  prepareGatewayWireInput,
} from "../src/server/modules/llm-gateway/service";
import { customerWorkspaceFixture } from "./helpers/customer-workspace";

const schema = z.object({
  kind: z.literal("legal_analysis"),
  jobId: z.string(),
  operationId: z.string(),
  beforeWorkspaceRevision: z.number(),
  targetWorkspaceRevision: z.number(),
  summaryRevision: z.number(),
});
async function fixture() {
  const f = await customerWorkspaceFixture();
  const core = createV2Core(f.db.binding, f.core.cipher, { applicationCostLimitsEnabled: false });
  f.db.sqlite
    .query("UPDATE v2_workspaces SET status='active',confirmed_summary_revision=1 WHERE id=?")
    .run(f.workspace.id);
  const g = {
    ownerId: f.owner.userId,
    workspaceId: f.workspace.id,
    expectedRevision: f.workspace.workspaceRevision,
    now: f.now,
  };
  await createV2AccountingRepository(core).ensurePrincipal(g);
  const jobId = crypto.randomUUID(),
    admission = {
      operationId: crypto.randomUUID(),
      key: crypto.randomUUID(),
      requestHash: "a".repeat(64),
    },
    invocationId = crypto.randomUUID();
  const wire = prepareGatewayWireInput("workspace_legal_plan", {});
  const request = {
    invocationId,
    requestId: jobId,
    phase: "workspace_legal_plan" as const,
    model: MODEL_ID,
    attemptOrdinal: 1,
    correction: false,
    ...(await gatewayWireIdentity(wire)),
    outputTokenUpperBound: wire.max_completion_tokens,
  };
  const planner = createGatewayExecutionPlanner({
    applicationCostLimitsEnabled: false,
    input: async () => ({}),
    bounds: async () => ({
      basis: "verified_model_context_limit",
      tokenizerRevision: "synthetic-only",
      textTokensUpperBound: 10000,
      framingTokensUpperBound: 0,
      vision: null,
      modelInputTokenLimit: 10000,
      modelContextTokenLimit: 20000,
      modelOutputTokenLimit: 10000,
      checkedAt: f.now,
      validUntil: "2026-10-07T00:00:00.000Z",
    }),
    verifyBounds: async (_d, digest) => ({
      digest,
      evidenceHash: "a".repeat(64),
      verifiedAt: f.now,
    }),
  });
  const budget = createGatewayBudgetService({
    core,
    environment: "preview",
    ownerId: f.owner.userId,
    clock: () => f.now,
    execution: planner.verify,
  });
  const paid = await budget.prepareAdmission(
    {
      operationId: admission.operationId,
      operationRevision: g.expectedRevision + 1,
      requestHash: admission.requestHash,
      jobId,
      targetKind: "workspace",
      targetId: g.workspaceId,
      targetRevision: g.expectedRevision + 1,
      invocationId,
      maximumAttempts: 3,
      deadlineAt: "2026-10-06T00:04:00.000Z",
      pricingProofId: null,
      fundingProofId: null,
      allocationProofId: null,
    },
    request,
  );
  if (!paid) throw new Error("missing synthetic paid admission");
  const task = {
    kind: "legal_analysis" as const,
    jobId,
    operationId: admission.operationId,
    beforeWorkspaceRevision: g.expectedRevision,
    targetWorkspaceRevision: g.expectedRevision + 1,
    summaryRevision: 1,
  };
  const input = {
    admission,
    jobId,
    kind: "legal_analysis" as const,
    summaryRevision: 1,
    task,
    schema,
    authority: { sql: "1", values: [] },
  };
  return {
    ...f,
    core,
    g,
    input,
    paid,
    jobs: createV2JobsRepository(core),
    tasks: createV2ReworkJobsRepository(core, { clock: () => f.now }),
  };
}
test("task, paid observation, quota, outbox and revision publish once; analysis-only revisions keep the research basis", async () => {
  const f = await fixture();
  try {
    expect(await f.tasks.admit(f.g, f.input, f.paid.paid)).not.toBeNull();
    expect(await f.tasks.admit(f.g, f.input, f.paid.paid)).toBeNull();
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_jobs").get()).toEqual({ n: 1 });
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_outbox").get()).toEqual({ n: 1 });
    expect(f.db.sqlite.query("SELECT responses_reserved n FROM v2_daily_usage").get()).toEqual({
      n: 1,
    });
    const target = f.g.expectedRevision + 1;
    expect(await researchRevisionBase(f.core, f.owner.userId, f.workspace.id, target, 1)).toBe(
      f.g.expectedRevision,
    );
    const acquired = await f.jobs.acquire(
      f.g,
      f.input.jobId,
      crypto.randomUUID(),
      "2026-10-06T00:03:00.000Z",
      f.paid.request.attemptId,
    );
    if (!acquired) throw new Error("missing lease");
    const g = { ...f.g, expectedRevision: target };
    expect(
      await createV2ReworkRepository(f.core, { clock: () => f.now }).write(g, {
        kind: "analysis",
        expectedVersion: 0,
        schema: z.object({ status: z.string() }),
        value: { status: "partial" },
        lease: acquired.lease,
        bumpWorkspace: true,
        statements: (claim) => [
          ...completeLeaseStatements(f.core, acquired.lease, claim, f.now),
          f.core.statement(
            `UPDATE v2_workspaces SET current_job_id=NULL WHERE id=? AND ${sqlClaim}`,
            [f.workspace.id, claim],
          ),
        ],
      }),
    ).not.toBeNull();
    expect(await researchRevisionBase(f.core, f.owner.userId, f.workspace.id, target + 1, 1)).toBe(
      f.g.expectedRevision,
    );
    f.db.sqlite
      .query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?")
      .run(f.workspace.id);
    expect(await researchRevisionBase(f.core, f.owner.userId, f.workspace.id, target + 2, 1)).toBe(
      target + 2,
    );
  } finally {
    f.db.close();
  }
});
for (const changed of ["quota", "consent", "source"] as const)
  test(`task admission does not bypass ${changed}`, async () => {
    const f = await fixture();
    try {
      if (changed === "quota")
        f.db.sqlite
          .query("UPDATE v2_daily_usage SET responses_used=200 WHERE owner_id=?")
          .run(f.owner.userId);
      if (changed === "consent")
        f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.owner.userId);
      const input =
        changed === "source" ? { ...f.input, authority: { sql: "0", values: [] } } : f.input;
      expect(await f.tasks.admit(f.g, input, f.paid.paid)).toBeNull();
      expect(f.db.sqlite.query("SELECT count(*) n FROM v2_jobs").get()).toEqual({ n: 0 });
      expect(
        f.db.sqlite.query("SELECT count(*) n FROM v2_rework_records WHERE state='published'").get(),
      ).toEqual({ n: 0 });
    } finally {
      f.db.close();
    }
  });
