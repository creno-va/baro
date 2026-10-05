import { describe, expect, test } from "bun:test";
import { CURRENT_POLICY_VERSIONS, consentInputSchema } from "../../contracts/consent";
import { hasAllowedOrigin } from "./me";

describe("consent contract", () => {
  test("accepts only the current policy versions and an over-14 confirmation", () => {
    expect(
      consentInputSchema.safeParse({
        ...CURRENT_POLICY_VERSIONS,
        over14Confirmed: true,
      }).success,
    ).toBe(true);

    expect(
      consentInputSchema.safeParse({
        ...CURRENT_POLICY_VERSIONS,
        over14Confirmed: false,
      }).success,
    ).toBe(false);
  });

  test("rejects unknown fields", () => {
    expect(
      consentInputSchema.safeParse({
        ...CURRENT_POLICY_VERSIONS,
        over14Confirmed: true,
        userId: "forged-user",
      }).success,
    ).toBe(false);
  });
});

describe("consent origin protection", () => {
  test("allows the configured same origin", () => {
    const request = new Request("https://baro.site/api/me/consent", {
      headers: { origin: "https://baro.site" },
    });

    expect(hasAllowedOrigin(request, "https://baro.site")).toBe(true);
  });

  test("rejects missing and cross-site origins", () => {
    expect(
      hasAllowedOrigin(new Request("https://baro.site/api/me/consent"), "https://baro.site"),
    ).toBe(false);
    expect(
      hasAllowedOrigin(
        new Request("https://baro.site/api/me/consent", {
          headers: { origin: "https://attacker.example" },
        }),
        "https://baro.site",
      ),
    ).toBe(false);
  });
});
