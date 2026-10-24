import type { WorkspaceContext } from "../src/server/modules/workspace/pipeline";

/** Synthetic inputs only: no expected answers, accounts, DB or captured user data. */
export function syntheticIntakeContext(): WorkspaceContext {
  return {
    calendar: { localDate: "2026-10-24", timeZone: "Asia/Seoul" },
    intake: {
      schemaVersion: "2",
      revision: 1,
      status: "collecting",
      narrative:
        "대한민국에서 지인에게 돈을 빌려주었습니다. 약속한 상환일이 지났지만 아직 돌려받지 못했습니다. 이체 기록은 가지고 있습니다.",
      batches: [],
      summary: null,
      confirmedSummaryRevision: null,
      currentJobId: null,
    },
    confirmedSummary: null,
    messages: [],
    latestMessage: null,
    facts: [],
    references: {
      intakeRevision: 1,
      answeredQuestionIds: [],
      messages: [],
      files: [],
      verifiedCitationIds: [],
    },
    citations: [],
    materials: [],
    sourceStatus: "not_requested",
  };
}

export function syntheticSummaryContext(): WorkspaceContext {
  return syntheticIntakeContext();
}
export function syntheticChatContext(): WorkspaceContext {
  const context = syntheticIntakeContext();
  context.confirmedSummary = {
    schemaVersion: "2",
    revision: 1,
    intakeRevision: 1,
    createdAt: "2026-10-24T00:00:00.000Z",
    overview:
      "사용자는 지인에게 돈을 빌려주었고 상환일이 지난 뒤에도 돌려받지 못했다고 진술했어요.",
    facts: [],
    parties: [],
    unknowns: ["정확한 송금일과 상환 약속일은 아직 확인하지 않았어요."],
    notices: ["사용자 진술을 정리한 합성 사건이에요."],
  };
  context.intake = {
    ...context.intake,
    status: "confirmed",
    summary: context.confirmedSummary,
    confirmedSummaryRevision: 1,
  };
  context.latestMessage = {
    schemaVersion: "2",
    id: "synthetic_chat_message",
    operationId: "synthetic_chat_operation",
    workspaceRevision: 2,
    createdAt: "2026-10-24T00:00:00.000Z",
    role: "user",
    text: "법률 설명 없이 가진 이체 기록에서 어떤 날짜와 금액 항목을 확인할지 정리해 주세요.",
    selectedFileIds: [],
  };
  context.references.messages = [{ id: context.latestMessage.id, workspaceRevision: 2 }];
  return context;
}
