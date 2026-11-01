import { createJsonRequester, createReworkClient } from "@baro/api-client";
import { createSessionBoundClient } from "@baro/client-core";
import { securityToken } from "./challenge";
import { browserSessionScope } from "./context";
import { apiRequest } from "./core";
import { sessionApi } from "./session";

const request = createJsonRequester({
  transport: apiRequest,
  newKey: () => crypto.randomUUID(),
  scope: browserSessionScope,
});
export const reworkApi = createSessionBoundClient(browserSessionScope, () =>
  createReworkClient({
    request: (_operation, _input, options = {}) =>
      request({ ...options, path: options.path ?? "/api/invalid" }),
    session: () => sessionApi.get(),
    scope: browserSessionScope,
    challenge: securityToken,
    newKey: () => crypto.randomUUID(),
    // Approved guide registry host; individual paths/identity remain server verified.
    guideHosts: ["www.easylaw.go.kr", "easylaw.go.kr"],
    fingerprint: async (input) =>
      Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))),
        (b) => b.toString(16).padStart(2, "0"),
      ).join(""),
    ...(typeof sessionStorage === "undefined" ? {} : { keyStorage: sessionStorage }),
  }),
);
