// Browser-only composition of the actual fetch adapters. No mock response handler.

import { createAccountApi } from "../../src/client/api/account";
import { createFilesApi } from "../../src/client/api/files";
import { createReportsApi } from "../../src/client/api/reports";

const request = (path: string, init?: RequestInit) =>
  fetch(path, { ...init, credentials: "same-origin", cache: "no-store" });
export const api = {
  reports: createReportsApi(request),
  files: createFilesApi(request),
  account: createAccountApi(request),
  session: {
    get: async () => {
      const response = await request("/api/me/session");
      if (!response.ok)
        throw Object.assign(new Error("로그인 상태를 확인해 주세요."), { code: "UNAUTHENTICATED" });
      return response.json();
    },
  },
  cases: { list: async () => [] },
};
