import { describe, expect, test } from "bun:test";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import type { QuestionsResult } from "../src/client/api/cases";
import { ApiError } from "../src/client/api/errors";
import type { CaseView, QuestionView } from "../src/client/api/types";
import { Button } from "../src/product-ui/Button";
import { TextareaField } from "../src/product-ui/Field";
import { QuestionAnswerField } from "../src/product-ui/intake/QuestionAnswerField";
import { QuestionsView } from "../src/product-ui/intake/QuestionsView";
import type { QuestionsController } from "../src/product-ui/intake/useQuestionsController";

const question: QuestionView = { id: "synthetic-question", text: "합성 질문입니다.", kind: "text" };
const item: CaseView = {
  id: "synthetic-case",
  title: "합성 사건",
  subjectContext: "individual",
  schemaVersion: "2",
  stage: "intake",
  revision: 3,
  updatedAt: "2026-11-16T00:00:00.000Z",
  summary: "",
};
const result: QuestionsResult = { questions: [question], complete: false, revision: 3 };

function controller(overrides: Partial<QuestionsController> = {}): QuestionsController {
  return {
    caseId: item.id,
    item,
    caseContext: {
      casePurpose: "respond_to_claim",
      subjectContext: "individual",
      procedure: { kind: "unconfirmed", stage: "unconfirmed", description: null },
    },
    result,
    index: 0,
    question,
    ready: true,
    canMutate: true,
    loading: false,
    error: null,
    editing: false,
    busy: false,
    autoSaving: false,
    waiting: false,
    leaving: false,
    locked: false,
    heading: { current: null },
    round: { ordinal: 1, questionIds: [question.id] },
    roundIndex: 0,
    finalQuestion: false,
    value: "",
    answerState: undefined,
    customAnswer: false,
    answerTooLong: false,
    statusTitle: "다음 질문을 준비하고 있어요",
    failureTitle: "다음 내용을 준비하지 못했어요.",
    failureDescription: "저장한 답변은 그대로 남아 있어요.",
    savingAnswer: false,
    retryDisabled: false,
    recoveryRetryDisabled: false,
    resumeDisabled: false,
    backDisabled: false,
    nextReadDisabled: false,
    submitDisabled: false,
    primaryLabel: "저장하고 다음 질문",
    submit: () => {},
    retry: () => {},
    chooseAnswer: () => {},
    changeAnswer: () => {},
    compositionStart: () => {},
    compositionEnd: () => {},
    unknown: () => {},
    skip: () => {},
    previous: () => {},
    nextRead: () => {},
    start: () => {},
    retryPreparation: () => {},
    resumeLater: () => {},
    ...overrides,
  };
}

function render(overrides: Partial<QuestionsController> = {}) {
  return renderToString(<QuestionsView controller={controller(overrides)} />);
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return [];
    return [child, ...elements(child.props.children as ReactNode)];
  });
}

describe("product question view", () => {
  test("unresolved authorization withholds private questions and input", () => {
    const html = render({ ready: false, loading: true, result: null });
    expect(html).toContain("저장한 질문을 불러오고 있어요.");
    expect(html).not.toContain(question.text);
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain('type="submit"');
  });

  test("text answers keep native labels, form submission and Unicode capacity without HTML truncation", () => {
    const value = `${"😀".repeat(1000)}\n`;
    const html = render({ value, answerState: "answered" });
    expect(html).toContain('id="question-heading"');
    expect(html).toContain('for="question-answer"');
    expect(html).toContain('id="question-answer"');
    expect(html).toContain('aria-describedby="question-answer-count"');
    expect(html).toContain(`${value}</textarea>`);
    expect(html).toContain('type="submit"');
    expect(html).toContain("저장하고 다음 질문");
    expect(html.replaceAll("<!-- -->", "")).toContain("1,000 / 1,000자");
    expect(html).not.toMatch(
      /maxLength=|contenteditable=|\sstyle=|class="(?:intake-|conversation-)/i,
    );
  });

  test("autosave keeps typing enabled while other save actions are disabled", () => {
    const html = render({ autoSaving: true, submitDisabled: true, primaryLabel: "자동 저장 중…" });
    expect(html.match(/<textarea\b[^>]*>/)?.[0]).not.toContain('disabled=""');
    const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
    for (const label of ["모름", "건너뛰기", "자동 저장 중…"])
      expect(buttons.find((button) => button.includes(label))).toContain('disabled=""');
    expect(html).not.toContain("자동 저장됐어요.");
  });

  test("stale consent permits native read-only navigation but exposes no submit mutation", () => {
    const html = render({ canMutate: false, locked: true, index: 1 });
    expect(html).toContain("저장한 질문과 답변을 읽을 수 있어요.");
    expect(html).toContain('href="/consent"');
    expect(html.match(/<textarea\b[^>]*>/)?.[0]).toContain('disabled=""');
    expect(html).toContain("이전으로");
    expect(html).toContain("다음 질문");
    expect(html).not.toContain('type="submit"');
  });

  test("choice answers preserve real radio state and custom native input", () => {
    const choice: QuestionView = { ...question, kind: "choice", options: ["선택 A", "선택 B"] };
    const suggested = render({ question: choice, value: "선택 A", answerState: "answered" });
    expect(suggested).toMatch(/<input[^>]*type="radio"[^>]*checked=""[^>]*value="선택 A"/);
    expect(suggested).not.toContain("<textarea");
    expect(suggested).toContain("직접 입력");
    const custom = render({
      question: choice,
      value: "직접 쓴 합성 답변",
      answerState: "answered",
      customAnswer: true,
    });
    expect(custom).toContain('aria-controls="question-answer"');
    expect(custom).toContain("직접 입력 답변");
    expect(custom).toContain("직접 쓴 합성 답변</textarea>");
  });

  test("native composition, typing, choices, unknown and skip events reach their exact controller handlers", () => {
    const calls: string[] = [];
    const choice: QuestionView = { ...question, kind: "choice", options: ["선택 A"] };
    const view = controller({
      question: choice,
      customAnswer: true,
      compositionStart: () => calls.push("composition:start"),
      compositionEnd: () => calls.push("composition:end"),
      changeAnswer: (value) => calls.push(`change:${value}`),
      chooseAnswer: (value) => calls.push(`choice:${value}`),
      unknown: () => calls.push("unknown"),
      skip: () => calls.push("skip"),
    });
    const tree = elements(QuestionAnswerField({ question: choice, controller: view }));
    const field = tree.find((node) => node.type === TextareaField);
    if (!field) throw new Error("MISSING_NATIVE_ANSWER_FIELD");
    (field.props.onCompositionStart as () => void)();
    (field.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: "조합 중 😀" },
    });
    (field.props.onCompositionEnd as () => void)();
    for (const input of tree.filter((node) => node.type === "input"))
      (input.props.onChange as () => void)();
    for (const button of tree.filter((node) => node.type === Button))
      (button.props.onClick as () => void)();
    expect(calls).toEqual([
      "composition:start",
      "change:조합 중 😀",
      "composition:end",
      "choice:선택 A",
      "choice:__custom__",
      "unknown",
      "skip",
    ]);
  });

  test("over-limit answers are retained, marked invalid and reported accessibly", () => {
    const value = "😀".repeat(1001);
    const html = render({
      value,
      answerState: "answered",
      answerTooLong: true,
      submitDisabled: true,
    });
    expect(html).toContain(`${value}</textarea>`);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("답변은 1,000자까지 입력할 수 있어요.");
  });

  test("unknown and skipped only claim saved status when the server snapshot agrees", () => {
    for (const answerState of ["unknown", "skipped"] as const) {
      expect(render({ answerState, savingAnswer: true })).toContain("답변을 저장하고 있어요.");
      const rejected = render({ answerState });
      expect(rejected).toContain("아직 저장되지 않았어요. 다시 시도해 주세요.");
      expect(rejected).not.toContain(
        answerState === "unknown" ? "모름으로 저장했어요." : "건너뛰기로 저장했어요.",
      );
      const saved = render({ question: { ...question, answerState }, answerState });
      expect(saved).toContain(
        answerState === "unknown" ? "모름으로 저장했어요." : "건너뛰기로 저장했어요.",
      );
      expect(saved).toContain('data-product-question-answer-state=""');
    }
  });

  test("processing only shows actual server status and generation recovery retains both explicit actions", () => {
    const waiting = render({
      question: undefined,
      result: { ...result, questions: [], processing: true },
      waiting: true,
      locked: true,
    });
    expect(waiting).toContain("다음 질문을 준비하고 있어요");
    expect(waiting).not.toContain("질문 시작하기");
    const failed = render({ result: { ...result, failed: true }, recoveryRetryDisabled: true });
    expect(failed).toContain('data-product-question-recovery=""');
    expect(failed).toContain("저장한 답변은 그대로 남아 있어요.");
    expect(failed).toContain("다시 시도");
    expect(failed).toContain("나중에 이어하기");
    expect(failed).toContain('data-appearance="outline"');
  });

  test("legacy, active, archived and completed cases expose their actual continuation links", () => {
    for (const override of [
      { item: { ...item, schemaVersion: "1" as const } },
      { item: { ...item, stage: "active" as const } },
      { item: { ...item, stage: "archived" as const } },
    ]) {
      const html = render(override);
      expect(html).toContain('href="/cases/synthetic-case"');
      expect(html).not.toContain("<textarea");
    }
    const completed = render({ result: { ...result, complete: true } });
    expect(completed).toContain('href="/cases/synthetic-case/summary"');
    expect(completed).not.toContain("<textarea");
    expect(render({ result: { ...result, complete: true }, editing: true })).toContain("<textarea");
  });

  test("transition hooks retain the page name and reduced-motion path", () => {
    const html = render({ leaving: true, index: 1 });
    for (const hook of [
      "data-product-questions",
      "data-product-question-scene",
      "data-product-question-content",
      "data-product-question-navigation",
      "data-product-question-action",
      "data-product-question-back",
      "data-product-question-primary",
    ])
      expect(html).toContain(`${hook}=""`);
    expect(html).toContain('data-transition="leaving"');
    expect(html).toContain("[view-transition-name:intake-page]");
    expect(html).toContain("intake-scene-out_160ms");
    expect(html).toContain("motion-reduce:animate-none");
  });

  test("purpose and server errors remain explicit, and untrusted questions/answers stay text", () => {
    const text = '<img src=x onerror="synthetic()">';
    const html = render({
      question: { ...question, text },
      value: text,
      answerState: "answered",
      error: new ApiError("CONFLICT", "합성 경합"),
    });
    expect(html).toContain("주장 대응");
    expect(html).toContain("최신 내용 불러오기");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    expect(html).not.toMatch(/\sstyle=|<[^>]+\son(?:error|submit|change)=/i);
  });
});
