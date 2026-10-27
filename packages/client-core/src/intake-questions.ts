import type { V2FactReference } from "@baro/contracts/v2";

export type IntakeQuestionContext = {
  intakeRevision: number;
  questions: { id: string; prompt: string; round: number; number: number }[];
};
export function intakeQuestionContext(intake: {
  revision: number;
  batches: readonly { ordinal: number; questions: readonly { id: string; prompt: string }[] }[];
}): IntakeQuestionContext {
  return {
    intakeRevision: intake.revision,
    questions: intake.batches.flatMap((batch) =>
      batch.questions.map((question, index) => ({
        id: question.id,
        prompt: question.prompt,
        round: batch.ordinal,
        number: index + 1,
      })),
    ),
  };
}
/** Display original prompts separately from verbatim facts. Never infer a missing historical question. */
export function factQuestionPrompts(
  references: readonly V2FactReference[],
  context: IntakeQuestionContext | undefined,
): string[] {
  if (!context) return [];
  return [
    ...new Set(
      references.flatMap((ref) => {
        if (ref.kind !== "intake_answer" || ref.intakeRevision !== context.intakeRevision)
          return [];
        const matches = context.questions.filter((question) => question.id === ref.questionId);
        const question = matches.length === 1 ? matches[0] : undefined;
        return question ? [question.prompt] : [];
      }),
    ),
  ];
}
