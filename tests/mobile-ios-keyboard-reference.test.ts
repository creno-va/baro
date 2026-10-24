import { expect, test } from "bun:test";
import type { z } from "zod";
import {
  assertKeyboardReferenceProductAbsent,
  decodeKeyboardReferenceAppInventory,
  keyboardReferenceTestSelector,
  type keyboardSettingsReferenceResultSchema,
  observeKeyboardReferenceFailure,
  parseKeyboardSettingsReference,
} from "../scripts/mobile-ios-keyboard-reference";

function result(): z.infer<typeof keyboardSettingsReferenceResultSchema> {
  return {
    kind: "ios-owned-korean-settings-control-reference-only",
    screen: "Korean",
    doneObserved: true,
    controls: [{ kind: "cell", label: "Synthetic OS keyboard choice" }],
    layoutSelected: false,
    productInputVerified: false,
    koreanKeyboardVerified: false,
    rawHierarchyExported: false,
    rawValuesExported: false,
    screenshotsExported: false,
    rawXcresultExported: false,
  };
}
const encode = (v: unknown) => "BARO_KEYBOARD_REFERENCE_RESULT:" + JSON.stringify(v);
test("Settings reference requires exactly one bounded public-OS result and never accepts a product or raw capture claim", () => {
  const v = result();
  expect(parseKeyboardSettingsReference("private compiler text\n" + encode(v))).toEqual(v);
  for (const output of [
    "TEST SUCCEEDED",
    encode(v) + "\n" + encode(v),
    "BARO_KEYBOARD_REFERENCE_RESULT:broken",
  ])
    expect(() => parseKeyboardSettingsReference(output)).toThrow();
  for (const patch of [
    { screen: "Account" },
    { doneObserved: false },
    { layoutSelected: true },
    { productInputVerified: true },
    { koreanKeyboardVerified: true },
    { rawValuesExported: true },
    { rawHierarchyExported: true },
    { screenshotsExported: true },
    { rawXcresultExported: true },
    { profile: "synthetic-private" },
    { controls: [] },
    { controls: Array(33).fill(v.controls[0]) },
    { controls: [{ kind: "text-field", label: "private" }] },
    { controls: [{ kind: "cell", label: "a".repeat(161) }] },
    { controls: [{ kind: "cell", label: "https://provider.invalid/callback?code=private" }] },
    { controls: [{ kind: "cell", label: "private@example.invalid" }] },
    { controls: [{ kind: "cell", label: "OS choice", value: "private" }] },
  ])
    expect(() => parseKeyboardSettingsReference(encode({ ...v, ...patch }))).toThrow();
});
test("fresh Simulator product absence rejects every BARO app environment and malformed inventories", () => {
  expect(() =>
    assertKeyboardReferenceProductAbsent({
      "com.apple.Preferences": {},
      "site.baro.test.home": {},
    }),
  ).not.toThrow();
  for (const v of [
    null,
    [],
    "invalid",
    { "site.baro.app": {} },
    { "site.baro.app.preview": {} },
    { "site.baro.app.local": {} },
  ])
    expect(() => assertKeyboardReferenceProductAbsent(v)).toThrow();
});
test("the separate run uses only the Settings reference test and preserves the product runner's original input requirements", async () => {
  expect(keyboardReferenceTestSelector).toBe(
    "-only-testing:BaroHomeUITests/BaroDirectoryUITests/testKoreanLayoutReference",
  );
  const swift = await Bun.file(
    "scripts/mobile-ios-ui/KeyboardSettingsReferenceUITests.swift",
  ).text();
  expect(swift).toContain("openKoreanLayoutSettings()");
  expect(swift).not.toMatch(
    /\.value|\.identifier|\.debugDescription|\.screenshot\(|\.tap\(|\.typeText\(|UIPasteboard/,
  );
  const product = await Bun.file("scripts/mobile-ios-ui/DirectoryKoreanUITests.swift").text();
  expect(product).toContain("guard let settings = openKoreanLayoutSettings() else { return }");
  expect(product).toContain('XCTAssertNotNil(layout.element, "BARO_KOREAN_LAYOUT_MISSING")');
  expect(product).toContain('tapKoreanKey("ㅂ", keyboard: keyboard, app: app)');
});

test("app inventory supports actual simctl plist as well as JSON without accepting oversized or invalid conversions", async () => {
  const apps = { "com.apple.Preferences": {} };
  expect(
    await decodeKeyboardReferenceAppInventory(JSON.stringify(apps), async () => {
      throw Error("unexpected conversion");
    }),
  ).toEqual(apps);
  let conversions = 0;
  expect(
    await decodeKeyboardReferenceAppInventory('{ "com.apple.Preferences" = {}; }', async (raw) => {
      conversions++;
      expect(raw).toContain("Preferences");
      return JSON.stringify(apps);
    }),
  ).toEqual(apps);
  expect(conversions).toBe(1);
  await expect(
    decodeKeyboardReferenceAppInventory("x".repeat(4_000_001), async () => "{}"),
  ).rejects.toThrow();
  await expect(
    decodeKeyboardReferenceAppInventory("plist", async () => "invalid"),
  ).rejects.toThrow();
  await expect(
    decodeKeyboardReferenceAppInventory("plist", async () => "x".repeat(4_000_001)),
  ).rejects.toThrow();
});

test("reference failures expose only fixed assertions and compiler booleans, never unknown raw errors", () => {
  const output =
    "private path/account/code\nXCTAssertTrue failed - BARO_KEYBOARD_REFERENCE_SCOPE_MISSING";
  expect(observeKeyboardReferenceFailure(output)).toEqual({
    assertionCode: "BARO_KEYBOARD_REFERENCE_SCOPE_MISSING",
    swiftCompilationFailure: false,
    testHostConfigurationFailure: false,
    signingFailure: false,
    runnerLaunchFailure: false,
  });
  expect(
    observeKeyboardReferenceFailure("failed - BARO_KEYBOARD_REFERENCE_PRIVATE_UNKNOWN")
      .assertionCode,
  ).toBeNull();
  expect(
    observeKeyboardReferenceFailure("Command SwiftCompile failed private account")
      .swiftCompilationFailure,
  ).toBe(true);
  expect(JSON.stringify(observeKeyboardReferenceFailure(output))).not.toContain("private");
});
