import { describe, expect, test } from "bun:test";
import { parseAuthEnvironment } from "./env";

const validEnvironment = {
  BETTER_AUTH_URL: "http://localhost:4321",
  BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters",
  GOOGLE_CLIENT_ID: "google-client",
  GOOGLE_CLIENT_SECRET: "google-secret",
  NAVER_CLIENT_ID: "naver-client",
  NAVER_CLIENT_SECRET: "naver-secret",
  KAKAO_CLIENT_ID: "kakao-client",
  KAKAO_CLIENT_SECRET: "kakao-secret",
} as Env;

describe("auth environment", () => {
  test("accepts the complete provider configuration", () => {
    expect(parseAuthEnvironment(validEnvironment).BETTER_AUTH_URL).toBe("http://localhost:4321");
  });

  test("rejects a missing provider secret without exposing values", () => {
    expect(() => parseAuthEnvironment({ ...validEnvironment, NAVER_CLIENT_SECRET: "" })).toThrow(
      "AUTH_CONFIGURATION_INVALID:NAVER_CLIENT_SECRET",
    );
  });

  test("requires a session signing secret with at least 32 characters", () => {
    expect(() =>
      parseAuthEnvironment({ ...validEnvironment, BETTER_AUTH_SECRET: "too-short" }),
    ).toThrow("AUTH_CONFIGURATION_INVALID:BETTER_AUTH_SECRET");
  });
});
