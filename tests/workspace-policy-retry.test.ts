import { afterEach, expect, test } from "bun:test";
import { canRetryV2Job } from "../src/server/db/v2-job-retry";
import { executeWorkspace } from "../src/server/modules/workspace/execution";
import { createWorkspacePipeline } from "../src/server/modules/workspace/pipeline";
import { customerWorkspaceFixture, runCustomerJob } from "./helpers/customer-workspace";

const NOW = "2026-10-06T00:00:00.000Z";
const databases: Awaited<ReturnType<typeof customerWorkspaceFixture>>["db"][] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
async function fixture() {
  const f = await customerWorkspaceFixture();
  databases.push(f.db);
  return f;
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function guard(f: Fixture) {
  return {
    ownerId: f.owner.userId,
    workspaceId: f.workspace.id,
    expectedRevision: (await f.service.find(f.owner.userId, f.workspace.id)).workspaceRevision,
    now: NOW,
  };
}
async function answeredBatch(f: Fixture) {
  expect((await runCustomerJob(f, "intake_questions")).result.status).toBe("completed");
  const intake = await f.service.intake(f.owner.userId, f.workspace.id);
  const question = intake?.batches.at(-1)?.questions[0];
  if (!intake || !question) throw new Error("Synthetic question absent");
  await f.service.answers(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
    expectedRevision: intake.revision,
    answers: [
      { questionId: question.id, status: "answered", value: "계약서와 거래 내역을 보관했습니다." },
    ],
  });
}
async function failAttempt(f: Fixture, id: string) {
  const acquired = await f.jobs.acquire(
    { ownerId: f.owner.userId, now: NOW },
    id,
    crypto.randomUUID(),
    "2026-10-06T00:04:00.000Z",
  );
  if (!acquired) throw new Error("Synthetic lease absent");
  expect(
    await f.jobs.fail(
      { ownerId: f.owner.userId, now: NOW },
      acquired.lease,
      "POLICY_REJECTED",
      false,
    ),
  ).toBe(true);
}

test("retry eligibility only recovers intake policy failures and enforces separate attempt caps", () => {
  const job: Parameters<typeof canRetryV2Job>[0] = {
    status: "failed",
    target: { kind: "workspace", caseId: "workspace", workspaceRevision: 1 },
    kind: "intake_questions",
    failure: "POLICY_REJECTED",
    retryable: false,
    attempts: 1,
  };
  expect(canRetryV2Job(job)).toBe(true);
  expect(canRetryV2Job({ ...job, kind: "intake_summary", attempts: 2 })).toBe(true);
  expect(canRetryV2Job({ ...job, attempts: 3, retryable: true })).toBe(false);
  for (const kind of [
    "chat_response",
    "file_processing",
    "report_build",
    "portfolio_sanitize",
  ] as const)
    expect(canRetryV2Job({ ...job, kind, retryable: true })).toBe(false);
  expect(
    canRetryV2Job({
      ...job,
      target: { kind: "file", caseId: "workspace", fileId: "file", fileRevision: 1 },
    }),
  ).toBe(false);
  for (const status of [
    "queued",
    "running",
    "validating",
    "completed",
    "cancelled",
    "superseded",
  ] as const)
    expect(canRetryV2Job({ ...job, status })).toBe(false);
  expect(canRetryV2Job({ ...job, failure: "MODEL_UNAVAILABLE", retryable: false })).toBe(false);
  expect(
    canRetryV2Job({ ...job, failure: "MODEL_UNAVAILABLE", retryable: true, attempts: 9 }),
  ).toBe(true);
  expect(
    canRetryV2Job({ ...job, failure: "MODEL_UNAVAILABLE", retryable: true, attempts: 10 }),
  ).toBe(false);
});

test("legacy retryable=0 failure reuses saved answers and only publishes a newly audited draft", async () => {
  const f = await fixture();
  await answeredBatch(f);
  const failed = await runCustomerJob(f, "intake_questions", false);
  expect(failed.result.status).toBe("failed");
  const saved = await f.service.intake(f.owner.userId, f.workspace.id);
  const job = await f.service.job(f.owner.userId, f.workspace.id, failed.params.jobId);
  expect(job).toMatchObject({
    status: "failed",
    failure: "POLICY_REJECTED",
    attempts: 1,
    retryable: true,
  });
  expect((await f.service.latestJob(f.owner.userId, f.workspace.id))?.retryable).toBe(true);
  expect(f.db.sqlite.query("SELECT retryable FROM v2_jobs WHERE id=?").get(job.id)).toEqual({
    retryable: 0,
  });

  let auditPass = false;
  const phases: string[] = [];
  const execute = async () => {
    const pending = await f.jobs.find({ ownerId: f.owner.userId, now: NOW }, job.id);
    if (pending?.target.kind !== "workspace") throw new Error("Synthetic job absent");
    return executeWorkspace(
      f.core,
      { ...failed.params, workspaceRevision: pending.target.workspaceRevision },
      `${job.id}-${pending.attempts + 1}`,
      {
        clock: () => NOW,
        authorize: async () => true,
        pipeline: async () =>
          createWorkspacePipeline(
            {
              call: async (phase, raw) => {
                phases.push(phase);
                if (phase === "workspace_audit")
                  return {
                    pass: auditPass,
                    findings: [],
                    unsupportedFactIds: [],
                    legalClaimsSupported: true,
                    strategyDetected: false,
                  };
                const context = raw as { intake: typeof saved };
                expect(context.intake?.narrative).toBe(saved?.narrative);
                expect(context.intake?.batches).toEqual(saved?.batches);
                return {
                  questions: [
                    {
                      id: "draft",
                      prompt: "자료를 받은 날짜도 확인할 수 있나요?",
                      answerType: "text",
                      options: [],
                    },
                  ],
                };
              },
            },
            { reserve: async () => true, invocation: () => crypto.randomUUID() },
          ),
      },
    );
  };
  expect(await f.jobs.retry(await guard(f), job.id)).toBe(true);
  expect((await execute()).status).toBe("failed");
  expect((await f.service.intake(f.owner.userId, f.workspace.id))?.batches).toEqual(saved?.batches);
  expect(phases).toEqual([
    "workspace_questions",
    "workspace_audit",
    "workspace_questions",
    "workspace_audit",
  ]);
  auditPass = true;
  expect(await f.jobs.retry(await guard(f), job.id)).toBe(true);
  expect((await execute()).status).toBe("completed");
  const completed = await f.service.intake(f.owner.userId, f.workspace.id);
  expect(completed?.batches).toHaveLength(2);
  expect(completed?.batches[0]).toEqual(saved?.batches[0]);
  expect(phases.slice(-2)).toEqual(["workspace_questions", "workspace_audit"]);
});

test.each(["intake_questions", "intake_summary"] as const)(
  "%s recovery stops after three full attempts including legacy failures",
  async (kind) => {
    const f = await fixture();
    if (kind === "intake_summary") await answeredBatch(f);
    const failed = await runCustomerJob(f, kind, false);
    expect(failed.result.status).toBe("failed");
    for (let attempt = 2; attempt <= 3; attempt++) {
      expect(await f.jobs.retry(await guard(f), failed.params.jobId)).toBe(true);
      await failAttempt(f, failed.params.jobId);
      expect((await f.service.latestJob(f.owner.userId, f.workspace.id))?.retryable).toBe(
        attempt < 3,
      );
    }
    expect(await f.jobs.retry(await guard(f), failed.params.jobId)).toBe(false);
    await expect(
      f.service.retry(f.owner.userId, f.workspace.id, failed.params.jobId, {
        expectedRevision: (await guard(f)).expectedRevision,
      }),
    ).rejects.toThrow("REVIEW_REQUIRED");
    expect(
      (await f.service.job(f.owner.userId, f.workspace.id, failed.params.jobId)).attempts,
    ).toBe(3);
  },
);

test("legacy recovery preserves ownership, revision, tombstone, quota and atomic claim guards", async () => {
  const f = await fixture();
  const failed = await runCustomerJob(f, "intake_questions", false);
  const g = await guard(f),
    id = failed.params.jobId;
  expect(await f.jobs.retry({ ...g, ownerId: crypto.randomUUID() }, id)).toBe(false);
  expect(await f.jobs.retry({ ...g, expectedRevision: g.expectedRevision - 1 }, id)).toBe(false);
  f.db.sqlite.query("INSERT INTO v2_tombstones VALUES('workspace',?,?)").run(f.workspace.id, NOW);
  expect(await f.jobs.retry(g, id)).toBe(false);
  f.db.sqlite.query("DELETE FROM v2_tombstones WHERE target_id=?").run(f.workspace.id);
  f.db.sqlite.query("UPDATE v2_daily_usage SET responses_used=200 WHERE owner_id=?").run(g.ownerId);
  expect(await f.jobs.retry(g, id)).toBe(false);
  f.db.sqlite.query("UPDATE v2_daily_usage SET responses_used=0 WHERE owner_id=?").run(g.ownerId);
  expect(
    (await Promise.all([f.jobs.retry(g, id), f.jobs.retry(g, id)])).filter(Boolean),
  ).toHaveLength(1);
  expect(
    f.db.sqlite
      .query("SELECT responses_reserved FROM v2_daily_usage WHERE owner_id=?")
      .get(g.ownerId),
  ).toEqual({ responses_reserved: 1 });
});

test("a policy failure on a chat job remains unavailable for retry", async () => {
  const f = await fixture();
  const failed = await runCustomerJob(f, "intake_questions", false);
  f.db.sqlite
    .query("UPDATE v2_jobs SET kind='chat_response',retryable=1 WHERE id=?")
    .run(failed.params.jobId);
  expect((await f.service.latestJob(f.owner.userId, f.workspace.id))?.retryable).toBe(false);
  expect(await f.jobs.retry(await guard(f), failed.params.jobId)).toBe(false);
  await expect(
    f.service.retry(f.owner.userId, f.workspace.id, failed.params.jobId, {
      expectedRevision: (await guard(f)).expectedRevision,
    }),
  ).rejects.toThrow("REVIEW_REQUIRED");
});

test("ordinary retryable failures retain their ten-attempt repository limit", async () => {
  const f = await fixture();
  const failed = await runCustomerJob(f, "intake_questions", false);
  const id = failed.params.jobId;
  f.db.sqlite
    .query("UPDATE v2_jobs SET failure_code='MODEL_UNAVAILABLE',retryable=1,attempts=9 WHERE id=?")
    .run(id);
  expect((await f.service.latestJob(f.owner.userId, f.workspace.id))?.retryable).toBe(true);
  expect(await f.jobs.retry(await guard(f), id)).toBe(true);
  const acquired = await f.jobs.acquire(
    { ownerId: f.owner.userId, now: NOW },
    id,
    crypto.randomUUID(),
    "2026-10-06T00:04:00.000Z",
  );
  if (!acquired) throw new Error("Synthetic lease absent");
  expect(
    await f.jobs.fail(
      { ownerId: f.owner.userId, now: NOW },
      acquired.lease,
      "MODEL_UNAVAILABLE",
      true,
    ),
  ).toBe(true);
  expect((await f.service.latestJob(f.owner.userId, f.workspace.id))?.retryable).toBe(false);
  expect(await f.jobs.retry(await guard(f), id)).toBe(false);
});

test("editing saved answers supersedes a policy failure and allows a fresh generation", async () => {
  const f = await fixture();
  await answeredBatch(f);
  const failed = await runCustomerJob(f, "intake_questions", false);
  const intake = await f.service.intake(f.owner.userId, f.workspace.id);
  const question = intake?.batches[0]?.questions[0];
  if (!intake || !question) throw new Error("Synthetic question absent");
  await f.service.answers(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
    expectedRevision: intake.revision,
    answers: [{ questionId: question.id, status: "answered", value: "자료를 다시 확인했습니다." }],
  });
  expect((await f.service.latestJob(f.owner.userId, f.workspace.id))?.retryable).toBe(false);
  expect(await f.jobs.retry(await guard(f), failed.params.jobId)).toBe(false);
  await expect(
    f.service.retry(f.owner.userId, f.workspace.id, failed.params.jobId, {
      expectedRevision: (await guard(f)).expectedRevision,
    }),
  ).rejects.toThrow("STALE_REVISION");
  expect((await runCustomerJob(f, "intake_questions")).result.status).toBe("completed");
  expect((await f.service.intake(f.owner.userId, f.workspace.id))?.batches).toHaveLength(2);
});
