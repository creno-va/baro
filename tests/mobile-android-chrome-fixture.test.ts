import { expect, test } from "bun:test";
import {
  androidChromeFixtureSchema,
  inspectChromeVersion,
  knownAndroidChromeFixtureFailure,
  prepareOwnedChromeFixture,
} from "../scripts/mobile-android-chrome-fixture";

function host(
  options: { build?: string; existing?: string; badReadback?: boolean; retainFlags?: boolean } = {},
) {
  let file = options.existing;
  const calls: { args: string[]; input: string | undefined }[] = [];
  const context = {
    freshOwnedEmulator: true,
    deviceSerial: "emulator-5580",
    avdName: "baro_runtime_0123456789ab",
    async shell(args: string[], input?: string) {
      calls.push({ args, input });
      if (args[0] === "getprop") return options.build ?? "userdebug\n";
      if (args[0] === "ls")
        return file === undefined ? "owned-other-file\n" : "chrome-command-line\n";
      if (args[0] === "dumpsys") return "  versionName=130.0.6723.58\n";
      if (args.join(" ") === "am force-stop com.android.chrome") return "";
      if (args[0] === "tee") {
        file = input;
        return input ?? "";
      }
      if (args[0] === "cat")
        return options.badReadback ? "_ --ignore-certificate-errors\n" : (file ?? "");
      if (args[0] === "rm") {
        if (!options.retainFlags) file = undefined;
        return "";
      }
      throw Error("unexpected fixture command");
    },
  };
  return {
    context,
    calls,
    get file() {
      return file;
    },
  };
}
test("Chrome preparation refuses physical/shared/user devices and preserves existing command line files", async () => {
  for (const patch of [
    { freshOwnedEmulator: false },
    { deviceSerial: "physical-device" },
    { avdName: "another-avd" },
  ]) {
    const h = host();
    await expect(prepareOwnedChromeFixture({ ...h.context, ...patch })).rejects.toThrow(
      "ANDROID_CHROME_OWNED_EMULATOR_REQUIRED",
    );
    expect(h.calls).toHaveLength(0);
  }
  const user = host({ build: "user\n" });
  await expect(prepareOwnedChromeFixture(user.context)).rejects.toThrow(
    "ANDROID_CHROME_DEBUG_BUILD_REQUIRED",
  );
  expect(user.calls.map((call) => call.args[0])).toEqual(["getprop"]);
  const existing = host({ existing: "private existing flags" });
  await expect(prepareOwnedChromeFixture(existing.context)).rejects.toThrow(
    "ANDROID_CHROME_EXISTING_FLAGS_REFUSED",
  );
  expect(existing.file).toBe("private existing flags");
  expect(existing.calls.some((call) => ["rm", "tee", "am"].includes(call.args[0] ?? ""))).toBe(
    false,
  );
});
test("a single first-run test switch is read back and no receipt is returned before file cleanup", async () => {
  const h = host();
  const fixture = await prepareOwnedChromeFixture(h.context);
  expect(h.file).toBe("_ --disable-fre\n");
  expect(
    h.calls.some(
      (call) =>
        call.args.includes("root") ||
        call.args.includes("set-debug-app") ||
        call.args.includes("settings") ||
        call.args.includes("input"),
    ),
  ).toBe(false);
  const receipt = await fixture.finish();
  expect(h.file).toBeUndefined();
  expect(receipt).toMatchObject({
    switches: ["--disable-fre"],
    commandLineReadbackVerified: true,
    commandLineRemovedVerified: true,
    consumerFirstRunVerified: false,
    consentUiUsed: false,
    tlsChecksChanged: false,
  });
  const count = h.calls.length;
  expect(await fixture.finish()).toEqual(receipt);
  expect(h.calls).toHaveLength(count);
  for (const patch of [
    { switches: ["--disable-fre", "--ignore-certificate-errors"] },
    { switches: ["--disable-web-security"] },
    { commandLineSha256: "a".repeat(64) },
    { commandLineRemovedVerified: false },
    { consumerFirstRunVerified: true },
    { consentUiUsed: true },
    { debugAppSettingsChanged: true },
    { rawPackageDump: "private" },
  ])
    expect(() => androidChromeFixtureSchema.parse({ ...receipt, ...patch })).toThrow();
});
test("partial setup and failed deletion never become a successful Chrome fixture receipt", async () => {
  const bad = host({ badReadback: true });
  await expect(prepareOwnedChromeFixture(bad.context)).rejects.toThrow(
    "ANDROID_CHROME_FLAG_READBACK_FAILED",
  );
  expect(bad.file).toBeUndefined();
  const retained = host({ retainFlags: true });
  const fixture = await prepareOwnedChromeFixture(retained.context);
  await expect(fixture.finish()).rejects.toThrow("ANDROID_CHROME_FLAG_CLEANUP_FAILED");
  expect(knownAndroidChromeFixtureFailure(Error("ANDROID_CHROME_PRIVATE_VALUE"))).toBeNull();
});
test("package inspection yields only an unambiguous numeric version and never exports package dump text", () => {
  expect(inspectChromeVersion("private metadata\n versionName=130.0.6723.58\n")).toBe(
    "130.0.6723.58",
  );
  for (const dump of [
    "private",
    " versionName=130.0.private\n",
    " versionName=130.0.6723.58\n versionName=131.0.1.1\n",
    "x".repeat(2_000_001),
  ])
    expect(() => inspectChromeVersion(dump)).toThrow("ANDROID_CHROME_VERSION_REQUIRED");
});
