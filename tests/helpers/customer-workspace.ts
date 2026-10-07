import { expect } from "bun:test";
import { createCaseDataCipher } from "../../src/server/crypto";
import { createV2Core } from "../../src/server/db/v2-core";
import { createV2JobsRepository } from "../../src/server/db/v2-jobs";
import { createV2WorkspaceRepository } from "../../src/server/db/v2-workspace";
import { executeWorkspace } from "../../src/server/modules/workspace/execution";
import { createWorkspacePipeline } from "../../src/server/modules/workspace/pipeline";
import { createWorkspaceService } from "../../src/server/modules/workspace/service";
import { hasCustomerWorkspaceAccess } from "../../src/server/runtime/workspace";
import { createTestDatabase } from "./d1";
import { seedTestSession } from "./session";

const NOW = "2026-10-06T00:00:00.000Z";
export async function customerWorkspaceFixture(now = NOW) {
  const db = await createTestDatabase();
  const owner = await seedTestSession(db, { consent: true });
  const core = createV2Core(
    db.binding,
    await createCaseDataCipher({ CASE_DATA_KEY_V1: btoa("w".repeat(32)).replace(/=+$/, "") }),
  );
  const service = createWorkspaceService(core, { clock: () => now });
  const workspace = await service.create(owner.userId, crypto.randomUUID(), {
    narrative: "계약 이후 받은 자료에서 거래 날짜를 확인하고 상담할 내용을 준비합니다.",
    subjectContext: "individual",
    jurisdiction: "KR",
    turnstileToken: "synthetic",
  });
  return {
    now,
    db,
    owner,
    core,
    service,
    workspace,
    repository: createV2WorkspaceRepository(db.binding, core.cipher),
    jobs: createV2JobsRepository(core),
  };
}
type Fixture = Awaited<ReturnType<typeof customerWorkspaceFixture>>;
export async function runCustomerJob(
  f: Fixture,
  kind: "intake_questions" | "intake_summary" | "chat_response",
  auditPass = true,
  onPhase?: () => Promise<void>,
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
        now: f.now,
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
  return executeCustomerJob(f, params, auditPass, onPhase);
}
export async function executeCustomerJob(
  f: Fixture,
  params: { ownerId: string; workspaceId: string; workspaceRevision: number; jobId: string },
  auditPass = true,
  onPhase?: () => Promise<void>,
) {
  const id = params.jobId;
  const result = await executeWorkspace(f.core, params, `${id}-1`, {
    clock: () => f.now,
    authorize: (ownerId) => hasCustomerWorkspaceAccess(f.core, ownerId),
    pipeline: async () =>
      createWorkspacePipeline(
        {
          call: async (phase, raw) => {
            await onPhase?.();
            const context =
              raw as import("../../src/server/modules/workspace/pipeline").WorkspaceContext;
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
