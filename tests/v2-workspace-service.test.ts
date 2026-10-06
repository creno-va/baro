import { afterEach, expect, test } from "bun:test";
import { createCaseDataCipher } from "../src/server/crypto";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createV2WorkspaceRepository } from "../src/server/db/v2-workspace";
import { executeWorkspace } from "../src/server/modules/workspace/execution";
import { createWorkspacePipeline } from "../src/server/modules/workspace/pipeline";
import { createWorkspaceService } from "../src/server/modules/workspace/service";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const NOW = "2026-10-06T00:00:00.000Z";
const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
async function fixture() {
  const db = await createTestDatabase();
  databases.push(db);
  const owner = await seedTestSession(db, { consent: true });
  const core = createV2Core(
    db.binding,
    await createCaseDataCipher({ CASE_DATA_KEY_V1: btoa("w".repeat(32)).replace(/=+$/, "") }),
  );
  const service = createWorkspaceService(core, { clock: () => NOW });
  const workspace = await service.create(owner.userId, crypto.randomUUID(), {
    narrative: "계약 이후 받은 자료에서 거래 날짜를 확인하고 상담할 내용을 준비합니다.",
    subjectContext: "individual",
    jurisdiction: "KR",
    turnstileToken: "synthetic",
  });
  return {
    db,
    owner,
    core,
    service,
    workspace,
    repository: createV2WorkspaceRepository(db.binding, core.cipher),
    jobs: createV2JobsRepository(core),
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function run(
  f: Fixture,
  kind: "intake_questions" | "intake_summary" | "chat_response",
  auditPass = true,
) {
  const workspace = await f.service.find(f.owner.userId, f.workspace.id),
    id = crypto.randomUUID(),
    operationId = crypto.randomUUID();
  const chat =
    kind === "chat_response"
      ? {
          id: crypto.randomUUID(),
          request: {
            expectedRevision: workspace.workspaceRevision,
            text: "새로운 자료를 찾았습니다.",
            selectedFileIds: [],
          },
        }
      : undefined;
  expect(
    await f.jobs.admitWorkspace(
      {
        ownerId: f.owner.userId,
        now: NOW,
        workspaceId: workspace.id,
        expectedRevision: workspace.workspaceRevision,
      },
      { operationId, key: crypto.randomUUID(), requestHash: "a".repeat(64) },
      id,
      kind,
      chat,
    ),
  ).toBe(true);
  const params = {
    ownerId: f.owner.userId,
    workspaceId: workspace.id,
    workspaceRevision: workspace.workspaceRevision + 1,
    jobId: id,
  };
  const result = await executeWorkspace(f.core, params, `${id}-1`, {
    clock: () => NOW,
    authorize: async () => true,
    pipeline: async () =>
      createWorkspacePipeline(
        {
          call: async (phase, raw) => {
            const context =
              raw as import("../src/server/modules/workspace/pipeline").WorkspaceContext;
            if (phase === "workspace_audit")
              return {
                pass: auditPass,
                findings: [],
                unsupportedFactIds: [],
                legalClaimsSupported: true,
                strategyDetected: false,
              };
            if (phase === "workspace_questions")
              return {
                questions: [
                  {
                    id: "placeholder",
                    prompt: `자료 준비 단계 ${context.intake.batches.length + 1}에서 확인할 내용은 무엇인가요?`,
                    answerType: "text",
                    options: [],
                  },
                ],
              };
            if (phase === "workspace_summary")
              return {
                overview: "사용자의 거래 자료 확인 준비를 정리했습니다.",
                facts: [
                  {
                    id: "initial_fact",
                    text: context.intake.narrative,
                    attribution: "user_statement",
                    certainty: "reported",
                    significance: "neutral",
                    userEdited: false,
                    references: [
                      { kind: "intake_narrative", intakeRevision: context.intake.revision },
                    ],
                    conflictingFactIds: [],
                  },
                ],
                parties: [{ id: "initial_party", label: "사용자", role: "자료를 준비하는 당사자" }],
                unknowns: ["거래 날짜 미확인"],
                notices: ["사용자 진술을 정리한 준비 자료입니다."],
              };
            const reference = {
              kind: "user_message",
              messageId: context.latestMessage?.id,
              workspaceRevision: context.latestMessage?.workspaceRevision,
            };
            return {
              text: "찾은 자료를 목록에 추가하고 날짜를 확인해 주세요.",
              requestedSources: [],
              references: [reference],
              warnings: [],
              facts: [
                {
                  id: "new_fact",
                  text: context.latestMessage?.text,
                  attribution: "user_statement",
                  certainty: "reported",
                  significance: "neutral",
                  userEdited: false,
                  references: [reference],
                  conflictingFactIds: [],
                },
              ],
              parties: [{ id: "new_party", label: "상대방", role: "추가 확인이 필요한 당사자" }],
              actions: [
                {
                  id: "new_action",
                  revision: 1,
                  kind: "organize_materials",
                  title: "자료 목록 정리",
                  instructions: "새로 찾은 자료의 이름을 적어주세요.",
                  caution: "자료의 내용은 아직 확인되지 않았어요.",
                  status: "todo",
                  factIds: ["new_fact"],
                  references: [reference],
                },
              ],
              timeline: [
                {
                  id: "new_event",
                  revision: 1,
                  date: null,
                  datePrecision: "unknown",
                  event: "추가 자료를 찾았다는 진술",
                  certainty: "reported",
                  references: [reference],
                  factIds: ["new_fact"],
                  userEdited: false,
                },
              ],
            };
          },
        },
        { reserve: async () => true, invocation: () => crypto.randomUUID() },
      ),
  });
  return { result, params };
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
  for (let index = 0; index < 3; index++) {
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
