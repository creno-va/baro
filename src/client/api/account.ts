import { createAccountClient as createSharedAccountClient } from "@baro/api-client";
import { createSessionBoundClient } from "@baro/client-core";
import { authClient } from "../auth";
import { browserSessionScope } from "./context";
import { apiMode } from "./core";
import { type ApiRequest, type DomainRequest, domainRequest } from "./reports";
import { notifySessionChanged } from "./session";

export type { UsageSummary } from "@baro/api-client";
export function createAccountClient(
  request: DomainRequest,
  options: { allowMockDeletion?: boolean } = {},
) {
  return createSessionBoundClient(browserSessionScope, () =>
    createSharedAccountClient({
      request,
      scope: browserSessionScope,
      newKey: () => crypto.randomUUID(),
      allowMockDeletion: options.allowMockDeletion ?? apiMode === "mock",
      readReauthentication: async () => {
        if (typeof sessionStorage === "undefined") return null;
        const raw = sessionStorage.getItem("baro.account-reauth.v1");
        return raw ? JSON.parse(raw) : null;
      },
      reauthenticate: async (provider) => {
        const result = await authClient.signIn.social({
          provider,
          callbackURL: "/settings",
          errorCallbackURL: "/settings?error=oauth",
        });
        if (result.error) throw new Error("재인증을 시작하지 못했어요. 다시 시도해 주세요.");
      },
      onDeleted: () => {
        if (typeof window !== "undefined") notifySessionChanged();
      },
    }),
  );
}
export function createAccountApi(request: ApiRequest) {
  return createAccountClient(domainRequest(request));
}
