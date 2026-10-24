import { expect, test } from "bun:test";
import { parse } from "yaml";
import {
  iosDirectoryBaseSchema,
  iosKoreanDirectoryResultSchema,
  observeIosKoreanDirectoryFailure,
  parseIosDirectoryResult,
  runIosDirectoryUiTest,
  verifyIosDirectoryReceipt,
} from "../scripts/mobile-ios-directory-ui";
import { iosInternalObservationOptions } from "../scripts/mobile-ios-ui-capabilities";

const result = {
  kind: "ios-public-directory-korean-software-composition",
  applicationId: "site.baro.app.preview",
  initialReadyState: "empty",
  keyboardSetup: "owned-simulator-settings-ui",
  keyboardLayout: "korean-2-set",
  softwareJamoTapCount: 6,
  compositionCheckpoints: 4,
  compositionRetained: true,
  spaceCommitVerified: true,
  spaceDeletionVerified: true,
  appendAfterCommitVerified: true,
  keyboardObserved: true,
  focusedInputAboveKeyboard: true,
  searchSubmitMethod: "software-keyboard-search",
  searchSubmitControlKind: "key",
  searchCompletedWithoutError: true,
  keyboardDismissed: true,
  landscapeInputRetained: true,
  portraitInputRetained: true,
  homeReturnObserved: true,
  publicDataNavigation: true,
  profileOpened: false,
  contactOpened: false,
  remoteMutationPerformed: false,
  authenticationNavigation: false,
  privateDataAccess: false,
  typeTextCalls: 0,
  pastePerformed: false,
  preferencesDatabaseEdited: false,
  rawInputExported: false,
  koreanKeyboardVerified: true,
  voiceOverVerified: false,
  physicalDeviceVerified: false,
  httpTransportSeparatelyObserved: false,
} as const;
const line = (value: unknown) => `BARO_DIRECTORY_UI_RESULT:${JSON.stringify(value)}`;
test("Korean composition requires isolated fresh Home observation, never authentication or static audit", () => {
  expect(iosInternalObservationOptions(["--home", "--korean-directory"]).home).toBe(true);
  for (const args of [
    ["--korean-directory"],
    ["--korean-directory", "--home"],
    ["--home", "--korean-directory", "--auth-cancel"],
    ["--home", "--korean-directory", "--public-directory"],
    ["--home", "--korean-directory", "--input-reference"],
    ["--home", "--korean-directory", "--large-font"],
    ["--home", "--korean-directory", "--korean-directory"],
  ])
    expect(() => iosInternalObservationOptions(args)).toThrow();
});
test("ASCII, injected text, incomplete composition and broad accessibility claims cannot satisfy Korean proof", () => {
  expect(parseIosDirectoryResult(line(result)).kind).toBe(result.kind);
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === "boolean")
      expect(() => iosKoreanDirectoryResultSchema.parse({ ...result, [key]: !value })).toThrow();
    expect(() =>
      iosKoreanDirectoryResultSchema.parse(
        Object.fromEntries(Object.entries(result).filter(([field]) => field !== key)),
      ),
    ).toThrow();
  }
  for (const patch of [
    { typeTextCalls: 1 },
    { softwareJamoTapCount: 4 },
    { compositionCheckpoints: 3 },
    { keyboardSetup: "preferences-db" },
    { keyboardLayout: "english" },
    { value: "sensitive-input" },
    { profileNames: [] },
    { kind: "ios-public-directory-keyboard-rotation" },
  ])
    expect(() => parseIosDirectoryResult(line({ ...result, ...patch }))).toThrow();
  expect(() => parseIosDirectoryResult(`${line(result)}\n${line(result)}`)).toThrow();
});
test("native failure retains bounded fixed stages and booleans; malformed rows and raw values are discarded", () => {
  const encode = (v: unknown) => `BARO_KOREAN_UI_STATUS:${JSON.stringify(v)}`;
  const safe = {
    stage: "compose-3",
    expectedValueMatches: false,
    keyboardObserved: true,
  } as const;
  const observed = observeIosKoreanDirectoryFailure(
    [
      "secret native chatter",
      encode({ ...safe, rawValue: "private" }),
      encode({ ...safe, stage: "private" }),
      encode({ ...safe, expectedValueMatches: "true" }),
      "BARO_KOREAN_UI_STATUS:{broken",
      encode(safe),
      "XCTAssertTrue failed - BARO_KOREAN_COMPOSITION_MISMATCH private suffix",
    ].join("\n"),
  );
  expect(observed).toEqual({
    history: [safe],
    setupStage: null,
    setupControl: null,
    assertionCode: "BARO_KOREAN_COMPOSITION_MISMATCH",
  });
  expect(JSON.stringify(observed)).not.toContain("private");
  expect(observeIosKoreanDirectoryFailure("BARO_KOREAN_SETUP_STAGE:layout").setupStage).toBe(
    "layout",
  );
  expect(
    observeIosKoreanDirectoryFailure("BARO_KOREAN_SETUP_STAGE:private-value").setupStage,
  ).toBeNull();
  expect(
    observeIosKoreanDirectoryFailure(Array(100).fill(encode(safe)).join("\n")).history,
  ).toHaveLength(5);
  expect(
    observeIosKoreanDirectoryFailure("XCTAssertTrue failed - BARO_KOREAN_PRIVATE").assertionCode,
  ).toBeNull();
});
test("Korean receipt binds the original binary, compiler and device and cannot masquerade as historical ASCII", async () => {
  const home = await Bun.file(
    "docs/quality/mobile-native-9436e77/ios-runtime-40095242747/home.json",
  ).json();
  const receipt = {
    ...iosDirectoryBaseSchema.strip().parse(home),
    kind: "ios-bundled-public-directory-korean-composition-observation",
    swiftTestSha256: "a".repeat(64),
    projectGeneratorSha256: "b".repeat(64),
    projectGeneratorVersion: "1.28.1",
    explicitScreenshotsSuppressedBeforeNavigation: true,
    hostRawCommandLogsPersistedAfterBoundary: false,
    rawXcresultExported: false,
    rawUiHierarchyExported: false,
    uiTestRunnerCompiled: true,
    productRecompiled: false,
    productResigned: false,
    result,
  };
  expect(verifyIosDirectoryReceipt(receipt, home).result.kind).toBe(result.kind);
  for (const patch of [
    { kind: "ios-bundled-public-directory-software-search-observation" },
    { binarySourceSha: "a".repeat(40) },
    { archiveSha256: "c".repeat(64) },
    { device: { ...home.device, model: "other" } },
    { explicitScreenshotsSuppressedBeforeNavigation: false },
    { hostRawCommandLogsPersistedAfterBoundary: true },
    { rawXcresultExported: true },
    { physicalDeviceVerified: true },
  ])
    expect(() => verifyIosDirectoryReceipt({ ...receipt, ...patch }, home)).toThrow();
});
test("runner refuses unowned or unsuppressed Korean observation before executing any command", async () => {
  let commands = 0;
  await expect(
    runIosDirectoryUiTest({
      root: process.cwd(),
      owned: "/tmp/not-owned",
      device: "a".repeat(36),
      korean: true,
      captureSuppressed: false,
      command: async () => {
        commands++;
        return "";
      },
    }),
  ).rejects.toThrow();
  expect(commands).toBe(0);
});
test("manual workflow isolates Korean mode and requires the scoped proof, while mandatory quick checks cover it", async () => {
  const workflow = parse(
    await Bun.file(".github/workflows/mobile-internal-ios-reverify.yml").text(),
  );
  expect(workflow.on.workflow_dispatch.inputs.korean_directory.default).toBe(false);
  const steps = workflow.jobs.verify.steps;
  const setup = steps.find(
    (v: { name?: string }) => v.name === "Validate source and observation options",
  );
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression
  expect(setup.env.OBSERVE_KOREAN_DIRECTORY).toBe("${{ inputs.korean_directory }}");
  const fragment = setup.run
    .split('if [ "$OBSERVE_KOREAN_DIRECTORY" = "true" ]; then')[1]
    ?.split("fi")[0];
  for (const key of [
    "INPUT_REFERENCE",
    "PUBLIC_DIRECTORY",
    "AUTH_CANCEL",
    "LARGE_FONT",
    "UI_TEST",
    "ACCESSIBILITY_AUDIT",
  ])
    expect(fragment).toContain(`test "$OBSERVE_${key}" != "true"`);
  const execute = steps.find(
    (v: { name?: string }) =>
      v.name === "Reverify original metadata and optionally observe anonymous cold launches",
  );
  expect(execute.run).toContain("args+=(--korean-directory)");
  expect(execute.run).toContain(
    '[ "$OBSERVE_PUBLIC_DIRECTORY" = "true" ] || [ "$OBSERVE_KOREAN_DIRECTORY" = "true" ]',
  );
  expect(await Bun.file("scripts/validate.ts").text()).toContain(
    '"tests/mobile-ios-korean-directory.test.ts"',
  );
});

test("Settings caption diagnostics accept only bounded consistent candidate counts without native labels", () => {
  const prefix = "BARO_KOREAN_SETUP_CONTROL:",
    value = {
      stage: "add-keyboard",
      cellCount: 0,
      buttonCount: 0,
      textCount: 1,
      selection: "text",
      scrolls: 2,
    },
    parseControl = (v: unknown) =>
      observeIosKoreanDirectoryFailure(prefix + JSON.stringify(v)).setupControl;
  expect<unknown>(parseControl(value)).toEqual(value);
  for (const patch of [
    { label: "private" },
    { rawHierarchy: "private" },
    { stage: "private" },
    { cellCount: 9 },
    { cellCount: -1 },
    { textCount: 1.1 },
    { textCount: "1" },
    { scrolls: 13 },
    { scrolls: -1 },
    { selection: "none" },
    { selection: "button" },
    { selection: "ambiguous" },
    { cellCount: 1 },
  ])
    expect(parseControl({ ...value, ...patch })).toBeNull();
  expect(parseControl({ ...value, cellCount: 1, selection: "cell" })?.selection).toBe("cell");
  expect(parseControl({ ...value, cellCount: 2, selection: "ambiguous" })?.selection).toBe(
    "ambiguous",
  );
  expect(parseControl({ ...value, textCount: 0, selection: "none" })?.selection).toBe("none");
  expect(parseControl({ ...value, cellCount: 2, selection: "cell" })).toBeNull();
});
