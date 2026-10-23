import { expect, test } from "bun:test";
import {
  androidAnonymousAuthObservation,
  androidAuthActivityObservation,
  androidAuthAppControl,
  androidAuthCancelReceiptSchema,
  androidAuthDiagnosticSchema,
  androidAuthenticationPrivacyBoundary,
  androidAuthFailureCode,
  androidCustomTabControls,
  observeAndroidAuthCancellation,
  verifyAndroidAuthCancelReceipt,
} from "../scripts/mobile-android-auth-cancel";
import { chromeTestCommandLineSha256 } from "../scripts/mobile-android-chrome-fixture";
import { androidHomeObservationOptions } from "../scripts/mobile-android-guide-ui";

const xml = (...parts: string[]) => `<?xml version="1.0"?><hierarchy>${parts.join("")}</hierarchy>`;
const node = (extra: string, pkg = "site.baro.app.preview") =>
  `<node package="${pkg}" enabled="true" bounds="[40,100][400,200]" ${extra}/>`;
const browser = (extra = "") =>
  xml(
    '<node package="com.android.chrome" enabled="true" class="android.webkit.WebView" bounds="[0,250][1080,1800]"/>',
    '<node package="com.android.chrome" enabled="true" clickable="true" class="android.widget.ImageButton" resource-id="com.android.chrome:id/close_button" bounds="[0,90][140,230]"/>',
    extra,
  );
test("manual auth workflow exports only scoped receipts and pre-auth PNG paths, never raw device dumps", async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file(".github/workflows/mobile-internal-android-compiled-reverify.yml").text(),
  ) as {
    on: Record<string, unknown>;
    permissions: Record<string, string>;
    jobs: {
      verify: {
        if: string;
        steps: { if?: string; run?: string; uses?: string; with?: Record<string, string> }[];
      };
    };
  };
  expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
  expect(workflow.permissions).toEqual({ contents: "read", actions: "read" });
  expect(workflow.jobs.verify.if).toBe("github.ref == 'refs/heads/main'");
  expect(
    workflow.jobs.verify.steps.some(
      (step) =>
        step.if ===
          "inputs.auth_cancel && (!inputs.smoke || inputs.large_font || inputs.public_directory || inputs.guide_ui)" &&
        step.run === "exit 1",
    ),
  ).toBe(true);
  const output = workflow.jobs.verify.steps.find((step) =>
    step.with?.name?.startsWith("mobile-internal-android-compiled-home-"),
  )?.with?.path;
  expect(output).toContain(".wrangler/mobile-internal-android-runtime/auth-cancel-ui.json");
  expect(output).not.toMatch(/\*|xml|log|xcresult|dump/);
  const legacy = Bun.YAML.parse(
    await Bun.file(".github/workflows/mobile-internal-android-reverify.yml").text(),
  ) as { on: { workflow_dispatch: { inputs: Record<string, unknown> } } };
  expect(legacy.on.workflow_dispatch.inputs.auth_cancel).toBeUndefined();
  expect(
    workflow.jobs.verify.steps.some(
      (step) => step.run === "bun scripts/mobile-internal-android-compiled-reverify.ts",
    ),
  ).toBe(true);
  const commands = workflow.jobs.verify.steps.map((step) => step.run ?? "").join("\n");
  expect(commands).toContain("tests/fixtures/android-internal-preview.json");
  expect(commands).toContain("verifyCompiledAndroidProvenance");
});
test("auth capture boundary is irreversible and rejects screenshots and raw diagnostics before any UI action", async () => {
  const privacy = androidAuthenticationPrivacyBoundary();
  const screenshot = ["adb", "exec-out", "screencap", "-p"];
  expect(() => privacy.assertCommandAllowed(screenshot)).not.toThrow();
  privacy.enterAuthentication();
  privacy.enterAuthentication();
  for (const command of [
    screenshot,
    ["adb", "shell", "screenrecord"],
    ["adb", "logcat"],
    ["adb", "bugreport"],
    ["adb", "shell", "/system/bin/screencap", "-p"],
  ])
    expect(() => privacy.assertCommandAllowed(command)).toThrow("ANDROID_AUTH_CAPTURE_FORBIDDEN");
  expect(() =>
    privacy.assertCommandAllowed(["adb", "shell", "input", "keyevent", "KEYCODE_BACK"]),
  ).not.toThrow();
  let calls = 0;
  await expect(
    observeAndroidAuthCancellation({
      boundaryEntered: false,
      screenshotsSuppressed: true,
      width: 1080,
      height: 1920,
      shell: async () => {
        calls++;
        return "";
      },
      diagnostic() {},
    }),
  ).rejects.toThrow("ANDROID_AUTH_BOUNDARY_REQUIRED");
  expect(calls).toBe(0);
  expect(androidAuthFailureCode(Error("ANDROID_AUTH_PRIVATE_URL_STATE"))).toBe(
    "ANDROID_AUTH_VALIDATION_FAILED",
  );
});
test("app UI targets require a unique exact owned clickable control in bounds and observations contain no raw text", () => {
  const login = node('text="Google로 로그인" clickable="true"');
  expect(androidAuthAppControl(xml(login), 1080, 1920, "google")).toEqual({ x: 220, y: 150 });
  for (const invalid of [
    xml(login, login),
    xml(login.replace('enabled="true"', 'enabled="false"')),
    xml(login.replace("site.baro.app.preview", "com.android.chrome")),
    xml(login.replace("[400,200]", "[1400,200]")),
    xml(login.replace("Google로 로그인", "Google로 로그인 private")),
    xml(login.replace('clickable="true"', 'clickable="false"')),
  ])
    expect(androidAuthAppControl(invalid, 1080, 1920, "google")).toBeNull();
  expect(() => androidAuthAppControl(xml(login), 0, 1920, "google")).toThrow();
  expect(() => androidAnonymousAuthObservation('<?xml version="1.0"?><!ENTITY private>')).toThrow();
  const state = androidAnonymousAuthObservation(
    xml(
      node('text="BARO 로그인"'),
      node('text="이용 유형을 선택해 주세요."'),
      node('text="private account url state"'),
    ),
  );
  expect(state).toEqual({
    anonymousGatePresent: true,
    authorizingPresent: false,
    errorPresent: false,
    consentPresent: false,
    authenticatedPresent: false,
  });
  expect(JSON.stringify(state)).not.toContain("private");
  expect(
    androidAnonymousAuthObservation(xml(node('text="BARO 로그인"', "com.android.chrome")))
      .anonymousGatePresent,
  ).toBe(false);
});
test("browser proof rejects another activity, ambiguous foreground, spoofed native controls and web content overlap", () => {
  const chrome =
    "topResumedActivity=ActivityRecord{abc u0 com.android.chrome/org.chromium.chrome.browser.customtabs.CustomTabActivity t17}";
  expect(androidAuthActivityObservation(chrome).chromeCustomTabForeground).toBe(true);
  expect(
    androidAuthActivityObservation(
      chrome.replace("customtabs.CustomTabActivity", "firstrun.FirstRunActivity"),
    ).chromeFirstRunForeground,
  ).toBe(true);
  for (const invalid of [
    chrome.replace("com.android.chrome/", "private.package/"),
    `${chrome}\n${chrome}`,
    chrome.replace("customtabs.CustomTabActivity", "ChromeTabbedActivity"),
    "private url state",
  ])
    expect(androidAuthActivityObservation(invalid).chromeCustomTabForeground).toBe(false);
  expect(JSON.stringify(androidAuthActivityObservation("private url state"))).not.toContain(
    "private",
  );
  expect(androidCustomTabControls(browser(), 1080, 1920)).toEqual({
    webViewGeometryVerified: true,
    uniqueNativeCloseControl: true,
    closeControlOutsideEveryWebView: true,
  });
  for (const invalid of [
    browser().replace("[0,90][140,230]", "[0,300][140,440]"),
    browser().replace("android.widget.ImageButton", "android.widget.Button"),
    browser().replace("com.android.chrome:id/close_button", "private-id"),
    browser().replace("android.webkit.WebView", "android.view.View"),
    browser().replace("[0,250][1080,1800]", "[0,250][1080,2800]"),
    browser(
      '<node package="com.android.chrome" enabled="true" clickable="true" class="android.widget.ImageButton" resource-id="com.android.chrome:id/close_button" bounds="[0,90][140,230]"/>',
    ),
  ])
    expect(androidCustomTabControls(invalid, 1080, 1920).closeControlOutsideEveryWebView).toBe(
      false,
    );
});
test("auth mode is isolated and strict receipts bind original artifact and every provider without claiming account login", async () => {
  expect(androidHomeObservationOptions(["--auth-cancel"]).authCancel).toBe(true);
  for (const options of [
    ["--auth-cancel", "--large-font"],
    ["--auth-cancel", "--public-directory"],
    ["--auth-cancel", "--guide-ui"],
    ["--auth-cancel", "--auth-cancel"],
  ])
    expect(() => androidHomeObservationOptions(options)).toThrow();
  const home = await Bun.file(
    "docs/quality/mobile-internal-android-2026-10-23/home-346c920.json",
  ).json();
  const identity = {
    toolingSourceSha: home.toolingSourceSha,
    binarySourceSha: home.binarySourceSha,
    binary: home.binary,
    verificationSha256: home.verificationSha256,
    baselineReceiptSha256: "a".repeat(64),
    device: home.device,
  };
  const value = {
    ...identity,
    version: 1,
    kind: "android-anonymous-custom-tab-cancellation",
    observedAt: "2026-10-24T00:00:00.000Z",
    applicationId: "site.baro.app.preview",
    browserPackage: "com.android.chrome",
    browserFixture: {
      kind: "owned-emulator-preinstalled-chrome-test-fixture",
      buildType: "userdebug",
      chromeVersion: "130.0.6723.58",
      switches: ["--disable-fre"],
      commandLineSha256: chromeTestCommandLineSha256,
      commandLineReadbackVerified: true,
      commandLineRemovedVerified: true,
      consumerFirstRunVerified: false,
      consentUiUsed: false,
      accountsConfigured: false,
      rootAdbUsed: false,
      debugAppSettingsChanged: false,
      tlsChecksChanged: false,
      webSecurityChanged: false,
    },
    providers: ["google", "naver", "kakao"].map((provider) => ({
      provider,
      initialAnonymousObserved: true,
      providerButtonObserved: true,
      chromeCustomTabForeground: true,
      webViewGeometryVerified: true,
      uniqueNativeCloseControl: true,
      closeControlOutsideEveryWebView: true,
      systemBackPresses: 1,
      appForegroundReturned: true,
      anonymousReturnObserved: true,
      errorStateAbsent: true,
      consentStateAbsent: true,
    })),
    coldAnonymousReturnObserved: true,
    explicitScreenshotsSuppressedBeforeNavigation: true,
    adbCommandOutputPersisted: false,
    rawHierarchyExported: false,
    rawLogcatRead: false,
    accountLoginPerformed: false,
    credentialsEntered: false,
    callbackExchangeVerified: false,
    providerAcceptanceVerified: false,
    privateDataAccess: false,
    publicDataNavigation: false,
    authenticationNavigation: true,
    metroRequests: 0,
    physicalDeviceVerified: false,
    remoteApiVerified: false,
    oauthVerified: false,
    storeSigned: false,
    deployed: false,
  };
  expect(verifyAndroidAuthCancelReceipt(value, identity).providers).toHaveLength(3);
  for (const patch of [
    { providers: value.providers.slice(1) },
    { providers: [...value.providers].reverse() },
    { providers: value.providers.map((p) => ({ ...p, systemBackPresses: 2 })) },
    { providers: value.providers.map((p) => ({ ...p, closeControlOutsideEveryWebView: false })) },
    { explicitScreenshotsSuppressedBeforeNavigation: false },
    { accountLoginPerformed: true },
    { credentialsEntered: true },
    { oauthVerified: true },
    { physicalDeviceVerified: true },
    { rawHierarchy: "private" },
    { toolingSourceSha: "b".repeat(40) },
    { baselineReceiptSha256: "b".repeat(64) },
  ])
    expect(() => verifyAndroidAuthCancelReceipt({ ...value, ...patch }, identity)).toThrow();
  expect(() => androidAuthCancelReceiptSchema.parse(home)).toThrow();
  const diagnosis = {
    provider: "google",
    stage: "browser",
    app: null,
    activity: androidAuthActivityObservation("private state"),
    browser: androidCustomTabControls(browser(), 1080, 1920),
  };
  expect(androidAuthDiagnosticSchema.parse(diagnosis).provider).toBe("google");
  for (const patch of [{ provider: "private" }, { stage: "private" }, { url: "private" }])
    expect(() => androidAuthDiagnosticSchema.parse({ ...diagnosis, ...patch })).toThrow();
});
