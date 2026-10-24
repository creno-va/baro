import { expect, test } from "bun:test";
import { mobileAuthCapabilitiesSchema } from "../src/contracts/mobile-auth";
import { api } from "../src/server/api";
import { getAuth } from "../src/server/auth";
import { appleConfiguration } from "../src/server/auth/apple-configuration";
import { availableMobileAuthProviders } from "../src/server/auth/mobile-contract";
import { syntheticAppleConfiguration } from "./helpers/apple-configuration";
import { createTestDatabase, testEnvironment } from "./helpers/d1";

const seconds = Math.floor(Date.now() / 1000);
for (const scenario of [
  "disabled",
  "missing-flag",
  "partial",
  "malformed",
  "expired",
  "future",
  "long-lived",
  "audience",
  "subject",
  "issuer",
  "algorithm",
  "key-id",
  "signature-size",
] as const)
  test(`optional Apple configuration fails closed without interrupting the existing three providers: ${scenario}`, async () => {
    const db = await createTestDatabase();
    try {
      const env = testEnvironment(db.binding),
        apple: Record<string, unknown> = syntheticAppleConfiguration(
          scenario === "expired"
            ? { exp: seconds - 1 }
            : scenario === "future"
              ? { iat: seconds + 60 }
              : scenario === "long-lived"
                ? { exp: seconds + 15777001 }
                : scenario === "audience"
                  ? { aud: "https://foreign.example.test" }
                  : scenario === "subject"
                    ? { sub: "other-service" }
                    : scenario === "issuer"
                      ? { iss: "invalid" }
                      : {},
          scenario === "algorithm"
            ? { alg: "none" }
            : scenario === "key-id"
              ? { kid: "invalid" }
              : {},
        );
      if (scenario === "disabled") apple.APPLE_AUTH_ENABLED = "false";
      if (scenario === "missing-flag") delete apple.APPLE_AUTH_ENABLED;
      if (scenario === "partial") delete apple.APPLE_CLIENT_SECRET;
      if (scenario === "malformed") apple.APPLE_CLIENT_SECRET = "synthetic-private-invalid-secret";
      if (scenario === "signature-size")
        apple.APPLE_CLIENT_SECRET = String(apple.APPLE_CLIENT_SECRET).slice(0, -1);
      Object.assign(env, apple);
      expect(appleConfiguration(env)).toBeNull();
      expect(availableMobileAuthProviders(env)).toEqual(["google", "naver", "kakao"]);
      expect((await getAuth(env).$context).socialProviders.map((p) => p.id)).toEqual([
        "google",
        "naver",
        "kakao",
      ]);
      const response = await api.request("/mobile/auth/capabilities", {}, env);
      const text = await response.text();
      expect(mobileAuthCapabilitiesSchema.parse(JSON.parse(text)).providers).toEqual([
        "google",
        "naver",
        "kakao",
      ]);
      expect(text).not.toContain("synthetic-private-invalid-secret");
    } finally {
      db.close();
    }
  });

test("explicit valid metadata adds only Apple, and cached auth follows operator rotation/disable without crossing environments", async () => {
  const db = await createTestDatabase();
  try {
    const env = Object.assign(testEnvironment(db.binding), syntheticAppleConfiguration());
    const first = getAuth(env);
    expect(getAuth(env)).toBe(first);
    expect((await first.$context).socialProviders.map((p) => p.id)).toEqual([
      "google",
      "naver",
      "kakao",
      "apple",
    ]);
    expect(availableMobileAuthProviders(env)).toEqual(["google", "naver", "kakao", "apple"]);
    const response = await api.request("/mobile/auth/capabilities", {}, env);
    expect(mobileAuthCapabilitiesSchema.parse(await response.json())).toEqual({
      contractVersion: 2,
      providers: ["google", "naver", "kakao", "apple"],
    });
    env.APPLE_CLIENT_SECRET = syntheticAppleConfiguration({
      exp: seconds + 7200,
    }).APPLE_CLIENT_SECRET;
    const rotated = getAuth(env);
    expect(rotated).not.toBe(first);
    env.APPLE_CLIENT_SECRET = syntheticAppleConfiguration({ exp: seconds - 1 }).APPLE_CLIENT_SECRET;
    const expired = getAuth(env);
    expect(expired).not.toBe(rotated);
    expect((await expired.$context).socialProviders.map((p) => p.id)).toEqual([
      "google",
      "naver",
      "kakao",
    ]);
    const otherEnv = testEnvironment(db.binding);
    expect(getAuth(otherEnv)).not.toBe(expired);
    expect((await getAuth(otherEnv).$context).socialProviders.map((p) => p.id)).toEqual([
      "google",
      "naver",
      "kakao",
    ]);
  } finally {
    db.close();
  }
});
