import { type SyntheticEvent, useState } from "react";
import { type Answer, answersForQuestionsSchema, type Question } from "../../contracts";
export type LegacyQuestionsProps = {
  questions: Question[];
  revision: number;
  busy: boolean;
  onSubmit: (body: unknown) => Promise<void>;
};
export function useLegacyQuestionsController({
  questions,
  revision,
  busy,
  onSubmit,
}: LegacyQuestionsProps) {
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [error, setError] = useState("");
  function value(id: string) {
    const answer = answers[id];
    return answer?.status === "answered" ? answer.value : "";
  }
  function choose(questionId: string, status: "answered" | "unknown" | "skipped", value = "") {
    setAnswers((current) => ({
      ...current,
      [questionId]: status === "answered" ? { questionId, status, value } : { questionId, status },
    }));
  }
  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (questions.some((q) => [...value(q.id).trim()].length > 1000)) {
      setError("답변은 각각 1,000자 이하로 줄여 주세요. 입력한 내용은 그대로 남아 있어요.");
      return;
    }
    const body = answersForQuestionsSchema(questions).safeParse({
      inputRevision: revision,
      answers: questions.map((q) => answers[q.id]),
    });
    if (!body.success) {
      setError("각 질문에 답변, 모름 또는 건너뛰기를 선택해 주세요.");
      return;
    }
    setError("");
    await onSubmit(body.data);
  }
  return { questions, revision, busy, answers, error, value, choose, submit };
}
export type LegacyQuestionsController = ReturnType<typeof useLegacyQuestionsController>;
