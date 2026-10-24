import { randomUUID } from "node:crypto";
import { z } from "zod";
import { androidHierarchyDumpOutcome } from "./mobile-android-command-observation";

const codes = [
  "ANDROID_LAUNCHER_OWNED_PREFLIGHT_REQUIRED",
  "ANDROID_LAUNCHER_DEADLINE_INVALID",
  "ANDROID_LAUNCHER_RESOLUTION_INVALID",
  "ANDROID_LAUNCHER_HIERARCHY_INVALID",
  "ANDROID_LAUNCHER_SYSTEM_ERROR_DIALOG",
  "ANDROID_LAUNCHER_DUMP_UNCONFIRMED",
  "ANDROID_LAUNCHER_NOT_READY",
  "ANDROID_LAUNCHER_COMMAND_FAILED",
  "ANDROID_LAUNCHER_CLEANUP_FAILED",
] as const;
export function androidLauncherFailureCode(error: unknown) {
  return (
    codes.find((code) => error instanceof Error && error.message === code) ??
    "ANDROID_LAUNCHER_COMMAND_FAILED"
  );
}
export function androidDefaultLauncher(value: string) {
  const match =
    value.trim().length <= 512
      ? value.trim().match(/^([a-z][a-z0-9_.]+)\/([A-Za-z.][A-Za-z0-9_.]*)$/)
      : null;
  const pkg = match?.[1],
    activity = match?.[2];
  const kind =
    pkg === "com.google.android.apps.nexuslauncher"
      ? "pixel"
      : pkg === "com.android.launcher3"
        ? "aosp"
        : null;
  if (!kind || !pkg || !activity) throw Error("ANDROID_LAUNCHER_RESOLUTION_INVALID");
  return {
    kind,
    package: pkg,
    activity: activity.startsWith(".") ? pkg + activity : activity,
  } as const;
}
function nodes(xml: string) {
  if (
    xml.length > 1_000_000 ||
    !xml.startsWith("<?xml") ||
    /<!DOCTYPE|<!ENTITY/.test(xml) ||
    !xml.trimEnd().endsWith("</hierarchy>")
  )
    throw Error("ANDROID_LAUNCHER_HIERARCHY_INVALID");
  const matches = [...xml.matchAll(/<node\b[^>]*>/g)];
  if (matches.length > 10000) throw Error("ANDROID_LAUNCHER_HIERARCHY_INVALID");
  return matches.map((m) => {
    const attributes = [...m[0].matchAll(/([\w:-]+)="([^"]*)"/g)];
    if (new Set(attributes.map((a) => a[1])).size !== attributes.length)
      throw Error("ANDROID_LAUNCHER_HIERARCHY_INVALID");
    return Object.fromEntries<string>(attributes.map((a) => [a[1] ?? "", a[2] ?? ""]));
  });
}
export function androidSystemErrorDialogObserved(xml: string) {
  return nodes(xml).some(
    (node) =>
      node.package === "android" &&
      ["android:id/aerr_close", "android:id/aerr_wait", "android:id/aerr_report"].includes(
        node["resource-id"] ?? "",
      ),
  );
}
export function androidLauncherObservation(
  xml: string,
  activities: string,
  identity: ReturnType<typeof androidDefaultLauncher>,
) {
  if (activities.length > 4_000_000) throw Error("ANDROID_LAUNCHER_HIERARCHY_INVALID");
  const lines = activities.split(/\r?\n/),
    top = lines.filter((line) => /\btopResumedActivity\s*[=:]/.test(line));
  const entries = top.length ? top : lines.filter((line) => /\bmResumedActivity\s*[=:]/.test(line));
  const component =
    entries.length === 1 ? entries[0]?.match(/\bu0\s+([A-Za-z][\w.]*)\/([A-Za-z.][\w.]*)\s/) : null;
  const pkg = component?.[1],
    activity = component?.[2];
  const foreground =
    pkg === identity.package &&
    (activity?.startsWith(".") ? pkg + activity : activity) === identity.activity;
  const root = nodes(xml)[0],
    rectangle = root?.bounds?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
  const coordinates = rectangle?.slice(1).map(Number) ?? [],
    [left, upper, right, bottom] = coordinates;
  const rootBoundsUsable =
    coordinates.length === 4 &&
    coordinates.every((v) => Number.isSafeInteger(v) && v >= 0 && v <= 8192) &&
    left !== undefined &&
    upper !== undefined &&
    right !== undefined &&
    bottom !== undefined &&
    right - left >= 240 &&
    bottom - upper >= 240;
  return {
    foreground,
    rootVisible:
      root?.package === identity.package &&
      root.enabled === "true" &&
      root["visible-to-user"] !== "false" &&
      rootBoundsUsable,
    systemErrorDialogObserved: androidSystemErrorDialogObserved(xml),
  };
}
export const androidLauncherBaselineSchema = z.strictObject({
  kind: z.literal("owned-android-launcher-readiness"),
  launcherKind: z.enum(["pixel", "aosp"]),
  samples: z.number().int().min(3).max(10),
  consecutiveReadySamples: z.literal(3),
  foregroundMatchedBeforeAndAfterReadySamples: z.literal(true),
  launcherRootVisibleInReadySamples: z.literal(true),
  systemErrorDialogAbsentInSamples: z.literal(true),
  productLaunched: z.literal(false),
  dialogDismissed: z.literal(false),
  launcherChanged: z.literal(false),
  rawHierarchyExported: z.literal(false),
});
export interface AndroidLauncherDiagnostic {
  stage:
    | "resolve"
    | "foreground-before"
    | "dump"
    | "hierarchy-read"
    | "cleanup"
    | "foreground-after"
    | "sample";
  launcherKind: "pixel" | "aosp" | null;
  samples: number;
  consecutiveReadySamples: number;
  foregroundBefore: boolean;
  foregroundAfter: boolean;
  rootVisible: boolean;
  systemErrorDialogObserved: boolean;
  dumpConfirmed: boolean;
  cleanupFailed: boolean;
  failureCode: ReturnType<typeof androidLauncherFailureCode> | null;
}
export async function observeAndroidLauncherBaseline(context: {
  shell: (args: string[], timeoutMs: number) => Promise<string>;
  deviceSerial: string;
  avdName: string;
  freshOwnedEmulator: boolean;
  productLaunchStarted: boolean;
  captureBoundaryEntered: boolean;
  deadline: number;
  diagnostic: (value: AndroidLauncherDiagnostic) => void;
  now?: () => number;
  pause?: (ms: number) => Promise<void>;
}) {
  if (
    !context.freshOwnedEmulator ||
    context.productLaunchStarted ||
    context.captureBoundaryEntered ||
    !/^emulator-\d{4,5}$/.test(context.deviceSerial) ||
    !/^baro_runtime_[a-f0-9]{12}$/.test(context.avdName)
  )
    throw Error("ANDROID_LAUNCHER_OWNED_PREFLIGHT_REQUIRED");
  const now = context.now ?? Date.now,
    pause = context.pause ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
  if (
    !Number.isSafeInteger(context.deadline) ||
    context.deadline <= now() ||
    context.deadline - now() > 120000
  )
    throw Error("ANDROID_LAUNCHER_DEADLINE_INVALID");
  const state: AndroidLauncherDiagnostic = {
    stage: "resolve",
    launcherKind: null,
    samples: 0,
    consecutiveReadySamples: 0,
    foregroundBefore: false,
    foregroundAfter: false,
    rootVisible: false,
    systemErrorDialogObserved: false,
    dumpConfirmed: false,
    cleanupFailed: false,
    failureCode: null,
  };
  const report = () => context.diagnostic({ ...state });
  const path = `/sdcard/baro-launcher-${randomUUID()}.xml`;
  async function command(
    args: string[],
    stage: AndroidLauncherDiagnostic["stage"],
    cleanup = false,
  ) {
    state.stage = stage;
    report();
    const remaining = context.deadline - now();
    if (remaining <= 0 && !cleanup) throw Error("ANDROID_LAUNCHER_NOT_READY");
    return context.shell(args, cleanup ? 5000 : Math.min(15000, remaining));
  }
  async function hierarchy() {
    let xml: string | undefined,
      failure: unknown,
      failed = false,
      cleanupFailed = false;
    try {
      const output = await command(["uiautomator", "dump", "--compressed", path], "dump");
      state.dumpConfirmed = androidHierarchyDumpOutcome(output, "", path) === "saved";
      report();
      if (!state.dumpConfirmed) throw Error("ANDROID_LAUNCHER_DUMP_UNCONFIRMED");
      xml = await command(["cat", path], "hierarchy-read");
    } catch (error) {
      failed = true;
      failure = error;
    } finally {
      try {
        await command(["rm", "-f", path], "cleanup", true);
      } catch {
        state.cleanupFailed = true;
        cleanupFailed = true;
        report();
      }
    }
    if (failed) throw failure;
    if (cleanupFailed) throw Error("ANDROID_LAUNCHER_CLEANUP_FAILED");
    if (xml === undefined) throw Error("ANDROID_LAUNCHER_HIERARCHY_INVALID");
    return xml;
  }
  try {
    const identity = androidDefaultLauncher(
      await command(
        [
          "cmd",
          "package",
          "resolve-activity",
          "--components",
          "--user",
          "0",
          "-a",
          "android.intent.action.MAIN",
          "-c",
          "android.intent.category.HOME",
        ],
        "resolve",
      ),
    );
    state.launcherKind = identity.kind;
    report();
    for (let sample = 1; sample <= 10 && now() < context.deadline; sample++) {
      state.samples = sample;
      state.dumpConfirmed = false;
      const before = await command(["dumpsys", "activity", "activities"], "foreground-before"),
        xml = await hierarchy();
      const first = androidLauncherObservation(xml, before, identity);
      state.foregroundBefore = first.foreground;
      state.rootVisible = first.rootVisible;
      state.systemErrorDialogObserved = first.systemErrorDialogObserved;
      report();
      if (state.systemErrorDialogObserved) throw Error("ANDROID_LAUNCHER_SYSTEM_ERROR_DIALOG");
      const after = await command(["dumpsys", "activity", "activities"], "foreground-after");
      state.foregroundAfter = androidLauncherObservation(xml, after, identity).foreground;
      state.consecutiveReadySamples =
        state.foregroundBefore && state.foregroundAfter && state.rootVisible
          ? state.consecutiveReadySamples + 1
          : 0;
      state.stage = "sample";
      report();
      if (state.consecutiveReadySamples === 3 && now() < context.deadline)
        return androidLauncherBaselineSchema.parse({
          kind: "owned-android-launcher-readiness",
          launcherKind: identity.kind,
          samples: state.samples,
          consecutiveReadySamples: 3,
          foregroundMatchedBeforeAndAfterReadySamples: true,
          launcherRootVisibleInReadySamples: true,
          systemErrorDialogAbsentInSamples: true,
          productLaunched: false,
          dialogDismissed: false,
          launcherChanged: false,
          rawHierarchyExported: false,
        });
      if (sample < 10 && context.deadline - now() > 1000) await pause(1000);
    }
    throw Error("ANDROID_LAUNCHER_NOT_READY");
  } catch (error) {
    state.failureCode = androidLauncherFailureCode(error);
    report();
    throw Error(state.failureCode);
  }
}
