import { createCasesClient } from "@baro/api-client";
import { createSessionBoundClient } from "@baro/client-core";
import { securityToken } from "./challenge";
import { browserSessionScope } from "./context";
import { apiMode, request } from "./core";

export type { AnswersInput, QuestionRound, QuestionsResult } from "@baro/api-client";
export {
  answersInputSchema,
  createInputSchema,
  revisionInputSchema,
  summaryInputSchema,
} from "@baro/api-client";

export const casesApi = createSessionBoundClient(browserSessionScope, () =>
  createCasesClient({
    mode: apiMode,
    scope: browserSessionScope,
    request,
    challenge: securityToken,
    newKey: () => crypto.randomUUID(),
    fingerprint: async (value) => {
      const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
      return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join(
        "",
      );
    },
    storage: {
      getItem: (key) => sessionStorage.getItem(key),
      setItem: (key, value) => sessionStorage.setItem(key, value),
      removeItem: (key) => sessionStorage.removeItem(key),
    },
  }),
);
