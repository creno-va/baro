import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { internalIosEnvironment } from "./mobile-internal-ios-build";
import { observeIosKoreanDirectoryFailure } from "./mobile-ios-directory-ui";
import { observeHomeUiFailure } from "./mobile-ios-home-ui-test";
import { xcodeSimulatorControlArguments } from "./mobile-ios-xcode-control";

// This is a public OS Settings reference on a newly created CI Simulator, not a
// sanitizer for arbitrary UI text. Product/account screens must never enter it.
export const keyboardSettingsReferenceResultSchema = z.strictObject({
  kind: z.literal("ios-owned-korean-settings-control-reference-only"),
  screen: z.literal("Korean"),
  doneObserved: z.literal(true),
  controls: z
    .array(
      z.strictObject({
        kind: z.enum(["cell", "button", "static-text"]),
        label: z
          .string()
          .min(1)
          .max(160)
          .refine((s) => !/[<>@]|https?:\/\//i.test(s)),
      }),
    )
    .min(1)
    .max(32),
  layoutSelected: z.literal(false),
  productInputVerified: z.literal(false),
  koreanKeyboardVerified: z.literal(false),
  rawHierarchyExported: z.literal(false),
  rawValuesExported: z.literal(false),
  screenshotsExported: z.literal(false),
  rawXcresultExported: z.literal(false),
});
export function parseKeyboardSettingsReference(output: string) {
  const lines = output
    .split(/\r?\n/)
    .filter((s) => s.startsWith("BARO_KEYBOARD_REFERENCE_RESULT:"));
  if (lines.length !== 1 || !lines[0]) throw Error("IOS_KEYBOARD_REFERENCE_SINGLE_RESULT_REQUIRED");
  return keyboardSettingsReferenceResultSchema.parse(
    JSON.parse(lines[0].slice("BARO_KEYBOARD_REFERENCE_RESULT:".length)),
  );
}
export function assertKeyboardReferenceProductAbsent(apps: unknown) {
  if (
    !apps ||
    typeof apps !== "object" ||
    Array.isArray(apps) ||
    Object.keys(apps).some((id) => id === "site.baro.app" || id.startsWith("site.baro.app."))
  )
    throw Error("IOS_KEYBOARD_REFERENCE_PRODUCT_MUST_BE_ABSENT");
}
export async function decodeKeyboardReferenceAppInventory(
  raw: string,
  convertPlist: (raw: string) => Promise<string>,
) {
  if (raw.length > 4_000_000) throw Error("IOS_KEYBOARD_REFERENCE_INVENTORY_BOUND");
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    /* simctl also emits OpenStep plist. */
  }
  const json = await convertPlist(raw);
  if (json.length > 4_000_000) throw Error("IOS_KEYBOARD_REFERENCE_INVENTORY_BOUND");
  return JSON.parse(json) as unknown;
}
export function observeKeyboardReferenceFailure(output: string) {
  const observed = output.match(
    /failed[^\r\n]*? - (BARO_KEYBOARD_REFERENCE_[A-Z_]+)(?:[^A-Z_]|$)/,
  )?.[1];
  const known = [
    "BARO_KEYBOARD_REFERENCE_SCOPE_MISSING",
    "BARO_KEYBOARD_REFERENCE_BOUND_EXCEEDED",
    "BARO_KEYBOARD_REFERENCE_LABEL_BOUND_EXCEEDED",
    "BARO_KEYBOARD_REFERENCE_CHOICES_MISSING",
  ];
  const compiler = observeHomeUiFailure(output);
  return {
    assertionCode: known.find((v) => v === observed) ?? null,
    swiftCompilationFailure: compiler.swiftCompilationFailure,
    testHostConfigurationFailure: compiler.testHostConfigurationFailure,
    signingFailure: compiler.signingFailure,
    runnerLaunchFailure: compiler.runnerLaunchFailure,
  };
}
export const keyboardReferenceTestSelector =
  "-only-testing:BaroHomeUITests/BaroDirectoryUITests/testKoreanLayoutReference";
async function main() {
  if (
    process.platform !== "darwin" ||
    process.env.GITHUB_ACTIONS !== "true" ||
    process.argv.length !== 2
  )
    throw Error("IOS_KEYBOARD_REFERENCE_FRESH_MAC_CI_REQUIRED");
  const root = process.cwd(),
    env = internalIosEnvironment(process.env),
    source = env.TARGET_SHA!,
    base = resolve(root, ".wrangler/mobile-ios-keyboard-reference"),
    owned = resolve(base, `owned-${randomUUID()}`),
    hash = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");
  for (const name of ["receipt.json", "failure.json", "cleanup.json"])
    if (await Bun.file(resolve(base, name)).exists())
      throw Error("IOS_KEYBOARD_REFERENCE_FRESH_OUTPUT_REQUIRED");
  await mkdir(owned, { recursive: true });
  let device: string | undefined,
    phase = "source",
    exitCode: number | null = null,
    timedOut = false,
    lastOutput = "";
  async function command(args: string[], cwd = root, timeout = 120000, input?: string) {
    timedOut = false;
    const child = Bun.spawn(args, {
      cwd,
      env,
      stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeout);
    try {
      const [out, err] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      exitCode = await child.exited;
      lastOutput = out + "\n" + err;
      if (exitCode !== 0 || timedOut) throw Error("IOS_KEYBOARD_REFERENCE_COMMAND_FAILED");
      return out;
    } finally {
      clearTimeout(timer);
    }
  }
  let output = "",
    acceptedReceipt: Record<string, unknown> | undefined;
  try {
    if ((await command(["git", "rev-parse", "HEAD"])).trim() !== source)
      throw Error("IOS_KEYBOARD_REFERENCE_SOURCE_MISMATCH");
    await command(["git", "diff", "--quiet", "HEAD"]);
    await command(["git", "merge-base", "--is-ancestor", source, "origin/main"]);
    phase = "owned-simulator";
    const runtimes = JSON.parse(await command(["xcrun", "simctl", "list", "runtimes", "--json"]))
      .runtimes as { identifier: string; version: string; isAvailable: boolean }[];
    const types = JSON.parse(await command(["xcrun", "simctl", "list", "devicetypes", "--json"]))
      .devicetypes as { identifier: string; name: string }[];
    const runtime = runtimes.filter((r) => r.isAvailable && r.identifier.includes(".iOS-")).at(-1),
      type = types.find((t) => t.name === "iPhone 16");
    if (!runtime || !type) throw Error("IOS_KEYBOARD_REFERENCE_RUNTIME_REQUIRED");
    const name = `baro_keyboard_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    device = (
      await command(["xcrun", "simctl", "create", name, type.identifier, runtime.identifier])
    ).trim();
    if (!/^[a-f0-9-]{36}$/i.test(device))
      throw Error("IOS_KEYBOARD_REFERENCE_OWNED_DEVICE_REQUIRED");
    await command(["xcrun", "simctl", "boot", device]);
    await command(["xcrun", "simctl", "bootstatus", device, "-b"], root, 240000);
    const inventory = JSON.parse(await command(["xcrun", "simctl", "list", "devices", "--json"]))
      .devices as Record<string, { udid: string; name: string; state: string }[]>;
    const matches = Object.values(inventory)
      .flat()
      .filter((d) => d.udid === device);
    if (matches.length !== 1 || matches[0]?.name !== name || matches[0]?.state !== "Booted")
      throw Error("IOS_KEYBOARD_REFERENCE_OWNED_DEVICE_REQUIRED");
    phase = "product-absence-before";
    assertKeyboardReferenceProductAbsent(
      await decodeKeyboardReferenceAppInventory(
        await command(["xcrun", "simctl", "listapps", device]),
        (raw) => command(["plutil", "-convert", "json", "-o", "-", "--", "-"], root, 120000, raw),
      ),
    );
    phase = "runner-project";
    const parts = await Promise.all(
      [
        "DirectoryUITests.swift",
        "DirectoryKoreanUITests.swift",
        "KeyboardSettingsReferenceUITests.swift",
      ].map((name) => readFile(resolve(root, "scripts/mobile-ios-ui", name), "utf8")),
    );
    const swift = parts.join("\n"),
      ruby = await readFile(resolve(root, "scripts/mobile-ios-ui/create-project.rb"));
    await writeFile(resolve(owned, "HomeUITests.swift"), swift, { flag: "wx" });
    await writeFile(resolve(owned, "create-project.rb"), ruby, { flag: "wx" });
    const generated = await command(["ruby", "create-project.rb"], owned),
      version = generated.match(/^BARO_XCODEPROJ_VERSION:(\d+\.\d+\.\d+)$/m)?.[1];
    if (!version) throw Error("IOS_KEYBOARD_REFERENCE_GENERATOR_REQUIRED");
    phase = "settings-reference-xcuitest";
    output = await command(
      [
        "xcodebuild",
        "test",
        "-project",
        resolve(owned, "BaroHomeUI.xcodeproj"),
        "-scheme",
        "BaroHomeUITests",
        "-configuration",
        "Debug",
        "-sdk",
        "iphonesimulator",
        "-destination",
        `id=${device}`,
        "-derivedDataPath",
        resolve(owned, "build"),
        "-resultBundlePath",
        resolve(owned, "private-results.xcresult"),
        "-parallel-testing-enabled",
        "NO",
        "-testLanguage",
        "en",
        "-testRegion",
        "US",
        keyboardReferenceTestSelector,
        ...xcodeSimulatorControlArguments,
      ],
      owned,
      900000,
    );
    const result = parseKeyboardSettingsReference(output);
    phase = "product-absence-after";
    assertKeyboardReferenceProductAbsent(
      await decodeKeyboardReferenceAppInventory(
        await command(["xcrun", "simctl", "listapps", device]),
        (raw) => command(["plutil", "-convert", "json", "-o", "-", "--", "-"], root, 120000, raw),
      ),
    );
    acceptedReceipt = {
      version: 1,
      kind: "ios-keyboard-settings-reference-receipt",
      toolingSourceSha: source,
      observedAt: new Date().toISOString(),
      device: { kind: "owned-simulator", model: type.name, osVersion: runtime.version },
      swiftTestSha256: hash(swift),
      projectGeneratorSha256: hash(ruby),
      projectGeneratorVersion: version,
      productAbsentBeforeAndAfter: true,
      productCompiled: false,
      productInstalled: false,
      referenceAppInstalled: false,
      uiTestRunnerCompiled: true,
      operatorAccountEntered: false,
      commandLogsExported: false,
      screenshotsExported: false,
      rawXcresultExported: false,
      productInputVerified: false,
      physicalDeviceVerified: false,
      result,
    };
  } catch (error) {
    await writeFile(
      resolve(base, "failure.json"),
      JSON.stringify(
        {
          toolingSourceSha: source,
          phase,
          code:
            error instanceof Error && /^IOS_KEYBOARD_REFERENCE_[A-Z_]+$/.test(error.message)
              ? error.message
              : "IOS_KEYBOARD_REFERENCE_FAILED",
          exitCode,
          timedOut,
          settingsFailure: observeIosKoreanDirectoryFailure(
            phase === "settings-reference-xcuitest" ? lastOutput : "",
          ),
          runnerFailure: observeKeyboardReferenceFailure(
            phase === "settings-reference-xcuitest" ? lastOutput : "",
          ),
          rawCommandLogsExported: false,
          screenshotsExported: false,
          rawXcresultExported: false,
          productInputVerified: false,
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
    process.exitCode = 1;
    console.log("IOS_KEYBOARD_SETTINGS_REFERENCE_FAILED");
  } finally {
    let simulatorDeleted = device === undefined,
      privateResultsRemoved = false;
    if (device && /^[a-f0-9-]{36}$/i.test(device)) {
      await command(["xcrun", "simctl", "shutdown", device]).catch(() => {});
      try {
        await command(["xcrun", "simctl", "delete", device]);
        simulatorDeleted = true;
      } catch {
        /* Recorded below, never export command text. */
      }
    }
    try {
      await rm(owned, { recursive: true, force: true });
      privateResultsRemoved = true;
    } catch {
      /* Keep cleanup failure separate from the original test failure. */
    }
    await writeFile(
      resolve(base, "cleanup.json"),
      JSON.stringify(
        {
          version: 1,
          toolingSourceSha: source,
          observedAt: new Date().toISOString(),
          simulatorDeleted,
          privateResultsRemoved,
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
    if (!simulatorDeleted || !privateResultsRemoved) process.exitCode = 1;
    if (acceptedReceipt && simulatorDeleted && privateResultsRemoved) {
      await writeFile(
        resolve(base, "receipt.json"),
        JSON.stringify({ ...acceptedReceipt, simulatorDeleted, privateResultsRemoved }, null, 2) +
          "\n",
        { flag: "wx" },
      );
      console.log("IOS_KEYBOARD_SETTINGS_REFERENCE_RECORDED_PRODUCT_INPUT_UNVERIFIED");
    }
  }
}
if (import.meta.main)
  main().catch(() => {
    process.exitCode = 1;
    console.log("IOS_KEYBOARD_REFERENCE_BOOTSTRAP_FAILED");
  });
