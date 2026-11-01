import historical from "../../docs/operations/AI-RUNTIME-OBSERVATION.json";
import {
  MODEL_CONTEXT_TOKENS,
  MODEL_ID,
  MODEL_OUTPUT_REFERENCE,
  MODEL_OUTPUT_TOKENS,
  MODEL_REFERENCE,
} from "../../src/server/model-policy";

// Only this synthetic fixture rolls its expiry forward; the historical observation is immutable.
const validUntil = new Date(
  Math.max(Date.parse(historical.validUntil), Date.now() + 2 * 86400000),
).toISOString();
/** Synthetic test input only: never an account, price or funding observation. */
export default {
  ...historical,
  validUntil,
  model: MODEL_ID,
  contextTokens: MODEL_CONTEXT_TOKENS,
  maximumOutputTokens: MODEL_OUTPUT_TOKENS,
  modelReference: MODEL_REFERENCE,
  outputReference: MODEL_OUTPUT_REFERENCE,
  pricing: {
    ...historical.pricing,
    validUntil,
    fx: { ...historical.pricing.fx, validUntil },
    prices: historical.pricing.prices.map((price) => ({
      ...price,
      validUntil,
      ...(price.model === "openai/gpt-6-sol"
        ? { provider: "google", model: MODEL_ID, officialUrl: MODEL_REFERENCE }
        : {}),
    })),
  },
};
