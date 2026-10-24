import { randomUUID } from "node:crypto";
import { z } from "zod";
import { androidAuthActivityObservation } from "./mobile-android-auth-cancel";
import { androidHierarchyDumpOutcome } from "./mobile-android-command-observation";
import { androidDirectorySoftwareSearch } from "./mobile-android-directory-search";
import { androidGuideUiReceiptSchema } from "./mobile-android-guide-ui";
import {
  publicDirectoryButton,
  publicDirectoryUiObservation,
} from "./mobile-public-directory-observation";

const appId = "site.baro.app.preview";
export const directorySyntheticInput = "baro-mobile-smoke-20261024";
const codes = [
  "ANDROID_DIRECTORY_IDENTITY_MISMATCH",
  "ANDROID_DIRECTORY_BOUNDARY_REQUIRED",
  "ANDROID_DIRECTORY_OWNED_EMULATOR_REQUIRED",
  "ANDROID_DIRECTORY_HIERARCHY_INVALID",
  "ANDROID_DIRECTORY_DUMP_OUTPUT_INVALID",
  "ANDROID_DIRECTORY_DISPLAY_INVALID",
  "ANDROID_DIRECTORY_ROTATION_INVALID",
  "ANDROID_DIRECTORY_FOREGROUND_MISSING",
  "ANDROID_DIRECTORY_HOME_MISSING",
  "ANDROID_DIRECTORY_CONTROL_MISSING",
  "ANDROID_DIRECTORY_READY_MISSING",
  "ANDROID_DIRECTORY_KEYBOARD_MISSING",
  "ANDROID_DIRECTORY_INPUT_OCCLUDED",
  "ANDROID_DIRECTORY_INPUT_NOT_RETAINED",
  "ANDROID_DIRECTORY_SOFTWARE_SEARCH_MISSING",
  "ANDROID_DIRECTORY_KEYBOARD_NOT_DISMISSED",
  "ANDROID_DIRECTORY_SEARCH_EMPTY_MISSING",
  "ANDROID_DIRECTORY_LANDSCAPE_MISSING",
  "ANDROID_DIRECTORY_PORTRAIT_MISSING",
  "ANDROID_DIRECTORY_HOME_RETURN_MISSING",
  "ANDROID_DIRECTORY_ROTATION_RESTORE_FAILED",
] as const;
export function androidDirectoryFailureCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return codes.find((code) => code === message) ?? "ANDROID_DIRECTORY_COMMAND_FAILED";
}
function nodes(xml: string) {
  if (xml.length > 1_000_000 || !xml.startsWith("<?xml") || /<!DOCTYPE|<!ENTITY/.test(xml))
    throw Error("ANDROID_DIRECTORY_HIERARCHY_INVALID");
  const matches = [...xml.matchAll(/<node\b[^>]*>/g)];
  if (matches.length > 10000) throw Error("ANDROID_DIRECTORY_HIERARCHY_INVALID");
  return matches
    .map((node) =>
      Object.fromEntries(
        [...node[0].matchAll(/([\w:-]+)="([^"]*)"/g)].map((attr) => [attr[1], attr[2]]),
      ),
    )
    .filter(
      (node) =>
        node.package === appId && node.enabled === "true" && node["visible-to-user"] !== "false",
    );
}
function bounds(value: string | undefined, width: number, height: number) {
  const match = value?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
  if (!match) return null;
  const [left, top, right, bottom] = match.slice(1).map(Number);
  if (
    left === undefined ||
    top === undefined ||
    right === undefined ||
    bottom === undefined ||
    ![left, top, right, bottom, width, height].every(
      (n) => Number.isSafeInteger(n) && n >= 0 && n <= 8192,
    ) ||
    right <= left ||
    bottom <= top ||
    right > width ||
    bottom > height
  )
    return null;
  return { left, top, right, bottom };
}
const displaySchema = z.strictObject({
  width: z.number().int().min(1).max(8192),
  height: z.number().int().min(1).max(8192),
  rotation: z.number().int().min(0).max(3),
});
function displayParts(output: string) {
  if (output.length > 4_000_000) throw Error("ANDROID_DIRECTORY_DISPLAY_INVALID");
  const lines = output.split(/\r?\n/);
  const frames = [...output.matchAll(/\bDisplayFrames w=(\d+) h=(\d+) r=([0-3])\b/g)];
  const controllers = lines.flatMap((line, index) =>
    line.trim() === "WindowInsetsStateController" ? [index] : [],
  );
  const start = controllers.length === 1 ? controllers[0] : undefined;
  const end =
    start === undefined
      ? -1
      : lines.findIndex((line, index) => index > start && line.trim() === "Control map:");
  const raw = start !== undefined && end > start ? lines.slice(start + 1, end) : [];
  const rawFrames = raw.flatMap((line) => {
    const match = line.match(/\bmDisplayFrame=Rect\(0, 0 - (\d+), (\d+)\)/);
    return match ? [match] : [];
  });
  const source = (line: string) => /\bInsetsSource id=[a-f0-9]+ type=ime(?:[ \t]|$)/.test(line);
  return {
    frames,
    controllers,
    rawFrames,
    rawDisplayFrameMarkers: raw.filter((line) => /\bmDisplayFrame=/.test(line)),
    rawStates: raw.filter((line) => line.trim() === "InsetsState"),
    ime: raw.filter(source),
    imeMarkers: raw.filter((line) => /\bime\b/i.test(line)),
    allImeSources: lines.filter(source),
    rawSectionFound: start !== undefined && end > start,
  };
}
/** Counts/booleans only. Raw display/window output never leaves this module. */
export function androidDirectoryDisplayShape(output: string) {
  if (output.length > 4_000_000)
    return {
      outputWithinBound: false,
      controllerCount: null,
      displayFrameCount: null,
      displayFrameMarkerCount: null,
      rawDisplayFrameMarkerCount: null,
      rawStateCount: null,
      rawDisplayFrameCount: null,
      rawSectionFound: false,
      rawImeMarkerCount: null,
      rawImeSourceCount: null,
      allImeSourceCount: null,
    };
  const p = displayParts(output);
  return {
    outputWithinBound: true,
    controllerCount: p.controllers.length,
    displayFrameCount: p.frames.length,
    displayFrameMarkerCount: [...output.matchAll(/\bDisplayFrames\b/g)].length,
    rawDisplayFrameMarkerCount: p.rawDisplayFrameMarkers.length,
    rawStateCount: p.rawStates.length,
    rawDisplayFrameCount: p.rawFrames.length,
    rawSectionFound: p.rawSectionFound,
    rawImeMarkerCount: p.imeMarkers.length,
    rawImeSourceCount: p.ime.length,
    allImeSourceCount: p.allImeSources.length,
  };
}
export function androidDirectoryDisplay(output: string) {
  const parts = displayParts(output),
    frame = parts.frames[0],
    rawFrame = parts.rawFrames[0],
    source = parts.ime[0];
  if (
    parts.frames.length !== 1 ||
    parts.controllers.length !== 1 ||
    !parts.rawSectionFound ||
    parts.rawStates.length !== 1 ||
    parts.rawFrames.length !== 1 ||
    !frame ||
    !rawFrame ||
    parts.ime.length > 1 ||
    parts.imeMarkers.length !== parts.ime.length
  )
    throw Error("ANDROID_DIRECTORY_DISPLAY_INVALID");
  const display = displaySchema.parse({
    width: Number(frame[1]),
    height: Number(frame[2]),
    rotation: Number(frame[3]),
  });
  if (Number(rawFrame[1]) !== display.width || Number(rawFrame[2]) !== display.height)
    throw Error("ANDROID_DIRECTORY_DISPLAY_INVALID");
  // A fresh display can have no IME source until the keyboard window exists.
  // Absence is accepted only inside the complete, dimension-matched raw InsetsState.
  if (!source)
    return { ...display, imeSourceObserved: false, keyboardVisible: false, keyboardTop: null };
  const visible = source.match(/\bvisible=(true|false)\b/)?.[1],
    rect = source.match(/\bframe=(\[\d+,\d+\]\[\d+,\d+\])/)?.[1];
  if (!visible || !rect) throw Error("ANDROID_DIRECTORY_DISPLAY_INVALID");
  const box = bounds(rect, display.width, display.height);
  if (visible === "true" && !box) throw Error("ANDROID_DIRECTORY_DISPLAY_INVALID");
  return {
    ...display,
    imeSourceObserved: true,
    keyboardVisible: visible === "true",
    keyboardTop: visible === "true" ? (box?.top ?? null) : null,
  };
}
export function androidDirectoryRotation(output: string) {
  const value = output.trim();
  if (value === "free") return { mode: "free" as const, rotation: null };
  const match = value.match(/^lock ([0-3])$/);
  if (!match) throw Error("ANDROID_DIRECTORY_ROTATION_INVALID");
  return { mode: "lock" as const, rotation: Number(match[1]) };
}
export function androidDirectoryInputObservation(xml: string, width: number, height: number) {
  const own = nodes(xml),
    input = own.filter(
      (node) =>
        node.class === "android.widget.EditText" && node["content-desc"] === "이름으로 검색",
    );
  const field = input.length === 1 ? input[0] : undefined;
  const box = field ? bounds(field.bounds, width, height) : null;
  const retained = field?.text === directorySyntheticInput;
  const usable = box && box.right - box.left >= 80 && box.bottom - box.top >= 80 ? box : null;
  const largest = own
    .filter((node) => node.class === "android.widget.FrameLayout")
    .map((node) => bounds(node.bounds, width, height))
    .filter((box) => box !== null)
    .sort(
      (a, b) => (b.right - b.left) * (b.bottom - b.top) - (a.right - a.left) * (a.bottom - a.top),
    )[0];
  const appWindow =
    largest &&
    largest.right - largest.left >= width * 0.8 &&
    largest.bottom - largest.top >= height * 0.5
      ? largest
      : null;
  const labels = own.flatMap((node) => [node.text, node["content-desc"]]);
  return {
    input: usable,
    focused: field?.focused === "true",
    initialEmpty: field?.text === "",
    syntheticInputRetained: retained,
    appWindowLandscape:
      !!appWindow && appWindow.right - appWindow.left > appWindow.bottom - appWindow.top,
    appWindowPortrait:
      !!appWindow && appWindow.bottom - appWindow.top > appWindow.right - appWindow.left,
    filteredEmpty:
      labels.includes("검색 결과가 없어요") &&
      !labels.includes("공개 프로필을 확인하고 있어요") &&
      !labels.includes("목록을 불러오지 못했어요"),
    homeTitle: labels.includes("내 상황을 차근차근 정리해요."),
  };
}
const resultBaseSchema = z.strictObject({
  initialReadyState: z.enum(["empty", "cards"]),
  inputBoundsWithinDisplay: z.literal(true),
  keyboardObserved: z.literal(true),
  focusedInputAboveKeyboard: z.literal(true),
  syntheticAsciiInputRetained: z.literal(true),
  submitMethod: z.literal("hardware-enter"),
  keyboardDismissed: z.literal(true),
  filteredEmptyStateObserved: z.literal(true),
  portraitDisplay: displaySchema.refine((v) => v.rotation === 0 && v.height > v.width),
  landscapeDisplay: displaySchema.refine((v) => v.rotation === 1 && v.width > v.height),
  landscapeAppWindowObserved: z.literal(true),
  landscapeInputRetained: z.literal(true),
  landscapeInputReachable: z.literal(true),
  portraitAppWindowObserved: z.literal(true),
  portraitInputRetained: z.literal(true),
  portraitInputReachable: z.literal(true),
  homeReturnObserved: z.literal(true),
  systemBackCount: z.literal(1),
  rotationPreferenceRestored: z.literal(true),
});
const resultSchema = z
  .discriminatedUnion("submitMethod", [
    resultBaseSchema,
    resultBaseSchema.extend({
      submitMethod: z.literal("software-keyboard-search"),
      searchControlInCurrentImeWindow: z.literal(true),
      searchControlBelowKeyboardTop: z.literal(true),
      searchControlUniqueEnabledClickable: z.literal(true),
      searchControlTapped: z.literal(true),
    }),
  ])
  .refine(
    (v) =>
      v.portraitDisplay.width === v.landscapeDisplay.height &&
      v.portraitDisplay.height === v.landscapeDisplay.width,
  );
export const androidDirectoryBaseSchema = androidGuideUiReceiptSchema.pick({
  version: true,
  toolingSourceSha: true,
  binarySourceSha: true,
  observedAt: true,
  applicationId: true,
  binary: true,
  verificationSha256: true,
  baselineReceiptSha256: true,
  device: true,
  rawHierarchyExported: true,
  screenshotsSuppressedBeforeNavigation: true,
  metroServerStarted: true,
  metroRequests: true,
  allScreensVerified: true,
  talkBackVerified: true,
  voiceOverVerified: true,
  remoteApiVerified: true,
  oauthVerified: true,
  physicalDeviceVerified: true,
  storeSigned: true,
  deployed: true,
});
export const androidDirectoryReceiptSchema = androidDirectoryBaseSchema
  .extend({
    kind: z.enum([
      "bundled-android-public-directory-input-ui-only",
      "bundled-android-public-directory-software-search-ui-only",
    ]),
    adbCommandOutputPersisted: z.literal(false),
    rawDumpsysExported: z.literal(false),
    publicDataNavigation: z.literal(true),
    profileOpened: z.literal(false),
    contactOpened: z.literal(false),
    remoteMutationPerformed: z.literal(false),
    authenticationNavigation: z.literal(false),
    privateDataAccess: z.literal(false),
    httpTransportSeparatelyObserved: z.literal(false),
    koreanKeyboardVerified: z.literal(false),
    result: resultSchema,
  })
  .refine(
    (value) =>
      (value.kind === "bundled-android-public-directory-input-ui-only" &&
        value.result.submitMethod === "hardware-enter") ||
      (value.kind === "bundled-android-public-directory-software-search-ui-only" &&
        value.result.submitMethod === "software-keyboard-search"),
  );
export function verifyAndroidDirectoryReceipt(
  value: unknown,
  expected: Pick<
    z.infer<typeof androidDirectoryReceiptSchema>,
    | "toolingSourceSha"
    | "binarySourceSha"
    | "binary"
    | "verificationSha256"
    | "baselineReceiptSha256"
    | "device"
  >,
) {
  const result = androidDirectoryReceiptSchema.parse(value);
  for (const key of [
    "toolingSourceSha",
    "binarySourceSha",
    "verificationSha256",
    "baselineReceiptSha256",
  ] as const)
    if (result[key] !== expected[key]) throw Error("ANDROID_DIRECTORY_IDENTITY_MISMATCH");
  if (
    result.binary.name !== expected.binary.name ||
    result.binary.bytes !== expected.binary.bytes ||
    result.binary.sha256 !== expected.binary.sha256 ||
    result.device.kind !== expected.device.kind ||
    result.device.model !== expected.device.model ||
    result.device.osVersion !== expected.device.osVersion
  )
    throw Error("ANDROID_DIRECTORY_IDENTITY_MISMATCH");
  return result;
}
export interface AndroidDirectoryDiagnostic {
  stage:
    | "prepare"
    | "home"
    | "ready"
    | "focus"
    | "typed"
    | "submitted"
    | "landscape"
    | "portrait"
    | "home-return"
    | "rotation-restore";
  display: ReturnType<typeof androidDirectoryDisplay> | null;
  displayShape: ReturnType<typeof androidDirectoryDisplayShape> | null;
  input: { present: boolean; focused: boolean; retained: boolean } | null;
  softwareSearchBeforeTap: ReturnType<typeof androidDirectorySoftwareSearch>["diagnostic"] | null;
  primaryFailureCode: ReturnType<typeof androidDirectoryFailureCode> | null;
  rotationRestoreFailureCode: ReturnType<typeof androidDirectoryFailureCode> | null;
  hierarchyCleanupFailureCode: ReturnType<typeof androidDirectoryFailureCode> | null;
}
export async function observeAndroidDirectoryInput(context: {
  shell: (args: string[]) => Promise<string>;
  deviceSerial: string;
  avdName: string;
  freshOwnedEmulator: boolean;
  screenshotsSuppressed: boolean;
  captureBoundaryEntered: boolean;
  diagnostic: (value: AndroidDirectoryDiagnostic) => void;
}) {
  if (!context.screenshotsSuppressed || !context.captureBoundaryEntered)
    throw Error("ANDROID_DIRECTORY_BOUNDARY_REQUIRED");
  if (
    !context.freshOwnedEmulator ||
    !/^emulator-\d{4,5}$/.test(context.deviceSerial) ||
    !/^baro_runtime_[a-f0-9]{12}$/.test(context.avdName)
  )
    throw Error("ANDROID_DIRECTORY_OWNED_EMULATOR_REQUIRED");
  const shell = context.shell,
    file = `/sdcard/baro-directory-${randomUUID()}.xml`;
  let stage: AndroidDirectoryDiagnostic["stage"] = "prepare";
  let lastDisplay: ReturnType<typeof androidDirectoryDisplay> | null = null;
  let lastDisplayShape: ReturnType<typeof androidDirectoryDisplayShape> | null = null;
  let softwareSearchBeforeTap: AndroidDirectoryDiagnostic["softwareSearchBeforeTap"] = null;
  let primaryFailureCode: AndroidDirectoryDiagnostic["primaryFailureCode"] = null;
  let rotationRestoreFailureCode: AndroidDirectoryDiagnostic["rotationRestoreFailureCode"] = null;
  let hierarchyCleanupFailureCode: AndroidDirectoryDiagnostic["hierarchyCleanupFailureCode"] = null;
  const report = (value: ReturnType<typeof androidDirectoryInputObservation> | null = null) =>
    context.diagnostic({
      stage,
      display: lastDisplay,
      displayShape: lastDisplayShape,
      softwareSearchBeforeTap,
      primaryFailureCode,
      rotationRestoreFailureCode,
      hierarchyCleanupFailureCode,
      input: value
        ? { present: !!value.input, focused: value.focused, retained: value.syntheticInputRetained }
        : null,
    });
  async function foreground() {
    if (
      !androidAuthActivityObservation(await shell(["dumpsys", "activity", "activities"]))
        .appForeground
    )
      throw Error("ANDROID_DIRECTORY_FOREGROUND_MISSING");
  }
  async function hierarchy(allWindows = false) {
    let xml: string | undefined;
    let failed = false,
      cleanupFailed = false;
    let failure: unknown, cleanupFailure: unknown;
    try {
      const dumped = await shell([
        "uiautomator",
        "dump",
        "--compressed",
        ...(allWindows ? ["--windows"] : []),
        file,
      ]);
      if (androidHierarchyDumpOutcome(dumped, "", file) !== "saved")
        throw Error("ANDROID_DIRECTORY_DUMP_OUTPUT_INVALID");
      xml = await shell(["cat", file]);
    } catch (error) {
      failed = true;
      failure = error;
    } finally {
      try {
        await shell(["rm", "-f", file]);
      } catch (error) {
        cleanupFailed = true;
        cleanupFailure = error;
        hierarchyCleanupFailureCode = androidDirectoryFailureCode(error);
        report();
      }
    }
    if (failed) throw failure;
    if (cleanupFailed) throw cleanupFailure;
    if (xml === undefined) throw Error("ANDROID_DIRECTORY_HIERARCHY_INVALID");
    return xml;
  }
  async function display() {
    const output = await shell(["dumpsys", "window", "displays"]);
    lastDisplay = null;
    lastDisplayShape = androidDirectoryDisplayShape(output);
    report();
    lastDisplay = androidDirectoryDisplay(output);
    report();
    return lastDisplay;
  }
  async function poll(check: () => Promise<boolean>, code: (typeof codes)[number]) {
    for (let i = 0; i < 30; i++) {
      await foreground();
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw Error(code);
  }
  async function swipe(width: number, height: number, down = false) {
    await shell([
      "input",
      "swipe",
      String(Math.floor(width / 2)),
      String(Math.floor(height * (down ? 0.25 : 0.8))),
      String(Math.floor(width / 2)),
      String(Math.floor(height * (down ? 0.8 : 0.25))),
      "400",
    ]);
  }
  async function input() {
    const d = await display(),
      value = androidDirectoryInputObservation(await hierarchy(), d.width, d.height);
    report(value);
    return value;
  }
  async function reach(resetTop = false) {
    const d = await display();
    if (resetTop) for (let i = 0; i < 8; i++) await swipe(d.width, d.height, true);
    for (let i = 0; i <= 24; i++) {
      await foreground();
      const value = await input();
      if (value.input) return value;
      if (i < 24) await swipe(d.width, d.height);
    }
    throw Error("ANDROID_DIRECTORY_CONTROL_MISSING");
  }
  const previous = androidDirectoryRotation(await shell(["wm", "user-rotation"])),
    oldRotation = (await shell(["settings", "get", "system", "user_rotation"])).trim();
  if (
    !/^[0-3]$/.test(oldRotation) ||
    (previous.mode === "lock" && previous.rotation !== Number(oldRotation))
  )
    throw Error("ANDROID_DIRECTORY_ROTATION_INVALID");
  async function restoreRotation() {
    const previousStage = stage;
    stage = "rotation-restore";
    report();
    await shell(["wm", "user-rotation", "lock", oldRotation]);
    if (previous.mode === "free") await shell(["wm", "user-rotation", "free"]);
    const restored = androidDirectoryRotation(await shell(["wm", "user-rotation"]));
    if (
      restored.mode !== previous.mode ||
      (restored.mode === "lock" && restored.rotation !== previous.rotation) ||
      (await shell(["settings", "get", "system", "user_rotation"])).trim() !== oldRotation
    )
      throw Error("ANDROID_DIRECTORY_ROTATION_RESTORE_FAILED");
    stage = previousStage;
    report();
  }
  let result: z.input<typeof resultSchema> | undefined;
  let executionFailed = false,
    restorationFailed = false;
  let executionError: unknown, restorationError: unknown;
  try {
    await shell(["wm", "user-rotation", "lock", "0"]);
    await poll(async () => {
      const d = await display();
      return d.rotation === 0 && d.height > d.width;
    }, "ANDROID_DIRECTORY_PORTRAIT_MISSING");
    stage = "home";
    await poll(async () => (await input()).homeTitle, "ANDROID_DIRECTORY_HOME_MISSING");
    let browse: ReturnType<typeof publicDirectoryButton> = null;
    for (let i = 0; i <= 24; i++) {
      await foreground();
      const d = await display();
      browse = publicDirectoryButton(await hierarchy(), d.width, d.height);
      if (browse) break;
      if (i < 24) await swipe(d.width, d.height);
    }
    if (!browse) throw Error("ANDROID_DIRECTORY_CONTROL_MISSING");
    await shell(["input", "tap", String(browse.x), String(browse.y)]);
    stage = "ready";
    let initialReadyState: "empty" | "cards" = "empty",
      readyScrolls = 0;
    await poll(async () => {
      const v = publicDirectoryUiObservation(await hierarchy());
      if (v.errorVisible || v.loadingVisible) return false;
      if (v.readyEmpty === v.readyProfileCard) {
        if (readyScrolls++ < 24) {
          const d = await display();
          await swipe(d.width, d.height);
        }
        return false;
      }
      initialReadyState = v.readyEmpty ? "empty" : "cards";
      return true;
    }, "ANDROID_DIRECTORY_READY_MISSING");
    stage = "focus";
    const field = await reach(true);
    if (!field.input || !field.initialEmpty) throw Error("ANDROID_DIRECTORY_CONTROL_MISSING");
    await shell([
      "input",
      "tap",
      String(Math.floor((field.input.left + field.input.right) / 2)),
      String(Math.floor((field.input.top + field.input.bottom) / 2)),
    ]);
    await poll(async () => {
      const v = await input();
      return (await display()).keyboardVisible && v.focused;
    }, "ANDROID_DIRECTORY_KEYBOARD_MISSING");
    // Never scroll after focus: prove the actual keyboard-avoidance result.
    const focused = await input(),
      focusedDisplay = await display();
    if (
      !focused.input ||
      !focused.focused ||
      !focusedDisplay.keyboardVisible ||
      focusedDisplay.keyboardTop == null ||
      focused.input.bottom > focusedDisplay.keyboardTop
    )
      throw Error("ANDROID_DIRECTORY_INPUT_OCCLUDED");
    await shell(["input", "text", directorySyntheticInput]);
    stage = "typed";
    await poll(
      async () => (await input()).syntheticInputRetained,
      "ANDROID_DIRECTORY_INPUT_NOT_RETAINED",
    );
    const currentIme = (await shell(["settings", "get", "secure", "default_input_method"])).trim();
    const searchDisplay = await display();
    const searchControl = androidDirectorySoftwareSearch(
      await hierarchy(true),
      searchDisplay,
      currentIme,
    );
    softwareSearchBeforeTap = searchControl.diagnostic;
    report();
    await foreground();
    if (
      !searchControl.point ||
      (await shell(["settings", "get", "secure", "default_input_method"])).trim() !== currentIme
    )
      throw Error("ANDROID_DIRECTORY_SOFTWARE_SEARCH_MISSING");
    await shell(["input", "tap", String(searchControl.point.x), String(searchControl.point.y)]);
    stage = "submitted";
    await poll(
      async () => !(await display()).keyboardVisible,
      "ANDROID_DIRECTORY_KEYBOARD_NOT_DISMISSED",
    );
    let searchScrolls = 0;
    await poll(async () => {
      const value = await input();
      if (value.filteredEmpty) return true;
      if (searchScrolls++ < 8) {
        const d = await display();
        await swipe(d.width, d.height);
      }
      return false;
    }, "ANDROID_DIRECTORY_SEARCH_EMPTY_MISSING");
    const portraitDisplay = displaySchema.strip().parse(await display());
    stage = "landscape";
    await shell(["wm", "user-rotation", "lock", "1"]);
    await poll(async () => {
      const d = await display(),
        v = await input();
      return d.rotation === 1 && d.width > d.height && v.appWindowLandscape;
    }, "ANDROID_DIRECTORY_LANDSCAPE_MISSING");
    const landscapeDisplay = displaySchema.strip().parse(await display()),
      landscape = await reach(true);
    if (!landscape.syntheticInputRetained) throw Error("ANDROID_DIRECTORY_INPUT_NOT_RETAINED");
    stage = "portrait";
    await shell(["wm", "user-rotation", "lock", "0"]);
    await poll(async () => {
      const d = await display(),
        v = await input();
      return d.rotation === 0 && d.height > d.width && v.appWindowPortrait;
    }, "ANDROID_DIRECTORY_PORTRAIT_MISSING");
    const portrait = await reach(true);
    if (!portrait.syntheticInputRetained) throw Error("ANDROID_DIRECTORY_INPUT_NOT_RETAINED");
    stage = "home-return";
    await shell(["input", "keyevent", "KEYCODE_BACK"]);
    let returnScrolls = 0;
    await poll(async () => {
      const v = await input();
      if (!(v.homeTitle && !v.input) && returnScrolls++ < 8) {
        const d = await display();
        await swipe(d.width, d.height, true);
      }
      return v.homeTitle && !v.input;
    }, "ANDROID_DIRECTORY_HOME_RETURN_MISSING");
    result = {
      initialReadyState,
      inputBoundsWithinDisplay: true,
      keyboardObserved: true,
      focusedInputAboveKeyboard: true,
      syntheticAsciiInputRetained: true,
      submitMethod: "software-keyboard-search",
      searchControlInCurrentImeWindow: true,
      searchControlBelowKeyboardTop: true,
      searchControlUniqueEnabledClickable: true,
      searchControlTapped: true,
      keyboardDismissed: true,
      filteredEmptyStateObserved: true,
      portraitDisplay,
      landscapeDisplay,
      landscapeAppWindowObserved: true,
      landscapeInputRetained: true,
      landscapeInputReachable: true,
      portraitAppWindowObserved: true,
      portraitInputRetained: true,
      portraitInputReachable: true,
      homeReturnObserved: true,
      systemBackCount: 1,
      rotationPreferenceRestored: true,
    };
  } catch (error) {
    executionFailed = true;
    executionError = error;
    primaryFailureCode = androidDirectoryFailureCode(error);
    report();
  } finally {
    try {
      await restoreRotation();
    } catch (error) {
      restorationFailed = true;
      restorationError = error;
      rotationRestoreFailureCode = androidDirectoryFailureCode(error);
      report();
    }
  }
  if (executionFailed) throw executionError;
  if (restorationFailed) throw restorationError;
  return resultSchema.parse(result);
}
