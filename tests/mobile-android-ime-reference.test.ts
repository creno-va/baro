import { expect, test } from "bun:test";
import {
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
