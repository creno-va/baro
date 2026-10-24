import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  androidPostBoundaryCommandFailures,
  runAndroidHomeCommand,
} from "./mobile-android-command-observation";
import { observeAndroidPackageReadiness } from "./mobile-android-package-readiness";
import { internalAndroidEnvironment } from "./mobile-internal-android-build";
import {
  androidRuntimeOptions,
  createOwnedAndroidAvd,
  emulatorStartupIssues,
  ownedAndroidPaths,
} from "./mobile-runtime-host";

const component = /^[A-Za-z][A-Za-z0-9_.]*\/[A-Za-z0-9_.$]+$/;
function vendor(id: string) {
  const name = id.split("/")[0];
  return name === "com.google.android.inputmethod.latin"
    ? "google-gboard"
    : name === "com.android.inputmethod.latin"
      ? "aosp-latin"
      : "other";
}
export function assertAndroidImeProductAbsent(packages: string) {
  const rows = packages.trim().split(/\r?\n/);
  if (
    packages.length > 1_000_000 ||
    !rows.length ||
    rows.length > 2048 ||
    rows.some(
      (row) =>
        !/^package:[A-Za-z][A-Za-z0-9_.]*$/.test(row) ||
        /^package:site\.baro\.app(?:\.|$)/.test(row),
    )
  )
    throw Error("ANDROID_IME_REFERENCE_PRODUCT_ABSENCE_REQUIRED");
}
/** Android15 public IME dump metadata only; never run against a user's device. */
export function inspectAndroidImeInventory(raw: string, selected: string) {
  selected = selected.trim();
  if (raw.length > 4_000_000) throw Error("ANDROID_IME_REFERENCE_INVENTORY_BOUND");
  if (!component.test(selected)) throw Error("ANDROID_IME_REFERENCE_DEFAULT_FORMAT_INVALID");
  const lines = raw.trimEnd().split(/\r?\n/),
    starts = lines.flatMap((line, index) =>
      component.test(line.slice(0, -1)) && line.endsWith(":") ? [index] : [],
    );
  if (!starts.length || starts.length > 32 || starts[0] !== 0)
    throw Error("ANDROID_IME_REFERENCE_INVENTORY_INVALID");
  const seen = new Set<string>();
  let allSubtypes = 0;
  const methods = starts.map((start, index) => {
    const header = lines[start];
    if (!header) throw Error("ANDROID_IME_REFERENCE_INVENTORY_INVALID");
    const id = header.slice(0, -1),
      block = lines.slice(start + 1, starts[index + 1] ?? lines.length).join("\n");
    const ids = [...block.matchAll(/\bmId=([^\s]+)/g)],
      totals = [...block.matchAll(/^[ \t]+InputMethodSubtype array: count=(\d+)[ \t]*$/gm)];
    if (totals.length !== 1) throw Error("ANDROID_IME_REFERENCE_SUBTYPE_COUNT_MISSING");
    if (seen.has(id) || ids.length !== 1 || ids[0]?.[1] !== id)
      throw Error("ANDROID_IME_REFERENCE_INVENTORY_INVALID");
    seen.add(id);
    const total = totals[0];
    if (!total) throw Error("ANDROID_IME_REFERENCE_INVENTORY_INVALID");
    const count = Number(total[1]);
    allSubtypes += count;
    if (count > 2048 || allSubtypes > 4096) throw Error("ANDROID_IME_REFERENCE_INVENTORY_BOUND");
    const subtypeText = block.slice(block.indexOf(total[0]) + total[0].length),
      rows = [...subtypeText.matchAll(/^[ \t]+InputMethodSubtype #(\d+):[ \t]*$/gm)];
    if (
      rows.length !== count ||
      subtypeText.slice(0, rows[0]?.index ?? subtypeText.length).trim() !== ""
    )
      throw Error("ANDROID_IME_REFERENCE_SUBTYPE_INCOMPLETE");
    let koreanKeyboardSubtypes = 0;
    for (const [ordinal, row] of rows.entries()) {
      if (Number(row[1]) !== ordinal) throw Error("ANDROID_IME_REFERENCE_SUBTYPE_INCOMPLETE");
      if (row.index === undefined) throw Error("ANDROID_IME_REFERENCE_SUBTYPE_INCOMPLETE");
      const text = subtypeText.slice(
        row.index + row[0].length,
        rows[ordinal + 1]?.index ?? subtypeText.length,
      );
      if (/missing subtype/.test(text)) throw Error("ANDROID_IME_REFERENCE_SUBTYPE_INCOMPLETE");
      function field(name: string) {
        const matches = [...text.matchAll(new RegExp(`\\b${name}=([^\\s]*)`, "g"))];
        const value = matches[0]?.[1];
        if (matches.length !== 1 || value === undefined)
          throw Error("ANDROID_IME_REFERENCE_SUBTYPE_INCOMPLETE");
        if (value.length > 80) throw Error("ANDROID_IME_REFERENCE_INVENTORY_BOUND");
        return value;
      }
      const locale = field("mSubtypeLocale"),
        tag = field("mSubtypeLanguageTag"),
        mode = field("mSubtypeMode");
      if (mode === "keyboard" && [locale, tag].some((v) => /^ko(?:$|[-_])/i.test(v)))
        koreanKeyboardSubtypes++;
    }
    return {
      vendor: vendor(id),
      selectedDefault: id === selected,
      registeredSubtypes: count,
      registeredKoreanKeyboardSubtypes: koreanKeyboardSubtypes,
    };
  });
  if (!seen.has(selected)) throw Error("ANDROID_IME_REFERENCE_DEFAULT_NOT_REGISTERED");
  return {
    methods,
    registeredSubtypeMetadataComplete: true as const,
    rawMetadataExported: false as const,
  };
}
async function main() {
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    process.platform !== "linux" ||
    process.argv.length !== 2
  )
    throw Error("ANDROID_IME_REFERENCE_FRESH_LINUX_CI_REQUIRED");
  const root = process.cwd(),
    env = internalAndroidEnvironment(process.env),
    sdk = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT,
    source = env.TARGET_SHA;
  if (!sdk || !source || !/^[a-f0-9]{40}$/.test(source))
    throw Error("ANDROID_IME_REFERENCE_EXPLICIT_SDK_SOURCE_REQUIRED");
  const base = resolve(root, ".wrangler/mobile-android-ime-reference"),
    owned = resolve(base, `owned-${randomUUID()}`),
    paths = ownedAndroidPaths(owned),
    childEnv = { ...env, ...paths.environment },
    adb = resolve(sdk, "platform-tools/adb"),
    serial = "emulator-5580",
    avd = `baro_runtime_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  for (const name of ["receipt.json", "failure.json", "cleanup.json"])
    if (await Bun.file(resolve(base, name)).exists())
      throw Error("ANDROID_IME_REFERENCE_FRESH_OUTPUT_REQUIRED");
  await mkdir(owned, { recursive: true });
  const failures = androidPostBoundaryCommandFailures();
  let emulator: ReturnType<typeof Bun.spawn> | undefined,
    phase = "source",
    avdCreationAttempted = false,
    receipt: Record<string, unknown> | undefined;
  const log = resolve(owned, "private-emulator.log");
  async function command(args: string[], input?: string, timeoutMs?: number) {
    return new TextDecoder().decode(
      await runAndroidHomeCommand({
        args,
        cwd: root,
        env: childEnv,
        ...(input === undefined ? {} : { input }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
        onFailure: (value) => failures.record(value),
      }),
    );
  }
  const shell = (args: string[], timeout?: number) =>
    command([adb, "-s", serial, "shell", ...args], undefined, timeout);
  try {
    if ((await command(["git", "rev-parse", "HEAD"])).trim() !== source)
      throw Error("ANDROID_IME_REFERENCE_SOURCE_MISMATCH");
    await command(["git", "diff", "--quiet", "HEAD"]);
    await command(["git", "merge-base", "--is-ancestor", source, "origin/main"]);
    phase = "owned-emulator";
    if (
      (await command([adb, "devices"])).split(/\r?\n/).some((row) => row.startsWith(`${serial}\t`))
    )
      throw Error("ANDROID_IME_REFERENCE_EXISTING_DEVICE_REFUSED");
    avdCreationAttempted = true;
    await createOwnedAndroidAvd(sdk, owned, avd, command);
    emulator = Bun.spawn([resolve(sdk, "emulator/emulator"), ...androidRuntimeOptions(avd)], {
      env: childEnv,
      stdout: Bun.file(log),
      stderr: Bun.file(log),
    });
    phase = "boot";
    const bootDeadline = Date.now() + 240000;
    let booted = false;
    while (Date.now() < bootDeadline) {
      if (emulator.exitCode !== null) throw Error("ANDROID_IME_REFERENCE_EMULATOR_EXITED");
      try {
        booted = (await shell(["getprop", "sys.boot_completed"])).trim() === "1";
      } catch {
        /* A newly booting device can be absent from adb temporarily. */
      }
      if (booted) break;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    if (
      !booted ||
      (await command([adb, "-s", serial, "emu", "avd", "name"])).trim().split(/\r?\n/)[0] !== avd
    )
      throw Error("ANDROID_IME_REFERENCE_OWNED_BOOT_REQUIRED");
    phase = "package-readiness";
    const readiness = await observeAndroidPackageReadiness({
      shell: (args, timeout) => shell(args, timeout),
      deviceSerial: serial,
      avdName: avd,
      freshOwnedEmulator: true,
      productLaunchStarted: false,
      captureBoundaryEntered: false,
      deadline: Date.now() + 120000,
      diagnostic: () => {},
    });
    phase = "product-absence";
    assertAndroidImeProductAbsent(await shell(["pm", "list", "packages", "--user", "0"]));
    phase = "ime-metadata";
    const raw = await shell(["ime", "list", "-a", "--user", "0"]),
      selected = await shell(["settings", "--user", "0", "get", "secure", "default_input_method"]),
      inventory = inspectAndroidImeInventory(raw, selected);
    const apiLevel = (await shell(["getprop", "ro.build.version.sdk"])).trim(),
      osVersion = (await shell(["getprop", "ro.build.version.release"])).trim(),
      model = (await shell(["getprop", "ro.product.model"])).trim();
    if (
      apiLevel !== "35" ||
      !/^15(?:\.\d+)*$/.test(osVersion) ||
      !/^[A-Za-z0-9_. -]{1,80}$/.test(model)
    )
      throw Error("ANDROID_IME_REFERENCE_IMAGE_MISMATCH");
    assertAndroidImeProductAbsent(await shell(["pm", "list", "packages", "--user", "0"]));
    receipt = {
      version: 1,
      kind: "android-owned-ime-metadata-reference-only",
      toolingSourceSha: source,
      observedAt: new Date().toISOString(),
      image: "system-images;android-35;google_apis;x86_64",
      device: { kind: "owned-emulator", apiLevel: 35, osVersion, model },
      productAbsentBeforeAndAfter: true,
      productInstalled: false,
      packageReadiness: readiness,
      inventory,
      metadataSha256: createHash("sha256").update(raw).digest("hex"),
      settingsChanged: false,
      softwareKeyTaps: 0,
      userAccountEntered: false,
      screenshotsExported: false,
      rawHierarchyExported: false,
      rawMetadataExported: false,
      rawCommandLogsExported: false,
      koreanKeyboardVerified: false,
      productInputVerified: false,
      physicalDeviceVerified: false,
    };
  } catch (error) {
    await writeFile(
      resolve(base, "failure.json"),
      `${JSON.stringify(
        {
          toolingSourceSha: source,
          phase,
          code:
            error instanceof Error && /^ANDROID_IME_REFERENCE_[A-Z_]+$/.test(error.message)
              ? error.message
              : "ANDROID_IME_REFERENCE_FAILED",
          commandFailures: failures.snapshot(),
          emulatorStartupIssues: emulatorStartupIssues(await readFile(log, "utf8").catch(() => "")),
          rawCommandLogsExported: false,
          rawMetadataExported: false,
          productInputVerified: false,
        },
        null,
        2,
      )}\n`,
      { flag: "wx" },
    );
    process.exitCode = 1;
  } finally {
    let emulatorExited = emulator === undefined,
      avdDeleted = !avdCreationAttempted,
      privateFilesRemoved = false;
    if (emulator) {
      try {
        emulator.kill();
      } catch {
        /* Already exited. */
      }
      const timer = setTimeout(() => {
        try {
          emulator?.kill("SIGKILL");
        } catch {
          /* Already exited. */
        }
      }, 5000);
      try {
        await emulator.exited;
        emulatorExited = true;
      } finally {
        clearTimeout(timer);
      }
    }
    if (avdCreationAttempted) {
      try {
        await command([
          resolve(sdk, "cmdline-tools/latest/bin/avdmanager"),
          "delete",
          "avd",
          "-n",
          avd,
        ]);
        avdDeleted = !(await Bun.file(resolve(paths.avdHome, `${avd}.ini`)).exists());
      } catch {
        /* The cleanup receipt retains this failure. */
      }
    }
    try {
      await rm(owned, { recursive: true, force: true });
      privateFilesRemoved = true;
    } catch {
      /* Never accept success while private files remain. */
    }
    const cleanup = {
      version: 1,
      toolingSourceSha: source,
      observedAt: new Date().toISOString(),
      emulatorExited,
      avdDeleted,
      privateFilesRemoved,
    };
    await writeFile(resolve(base, "cleanup.json"), `${JSON.stringify(cleanup, null, 2)}\n`, {
      flag: "wx",
    });
    if (!emulatorExited || !avdDeleted || !privateFilesRemoved) process.exitCode = 1;
    else if (receipt)
      await writeFile(
        resolve(base, "receipt.json"),
        JSON.stringify({ ...receipt, emulatorExited, avdDeleted, privateFilesRemoved }, null, 2) +
          "\n",
        { flag: "wx" },
      );
  }
  console.log(
    process.exitCode
      ? "ANDROID_IME_REFERENCE_FAILED"
      : "ANDROID_IME_REFERENCE_RECORDED_KOREAN_INPUT_UNVERIFIED",
  );
}
if (import.meta.main)
  main().catch(() => {
    process.exitCode = 1;
    console.log("ANDROID_IME_REFERENCE_BOOTSTRAP_FAILED");
  });
