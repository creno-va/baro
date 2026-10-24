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
    layoutStatus: null,
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

test("owner-aware diagnostic permits duplicate captions only with unique actionable owners and verified overlap", async () => {
  const historical = (
    await Bun.file("docs/quality/mobile-native-9436e77/ios-korean-40103849176/failure.json").json()
  ).koreanDirectoryFailure.setupControl;
  const parseControl = (v: unknown) =>
    observeIosKoreanDirectoryFailure(`BARO_KOREAN_SETUP_CONTROL:${JSON.stringify(v)}`).setupControl;
  expect<unknown>(parseControl(historical)).toEqual(historical);
  expect(parseControl({ ...historical, ownersOverlap: true, selection: "cell" })?.selection).toBe(
    "cell",
  );
  expect(
    parseControl({ ...historical, ownersOverlap: false, selection: "ambiguous" })?.selection,
  ).toBe("ambiguous");
  for (const patch of [
    { ownersOverlap: false, selection: "cell" },
    { ownersOverlap: true, selection: "text" },
    { ownersOverlap: "true", selection: "cell" },
    { ownersOverlap: true, selection: "button" },
    { ownersOverlap: true, cellCount: 2, selection: "cell" },
    { ownersOverlap: true, cellCount: 0, buttonCount: 2, selection: "button" },
    { ownersOverlap: true, cellCount: 0, buttonCount: 0, selection: "text" },
    { ownersOverlap: false, cellCount: 0, buttonCount: 0, selection: "ambiguous" },
    { ownersOverlap: true, selection: "cell", rawFrame: [0, 1, 2, 3] },
  ])
    expect(parseControl({ ...historical, ...patch })).toBeNull();
  expect(
    parseControl({ ...historical, ownersOverlap: true, cellCount: 0, selection: "button" })
      ?.selection,
  ).toBe("button");
  const workflow = parse(
    await Bun.file(".github/workflows/mobile-internal-ios-reverify.yml").text(),
  );
  const step = workflow.jobs.verify.steps.find(
    (s: { name?: string }) => s.name === "Require Apple Foundation Settings owner policy",
  );
  expect(step.if).toBe("inputs.korean_directory");
  expect(step.env.BARO_IOS_SETTINGS_OWNER_REQUIRED).toBe("1");
  expect(step.run).toBe("bun test tests/mobile-ios-korean-settings-owner.test.ts");
  expect(await Bun.file("scripts/validate.ts").text()).toContain(
    '"tests/mobile-ios-korean-settings-owner.test.ts"',
  );
});

test("layout diagnostics retain only fixed selection states and known-control presence without raw values", () => {
  const value = {
    stage: "before-selection",
    traitSelected: false,
    valueClass: "absent",
    doneButtonCount: 1,
    doneHittable: true,
    doneInNavigationBar: true,
    standardObserved: true,
    tenKeyObserved: false,
    koreanTitleObserved: true,
  };
  const encode = (v: unknown) => `BARO_KOREAN_LAYOUT_STATUS:${JSON.stringify(v)}`;
  const parseStatus = (v: unknown) => observeIosKoreanDirectoryFailure(encode(v)).layoutStatus;
  expect<unknown>(parseStatus(value)).toEqual(value);
  for (const patch of [
    { rawValue: "private" },
    { rawLabel: "private" },
    { frame: [1, 2, 3, 4] },
    { valueClass: "private" },
    { traitSelected: "true" },
    { stage: "private" },
    { doneButtonCount: 9 },
    { doneButtonCount: -1 },
    { doneButtonCount: 0 },
    { standardObserved: "true" },
  ])
    expect(parseStatus({ ...value, ...patch })).toBeNull();
  const later = { ...value, stage: "after-selection", traitSelected: true, valueClass: "selected" };
  expect<unknown>(
    observeIosKoreanDirectoryFailure(`${encode(value)}\n${encode(later)}`).layoutStatus,
  ).toEqual(later);
  expect(parseStatus({ ...value, doneButtonCount: 0, doneHittable: false })?.doneHittable).toBe(
    false,
  );
  expect(
    observeIosKoreanDirectoryFailure("BARO_KOREAN_LAYOUT_STATUS:{malformed").layoutStatus,
  ).toBeNull();
  expect(
    observeIosKoreanDirectoryFailure(
      "XCTAssertTrue failed - BARO_KOREAN_LAYOUT_ACTIONABLE_OWNER_MISSING",
    ).assertionCode,
  ).toBe("BARO_KOREAN_LAYOUT_ACTIONABLE_OWNER_MISSING");
});

test("layout accepts only known query origins while historical setup diagnostics keep their prior shape", async () => {
  const historical = (
    await Bun.file("docs/quality/mobile-native-9436e77/ios-korean-40106535873/failure.json").json()
  ).koreanDirectoryFailure.setupControl;
  const parseControl = (v: unknown) =>
    observeIosKoreanDirectoryFailure(`BARO_KOREAN_SETUP_CONTROL:${JSON.stringify(v)}`).setupControl;
  expect<unknown>(parseControl(historical)).toEqual(historical);
  const layout = { ...historical, stage: "layout", cellQuerySource: "known-descendant" };
  expect(parseControl(layout)?.cellQuerySource).toBe("known-descendant");
  for (const patch of [
    { cellQuerySource: "fuzzy" },
    { cellQuerySource: "private" },
    { rawCaption: "private" },
  ])
    expect(parseControl({ ...layout, ...patch })).toBeNull();
});

test("the separate-keyboard decision is scoped to the observed Korean chooser and unique hittable owner", () => {
  const v = {
    koreanTitleObserved: true,
    promptObserved: true,
    cellCount: 0,
    buttonCount: 1,
    ownersOverlap: true,
    selection: "button",
    decision: "separate-keyboard",
  };
  const parseChoice = (value: unknown) =>
    observeIosKoreanDirectoryFailure(`BARO_KOREAN_SEPARATE_CHOICE:${JSON.stringify(value)}`)
      .separateChoice;
  expect<unknown>(parseChoice(v)).toEqual(v);
  expect(parseChoice({ ...v, cellCount: 1, selection: "cell" })?.selection).toBe("cell");
  for (const patch of [
    { koreanTitleObserved: false },
    { promptObserved: false },
    { buttonCount: 2 },
    { ownersOverlap: false },
    { buttonCount: 9 },
    { label: "private" },
    { value: "private" },
    { decision: "unknown" },
  ])
    expect(parseChoice({ ...v, ...patch })).toBeUndefined();
  expect(
    parseChoice({ ...v, cellCount: 2, selection: "ambiguous", decision: "blocked" })?.decision,
  ).toBe("blocked");
  expect(parseChoice({ ...v, promptObserved: false, decision: "legacy-layout" })?.decision).toBe(
    "legacy-layout",
  );
  expect(
    observeIosKoreanDirectoryFailure("XCTAssertTrue failed - BARO_KOREAN_SEPARATE_CHOICE_MISSING")
      .assertionCode,
  ).toBe("BARO_KOREAN_SEPARATE_CHOICE_MISSING");
});
test("new setup path evidence cannot replace actual composition or silently discard both setup observations", () => {
  expect(
    iosKoreanDirectoryResultSchema.parse({
      ...result,
      separateKeyboardChosen: true,
      settingsLayoutChoiceObserved: false,
    }).softwareJamoTapCount,
  ).toBe(6);
  expect(
    iosKoreanDirectoryResultSchema.parse({
      ...result,
      separateKeyboardChosen: false,
      settingsLayoutChoiceObserved: true,
    }).compositionCheckpoints,
  ).toBe(4);
  for (const patch of [
    { separateKeyboardChosen: false, settingsLayoutChoiceObserved: false },
    { separateKeyboardChosen: true },
    { settingsLayoutChoiceObserved: false },
    { separateKeyboardChosen: true, settingsLayoutChoiceObserved: false, typeTextCalls: 1 },
    {
      separateKeyboardChosen: true,
      settingsLayoutChoiceObserved: false,
      compositionCheckpoints: 0,
    },
  ])
    expect(() => iosKoreanDirectoryResultSchema.parse({ ...result, ...patch })).toThrow();
});

test("new chooser scope evidence requires exactly one prompt-anchored list and keeps older unscoped failures intact", async () => {
  const base = {
    koreanTitleObserved: true,
    promptObserved: true,
    cellCount: 1,
    buttonCount: 0,
    ownersOverlap: true,
    selection: "cell",
    decision: "separate-keyboard",
    scopeKind: "table",
    scopeCount: 1,
  };
  const parseChoice = (v: unknown) =>
    observeIosKoreanDirectoryFailure(`BARO_KOREAN_SEPARATE_CHOICE:${JSON.stringify(v)}`)
      .separateChoice;
  expect<unknown>(parseChoice(base)).toEqual(base);
  expect(parseChoice({ ...base, scopeKind: "collection" })?.decision).toBe("separate-keyboard");
  for (const patch of [
    { scopeCount: 0 },
    { scopeCount: 2 },
    { scopeKind: "missing" },
    { scopeKind: "ambiguous" },
    { scopeKind: "unknown" },
    { scopeCount: 9 },
    { parentIdentifier: "private" },
  ])
    expect(parseChoice({ ...base, ...patch })).toBeUndefined();
  expect(
    parseChoice({
      ...base,
      scopeKind: "missing",
      scopeCount: 0,
      cellCount: 0,
      selection: "none",
      decision: "blocked",
    })?.decision,
  ).toBe("blocked");
  const old = (
    await Bun.file("docs/quality/mobile-native-c8215b8/ios-korean-40116874262/failure.json").json()
  ).koreanDirectoryFailure.separateChoice;
  expect<unknown>(parseChoice(old)).toEqual(old);
});

test("keyboard-switch diagnostics permit only consistent bounded system-region owners and never promote a historical failure", async () => {
  const base = {
    scope: "app-system-keyboard-region",
    attempt: 1,
    buttonCount: 1,
    keyCount: 0,
    eligibleButtonCount: 1,
    eligibleKeyCount: 0,
    ownersOverlap: true,
    regionValid: true,
    selection: "button",
    appForeground: true,
    keyboardObserved: true,
    actionAllowed: true,
  };
  const parse = (v: unknown) =>
    observeIosKoreanDirectoryFailure(`BARO_KOREAN_SWITCH_STATUS:${JSON.stringify(v)}`)
      .switchControl;
  expect<unknown>(parse(base)).toEqual(base);
  expect(parse({ ...base, keyCount: 1, eligibleKeyCount: 1 })?.selection).toBe("button");
  expect(
    parse({
      ...base,
      buttonCount: 0,
      eligibleButtonCount: 0,
      keyCount: 1,
      eligibleKeyCount: 1,
      selection: "key",
    })?.actionAllowed,
  ).toBe(true);
  expect(parse({ ...base, appForeground: false, actionAllowed: false })?.actionAllowed).toBe(false);
  expect(
    parse({
      ...base,
      keyCount: 1,
      eligibleKeyCount: 1,
      ownersOverlap: false,
      selection: "ambiguous",
      actionAllowed: false,
    })?.selection,
  ).toBe("ambiguous");
  expect(
    parse({
      ...base,
      eligibleButtonCount: 0,
      regionValid: false,
      selection: "none",
      actionAllowed: false,
    })?.regionValid,
  ).toBe(false);
  for (const patch of [
    { scope: "global-first-match" },
    { attempt: 0 },
    { attempt: 4 },
    { buttonCount: 9 },
    { eligibleButtonCount: 2 },
    { buttonCount: 0 },
    { ownersOverlap: false },
    { actionAllowed: false },
    { appForeground: false },
    { keyboardObserved: false },
    { regionValid: false },
    { frame: [0, 0, 1, 1] },
    { label: "synthetic-private" },
    { input: "synthetic-private" },
  ])
    expect(parse({ ...base, ...patch })).toBeUndefined();
  const old = (
    await Bun.file("docs/quality/mobile-native-92f4232/ios-korean-40124377850/failure.json").json()
  ).koreanDirectoryFailure;
  const observed = observeIosKoreanDirectoryFailure(
    "XCTAssertNotNil failed - BARO_KOREAN_SWITCH_MISSING",
  );
  expect(observed.switchControl).toBeUndefined();
  expect(observed.history).toEqual(old.history);
  expect(observed.assertionCode).toBe(old.assertionCode);
  expect(
    JSON.stringify(
      observeIosKoreanDirectoryFailure(
        `BARO_KOREAN_SWITCH_STATUS:${JSON.stringify({ ...base, label: "synthetic-private" })}`,
      ),
    ),
  ).not.toContain("synthetic-private");
});
