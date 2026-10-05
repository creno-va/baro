import { guidanceResultSchema, validationOutputSchema } from "../../../contracts";
import type { createLlmGateway } from "../llm-gateway/service";
import { assembleVerifiedResult } from "../response/validate";
export async function generateGuidance(
  gateway: ReturnType<typeof createLlmGateway>,
  input: unknown,
  retrieval: unknown,
  requestId: string,
  reserve: (phase: "generation" | "validation") => Promise<boolean>,
) {
  const draft = guidanceResultSchema.parse(
    await gateway.call("generation", { input, retrieval }, requestId, () => reserve("generation")),
  );
  const validation = validationOutputSchema.parse(
    await gateway.call("validation", { input, retrieval, draft }, requestId, () =>
      reserve("validation"),
    ),
  );
  return assembleVerifiedResult(draft, validation, retrieval);
}
