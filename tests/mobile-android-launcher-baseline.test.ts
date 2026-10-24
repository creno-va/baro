import { expect, test } from "bun:test";
import {
  androidDefaultLauncher,
  androidLauncherBaselineSchema,
  androidLauncherFailureCode,
  androidLauncherObservation,
  androidSystemErrorDialogObserved,
  observeAndroidLauncherBaseline,
} from "../scripts/mobile-android-launcher-baseline";

const pkg = "com.google.android.apps.nexuslauncher",
  component = `${pkg}/.NexusLauncherActivity`;
const activity = (value = component) => `topResumedActivity=ActivityRecord{a u0 ${value} t1}`;
const xml = (rootPackage = pkg, children = "", extra = "") =>
  `<?xml version="1.0"?><hierarchy><node package="${rootPackage}" enabled="true" bounds="[0,0][1080,2400]" text="synthetic-private-label" ${extra}>${children}</node></hierarchy>`;
const anr =
  '<node package="android" resource-id="android:id/aerr_wait" text="synthetic-private-dialog"/>';
function fixture(
  options: {
    emptySamples?: number;
    anr?: boolean;
    dumpSaved?: boolean;
    failRead?: boolean;
    failCleanup?: boolean;
    changedAfter?: boolean;
    shellElapsed?: number;
  } = {},
) {
  let clock = 1000,
    samples = 0,
    foregroundReads = 0;
  const commands: { args: string[]; timeout: number }[] = [],
    diagnostics: unknown[] = [];
  return {
    commands,
    diagnostics,
    clock: () => clock,
    context: {
      deviceSerial: "emulator-5580",
      avdName: "baro_runtime_abcdef123456",
      freshOwnedEmulator: true,
      productLaunchStarted: false,
      captureBoundaryEntered: false,
      deadline: 121000,
      now: () => clock,
      pause: async (ms: number) => {
        clock += ms;
      },
      diagnostic(value: unknown) {
        diagnostics.push(value);
      },
      async shell(args: string[], timeout: number) {
        commands.push({ args, timeout });
        clock += options.shellElapsed ?? 10;
        if (args[0] === "cmd")
          return args.includes("--components")
            ? `${component}\n`
            : `priority=0 preferredOrder=0 match=0x100000 specificIndex=-1 isDefault=true\n${component}\n`;
        if (args[0] === "dumpsys") {
          foregroundReads += 1;
          return activity(
            options.changedAfter && foregroundReads % 2 === 0
              ? "com.android.settings/.Settings"
              : component,
          );
        }
        if (args[0] === "uiautomator") {
          samples += 1;
          return options.dumpSaved === false ? "" : `UI hierchary dumped to: ${args.at(-1)}\n`;
        }
        if (args[0] === "cat") {
          if (options.failRead) throw Error("synthetic-private-read-error");
          return options.anr
            ? xml("android", anr)
            : xml(samples <= (options.emptySamples ?? 0) ? "android" : pkg);
        }
        if (args[0] === "rm") {
          if (options.failCleanup) throw Error("synthetic-private-delete-error");
          return "";
        }
        throw Error("UNEXPECTED_FIXTURE_COMMAND");
      },
    },
  };
}
test("launcher resolution binds only the owned SDK default HOME and observations expose no labels or component", () => {
  const identity = androidDefaultLauncher(`${component}\n`);
  expect(identity.kind).toBe("pixel");
  expect(androidDefaultLauncher("com.android.launcher3/.Launcher").kind).toBe("aosp");
  for (const value of [
    "android/com.android.internal.app.ResolverActivity",
    "site.baro.app.preview/.MainActivity",
    `${component}\n${component}`,
    `priority=0 preferredOrder=0 match=0x100000 specificIndex=-1 isDefault=true\n${component}`,
    `${component};private`,
    "unknown-private",
    `${pkg}/$PRIVATE`,
  ])
    expect(() => androidDefaultLauncher(value)).toThrow("ANDROID_LAUNCHER_RESOLUTION_INVALID");
  expect(androidLauncherObservation(xml(), activity(), identity)).toEqual({
    foreground: true,
    rootVisible: true,
    systemErrorDialogObserved: false,
  });
  expect(
    androidLauncherObservation(xml(), `${activity()}\n${activity()}`, identity).foreground,
  ).toBe(false);
  expect(androidLauncherObservation(xml("android"), activity(), identity).rootVisible).toBe(false);
  expect(
    androidLauncherObservation(xml(), activity().replace("u0", "u10"), identity).foreground,
  ).toBe(false);
  expect(
    androidLauncherObservation(xml(pkg, "", 'visible-to-user="false"'), activity(), identity)
      .rootVisible,
  ).toBe(false);
  expect(androidSystemErrorDialogObserved(xml("android", anr))).toBe(true);
  for (const id of ["aerr_close", "aerr_wait", "aerr_report"]) {
    expect(
      androidSystemErrorDialogObserved(
        xml("android", `<node package="android" resource-id="android:id/${id}"/>`),
      ),
    ).toBe(true);
    expect(
      androidSystemErrorDialogObserved(
        xml(pkg, `<node package="${pkg}" resource-id="android:id/${id}"/>`),
      ),
    ).toBe(false);
  }
  for (const malformed of [
    "private",
    xml().replace("<?xml", "<!DOCTYPE x><!ENTITY y><?xml"),
    xml().replace('enabled="true"', 'enabled="true" enabled="false"'),
  ])
    expect(() => androidSystemErrorDialogObserved(malformed)).toThrow(
      "ANDROID_LAUNCHER_HIERARCHY_INVALID",
    );
});
test("owned pre-product readiness requires three consecutive before/after foreground and visible-root samples within the original deadline", async () => {
  const f = fixture({ emptySamples: 1 });
  const proof = await observeAndroidLauncherBaseline(f.context);
  expect(proof.samples).toBe(4);
  expect(proof.consecutiveReadySamples).toBe(3);
  expect(f.commands.filter((c) => c.args[0] === "uiautomator")).toHaveLength(4);
  expect(f.commands.filter((c) => c.args[0] === "rm")).toHaveLength(4);
  expect(f.commands.every((c) => c.timeout > 0 && c.timeout <= 15000)).toBe(true);
  expect(f.commands.some((c) => ["am", "input", "settings"].includes(c.args[0] ?? ""))).toBe(false);
  expect(f.clock()).toBeLessThan(f.context.deadline);
  expect(JSON.stringify(f.diagnostics)).not.toContain("synthetic-private");
  expect(JSON.stringify(f.diagnostics)).not.toContain(pkg);
  for (const patch of [
    { dialogDismissed: true },
    { productLaunched: true },
    { samples: 11 },
    { consecutiveReadySamples: 2 },
    { rawHierarchyExported: true },
    { rawValue: "private" },
  ])
    expect(androidLauncherBaselineSchema.safeParse({ ...proof, ...patch }).success).toBe(false);
});
test("ANR, dump/read/delete failures never trigger dialog interactions or a successful baseline and retain cleanup failure separately", async () => {
  for (const [options, code] of [
    [{ anr: true }, "ANDROID_LAUNCHER_SYSTEM_ERROR_DIALOG"],
    [{ dumpSaved: false }, "ANDROID_LAUNCHER_DUMP_UNCONFIRMED"],
    [{ failRead: true }, "ANDROID_LAUNCHER_COMMAND_FAILED"],
    [{ failCleanup: true }, "ANDROID_LAUNCHER_CLEANUP_FAILED"],
    [{ dumpSaved: false, failCleanup: true }, "ANDROID_LAUNCHER_DUMP_UNCONFIRMED"],
  ] as const) {
    const f = fixture(options);
    await expect(observeAndroidLauncherBaseline(f.context)).rejects.toThrow(code);
    expect(f.commands.filter((c) => c.args[0] === "uiautomator")).toHaveLength(1);
    expect(f.commands.filter((c) => c.args[0] === "rm")).toHaveLength(1);
    expect(f.commands.some((c) => ["am", "input", "settings"].includes(c.args[0] ?? ""))).toBe(
      false,
    );
    if (options.failCleanup)
      expect(f.diagnostics.at(-1)).toEqual(expect.objectContaining({ cleanupFailed: true }));
    expect(JSON.stringify(f.diagnostics)).not.toContain("synthetic-private");
  }
});
test("unowned/private/late contexts make no calls and unstable or slow samples cannot pass by resetting the shared clock", async () => {
  for (const patch of [
    { freshOwnedEmulator: false },
    { productLaunchStarted: true },
    { captureBoundaryEntered: true },
    { deviceSerial: "physical" },
    { avdName: "user-avd" },
    { deadline: 0 },
    { deadline: 121001 },
  ]) {
    const f = fixture();
    await expect(observeAndroidLauncherBaseline({ ...f.context, ...patch })).rejects.toThrow();
    expect(f.commands).toHaveLength(0);
  }
  const unstable = fixture({ changedAfter: true });
  await expect(observeAndroidLauncherBaseline(unstable.context)).rejects.toThrow(
    "ANDROID_LAUNCHER_NOT_READY",
  );
  expect(unstable.commands.filter((c) => c.args[0] === "uiautomator")).toHaveLength(10);
  const slow = fixture({ shellElapsed: 35000 });
  await expect(observeAndroidLauncherBaseline(slow.context)).rejects.toThrow(
    "ANDROID_LAUNCHER_NOT_READY",
  );
  expect(slow.commands.filter((c) => c.args[0] === "uiautomator").length).toBeLessThan(3);
  expect(androidLauncherFailureCode(Error("private-url-stack"))).toBe(
    "ANDROID_LAUNCHER_COMMAND_FAILED",
  );
});
