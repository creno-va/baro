import type { ExecutionPlan } from "../../db/v2-paid-runtime";
import { runtimeDigest } from "../../db/v2-paid-runtime";
import { digest } from "../files/binary";
import { MODEL_ID } from "../llm-gateway/prompts";
import {
  documentedVisionSupport,
  isBoundedVisionWire,
  VISION_OUTPUT_TOKENS,
} from "../llm-gateway/vision-wire";
import { configuredBounds } from "./model-configuration";
import type { ProcessingRuntimePolicy } from "./processing-runtime";

/** Reuses deployment-owned technical context/output limits, never account credit
 * or a newly invented live vision observation. The whole remaining context is a
 * conservative execution maximum, not a measured token count or pricing quote. */
export function configuredMediaPolicy(
  env: Env,
): Required<Pick<ProcessingRuntimePolicy, "bounds" | "visionCapability">> {
  const config = configuredBounds(env);
  const permitted = (now: string) => {
    if (!config || !Number.isFinite(Date.parse(now))) return false;
    const b = config.bounds;
    return (
      b.basis === "verified_model_context_limit" &&
      b.vision === null &&
      b.modelContextTokenLimit <= 1_050_000 &&
      b.modelOutputTokenLimit <= 128_000 &&
      b.modelOutputTokenLimit >= VISION_OUTPUT_TOKENS &&
      b.modelContextTokenLimit > VISION_OUTPUT_TOKENS &&
      b.modelContextTokenLimit - VISION_OUTPUT_TOKENS <= b.modelInputTokenLimit &&
      b.modelInputTokenLimit <= b.modelContextTokenLimit &&
      Date.parse(b.checkedAt) <= Date.parse(now) &&
      Date.parse(config.verifiedAt) <= Date.parse(now) &&
      Date.parse(b.checkedAt) < Date.parse(b.validUntil) &&
      Date.parse(config.verifiedAt) < Date.parse(b.validUntil) &&
      (env.APPLICATION_COST_LIMITS_ENABLED === "false" ||
        Date.parse(b.validUntil) >= Date.parse(now) + 300_000)
    );
  };
  return {
    visionCapability: async (now) => (permitted(now) ? documentedVisionSupport() : null),
    bounds: async (input, inputDigest, now) => {
      if (
        !config ||
        !permitted(now) ||
        input.service !== "model" ||
        input.action !== "vision" ||
        input.model !== MODEL_ID ||
        input.durationSeconds !== null ||
        !isBoundedVisionWire(input.wire)
      )
        return null;
      const wire = new TextEncoder().encode(JSON.stringify(input.wire));
      const wireHash = await digest(wire);
      if (wire.byteLength !== input.byteLength || input.identity !== wireHash) return null;
      const quantities: ExecutionPlan["quantities"] = [
        {
          sku: "model_input_tokens",
          maximumQuantity: String(config.bounds.modelContextTokenLimit - VISION_OUTPUT_TOKENS),
        },
        { sku: "model_output_tokens", maximumQuantity: String(VISION_OUTPUT_TOKENS) },
      ];
      return {
        inputDigest,
        quantities,
        // This is the actual local immutable-wire validation time. The original
        // model observation dates/hash stay unchanged inside the evidence digest.
        verifiedAt: now,
        validUntil: new Date(Date.parse(now) + 300_000).toISOString(),
        evidenceHash: await runtimeDigest({
          inputDigest,
          wireHash,
          quantities,
          capability: documentedVisionSupport(),
          configuredBounds: config,
          policy: "pinned-single-jpeg-full-context-v1",
        }),
      };
    },
  };
}
