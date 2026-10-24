import { expect, test } from "bun:test";
import {
  type AndroidAuthHierarchyDiagnostic,
  readAndroidAuthHierarchy,
} from "../scripts/mobile-android-auth-hierarchy";

function fixture(
  mode:
    | "saved"
    | "idle-timeout"
    | "root-unavailable"
    | "unknown"
    | "dump-error"
    | "read-error"
    | "cleanup-error"
    | "both-errors",
) {
  const calls: string[][] = [],
    diagnostics: AndroidAuthHierarchyDiagnostic[] = [];
  const context = {
    shell: async (args: string[]) => {
      calls.push(args);
      if (args[0] === "uiautomator") {
        if (mode === "dump-error") throw new Error("SYNTHETIC_PRIVATE_DUMP");
        return mode === "saved" ||
          mode === "read-error" ||
          mode === "cleanup-error" ||
          mode === "both-errors"
          ? `UI hierchary dumped to: ${args.at(-1)}\n`
          : mode === "idle-timeout"
            ? "ERROR: could not get idle state.\n"
            : mode === "root-unavailable"
              ? "ERROR: null root node returned by UiTestAutomationBridge.\n"
              : "SYNTHETIC_PRIVATE_UNCONFIRMED";
      }
      if (args[0] === "cat") {
        if (mode === "read-error" || mode === "both-errors")
          throw new Error("SYNTHETIC_PRIVATE_READ");
        return '<?xml version="1.0"?><hierarchy/>SYNTHETIC_IN_MEMORY_ONLY';
      }
      if (args[0] === "rm") {
        if (mode === "cleanup-error" || mode === "both-errors")
          throw new Error("SYNTHETIC_PRIVATE_CLEANUP");
        return "";
      }
      throw new Error("UNEXPECTED_FIXTURE_COMMAND");
    },
    diagnostic: (value: AndroidAuthHierarchyDiagnostic) => {
      diagnostics.push(value);
    },
  };
  return { calls, diagnostics, context };
}

test("confirmed dumps are read once from unique owned files and removed before returning in-memory XML", async () => {
  const f = fixture("saved");
  for (let i = 0; i < 2; i++)
    expect(await readAndroidAuthHierarchy(f.context)).toContain("SYNTHETIC_IN_MEMORY_ONLY");
  const paths = f.calls.filter((c) => c[0] === "uiautomator").map((c) => c.at(-1));
  expect(new Set(paths).size).toBe(2);
  for (const path of paths) expect(path).toMatch(/^\/sdcard\/baro-auth-[a-f0-9-]{36}\.xml$/);
  expect(f.calls.map((c) => c[0])).toEqual([
    "uiautomator",
    "cat",
    "rm",
    "uiautomator",
    "cat",
    "rm",
  ]);
  expect(f.calls[0]?.at(-1)).toBe(f.calls[1]?.[1]);
  expect(f.calls[0]?.at(-1)).toBe(f.calls[2]?.at(-1));
  expect(f.diagnostics).toEqual(
    Array(2).fill({ outcome: "saved", primaryFailureCode: null, cleanupFailureCode: null }),
  );
  expect(JSON.stringify(f.diagnostics)).not.toMatch(/SYNTHETIC|xml|sdcard/);
});
for (const mode of ["idle-timeout", "root-unavailable"] as const) {
  test(`${mode} consumes no unconfirmed XML read or UI action`, async () => {
    const f = fixture(mode);
    expect(await readAndroidAuthHierarchy(f.context)).toBeNull();
    expect(f.calls.map((c) => c[0])).toEqual(["uiautomator", "rm"]);
    expect(f.diagnostics).toEqual([
      { outcome: mode, primaryFailureCode: null, cleanupFailureCode: null },
    ]);
  });
}
for (const [mode, code] of [
  ["unknown", "ANDROID_AUTH_DUMP_UNCONFIRMED"],
  ["dump-error", "ANDROID_AUTH_DUMP_FAILED"],
  ["read-error", "ANDROID_AUTH_HIERARCHY_READ_FAILED"],
  ["cleanup-error", "ANDROID_AUTH_HIERARCHY_CLEANUP_FAILED"],
  ["both-errors", "ANDROID_AUTH_HIERARCHY_READ_FAILED"],
] as const) {
  test(`${mode} remains failed and retains safe primary/cleanup facts`, async () => {
    const f = fixture(mode);
    await expect(readAndroidAuthHierarchy(f.context)).rejects.toThrow(code);
    expect(f.calls.at(-1)?.[0]).toBe("rm");
    if (mode === "unknown" || mode === "dump-error")
      expect(f.calls.some((c) => c[0] === "cat")).toBe(false);
    expect(f.diagnostics).toHaveLength(1);
    if (mode === "both-errors")
      expect(f.diagnostics[0]).toEqual({
        outcome: "saved",
        primaryFailureCode: "ANDROID_AUTH_HIERARCHY_READ_FAILED",
        cleanupFailureCode: "ANDROID_AUTH_HIERARCHY_CLEANUP_FAILED",
      });
    expect(JSON.stringify(f.diagnostics)).not.toMatch(/SYNTHETIC|xml|sdcard/);
  });
}
test("the native wrapper's combined stdout/stderr outcome wins over an apparently successful stdout", async () => {
  const f = fixture("saved");
  await expect(
    readAndroidAuthHierarchy({ ...f.context, dumpHierarchy: async () => "unknown" }),
  ).rejects.toThrow("ANDROID_AUTH_DUMP_UNCONFIRMED");
  expect(f.calls.map((c) => c[0])).toEqual(["rm"]);
});

import {
  type AndroidAuthDiagnostic,
  observeAndroidAuthCancellation,
} from "../scripts/mobile-android-auth-cancel";

function browserFixture(mode: "transient" | "never-ready" | "unknown" | "cleanup-error") {
  const calls: string[][] = [],
    diagnostic: AndroidAuthDiagnostic[] = [],
    files = new Map<string, string>(),
    browserDumps = new Map<string, number>();
  let state: "home" | "anonymous" | "opening" | "browser" = "home",
    provider = "google",
    pauses = 0;
  const xml = (...nodes: string[]) =>
    `<?xml version="1.0"?><hierarchy>${nodes.join("")}</hierarchy>`;
  const node = (text: string, y: number, clickable = false) =>
    `<node package="site.baro.app.preview" enabled="true" text="${text}" clickable="${clickable}" bounds="[40,${y}][400,${y + 100}]"/>`;
  const anonymous = () =>
    xml(
      node("BARO 로그인", 0),
      node("이용 유형을 선택해 주세요.", 100),
      node("Google로 로그인", 300, true),
      node("네이버로 로그인", 500, true),
      node("카카오로 로그인", 700, true),
    );
  const browser = () =>
    xml(
      '<node package="com.android.chrome" enabled="true" class="android.webkit.WebView" text="SYNTHETIC_PRIVATE_PAGE" bounds="[0,250][1080,1800]"/>',
      '<node package="com.android.chrome" enabled="true" class="android.widget.ImageButton" clickable="true" resource-id="com.android.chrome:id/close_button" bounds="[0,90][140,230]"/>',
    );
  const context = {
    width: 1080,
    height: 1920,
    boundaryEntered: true,
    screenshotsSuppressed: true,
    pause: async () => {
      pauses++;
    },
    diagnostic: (value: AndroidAuthDiagnostic) => {
      diagnostic.push(value);
    },
    shell: async (args: string[]) => {
      calls.push(args);
      if (args.slice(0, 3).join(" ") === "pm path com.android.chrome")
        return "package:/system/app/Chrome.apk";
      if (args.slice(0, 3).join(" ") === "dumpsys activity activities")
        return state === "browser"
          ? "topResumedActivity=ActivityRecord{abc u0 com.android.chrome/org.chromium.chrome.browser.customtabs.CustomTabActivity t1}"
          : "topResumedActivity=ActivityRecord{abc u0 site.baro.app.preview/.MainActivity t1}";
      if (args[0] === "cat") {
        const value = files.get(args[1] ?? "");
        if (!value) throw Error("UNCONFIRMED_FILE_READ");
        return value;
      }
      if (args[0] === "rm") {
        if (mode === "cleanup-error" && (state === "opening" || state === "browser"))
          throw Error("SYNTHETIC_PRIVATE_CLEANUP");
        files.delete(args.at(-1) ?? "");
        return "";
      }
      if (args[0] === "input" && args[1] === "tap") {
        const y = Number(args[3]);
        if (state === "home" && y === 150) {
          state = "anonymous";
          return "";
        }
        if (state === "anonymous" && [350, 550, 750].includes(y)) {
          provider = y === 350 ? "google" : y === 550 ? "naver" : "kakao";
          state = "opening";
          return "";
        }
        throw Error("UNPROVEN_TAP");
      }
      if (args.slice(0, 3).join(" ") === "input keyevent KEYCODE_BACK") {
        if (state !== "browser") throw Error("UNPROVEN_BROWSER_BACK");
        state = "anonymous";
        return "";
      }
      if (args.slice(0, 2).join(" ") === "am force-stop") {
        state = "home";
        return "";
      }
      if (args.slice(0, 2).join(" ") === "am start") {
        state = "home";
        return "Status: ok\n";
      }
      throw Error("UNEXPECTED_FIXTURE_COMMAND");
    },
    dumpHierarchy: async (file: string) => {
      calls.push(["dump", file]);
      if (state === "opening" || state === "browser") {
        const count = (browserDumps.get(provider) ?? 0) + 1;
        browserDumps.set(provider, count);
        if (mode === "never-ready") return "root-unavailable" as const;
        if (mode === "unknown") return "unknown" as const;
        if (mode === "transient" && count === 1) {
          state = "browser";
          return "root-unavailable" as const;
        }
        if (mode === "transient" && count === 2) return "idle-timeout" as const;
        state = "browser";
        files.set(file, browser());
        return "saved" as const;
      }
      files.set(file, state === "home" ? xml(node("로그인·내 계정", 100, true)) : anonymous());
      return "saved" as const;
    },
  };
  return { calls, diagnostic, files, browserDumps, context, pauses: () => pauses };
}

test("auth transition root/idle snapshots consume the existing poll and still require every provider browser/back/cold return", async () => {
  const f = browserFixture("transient"),
    result = await observeAndroidAuthCancellation(f.context);
  expect(result.map((p) => p.provider)).toEqual(["google", "naver", "kakao"]);
  expect([...f.browserDumps.values()]).toEqual([3, 3, 3]);
  expect(
    f.calls.filter((c) => c.slice(0, 3).join(" ") === "input keyevent KEYCODE_BACK"),
  ).toHaveLength(3);
  expect(f.pauses()).toBe(6);
  expect(f.files.size).toBe(0);
  const paths = f.calls.filter((c) => c[0] === "dump").map((c) => c[1]);
  expect(new Set(paths).size).toBe(paths.length);
  expect(JSON.stringify(f.diagnostic)).not.toMatch(/SYNTHETIC_PRIVATE|\/sdcard|\.xml|Chrome.apk/);
});

test("persistent root absence stops at the unchanged twenty browser polls with no Back, login or false provider acceptance", async () => {
  const f = browserFixture("never-ready");
  await expect(observeAndroidAuthCancellation(f.context)).rejects.toThrow(
    "ANDROID_AUTH_BROWSER_REQUIRED",
  );
  expect([...f.browserDumps.entries()]).toEqual([["google", 20]]);
  expect(f.pauses()).toBe(20);
  expect(f.calls.some((c) => c[0] === "input" && c[1] === "keyevent")).toBe(false);
  expect(f.files.size).toBe(0);
  expect(f.diagnostic.at(-1)?.hierarchy?.outcome).toBe("root-unavailable");
});
for (const [mode, code] of [
  ["unknown", "ANDROID_AUTH_DUMP_UNCONFIRMED"],
  ["cleanup-error", "ANDROID_AUTH_HIERARCHY_CLEANUP_FAILED"],
] as const) {
  test(`${mode} aborts the provider flow instead of polling past unsafe IO`, async () => {
    const f = browserFixture(mode);
    await expect(observeAndroidAuthCancellation(f.context)).rejects.toThrow(code);
    expect([...f.browserDumps.entries()]).toEqual([["google", 1]]);
    expect(f.calls.some((c) => c[0] === "input" && c[1] === "keyevent")).toBe(false);
    expect(f.pauses()).toBe(0);
    expect(JSON.stringify(f.diagnostic)).not.toContain("SYNTHETIC_PRIVATE");
  });
}
