import { expect, test } from "bun:test";
import {
  androidGboardSettingsActivity,
  androidGboardSettingsControls,
  androidImeReferenceConfiguration,
  assertAndroidImeProductAbsent,
  inspectAndroidImeInventory,
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
