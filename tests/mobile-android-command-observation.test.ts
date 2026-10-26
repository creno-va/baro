import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  androidHierarchyDumpOutcome,
  androidNativeCommandFailureSchema,
  androidNativeCommandOperation,
  androidPostBoundaryCommandFailures,
  runAndroidHomeCommand,
} from "../scripts/mobile-android-command-observation";

const file = "/sdcard/baro-directory-00000000-0000-0000-0000-000000000000.xml";
const adb = (...args: string[]) => [
  "/owned/platform-tools/adb",
  "-s",
  "emulator-5580",
  "shell",
  ...args,
];
test("native command diagnostics classify only fixed operations and reject payload fields or inconsistent failure facts", () => {
  for (const [args, operation] of [
    [["uiautomator", "dump", "--compressed", file], "hierarchy-dump"],
    [["uiautomator", "dump", "--compressed", "--windows", file], "hierarchy-dump-all-windows"],
    [["cat", file], "file-read"],
    [["rm", "-f", file], "file-remove"],
    [["dumpsys", "window", "displays"], "display-read"],
    [["dumpsys", "activity", "activities"], "activity-read"],
    [["settings", "get", "secure", "default_input_method"], "ime-read"],
    [["settings", "get", "system", "user_rotation"], "rotation-setting"],
    [["wm", "user-rotation", "lock", "0"], "rotation-control"],
    [["input", "tap", "123", "456"], "tap"],
    [["input", "swipe", "1", "2", "3", "4"], "swipe"],
    [["input", "text", "synthetic-private-state"], "input-text"],
    [["input", "keyevent", "KEYCODE_BACK"], "keyevent"],
    [["unknown", "synthetic-private-state"], "other"],
  ] as const)
    expect(androidNativeCommandOperation(adb(...args))).toBe(operation);
  expect(androidNativeCommandOperation(["adb", "shell", "synthetic-private-state"])).toBe("other");
  const failure = {
    operation: "file-read",
    category: "nonzero-exit",
    exitCode: 1,
    timedOut: false,
  } as const;
  for (const patch of [
    { stdout: "synthetic-private-state" },
    { args: [file] },
    { exitCode: 0 },
    { timedOut: true },
    { operation: file },
  ])
    expect(androidNativeCommandFailureSchema.safeParse({ ...failure, ...patch }).success).toBe(
      false,
    );
  const tracker = androidPostBoundaryCommandFailures();
  tracker.record(androidNativeCommandFailureSchema.parse(failure));
  tracker.record({
    operation: "rotation-control",
    category: "timeout",
    exitCode: 143,
    timedOut: true,
  });
  expect(tracker.snapshot()).toEqual({
    count: 2,
    first: failure,
    last: { operation: "rotation-control", category: "timeout", exitCode: 143, timedOut: true },
  });
  const snapshot = tracker.snapshot();
  if (snapshot.first) snapshot.first.exitCode = 200;
  expect(tracker.snapshot().first?.exitCode).toBe(1);
  expect(JSON.stringify(tracker.snapshot())).not.toContain("synthetic-private-state");
});

test("UIAutomator saved/idle/root diagnostics use fixed stdout and stderr signatures without retaining either", () => {
  const saved = `UI hierchary dumped to: ${file}\n`;
  expect(androidHierarchyDumpOutcome(saved, "", file)).toBe("saved");
  const launcherFile = file.replace("baro-directory-", "baro-launcher-");
  expect(
    androidHierarchyDumpOutcome(`UI hierchary dumped to: ${launcherFile}\n`, "", launcherFile),
  ).toBe("saved");
  expect(
    androidHierarchyDumpOutcome(
      "",
      "",
      "/sdcard/baro-launcher-------------------------------------.xml",
    ),
  ).toBe("unknown");
  expect(androidHierarchyDumpOutcome("", "ERROR: could not get idle state.\n", file)).toBe(
    "idle-timeout",
  );
  expect(
    androidHierarchyDumpOutcome(
      "",
      "ERROR: null root node returned by UiTestAutomationBridge.\n",
      file,
    ),
  ).toBe("root-unavailable");
  for (const [out, err, path] of [
    [saved, "ERROR: could not get idle state.", file],
    [saved + saved, "", file],
    [saved, "", "/unowned.xml"],
    ["UI hierchary dumped to: /other.xml", "", file],
    ["synthetic-private-state", "", file],
    ["x".repeat(65537), "", file],
  ])
    expect(androidHierarchyDumpOutcome(out ?? "", err ?? "", path ?? "")).toBe("unknown");
});

test("bounded real subprocesses preserve output and stdin in memory while failure reports contain no raw output or argv", async () => {
  const directory = await mkdtemp(join(tmpdir(), "baro-native-command-")),
    executable = join(directory, process.platform === "win32" ? "adb.cmd" : "adb"),
    script = process.platform === "win32" ? join(directory, "fixture.ts") : executable;
  try {
    await Bun.write(
      script,
      // CMD is only a fixture launcher. Bound its synthetic child separately so
      // killing that launcher cannot leave an orphan holding the pipe open.
      `#!${process.execPath}\nconst mode=process.env.BARO_FIXTURE_CASE;\nif(mode==='timeout'){${process.platform === "win32" ? "setTimeout(()=>process.exit(0),1000);" : ""}setInterval(()=>{},1000);await new Promise(()=>{});}\nelse if(mode==='stdin'){process.stdout.write(await Bun.stdin.text());}\nelse if(mode==='idle'){process.stderr.write('ERROR: could not get idle state.\\n');}\nelse if(mode==='failure'){process.stdout.write('synthetic-private-state');process.stderr.write('synthetic-private-error');process.exitCode=7;}\nelse{process.stdout.write('UI hierchary dumped to: '+process.argv.at(-1)+'\\n');}\n`,
    );
    if (process.platform === "win32")
      await Bun.write(executable, `@echo off\r\n"${process.execPath}" "%~dp0fixture.ts" %*\r\n`);
    await chmod(executable, 0o700);
    const args = [
      executable,
      "-s",
      "emulator-5580",
      "shell",
      "uiautomator",
      "dump",
      "--compressed",
      file,
    ];
    for (const mode of ["saved", "idle", "failure", "timeout", "stdin"]) {
      const failures = androidPostBoundaryCommandFailures(),
        dumps: string[] = [];
      const context = {
        args,
        cwd: directory,
        env: { BARO_FIXTURE_CASE: mode },
        timeoutMs: mode === "timeout" ? 100 : 5000,
        onFailure: failures.record,
        onHierarchyDump: (outcome: string) => {
          dumps.push(outcome);
        },
        ...(mode === "stdin" ? { input: "synthetic-private-input" } : {}),
      };
      if (mode === "failure" || mode === "timeout") {
        await expect(runAndroidHomeCommand(context)).rejects.toThrow("BUNDLED_HOME_COMMAND_FAILED");
        expect(failures.snapshot().count).toBe(1);
        expect(failures.snapshot().first?.category).toBe(
          mode === "timeout" ? "timeout" : "nonzero-exit",
        );
        expect(failures.snapshot().first?.timedOut).toBe(mode === "timeout");
        if (mode === "failure") expect(failures.snapshot().first?.exitCode).toBe(7);
      } else {
        const body = new TextDecoder().decode(await runAndroidHomeCommand(context));
        expect(failures.snapshot().count).toBe(0);
        if (mode === "saved") expect(body).toBe(`UI hierchary dumped to: ${file}\n`);
        if (mode === "idle") expect(dumps).toEqual(["idle-timeout"]);
        if (mode === "stdin") expect(body).toBe("synthetic-private-input");
      }
      expect(JSON.stringify({ failures: failures.snapshot(), dumps })).not.toContain(
        "synthetic-private",
      );
    }
    const failures = androidPostBoundaryCommandFailures();
    await expect(
      runAndroidHomeCommand({
        args: [join(directory, "missing-private-file")],
        cwd: directory,
        env: {},
        onFailure: failures.record,
      }),
    ).rejects.toThrow("BUNDLED_HOME_COMMAND_FAILED");
    expect(failures.snapshot().first?.category).toBe("spawn-or-stream-failed");
    for (const timeoutMs of [0, 120001, Number.NaN]) {
      const invalid = androidPostBoundaryCommandFailures();
      await expect(
        runAndroidHomeCommand({
          args: [executable],
          cwd: directory,
          env: {},
          timeoutMs,
          onFailure: invalid.record,
        }),
      ).rejects.toThrow("BUNDLED_HOME_COMMAND_FAILED");
      expect(invalid.snapshot().count).toBe(0);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);

test("auth dump classification accepts only its fresh owned sdcard file, including errors on stderr", () => {
  const auth = file.replace("baro-directory-", "baro-auth-");
  expect(androidHierarchyDumpOutcome(`UI hierchary dumped to: ${auth}\n`, "", auth)).toBe("saved");
  expect(
    androidHierarchyDumpOutcome(
      `UI hierchary dumped to: ${auth}\n`,
      "ERROR: could not get idle state.",
      auth,
    ),
  ).toBe("unknown");
  expect(
    androidHierarchyDumpOutcome(
      "",
      "ERROR: null root node returned by UiTestAutomationBridge.\n",
      auth,
    ),
  ).toBe("root-unavailable");
  expect(
    androidHierarchyDumpOutcome(
      `UI hierchary dumped to: ${auth}`,
      "",
      auth.replace("/sdcard/", "/data/local/tmp/"),
    ),
  ).toBe("unknown");
});

test("IME references confirm only their exact owned UUID dump path and retain failure outcomes", () => {
  const ime = file.replace("baro-directory-", "baro-ime-");
  expect(androidHierarchyDumpOutcome(`UI hierchary dumped to: ${ime}`, "", ime)).toBe("saved");
  expect(androidHierarchyDumpOutcome(`UI hierchary dumped to: ${ime}`, "", file)).toBe("unknown");
  expect(androidHierarchyDumpOutcome("ERROR: could not get idle state.", "", ime)).toBe(
    "idle-timeout",
  );
  expect(
    androidHierarchyDumpOutcome(
      `UI hierchary dumped to: ${ime}`,
      "",
      ime.replace("00000000", "invalid"),
    ),
  ).toBe("unknown");
});
