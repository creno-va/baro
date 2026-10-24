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
