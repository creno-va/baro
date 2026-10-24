import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type AndroidHierarchyDumpOutcome,
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
  quoteAdbShellArgument,
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
export function androidDefaultImeState(value: string) {
  if (value.length > 512) return "invalid" as const;
  const selected = value.trim();
  return !selected || selected === "null"
    ? ("uninitialized" as const)
    : selected.length <= 512 && component.test(selected)
      ? ("component" as const)
      : ("invalid" as const);
}
export type AndroidImeRegistrationDiagnostic = {
  stage: "default" | "inventory" | "complete" | "failed";
  defaultState: ReturnType<typeof androidDefaultImeState> | null;
  samples: number;
  uninitializedSamples: number;
  emptyInventoryObserved: boolean;
  defaultUnregisteredObserved: boolean;
  failureCode:
    | "DEFAULT_FORMAT_INVALID"
    | "WAIT_EXPIRED"
    | "INVENTORY_INVALID"
    | "READ_FAILED"
    | null;
};
/** Wait only for known uninitialized registration; malformed nonempty metadata still fails. */
export async function observeAndroidImeRegistration(context: {
  deviceSerial: string;
  avdName: string;
  freshOwnedEmulator: boolean;
  productInstalled: boolean;
  readDefault(timeoutMs: number): Promise<string>;
  readInventory(timeoutMs: number): Promise<string>;
  diagnostic(value: AndroidImeRegistrationDiagnostic): void;
  now?: () => number;
  pause?: (ms: number) => Promise<void>;
}) {
  if (
    context.deviceSerial !== "emulator-5580" ||
    !/^baro_runtime_[a-f0-9]{12}$/.test(context.avdName) ||
    !context.freshOwnedEmulator ||
    context.productInstalled
  )
    throw Error("ANDROID_IME_REFERENCE_OWNED_REGISTRATION_CONTEXT_REQUIRED");
  const now = context.now ?? (() => performance.now()),
    pause = context.pause ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    deadline = now() + 15000;
  let samples = 0,
    uninitializedSamples = 0,
    emptyInventoryObserved = false,
    defaultUnregisteredObserved = false,
    defaultState: AndroidImeRegistrationDiagnostic["defaultState"] = null;
  const report = (
    stage: AndroidImeRegistrationDiagnostic["stage"],
    failureCode: AndroidImeRegistrationDiagnostic["failureCode"] = null,
  ) =>
    context.diagnostic({
      stage,
      defaultState,
      samples,
      uninitializedSamples,
      emptyInventoryObserved,
      defaultUnregisteredObserved,
      failureCode,
    });
  const budget = () => {
    const left = deadline - now();
    if (left <= 0) throw Error("ANDROID_IME_REFERENCE_REGISTRATION_WAIT_EXPIRED");
    return Math.max(1, Math.min(15000, Math.floor(left)));
  };
  const next = async () => {
    if (samples < 20 && now() < deadline) await pause(Math.min(500, deadline - now()));
  };
  try {
    while (samples < 20 && now() < deadline) {
      samples++;
      const selected = await context.readDefault(budget());
      defaultState = androidDefaultImeState(selected);
      if (defaultState === "uninitialized") uninitializedSamples++;
      report("default");
      if (defaultState === "invalid") throw Error("ANDROID_IME_REFERENCE_DEFAULT_FORMAT_INVALID");
      if (defaultState === "uninitialized") {
        await next();
        continue;
      }
      const raw = await context.readInventory(budget());
      if (raw.length > 4_000_000) throw Error("ANDROID_IME_REFERENCE_INVENTORY_BOUND");
      if (!raw.trim()) {
        emptyInventoryObserved = true;
        report("inventory");
        await next();
        continue;
      }
      let inventory: ReturnType<typeof inspectAndroidImeInventory>;
      try {
        inventory = inspectAndroidImeInventory(raw, selected);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "ANDROID_IME_REFERENCE_DEFAULT_NOT_REGISTERED"
        ) {
          defaultUnregisteredObserved = true;
          report("inventory");
          await next();
          continue;
        }
        throw error;
      }
      budget();
      report("complete");
      return {
        inventory,
        metadataSha256: createHash("sha256").update(raw).digest("hex"),
        settingsActivity: () => androidGboardSettingsActivity(raw, selected),
        defaultMethodMatches: (value: string) => value.trim() === selected.trim(),
        readiness: {
          kind: "owned-android-ime-registration-readiness" as const,
          samples,
          uninitializedSamples,
          emptyInventoryObserved,
          defaultUnregisteredObserved,
          registeredDefaultVerified: true as const,
          sharedBudgetMaxMs: 15000 as const,
          maxSamples: 20 as const,
          rawDefaultValueExported: false as const,
        },
      };
    }
    throw Error("ANDROID_IME_REFERENCE_REGISTRATION_WAIT_EXPIRED");
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    report(
      "failed",
      code === "ANDROID_IME_REFERENCE_DEFAULT_FORMAT_INVALID"
        ? "DEFAULT_FORMAT_INVALID"
        : code === "ANDROID_IME_REFERENCE_REGISTRATION_WAIT_EXPIRED"
          ? "WAIT_EXPIRED"
          : code.startsWith("ANDROID_IME_REFERENCE_")
            ? "INVENTORY_INVALID"
            : "READ_FAILED",
    );
    throw error;
  }
}
export function androidImeReferenceConfiguration(input: Record<string, string | undefined>) {
  const env = internalAndroidEnvironment(input),
    sdk = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT,
    source = input.TARGET_SHA,
    mode = input.BARO_ANDROID_IME_REFERENCE_MODE ?? "metadata";
  if (!sdk || !source || !/^[a-f0-9]{40}$/.test(source))
    throw Error("ANDROID_IME_REFERENCE_EXPLICIT_SDK_SOURCE_REQUIRED");
  if (mode !== "metadata" && mode !== "settings")
    throw Error("ANDROID_IME_REFERENCE_MODE_REQUIRED");
  return { env, sdk, source, mode };
}
/** Public SDK metadata supplies the explicit Settings component; never guess an activity or install an IME. */
export function androidGboardSettingsActivity(raw: string, selected: string) {
  const inventory = inspectAndroidImeInventory(raw, selected);
  if (!inventory.methods.some((m) => m.selectedDefault && m.vendor === "google-gboard"))
    throw Error("ANDROID_IME_REFERENCE_GBOARD_DEFAULT_REQUIRED");
  const lines = raw.trimEnd().split(/\r?\n/),
    start = lines.indexOf(`${selected.trim()}:`),
    next = lines.findIndex(
      (line, i) => i > start && component.test(line.slice(0, -1)) && line.endsWith(":"),
    ),
    block = lines.slice(start + 1, next < 0 ? lines.length : next).join("\n"),
    settings = [...block.matchAll(/\bmSettingsActivityName=([^\s]+)/g)],
    activity = settings[0]?.[1],
    pkg = selected.trim().split("/")[0];
  if (
    start < 0 ||
    settings.length !== 1 ||
    !activity ||
    activity === "null" ||
    activity.length > 256 ||
    !/^(?:\.[A-Za-z_$][\w$]*|[A-Za-z_$][\w$]*)(?:\.[A-Za-z_$][\w$]*)*$/.test(activity)
  )
    throw Error("ANDROID_IME_REFERENCE_SETTINGS_ACTIVITY_REQUIRED");
  return `${pkg}/${activity.startsWith(".") ? pkg + activity : activity}`;
}
export interface AndroidGboardScopeDiagnostic {
  foregroundBeforeVerified: true;
  foregroundAfterVerified: boolean;
  titleCount: number;
  menuCounts: Record<string, number>;
  strictScopeObserved: boolean;
}
/** Fixed public OS menu counts only, scoped to the observed SDK Gboard Settings activity. */
export function androidGboardSettingsControls(
  xml: string,
  foreground: string,
  activity: string,
  observation?: {
    foregroundAfter?: string;
    diagnostic?: (value: AndroidGboardScopeDiagnostic) => void;
  },
) {
  assertGboardForeground(foreground, activity);
  if (observation?.foregroundAfter !== undefined)
    assertGboardForeground(observation.foregroundAfter, activity);
  const expected = activity.split("/");
  function assertGboardForeground(foreground: string, activity: string) {
    if (
      foreground.length > 4_000_000 ||
      !component.test(activity) ||
      !activity.startsWith("com.google.android.inputmethod.latin/")
    )
      throw Error("ANDROID_IME_REFERENCE_SETTINGS_FOREGROUND_REQUIRED");
    const lines = foreground.split(/\r?\n/),
      top = lines.filter((line) => /\btopResumedActivity\s*[=:]/.test(line)),
      resumed = top.length ? top : lines.filter((line) => /\bmResumedActivity\s*[=:]/.test(line)),
      observed =
        resumed.length === 1
          ? resumed[0]?.match(/\bu\d+\s+([A-Za-z][\w.]*)\/([A-Za-z.][\w.$]*)\s/)
          : null,
      expected = activity.split("/");
    const observedClass = observed?.[2]?.startsWith(".")
      ? observed[1] + observed[2]
      : observed?.[2];
    if (!observed || observed[1] !== expected[0] || observedClass !== expected[1])
      throw Error("ANDROID_IME_REFERENCE_SETTINGS_FOREGROUND_REQUIRED");
  }
  if (
    xml.length > 1_000_000 ||
    !xml.startsWith("<?xml") ||
    /<!DOCTYPE|<!ENTITY/.test(xml) ||
    !/<\/(?:hierarchy|displays)>\s*$/.test(xml)
  )
    throw Error("ANDROID_IME_REFERENCE_SETTINGS_HIERARCHY_INVALID");
  const rows = [...xml.matchAll(/<node\b([^>]*)>/g)];
  if (!rows.length || rows.length > 10000 || [...xml.matchAll(/<node\b/g)].length !== rows.length)
    throw Error("ANDROID_IME_REFERENCE_SETTINGS_HIERARCHY_INVALID");
  let depth = 0;
  for (const token of xml.matchAll(/<(\/?)(node)\b([^>]*)>/g)) {
    if (token[1]) {
      if (token[3]?.trim() || depth === 0)
        throw Error("ANDROID_IME_REFERENCE_SETTINGS_HIERARCHY_INVALID");
      depth--;
    } else if (!token[3]?.trimEnd().endsWith("/")) {
      if (++depth > 128) throw Error("ANDROID_IME_REFERENCE_SETTINGS_HIERARCHY_INVALID");
    }
  }
  if (depth !== 0) throw Error("ANDROID_IME_REFERENCE_SETTINGS_HIERARCHY_INVALID");
  const nodes = rows
    .map((row) => {
      const pairs = [...(row[1] ?? "").matchAll(/([\w:-]+)="([^"]*)"/g)];
      const residue = (row[1] ?? "").replace(/([\w:-]+)="([^"]*)"/g, "").trim();
      if (
        new Set(pairs.map((p) => p[1])).size !== pairs.length ||
        (residue !== "" && residue !== "/") ||
        pairs.some((p) => p[2]?.includes("<"))
      )
        throw Error("ANDROID_IME_REFERENCE_SETTINGS_HIERARCHY_INVALID");
      return Object.fromEntries(pairs.map((p) => [p[1], p[2]]));
    })
    .filter(
      (node) =>
        node.package === expected[0] &&
        ["android.widget.TextView", "android.widget.Button"].includes(node.class ?? "") &&
        node.enabled === "true" &&
        node["visible-to-user"] !== "false",
    );
  const menuLabels = {
    languages: "Languages",
    preferences: "Preferences",
    textCorrection: "Text correction",
    theme: "Theme",
    glideTyping: "Glide typing",
    voiceTyping: "Voice typing",
    clipboard: "Clipboard",
    dictionary: "Dictionary",
    privacy: "Privacy",
    advanced: "Advanced",
  };
  const count = (label: string) =>
    nodes.filter((node) => node.text === label || node["content-desc"] === label).length;
  const titleCount = count("Gboard"),
    menuCounts = Object.fromEntries(
      Object.entries(menuLabels).map(([key, label]) => [key, count(label)]),
    );
  if (titleCount > 8 || Object.values(menuCounts).some((n) => n > 8))
    throw Error("ANDROID_IME_REFERENCE_SETTINGS_SCOPE_REQUIRED");
  const strictScopeObserved =
    titleCount >= 1 && Object.values(menuCounts).filter((n) => n > 0).length >= 2;
  observation?.diagnostic?.({
    foregroundBeforeVerified: true,
    foregroundAfterVerified: observation.foregroundAfter !== undefined,
    titleCount,
    menuCounts,
    strictScopeObserved,
  });
  if (!strictScopeObserved) throw Error("ANDROID_IME_REFERENCE_SETTINGS_SCOPE_REQUIRED");
  return {
    kind: "android-owned-gboard-settings-controls-reference-only" as const,
    settingsActivityForegroundVerified: true as const,
    gboardTitleObserved: true as const,
    menuCounts,
    languageSelectionVerified: false as const,
    productInputVerified: false as const,
    koreanKeyboardVerified: false as const,
    rawLabelsExported: false as const,
    rawHierarchyExported: false as const,
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
    { env, sdk, source, mode } = androidImeReferenceConfiguration(process.env),
    base = resolve(root, ".wrangler/mobile-android-ime-reference"),
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
  let hierarchyOutcome: AndroidHierarchyDumpOutcome | null = null;
  let imeRegistrationDiagnostic: AndroidImeRegistrationDiagnostic | null = null;
  let gboardScopeDiagnostic: AndroidGboardScopeDiagnostic | null = null;
  async function command(args: string[], input?: string, timeoutMs?: number) {
    return new TextDecoder().decode(
      await runAndroidHomeCommand({
        args,
        cwd: root,
        env: childEnv,
        ...(input === undefined ? {} : { input }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
        onFailure: (value) => failures.record(value),
        onHierarchyDump: (value) => {
          hierarchyOutcome = value;
        },
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
    const registration = await observeAndroidImeRegistration({
        deviceSerial: serial,
        avdName: avd,
        freshOwnedEmulator: booted && emulator?.exitCode === null,
        productInstalled: false,
        readDefault: (timeout) =>
          shell(["settings", "--user", "0", "get", "secure", "default_input_method"], timeout),
        readInventory: (timeout) => shell(["ime", "list", "-a", "--user", "0"], timeout),
        diagnostic: (value) => {
          imeRegistrationDiagnostic = value;
        },
      }),
      inventory = registration.inventory;
    let settingsReference: ReturnType<typeof androidGboardSettingsControls> | undefined;
    if (mode === "settings") {
      phase = "gboard-settings-reference";
      const activity = registration.settingsActivity();
      await shell([
        "am",
        "start",
        "-W",
        "-a",
        "android.intent.action.MAIN",
        "-n",
        quoteAdbShellArgument(activity),
      ]);
      const file = `/sdcard/baro-ime-${randomUUID()}.xml`;
      try {
        const foreground = await shell(["dumpsys", "activity", "activities"]);
        hierarchyOutcome = null;
        await shell(["uiautomator", "dump", "--compressed", file]);
        if (hierarchyOutcome !== "saved")
          throw Error("ANDROID_IME_REFERENCE_SETTINGS_DUMP_UNCONFIRMED");
        const xml = await shell(["cat", file]);
        settingsReference = androidGboardSettingsControls(xml, foreground, activity, {
          foregroundAfter: await shell(["dumpsys", "activity", "activities"]),
          diagnostic: (value) => {
            gboardScopeDiagnostic = value;
          },
        });
      } finally {
        await shell(["rm", "-f", file]);
        await shell(["test", "!", "-e", file]);
      }
      if (
        !registration.defaultMethodMatches(
          await shell(["settings", "--user", "0", "get", "secure", "default_input_method"]),
        )
      )
        throw Error("ANDROID_IME_REFERENCE_DEFAULT_CHANGED");
    }
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
      kind:
        mode === "settings"
          ? "android-owned-gboard-settings-reference-receipt"
          : "android-owned-ime-metadata-reference-only",
      referenceMode: mode,
      toolingSourceSha: source,
      observedAt: new Date().toISOString(),
      image: "system-images;android-35;google_apis;x86_64",
      device: { kind: "owned-emulator", apiLevel: 35, osVersion, model },
      productAbsentBeforeAndAfter: true,
      productInstalled: false,
      packageReadiness: readiness,
      inventory,
      ...(settingsReference ? { settingsReference, hierarchyFileRemoved: true } : {}),
      metadataSha256: registration.metadataSha256,
      imeRegistrationReadiness: registration.readiness,
      ...(mode === "metadata"
        ? { settingsChanged: false }
        : { keyboardPreferenceChangeRequested: false, selectedDefaultUnchanged: true }),
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
          imeRegistrationDiagnostic,
          gboardScopeDiagnostic,
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
