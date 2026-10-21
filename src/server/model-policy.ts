/** Current dispatch identity; legacy IDs remain readable in immutable ledgers. */
export const MODEL_ID = "google/gemini-3.8-flash" as const;
export const LEGACY_MODEL_ID = "openai/gpt-6-sol" as const;
export const MODEL_CONTEXT_TOKENS = 1048576;
export const MODEL_OUTPUT_TOKENS = 65536;
export const MODEL_REFERENCE =
  "https://developers.cloudflare.com/ai/models/google/gemini-3.8-flash/";
export const MODEL_OUTPUT_REFERENCE =
  "https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash";
