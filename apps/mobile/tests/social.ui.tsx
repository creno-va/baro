import { createSessionScope } from "@baro/client-core";
import { getCookie, getSetCookie, storageAdapter } from "@better-auth/expo/client";
import * as WebBrowser from "expo-web-browser";
import { resolveMobileConfig } from "../config/environment";
import { createNativeCredentials } from "../src/platform/auth/credentials";
import { createNativeSocialAuthorization } from "../src/platform/auth/social";

jest.mock("expo-constants", () => {
  const actual = jest.requireActual("expo-constants");
  return {
    ...actual,
    __esModule: true,
    default: {
      ...actual.default,
      expoConfig: { scheme: "baro-preview", hostUri: "127.0.0.1:8081" },
      linkingUri: "baro-preview://",
    },
  };
});

test("the actual Better Auth/Expo client uses fixed native transport and never opens its legacy cookie callback", async () => {
  const values = new Map<string, string>();
  const credentials = createNativeCredentials({
    scope: createSessionScope(),
    namespace: "baro_preview_auth",
    storage: {
      getItemAsync: async (key) => values.get(key) ?? null,
      setItemAsync: async (key, value) => {
        values.set(key, value);
      },
    },
    manageStorage: storageAdapter,
    codec: { header: getCookie, merge: getSetCookie },
  });
  const browser = jest.spyOn(WebBrowser, "openAuthSessionAsync");
  let requests = 0;
  const authorize = createNativeSocialAuthorization({
    config: resolveMobileConfig({ environment: "preview" }),
    credentials,
    fetch: async (url, init) => {
      requests++;
      expect(url).toBe("https://preview.baro.site/api/auth/sign-in/social");
      expect(init.credentials).toBe("omit");
      expect(new Headers(init.headers).get("origin")).toBe("https://preview.baro.site");
      expect(JSON.parse(String(init.body))).toMatchObject({
        provider: "naver",
        disableRedirect: true,
      });
      return Response.json(
        { url: "https://nid.naver.com/oauth2.0/authorize?state=synthetic", redirect: true },
        {
          headers: {
            "set-cookie": "better-auth.oauth_state=synthetic-proof; Max-Age=600; HttpOnly",
          },
        },
      );
    },
  });
  try {
    expect(
      await authorize({
        provider: "naver",
        callbackURL: "baro-preview://auth/callback",
        errorCallbackURL: "baro-preview://auth/callback?error=oauth",
      }),
    ).toEqual({
      url: "https://nid.naver.com/oauth2.0/authorize?state=synthetic",
      oauthState: "synthetic-proof",
    });
    expect(requests).toBe(1);
    expect(browser).not.toHaveBeenCalled();
    expect(await credentials.capture().cookie()).toBe("better-auth.oauth_state=synthetic-proof");
    expect([...values.keys()].some((key) => key.endsWith("session_data"))).toBe(false);
  } finally {
    browser.mockRestore();
  }
});
