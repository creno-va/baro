import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { z } from "zod";
import { iosColdLaunchReceiptSchema } from "./mobile-internal-ios-input";
import { iosAuthCancelBaseSchema } from "./mobile-ios-auth-cancel";
import { xcodeSimulatorControlArguments } from "./mobile-ios-xcode-control";

export const iosDirectoryResultSchema = z.strictObject({
  kind: z.literal("ios-public-directory-keyboard-rotation"),
  applicationId: z.literal("site.baro.app.preview"),
  initialReadyState: z.enum(["empty", "cards"]),
  inputFullyHittable: z.literal(true),
  keyboardObserved: z.literal(true),
  focusedInputAboveKeyboard: z.literal(true),
  syntheticAsciiInputRetained: z.literal(true),
  searchSubmittedByKeyboard: z.literal(true),
  keyboardDismissed: z.literal(true),
  filteredEmptyStateObserved: z.literal(true),
  landscapeWindowObserved: z.literal(true),
  landscapeInputRetained: z.literal(true),
  landscapeInputFullyHittable: z.literal(true),
  portraitWindowObserved: z.literal(true),
  portraitInputRetained: z.literal(true),
  portraitInputFullyHittable: z.literal(true),
  homeReturnObserved: z.literal(true),
  publicDataNavigation: z.literal(true),
  profileOpened: z.literal(false),
  contactOpened: z.literal(false),
  remoteMutationPerformed: z.literal(false),
  authenticationNavigation: z.literal(false),
  privateDataAccess: z.literal(false),
  koreanKeyboardVerified: z.literal(false),
  voiceOverVerified: z.literal(false),
  httpTransportSeparatelyObserved: z.literal(false),
});
export function parseIosDirectoryResult(output: string) {
  const prefix = "BARO_DIRECTORY_UI_RESULT:";
  const lines = output.split(/\r?\n/).filter((line) => line.startsWith(prefix));
  const line = lines[0];
  if (lines.length !== 1 || !line) throw Error("INTERNAL_IOS_DIRECTORY_RESULT_REQUIRED");
  return iosDirectoryResultSchema.parse(JSON.parse(line.slice(prefix.length)));
}
const assertionCodes = [
  "BARO_DIRECTORY_HOME_MISSING",
  "BARO_DIRECTORY_FOREGROUND_MISSING",
  "BARO_DIRECTORY_CONTROL_MISSING",
  "BARO_DIRECTORY_CONTROL_NOT_HITTABLE",
  "BARO_DIRECTORY_SCROLL_MISSING",
  "BARO_DIRECTORY_READY_MISSING",
  "BARO_DIRECTORY_INPUT_MISSING",
  "BARO_DIRECTORY_KEYBOARD_MISSING",
  "BARO_DIRECTORY_INPUT_OCCLUDED",
  "BARO_DIRECTORY_INPUT_NOT_RETAINED",
  "BARO_DIRECTORY_TYPED_INPUT_MISMATCH",
  "BARO_DIRECTORY_LANDSCAPE_INPUT_MISMATCH",
  "BARO_DIRECTORY_PORTRAIT_INPUT_MISMATCH",
  "BARO_DIRECTORY_KEYBOARD_NOT_DISMISSED",
  "BARO_DIRECTORY_SEARCH_EMPTY_MISSING",
  "BARO_DIRECTORY_LANDSCAPE_MISSING",
  "BARO_DIRECTORY_PORTRAIT_MISSING",
  "BARO_DIRECTORY_BACK_MISSING",
  "BARO_DIRECTORY_HOME_RETURN_MISSING",
] as const;
const inputStatusSchema = z.strictObject({
  stage: z.enum([
    "before-input",
    "after-input",
    "typed-check",
    "landscape-check",
    "portrait-check",
  ]),
  inputState: z.enum([
    "empty",
    "literal",
    "sentence-capitalized",
    "prefix",
    "other",
    "unavailable",
  ]),
  appForeground: z.boolean(),
  keyboardObserved: z.boolean(),
});
export function observeIosDirectoryFailure(output: string) {
  let status: z.infer<typeof inputStatusSchema> | null = null;
  const prefix = "BARO_DIRECTORY_UI_STATUS:";
  for (const line of output
    .split(/\r?\n/)
    .filter((line) => line.startsWith(prefix))
    .slice(-8)) {
    try {
      const parsed = inputStatusSchema.safeParse(JSON.parse(line.slice(prefix.length)));
      if (parsed.success) status = parsed.data;
    } catch {
      /* Discard all malformed or unknown text. */
    }
  }
  const code = output.match(
    /XCTAssert[A-Za-z]+ failed[^\r\n]*? - (BARO_DIRECTORY_[A-Z0-9_]+)(?:[^A-Z0-9_]|$)/,
  )?.[1];
  return { status, assertionCode: assertionCodes.find((value) => value === code) ?? null };
}
export const iosDirectoryBaseSchema = iosAuthCancelBaseSchema;
export const iosDirectoryReceiptSchema = iosDirectoryBaseSchema.extend({
  kind: z.literal("ios-bundled-public-directory-input-observation"),
  swiftTestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  projectGeneratorSha256: z.string().regex(/^[a-f0-9]{64}$/),
  projectGeneratorVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  explicitScreenshotsSuppressedBeforeNavigation: z.literal(true),
  hostRawCommandLogsPersistedAfterBoundary: z.literal(false),
  rawXcresultExported: z.literal(false),
  rawUiHierarchyExported: z.literal(false),
  uiTestRunnerCompiled: z.literal(true),
  productRecompiled: z.literal(false),
  productResigned: z.literal(false),
  result: iosDirectoryResultSchema,
});
export function verifyIosDirectoryReceipt(value: unknown, baselineValue: unknown) {
  const result = iosDirectoryReceiptSchema.parse(value),
    baseline = iosColdLaunchReceiptSchema.parse(baselineValue);
  for (const key of [
    "binarySourceSha",
    "toolingSourceSha",
    "archiveSha256",
    "compilerReceiptSha256",
  ] as const)
    if (result[key] !== baseline[key]) throw Error("INTERNAL_IOS_DIRECTORY_IDENTITY_MISMATCH");
  if (JSON.stringify(result.device) !== JSON.stringify(baseline.device))
    throw Error("INTERNAL_IOS_DIRECTORY_IDENTITY_MISMATCH");
  return result;
}
export async function runIosDirectoryUiTest(context: {
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
    throw Error("INTERNAL_IOS_DIRECTORY_OWNED_MAC_CI_REQUIRED");
  const project = resolve(context.owned, "directory-ui-test");
  await mkdir(project);
  try {
    const swift = await readFile(resolve(import.meta.dir, "mobile-ios-ui/DirectoryUITests.swift")),
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
        "-only-testing:BaroHomeUITests/BaroDirectoryUITests/testPublicDirectoryKeyboardAndRotation",
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
      result: parseIosDirectoryResult(output),
    };
  } finally {
    // Private XCTest logs/results never enter the artifact directory, including on failure.
    await rm(project, { recursive: true, force: true });
  }
}
