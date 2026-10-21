import historical from "../../docs/operations/AI-RUNTIME-OBSERVATION.json";
import {
  MODEL_CONTEXT_TOKENS,
  MODEL_ID,
  MODEL_OUTPUT_REFERENCE,
  MODEL_OUTPUT_TOKENS,
  MODEL_REFERENCE,
} from "../../src/server/model-policy";
/** Synthetic test input only: never an account, price or funding observation. */
export default {
  ...historical,
  model: MODEL_ID,
  contextTokens: MODEL_CONTEXT_TOKENS,
  maximumOutputTokens: MODEL_OUTPUT_TOKENS,
  modelReference: MODEL_REFERENCE,
  outputReference: MODEL_OUTPUT_REFERENCE,
  pricing: {
    ...historical.pricing,
    prices: historical.pricing.prices.map((price) =>
      price.model === "openai/gpt-6-sol"
        ? { ...price, provider: "google", model: MODEL_ID, officialUrl: MODEL_REFERENCE }
        : price,
    ),
  },
};
