import { deletionAccessSchema } from "@baro/contracts/deletion";
import { randomUUID } from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { createNativeLogin } from "../platform/auth/login";
import { createNativeSocialAuthorization } from "../platform/auth/social";
import { getMobileApi } from "./api";
import { getPendingAuthStore, getReauthenticationStore, newNativeProof } from "./auth-attempt";
import { readMobileConfig } from "./config";
import { getMobileCredentials } from "./credentials";

let login: ReturnType<typeof createNativeLogin> | undefined;
export function getNativeLogin() {
  if (!login) {
    const config = readMobileConfig();
    const { credentials } = getMobileCredentials();
    const api = getMobileApi();
    login = createNativeLogin({
      config,
      attempts: getPendingAuthStore(),
      now: Date.now,
      newId: randomUUID,
      proof: newNativeProof,
      resetCredentials: () => credentials.reset(),
      authorize: createNativeSocialAuthorization({
        config,
        credentials,
        fetch: (url, init) => fetch(url, init),
      }),
      openBrowser: async (url, returnURL) => {
        const result = await WebBrowser.openAuthSessionAsync(url, returnURL, {
          preferEphemeralSession: true,
        });
        return result.type === "success"
          ? { type: "success", url: result.url }
          : { type: "cancelled" };
      },
      dismissBrowser: () => {
        try {
          WebBrowser.dismissAuthSession();
        } catch {
          /* No session may be open on Android. */
        }
      },
      exchange: (body) => api.request({ path: "/api/mobile/auth/exchange", method: "POST", body }),
      readSession: () => {
        // Exclude a pre-exchange anonymous read still in flight. Only a fresh
        // server response can complete login or recover a lost exchange body.
        api.session.invalidate();
        return api.session.get();
      },
      setAccountType: (value) => api.session.setAccountType(value),
      reauthentication: {
        proof: getReauthenticationStore(),
        prepare: (body, ownerId) =>
          api.request({
            path: "/api/mobile/auth/reauth/prepare",
            method: "POST",
            body,
            expectedOwner: ownerId,
          }),
        verify: (body) =>
          api.request({ path: "/api/mobile/auth/reauth/verify", method: "POST", body }),
        access: async () =>
          deletionAccessSchema.parse(await api.request({ path: "/api/me/deletion" })),
      },
    });
  }
  return login;
}
