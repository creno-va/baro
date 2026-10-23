import { expect, test } from "bun:test";
import {
  iosAuthCancelBaseSchema,
  iosAuthenticationPrivacyBoundary,
  observeIosAuthCancelFailure,
  parseIosAuthCancelResult,
  verifyIosAuthCancelReceipt,
} from "../scripts/mobile-ios-auth-cancel";
import { iosInternalObservationOptions } from "../scripts/mobile-ios-ui-capabilities";

function observation() {
  return {
    kind: "ios-anonymous-provider-browser-cancellation",
    applicationId: "site.baro.app.preview",
    providers: ["google", "naver", "kakao"].map((provider) => ({
      provider,
      initialAnonymousObserved: true,
      osPromptHandled: false,
      systemWebViewObserved: true,
      dismissButtonHittable: true,
      systemDismissTapped: true,
      dismissControl: "close",
      dismissScope: "navigation-bar",
      nativeDismissControlVerified: true,
      webContentExcluded: true,
      webViewDismissed: true,
      anonymousReturnObserved: true,
      errorStateAbsent: true,
      consentStateAbsent: true,
    })),
    coldAnonymousReturnObserved: true,
    accountLoginPerformed: false,
    credentialsEntered: false,
    callbackExchangeVerified: false,
    providerAcceptanceVerified: false,
    privateDataAccess: false,
    publicDataNavigation: false,
    authenticationNavigation: true,
  };
}
const encode = (value: unknown) => `BARO_AUTH_CANCEL_RESULT:${JSON.stringify(value)}`;
test("auth navigation irreversibly blocks explicit screenshots and host raw command log persistence", () => {
  const privacy = iosAuthenticationPrivacyBoundary(),
    screenshot = ["/usr/bin/xcrun", "simctl", "io", "owned-device", "screenshot", "owned.png"];
  expect(privacy.persistCommandLogs).toBe(true);
  expect(() => privacy.assertCommandAllowed(screenshot)).not.toThrow();
  privacy.enterAuthentication();
  expect(privacy.explicitScreenshotReadsAllowed).toBe(false);
  expect(privacy.persistCommandLogs).toBe(false);
  expect(() => privacy.assertCommandAllowed(screenshot)).toThrow(
    "INTERNAL_IOS_AUTH_SCREENSHOT_FORBIDDEN",
  );
  expect(() => privacy.assertCommandAllowed(["xcodebuild", "test"])).not.toThrow();
  privacy.enterAuthentication();
  expect(privacy.persistCommandLogs).toBe(false);
  expect(() => privacy.assertCommandAllowed(screenshot)).toThrow();
});
test("auth-cancel requires an isolated Home smoke and excludes large font, audit and ordinary UI modes", () => {
  expect(iosInternalObservationOptions(["--home", "--auth-cancel"])).toEqual({
    home: true,
    largeFont: false,
    uiTest: false,
    accessibilityAudit: false,
    authCancel: true,
  });
  for (const args of [
    ["--auth-cancel"],
    ["--auth-cancel", "--home"],
    ["--home", "--large-font", "--auth-cancel"],
    ["--home", "--large-font", "--ui-test", "--auth-cancel"],
    ["--home", "--auth-cancel", "--auth-cancel"],
  ])
    expect(() => iosInternalObservationOptions(args)).toThrow();
});
test("system browser cancellation requires one complete result for all providers and cannot claim OAuth success", () => {
  const value = observation();
  expect(value).toEqual(parseIosAuthCancelResult(`private native chatter\n${encode(value)}\n`));
  for (const output of [
    "** TEST SUCCEEDED **",
    `${encode(value)}\n${encode(value)}`,
    "BARO_AUTH_CANCEL_RESULT:broken",
  ])
    expect(() => parseIosAuthCancelResult(output)).toThrow();
  for (const patch of [
    { providers: value.providers.slice(1) },
    { providers: [...value.providers].reverse() },
    {
      providers: value.providers.map((provider) => ({ ...provider, systemWebViewObserved: false })),
    },
    {
      providers: value.providers.map((provider) => ({
        ...provider,
        anonymousReturnObserved: false,
      })),
    },
    {
      providers: value.providers.map((provider) => ({ ...provider, url: "synthetic-private-url" })),
    },
    {
      providers: value.providers.map((provider) => ({ ...provider, dismissScope: "application" })),
    },
    { providers: value.providers.map((provider) => ({ ...provider, dismissControl: "sign-in" })) },
    { providers: value.providers.map((provider) => ({ ...provider, webContentExcluded: false })) },
    {
      providers: value.providers.map((provider) => ({
        ...provider,
        nativeDismissControlVerified: false,
      })),
    },
    { coldAnonymousReturnObserved: false },
    { accountLoginPerformed: true },
    { credentialsEntered: true },
    { callbackExchangeVerified: true },
    { providerAcceptanceVerified: true },
    { rawHierarchy: "synthetic-private" },
  ])
    expect(() => parseIosAuthCancelResult(encode({ ...value, ...patch }))).toThrow();
});
test("all supported dismiss styles remain native-bar scoped; style aliases cannot relax the return proof", () => {
  for (const dismissControl of ["cancel", "done", "close"] as const)
    for (const dismissScope of ["navigation-bar", "toolbar"] as const) {
      const value = observation();
      value.providers = value.providers.map((provider) => ({
        ...provider,
        dismissControl,
        dismissScope,
      }));
      expect(parseIosAuthCancelResult(encode(value)).providers[0]?.dismissControl).toBe(
        dismissControl,
      );
      expect(() =>
        parseIosAuthCancelResult(encode({ ...value, coldAnonymousReturnObserved: false })),
      ).toThrow();
    }
});
test("failed native auth observation exports only fixed stage/provider/assertion categories", () => {
  const value = observeIosAuthCancelFailure(
    'private-url-cookie\nBARO_AUTH_CANCEL_STAGE:{"provider":"google","stage":"provider-tapped"}\nBARO_AUTH_CANCEL_STAGE:{"provider":"private-id","stage":"private-state"}\nXCTAssertTrue failed - BARO_AUTH_SYSTEM_WEBVIEW_MISSING\n',
  );
  expect(value).toEqual({
    lastStage: { provider: "google", stage: "provider-tapped" },
    status: null,
    assertionCode: "BARO_AUTH_SYSTEM_WEBVIEW_MISSING",
  });
  expect(JSON.stringify(value)).not.toContain("private");
  const status = {
    provider: "google",
    systemWebViewVisible: false,
    dismissCandidates: ["navigation-bar", "toolbar", "application"].flatMap((scope) =>
      ["cancel", "done", "close"].map((control) => ({
        scope,
        control,
        count: 0,
        uniqueFullyHittable: false,
        outsideWebContent: false,
      })),
    ),
    authorizingVisible: false,
    startUnavailableVisible: true,
    retryVisible: true,
    appForeground: true,
  };
  expect(
    observeIosAuthCancelFailure(`BARO_AUTH_CANCEL_STATUS:${JSON.stringify(status)}`).status
      ?.startUnavailableVisible,
  ).toBe(true);
  expect(
    observeIosAuthCancelFailure(
      `BARO_AUTH_CANCEL_STATUS:${JSON.stringify({ ...status, url: "private" })}`,
    ).status,
  ).toBeNull();
  for (const dismissCandidates of [
    status.dismissCandidates.slice(1),
    [...status.dismissCandidates].reverse(),
    status.dismissCandidates.map((candidate) => ({ ...candidate, uniqueFullyHittable: true })),
    status.dismissCandidates.map((candidate) => ({ ...candidate, rawLabel: "private" })),
  ])
    expect(
      observeIosAuthCancelFailure(
        `BARO_AUTH_CANCEL_STATUS:${JSON.stringify({ ...status, dismissCandidates })}`,
      ).status,
    ).toBeNull();
  expect(
    observeIosAuthCancelFailure("XCTAssertTrue failed - BARO_AUTH_SYSTEM_CANCEL_MISSING")
      .assertionCode,
  ).toBe("BARO_AUTH_SYSTEM_CANCEL_MISSING");
  expect(
    observeIosAuthCancelFailure("XCTAssertNotNil failed - BARO_AUTH_SYSTEM_DISMISS_MISSING")
      .assertionCode,
  ).toBe("BARO_AUTH_SYSTEM_DISMISS_MISSING");
  expect(
    observeIosAuthCancelFailure("compiler echo BARO_AUTH_SYSTEM_WEBVIEW_MISSING").assertionCode,
  ).toBeNull();
  expect(
    observeIosAuthCancelFailure("XCTAssertTrue failed - BARO_AUTH_PRIVATE_CODE").assertionCode,
  ).toBeNull();
  expect(
    observeIosAuthCancelFailure(
      'BARO_AUTH_CANCEL_STAGE:{"provider":"google","stage":"provider-tapped","url":"private"}',
    ).lastStage,
  ).toBeNull();
});
test("native auth cancellation binds the original binary, compiler, tooling and owned Simulator baseline", async () => {
  const baseline = await Bun.file(
    "docs/quality/mobile-internal-ios-2026-10-23/home-90a2f58.json",
  ).json();
  const value = {
    ...iosAuthCancelBaseSchema.strip().parse(baseline),
    kind: "ios-bundled-anonymous-auth-cancellation",
    observedAt: "2026-10-24T00:00:00.000Z",
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
  expect(verifyIosAuthCancelReceipt(value, baseline).result.providers).toHaveLength(3);
  for (const patch of [
    { binarySourceSha: "c".repeat(40) },
    { toolingSourceSha: "d".repeat(40) },
    { archiveSha256: "e".repeat(64) },
    { compilerReceiptSha256: "f".repeat(64) },
    { device: { ...baseline.device, model: "other" } },
    { explicitScreenshotsSuppressedBeforeNavigation: false },
    { hostRawCommandLogsPersistedAfterBoundary: true },
    { rawXcresultExported: true },
    { oauthVerified: true },
    { accessibilityVerified: true },
    { physicalDeviceVerified: true },
    { storeSigned: true },
    { productRecompiled: true },
    { rawCookie: "synthetic-private" },
  ])
    expect(() => verifyIosAuthCancelReceipt({ ...value, ...patch }, baseline)).toThrow();
});
