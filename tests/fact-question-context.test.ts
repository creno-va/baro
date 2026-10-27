import { expect, test } from "bun:test";
import { factQuestionPrompts, intakeQuestionContext } from "@baro/client-core";
import type { V2FactReference } from "../src/contracts/v2";

test("choice facts retain their verbatim answer while the exact question is separate display context", () => {
  const context = intakeQuestionContext({
    revision: 3,
    batches: [{ ordinal: 2, questions: [{ id: "contract", prompt: "차용증을 작성했나요?" }] }],
  });
  const references: V2FactReference[] = [
    { kind: "intake_answer", intakeRevision: 3, questionId: "contract" },
  ];
  const fact = { text: "작성하지 않았다", references };
  const before = JSON.stringify(fact);
  expect(factQuestionPrompts(references, context)).toEqual(["차용증을 작성했나요?"]);
  expect(context.questions[0]).toMatchObject({ round: 2, number: 1 });
  expect(JSON.stringify(fact)).toBe(before);
  expect(factQuestionPrompts([...references, ...references], context)).toHaveLength(1);
});
test("historical, absent and ambiguous prompts are never inferred from fact order", () => {
  const refs: V2FactReference[] = [{ kind: "intake_answer", intakeRevision: 2, questionId: "one" }];
  const context = {
    intakeRevision: 2,
    questions: [{ id: "one", prompt: "원래 질문", round: 1, number: 1 }],
  };
  expect(factQuestionPrompts(refs, undefined)).toEqual([]);
  expect(factQuestionPrompts(refs, { ...context, intakeRevision: 3 })).toEqual([]);
  expect(factQuestionPrompts(refs, { ...context, questions: [] })).toEqual([]);
  expect(
    factQuestionPrompts(refs, {
      ...context,
      questions: [...context.questions, ...context.questions],
    }),
  ).toEqual([]);
});
