import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { z } from "zod";
import { iosColdLaunchReceiptSchema } from "./mobile-internal-ios-input";
import { iosAuthCancelBaseSchema } from "./mobile-ios-auth-cancel";
import { inputSignatureSchema } from "./mobile-ios-directory-ui";
import { xcodeSimulatorControlArguments } from "./mobile-ios-xcode-control";

export function inputReferenceSignatureSource(swift: string) {
  const start = "// BARO_DIRECTORY_SIGNATURE_BEGIN\n",
    end = "// BARO_DIRECTORY_SIGNATURE_END";
  if (swift.split(start).length !== 2 || swift.split(end).length !== 2)
    throw Error("INTERNAL_IOS_REFERENCE_SIGNATURE_SOURCE_REQUIRED");
  const section = swift.split(start)[1]?.split(end)[0];
  if (!section?.trim().startsWith("private func directoryInputSignature("))
    throw Error("INTERNAL_IOS_REFERENCE_SIGNATURE_SOURCE_REQUIRED");
  return section;
}
export const iosInputReferenceResultSchema = z
  .strictObject({
    kind: z.literal("ios-uikit-single-input-reference-only"),
    applicationId: z.literal("site.baro.test.input-reference"),
    observationCompleted: z.literal(true),
    initiallyEmpty: z.literal(true),
    keyboardObserved: z.literal(true),
    inputAboveKeyboard: z.literal(true),
    typeTextCalls: z.literal(1),
    pastePerformed: z.literal(false),
    typingSpeedChanged: z.literal(false),
    normalizationApplied: z.literal(false),
    accessibilitySignature: inputSignatureSchema,
    nativeSignature: inputSignatureSchema,
    signaturesAgree: z.boolean(),
    nativeChangeEvents: z.number().int().min(0).max(100),
    productInputVerified: z.literal(false),
    rootCauseConfirmed: z.literal(false),
    rawInputExported: z.literal(false),
    koreanKeyboardVerified: z.literal(false),
  })
  .refine(
    (v) =>
      v.signaturesAgree ===
      (
        Object.keys(inputSignatureSchema.shape) as (keyof typeof inputSignatureSchema.shape)[]
      ).every((key) => v.accessibilitySignature[key] === v.nativeSignature[key]),
  );
export function parseIosInputReferenceResult(output: string) {
  const prefix = "BARO_INPUT_REFERENCE_RESULT:",
    lines = output.split(/\r?\n/).filter((line) => line.startsWith(prefix));
  if (lines.length !== 1 || !lines[0]) throw Error("INTERNAL_IOS_REFERENCE_RESULT_REQUIRED");
  return iosInputReferenceResultSchema.parse(JSON.parse(lines[0].slice(prefix.length)));
}
const assertionCodes = [
  "BARO_REFERENCE_FOREGROUND_MISSING",
  "BARO_REFERENCE_INPUT_MISSING",
  "BARO_REFERENCE_KEYBOARD_MISSING",
  "BARO_REFERENCE_INPUT_OCCLUDED",
  "BARO_REFERENCE_INITIAL_INPUT_NOT_EMPTY",
  "BARO_REFERENCE_NATIVE_OBSERVER_MISSING",
  "BARO_REFERENCE_NATIVE_OBSERVER_INVALID",
] as const;
export function observeIosInputReferenceFailure(output: string) {
  const code =
    output.match(
      /XCTAssert[A-Za-z]+ failed[^\r\n]*? - (BARO_REFERENCE_[A-Z0-9_]+)(?:[^A-Z0-9_]|$)/,
    )?.[1] ??
    output.match(/failed[^\r\n]*? - (BARO_REFERENCE_NATIVE_OBSERVER_INVALID)(?:[^A-Z0-9_]|$)/)?.[1];
  return { assertionCode: assertionCodes.find((value) => value === code) ?? null };
}
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const iosInputReferenceReceiptSchema = iosAuthCancelBaseSchema.extend({
  kind: z.literal("ios-bundled-home-with-separate-uikit-input-reference"),
  referenceAppSourceSha256: digest,
  swiftTestSha256: digest,
  signatureSourceSha256: digest,
  projectGeneratorSha256: digest,
  projectGeneratorVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  referenceAppAndRunnerCompiled: z.literal(true),
  productRecompiled: z.literal(false),
  productResigned: z.literal(false),
  productDirectoryNavigated: z.literal(false),
  explicitScreenshotsSuppressedBeforeReference: z.literal(true),
  hostRawCommandLogsPersistedAfterBoundary: z.literal(false),
  rawXcresultExported: z.literal(false),
  rawUiHierarchyExported: z.literal(false),
  result: iosInputReferenceResultSchema,
});
export function verifyIosInputReferenceReceipt(value: unknown, baselineValue: unknown) {
  const result = iosInputReferenceReceiptSchema.parse(value),
    baseline = iosColdLaunchReceiptSchema.parse(baselineValue);
  for (const key of [
    "binarySourceSha",
    "toolingSourceSha",
    "archiveSha256",
    "compilerReceiptSha256",
  ] as const)
    if (result[key] !== baseline[key]) throw Error("INTERNAL_IOS_REFERENCE_IDENTITY_MISMATCH");
  if (JSON.stringify(result.device) !== JSON.stringify(baseline.device))
    throw Error("INTERNAL_IOS_REFERENCE_IDENTITY_MISMATCH");
  return result;
}
export async function runIosInputReference(context: {
  root: string;
  owned: string;
  device: string;
  captureSuppressed: boolean;
  command: (args: string[], cwd?: string, timeout?: number) => Promise<string>;
}) {
  if (
    process.platform !== "darwin" ||
    process.env.GITHUB_ACTIONS !== "true" ||
    !context.captureSuppressed ||
    !/^[a-f0-9-]{36}$/i.test(context.device) ||
    !/^owned-[a-f0-9-]{36}$/i.test(basename(context.owned)) ||
    resolve(context.owned, "..") !== resolve(context.root, ".wrangler/mobile-internal-ios-reverify")
  )
    throw Error("INTERNAL_IOS_REFERENCE_OWNED_MAC_CI_REQUIRED");
  const project = resolve(context.owned, "input-reference");
  await mkdir(project);
  try {
    const source = resolve(import.meta.dir, "mobile-ios-ui"),
      signature = inputReferenceSignatureSource(
        await readFile(resolve(source, "DirectoryUITests.swift"), "utf8"),
      ),
      app = (await readFile(resolve(source, "InputReferenceApp.swift"), "utf8")).replace(
        "// BARO_INPUT_REFERENCE_SIGNATURE",
        signature,
      ),
      swift = (await readFile(resolve(source, "InputReferenceUITests.swift"), "utf8")).replace(
        "// BARO_INPUT_REFERENCE_SIGNATURE",
        signature,
      ),
      ruby = await readFile(resolve(source, "create-input-reference-project.rb"));
    await writeFile(resolve(project, "InputReferenceApp.swift"), app, { flag: "wx" });
    await writeFile(resolve(project, "InputReferenceUITests.swift"), swift, { flag: "wx" });
    await writeFile(resolve(project, "create-project.rb"), ruby, { flag: "wx" });
    const generated = await context.command(["ruby", "create-project.rb"], project),
      version = generated.match(/^BARO_XCODEPROJ_VERSION:(\d+\.\d+\.\d+)$/m)?.[1];
    if (!version) throw Error("INTERNAL_IOS_UI_TEST_GENERATOR_VERSION_REQUIRED");
    const output = await context.command(
      [
        "xcodebuild",
        "test",
        "-project",
        resolve(project, "BaroInputReference.xcodeproj"),
        "-scheme",
        "BaroInputReferenceTests",
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
        "-only-testing:BaroInputReferenceTests/BaroInputReferenceUITests/testSingleSyntheticInput",
        ...xcodeSimulatorControlArguments,
      ],
      project,
      900000,
    );
    const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
    return {
      referenceAppSourceSha256: hash(app),
      swiftTestSha256: hash(swift),
      signatureSourceSha256: hash(signature),
      projectGeneratorSha256: hash(ruby),
      projectGeneratorVersion: version,
      result: parseIosInputReferenceResult(output),
    };
  } finally {
    await rm(project, { recursive: true, force: true });
  }
}
