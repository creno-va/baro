import { expect, test } from "bun:test";
import { androidNativeCommandOperation } from "../scripts/mobile-android-command-observation";
import {
  type AndroidPackageReadinessDiagnostic,
  androidPackageReadinessSchema,
  observeAndroidPackageReadiness,
} from "../scripts/mobile-android-package-readiness";
import { validationCommands } from "../scripts/validate";

function fixture() {
  let clock = 0;
  const calls: { args: string[]; timeout: number }[] = [],
    diagnostics: AndroidPackageReadinessDiagnostic[] = [];
  const context: Parameters<typeof observeAndroidPackageReadiness>[0] = {
    deviceSerial: "emulator-5580",
    avdName: "baro_runtime_0123456789ab",
    freshOwnedEmulator: true,
    productLaunchStarted: false,
    captureBoundaryEntered: false,
    deadline: 120000,
    now: () => clock,
    shell: async (args, timeout) => {
      calls.push({ args, timeout });
      clock += 1000;
      return "Success\n";
    },
    diagnostic: (value) => {
      diagnostics.push(value);
    },
  };
  return {
    calls,
    diagnostics,
    context,
    setClock: (n: number) => {
      clock = n;
    },
    now: () => clock,
  };
}

test("package readiness calls exactly the two read-only handlers and does not claim Launcher health or ANR cause", async () => {
  const f = fixture(),
    result = await observeAndroidPackageReadiness(f.context);
  expect(f.calls).toEqual([
    { args: ["pm", "wait-for-handler", "--timeout", "15000"], timeout: 15000 },
    { args: ["pm", "wait-for-background-handler", "--timeout", "15000"], timeout: 15000 },
  ]);
  expect(result).toMatchObject({
    handlersCompleted: ["foreground", "background"],
    handlerTimeoutsMs: [15000, 15000],
    commandsCompleted: 2,
    rootCauseConfirmed: false,
    launcherReadinessVerified: false,
    dialogDismissed: false,
  });
  expect(f.diagnostics.at(-1)).toEqual({
    stage: "complete",
    commandsCompleted: 2,
    timeoutMs: 15000,
    failureCode: null,
  });
  expect(JSON.stringify(f.diagnostics)).not.toMatch(/emulator|runtime_|Success/);
  for (const patch of [
    { rootCauseConfirmed: true },
    { launcherReadinessVerified: true },
    { dialogDismissed: true },
    { commandsCompleted: 3 },
    { handlerTimeoutsMs: [15001, 15000] },
    { rawOutput: "SYNTHETIC_PRIVATE" },
  ])
    expect(androidPackageReadinessSchema.safeParse({ ...result, ...patch }).success).toBe(false);
});

test("the second native/host timeout consumes only the remainder of the existing shared deadline", async () => {
  const f = fixture();
  f.context.deadline = 20000;
  f.context.shell = async (args, timeout) => {
    f.calls.push({ args, timeout });
    f.setClock(f.now() + (f.calls.length === 1 ? 14000 : 5000));
    return "Success";
  };
  expect((await observeAndroidPackageReadiness(f.context)).handlerTimeoutsMs).toEqual([
    15000, 6000,
  ]);
  expect(f.calls[1]?.timeout).toBe(6000);
  expect(f.now()).toBe(19000);
});

for (const patch of [
  { deviceSerial: "emulator-user-device" },
  { avdName: "personal_avd" },
  { freshOwnedEmulator: false },
  { productLaunchStarted: true },
  { captureBoundaryEntered: true },
] as const) {
  test(`readiness refuses unowned/post-product state before any IO: ${Object.keys(patch)[0]}`, async () => {
    const f = fixture();
    await expect(observeAndroidPackageReadiness({ ...f.context, ...patch })).rejects.toThrow(
      "ANDROID_PACKAGE_MANAGER_OWNED_PREFLIGHT_REQUIRED",
    );
    expect(f.calls).toEqual([]);
  });
}
for (const deadline of [0, -1, 120001, Infinity, NaN]) {
  test(`invalid shared deadline cannot create readiness: ${String(deadline)}`, async () => {
    const f = fixture();
    await expect(observeAndroidPackageReadiness({ ...f.context, deadline })).rejects.toThrow(
      "ANDROID_PACKAGE_MANAGER_DEADLINE_INVALID",
    );
    expect(f.calls).toEqual([]);
  });
}
for (const output of [
  "",
  "Success\nSYNTHETIC_PRIVATE",
  "Timeout. PackageManager handlers are still busy.",
  "Unknown command: wait-for-handler",
]) {
  test(`unconfirmed native output is not a successful readiness observation: ${output.slice(0, 10)}`, async () => {
    const f = fixture();
    f.context.shell = async (args, timeout) => {
      f.calls.push({ args, timeout });
      return output;
    };
    await expect(observeAndroidPackageReadiness(f.context)).rejects.toThrow(
      "ANDROID_PACKAGE_MANAGER_UNCONFIRMED",
    );
    expect(f.calls).toHaveLength(1);
    expect(f.diagnostics.at(-1)?.commandsCompleted).toBe(0);
    expect(JSON.stringify(f.diagnostics)).not.toMatch(
      /SYNTHETIC_PRIVATE|Unknown command|handlers are still busy/,
    );
  });
}

test("a failed background command retains the successful first handler but cannot retry or publish full readiness", async () => {
  const f = fixture(),
    base = f.context.shell;
  f.context.shell = async (args, timeout) => {
    if (args[1] === "wait-for-background-handler") {
      f.calls.push({ args, timeout });
      throw Error("SYNTHETIC_PRIVATE_ERROR");
    }
    return base(args, timeout);
  };
  await expect(observeAndroidPackageReadiness(f.context)).rejects.toThrow(
    "ANDROID_PACKAGE_MANAGER_WAIT_FAILED",
  );
  expect(f.calls).toHaveLength(2);
  expect(f.diagnostics.at(-1)).toMatchObject({
    stage: "background",
    commandsCompleted: 1,
    failureCode: "ANDROID_PACKAGE_MANAGER_WAIT_FAILED",
  });
  expect(JSON.stringify(f.diagnostics)).not.toContain("SYNTHETIC_PRIVATE");
});

test("late success and clock rollback fail instead of resetting or extending the deadline", async () => {
  for (const late of [true, false]) {
    const f = fixture();
    f.context.deadline = 100;
    f.context.shell = async (args, timeout) => {
      f.calls.push({ args, timeout });
      f.setClock(late ? 100 : -1);
      return "Success";
    };
    await expect(observeAndroidPackageReadiness(f.context)).rejects.toThrow(
      "ANDROID_PACKAGE_MANAGER_DEADLINE_EXPIRED",
    );
    expect(f.calls).toHaveLength(1);
    expect(f.diagnostics.at(-1)?.commandsCompleted).toBe(0);
  }
});

test("native runner keeps post-install readiness, unchanged Launcher and first Home inside the same deadline and quick gate", async () => {
  const source = await Bun.file("scripts/mobile-internal-android-home.ts").text();
  const install = source.indexOf('phase = "install"'),
    deadline = source.indexOf("const firstColdDeadline = Date.now() + 120000"),
    packages = source.indexOf("packageManagerReady = await observeAndroidPackageReadiness"),
    launcher = source.indexOf("launcherBaseline = await observeAndroidLauncherBaseline"),
    home = source.indexOf("for (let attempt = 1; attempt <= 2; attempt++)");
  expect(install).toBeLessThan(deadline);
  expect(deadline).toBeLessThan(packages);
  expect(packages).toBeLessThan(launcher);
  expect(launcher).toBeLessThan(home);
  expect(source.slice(packages, launcher)).toContain("deadline: firstColdDeadline");
  expect(source.slice(launcher, home)).toContain("deadline: firstColdDeadline");
  expect(source.slice(home)).toContain("attempt === 1 ? firstColdDeadline : Date.now() + 120000");
  expect(
    validationCommands("quick").some((c) =>
      c.includes("tests/mobile-android-package-readiness.test.ts"),
    ),
  ).toBe(true);
  const args = ["/owned/platform-tools/adb", "-s", "emulator-5580", "shell"];
  expect(
    androidNativeCommandOperation([...args, "pm", "wait-for-handler", "--timeout", "15000"]),
  ).toBe("package-manager-wait");
  expect(androidNativeCommandOperation([...args, "pm", "clear", "SYNTHETIC_PACKAGE"])).toBe(
    "other",
  );
  expect(
    androidNativeCommandOperation([...args, "pm", "wait-for-handler", "--timeout", "15001"]),
  ).toBe("other");
});

test("a deadline consumed by final observation cannot publish readiness even after both native barriers succeed", async () => {
  const f = fixture();
  f.context.deadline = 5000;
  const report = f.context.diagnostic;
  f.context.diagnostic = (value) => {
    report(value);
    if (value.stage === "complete" && value.failureCode === null) f.setClock(5000);
  };
  await expect(observeAndroidPackageReadiness(f.context)).rejects.toThrow(
    "ANDROID_PACKAGE_MANAGER_DEADLINE_EXPIRED",
  );
  expect(f.calls).toHaveLength(2);
  expect(f.diagnostics.at(-1)).toMatchObject({
    commandsCompleted: 2,
    failureCode: "ANDROID_PACKAGE_MANAGER_DEADLINE_EXPIRED",
  });
});
