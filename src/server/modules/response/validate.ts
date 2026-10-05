import { type Result, resultSchema, validationOutputSchema } from "../../../contracts";
import { validateCitations } from "../citation/validate";
import { ModelError } from "../llm-gateway/service";

export function prohibitedText(result: Result): boolean {
  const text = JSON.stringify(result);
  return /승소\s*(확률|가능성\s*\d|보장)|반드시\s*승소|변호사로서|무조건\s*(승소|이깁)|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|01[016789][- ]?\d{3,4}[- ]?\d{4}/i.test(
    text,
  );
}
export async function assembleVerifiedResult(
  draft: unknown,
  validation: unknown,
  retrieval: unknown,
) {
  const result = resultSchema.parse(draft);
  const audit = validationOutputSchema.parse(validation);
  if (
    !audit.pass ||
    !audit.sanitizedResult ||
    audit.findings.some((f) => f.severity === "critical") ||
    prohibitedText(result) ||
    prohibitedText(audit.sanitizedResult)
  )
    throw new ModelError("POLICY_REJECTED");
  if (
    !(await validateCitations(result, retrieval)) ||
    !(await validateCitations(audit.sanitizedResult, retrieval))
  )
    throw new ModelError("POLICY_REJECTED");
  return audit.sanitizedResult;
}
