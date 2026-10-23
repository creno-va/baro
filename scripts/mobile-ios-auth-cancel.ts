import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { z } from "zod";
import { iosColdLaunchReceiptSchema } from "./mobile-internal-ios-input";
import { xcodeSimulatorControlArguments } from "./mobile-ios-xcode-control";

export function iosAuthenticationPrivacyBoundary() {
  let beforeAuthentication = true;
  return {
    get persistCommandLogs() {
      return beforeAuthentication;
    },
    get explicitScreenshotReadsAllowed() {
      return beforeAuthentication;
    },
    enterAuthentication() {
      beforeAuthentication = false;
    },
    assertCommandAllowed(args: readonly string[]) {
      if (!beforeAuthentication && args.includes("screenshot"))
        throw Error("INTERNAL_IOS_AUTH_SCREENSHOT_FORBIDDEN");
    },
  };
}
const providerResult = z.strictObject({
  provider: z.enum(["google", "naver", "kakao"]),
  initialAnonymousObserved: z.literal(true),
  osPromptHandled: z.boolean(),
  systemWebViewObserved: z.literal(true),
  dismissButtonHittable: z.literal(true),
  systemDismissTapped: z.literal(true),
  dismissControl: z.literal("cancel"),
  dismissScope: z.literal("snapshot-native-window"),
  nativeDismissControlVerified: z.literal(true),
  webContentExcluded: z.literal(true),
  webViewFrameExcluded: z.boolean(),
  snapshotTraversalComplete: z.literal(true),
  snapshotControlMatched: z.literal(true),
  webViewAncestorExcluded: z.literal(true),
  keyboardAncestorExcluded: z.literal(true),
  dismissControlAbsentBeforeAuthentication: z.literal(true),
  browserWindowGeometryVerified: z.literal(true),
  webViewDismissed: z.literal(true),
  anonymousReturnObserved: z.literal(true),
  errorStateAbsent: z.literal(true),
  consentStateAbsent: z.literal(true),
});
export const iosAuthCancelResultSchema = z.strictObject({
  kind: z.literal("ios-anonymous-provider-browser-cancellation"),
  applicationId: z.literal("site.baro.app.preview"),
  providers: z
    .array(providerResult)
    .length(3)
    .refine((values) => values.map((v) => v.provider).join(",") === "google,naver,kakao"),
  coldAnonymousReturnObserved: z.literal(true),
  accountLoginPerformed: z.literal(false),
  credentialsEntered: z.literal(false),
  callbackExchangeVerified: z.literal(false),
  providerAcceptanceVerified: z.literal(false),
  privateDataAccess: z.literal(false),
  publicDataNavigation: z.literal(false),
  authenticationNavigation: z.literal(true),
});
export function parseIosAuthCancelResult(output: string) {
  const prefix = "BARO_AUTH_CANCEL_RESULT:",
    lines = output.split(/\r?\n/).filter((line) => line.startsWith(prefix));
  if (lines.length !== 1 || !lines[0]) throw Error("INTERNAL_IOS_AUTH_SINGLE_RESULT_REQUIRED");
  return iosAuthCancelResultSchema.parse(JSON.parse(lines[0].slice(prefix.length)));
}
const stageSchema = z.strictObject({
  provider: z.enum(["google", "naver", "kakao"]),
  stage: z.enum([
    "provider-ready",
    "provider-tapped",
    "browser-presented",
    "cancel-tapped",
    "anonymous-returned",
    "cold-restart",
  ]),
});
const dismissCandidateSchema = z
  .strictObject({
    control: z.enum(["cancel", "done", "close"]),
    scope: z.enum(["navigation-bar", "toolbar", "application"]),
    count: z.number().int().min(0).max(256),
    uniqueFullyHittable: z.boolean(),
    outsideWebContent: z.boolean(),
    absentBeforeAuthentication: z.boolean(),
  })
  .refine((value) => value.count === 1 || (!value.uniqueFullyHittable && !value.outsideWebContent));
const statusSchema = z
  .strictObject({
    provider: z.enum(["google", "naver", "kakao"]),
    systemWebViewVisible: z.boolean(),
    browserWindowGeometryVerified: z.boolean(),
    cancelOwnership: z
      .strictObject({
        traversalComplete: z.boolean(),
        webViewObserved: z.boolean(),
        nativeCancelCount: z.number().int().min(0).max(256),
        queriedControlMatched: z.boolean(),
        webViewAncestorExcluded: z.boolean(),
        keyboardAncestorExcluded: z.boolean(),
      })
      .refine((value) =>
        value.queriedControlMatched
          ? value.traversalComplete &&
            value.webViewObserved &&
            value.nativeCancelCount === 1 &&
            value.webViewAncestorExcluded &&
            value.keyboardAncestorExcluded
          : !value.webViewAncestorExcluded && !value.keyboardAncestorExcluded,
      ),
    dismissCandidates: z
      .array(dismissCandidateSchema)
      .length(9)
      .refine(
        (values) =>
          values.map((value) => `${value.scope}:${value.control}`).join(",") ===
          "navigation-bar:cancel,navigation-bar:done,navigation-bar:close,toolbar:cancel,toolbar:done,toolbar:close,application:cancel,application:done,application:close",
      ),
    authorizingVisible: z.boolean(),
    startUnavailableVisible: z.boolean(),
    retryVisible: z.boolean(),
    appForeground: z.boolean(),
  })
  .refine(
    (value) =>
      value.browserWindowGeometryVerified ||
      value.dismissCandidates.every((candidate) => !candidate.outsideWebContent),
  )
  .refine(
    (value) =>
      !value.browserWindowGeometryVerified || (value.systemWebViewVisible && value.appForeground),
  );
const assertionCodes = [
  "BARO_AUTH_CONTROL_MISSING",
  "BARO_AUTH_SCROLL_MISSING",
  "BARO_AUTH_CONTROL_NOT_HITTABLE",
  "BARO_AUTH_ANONYMOUS_MISSING",
  "BARO_AUTH_PROVIDERS_MISSING",
  "BARO_AUTH_ERROR_STATE",
  "BARO_AUTH_UNEXPECTED_CONSENT",
  "BARO_AUTH_UNEXPECTED_SESSION",
  "BARO_AUTH_STILL_AUTHORIZING",
  "BARO_AUTH_HOME_MISSING",
  "BARO_AUTH_APP_NOT_FOREGROUND",
  "BARO_AUTH_OS_PROMPT_UNRECOGNIZED",
  "BARO_AUTH_SYSTEM_WEBVIEW_MISSING",
  "BARO_AUTH_SYSTEM_CANCEL_MISSING",
  "BARO_AUTH_SYSTEM_DISMISS_MISSING",
  "BARO_AUTH_WEBVIEW_NOT_DISMISSED",
] as const;
export function observeIosAuthCancelFailure(output: string) {
  let lastStage: z.infer<typeof stageSchema> | null = null;
  let status: z.infer<typeof statusSchema> | null = null;
  for (const line of output
    .split(/\r?\n/)
    .filter((line) => line.startsWith("BARO_AUTH_CANCEL_STATUS:"))
    .slice(-3)) {
    try {
      const result = statusSchema.safeParse(
        JSON.parse(line.slice("BARO_AUTH_CANCEL_STATUS:".length)),
      );
      if (result.success) status = result.data;
    } catch {
      /* Only known booleans are retained. */
    }
  }
  for (const line of output
    .split(/\r?\n/)
    .filter((line) => line.startsWith("BARO_AUTH_CANCEL_STAGE:"))
    .slice(-32)) {
    try {
      const result = stageSchema.safeParse(
        JSON.parse(line.slice("BARO_AUTH_CANCEL_STAGE:".length)),
      );
      if (result.success) lastStage = result.data;
    } catch {
      /* Never forward diagnostic text or malformed values. */
    }
  }
  const code = output.match(
    /XCTAssert[A-Za-z]+ failed[^\r\n]*? - (BARO_AUTH_[A-Z0-9_]+)(?:[^A-Z0-9_]|$)/,
  )?.[1];
  return {
    lastStage,
    status,
    assertionCode: assertionCodes.find((value) => value === code) ?? null,
  };
}
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const iosAuthCancelBaseSchema = iosColdLaunchReceiptSchema.pick({
  version: true,
  binarySourceSha: true,
  toolingSourceSha: true,
  observedAt: true,
  applicationId: true,
  archiveSha256: true,
  compilerReceiptSha256: true,
  device: true,
  requiresMetro: true,
  metroStarted: true,
  metroGuardRequests: true,
  anonymousFreshInstall: true,
  nativeProcessLaunchVerified: true,
  accessibilityVerified: true,
  productJourneysVerified: true,
  remoteApiVerified: true,
  oauthVerified: true,
  physicalDeviceVerified: true,
  storeSigned: true,
  deployed: true,
});
export const iosAuthCancelReceiptSchema = iosAuthCancelBaseSchema.extend({
  kind: z.literal("ios-bundled-anonymous-auth-cancellation"),
  swiftTestSha256: digest,
  projectGeneratorSha256: digest,
  projectGeneratorVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  explicitScreenshotsSuppressedBeforeNavigation: z.literal(true),
  hostRawCommandLogsPersistedAfterBoundary: z.literal(false),
  rawXcresultExported: z.literal(false),
  rawUiHierarchyExported: z.literal(false),
  uiTestRunnerCompiled: z.literal(true),
  productRecompiled: z.literal(false),
  productResigned: z.literal(false),
  result: iosAuthCancelResultSchema,
});
export function verifyIosAuthCancelReceipt(value: unknown, baselineValue: unknown) {
  const result = iosAuthCancelReceiptSchema.parse(value),
    baseline = iosColdLaunchReceiptSchema.parse(baselineValue);
  for (const key of [
    "binarySourceSha",
    "toolingSourceSha",
    "archiveSha256",
    "compilerReceiptSha256",
  ] as const)
    if (result[key] !== baseline[key]) throw Error("INTERNAL_IOS_AUTH_IDENTITY_MISMATCH");
  if (JSON.stringify(result.device) !== JSON.stringify(baseline.device))
    throw Error("INTERNAL_IOS_AUTH_IDENTITY_MISMATCH");
  return result;
}
export async function runIosAuthCancelUiTest(context: {
  root: string;
  owned: string;
  device: string;
  command: (args: string[], cwd?: string, timeout?: number) => Promise<string>;
}) {
  if (
    process.platform !== "darwin" ||
    process.env.GITHUB_ACTIONS !== "true" ||
    !/^[a-f0-9-]{36}$/i.test(context.device) ||
    !/^owned-[a-f0-9-]{36}$/i.test(basename(context.owned)) ||
    resolve(context.owned, "..") !== resolve(context.root, ".wrangler/mobile-internal-ios-reverify")
  )
    throw Error("INTERNAL_IOS_AUTH_OWNED_MAC_CI_REQUIRED");
  const project = resolve(context.owned, "auth-cancel-ui-test");
  await mkdir(project);
  try {
    const swift = await readFile(resolve(import.meta.dir, "mobile-ios-ui/AuthCancelUITests.swift")),
      ruby = await readFile(resolve(import.meta.dir, "mobile-ios-ui/create-project.rb"));
    // Reuse the existing standalone runner target; the test class/selector is distinct.
    await writeFile(resolve(project, "HomeUITests.swift"), swift, { flag: "wx" });
    await writeFile(resolve(project, "create-project.rb"), ruby, { flag: "wx" });
    const generated = await context.command(["ruby", "create-project.rb"], project),
      version = generated.match(/^BARO_XCODEPROJ_VERSION:(\d+\.\d+\.\d+)$/m)?.[1];
    if (!version) throw Error("INTERNAL_IOS_UI_TEST_GENERATOR_VERSION_REQUIRED");
    const output = await context.command(
      [
        "xcodebuild",
        "test",
        "-project",
        resolve(project, "BaroHomeUI.xcodeproj"),
        "-scheme",
        "BaroHomeUITests",
        "-configuration",
        "Debug",
        "-sdk",
        "iphonesimulator",
        "-destination",
        `id=${context.device}`,
        "-derivedDataPath",
        resolve(project, "build"),
        "-resultBundlePath",
        resolve(project, "private-results.xcresult"),
        "-parallel-testing-enabled",
        "NO",
        "-testLanguage",
        "en",
        "-testRegion",
        "US",
        "-only-testing:BaroHomeUITests/BaroAuthCancelUITests/testAnonymousProviderBrowserCancellation",
        ...xcodeSimulatorControlArguments,
      ],
      project,
      900000,
    );
    const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
    return {
      swiftTestSha256: hash(swift),
      projectGeneratorSha256: hash(ruby),
      projectGeneratorVersion: version,
      result: parseIosAuthCancelResult(output),
    };
  } finally {
    // Private XCTest logs/results never enter the artifact directory, including on failure.
    await rm(project, { recursive: true, force: true });
  }
}
