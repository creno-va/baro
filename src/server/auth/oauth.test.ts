import { describe, expect, test } from "bun:test";
import { getAuth } from ".";

const authEnvironment = {
  BETTER_AUTH_URL: "http://localhost:4321",
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-thirty-two-characters",
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  NAVER_CLIENT_ID: "naver-client-id",
  NAVER_CLIENT_SECRET: "naver-client-secret",
  KAKAO_CLIENT_ID: "kakao-client-id",
  KAKAO_CLIENT_SECRET: "kakao-client-secret",
  DB: {
    prepare() {
      let values: unknown[] = [];
      return {
        bind(...parameters: unknown[]) {
          values = parameters;
          return this;
        },
        async raw() {
          return [values];
        },
      };
    },
  },
} as unknown as Env;

const providerHosts = {
  google: "accounts.google.com",
  naver: "nid.naver.com",
  kakao: "kauth.kakao.com",
} as const;

describe("OAuth provider initiation", () => {
  for (const [provider, expectedHost] of Object.entries(providerHosts)) {
    test(`creates a ${provider} authorization URL`, async () => {
      const response = await getAuth(authEnvironment).handler(
        new Request("http://localhost:4321/api/auth/sign-in/social", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:4321",
          },
          body: JSON.stringify({
            provider,
            callbackURL: "/consent",
            disableRedirect: true,
          }),
        }),
      );

      expect(response.status).toBe(200);
      const result = (await response.json()) as { redirect: boolean; url: string };
      expect(result.redirect).toBe(false);
      expect(new URL(result.url).host).toBe(expectedHost);
    });
  }
});
