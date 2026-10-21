import { z } from "zod";
import { MODEL_CONTEXT_TOKENS, MODEL_ID, MODEL_OUTPUT_TOKENS } from "../../model-policy";
import { executionDescriptorSchema } from "./execution-plan";

const boundsConfigSchema = z.strictObject({
  model: z.literal(MODEL_ID),
  bounds: executionDescriptorSchema.omit({
    model: true,
    phase: true,
    correction: true,
    wireInputSha256: true,
    inputBytes: true,
    outputTokenUpperBound: true,
  }),
  evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
  verifiedAt: z.string().datetime(),
});
/** Only a deployment-owned setting can supply authenticated model capability bounds. */
export function configuredBounds(env: Env) {
  try {
    const config = boundsConfigSchema.parse(JSON.parse(env.AI_MODEL_TOKEN_BOUNDS_JSON ?? "null"));
    if (
      config.bounds.modelContextTokenLimit > MODEL_CONTEXT_TOKENS ||
      config.bounds.modelInputTokenLimit > MODEL_CONTEXT_TOKENS ||
      config.bounds.modelOutputTokenLimit > MODEL_OUTPUT_TOKENS
    )
      return null;
    return config;
  } catch {
    return null;
  }
}
