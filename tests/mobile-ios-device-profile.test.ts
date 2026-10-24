import { expect, test } from "bun:test";
import type { z } from "zod";
import {
  iosDeviceProfileModels,
  resolveIosDeviceProfile,
  selectIosProfileDevice,
} from "../scripts/mobile-ios-device-profile";
import {
  type homeGuideUiResultSchema,
  observeHomeUiFailure,
  parseHomeGuideUiResult,
  type tabletHomeGuideUiResultSchema,
  verifyIosAccessibilityReceipt,
  verifyIosHomeUiReceipt,
} from "../scripts/mobile-ios-home-ui-test";

const mode = {
  home: true,
  authCancel: false,
  publicDirectory: false,
  inputReference: false,
  koreanDirectory: false,
};
test("owned tablet profiles are explicit and cannot opt into phone auth, directory or reference observations", () => {
  expect(resolveIosDeviceProfile(undefined, { ...mode, home: false })).toEqual({
    profile: "iphone-16",
    model: "iPhone 16",
    tablet: false,
  });
  expect(resolveIosDeviceProfile("ipad-pro-13-m4", mode)).toEqual({
    profile: "ipad-pro-13-m4",
    model: "iPad Pro 13-inch (M4)",
    tablet: true,
  });
  for (const value of ["iPad", "ipad-pro-13-m5", "", "private;command"])
    expect(() => resolveIosDeviceProfile(value, mode)).toThrow(
      "INTERNAL_IOS_DEVICE_PROFILE_REQUIRED",
    );
  for (const patch of [
    { home: false },
    { authCancel: true },
    { publicDirectory: true },
    { inputReference: true },
    { koreanDirectory: true },
  ])
    expect(() => resolveIosDeviceProfile("ipad-pro-13-m4", { ...mode, ...patch })).toThrow(
      "INTERNAL_IOS_TABLET_HOME_GUIDE_ONLY",
    );
});
test("device selection fails on missing, duplicate, unadvertised or malformed SDK identities without choosing a phone instead", () => {
  const phone = {
    name: "iPhone 16",
    identifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-16",
  };
  const tablet = {
    name: iosDeviceProfileModels["ipad-pro-13-m4"],
    identifier: "com.apple.CoreSimulator.SimDeviceType.iPad-Pro-13-inch-M4",
  };
  expect(selectIosProfileDevice([phone, tablet], tablet.name)).toEqual(tablet);
  for (const types of [
    [],
    [phone],
    [tablet, tablet],
    [{ ...tablet, identifier: "untrusted-device" }],
  ])
    expect(() => selectIosProfileDevice(types, tablet.name)).toThrow(
      "INTERNAL_IOS_PROFILE_DEVICE_REQUIRED",
    );
  expect(() =>
    selectIosProfileDevice([{ ...tablet, name: "unadvertised" }], "unadvertised"),
  ).toThrow();
});
async function phoneProofs() {
  const root = "docs/quality/mobile-native-c8215b8/ios-ui-40111075770/";
  return {
    baseline: await Bun.file(root + "home.json").json(),
    large: await Bun.file(root + "large-font.json").json(),
    ui: await Bun.file(root + "home-ui-test.json").json(),
    audit: await Bun.file(root + "accessibility-audit.json").json(),
  };
}
function tabletResult(
  phone: z.infer<typeof homeGuideUiResultSchema>,
): z.infer<typeof tabletHomeGuideUiResultSchema> {
  return {
    ...phone,
    kind: "ios-anonymous-tablet-home-guide-rotation-xcuitest",
    homeSwipes: 0,
    portraitHomeSwipes: 0,
    tabletIdiomObserved: true,
    landscapeGuideWindowObserved: true,
    landscapeReturnControlFullyHittable: true,
    portraitHomeWindowObserved: true,
    portraitGuideControlFullyHittable: true,
  };
}
test("tablet rotation proof can fit without scrolling while the original phone proof still requires its observed scroll", async () => {
  const { ui } = await phoneProofs();
  const tablet = tabletResult(ui.result);
  const encode = (value: unknown) => "BARO_HOME_UI_RESULT:" + JSON.stringify(value);
  expect(parseHomeGuideUiResult(encode(tablet))).toEqual(tablet);
  expect(() => parseHomeGuideUiResult(encode({ ...ui.result, homeSwipes: 0 }))).toThrow();
  for (const patch of [
    { tabletIdiomObserved: false },
    { landscapeGuideWindowObserved: false },
    { portraitHomeWindowObserved: false },
    { portraitGuideControlFullyHittable: false },
    { portraitHomeSwipes: 25 },
    { rawHierarchy: "private" },
    { authenticationNavigation: true },
    { privateDataAccess: true },
  ])
    expect(() => parseHomeGuideUiResult(encode({ ...tablet, ...patch }))).toThrow();
});
test("tablet results bind to the actual tablet device and do not reinterpret historical phone or audit receipts", async () => {
  const { baseline, large, ui, audit } = await phoneProofs();
  expect(verifyIosHomeUiReceipt(ui, baseline, large)).toEqual(ui);
  const tablet = { ...ui, result: tabletResult(ui.result) };
  expect(() => verifyIosHomeUiReceipt(tablet, baseline, large)).toThrow(
    "INTERNAL_IOS_UI_TEST_DEVICE_KIND_MISMATCH",
  );
  const device = { ...ui.device, model: iosDeviceProfileModels["ipad-pro-13-m4"] };
  const t = { ...tablet, device },
    b = { ...baseline, device },
    l = { ...large, device };
  expect(verifyIosHomeUiReceipt(t, b, l)).toEqual(t);
  expect(() => verifyIosHomeUiReceipt({ ...ui, device }, b, l)).toThrow(
    "INTERNAL_IOS_UI_TEST_DEVICE_KIND_MISMATCH",
  );
  expect(verifyIosAccessibilityReceipt({ ...audit, device }, t).result.issueCount).toBe(0);
  expect(() => verifyIosAccessibilityReceipt(audit, tablet)).toThrow(
    "INTERNAL_IOS_UI_TEST_DEVICE_KIND_MISMATCH",
  );
  expect(() =>
    verifyIosHomeUiReceipt(
      { ...t, device: { ...device, model: "iPad unknown" } },
      { ...b, device: { ...device, model: "iPad unknown" } },
      { ...l, device: { ...device, model: "iPad unknown" } },
    ),
  ).toThrow();
});
test("tablet failure diagnostics remain fixed and the phone Swift test's scroll requirement is unchanged", async () => {
  expect(
    observeHomeUiFailure("XCTAssertTrue failed - BARO_TABLET_LANDSCAPE_MISSING").assertionCode,
  ).toBe("BARO_TABLET_LANDSCAPE_MISSING");
  const phone = await Bun.file("scripts/mobile-ios-ui/HomeUITests.swift").text();
  expect(phone).toContain(
    'XCTAssertGreaterThan(homeSwipes, 0, "BARO_LARGE_FONT_SCROLL_NOT_OBSERVED")',
  );
  const tablet = await Bun.file("scripts/mobile-ios-ui/TabletHomeUITests.swift").text();
  expect(tablet).toContain("UIDevice.current.userInterfaceIdiom == .pad");
  expect(tablet).toContain("XCUIDevice.shared.orientation = .landscapeLeft");
  expect(tablet).not.toMatch(/\.typeText\(|\.screenshot\(|\.debugDescription/);
});
