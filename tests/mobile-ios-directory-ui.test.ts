import { expect, test } from "bun:test";
import { iosAuthenticationPrivacyBoundary } from "../scripts/mobile-ios-auth-cancel";
import {
  iosDirectoryBaseSchema,
  observeIosDirectoryFailure,
  parseIosDirectoryResult,
  verifyIosDirectoryReceipt,
} from "../scripts/mobile-ios-directory-ui";
import { iosInternalObservationOptions } from "../scripts/mobile-ios-ui-capabilities";

function observation() {
  return {
    kind: "ios-public-directory-keyboard-rotation",
    applicationId: "site.baro.app.preview",
    initialReadyState: "empty",
    inputFullyHittable: true,
    keyboardObserved: true,
    focusedInputAboveKeyboard: true,
    syntheticAsciiInputRetained: true,
    searchSubmittedByKeyboard: true,
    keyboardDismissed: true,
    filteredEmptyStateObserved: true,
    landscapeWindowObserved: true,
    landscapeInputRetained: true,
    landscapeInputFullyHittable: true,
    portraitWindowObserved: true,
    portraitInputRetained: true,
    portraitInputFullyHittable: true,
    homeReturnObserved: true,
    publicDataNavigation: true,
    profileOpened: false,
    contactOpened: false,
    remoteMutationPerformed: false,
    authenticationNavigation: false,
    privateDataAccess: false,
    koreanKeyboardVerified: false,
    voiceOverVerified: false,
    httpTransportSeparatelyObserved: false,
  };
}
const encode = (value: unknown) => `BARO_DIRECTORY_UI_RESULT:${JSON.stringify(value)}`;
test("directory requires an isolated Home mode and cannot combine with authentication or static audit", () => {
  expect(iosInternalObservationOptions(["--home", "--public-directory"])).toEqual({
    home: true,
    largeFont: false,
    uiTest: false,
    accessibilityAudit: false,
    authCancel: false,
    publicDirectory: true,
  });
  for (const args of [
    ["--public-directory"],
    ["--public-directory", "--home"],
    ["--home", "--auth-cancel", "--public-directory"],
    ["--home", "--public-directory", "--auth-cancel"],
    ["--home", "--large-font", "--public-directory"],
    ["--home", "--public-directory", "--public-directory"],
  ])
    expect(() => iosInternalObservationOptions(args)).toThrow();
});
test("public navigation irreversibly suppresses screenshots and host raw logs before the runner starts", () => {
  const privacy = iosAuthenticationPrivacyBoundary();
  privacy.enterPublicData();
  expect(privacy.persistCommandLogs).toBe(false);
  expect(privacy.explicitScreenshotReadsAllowed).toBe(false);
  expect(() =>
    privacy.assertCommandAllowed(["xcrun", "simctl", "io", "owned", "screenshot", "out.png"]),
  ).toThrow();
  privacy.enterAuthentication();
  privacy.enterPublicData();
  expect(privacy.persistCommandLogs).toBe(false);
  expect(() => privacy.assertCommandAllowed(["xcodebuild", "test"])).not.toThrow();
});
test("result requires observed input, keyboard, both window orientations and Home return without exporting public values", () => {
  const value = observation();
  expect(value).toEqual(parseIosDirectoryResult(`private native chatter\n${encode(value)}`));
  expect(
    parseIosDirectoryResult(encode({ ...value, initialReadyState: "cards" })).initialReadyState,
  ).toBe("cards");
  for (const [key, field] of Object.entries(value)) {
    if (typeof field === "boolean") {
      expect(() =>
        parseIosDirectoryResult(encode({ ...value, [key]: !value[key as keyof typeof value] })),
      ).toThrow();
    }
  }
  for (const patch of [
    { query: "private-value" },
    { profileName: "private-value" },
    { rawHierarchy: "private-value" },
    { initialReadyState: "error" },
  ])
    expect(() => parseIosDirectoryResult(encode({ ...value, ...patch }))).toThrow();
  for (const output of [
    "** TEST SUCCEEDED **",
    `${encode(value)}\n${encode(value)}`,
    "BARO_DIRECTORY_UI_RESULT:broken",
  ])
    expect(() => parseIosDirectoryResult(output)).toThrow();
});
test("failure reporting retains only a known XCTest assertion code", () => {
  expect(
    observeIosDirectoryFailure(
      "XCTAssertTrue failed - BARO_DIRECTORY_INPUT_OCCLUDED private details",
    ),
  ).toEqual({ assertionCode: "BARO_DIRECTORY_INPUT_OCCLUDED" });
  for (const output of [
    "compiler echo BARO_DIRECTORY_INPUT_OCCLUDED",
    "XCTAssertTrue failed - BARO_DIRECTORY_PRIVATE",
    "private native chatter",
  ])
    expect(observeIosDirectoryFailure(output)).toEqual({ assertionCode: null });
});
test("directory proof binds binary, compiler, tooling and device while preserving the narrow UI-only scope", async () => {
  const baseline = await Bun.file(
    "docs/quality/mobile-internal-ios-2026-10-23/home-90a2f58.json",
  ).json();
  const value = {
    ...iosDirectoryBaseSchema.strip().parse(baseline),
    kind: "ios-bundled-public-directory-input-observation",
    swiftTestSha256: "a".repeat(64),
    projectGeneratorSha256: "b".repeat(64),
    projectGeneratorVersion: "1.28.1",
    explicitScreenshotsSuppressedBeforeNavigation: true,
    hostRawCommandLogsPersistedAfterBoundary: false,
    rawXcresultExported: false,
    rawUiHierarchyExported: false,
    uiTestRunnerCompiled: true,
    productRecompiled: false,
    productResigned: false,
    result: observation(),
  };
  expect(verifyIosDirectoryReceipt(value, baseline).result.homeReturnObserved).toBe(true);
  for (const patch of [
    { binarySourceSha: "a".repeat(40) },
    { toolingSourceSha: "b".repeat(40) },
    { archiveSha256: "c".repeat(64) },
    { compilerReceiptSha256: "d".repeat(64) },
    { device: { ...baseline.device, model: "other" } },
    { explicitScreenshotsSuppressedBeforeNavigation: false },
    { hostRawCommandLogsPersistedAfterBoundary: true },
    { rawXcresultExported: true },
    { rawUiHierarchyExported: true },
    { productRecompiled: true },
    { productResigned: true },
    { oauthVerified: true },
    { remoteApiVerified: true },
    { physicalDeviceVerified: true },
    { accessibilityVerified: true },
    { rawProfile: "private-value" },
  ])
    expect(() => verifyIosDirectoryReceipt({ ...value, ...patch }, baseline)).toThrow();
});
