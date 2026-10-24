import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { androidHomeRuntimeProfile } from "../scripts/mobile-internal-android-home";
import {
  androidRuntimeOptions,
  androidRuntimeProfile,
  createOwnedAndroidAvd,
  ownedAndroidPaths,
  verifyOwnedAndroidImage,
} from "../scripts/mobile-runtime-host";

test("AOSP is an explicit fixed official image for isolated ASCII input; existing default and resource bounds are preserved", () => {
  expect(androidRuntimeProfile().kind).toBe("google-apis-api35");
  expect(androidRuntimeProfile().systemImage).toBe("system-images;android-35;google_apis;x86_64");
  expect(androidHomeRuntimeProfile("aosp-api35", ["--directory-input"]).systemImage).toBe(
    "system-images;android-35;default;x86_64",
  );
  for (const value of [
    "",
    "default",
    "system-images;android-35;default;x86_64",
    "aosp-api35 --other",
  ])
    expect(() => androidRuntimeProfile(value)).toThrow("RUNTIME_ANDROID_PROFILE_REQUIRED");
  for (const options of [
    [],
    ["--auth-cancel"],
    ["--public-directory"],
    ["--large-font"],
    ["--large-font", "--guide-ui"],
    ["--directory-input", "--auth-cancel"],
    ["--directory-input", "--large-font"],
  ])
    expect(() => androidHomeRuntimeProfile("aosp-api35", options)).toThrow();
  expect(androidHomeRuntimeProfile(undefined, ["--auth-cancel"]).kind).toBe("google-apis-api35");
  const args = androidRuntimeOptions("baro_runtime_012345abcdef");
  expect(args[args.indexOf("-memory") + 1]).toBe("2048");
  expect(args[args.indexOf("-cores") + 1]).toBe("2");
  expect(args[args.indexOf("-port") + 1]).toBe("5580");
});
test("the owned AVD image readback cannot substitute another API, ABI, tag, SDK root or duplicate entry", () => {
  const sdk = "/synthetic/sdk",
    relative = "system-images/android-35/default/x86_64/";
  expect(verifyOwnedAndroidImage(`image.sysdir.1=${relative}\n`, sdk, "aosp-api35").kind).toBe(
    "aosp-api35",
  );
  expect(
    verifyOwnedAndroidImage(`image.sysdir.1=${sdk}/${relative}\n`, sdk, "aosp-api35").kind,
  ).toBe("aosp-api35");
  for (const config of [
    "",
    `image.sysdir.1=${relative.replace("default", "google_apis")}`,
    `image.sysdir.1=${relative.replace("35", "36")}`,
    `image.sysdir.1=${relative.replace("x86_64", "arm64-v8a")}`,
    `image.sysdir.1=/other/sdk/${relative}`,
    `image.sysdir.1=${relative}\nimage.sysdir.1=${relative}\n`,
    `image.sysdir.1=${relative}\n${"x".repeat(65536)}`,
  ])
    expect(() => verifyOwnedAndroidImage(config, sdk, "aosp-api35")).toThrow(
      "RUNTIME_AVD_SYSTEM_IMAGE_MISMATCH",
    );
  expect(() =>
    verifyOwnedAndroidImage(`image.sysdir.1=${relative}`, sdk, "google-apis-api35"),
  ).toThrow();
});
test("actual owned filesystem creation selects the fixed image and rejects a missing or mismatched image before an Emulator can launch", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "baro-profile-")),
    sdk = resolve(root, "sdk");
  try {
    for (const [name, expected] of [
      ["google-apis-api35", "google_apis"],
      ["aosp-api35", "default"],
    ] as const) {
      for (const returned of [expected, "wrong-image", "missing"]) {
        const out = resolve(root, name, returned),
          avd = "baro_runtime_012345abcdef",
          paths = ownedAndroidPaths(out);
        let commands = 0;
        const command = async (args: string[], input?: string) => {
          commands++;
          if (args.includes("create")) {
            expect(args[args.indexOf("-k") + 1]).toBe(
              `system-images;android-35;${expected};x86_64`,
            );
            expect(args[args.indexOf("--path") + 1]).toBe(resolve(paths.avdHome, `${avd}.avd`));
            expect(input).toBe("no\n");
            await mkdir(resolve(paths.avdHome, `${avd}.avd`), { recursive: true });
            await writeFile(resolve(paths.avdHome, `${avd}.ini`), "synthetic-owned-only\n");
            if (returned !== "missing")
              await writeFile(
                resolve(paths.avdHome, `${avd}.avd/config.ini`),
                `image.sysdir.1=system-images/android-35/${returned}/x86_64/\n`,
              );
            return "";
          }
          expect(args.at(-1)).toBe("-list-avds");
          return `${avd}\n`;
        };
        if (returned === expected)
          expect((await createOwnedAndroidAvd(sdk, out, avd, command, name)).avdHome).toBe(
            paths.avdHome,
          );
        else
          await expect(createOwnedAndroidAvd(sdk, out, avd, command, name)).rejects.toThrow(
            returned === "missing"
              ? "RUNTIME_AVD_IMAGE_READBACK_REQUIRED"
              : "RUNTIME_AVD_SYSTEM_IMAGE_MISMATCH",
          );
        expect(commands).toBe(2);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
