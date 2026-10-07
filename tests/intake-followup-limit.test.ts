import { afterEach, expect, test } from "bun:test";
import { v2QuestionBatchSchema } from "../src/contracts/v2";
import { workspaceQuestionsOutputSchema } from "../src/server/modules/llm-gateway/v2/schemas";
import { readWorkspaceContext } from "../src/server/modules/workspace/context";
import { createWorkspacePipeline } from "../src/server/modules/workspace/pipeline";
import {
  createWorkspaceService,
  type WorkspaceJobInput,
} from "../src/server/modules/workspace/service";
import { customerWorkspaceFixture, runCustomerJob } from "./helpers/customer-workspace";

const NOW = "2026-10-06T00:00:00.000Z";
const databases: Awaited<ReturnType<typeof customerWorkspaceFixture>>["db"][] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
const question = (id: string) => ({
  id,
  prompt: `확인할 내용 ${id}은 무엇인가요?`,
  answerType: "text" as const,
  options: [],
});
const admission = () => ({
  operationId: crypto.randomUUID(),
  key: crypto.randomUUID(),
  requestHash: "a".repeat(64),
});

test("new model output permits one to three questions while stored legacy batches still accept five", () => {
  const questions = Array.from({ length: 5 }, (_, index) => question(`question-${index}`));
  expect(
    workspaceQuestionsOutputSchema.safeParse({ questions: questions.slice(0, 1) }).success,
  ).toBe(true);
  expect(
    workspaceQuestionsOutputSchema.safeParse({ questions: questions.slice(0, 3) }).success,
  ).toBe(true);
  expect(workspaceQuestionsOutputSchema.safeParse({ questions: [] }).success).toBe(false);
  expect(
    workspaceQuestionsOutputSchema.safeParse({ questions: questions.slice(0, 4) }).success,
  ).toBe(false);
  expect(
    v2QuestionBatchSchema.safeParse({
      id: "legacy",
      ordinal: 3,
      generatedForIntakeRevision: 1,
      questions,
      answers: [],
    }).success,
  ).toBe(true);
});

test.each([
  [3, 3],
  [3, 1],
  [1, 3],
])(
  "two rounds of %i and %i questions select summary; retries cannot add a third round",
  async (firstCount, secondCount) => {
    const f = await customerWorkspaceFixture();
    databases.push(f.db);
    const actor = { ownerId: f.owner.userId, now: NOW };
    const guard = async () => ({
      ...actor,
      workspaceId: f.workspace.id,
      expectedRevision: (await f.service.find(actor.ownerId, f.workspace.id)).workspaceRevision,
    });
    const oldJob = crypto.randomUUID();
    expect(
      await f.jobs.admitWorkspace(await guard(), admission(), oldJob, "intake_questions"),
    ).toBe(true);
    const oldLease = await f.jobs.acquire(
      actor,
      oldJob,
      crypto.randomUUID(),
      "2026-10-06T00:04:00.000Z",
    );
    if (!oldLease) throw new Error("Missing lease");
    expect(await f.jobs.fail(actor, oldLease.lease, "MODEL_UNAVAILABLE", true)).toBe(true);
    const requested: WorkspaceJobInput["kind"][] = [];
    const service = createWorkspaceService(f.core, {
      clock: () => NOW,
      prepareJob: async (input) => {
        requested.push(input.kind);
        return null;
      },
    });
    const checkNext = async (kind: WorkspaceJobInput["kind"]) => {
      await expect(
        service.advance(actor.ownerId, f.workspace.id, crypto.randomUUID(), {
          expectedRevision: (await guard()).expectedRevision,
        }),
      ).rejects.toThrow("BUDGET_UNAVAILABLE");
      expect(requested.at(-1)).toBe(kind);
    };
    await checkNext("intake_questions");
    for (const status of ["unknown", "skipped"] as const) {
      const count = status === "unknown" ? firstCount : secondCount;
      expect(
        (await runCustomerJob(f, "intake_questions", true, undefined, count)).result.status,
      ).toBe("completed");
      const intake = await f.service.intake(actor.ownerId, f.workspace.id);
      const latest = intake?.batches.at(-1);
      if (!intake || !latest) throw new Error("Missing questions");
      expect(latest.questions).toHaveLength(count);
      await f.service.answers(actor.ownerId, f.workspace.id, crypto.randomUUID(), {
        expectedRevision: intake.revision,
        answers: latest.questions.map((q) => ({ questionId: q.id, status })),
      });
      await checkNext(status === "unknown" ? "intake_questions" : "intake_summary");
    }
    expect(
      await f.jobs.admitWorkspace(
        await guard(),
        admission(),
        crypto.randomUUID(),
        "intake_questions",
      ),
    ).toBe(false);
    expect(await f.jobs.retry(await guard(), oldJob)).toBe(false);
    await expect(
      service.retry(actor.ownerId, f.workspace.id, oldJob, {
        expectedRevision: (await guard()).expectedRevision,
      }),
    ).rejects.toThrow("REVIEW_REQUIRED");
    const context = await readWorkspaceContext(f.core, actor, f.workspace.id);
    let calls = 0;
    const pipeline = createWorkspacePipeline(
      {
        call: async () => {
          calls++;
          return { questions: [question("third")] };
        },
      },
      { reserve: async () => true, invocation: () => crypto.randomUUID() },
    );
    await expect(pipeline.questions(context, "synthetic-request")).rejects.toThrow(
      "POLICY_REJECTED",
    );
    expect(calls).toBe(0);
    const summaryJob = crypto.randomUUID();
    expect(
      await f.jobs.admitWorkspace(await guard(), admission(), summaryJob, "intake_summary"),
    ).toBe(true);
    const summaryLease = await f.jobs.acquire(
      actor,
      summaryJob,
      crypto.randomUUID(),
      "2026-10-06T00:04:00.000Z",
    );
    if (!summaryLease) throw new Error("Missing summary lease");
    expect(
      await f.repository.writeBatch(
        await guard(),
        {
          id: crypto.randomUUID(),
          ordinal: 3,
          generatedForIntakeRevision: context.intake.revision,
          questions: [question("third")],
          answers: [],
        },
        summaryLease.lease,
      ),
    ).toBe(false);
    expect(await f.jobs.fail(actor, summaryLease.lease, "MODEL_UNAVAILABLE", true)).toBe(true);
    expect((await runCustomerJob(f, "intake_summary")).result.status).toBe("completed");
    const finished = await f.service.intake(actor.ownerId, f.workspace.id);
    expect(finished?.summary).not.toBeNull();
    expect(finished?.batches.flatMap((batch) => batch.questions)).toHaveLength(
      firstCount + secondCount,
    );
  },
);

test("write boundary rejects more than three newly generated questions before publication", async () => {
  const f = await customerWorkspaceFixture();
  databases.push(f.db);
  const actor = { ownerId: f.owner.userId, now: NOW };
  const workspaceId = f.workspace.id;
  const jobId = crypto.randomUUID();
  expect(
    await f.jobs.admitWorkspace(
      { ...actor, workspaceId, expectedRevision: 1 },
      admission(),
      jobId,
      "intake_questions",
    ),
  ).toBe(true);
  const job = await f.jobs.acquire(actor, jobId, crypto.randomUUID(), "2026-10-06T00:04:00.000Z");
  if (!job) throw new Error("Missing lease");
  expect(
    await f.repository.writeBatch(
      { ...actor, workspaceId, expectedRevision: 2 },
      {
        id: crypto.randomUUID(),
        ordinal: 1,
        generatedForIntakeRevision: 1,
        questions: [question("one"), question("two"), question("three"), question("four")],
        answers: [],
      },
      job.lease,
    ),
  ).toBe(false);
  expect((await f.service.intake(actor.ownerId, workspaceId))?.batches).toHaveLength(0);
});

test("one stored legacy batch counts as one round regardless of its five questions", async () => {
  const f = await customerWorkspaceFixture();
  databases.push(f.db);
  const id = crypto.randomUUID();
  const questions = Array.from({ length: 5 }, (_, index) => question(`legacy-${index}`));
  const batch = { id, ordinal: 1, generatedForIntakeRevision: 1, questions, answers: [] };
  const envelope = await f.core.encrypt("v2_question_batches", id, f.owner.userId, 1, batch);
  f.db.sqlite
    .query(
      "INSERT INTO v2_question_batches(id,workspace_id,ordinal,intake_revision,question_count,encrypted_payload,created_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(id, f.workspace.id, 1, 1, questions.length, envelope, NOW);
  const saved = await f.service.answers(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
    expectedRevision: 1,
    answers: questions.map((q) => ({ questionId: q.id, status: "skipped" })),
  });
  expect(saved?.batches[0]?.answers).toHaveLength(5);
  let next: WorkspaceJobInput["kind"] | undefined;
  const service = createWorkspaceService(f.core, {
    clock: () => NOW,
    prepareJob: async (input) => {
      next = input.kind;
      return null;
    },
  });
  const current = await service.find(f.owner.userId, f.workspace.id);
  await expect(
    service.advance(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
      expectedRevision: current.workspaceRevision,
    }),
  ).rejects.toThrow("BUDGET_UNAVAILABLE");
  expect(next).toBe("intake_questions");
  expect((await runCustomerJob(f, "intake_questions", true, undefined, 3)).result.status).toBe(
    "completed",
  );
  const second = await service.intake(f.owner.userId, f.workspace.id);
  if (!second) throw new Error("Missing second round");
  expect(second.batches).toHaveLength(2);
  await service.answers(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
    expectedRevision: second.revision,
    answers: second.batches[1]?.questions.map((q) => ({ questionId: q.id, status: "unknown" })),
  });
  expect((await runCustomerJob(f, "intake_summary")).result.status).toBe("completed");
  expect(
    (await service.intake(f.owner.userId, f.workspace.id))?.batches[0]?.questions,
  ).toHaveLength(5);
});
