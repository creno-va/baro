import { createReworkClient, responseError } from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";

/** Explicit synthetic facade for the component's default client; Astro glob imports stay out of Bun's harness. */
async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) throw await responseError(response);
  return response.json() as Promise<T>;
}
const scope = createSessionScope();
async function session() {
  const value = await json<{ ownerId: string; needsConsent: boolean }>("/fixture/session");
  return {
    user: { id: value.ownerId, name: "합성 사용자", accountType: "customer" as const },
    needsConsent: value.needsConsent,
  };
}
const make = () =>
  createReworkClient({
    scope,
    session,
    request: async <T>(_operation: string, _input: unknown, options = {}) => {
      const params = options as {
        path?: string;
        method?: string;
        body?: unknown;
        expectedOwner?: string;
        signal?: AbortSignal;
      };
      return json<T>(params.path ?? "/invalid", {
        method: params.method ?? "GET",
        headers: {
          "x-fixture-owner": params.expectedOwner ?? "",
          "content-type": "application/json",
        },
        ...(params.body === undefined ? {} : { body: JSON.stringify(params.body) }),
        ...(params.signal ? { signal: params.signal } : {}),
      });
    },
    challenge: async () => "synthetic",
    newKey: () => crypto.randomUUID(),
    guideHosts: ["www.easylaw.go.kr"],
    fingerprint: async (text) =>
      Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))),
        (b) => b.toString(16).padStart(2, "0"),
      ).join(""),
  });
let rework = make();
window.addEventListener("baro-session-changed", () => {
  scope.invalidate();
  rework = make();
});
export const api = {
  session: { get: session },
  get rework() {
    return rework;
  },
  files: {
    list: async (_id: string, options?: { metadataOnly?: true }) =>
      json(`/fixture/files?metadataOnly=${String(options?.metadataOnly === true)}`),
  },
  reports: {
    get: async () => {
      await json("/fixture/legacy-get", { method: "POST" });
      throw Error("Legacy report creation is forbidden in this read-only fixture");
    },
  },
};
