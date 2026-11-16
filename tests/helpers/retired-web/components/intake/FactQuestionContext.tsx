import { factQuestionPrompts, type IntakeQuestionContext } from "@baro/client-core";
import type { V2FactReference } from "../../../../../src/contracts/v2/index";

export function FactQuestionContext({
  references,
  context,
  className,
}: {
  references: readonly V2FactReference[];
  context?: IntakeQuestionContext | undefined;
  className: string;
}) {
  return factQuestionPrompts(references, context).map((prompt) => (
    <p key={prompt} className={className}>
      질문: {prompt}
    </p>
  ));
}
