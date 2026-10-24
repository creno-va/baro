import { ApiError } from "@baro/api-client";
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

test.each(["naver", "apple"] as const)(
  "the actual Better Auth/Expo client uses fixed native transport and no legacy cookie callback: %s",
  async (provider) => {
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
          provider,
          disableRedirect: true,
        });
        return Response.json(
          {
            url:
              provider === "apple"
                ? "https://appleid.apple.com/auth/authorize?state=synthetic"
                : "https://nid.naver.com/oauth2.0/authorize?state=synthetic",
            redirect: true,
          },
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
          provider,
          callbackURL: "baro-preview://auth/callback",
          errorCallbackURL: "baro-preview://auth/callback?error=oauth",
        }),
      ).toEqual({
        url:
          provider === "apple"
            ? "https://appleid.apple.com/auth/authorize?state=synthetic"
            : "https://nid.naver.com/oauth2.0/authorize?state=synthetic",
        oauthState: "synthetic-proof",
      });
      expect(requests).toBe(1);
      expect(browser).not.toHaveBeenCalled();
      expect(await credentials.capture().cookie()).toBe("better-auth.oauth_state=synthetic-proof");
      expect([...values.keys()].some((key) => key.endsWith("session_data"))).toBe(false);
    } finally {
      browser.mockRestore();
    }
  },
);

test("owner retirement while the SDK waits for credentials cannot capture a replacement jar or send OAuth IO", async () => {
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
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  credentials.ready = () => gate;
  const capture = jest.spyOn(credentials, "capture"),
    fetch = jest.fn(async () => Response.json({}));
  const authorize = createNativeSocialAuthorization({
    config: resolveMobileConfig({ environment: "preview" }),
    credentials,
    fetch,
  });
  const pending = authorize(
    {
      provider: "apple",
      callbackURL: "baro-preview://auth/callback",
      errorCallbackURL: "baro-preview://auth/callback?error=oauth",
    },
    () => {
      throw new ApiError("UNAUTHENTICATED", "합성 owner 변경");
    },
  );
  release();
  await expect(pending).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(capture).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(values.size).toBe(0);
});
