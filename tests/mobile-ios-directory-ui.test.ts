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
  ).toEqual({ status: null, history: [], assertionCode: "BARO_DIRECTORY_INPUT_OCCLUDED" });
  for (const output of [
    "compiler echo BARO_DIRECTORY_INPUT_OCCLUDED",
    "XCTAssertTrue failed - BARO_DIRECTORY_PRIVATE",
    "private native chatter",
  ])
    expect(observeIosDirectoryFailure(output)).toEqual({
      status: null,
      history: [],
      assertionCode: null,
    });
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

test("iOS failure diagnostics distinguish typing and rotation using only fixed stages/input categories", () => {
  const status = {
    stage: "typed-check",
    inputState: "sentence-capitalized",
    appForeground: true,
    keyboardObserved: true,
  };
  for (const stage of [
    "before-input",
    "after-input",
    "typed-check",
    "landscape-check",
    "portrait-check",
  ] as const)
    for (const inputState of [
      "empty",
      "literal",
      "sentence-capitalized",
      "prefix",
      "other",
      "unavailable",
    ] as const) {
      const observed = { ...status, stage, inputState };
      expect(
        observeIosDirectoryFailure(
          `BARO_DIRECTORY_UI_STATUS:${JSON.stringify(observed)}\nXCTAssertTrue failed - BARO_DIRECTORY_TYPED_INPUT_MISMATCH`,
        ),
      ).toEqual({
        status: observed,
        history: [observed],
        assertionCode: "BARO_DIRECTORY_TYPED_INPUT_MISMATCH",
      });
    }
  for (const patch of [
    { stage: "private-value" },
    { inputState: "private-value" },
    { value: "private-value" },
    { label: "private-value" },
    { hierarchy: "private-value" },
    { appForeground: "private-value" },
  ])
    expect(
      observeIosDirectoryFailure(
        `BARO_DIRECTORY_UI_STATUS:${JSON.stringify({ ...status, ...patch })}`,
      ).status,
    ).toBeNull();
  for (const code of [
    "BARO_DIRECTORY_TYPED_INPUT_MISMATCH",
    "BARO_DIRECTORY_LANDSCAPE_INPUT_MISMATCH",
    "BARO_DIRECTORY_PORTRAIT_INPUT_MISMATCH",
    "BARO_DIRECTORY_INPUT_NOT_RETAINED",
  ] as const)
    expect(observeIosDirectoryFailure(`XCTAssertTrue failed - ${code}`).assertionCode).toBe(code);
});

test("input signatures and bounded status history export booleans only and reject unknown fields or partial signatures", () => {
  const inputSignature = {
    stringObserved: true,
    expectedLengthMatches: true,
    caseFoldMatches: true,
    whitespaceRemovalMatches: false,
    dashNormalizationMatches: false,
    compatibilityNormalizationMatches: false,
    knownNormalizationMatches: true,
    expectedSubsequenceOnly: true,
    containsKnownPayload: true,
    allKnownSegmentsPresent: true,
    knownDigitSuffixMatches: true,
    containsHangul: false,
    matchesFixedFieldLabel: false,
    onlyExpectedScalarsAfterCaseFold: true,
  };
  const status = {
    stage: "typed-check" as const,
    inputState: "other" as const,
    appForeground: true,
    keyboardObserved: true,
    inputSignature,
  };
  const encodeStatus = (value: unknown) => `BARO_DIRECTORY_UI_STATUS:${JSON.stringify(value)}`;
  expect(observeIosDirectoryFailure(encodeStatus(status)).status).toEqual(status);
  for (const extra of [
    { rawValue: "synthetic-private" },
    { length: 24 },
    { stringObserved: "synthetic-private" },
  ])
    expect(
      observeIosDirectoryFailure(
        encodeStatus({ ...status, inputSignature: { ...inputSignature, ...extra } }),
      ).status,
    ).toBeNull();
  expect(
    observeIosDirectoryFailure(
      encodeStatus({ ...status, inputSignature: { stringObserved: true } }),
    ).history,
  ).toEqual([]);
  const result = observeIosDirectoryFailure(
    Array.from({ length: 10 }, () => encodeStatus(status)).join("\n"),
  );
  expect(result.history).toHaveLength(8);
  expect(JSON.stringify(result)).not.toContain("synthetic-private");
});

test("requested public-directory verification requires the Apple signature probe before observing native UI", async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file(".github/workflows/mobile-internal-ios-reverify.yml").text(),
  ) as {
    jobs: {
      verify: {
        steps: { name?: string; if?: string; run?: string; env?: Record<string, string> }[];
      };
    };
  };
  const steps = workflow.jobs.verify.steps;
  const index = steps.findIndex(
    (step) => step.name === "Require actual Apple Foundation signature comparisons",
  );
  const entry = steps[index];
  expect(entry?.if).toBe("inputs.public_directory");
  expect(entry?.env).toEqual({ BARO_IOS_DIRECTORY_SIGNATURE_REQUIRED: "1" });
  expect(entry?.run).toBe("bun test tests/mobile-ios-directory-signature.test.ts");
  expect(index).toBeGreaterThan(
    steps.findIndex((step) => step.name === "Verify successful immutable tooling CI"),
  );
  expect(index).toBeLessThan(
    steps.findIndex(
      (step) =>
        step.name === "Reverify original metadata and optionally observe anonymous cold launches",
    ),
  );
});
