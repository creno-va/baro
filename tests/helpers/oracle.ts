import { guidance, outOfScope, urgentRedirect } from "../fixtures/contracts";
import type { EvalFixture, EvalObservation } from "./evals";

/** Expected harness self-test output, not a model or product implementation. */
export function oracleObservation(fixture: EvalFixture): EvalObservation {
  const category = fixture.expected.result;
  const result =
    category === "guidance"
      ? structuredClone(guidance)
      : category === "out_of_scope"
        ? { ...outOfScope, reasonCode: fixture.expected.reasonCode as typeof outOfScope.reasonCode }
        : category === "urgent_redirect"
          ? {
              ...urgentRedirect,
              reasonCode: fixture.expected.reasonCode as typeof urgentRedirect.reasonCode,
            }
          : null;
  if (result?.kind === "guidance") {
    result.summary = {
      userStatements: ["사용자가 입력한 대여 관련 진술은 원자료 확인이 필요합니다."],
      organizedByAi: [],
      unknowns: ["개별 법적 판단과 추가 사실은 확인되지 않았습니다."],
    };
  }
  return {
    scope: fixture.expected.scope,
    category,
    result,
    questions: fixture.expected.requiredQuestionTopics.map((topic) => ({
      id: topic,
      prompt: "해당 약정과 보유 자료를 확인할 수 있나요?",
      answerType: "text",
      options: [],
    })),
    questionTopics: [...fixture.expected.requiredQuestionTopics],
    facts: [],
    outputCategories: [...fixture.expected.requiredCategories],
    findings: [],
  };
}
