import { Linking } from "react-native";
import { createSessionModel } from "../features/session/model";
import { parseNativeAuthReturn } from "../platform/auth/attempt";
import { signOutNative } from "../platform/auth/sign-out";
import { getMobileApi } from "./api";
import { getPendingAuthStore } from "./auth-attempt";
import { readMobileConfig } from "./config";
import { getMobileCredentials } from "./credentials";
import { getNativeLogin } from "./login";

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
      ownsReturn: async (raw) => {
        const returned = parseNativeAuthReturn(raw, config);
        if (!returned) return false;
        const attempt = await getPendingAuthStore().load();
        return attempt?.purpose === "login" && attempt.attemptId === returned.attemptId;
      },
      signOut: () =>
        signOutNative({
          config,
          scope,
          credentials,
          cancelLogin: () => login.cancel(),
          fetch: (url, init) => fetch(url, init),
        }),
      openPolicy: async (policy) => {
        await Linking.openURL(`${config.apiBaseUrl}/policies/${policy}`);
      },
    });
  }
  return model;
}
