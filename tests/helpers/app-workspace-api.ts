// Reuse actual session and case clients while avoiding Vite-only import.meta.glob in Bun's fixture bundle.
import { casesApi } from "../../src/client/api/cases";
import { apiMode } from "../../src/client/api/core";
import { roleStart, sessionApi } from "../../src/client/api/session";

export type { CaseView, SessionView } from "../../src/client/api/types";
export { apiMode, roleStart };

let listAttempt = 0;
export const api = {
  session: sessionApi,
  cases: {
    get: casesApi.get,
    rename: casesApi.rename,
    list: async () => {
      const state = new URLSearchParams(location.search).get("recent");
      if (state === "loading") return new Promise<never>(() => {});
      if (state === "error" && listAttempt++ === 0) throw new Error("Synthetic list failure");
      return casesApi.list();
    },
  },
  account: {
    deleteCase: async () => {
      throw new Error("Deletion execution belongs to the product API regression.");
    },
  },
};
