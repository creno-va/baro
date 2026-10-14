import { z } from "zod";
import { executionDescriptorSchema } from "./execution-plan";

const boundsConfigSchema = z.strictObject({
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
    return boundsConfigSchema.parse(JSON.parse(env.AI_MODEL_TOKEN_BOUNDS_JSON ?? "null"));
  } catch {
    return null;
  }
}
