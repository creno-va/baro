import { expect, test } from "bun:test";
import {
  type AndroidImeRegistrationDiagnostic,
  androidDefaultImeState,
  androidGboardSettingsActivity,
  androidGboardSettingsControls,
  androidImeReferenceConfiguration,
  assertAndroidImeProductAbsent,
  inspectAndroidImeInventory,
  observeAndroidImeRegistration,
} from "../scripts/mobile-android-ime-reference";

const google = "com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME";
const aosp = "com.android.inputmethod.latin/.LatinIME";
function dump(id: string, subtypes: { locale: string; tag: string; mode?: string }[]) {
  return (
    `${id}:\n  mId=${id} mSettingsActivityName=private-reference-only\n  Service:\n    private metadata ignored\n  InputMethodSubtype array: count=${subtypes.length}\n` +
    subtypes
      .map(
        (s, i) =>
          `    InputMethodSubtype #${i}:\n      mSubtypeNameOverride=private-ignored mSubtypeLocale=${s.locale} mSubtypeLanguageTag=${s.tag} mSubtypeMode=${s.mode ?? "keyboard"} mIsAuxiliary=false\n`,
      )
      .join("")
  );
}
test("Android15 subtype inventory binds the selected default and exports only vendor enums and registration counts", () => {
  const raw =
    dump(google, [
      { locale: "en_US", tag: "en-US" },
      { locale: "ko_KR", tag: "ko-KR" },
    ]) + dump(aosp, []);
  expect(inspectAndroidImeInventory(raw, `${google}\n`)).toEqual({
    methods: [
      {
        vendor: "google-gboard",
        selectedDefault: true,
        registeredSubtypes: 2,
        registeredKoreanKeyboardSubtypes: 1,
      },
      {
        vendor: "aosp-latin",
        selectedDefault: false,
        registeredSubtypes: 0,
        registeredKoreanKeyboardSubtypes: 0,
      },
    ],
    registeredSubtypeMetadataComplete: true,
    rawMetadataExported: false,
  });
  const out = JSON.stringify(inspectAndroidImeInventory(raw, google));
  for (const privateValue of [
    google,
    aosp,
    "private-reference",
    "private-ignored",
    "en_US",
    "ko_KR",
    "Service:",
  ])
    expect(out).not.toContain(privateValue);
});
test("registered Korean keyboard metadata is distinct from a voice subtype, another language or a future language download", () => {
  const rows = [
    { locale: "ko", tag: "", mode: "voice" },
    { locale: "kok_IN", tag: "kok-IN" },
    { locale: "", tag: "ko-KR" },
  ];
  expect(
    inspectAndroidImeInventory(dump(aosp, rows), aosp).methods[0]?.registeredKoreanKeyboardSubtypes,
  ).toBe(1);
  const other = "org.example.keyboard/.Ime";
  expect(inspectAndroidImeInventory(dump(other, []), other).methods[0]).toEqual({
    vendor: "other",
    selectedDefault: true,
    registeredSubtypes: 0,
    registeredKoreanKeyboardSubtypes: 0,
  });
});
test("missing, duplicate, reordered or incomplete subtype records cannot be mistaken for Korean absence", () => {
  const valid = dump(aosp, [
    { locale: "en_US", tag: "en-US" },
    { locale: "ko_KR", tag: "ko-KR" },
  ]);
  for (const raw of [
    "",
    `private-prefix\n${valid}`,
    valid + valid,
    valid.replace("count=2", "count=3"),
    valid.replace("#1:", "#0:"),
    valid.replace("mSubtypeLanguageTag=ko-KR", ""),
    valid.replace("mSubtypeLocale=ko_KR", "mSubtypeLocale=ko_KR mSubtypeLocale=private"),
    valid.replace("mSubtypeNameOverride=private-ignored", "missing subtype"),
    valid.replace("count=2", "count=2049"),
    dump(aosp, []).replace("count=0\n", "count=0\n    unparsed metadata\n"),
    "x".repeat(4_000_001),
  ])
    expect(() => inspectAndroidImeInventory(raw, aosp)).toThrow();
  expect(() => inspectAndroidImeInventory(valid, google)).toThrow(
    "ANDROID_IME_REFERENCE_DEFAULT_NOT_REGISTERED",
  );
  expect(() => inspectAndroidImeInventory(valid, "null")).toThrow();
  expect(
    inspectAndroidImeInventory(valid.replaceAll("\n", "\r\n"), aosp).methods[0]?.registeredSubtypes,
  ).toBe(2);
});
test("product absence is checked on the fresh image, never silently accepting a malformed package inventory", () => {
  expect(() =>
    assertAndroidImeProductAbsent("package:com.android.settings\npackage:com.google.android.gms\n"),
  ).not.toThrow();
  for (const text of [
    "",
    "Error: denied",
    "package:site.baro.app",
    "package:site.baro.app.preview",
    "package:site.baro.app.local\npackage:com.android.settings",
    "package:com.android.settings\nprivate\n",
  ])
    expect(() => assertAndroidImeProductAbsent(text)).toThrow();
});

test("explicit tooling source survives the isolated child environment without forwarding unrelated credentials", () => {
  const input = {
    EXPO_PUBLIC_APP_ENV: "preview",
    EXPO_PUBLIC_API_URL: "https://preview.baro.site",
    ANDROID_HOME: "/synthetic/android-sdk",
    TARGET_SHA: "a".repeat(40),
    GITHUB_TOKEN: "synthetic-do-not-forward",
    OTHER_SECRET: "synthetic-do-not-forward",
  };
  const config = androidImeReferenceConfiguration(input);
  expect(config.source).toBe(input.TARGET_SHA);
  expect(config.sdk).toBe(input.ANDROID_HOME);
  expect(config.env.TARGET_SHA).toBeUndefined();
  expect(config.env.GITHUB_TOKEN).toBeUndefined();
  expect(config.env.OTHER_SECRET).toBeUndefined();
  for (const TARGET_SHA of [undefined, "main", "a".repeat(39), "A".repeat(40)])
    expect(() => androidImeReferenceConfiguration({ ...input, TARGET_SHA })).toThrow(
      "ANDROID_IME_REFERENCE_EXPLICIT_SDK_SOURCE_REQUIRED",
    );
  expect(() => androidImeReferenceConfiguration({ ...input, ANDROID_HOME: undefined })).toThrow(
    "ANDROID_IME_REFERENCE_EXPLICIT_SDK_SOURCE_REQUIRED",
  );
});

const settingsClass = "com.google.android.apps.inputmethod.latin.preference.SettingsActivity";
const settingsComponent = `com.google.android.inputmethod.latin/${settingsClass}`;
const settingsForeground = `topResumedActivity=ActivityRecord{synthetic u0 ${settingsComponent} t12}`;
const settingsDump = () =>
  dump(google, [{ locale: "en_US", tag: "en-US" }]).replace(
    "private-reference-only",
    settingsClass,
  );
function settingsXml(overrides = "") {
  return `<?xml version="1.0"?><hierarchy><node package="com.google.android.inputmethod.latin" class="android.widget.TextView" enabled="true" text="Gboard"/><node package="com.google.android.inputmethod.latin" class="android.widget.TextView" enabled="true" text="Languages"/><node package="com.google.android.inputmethod.latin" class="android.widget.TextView" enabled="true" text="Preferences"/>${overrides}</hierarchy>`;
}
test("the Settings reference uses the selected SDK Gboard's explicit metadata activity, never a guessed or external component", () => {
  expect(androidGboardSettingsActivity(settingsDump(), google)).toBe(settingsComponent);
  expect(
    androidGboardSettingsActivity(
      settingsDump().replace(settingsClass, ".SettingsActivity"),
      google,
    ),
  ).toBe(
    "com.google.android.inputmethod.latin/com.google.android.inputmethod.latin.SettingsActivity",
  );
  expect(() => androidGboardSettingsActivity(dump(aosp, []), aosp)).toThrow(
    "ANDROID_IME_REFERENCE_GBOARD_DEFAULT_REQUIRED",
  );
  for (const activity of ["null", "", "other.app/Injected", "$(synthetic)", "a".repeat(257)])
    expect(() =>
      androidGboardSettingsActivity(settingsDump().replace(settingsClass, activity), google),
    ).toThrow();
  expect(() =>
    androidGboardSettingsActivity(
      settingsDump().replace(
        settingsClass,
        `${settingsClass} mSettingsActivityName=${settingsClass}`,
      ),
      google,
    ),
  ).toThrow();
});
test("only fixed public menu counts leave the foreground SDK Settings scope, never arbitrary labels or EditText contents", () => {
  const xml = settingsXml(
    '<node package="com.google.android.inputmethod.latin" class="android.widget.EditText" enabled="true" text="synthetic-private-field"/><node package="com.google.android.inputmethod.latin" class="android.widget.TextView" enabled="true" text="synthetic-unknown-label"/><node package="other.app" class="android.widget.TextView" enabled="true" text="Theme"/>',
  );
  const result = androidGboardSettingsControls(xml, settingsForeground, settingsComponent);
  expect(result.menuCounts.languages).toBe(1);
  expect(result.menuCounts.preferences).toBe(1);
  expect(result.menuCounts.theme).toBe(0);
  expect(result.languageSelectionVerified).toBe(false);
  expect(result.productInputVerified).toBe(false);
  expect(result.rawLabelsExported).toBe(false);
  expect(JSON.stringify(result)).not.toMatch(/synthetic|other.app|EditText|Gboard/);
});
test("an unknown, multiple or mismatched foreground and unproven Settings scope cannot export a menu result", () => {
  for (const foreground of [
    "",
    `${settingsForeground}\n${settingsForeground}`,
    settingsForeground.replace(settingsClass, "OtherActivity"),
    settingsForeground.replace("com.google.android.inputmethod.latin/", "other.app/"),
  ])
    expect(() =>
      androidGboardSettingsControls(settingsXml(), foreground, settingsComponent),
    ).toThrow("ANDROID_IME_REFERENCE_SETTINGS_FOREGROUND_REQUIRED");
  expect(() =>
    androidGboardSettingsControls(settingsXml(), settingsForeground, "other.app/Injected"),
  ).toThrow();
  for (const xml of [
    settingsXml().replace('text="Gboard"', 'text="unknown"'),
    settingsXml().replace('text="Languages"', 'text="unknown"'),
    settingsXml().replaceAll('enabled="true"', 'enabled="false"'),
  ])
    expect(() => androidGboardSettingsControls(xml, settingsForeground, settingsComponent)).toThrow(
      "ANDROID_IME_REFERENCE_SETTINGS_SCOPE_REQUIRED",
    );
});
test("a rejected Settings scope can retain bounded fixed counts only after both foreground guards", () => {
  const diagnostics: unknown[] = [];
  const options = {
    foregroundAfter: settingsForeground,
    diagnostic: (value: unknown) => diagnostics.push(value),
  };
  const xml = settingsXml().replace('text="Gboard"', 'text="synthetic-private-title"');
  expect(() =>
    androidGboardSettingsControls(xml, settingsForeground, settingsComponent, options),
  ).toThrow("ANDROID_IME_REFERENCE_SETTINGS_SCOPE_REQUIRED");
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0]).toMatchObject({
    foregroundBeforeVerified: true,
    foregroundAfterVerified: true,
    titleCount: 0,
    menuCounts: { languages: 1, preferences: 1 },
    strictScopeObserved: false,
  });
  expect(JSON.stringify(diagnostics)).not.toMatch(
    /synthetic|com\.google|SettingsActivity|private-title/,
  );
  for (const patch of [
    { foregroundAfter: "" },
    { foregroundAfter: settingsForeground.replace(settingsClass, "OtherActivity") },
  ]) {
    diagnostics.length = 0;
    expect(() =>
      androidGboardSettingsControls(xml, settingsForeground, settingsComponent, {
        ...options,
        ...patch,
      }),
    ).toThrow("ANDROID_IME_REFERENCE_SETTINGS_FOREGROUND_REQUIRED");
    expect(diagnostics).toHaveLength(0);
  }
  diagnostics.length = 0;
  const tooMany = settingsXml(
    Array(9)
      .fill(
        '<node package="com.google.android.inputmethod.latin" class="android.widget.TextView" enabled="true" text="Theme"/>',
      )
      .join(""),
  );
  expect(() =>
    androidGboardSettingsControls(tooMany, settingsForeground, settingsComponent, options),
  ).toThrow("ANDROID_IME_REFERENCE_SETTINGS_SCOPE_REQUIRED");
  expect(diagnostics).toHaveLength(0);
  const accepted = androidGboardSettingsControls(
    settingsXml(),
    settingsForeground,
    settingsComponent,
    options,
  );
  expect(accepted.gboardTitleObserved).toBe(true);
  expect(diagnostics[0]).toMatchObject({ titleCount: 1, strictScopeObserved: true });
});
test("unsupported or oversized hierarchy and duplicate attributes fail, and the mode defaults to metadata only", () => {
  for (const xml of [
    "",
    settingsXml().replace("<hierarchy>", "<!DOCTYPE private><hierarchy>"),
    settingsXml().replace('text="Gboard"', 'text="Gboard" text="other"'),
    "x".repeat(1_000_001),
    settingsXml("<node incomplete"),
    settingsXml("</node>"),
    settingsXml("<node>"),
  ])
    expect(() =>
      androidGboardSettingsControls(xml, settingsForeground, settingsComponent),
    ).toThrow();
  const input = {
    EXPO_PUBLIC_APP_ENV: "preview",
    EXPO_PUBLIC_API_URL: "https://preview.baro.site",
    TARGET_SHA: "a".repeat(40),
    ANDROID_HOME: "/synthetic/sdk",
  };
  expect(androidImeReferenceConfiguration(input).mode).toBe("metadata");
  expect(
    androidImeReferenceConfiguration({ ...input, BARO_ANDROID_IME_REFERENCE_MODE: "settings" })
      .mode,
  ).toBe("settings");
  expect(() =>
    androidImeReferenceConfiguration({ ...input, BARO_ANDROID_IME_REFERENCE_MODE: "other" }),
  ).toThrow("ANDROID_IME_REFERENCE_MODE_REQUIRED");
});

function registrationFixture(defaults: string[], inventories: string[]) {
  let clock = 0,
    defaultReads = 0,
    inventoryReads = 0;
  const diagnostics: AndroidImeRegistrationDiagnostic[] = [];
  const context = {
    deviceSerial: "emulator-5580",
    avdName: "baro_runtime_012345abcdef",
    freshOwnedEmulator: true,
    productInstalled: false,
    now: () => clock,
    pause: async (ms: number) => {
      clock += ms;
    },
    readDefault: async (timeout: number) => {
      expect(timeout).toBeGreaterThan(0);
      expect(timeout).toBeLessThanOrEqual(15000);
      return defaults[Math.min(defaultReads++, defaults.length - 1)] ?? "null";
    },
    readInventory: async (timeout: number) => {
      expect(timeout).toBeGreaterThan(0);
      expect(timeout).toBeLessThanOrEqual(15000);
      return inventories[Math.min(inventoryReads++, inventories.length - 1)] ?? "";
    },
    diagnostic: (value: AndroidImeRegistrationDiagnostic) => {
      diagnostics.push(value);
    },
  };
  return {
    context,
    diagnostics,
    counts: () => ({ defaultReads, inventoryReads, clock }),
    setClock: (value: number) => {
      clock = value;
    },
  };
}
test("IME registration waits for only known unset/empty/unregistered states and binds one complete registered default without exporting raw values", async () => {
  expect(androidDefaultImeState("null\n")).toBe("uninitialized");
  expect(androidDefaultImeState(" ")).toBe("uninitialized");
  expect(androidDefaultImeState(google)).toBe("component");
  expect(androidDefaultImeState("synthetic-private")).toBe("invalid");
  expect(androidDefaultImeState(" ".repeat(513))).toBe("invalid");
  const fixture = registrationFixture(
    ["null", "", google, google, google],
    ["", dump(aosp, []), settingsDump()],
  );
  const result = await observeAndroidImeRegistration(fixture.context);
  expect(result.readiness).toMatchObject({
    samples: 5,
    uninitializedSamples: 2,
    emptyInventoryObserved: true,
    defaultUnregisteredObserved: true,
    registeredDefaultVerified: true,
    maxSamples: 20,
    sharedBudgetMaxMs: 15000,
  });
  expect(result.inventory.methods[0]?.selectedDefault).toBe(true);
  expect(result.defaultMethodMatches(google)).toBe(true);
  expect(result.defaultMethodMatches(aosp)).toBe(false);
  expect(result.settingsActivity()).toBe(settingsComponent);
  expect(JSON.stringify(result)).not.toMatch(/private|LatinIME|SettingsActivity|com.google|en-US/);
  expect(JSON.stringify(fixture.diagnostics)).not.toMatch(/private|com.google/);
  expect(fixture.diagnostics.at(-1)?.stage).toBe("complete");
});
test("unknown format and malformed nonempty IME metadata fail immediately instead of becoming readiness waits or Korean-zero success", async () => {
  const invalid = registrationFixture(["synthetic-private"], [settingsDump()]);
  await expect(observeAndroidImeRegistration(invalid.context)).rejects.toThrow(
    "ANDROID_IME_REFERENCE_DEFAULT_FORMAT_INVALID",
  );
  expect(invalid.counts()).toEqual({ defaultReads: 1, inventoryReads: 0, clock: 0 });
  expect(invalid.diagnostics.at(-1)?.failureCode).toBe("DEFAULT_FORMAT_INVALID");
  expect(JSON.stringify(invalid.diagnostics)).not.toContain("synthetic-private");
  const malformed = registrationFixture([google], [settingsDump().replace("count=1", "count=2")]);
  await expect(observeAndroidImeRegistration(malformed.context)).rejects.toThrow(
    "ANDROID_IME_REFERENCE_SUBTYPE_INCOMPLETE",
  );
  expect(malformed.counts()).toEqual({ defaultReads: 1, inventoryReads: 1, clock: 0 });
  expect(malformed.diagnostics.at(-1)?.failureCode).toBe("INVENTORY_INVALID");
  const oversized = registrationFixture([google], [" ".repeat(4_000_001)]);
  await expect(observeAndroidImeRegistration(oversized.context)).rejects.toThrow(
    "ANDROID_IME_REFERENCE_INVENTORY_BOUND",
  );
  expect(oversized.counts()).toEqual({ defaultReads: 1, inventoryReads: 1, clock: 0 });
});
test("registration has finite samples and one monotonic budget, and a late complete response cannot pass", async () => {
  for (const defaults of [["null"], [google]]) {
    const fixture = registrationFixture(defaults, [""]);
    await expect(observeAndroidImeRegistration(fixture.context)).rejects.toThrow(
      "ANDROID_IME_REFERENCE_REGISTRATION_WAIT_EXPIRED",
    );
    expect(fixture.counts().defaultReads).toBe(20);
    expect(fixture.counts().clock).toBeLessThanOrEqual(15000);
    expect(fixture.diagnostics.at(-1)?.failureCode).toBe("WAIT_EXPIRED");
    expect(fixture.diagnostics.some((d) => d.stage === "complete")).toBe(false);
  }
  const late = registrationFixture([google], [settingsDump()]);
  late.context.readInventory = async () => {
    late.setClock(15001);
    return settingsDump();
  };
  await expect(observeAndroidImeRegistration(late.context)).rejects.toThrow(
    "ANDROID_IME_REFERENCE_REGISTRATION_WAIT_EXPIRED",
  );
  expect(late.diagnostics.some((d) => d.stage === "complete")).toBe(false);
});
test("registration refuses unowned, already-installed or non-SDK contexts before any device read", async () => {
  for (const change of [
    { deviceSerial: "personal-phone" },
    { avdName: "personal" },
    { freshOwnedEmulator: false },
    { productInstalled: true },
  ]) {
    const fixture = registrationFixture([google], [settingsDump()]);
    await expect(observeAndroidImeRegistration({ ...fixture.context, ...change })).rejects.toThrow(
      "ANDROID_IME_REFERENCE_OWNED_REGISTRATION_CONTEXT_REQUIRED",
    );
    expect(fixture.counts()).toEqual({ defaultReads: 0, inventoryReads: 0, clock: 0 });
  }
});
