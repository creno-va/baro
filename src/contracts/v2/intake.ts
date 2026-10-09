import { z } from "zod";
import {
  boundedText,
  displayText,
  hasUniqueIds,
  opaqueIdSchema,
  revisionSchema,
  timestampSchema,
} from "../common";
import { answerSchema, questionSchema } from "../questions";
import { V2_LIMITS, v2JsonRequestSchema, v2VersionSchema } from "./common";
import { v2FactSchema, v2FactsSchema } from "./sources";

export const v2QuestionsSchema = z
  .array(questionSchema)
  .min(1)
  .max(V2_LIMITS.questionsPerBatch)
  .refine(hasUniqueIds, "Duplicate questions");
export const v2QuestionBatchSchema = z
  .strictObject({
    id: opaqueIdSchema,
    ordinal: z.number().int().min(1).max(V2_LIMITS.initialBatches),
    generatedForIntakeRevision: revisionSchema,
    questions: v2QuestionsSchema,
    answers: z.array(answerSchema).max(V2_LIMITS.questionsPerBatch),
  })
  .refine(
    ({ questions, answers }) =>
      new Set(answers.map((a) => a.questionId)).size === answers.length &&
      answers.every((answer) => {
        const question = questions.find((q) => q.id === answer.questionId);
        return (
          question !== undefined &&
          (answer.status !== "answered" ||
            question.answerType === "text" ||
            question.options.includes(answer.value))
        );
      }),
    "Answer does not match this batch",
  );
export const v2AnswersRequestSchema = z.strictObject({
  expectedRevision: revisionSchema,
  answers: z
    .array(answerSchema)
    .min(1)
    .max(V2_LIMITS.questionsPerBatch)
    .refine((a) => new Set(a.map((v) => v.questionId)).size === a.length, "Duplicate answers"),
});
export function v2AnswersForBatchSchema(batch: unknown, complete = false) {
  const approved = v2QuestionBatchSchema.parse(batch);
  return v2AnswersRequestSchema.refine(
    ({ answers }) =>
      (!complete || answers.length === approved.questions.length) &&
      answers.every((answer) => {
        const question = approved.questions.find((q) => q.id === answer.questionId);
        return (
          question !== undefined &&
          (answer.status !== "answered" ||
            question.answerType === "text" ||
            question.options.includes(answer.value))
        );
      }),
    "Unknown question, invalid choice, or incomplete batch",
  );
}
export const v2SummarySchema = z.strictObject({
  schemaVersion: v2VersionSchema,
  revision: revisionSchema,
  intakeRevision: revisionSchema,
  createdAt: timestampSchema,
  overview: displayText(5000),
  facts: v2FactsSchema,
  parties: z
    .array(z.strictObject({ id: opaqueIdSchema, label: displayText(200), role: displayText(300) }))
    .max(30)
    .refine(hasUniqueIds, "Duplicate parties"),
  unknowns: z.array(displayText(1000)).max(100),
  notices: z.array(displayText(500)).min(1).max(10),
});
export const v2SummaryEditRequestSchema = v2JsonRequestSchema(
  z
    .strictObject({
      expectedRevision: revisionSchema,
      overview: displayText(5000).optional(),
      factEdits: z
        .array(
          z.strictObject({
            factId: opaqueIdSchema,
            text: displayText(2000),
            certainty: v2FactSchema.shape.certainty.optional(),
            conflictingFactIds: v2FactSchema.shape.conflictingFactIds.optional(),
          }),
        )
        .min(1)
        .max(100)
        .refine(
          (edits) => new Set(edits.map((edit) => edit.factId)).size === edits.length,
          "Duplicate fact edits",
        )
        .optional(),
      unknowns: z.array(displayText(1000)).max(100).optional(),
    })
    .refine(
      (request) =>
        request.overview !== undefined ||
        request.factEdits !== undefined ||
        request.unknowns !== undefined,
      "A summary edit must change at least one field",
    ),
);
export function v2SummaryEditForFactsSchema(factIds: readonly string[], expectedRevision: number) {
  return v2SummaryEditRequestSchema.refine(
    (request) =>
      request.expectedRevision === expectedRevision &&
      (request.factEdits ?? []).every((edit) => factIds.includes(edit.factId)),
    "Stale summary or unknown fact",
  );
}
export const v2SummaryConfirmationRequestSchema = z.strictObject({
  expectedRevision: revisionSchema,
  summaryRevision: revisionSchema,
  workspaceRevision: revisionSchema.optional(),
});
export function v2CurrentSummaryConfirmationSchema(
  intakeRevision: number,
  summaryRevision: number,
) {
  revisionSchema.parse(intakeRevision);
  revisionSchema.parse(summaryRevision);
  return v2SummaryConfirmationRequestSchema.refine(
    (request) =>
      request.expectedRevision === intakeRevision && request.summaryRevision === summaryRevision,
    "Only the current intake summary can be confirmed",
  );
}
export const v2IntakeSchema = z
  .strictObject({
    schemaVersion: v2VersionSchema,
    revision: revisionSchema,
    status: z.enum(["collecting", "generating_questions", "reviewing_summary", "confirmed"]),
    narrative: boundedText(20, 5000),
    batches: z.array(v2QuestionBatchSchema).max(V2_LIMITS.initialBatches),
    summary: v2SummarySchema.nullable(),
    confirmedSummaryRevision: revisionSchema.nullable(),
    currentJobId: opaqueIdSchema.nullable(),
  })
  .refine((intake) => {
    const questions = intake.batches.flatMap((b) => b.questions);
    if (
      !hasUniqueIds(intake.batches) ||
      !hasUniqueIds(questions) ||
      intake.batches.some(
        (b, i) => b.ordinal !== i + 1 || b.generatedForIntakeRevision > intake.revision,
      )
    )
      return false;
    if (intake.summary !== null && intake.summary.intakeRevision !== intake.revision) return false;
    if (intake.status === "confirmed")
      return (
        intake.summary !== null &&
        intake.confirmedSummaryRevision === intake.summary.revision &&
        intake.currentJobId === null
      );
    if (intake.confirmedSummaryRevision !== null) return false;
    if (intake.status === "reviewing_summary")
      return intake.summary !== null && intake.currentJobId === null;
    if (intake.summary !== null) return false;
    return intake.status === "generating_questions"
      ? intake.currentJobId !== null
      : intake.currentJobId === null;
  }, "Inconsistent intake lifecycle");
export const v2IntakeAdvanceRequestSchema = z.strictObject({ expectedRevision: revisionSchema });
export type V2QuestionBatch = z.infer<typeof v2QuestionBatchSchema>;
export type V2AnswersRequest = z.infer<typeof v2AnswersRequestSchema>;
export type V2Summary = z.infer<typeof v2SummarySchema>;
export type V2SummaryEditRequest = z.infer<typeof v2SummaryEditRequestSchema>;
export type V2SummaryConfirmationRequest = z.infer<typeof v2SummaryConfirmationRequestSchema>;
export type V2Intake = z.infer<typeof v2IntakeSchema>;
export type V2IntakeAdvanceRequest = z.infer<typeof v2IntakeAdvanceRequestSchema>;
