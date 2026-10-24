import { expect, test } from "bun:test";
import { androidAuthenticationPrivacyBoundary } from "../scripts/mobile-android-auth-cancel";
import {
  androidDirectoryDisplay,
  androidDirectoryFailureCode,
  androidDirectoryInputObservation,
  androidDirectoryReceiptSchema,
  androidDirectoryRotation,
  directorySyntheticInput,
  observeAndroidDirectoryInput,
  verifyAndroidDirectoryReceipt,
} from "../scripts/mobile-android-directory-input";
import { androidHomeObservationOptions } from "../scripts/mobile-android-guide-ui";

const appId = "site.baro.app.preview";
const xml = (...nodes: string[]) => `<?xml version="1.0"?><hierarchy>${nodes.join("")}</hierarchy>`;
const node = (extra: string, box = "[40,300][1000,450]", pkg = appId) =>
  `<node package="${pkg}" enabled="true" bounds="${box}" ${extra}/>`;
const dump = (rotation = 0, keyboard = false) =>
  `DisplayFrames w=${rotation === 1 ? 2400 : 1080} h=${rotation === 1 ? 1080 : 2400} r=${rotation}\n  InsetsSource id=3 type=ime frame=${keyboard ? "[0,1500][1080,2400]" : "[0,0][0,0]"} visible=${keyboard} flags= sideHint=BOTTOM boundingRects=null`;
function nativeFixture(
  previousMode: "free" | "lock" = "free",
  failForeground = false,
  failRestore = false,
) {
  let rotation = 0,
    userRotation = 2,
    mode = previousMode,
    directory = false,
    focused = false,
    keyboard = false,
    typed = false,
    submitted = false;
  const commands: string[][] = [],
    diagnostics: unknown[] = [];
  return {
    commands,
    diagnostics,
    state: () => ({ mode, userRotation }),
    context: {
      deviceSerial: "emulator-5580",
      avdName: "baro_runtime_abcdef123456",
      freshOwnedEmulator: true,
      screenshotsSuppressed: true,
      captureBoundaryEntered: true,
      diagnostic(value: unknown) {
        diagnostics.push(value);
      },
      async shell(args: string[]) {
        commands.push(args);
        const command = args.join(" ");
        if (command === "wm user-rotation")
          return mode === "free" ? "free\n" : `lock ${userRotation}\n`;
        if (command === "settings get system user_rotation") return `${userRotation}\n`;
        if (args[0] === "wm" && args[2] === "lock") {
          rotation = Number(args[3]);
          userRotation = rotation;
          mode = "lock";
          if (failRestore && rotation === 2) userRotation = 1;
          return "";
        }
        if (command === "wm user-rotation free") {
          mode = "free";
          rotation = 0;
          return "";
        }
        if (command === "dumpsys activity activities") {
          if (failForeground) throw Error("synthetic-command-failed");
          return `topResumedActivity=ActivityRecord{a u0 ${appId}/.MainActivity t3}`;
        }
        if (command === "dumpsys window displays") return dump(rotation, keyboard);
        if (args[0] === "uiautomator" || args[0] === "rm") return "";
        if (args[0] === "cat")
          return xml(
            node(
              'class="android.widget.FrameLayout"',
              `[0,90][${rotation === 1 ? 2400 : 1080},${rotation === 1 ? 1050 : 2350}]`,
            ),
            ...(!directory
              ? [
                  node('text="내 상황을 차근차근 정리해요."'),
                  node('text="변호사 탐색" clickable="true"'),
                ]
              : [
                  node(
                    `class="android.widget.EditText" content-desc="이름으로 검색" focused="${focused}" text="${typed ? directorySyntheticInput : ""}"`,
                  ),
                  node(
                    `text="${submitted ? "검색 결과가 없어요" : "공개된 프로필을 준비하고 있어요"}"`,
                  ),
                ]),
          );
        if (args[0] === "input" && args[1] === "tap") {
          if (!directory) directory = true;
          else {
            focused = true;
            keyboard = true;
          }
          return "";
        }
        if (args[0] === "input" && args[1] === "text") {
          expect(args[2]).toBe(directorySyntheticInput);
          typed = true;
          return "";
        }
        if (command === "input keyevent KEYCODE_ENTER") {
          submitted = true;
          keyboard = false;
          focused = false;
          return "";
        }
        if (command === "input keyevent KEYCODE_BACK") {
          directory = false;
          return "";
        }
        if (args[0] === "input" && args[1] === "swipe") return "";
        throw Error("SYNTHETIC_UNEXPECTED_COMMAND");
      },
    },
  };
}
test("Android input mode is isolated and public data irreversibly blocks capture/raw diagnostic commands", () => {
  expect(androidHomeObservationOptions(["--directory-input"]).directoryInput).toBe(true);
  for (const options of [
    ["--directory-input", "--auth-cancel"],
    ["--directory-input", "--public-directory"],
    ["--directory-input", "--large-font"],
    ["--directory-input", "--guide-ui"],
    ["--directory-input", "--directory-input"],
  ])
    expect(() => androidHomeObservationOptions(options)).toThrow();
  const privacy = androidAuthenticationPrivacyBoundary();
  privacy.enterPublicData();
  for (const command of [
    ["adb", "exec-out", "screencap", "-p"],
    ["adb", "logcat"],
    ["adb", "bugreport"],
    ["adb", "shell", "screenrecord"],
  ])
    expect(() => privacy.assertCommandAllowed(command)).toThrow();
  privacy.enterAuthentication();
  privacy.enterPublicData();
  expect(privacy.entered).toBe(true);
});
test("display observation rejects ambiguous or malformed native state and uses actual IME visibility/geometry", () => {
  expect(androidDirectoryDisplay(dump(0, true))).toEqual({
    width: 1080,
    height: 2400,
    rotation: 0,
    keyboardVisible: true,
    keyboardTop: 1500,
  });
  expect(androidDirectoryDisplay(dump()).keyboardVisible).toBe(false);
  for (const output of [
    "",
    `${dump()}\n${dump()}`,
    dump().replace("type=ime", "type=statusBars"),
    dump().replace("r=0", "r=4"),
    dump(0, true).replace("[0,1500][1080,2400]", "[0,1500][1081,2400]"),
    dump(0, true).replace("[0,1500][1080,2400]", "[0,0][0,0]"),
  ])
    expect(() => androidDirectoryDisplay(output)).toThrow();
  expect(androidDirectoryRotation("lock 2\n")).toEqual({ mode: "lock", rotation: 2 });
  expect(androidDirectoryRotation("free\n")).toEqual({ mode: "free", rotation: null });
  for (const value of ["lock", "lock 9", "free 1", "lock 0\nprivate"])
    expect(() => androidDirectoryRotation(value)).toThrow();
});
test("input matching requires the owned native EditText and never returns its text or public profile values", () => {
  const field = node(
    `class="android.widget.EditText" content-desc="이름으로 검색" text="${directorySyntheticInput}" focused="true"`,
  );
  const valid = androidDirectoryInputObservation(
    xml(field, node('text="synthetic-private-profile"')),
    1080,
    2400,
  );
  expect(valid.syntheticInputRetained).toBe(true);
  expect(valid.focused).toBe(true);
  expect(valid.input).not.toBeNull();
  expect(JSON.stringify(valid)).not.toContain(directorySyntheticInput);
  expect(JSON.stringify(valid)).not.toContain("synthetic-private-profile");
  for (const invalid of [
    xml(field, field),
    xml(field.replace(appId, "other.app")),
    xml(field.replace("android.widget.EditText", "android.widget.TextView")),
    xml(field.replace('enabled="true"', 'enabled="false"')),
    xml(field.replace("[40,300][1000,450]", "[40,300][1100,450]")),
  ])
    expect(androidDirectoryInputObservation(invalid, 1080, 2400).input).toBeNull();
  expect(() =>
    androidDirectoryInputObservation(
      '<?xml version="1.0"?><!DOCTYPE private><hierarchy/>',
      1080,
      2400,
    ),
  ).toThrow();
});
test("observer refuses unowned devices/boundaries before commands and restores the rotation preference on success and failure", async () => {
  for (const patch of [
    { screenshotsSuppressed: false },
    { captureBoundaryEntered: false },
    { freshOwnedEmulator: false },
    { deviceSerial: "physical" },
    { avdName: "user-avd" },
  ]) {
    const fixture = nativeFixture();
    await expect(observeAndroidDirectoryInput({ ...fixture.context, ...patch })).rejects.toThrow();
    expect(fixture.commands).toHaveLength(0);
  }
  for (const mode of ["free", "lock"] as const) {
    const fixture = nativeFixture(mode);
    const result = await observeAndroidDirectoryInput(fixture.context);
    expect(result.systemBackCount).toBe(1);
    expect(result.rotationPreferenceRestored).toBe(true);
    expect(result.landscapeDisplay).toEqual({ width: 2400, height: 1080, rotation: 1 });
    expect(fixture.state()).toEqual({ mode, userRotation: 2 });
    expect(
      fixture.commands.filter((c) => c.join(" ") === "input keyevent KEYCODE_BACK"),
    ).toHaveLength(1);
    expect(fixture.commands.filter((c) => c[0] === "uiautomator").length).toBe(
      fixture.commands.filter((c) => c[0] === "rm").length,
    );
    expect(JSON.stringify(fixture.diagnostics)).not.toContain(directorySyntheticInput);
  }
  const failure = nativeFixture("free", true);
  await expect(observeAndroidDirectoryInput(failure.context)).rejects.toThrow(
    "synthetic-command-failed",
  );
  expect(failure.state()).toEqual({ mode: "free", userRotation: 2 });
  const badRestore = nativeFixture("lock", false, true);
  await expect(observeAndroidDirectoryInput(badRestore.context)).rejects.toThrow(
    "ANDROID_DIRECTORY_ROTATION_RESTORE_FAILED",
  );
  expect(androidDirectoryFailureCode(Error("private-url-state"))).toBe(
    "ANDROID_DIRECTORY_COMMAND_FAILED",
  );
});
test("strict proof binds original binary/compiler baseline/device and rejects broader claims or incomplete window rotation", async () => {
  const old = await Bun.file(
    "docs/quality/mobile-internal-android-2026-10-23/guide-ui-346c920.json",
  ).json();
  const result = await observeAndroidDirectoryInput(nativeFixture().context);
  const value = {
    ...androidDirectoryReceiptSchema
      .omit({
        kind: true,
        result: true,
        adbCommandOutputPersisted: true,
        rawDumpsysExported: true,
        publicDataNavigation: true,
        profileOpened: true,
        contactOpened: true,
        remoteMutationPerformed: true,
        authenticationNavigation: true,
        privateDataAccess: true,
        httpTransportSeparatelyObserved: true,
        koreanKeyboardVerified: true,
      })
      .strip()
      .parse(old),
    kind: "bundled-android-public-directory-input-ui-only",
    result,
    adbCommandOutputPersisted: false,
    rawDumpsysExported: false,
    publicDataNavigation: true,
    profileOpened: false,
    contactOpened: false,
    remoteMutationPerformed: false,
    authenticationNavigation: false,
    privateDataAccess: false,
    httpTransportSeparatelyObserved: false,
    koreanKeyboardVerified: false,
  };
  const parsed = verifyAndroidDirectoryReceipt(value, old);
  expect(parsed.result.submitMethod).toBe("hardware-enter");
  for (const patch of [
    { toolingSourceSha: "a".repeat(40) },
    { binarySourceSha: "b".repeat(40) },
    { verificationSha256: "c".repeat(64) },
    { baselineReceiptSha256: "d".repeat(64) },
    { device: { ...old.device, model: "other" } },
    { binary: { ...old.binary, bytes: old.binary.bytes + 1 } },
    { screenshotsSuppressedBeforeNavigation: false },
    { adbCommandOutputPersisted: true },
    { rawDumpsysExported: true },
    { oauthVerified: true },
    { remoteApiVerified: true },
    { allScreensVerified: true },
    { physicalDeviceVerified: true },
    { profileName: "private" },
  ])
    expect(() => verifyAndroidDirectoryReceipt({ ...value, ...patch }, old)).toThrow();
  for (const patch of [
    { keyboardDismissed: false },
    { landscapeDisplay: { width: 1080, height: 2400, rotation: 1 } },
    { landscapeDisplay: { width: 2500, height: 1080, rotation: 1 } },
    { portraitInputRetained: false },
    { rotationPreferenceRestored: false },
    { systemBackCount: 2 },
    { query: directorySyntheticInput },
  ])
    expect(() =>
      verifyAndroidDirectoryReceipt({ ...value, result: { ...result, ...patch } }, old),
    ).toThrow();
});
test("workflow gates the isolated mode and exports only fixed observation paths", async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file(".github/workflows/mobile-internal-android-compiled-reverify.yml").text(),
  ) as {
    jobs: { verify: { steps: { if?: string; run?: string; with?: Record<string, string> }[] } };
  };
  const steps = workflow.jobs.verify.steps;
  expect(
    steps.some(
      (s) =>
        s.if ===
          "inputs.directory_input && (!inputs.smoke || inputs.large_font || inputs.public_directory || inputs.guide_ui || inputs.auth_cancel)" &&
        s.run === "exit 1",
    ),
  ).toBe(true);
  expect(
    steps.some(
      (s) =>
        s.if === "inputs.directory_input" &&
        s.run === "test -s .wrangler/mobile-internal-android-runtime/directory-input.json",
    ),
  ).toBe(true);
  const output = steps.find((s) =>
    s.with?.name?.startsWith("mobile-internal-android-compiled-home-"),
  )?.with?.path;
  expect(output).toContain("directory-input.json");
  expect(output).not.toMatch(/\*|xml|log|dump/);
});
