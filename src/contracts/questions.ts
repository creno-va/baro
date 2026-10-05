import { z } from "zod";
import {
  boundedText,
  displayText,
  hasUniqueIds,
  opaqueIdSchema,
  revisionSchema,
  schemaVersionSchema,
} from "./common";

const questionBase = { id: opaqueIdSchema, prompt: displayText(300) };
export const questionSchema = z.discriminatedUnion("answerType", [
  z.strictObject({
    ...questionBase,
    answerType: z.literal("text"),
    options: z.array(z.never()).max(0),
  }),
  z.strictObject({
    ...questionBase,
    answerType: z.literal("choice"),
    options: z
      .array(displayText(100))
      .min(2)
      .max(6)
      .refine((options) => new Set(options).size === options.length, "Duplicate options"),
  }),
]);
export const questionsSchema = z
  .array(questionSchema)
  .max(5)
  .refine(hasUniqueIds, "Duplicate question IDs");
export const questionOutputSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  questions: questionsSchema,
});
export const answerSchema = z.discriminatedUnion("status", [
  z.strictObject({
    questionId: opaqueIdSchema,
    status: z.literal("answered"),
    value: boundedText(1, 1000),
  }),
  z.strictObject({ questionId: opaqueIdSchema, status: z.literal("unknown") }),
  z.strictObject({ questionId: opaqueIdSchema, status: z.literal("skipped") }),
]);
export const answersRequestSchema = z.strictObject({
  inputRevision: revisionSchema,
  answers: z
    .array(answerSchema)
    .min(1)
    .max(5)
    .refine(
      (answers) => new Set(answers.map(({ questionId }) => questionId)).size === answers.length,
      "Duplicate answers",
    ),
});
/** Shape alone cannot check completeness or the server's choice allowlist. */
export function answersForQuestionsSchema(questions: unknown) {
  const approved = questionsSchema.parse(questions);
  return answersRequestSchema.refine(
    ({ answers }) =>
      answers.length === approved.length &&
      approved.every((question) => {
        const answer = answers.find(({ questionId }) => questionId === question.id);
        return (
          answer !== undefined &&
          (answer.status !== "answered" ||
            question.answerType === "text" ||
            question.options.includes(answer.value))
        );
      }),
    "Answer every question once using the approved options",
  );
}
export type Question = z.infer<typeof questionSchema>;
export type Answer = z.infer<typeof answerSchema>;
export type AnswersRequest = z.infer<typeof answersRequestSchema>;
