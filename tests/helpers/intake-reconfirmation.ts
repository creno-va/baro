import type { CaseView } from "../../src/client/api/types";
import { type V2Summary, v2SummarySchema } from "../../src/contracts/v2";

/** Entirely synthetic: no model, provider, or private case is used. */
export function reconfirmationSummary(): V2Summary {
  return v2SummarySchema.parse({
    schemaVersion: "2",
    revision: 3,
    intakeRevision: 7,
    createdAt: "2026-11-01T00:00:00.000Z",
    overview: "합성 사건입니다. 약속한 지급일에 관해 서로 다른 진술이 있어 확인이 필요합니다.",
    facts: [
      {
        id: "synthetic-promise",
        text: "사용자는 지급일을 10월 1일로 기억합니다.",
        attribution: "user_statement",
        certainty: "conflicting",
        significance: "neutral",
        references: [{ kind: "intake_answer", intakeRevision: 7, questionId: "synthetic-date" }],
        conflictingFactIds: ["synthetic-other-date"],
        userEdited: false,
      },
      {
        id: "synthetic-other-date",
        text: "합성 문서에는 지급일이 10월 15일로 적혀 있습니다.",
        attribution: "user_material",
        certainty: "conflicting",
        significance: "unfavorable",
        references: [
          {
            kind: "user_material",
            fileId: "synthetic-contract",
            fileRevision: 2,
            position: { kind: "document", page: 1, paragraph: 1, table: null },
          },
        ],
        conflictingFactIds: ["synthetic-promise"],
        userEdited: false,
      },
      {
        id: "synthetic-adverse",
        text: "사용자가 먼저 지급일 변경을 요청한 대화가 있다고 진술했습니다.",
        attribution: "user_statement",
        certainty: "reported",
        significance: "unfavorable",
        references: [{ kind: "intake_narrative", intakeRevision: 7 }],
        conflictingFactIds: [],
        userEdited: false,
      },
    ],
    parties: [{ id: "synthetic-party", label: "합성 상대방", role: "거래 상대방" }],
    unknowns: ["지급일 변경에 합의했는지는 확인되지 않았습니다."],
    notices: ["AI가 정리한 합성 내용입니다. 법률 판단이 아닙니다."],
  });
}

export function reconfirmationCase(stage: "summary" | "active" = "summary"): CaseView {
  const summary = reconfirmationSummary();
  return {
    id: "synthetic-reconfirmation",
    title: "합성 사건 재확인",
    subjectContext: "company",
    stage,
    revision: 12,
    updatedAt: summary.createdAt,
    schemaVersion: "2",
    summary: summary.overview,
    summaryDetails: summary,
    intakeQuestions: {
      intakeRevision: 7,
      questions: [{ id: "synthetic-date", prompt: "지급일은 언제였나요?", round: 1, number: 1 }],
    },
  };
}

export const syntheticReconfirmationExplanation =
  "빠진 내용이 있어요. 상대방에게 일부를 돌려받았지만, 정확한 금액은 아직 모르겠어요.";

/** A deterministic adapter result, never an actual model judgment. */
export function reconfirmationCandidate(): V2Summary {
  const original = reconfirmationSummary();
  return v2SummarySchema.parse({
    ...original,
    revision: original.revision + 1,
    overview: `${original.overview} 일부 반환받았다는 추가 진술이 있으며 정확한 금액은 미확인입니다.`,
    facts: [
      ...original.facts,
      {
        id: "synthetic-return",
        text: "상대방에게 일부를 돌려받았지만, 정확한 금액은 아직 모르겠어요.",
        attribution: "user_statement",
        certainty: "reported",
        significance: "unfavorable",
        references: [
          {
            kind: "user_message",
            messageId: "synthetic-reconciliation-request",
            workspaceRevision: 12,
          },
        ],
        conflictingFactIds: [],
        userEdited: false,
      },
    ],
    unknowns: [...original.unknowns, "일부 반환받은 정확한 금액은 미확인입니다."],
  });
}
