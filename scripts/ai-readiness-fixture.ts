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
export function syntheticToolContext(
  feature: "tools_business" | "tools_property" | "tools_registry",
): WorkspaceContext {
  const context = syntheticChatContext();
  if (!context.latestMessage) throw new Error("Synthetic message unavailable");
  context.latestMessage.text = {
    tools_business:
      "홈택스 사업자 상태 조회와 더치트 피해 등록 조회를 실행해 주세요. 인증정보와 조회 대상은 채팅에 입력하지 않았어요.",
    tools_property:
      "데이터허브 부동산 주소 조회와 건축물대장 조회를 실행하고, 실제로 읽은 원천 정보인지 구분해 주세요. 조회 대상은 아직 입력하지 않았어요.",
    tools_registry:
      "대법원 등기정보광장 API 조회를 실행하고, 실제로 조회됐는지와 서비스 연결 상태를 구분해 주세요.",
  }[feature];
  return context;
}
export function syntheticLegalContext(): WorkspaceContext {
  const context = syntheticChatContext();
  if (!context.latestMessage) throw new Error("Synthetic message unavailable");
  context.latestMessage.text =
    "민법 제598조 내용을 공식 원문에서 확인한 뒤, 읽은 조문의 문장을 출처와 함께 그대로 인용해 주세요. 사건에 대한 법률 판단이나 전략은 요청하지 않습니다.";
  return context;
}
