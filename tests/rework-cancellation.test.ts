import { expect, test } from "bun:test";
import { z } from "zod";
import { v2ReworkVersionSchema, v2SummaryReconciliationSchema } from "../src/contracts/v2";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2ReworkRepository } from "../src/server/db/v2-rework";
import { customerWorkspaceFixture } from "./helpers/customer-workspace";

const schema = z.object({
  format: z.literal("summary-reconciliation-v1"),
  state: v2SummaryReconciliationSchema,
});
async function fixture(running: boolean) {
  const f = await customerWorkspaceFixture();
  f.db.sqlite
    .query("UPDATE v2_workspaces SET status='active',confirmed_summary_revision=1 WHERE id=?")
    .run(f.workspace.id);
  const g = {
    ownerId: f.owner.userId,
    workspaceId: f.workspace.id,
    expectedRevision: f.workspace.workspaceRevision,
    now: f.now,
  };
  const repo = createV2ReworkRepository(f.core, { clock: () => f.now });
  const jobId = crypto.randomUUID(),
    requestId = crypto.randomUUID();
  const state = v2SummaryReconciliationSchema.parse({
    contractVersion: v2ReworkVersionSchema.value,
    workspaceRevision: g.expectedRevision + 1,
    status: running ? "running" : "pending",
    request: {
      id: requestId,
      createdAt: f.now,
      input: {
        expectedRevision: g.expectedRevision,
        summaryRevision: 1,
        kind: "correction",
        explanation: "계약 체결일을 실제 대화와 대조해 주세요.",
      },
    },
    proposal: null,
    currentJobId: jobId,
    failure: null,
    confirmedSummaryRevision: null,
    confirmedWorkspaceRevision: null,
  });
  expect(
    await repo.write(g, {
      kind: "reconciliation",
      expectedVersion: 0,
      schema,
      value: { format: "summary-reconciliation-v1", state },
    }),
  ).not.toBeNull();
  expect(
    await f.jobs.admitWorkspace(
      g,
      { operationId: crypto.randomUUID(), key: crypto.randomUUID(), requestHash: "a".repeat(64) },
      jobId,
      "chat_response",
      {
        id: requestId,
        request: {
          expectedRevision: g.expectedRevision,
          text: state.request?.input.explanation ?? "",
          selectedFileIds: [],
        },
      },
    ),
  ).toBe(true);
  const acquired = running
    ? await f.jobs.acquire(g, jobId, "other-isolate-token", "2026-10-06T00:03:00.000Z")
    : null;
  if (running && !acquired) throw new Error("missing separate worker lease");
  const current = { ...g, expectedRevision: g.expectedRevision + 1 };
  // New core/repository instances share only the real database and encryption.
  const requestCore = createV2Core(f.db.binding, f.core.cipher),
    requestRepo = createV2ReworkRepository(requestCore, { clock: () => f.now });
  const cancel = async () => {
    const cancellation = await requestRepo.prepareCancellation(current, requestId);
    if (!cancellation) throw new Error("missing owner cancellation");
    return {
      cancellation,
      input: {
        kind: "reconciliation" as const,
        expectedVersion: 1,
        schema,
        bumpWorkspace: true,
        cancellation,
        value: {
          format: "summary-reconciliation-v1" as const,
          state: {
            ...state,
            workspaceRevision: current.expectedRevision + 1,
            status: "cancelled" as const,
            currentJobId: null,
          },
        },
      },
    };
  };
  return { ...f, current, requestId, jobId, repo, requestRepo, cancel, acquired };
}
for (const running of [false, true])
  test(`owner atomically cancels ${running ? "another isolate's live lease" : "a queued task"} and prevents late publication`, async () => {
    const f = await fixture(running);
    try {
      const { input } = await f.cancel();
      expect(await f.requestRepo.write(f.current, input)).not.toBeNull();
      expect(await f.requestRepo.write(f.current, input)).toBeNull();
      expect((await f.jobs.find(f.current, f.jobId))?.status).toBe("cancelled");
      expect(f.db.sqlite.query("SELECT responses_reserved FROM v2_daily_usage").get()).toEqual({
        responses_reserved: 0,
      });
      expect(
        f.db.sqlite
          .query("SELECT current_job_id,revision FROM v2_workspaces WHERE id=?")
          .get(f.workspace.id),
      ).toEqual({ current_job_id: null, revision: f.current.expectedRevision + 1 });
      if (f.acquired) {
        expect(
          await f.jobs.renew(
            { ownerId: f.current.ownerId, now: f.now },
            f.acquired.lease,
            "2026-10-06T00:04:00.000Z",
          ),
        ).toBe(false);
        expect(
          await f.repo.write(f.current, {
            kind: "analysis",
            expectedVersion: 0,
            schema: z.object({ late: z.boolean() }),
            value: { late: true },
            lease: f.acquired.lease,
          }),
        ).toBeNull();
      }
    } finally {
      f.db.close();
    }
  });
test("cancellation capability is case/record-specific, unforgeable, and checked again after revocation", async () => {
  const f = await fixture(true);
  try {
    const { input } = await f.cancel();
    expect(
      await f.requestRepo.prepareCancellation({ ...f.current, ownerId: "peer" }, f.requestId),
    ).toBeNull();
    await expect(
      f.requestRepo.write(f.current, { ...input, cancellation: { ...input.cancellation } }),
    ).rejects.toMatchObject({ code: "REPOSITORY_INPUT_INVALID" });
    await expect(
      f.requestRepo.write(f.current, { ...input, kind: "analysis" }),
    ).rejects.toMatchObject({ code: "REPOSITORY_INPUT_INVALID" });
    f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.owner.userId);
    expect(await f.requestRepo.write(f.current, input)).toBeNull();
    expect((await f.jobs.find(f.current, f.jobId))?.status).toBe("running");
  } finally {
    f.db.close();
  }
});
test("an obsolete source revision can retire its exact old job; a changed worker fence invalidates an issued capability", async () => {
  const f = await fixture(true);
  try {
    f.db.sqlite
      .query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?")
      .run(f.workspace.id);
    f.current.expectedRevision++;
    const old = await f.cancel();
    f.db.sqlite
      .query("UPDATE v2_jobs SET fencing=fencing+1,lease_token=? WHERE id=?")
      .run("replacement-isolate-token", f.jobId);
    expect(await f.requestRepo.write(f.current, old.input)).toBeNull();
    const current = await f.cancel();
    expect(await f.requestRepo.write(f.current, current.input)).not.toBeNull();
    expect((await f.jobs.find(f.current, f.jobId))?.status).toBe("cancelled");
  } finally {
    f.db.close();
  }
});
