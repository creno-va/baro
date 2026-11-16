import { expect, test } from "bun:test";
import { prepareProductConsentFixture } from "./helpers/product-shell-fixture";

test("the consent preview fixture fails closed outside explicit local mock before writing", () => {
  for (const [mode, hostname] of [
    ["real", "127.0.0.1"],
    ["mock", "baro.example"],
    [undefined, "localhost"],
  ]) {
    const entries = new Map<string, string>();
    const storage = {
      setItem: (key: string, value: string) => {
        entries.set(key, value);
      },
    };
    expect(() => prepareProductConsentFixture(mode, hostname ?? "", storage)).toThrow(
      "LOCAL_MOCK_FIXTURE_REQUIRED",
    );
    expect(entries.size).toBe(0);
  }
});

test("the visible preview action prepares an unchecked synthetic session and never records agreement", () => {
  const entries = new Map<string, string>();
  prepareProductConsentFixture("mock", "127.0.0.1", {
    setItem: (key, value) => {
      entries.set(key, value);
    },
  });
  const session = JSON.parse(entries.get("baro-api-mock-v1:session") ?? "null");
  expect(session).toEqual({
    user: { id: "shell-app-owner", name: "합성 고객", accountType: "customer" },
    needsConsent: true,
  });
  expect([...entries.keys()].some((key) => key.includes("consents"))).toBe(false);
});
