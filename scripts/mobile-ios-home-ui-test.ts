import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { z } from "zod";
import { iosColdLaunchReceiptSchema, iosLargeFontReceiptSchema } from "./mobile-internal-ios-input";
import { iosLargestContentSize, verifyIosContentSizeReadback } from "./mobile-ios-ui-capabilities";
import { xcodeSimulatorControlArguments } from "./mobile-ios-xcode-control";

export const homeGuideUiResultSchema = z.strictObject({
  kind: z.literal("ios-anonymous-home-guide-xcuitest"),
  applicationId: z.literal("site.baro.app.preview"),
  homeSwipes: z.number().int().min(1).max(24),
  guideSwipes: z.number().int().min(0).max(24),
  homeTitleObserved: z.literal(true),
  guideButtonFullyHittable: z.literal(true),
  guideTapVerified: z.literal(true),
  guideTitleObserved: z.literal(true),
  returnButtonFullyHittable: z.literal(true),
  returnTapVerified: z.literal(true),
  homeReturnObserved: z.literal(true),
  publicDataNavigation: z.literal(false),
  authenticationNavigation: z.literal(false),
  privateDataAccess: z.literal(false),
});
export function parseHomeGuideUiResult(output: string) {
  const lines = output.split(/\r?\n/).filter((s) => s.startsWith("BARO_HOME_UI_RESULT:"));
  const line = lines[0];
  if (lines.length !== 1 || !line) throw Error("INTERNAL_IOS_UI_TEST_SINGLE_RESULT_REQUIRED");
  return homeGuideUiResultSchema.parse(JSON.parse(line.slice("BARO_HOME_UI_RESULT:".length)));
}
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const iosHomeUiReceiptSchema = iosColdLaunchReceiptSchema
  .pick({
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
    accessibilityVerified: true,
    productJourneysVerified: true,
    remoteApiVerified: true,
    oauthVerified: true,
    physicalDeviceVerified: true,
    storeSigned: true,
    deployed: true,
  })
  .extend({
    kind: z.literal("ios-bundled-large-font-home-guide-ui-observation"),
    contentSizeBeforeTest: z.literal(iosLargestContentSize),
    contentSizeAfterTest: z.literal(iosLargestContentSize),
    swiftTestSha256: digest,
    projectGeneratorSha256: digest,
    projectGeneratorVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    productRecompiled: z.literal(false),
    productResigned: z.literal(false),
    uiTestRunnerCompiled: z.literal(true),
    rawUiHierarchyExported: z.literal(false),
    rawXcresultExported: z.literal(false),
    result: homeGuideUiResultSchema,
  });
export function verifyIosHomeUiReceipt(
  value: unknown,
  baselineValue: unknown,
  largeValue: unknown,
) {
  const result = iosHomeUiReceiptSchema.parse(value),
    baseline = iosColdLaunchReceiptSchema.parse(baselineValue),
    large = iosLargeFontReceiptSchema.parse(largeValue);
  for (const proof of [baseline, large]) {
    if (
      result.binarySourceSha !== proof.binarySourceSha ||
      result.toolingSourceSha !== proof.toolingSourceSha ||
      result.archiveSha256 !== proof.archiveSha256 ||
      result.compilerReceiptSha256 !== proof.compilerReceiptSha256 ||
      JSON.stringify(result.device) !== JSON.stringify(proof.device)
    )
      throw Error("INTERNAL_IOS_UI_TEST_IDENTITY_MISMATCH");
  }
  return result;
}
export async function runIosHomeUiTest(context: {
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
    throw Error("INTERNAL_IOS_UI_TEST_OWNED_MAC_CI_REQUIRED");
  const { command, device } = context,
    project = resolve(context.owned, "home-ui-test");
  await mkdir(project);
  const swift = await readFile(resolve(import.meta.dir, "mobile-ios-ui/HomeUITests.swift")),
    ruby = await readFile(resolve(import.meta.dir, "mobile-ios-ui/create-project.rb"));
  await writeFile(resolve(project, "HomeUITests.swift"), swift, { flag: "wx" });
  await writeFile(resolve(project, "create-project.rb"), ruby, { flag: "wx" });
  const generated = await command(["ruby", "create-project.rb"], project),
    version = generated.match(/^BARO_XCODEPROJ_VERSION:(\d+\.\d+\.\d+)$/m)?.[1];
  if (!version) throw Error("INTERNAL_IOS_UI_TEST_GENERATOR_VERSION_REQUIRED");
  const before = verifyIosContentSizeReadback(
    await command(["xcrun", "simctl", "ui", device, "content_size"]),
  );
  const output = await command(
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
      `id=${device}`,
      "-derivedDataPath",
      resolve(project, "build"),
      "-resultBundlePath",
      resolve(project, "private-results.xcresult"),
      "-parallel-testing-enabled",
      "NO",
      "-test-iterations",
      "1",
      "-only-testing:BaroHomeUITests/BaroHomeUITests/testLargestFontHomeAndGuide",
      ...xcodeSimulatorControlArguments,
    ],
    project,
    900000,
  );
  const result = parseHomeGuideUiResult(output),
    after = verifyIosContentSizeReadback(
      await command(["xcrun", "simctl", "ui", device, "content_size"]),
    ),
    hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  return {
    contentSizeBeforeTest: before,
    contentSizeAfterTest: after,
    swiftTestSha256: hash(swift),
    projectGeneratorSha256: hash(ruby),
    projectGeneratorVersion: version,
    result,
  };
}

const assertionCodes = [
  "BARO_STATIC_CONTROL_MISSING",
  "BARO_SCROLL_CONTAINER_MISSING",
  "BARO_STATIC_CONTROL_NOT_FULLY_HITTABLE",
  "BARO_APP_NOT_FOREGROUND",
  "BARO_HOME_MISSING",
  "BARO_CONFIGURATION_ERROR",
  "BARO_LARGE_FONT_SCROLL_NOT_OBSERVED",
  "BARO_GUIDE_MISSING",
  "BARO_HOME_RETURN_MISSING",
  "BARO_GUIDE_STILL_VISIBLE",
] as const;
export function observeHomeUiFailure(detail: string) {
  const reported = detail.match(
    /XCTAssert[A-Za-z]+ failed[^\r\n]*? - (BARO_[A-Z0-9_]+)(?:[^A-Z0-9_]|$)/,
  )?.[1];
  return {
    assertionCode: assertionCodes.find((code) => code === reported) ?? null,
    swiftCompilationFailure:
      /(?:SwiftCompile|SwiftEmitModule).*failed|emit-module command failed/.test(detail),
    projectGeneratorUnavailable: /cannot load such file -- xcodeproj/.test(detail),
    signingFailure:
      /requires a development team|No signing certificate|requires a provisioning profile/.test(
        detail,
      ),
    runnerLaunchFailure:
      /Failed to launch.*(?:Runner|xctrunner)|Failed to establish communication with the test runner/.test(
        detail,
      ),
  };
}
