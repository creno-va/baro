import type { QuestionView } from "../../client/api/types";
import { Button } from "../Button";
import { TextareaField } from "../Field";
import type { QuestionsController } from "./useQuestionsController";

type AnswerController = Pick<
  QuestionsController,
  | "value"
  | "answerState"
  | "customAnswer"
  | "answerTooLong"
  | "locked"
  | "autoSaving"
  | "savingAnswer"
  | "chooseAnswer"
  | "changeAnswer"
  | "compositionStart"
  | "compositionEnd"
  | "unknown"
  | "skip"
>;

export function QuestionAnswerField({
  question,
  controller,
}: {
  question: QuestionView;
  controller: AnswerController;
}) {
  const {
    value,
    answerState,
    customAnswer,
    answerTooLong,
    locked,
    autoSaving,
    savingAnswer,
    chooseAnswer,
    changeAnswer,
    compositionStart,
    compositionEnd,
    unknown,
    skip,
  } = controller;
  const choiceClass =
    "flex min-h-12 items-center gap-3 rounded-xl border border-[var(--pui-border)] px-4 py-3 text-sm leading-6 text-[var(--pui-text)] has-checked:bg-[var(--pui-background)] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-[var(--pui-focus)] has-disabled:cursor-not-allowed has-disabled:opacity-50";
  return (
    <div className="space-y-4">
      {question.kind === "choice" && (
        <fieldset disabled={locked} aria-labelledby="question-heading" className="grid gap-2">
          <legend className="sr-only">답변 선택</legend>
          {question.options?.map((option) => (
            <label key={option} className={choiceClass}>
              <input
                type="radio"
                name={question.id}
                value={option}
                checked={!customAnswer && answerState === "answered" && value === option}
                onChange={() => chooseAnswer(option)}
                className="h-4 w-4 shrink-0 accent-[var(--pui-text)]"
              />
              <span className="min-w-0 [overflow-wrap:anywhere]">{option}</span>
            </label>
          ))}
          <label className={choiceClass}>
            <input
              type="radio"
              name={question.id}
              value="__custom__"
              checked={customAnswer && answerState === "answered"}
              onChange={() => chooseAnswer("__custom__")}
              aria-controls={customAnswer ? "question-answer" : undefined}
              className="h-4 w-4 shrink-0 accent-[var(--pui-text)]"
            />
            <span>직접 입력</span>
          </label>
        </fieldset>
      )}
      {(question.kind !== "choice" || customAnswer) && (
        <div className="rounded-[20px] border border-[var(--pui-border)] bg-[var(--pui-surface)] p-4 focus-within:ring-2 focus-within:ring-[var(--pui-focus)] sm:p-5">
          <TextareaField
            id="question-answer"
            label={
              <span className="sr-only">
                {question.kind === "choice" ? "직접 입력 답변" : "답변"}
              </span>
            }
            wrapperClassName="gap-0"
            className="min-h-32 resize-y rounded-none border-0 bg-transparent px-0 py-0 text-base leading-7 focus-visible:outline-none"
            rows={4}
            onCompositionStart={compositionStart}
            onCompositionEnd={compositionEnd}
            value={answerState === "answered" ? value : ""}
            disabled={locked}
            onChange={(event) => changeAnswer(event.target.value)}
            placeholder={
              question.kind === "choice"
                ? "선택지에 없는 내용을 적어주세요."
                : "여기에 편하게 적어주세요."
            }
            aria-describedby="question-answer-count"
            invalid={answerTooLong}
            error={
              answerTooLong
                ? "답변은 1,000자까지 입력할 수 있어요. 내용을 줄인 뒤 저장해 주세요."
                : undefined
            }
          />
          <p id="question-answer-count" className="mt-3 text-right text-xs text-[var(--pui-muted)]">
            <span className="sr-only">입력한 글자 수 </span>
            {answerState === "answered" ? [...value.trim()].length.toLocaleString("ko-KR") : 0} /
            1,000자
          </p>
        </div>
      )}
      {(answerState === "unknown" || answerState === "skipped") && (
        <p
          data-product-question-answer-state=""
          className="text-sm leading-6 text-[var(--pui-muted)]"
        >
          {savingAnswer
            ? "답변을 저장하고 있어요."
            : question.answerState === answerState
              ? answerState === "unknown"
                ? "모름으로 저장했어요."
                : "건너뛰기로 저장했어요."
              : "아직 저장되지 않았어요. 다시 시도해 주세요."}
        </p>
      )}
      <div className="flex flex-wrap gap-1">
        <Button
          variant="ghost"
          disabled={locked || autoSaving}
          onClick={unknown}
          className="rounded-full px-3 text-xs text-[var(--pui-muted)]"
        >
          모름
        </Button>
        <Button
          variant="ghost"
          disabled={locked || autoSaving}
          onClick={skip}
          className="rounded-full px-3 text-xs text-[var(--pui-muted)]"
        >
          건너뛰기
        </Button>
      </div>
    </div>
  );
}
