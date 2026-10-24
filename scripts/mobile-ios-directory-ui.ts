import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { z } from "zod";
import { iosColdLaunchReceiptSchema } from "./mobile-internal-ios-input";
import { iosAuthCancelBaseSchema } from "./mobile-ios-auth-cancel";
import { xcodeSimulatorControlArguments } from "./mobile-ios-xcode-control";

export const iosDirectoryResultSchema = z.strictObject({
  kind: z.literal("ios-public-directory-keyboard-rotation"),
  applicationId: z.literal("site.baro.app.preview"),
  initialReadyState: z.enum(["empty", "cards"]),
  inputFullyHittable: z.literal(true),
  keyboardObserved: z.literal(true),
  focusedInputAboveKeyboard: z.literal(true),
  syntheticAsciiInputRetained: z.literal(true),
  searchSubmittedByKeyboard: z.literal(true),
  keyboardDismissed: z.literal(true),
  filteredEmptyStateObserved: z.literal(true),
  landscapeWindowObserved: z.literal(true),
  landscapeInputRetained: z.literal(true),
  landscapeInputFullyHittable: z.literal(true),
  portraitWindowObserved: z.literal(true),
  portraitInputRetained: z.literal(true),
  portraitInputFullyHittable: z.literal(true),
  homeReturnObserved: z.literal(true),
  publicDataNavigation: z.literal(true),
  profileOpened: z.literal(false),
  contactOpened: z.literal(false),
  remoteMutationPerformed: z.literal(false),
  authenticationNavigation: z.literal(false),
  privateDataAccess: z.literal(false),
  koreanKeyboardVerified: z.literal(false),
  voiceOverVerified: z.literal(false),
  httpTransportSeparatelyObserved: z.literal(false),
});
export const iosDirectorySoftwareSearchResultSchema = iosDirectoryResultSchema
  .omit({ kind: true })
  .extend({
    kind: z.literal("ios-public-directory-software-search-keyboard-rotation"),
    searchSubmitMethod: z.literal("software-keyboard-search"),
    searchSubmitControlKind: z.enum(["button", "key"]),
    searchSubmitUniquePhysicalControl: z.literal(true),
    searchSubmitControlFullyHittable: z.literal(true),
    searchSubmitControlWithinKeyboard: z.literal(true),
    searchSubmitTapped: z.literal(true),
  });
export const iosKoreanDirectoryResultSchema = z
  .strictObject({
    kind: z.literal("ios-public-directory-korean-software-composition"),
    applicationId: z.literal("site.baro.app.preview"),
    initialReadyState: z.enum(["empty", "cards"]),
    keyboardSetup: z.literal("owned-simulator-settings-ui"),
    keyboardLayout: z.literal("korean-2-set"),
    separateKeyboardChosen: z.boolean().optional(),
    settingsLayoutChoiceObserved: z.boolean().optional(),
    softwareJamoTapCount: z.literal(6),
    compositionCheckpoints: z.literal(4),
    compositionRetained: z.literal(true),
    spaceCommitVerified: z.literal(true),
    spaceDeletionVerified: z.literal(true),
    appendAfterCommitVerified: z.literal(true),
    keyboardObserved: z.literal(true),
    focusedInputAboveKeyboard: z.literal(true),
    searchSubmitMethod: z.literal("software-keyboard-search"),
    searchSubmitControlKind: z.enum(["button", "key"]),
    searchCompletedWithoutError: z.literal(true),
    keyboardDismissed: z.literal(true),
    landscapeInputRetained: z.literal(true),
    portraitInputRetained: z.literal(true),
    homeReturnObserved: z.literal(true),
    publicDataNavigation: z.literal(true),
    profileOpened: z.literal(false),
    contactOpened: z.literal(false),
    remoteMutationPerformed: z.literal(false),
    authenticationNavigation: z.literal(false),
    privateDataAccess: z.literal(false),
    typeTextCalls: z.literal(0),
    pastePerformed: z.literal(false),
    preferencesDatabaseEdited: z.literal(false),
    rawInputExported: z.literal(false),
    koreanKeyboardVerified: z.literal(true),
    voiceOverVerified: z.literal(false),
    physicalDeviceVerified: z.literal(false),
    httpTransportSeparatelyObserved: z.literal(false),
  })
  .refine(
    (v) =>
      (v.separateKeyboardChosen === undefined && v.settingsLayoutChoiceObserved === undefined) ||
      (v.separateKeyboardChosen !== undefined &&
        v.settingsLayoutChoiceObserved !== undefined &&
        (v.separateKeyboardChosen || v.settingsLayoutChoiceObserved)),
  );

const directoryResultSchema = z.discriminatedUnion("kind", [
  iosDirectoryResultSchema,
  iosDirectorySoftwareSearchResultSchema,
  iosKoreanDirectoryResultSchema,
]);
export function parseIosDirectoryResult(output: string) {
  const prefix = "BARO_DIRECTORY_UI_RESULT:";
  const lines = output.split(/\r?\n/).filter((line) => line.startsWith(prefix));
  const line = lines[0];
  if (lines.length !== 1 || !line) throw Error("INTERNAL_IOS_DIRECTORY_RESULT_REQUIRED");
  return directoryResultSchema.parse(JSON.parse(line.slice(prefix.length)));
}
const assertionCodes = [
  "BARO_DIRECTORY_HOME_MISSING",
  "BARO_DIRECTORY_FOREGROUND_MISSING",
  "BARO_DIRECTORY_CONTROL_MISSING",
  "BARO_DIRECTORY_CONTROL_NOT_HITTABLE",
  "BARO_DIRECTORY_SCROLL_MISSING",
  "BARO_DIRECTORY_READY_MISSING",
  "BARO_DIRECTORY_INPUT_MISSING",
  "BARO_DIRECTORY_KEYBOARD_MISSING",
  "BARO_DIRECTORY_INPUT_OCCLUDED",
  "BARO_DIRECTORY_INPUT_NOT_RETAINED",
  "BARO_DIRECTORY_INITIAL_INPUT_NOT_EMPTY",
  "BARO_DIRECTORY_SOFTWARE_SEARCH_MISSING",
  "BARO_DIRECTORY_TYPED_INPUT_MISMATCH",
  "BARO_DIRECTORY_LANDSCAPE_INPUT_MISMATCH",
  "BARO_DIRECTORY_PORTRAIT_INPUT_MISMATCH",
  "BARO_DIRECTORY_KEYBOARD_NOT_DISMISSED",
  "BARO_DIRECTORY_SEARCH_EMPTY_MISSING",
  "BARO_DIRECTORY_LANDSCAPE_MISSING",
  "BARO_DIRECTORY_PORTRAIT_MISSING",
  "BARO_DIRECTORY_BACK_MISSING",
  "BARO_DIRECTORY_HOME_RETURN_MISSING",
  "BARO_KOREAN_SETTINGS_MISSING",
  "BARO_KOREAN_SETTINGS_CONTROL_MISSING",
  "BARO_KOREAN_SETTINGS_CANDIDATES_EXCEEDED",
  "BARO_KOREAN_LAYOUT_MISSING",
  "BARO_KOREAN_SEPARATE_CHOICE_MISSING",
  "BARO_KOREAN_LAYOUT_ACTIONABLE_OWNER_MISSING",
  "BARO_KOREAN_SETTINGS_DONE_MISSING",
  "BARO_KOREAN_SETTINGS_READBACK_MISSING",
  "BARO_KOREAN_KEY_MISSING",
  "BARO_KOREAN_KEY_OUTSIDE_KEYBOARD",
  "BARO_KOREAN_SWITCH_MISSING",
  "BARO_KOREAN_SWITCH_CANDIDATES_EXCEEDED",
  "BARO_KOREAN_KEYBOARD_MISSING",
  "BARO_KOREAN_COMPOSITION_MISMATCH",
  "BARO_KOREAN_COMMIT_MISMATCH",
  "BARO_KOREAN_DELETE_MISMATCH",
  "BARO_KOREAN_EDIT_MISMATCH",
  "BARO_KOREAN_SEARCH_UNSETTLED",
  "BARO_KOREAN_ROTATION_MISSING",
  "BARO_KOREAN_ROTATED_VALUE_MISMATCH",
] as const;
export const inputSignatureSchema = z.strictObject({
  stringObserved: z.boolean(),
  expectedLengthMatches: z.boolean(),
  caseFoldMatches: z.boolean(),
  whitespaceRemovalMatches: z.boolean(),
  dashNormalizationMatches: z.boolean(),
  compatibilityNormalizationMatches: z.boolean(),
  knownNormalizationMatches: z.boolean(),
  expectedSubsequenceOnly: z.boolean(),
  containsKnownPayload: z.boolean(),
  allKnownSegmentsPresent: z.boolean(),
  knownDigitSuffixMatches: z.boolean(),
  containsHangul: z.boolean(),
  matchesFixedFieldLabel: z.boolean(),
  onlyExpectedScalarsAfterCaseFold: z.boolean(),
});
const inputStatusSchema = z.strictObject({
  stage: z.enum([
    "before-input",
    "after-input",
    "typed-check",
    "landscape-check",
    "portrait-check",
  ]),
  inputState: z.enum([
    "empty",
    "literal",
    "sentence-capitalized",
    "prefix",
    "other",
    "unavailable",
  ]),
  appForeground: z.boolean(),
  keyboardObserved: z.boolean(),
  inputSignature: inputSignatureSchema.optional(),
});
const searchControlSchema = z
  .strictObject({
    buttonCount: z.number().int().min(0).max(8),
    keyCount: z.number().int().min(0).max(8),
    buttonHittableCount: z.number().int().min(0).max(8),
    keyHittableCount: z.number().int().min(0).max(8),
    aliasesShareBounds: z.boolean(),
    uniquePhysicalControl: z.boolean(),
    keyboardVisible: z.boolean(),
    appForeground: z.boolean(),
  })
  .refine((v) => v.buttonHittableCount <= v.buttonCount && v.keyHittableCount <= v.keyCount)
  .refine(
    (v) =>
      v.uniquePhysicalControl ===
      (v.buttonHittableCount <= 1 &&
        v.keyHittableCount <= 1 &&
        v.buttonHittableCount + v.keyHittableCount > 0 &&
        (v.buttonHittableCount !== 1 || v.keyHittableCount !== 1 || v.aliasesShareBounds)),
  );
export function observeIosDirectoryFailure(output: string) {
  let status: z.infer<typeof inputStatusSchema> | null = null;
  const history: z.infer<typeof inputStatusSchema>[] = [];
  let searchControl: z.infer<typeof searchControlSchema> | null = null;
  const searchPrefix = "BARO_DIRECTORY_SEARCH_STATUS:";
  for (const line of output
    .split(/\r?\n/)
    .filter((line) => line.startsWith(searchPrefix))
    .slice(-4)) {
    try {
      const parsed = searchControlSchema.safeParse(JSON.parse(line.slice(searchPrefix.length)));
      if (parsed.success) searchControl = parsed.data;
    } catch {
      /* Only fixed native keyboard counts and booleans are retained. */
    }
  }
  const prefix = "BARO_DIRECTORY_UI_STATUS:";
  for (const line of output
    .split(/\r?\n/)
    .filter((line) => line.startsWith(prefix))
    .slice(-8)) {
    try {
      const parsed = inputStatusSchema.safeParse(JSON.parse(line.slice(prefix.length)));
      if (parsed.success) {
        status = parsed.data;
        history.push(parsed.data);
      }
    } catch {
      /* Discard all malformed or unknown text. */
    }
  }
  const code = output.match(
    /XCTAssert[A-Za-z]+ failed[^\r\n]*? - (BARO_(?:DIRECTORY|KOREAN)_[A-Z0-9_]+)(?:[^A-Z0-9_]|$)/,
  )?.[1];
  return {
    status,
    history,
    searchControl,
    assertionCode: assertionCodes.find((value) => value === code) ?? null,
  };
}
const koreanStatusSchema = z.strictObject({
  stage: z.enum(["compose-1", "compose-2", "compose-3", "compose-4", "edited"]),
  expectedValueMatches: z.boolean(),
  keyboardObserved: z.boolean(),
});
const koreanSwitchControlSchema = z
  .strictObject({
    scope: z.literal("app-system-keyboard-region"),
    attempt: z.number().int().min(1).max(3),
    buttonCount: z.number().int().min(0).max(8),
    keyCount: z.number().int().min(0).max(8),
    eligibleButtonCount: z.number().int().min(0).max(8),
    eligibleKeyCount: z.number().int().min(0).max(8),
    ownersOverlap: z.boolean(),
    regionValid: z.boolean(),
    selection: z.enum(["button", "key", "none", "ambiguous"]),
    appForeground: z.boolean(),
    keyboardObserved: z.boolean(),
    actionAllowed: z.boolean(),
  })
  .refine((v) => {
    if (v.eligibleButtonCount > v.buttonCount || v.eligibleKeyCount > v.keyCount) return false;
    if (
      !v.regionValid &&
      (v.eligibleButtonCount !== 0 ||
        v.eligibleKeyCount !== 0 ||
        v.selection !== "none" ||
        !v.ownersOverlap)
    )
      return false;
    if (v.eligibleButtonCount + v.eligibleKeyCount <= 1 && !v.ownersOverlap) return false;
    const ambiguous = v.eligibleButtonCount > 1 || v.eligibleKeyCount > 1 || !v.ownersOverlap;
    const expected = ambiguous
      ? "ambiguous"
      : v.eligibleButtonCount === 1
        ? "button"
        : v.eligibleKeyCount === 1
          ? "key"
          : "none";
    return (
      v.selection === expected &&
      v.actionAllowed ===
        (v.appForeground &&
          v.keyboardObserved &&
          v.regionValid &&
          (expected === "button" || expected === "key"))
    );
  });
const koreanSetupControlSchema = z
  .strictObject({
    stage: z.enum([
      "general",
      "keyboard",
      "keyboard-list",
      "add-keyboard",
      "korean",
      "layout",
      "done",
    ]),
    cellCount: z.number().int().min(0).max(8),
    buttonCount: z.number().int().min(0).max(8),
    textCount: z.number().int().min(0).max(8),
    ownersOverlap: z.boolean().optional(),
    cellQuerySource: z.enum(["direct-label", "known-descendant"]).optional(),
    selection: z.enum(["cell", "button", "text", "none", "ambiguous"]),
    scrolls: z.number().int().min(0).max(12),
  })
  .refine((v) => {
    if (v.ownersOverlap !== undefined) {
      if (v.cellCount + v.buttonCount <= 1 && !v.ownersOverlap) return false;
      const ambiguous =
        v.cellCount > 1 ||
        v.buttonCount > 1 ||
        !v.ownersOverlap ||
        (v.cellCount === 0 && v.buttonCount === 0 && v.textCount > 1);
      const expected = ambiguous
        ? "ambiguous"
        : v.cellCount === 1
          ? "cell"
          : v.buttonCount === 1
            ? "button"
            : v.textCount === 1
              ? "text"
              : "none";
      return v.selection === expected;
    }
    const sum = v.cellCount + v.buttonCount + v.textCount;
    if (v.selection === "none") return sum === 0;
    if (v.selection === "ambiguous") return sum >= 2;
    if ([v.cellCount, v.buttonCount, v.textCount].some((n) => n > 1)) return false;
    return (
      v.selection ===
      (v.cellCount === 1
        ? "cell"
        : v.buttonCount === 1
          ? "button"
          : v.textCount === 1
            ? "text"
            : "none")
    );
  });
const koreanLayoutStatusSchema = z
  .strictObject({
    stage: z.enum(["before-selection", "after-selection"]),
    traitSelected: z.boolean(),
    valueClass: z.enum(["absent", "selected", "unselected", "empty", "other"]),
    doneButtonCount: z.number().int().min(0).max(8),
    doneHittable: z.boolean(),
    doneInNavigationBar: z.boolean(),
    standardObserved: z.boolean(),
    tenKeyObserved: z.boolean(),
    koreanTitleObserved: z.boolean(),
  })
  .refine((v) => !v.doneHittable || v.doneButtonCount === 1);
const koreanSeparateChoiceSchema = z
  .strictObject({
    koreanTitleObserved: z.boolean(),
    promptObserved: z.boolean(),
    scopeKind: z.enum(["table", "collection", "missing", "ambiguous"]).optional(),
    scopeCount: z.number().int().min(0).max(8).optional(),
    cellCount: z.number().int().min(0).max(8),
    buttonCount: z.number().int().min(0).max(8),
    ownersOverlap: z.boolean(),
    selection: z.enum(["cell", "button", "none", "ambiguous"]),
    decision: z.enum(["legacy-layout", "separate-keyboard", "blocked"]),
  })
  .refine((v) => {
    if (
      !koreanSetupControlSchema.safeParse({
        stage: "layout",
        cellCount: v.cellCount,
        buttonCount: v.buttonCount,
        textCount: 0,
        ownersOverlap: v.ownersOverlap,
        selection: v.selection,
        scrolls: 0,
      }).success
    )
      return false;
    if (v.scopeKind !== undefined || v.scopeCount !== undefined) {
      if (v.scopeKind === undefined || v.scopeCount === undefined) return false;
      if (
        v.scopeKind === "missing"
          ? v.scopeCount !== 0
          : v.scopeKind === "ambiguous"
            ? v.scopeCount < 2
            : v.scopeCount !== 1
      )
        return false;
      if (v.scopeCount !== 1 && (v.cellCount !== 0 || v.buttonCount !== 0)) return false;
      if (v.decision === "separate-keyboard" && v.scopeCount !== 1) return false;
    }
    const actionable = v.selection === "cell" || v.selection === "button";
    return v.decision === "legacy-layout"
      ? !v.koreanTitleObserved || !v.promptObserved
      : v.koreanTitleObserved &&
          v.promptObserved &&
          (v.decision === "separate-keyboard" ? actionable : !actionable);
  });
export function observeIosKoreanDirectoryFailure(output: string) {
  const prefix = "BARO_KOREAN_UI_STATUS:",
    history: z.infer<typeof koreanStatusSchema>[] = [];
  for (const line of output
    .split(/\r?\n/)
    .filter((line) => line.startsWith(prefix))
    .slice(-5)) {
    try {
      const parsed = koreanStatusSchema.safeParse(JSON.parse(line.slice(prefix.length)));
      if (parsed.success) history.push(parsed.data);
    } catch {
      /* Raw text and values are never retained. */
    }
  }
  const setupStages = [
      "general",
      "keyboard",
      "keyboard-list",
      "add-keyboard",
      "korean",
      "layout",
      "done",
      "readback",
    ] as const,
    setupPrefix = "BARO_KOREAN_SETUP_STAGE:",
    lastSetup = output
      .split(/\r?\n/)
      .filter((line) => line.startsWith(setupPrefix))
      .at(-1)
      ?.slice(setupPrefix.length);
  const controlPrefix = "BARO_KOREAN_SETUP_CONTROL:";
  let setupControl: z.infer<typeof koreanSetupControlSchema> | null = null;
  for (const line of output
    .split(/\r?\n/)
    .filter((line) => line.startsWith(controlPrefix))
    .slice(-5)) {
    try {
      const parsed = koreanSetupControlSchema.safeParse(
        JSON.parse(line.slice(controlPrefix.length)),
      );
      if (parsed.success) setupControl = parsed.data;
    } catch {
      /* Known counts only; never retain native labels or paths. */
    }
  }
  const layoutPrefix = "BARO_KOREAN_LAYOUT_STATUS:";
  let layoutStatus: z.infer<typeof koreanLayoutStatusSchema> | null = null;
  for (const line of output
    .split(/\r?\n/)
    .filter((line) => line.startsWith(layoutPrefix))
    .slice(-3)) {
    try {
      const parsed = koreanLayoutStatusSchema.safeParse(
        JSON.parse(line.slice(layoutPrefix.length)),
      );
      if (parsed.success) layoutStatus = parsed.data;
    } catch {
      /* Only fixed state classes, counters and presence flags are retained. */
    }
  }
  const choicePrefix = "BARO_KOREAN_SEPARATE_CHOICE:";
  let separateChoice: z.infer<typeof koreanSeparateChoiceSchema> | undefined;
  for (const line of output
    .split(/\r?\n/)
    .filter((line) => line.startsWith(choicePrefix))
    .slice(-2)) {
    try {
      const parsed = koreanSeparateChoiceSchema.safeParse(
        JSON.parse(line.slice(choicePrefix.length)),
      );
      if (parsed.success) separateChoice = parsed.data;
    } catch {
      /* No raw system labels or values in product diagnostics. */
    }
  }
  const switchPrefix = "BARO_KOREAN_SWITCH_STATUS:";
  let switchControl: z.infer<typeof koreanSwitchControlSchema> | undefined;
  for (const line of output
    .split(/\r?\n/)
    .filter((line) => line.startsWith(switchPrefix))
    .slice(-3)) {
    try {
      const parsed = koreanSwitchControlSchema.safeParse(
        JSON.parse(line.slice(switchPrefix.length)),
      );
      if (parsed.success) switchControl = parsed.data;
    } catch {
      /* Only fixed control counts and state flags, never labels/values/geometry. */
    }
  }
  return {
    history,
    ...(separateChoice ? { separateChoice } : {}),
    ...(switchControl ? { switchControl } : {}),
    layoutStatus,
    setupControl,
    setupStage: setupStages.find((stage) => stage === lastSetup) ?? null,
    assertionCode: observeIosDirectoryFailure(output).assertionCode,
  };
}
export const iosDirectoryBaseSchema = iosAuthCancelBaseSchema;
export const iosDirectoryReceiptSchema = iosDirectoryBaseSchema
  .extend({
    kind: z.enum([
      "ios-bundled-public-directory-input-observation",
      "ios-bundled-public-directory-software-search-observation",
      "ios-bundled-public-directory-korean-composition-observation",
    ]),
    swiftTestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    projectGeneratorSha256: z.string().regex(/^[a-f0-9]{64}$/),
    projectGeneratorVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    explicitScreenshotsSuppressedBeforeNavigation: z.literal(true),
    hostRawCommandLogsPersistedAfterBoundary: z.literal(false),
    rawXcresultExported: z.literal(false),
    rawUiHierarchyExported: z.literal(false),
    uiTestRunnerCompiled: z.literal(true),
    productRecompiled: z.literal(false),
    productResigned: z.literal(false),
    result: directoryResultSchema,
  })
  .refine(
    (v) =>
      (v.kind === "ios-bundled-public-directory-input-observation" &&
        v.result.kind === "ios-public-directory-keyboard-rotation") ||
      (v.kind === "ios-bundled-public-directory-software-search-observation" &&
        v.result.kind === "ios-public-directory-software-search-keyboard-rotation") ||
      (v.kind === "ios-bundled-public-directory-korean-composition-observation" &&
        v.result.kind === "ios-public-directory-korean-software-composition"),
  );
export function verifyIosDirectoryReceipt(value: unknown, baselineValue: unknown) {
  const result = iosDirectoryReceiptSchema.parse(value),
    baseline = iosColdLaunchReceiptSchema.parse(baselineValue);
  for (const key of [
    "binarySourceSha",
    "toolingSourceSha",
    "archiveSha256",
    "compilerReceiptSha256",
  ] as const)
    if (result[key] !== baseline[key]) throw Error("INTERNAL_IOS_DIRECTORY_IDENTITY_MISMATCH");
  if (JSON.stringify(result.device) !== JSON.stringify(baseline.device))
    throw Error("INTERNAL_IOS_DIRECTORY_IDENTITY_MISMATCH");
  return result;
}
export async function runIosDirectoryUiTest(context: {
  root: string;
  owned: string;
  device: string;
  korean?: boolean;
  captureSuppressed?: boolean;
  command: (args: string[], cwd?: string, timeout?: number) => Promise<string>;
}) {
  if (
    process.platform !== "darwin" ||
    (context.korean && context.captureSuppressed !== true) ||
    process.env.GITHUB_ACTIONS !== "true" ||
    !/^[a-f0-9-]{36}$/i.test(context.device) ||
    !/^owned-[a-f0-9-]{36}$/i.test(basename(context.owned)) ||
    resolve(context.owned, "..") !== resolve(context.root, ".wrangler/mobile-internal-ios-reverify")
  )
    throw Error("INTERNAL_IOS_DIRECTORY_OWNED_MAC_CI_REQUIRED");
  const project = resolve(context.owned, "directory-ui-test");
  await mkdir(project);
  try {
    const originalSwift = await readFile(
        resolve(import.meta.dir, "mobile-ios-ui/DirectoryUITests.swift"),
      ),
      swift = context.korean
        ? Buffer.concat([
            originalSwift,
            Buffer.from("\n"),
            await readFile(resolve(import.meta.dir, "mobile-ios-ui/DirectoryKoreanUITests.swift")),
          ])
        : originalSwift,
      ruby = await readFile(resolve(import.meta.dir, "mobile-ios-ui/create-project.rb"));
    // Reuse the existing standalone runner target; the test class/selector is distinct.
    await writeFile(resolve(project, "HomeUITests.swift"), swift, { flag: "wx" });
    await writeFile(resolve(project, "create-project.rb"), ruby, { flag: "wx" });
    const generated = await context.command(["ruby", "create-project.rb"], project),
      version = generated.match(/^BARO_XCODEPROJ_VERSION:(\d+\.\d+\.\d+)$/m)?.[1];
    if (!version) throw Error("INTERNAL_IOS_UI_TEST_GENERATOR_VERSION_REQUIRED");
    const output = await context.command(
      [
        "xcodebuild",
        "test",
        "-project",
        resolve(project, "BaroHomeUI.xcodeproj"),
        "-scheme",
        "BaroHomeUITests",
        "-configuration",
        "Debug",
        "-sdk",
        "iphonesimulator",
        "-destination",
        `id=${context.device}`,
        "-derivedDataPath",
        resolve(project, "build"),
        "-resultBundlePath",
        resolve(project, "private-results.xcresult"),
        "-parallel-testing-enabled",
        "NO",
        "-testLanguage",
        "en",
        "-testRegion",
        "US",
        `-only-testing:BaroHomeUITests/BaroDirectoryUITests/${context.korean ? "testPublicDirectoryKoreanCompositionAndRotation" : "testPublicDirectoryKeyboardAndRotation"}`,
        ...xcodeSimulatorControlArguments,
      ],
      project,
      900000,
    );
    const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
    return {
      swiftTestSha256: hash(swift),
      projectGeneratorSha256: hash(ruby),
      projectGeneratorVersion: version,
      result: parseIosDirectoryResult(output),
    };
  } finally {
    // Private XCTest logs/results never enter the artifact directory, including on failure.
    await rm(project, { recursive: true, force: true });
  }
}
