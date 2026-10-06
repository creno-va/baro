import { afterEach, expect, test } from "bun:test";
import { customerWorkspaceFixture, runCustomerJob as run } from "./helpers/customer-workspace";

const databases: Awaited<ReturnType<typeof customerWorkspaceFixture>>["db"][] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
async function fixture() {
  const f = await customerWorkspaceFixture();
  databases.push(f.db);
  return f;
}
test("case creation replays without consuming another quota and rejects changed input or another owner", async () => {
  const f = await fixture(),
    key = crypto.randomUUID(),
    input = {
      narrative: "회사 계약 자료의 날짜를 확인하고 변호사 상담을 준비하려고 합니다.",
      subjectContext: "company",
      jurisdiction: "KR",
      turnstileToken: "synthetic",
    };
  const created = await f.service.create(f.owner.userId, key, input);
  expect(
    (await f.service.replayCreate(f.owner.userId, key, { ...input, turnstileToken: "used-token" }))
      ?.id,
  ).toBe(created.id);
  expect((await f.service.create(f.owner.userId, key, input)).id).toBe(created.id);
  await expect(
    f.service.replayCreate(f.owner.userId, key, {
      ...input,
      narrative: "이 요청은 같은 키에 다른 내용을 전달해서 충돌해야 하는 입력입니다.",
    }),
  ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  await expect(f.service.find(crypto.randomUUID(), created.id)).rejects.toThrow("NOT_FOUND");
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_workspaces").get()).toEqual({ n: 2 });
});
test("saved answers, reviewed summary and ongoing chat commit with durable replay and atomic factual updates", async () => {
  const f = await fixture();
  for (let index = 0; index < 2; index++) {
    expect((await run(f, "intake_questions")).result.status).toBe("completed");
    const intake = await f.service.intake(f.owner.userId, f.workspace.id),
      question = intake?.batches.at(-1)?.questions[0];
    if (!question || !intake) throw new Error("Missing batch");
    const key = crypto.randomUUID(),
      input = {
        expectedRevision: intake.revision,
        answers: [{ questionId: question.id, status: index === 0 ? "unknown" : "skipped" }],
      };
    const saved = await f.service.answers(f.owner.userId, f.workspace.id, key, input);
    expect((await f.service.answers(f.owner.userId, f.workspace.id, key, input))?.revision).toBe(
      saved?.revision,
    );
    await expect(
      f.service.answers(f.owner.userId, f.workspace.id, crypto.randomUUID(), input),
    ).rejects.toThrow("STALE_REVISION");
  }
  expect((await run(f, "intake_summary")).result.status).toBe("completed");
  const intake = await f.service.intake(f.owner.userId, f.workspace.id);
  if (!intake?.summary) throw new Error("Missing summary");
  const edited = await f.service.editSummary(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
    expectedRevision: intake.summary.revision,
    overview: "사용자가 직접 확인하고 수정한 사건 요약입니다.",
  });
  if (!edited?.summary) throw new Error("Missing edited summary");
  const key = crypto.randomUUID(),
    confirmation = { expectedRevision: edited.revision, summaryRevision: edited.summary.revision };
  expect((await f.service.confirm(f.owner.userId, f.workspace.id, key, confirmation)).status).toBe(
    "active",
  );
  expect((await f.service.confirm(f.owner.userId, f.workspace.id, key, confirmation)).status).toBe(
    "active",
  );
  const executed = await run(f, "chat_response");
  expect(executed.result.status).toBe("completed");
  expect(
    (await f.service.messages(f.owner.userId, f.workspace.id)).filter(
      (m) => m.role === "assistant",
    ),
  ).toHaveLength(1);
  expect(await f.service.actions(f.owner.userId, f.workspace.id)).toHaveLength(1);
  expect(await f.service.timeline(f.owner.userId, f.workspace.id)).toHaveLength(1);
  expect(
    f.db.sqlite.query("SELECT count(*) n FROM v2_facts WHERE entity_id='new_fact'").get(),
  ).toEqual({ n: 1 });
  const actionKey = crypto.randomUUID(),
    actionRequest = { expectedRevision: 1, status: "done" };
  expect(
    (
      await f.service.updateAction(
        f.owner.userId,
        f.workspace.id,
        "new_action",
        actionKey,
        actionRequest,
      )
    ).status,
  ).toBe("done");
  expect(
    (
      await f.service.updateAction(
        f.owner.userId,
        f.workspace.id,
        "new_action",
        actionKey,
        actionRequest,
      )
    ).revision,
  ).toBe(2);
});
test("rejected response stays private and leaves no visible question batch", async () => {
  const f = await fixture();
  expect((await run(f, "intake_questions", false)).result.status).toBe("failed");
  expect((await f.service.intake(f.owner.userId, f.workspace.id))?.batches).toHaveLength(0);
  expect((await f.service.find(f.owner.userId, f.workspace.id)).currentJobId).toBeNull();
});
