import type { Question } from "../../../contracts";

// These actions already belong to the intake UI and answer status contract.
// Match whole labels only: a substantive answer such as "기록이 없음" must stay.
const reservedAnswers = new Set([
  "모름",
  "잘모름",
  "모르겠음",
  "잘모르겠음",
  "모르겠어요",
  "잘모르겠어요",
  "모르겠습니다",
  "잘모르겠습니다",
  "아직모르겠어요",
  "알수없음",
  "확인불가",
  "확인안됨",
  "확인되지않음",
  "확인하지못함",
  "미확인",
  "확실하지않음",
  "기억안남",
  "기억이나지않음",
  "기억나지않음",
  "기억나지않아요",
  "건너뛰기",
  "답변건너뛰기",
  "넘어가기",
  "답변하지않음",
  "응답하지않음",
  "답변안함",
  "응답안함",
  "나중에답변",
  "unknown",
  "skip",
  "notsure",
  "dontknow",
]);
export function normalizeIntakeQuestion(question: Question): Question {
  if (question.answerType !== "choice") return question;
  const options = question.options.filter(
    (value) =>
      !reservedAnswers.has(
        value
          .normalize("NFKC")
          .toLowerCase()
          .replace(/[\s\p{P}]/gu, ""),
      ),
  );
  return options.length < 2
    ? { ...question, answerType: "text", options: [] }
    : { ...question, options };
}
