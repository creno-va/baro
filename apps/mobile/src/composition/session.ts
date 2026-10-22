import { ApiError, createAccountClient } from "@baro/api-client";
import { randomUUID } from "expo-crypto";
import { Linking } from "react-native";
import { createSessionModel } from "../features/session/model";
import { parseNativeAuthReturn } from "../platform/auth/attempt";
import { signOutNative } from "../platform/auth/sign-out";
import { getMobileApi } from "./api";
import { getPendingAuthStore, getReauthenticationStore } from "./auth-attempt";
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
      readReauthentication: async (ownerId) => {
        const account = createAccountClient({
          scope,
          newKey: randomUUID,
          request: (path, init = {}) =>
            api.request({
              ...init,
              path,
              expectedOwner: ownerId,
              ...(init.headers?.["idempotency-key"]
                ? { key: init.headers["idempotency-key"] }
                : {}),
            }),
          readReauthentication: () => getReauthenticationStore().load(),
          reauthenticate: async (provider) => {
            if (!model) throw new ApiError("UNAVAILABLE", "계정을 다시 확인해 주세요.", true);
            await model.reauthenticate(provider);
          },
        });
        const access = await account.deletionAccess();
        return { providers: access.providers, verified: access.canDelete };
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
