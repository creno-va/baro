import { Button } from "../Button";
import { TextareaField } from "../Field";
import { SelectField } from "../Select";
import { LegacyCaseSection, legacyMutedClass } from "./LegacyCaseParts";
import type { LegacyQuestionsController } from "./useLegacyQuestionsController";

export function QuestionsView({ controller }: { controller: LegacyQuestionsController }) {
  const { questions, busy, answers, error, value, choose, submit } = controller;
  return (
    <LegacyCaseSection title="확인이 필요한 내용" data-product-legacy-questions="">
      <div className={legacyMutedClass}>
        <p>{questions.length} / 최대 5개 · 질문은 한 묶음만 제공돼요.</p>
        <p>질문이 생성된 뒤 24시간 안에 답해 주세요. 시간이 지나면 새 사건을 입력할 수 있어요.</p>
      </div>
      <form noValidate onSubmit={(event) => void submit(event)} className="space-y-6">
        {questions.map((question, index) => (
          <fieldset
            key={question.id}
            disabled={busy}
            aria-describedby="question-error"
            className="min-w-0 space-y-4 rounded-xl bg-[var(--pui-background)] p-4 sm:p-5"
          >
            <legend className="max-w-full px-1 text-sm font-medium leading-7 [overflow-wrap:anywhere]">
              {index + 1}. {question.prompt}
            </legend>
            <SelectField
              label={`${index + 1}번 답변 방식`}
              value={answers[question.id]?.status ?? ""}
              disabled={busy}
              onValueChange={(status) => {
                if (status === "answered" || status === "unknown" || status === "skipped")
                  choose(question.id, status);
              }}
              options={[
                { value: "", label: "선택해 주세요" },
                { value: "answered", label: "답변하기" },
                { value: "unknown", label: "모름" },
                { value: "skipped", label: "건너뛰기" },
              ]}
            />
            {answers[question.id]?.status === "answered" &&
              (question.answerType === "choice" ? (
                <SelectField
                  label={`${index + 1}번 답변`}
                  value={value(question.id)}
                  disabled={busy}
                  onValueChange={(value) => choose(question.id, "answered", value)}
                  options={[
                    { value: "", label: "선택해 주세요" },
                    ...question.options.map((option) => ({ value: option, label: option })),
                  ]}
                />
              ) : (
                <div className="space-y-2">
                  <TextareaField
                label={`${index + 1}번 답변`}
                    aria-label={`${index + 1}번 답변`}
                    aria-describedby={`answer-length-${question.id}`}
                    aria-invalid={[...value(question.id).trim()].length > 1000}
                    value={value(question.id)}
                    disabled={busy}
                    onChange={(event) => choose(question.id, "answered", event.target.value)}
                    rows={5}
                  />
                  <p
                    id={`answer-length-${question.id}`}
                    className="text-right text-xs tabular-nums text-[var(--pui-muted)]"
                  >
                    {[...value(question.id).trim()].length.toLocaleString()} / 1,000자
                  </p>
                </div>
              ))}
          </fieldset>
        ))}
        <p id="question-error" role="alert" className="text-sm text-[var(--pui-danger)]">
          {error}
        </p>
        <div className="flex justify-end">
          <Button disabled={busy} type="submit">
            {busy ? "답변 저장 중" : "답변 보내기"}
          </Button>
        </div>
      </form>
    </LegacyCaseSection>
  );
}
