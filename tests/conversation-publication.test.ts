import { afterEach, expect, test } from "bun:test";
import { executeWorkspace } from "../src/server/modules/workspace/execution";
import { createWorkspacePipeline } from "../src/server/modules/workspace/pipeline";
import { storedMessageSchema } from "../src/server/modules/workspace/stored-message";
import { conversationState } from "./helpers/conversation-state";
import {
  confirmCustomerSummary,
  customerWorkspaceFixture,
  runCustomerJob,
} from "./helpers/customer-workspace";

const databases: Awaited<ReturnType<typeof customerWorkspaceFixture>>["db"][] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

test("an audited intent survives encrypted workspace publication, replays once, and stays outside installed-client DTOs", async () => {
  const f = await customerWorkspaceFixture();
  databases.push(f.db);
  for (let round = 0; round < 2; round++) {
    expect((await runCustomerJob(f, "intake_questions")).result.status).toBe("completed");
    const intake = await f.service.intake(f.owner.userId, f.workspace.id);
    const question = intake?.batches.at(-1)?.questions[0];
    if (!intake || !question) throw new Error("Missing synthetic question");
    await f.service.answers(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
      expectedRevision: intake.revision,
      answers: [{ questionId: question.id, status: round ? "skipped" : "unknown" }],
    });
  }
  expect((await runCustomerJob(f, "intake_summary")).result.status).toBe("completed");
  const active = await confirmCustomerSummary(f);
  const operationId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  expect(
    await f.jobs.admitWorkspace(
      {
        ownerId: f.owner.userId,
        workspaceId: f.workspace.id,
        expectedRevision: active.workspaceRevision,
        now: f.now,
      },
      {
        operationId,
        key: crypto.randomUUID(),
        requestHash: "a".repeat(64),
      },
      jobId,
      "chat_response",
      {
        id: crypto.randomUUID(),
        request: {
          expectedRevision: active.workspaceRevision,
          text: "서명한 계약서를 사진으로 추가하려고 합니다.",
          selectedFileIds: [],
        },
      },
    ),
  ).toBe(true);
  const params = {
    ownerId: f.owner.userId,
    workspaceId: f.workspace.id,
    workspaceRevision: active.workspaceRevision + 1,
    jobId,
  };
  const phases: string[] = [];
  const run = () =>
    executeWorkspace(f.core, params, `${jobId}-1`, {
      clock: () => f.now,
      authorize: async (owner) => owner === f.owner.userId,
      pipeline: async (_job, _lease, context) => {
        const state = conversationState();
        context.conversation = { caseContext: state.caseContext, preparation: state.analysis };
        return createWorkspacePipeline(
          {
            call: async (phase) => {
              phases.push(phase);
              return phase === "workspace_audit"
                ? {
                    pass: true,
                    findings: [],
                    unsupportedFactIds: [],
                    legalClaimsSupported: true,
                    strategyDetected: false,
                  }
                : {
                    text: "자료를 선택하고 처리 결과를 검토할 수 있어요.",
                    conversationIntent: "add_material",
                    references: [],
                    warnings: [],
                    facts: [],
                    actions: [],
                    parties: [],
                    unknowns: null,
                    requestedSources: [],
                    sourceClaims: [],
                    timeline: [],
                  };
            },
          },
          { reserve: async () => true, invocation: () => crypto.randomUUID() },
        );
      },
    });
  expect((await run()).status).toBe("completed");
  expect((await run()).status).toBe("completed");
  expect(phases).toEqual(["workspace_chat", "workspace_audit"]);
  const row = f.db.sqlite
    .query(
      "SELECT id,revision,encrypted_payload FROM v2_messages WHERE workspace_id=? AND operation_id=? AND role='assistant'",
    )
    .get(f.workspace.id, operationId) as {
    id: string;
    revision: number;
    encrypted_payload: string;
  };
  expect(row).toBeTruthy();
  expect(row.encrypted_payload).not.toContain("add_material");
  const privateMessage = await f.core.decrypt(
    "v2_messages",
    row.id,
    f.owner.userId,
    row.revision,
    row.encrypted_payload,
    storedMessageSchema(),
  );
  expect(privateMessage).toMatchObject({ operationId, conversationIntent: "add_material" });
  const publicMessages = await f.service.messages(f.owner.userId, f.workspace.id);
  expect(publicMessages.filter((message) => message.role === "assistant")).toHaveLength(1);
  expect(publicMessages.find((message) => message.role === "assistant")).not.toHaveProperty(
    "conversationIntent",
  );
  await expect(f.service.messages(crypto.randomUUID(), f.workspace.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});
