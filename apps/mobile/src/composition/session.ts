import { ApiError } from "@baro/api-client";
import { Linking } from "react-native";
import { createSessionModel } from "../features/session/model";
import { parseNativeAuthReturn } from "../platform/auth/attempt";
import { signOutNative } from "../platform/auth/sign-out";
import { getMobileApi } from "./api";
import { getPendingAuthStore, getReauthenticationStore } from "./auth-attempt";
import { readMobileConfig } from "./config";
import { getMobileCredentials } from "./credentials";
import { getNativeLogin } from "./login";
import { getMobileAuthClient } from "./mobile-auth";

let model: ReturnType<typeof createSessionModel> | undefined;
export function getSessionModel() {
  if (!model) {
    const api = getMobileApi(),
      login = getNativeLogin(),
      config = readMobileConfig();
    const { scope, credentials } = getMobileCredentials();
    model = createSessionModel({
      scope,
      login,
      readSession: () => {
        api.session.invalidate();
        return api.session.get();
      },
      getConsent: () => api.session.getConsent(),
      saveConsent: (input) => api.session.saveConsent(input),
      readAuthentication: () => getMobileAuthClient().capabilities(),
      readReauthentication: async (ownerId) => {
        const auth = getMobileAuthClient();
        const protocol = await auth.capabilities().catch(() => {
          // A public capability error is not evidence that the current private session expired.
          throw new ApiError(
            "UNAVAILABLE",
            "로그인 수단을 확인하지 못했어요. 다시 확인해 주세요.",
            true,
          );
        });
        const access = await auth.deletionAccess(protocol, ownerId);
        const marker = await getReauthenticationStore()
          .load()
          .catch(() => null);
        return {
          providers: access.providers,
          verified: Boolean(
            marker?.ownerTag === access.ownerTag &&
              access.recentOAuth &&
              access.authenticatedAt &&
              marker &&
              Date.parse(access.authenticatedAt) >= marker.startedAt,
          ),
        };
      },
      ownsReturn: async (raw) => {
        const returned = parseNativeAuthReturn(raw, config);
        if (!returned) return false;
        const attempt = await getPendingAuthStore().load();
        return attempt?.attemptId === returned.attemptId;
      },
      signOut: () =>
        signOutNative({
          config,
          scope,
          credentials,
          cancelLogin: () => login.cancel({ signOut: true }),
          fetch: (url, init) => fetch(url, init),
        }),
      openPolicy: async (policy) => {
        await Linking.openURL(`${config.apiBaseUrl}/policies/${policy}`);
      },
    });
  }
  return model;
}
