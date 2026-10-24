import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

export function androidRuntimeProfile(value = "google-apis-api35") {
  if (value === "google-apis-api35")
    return {
      kind: "google-apis-api35",
      systemImage: "system-images;android-35;google_apis;x86_64",
      apiLevel: 35,
      abi: "x86_64",
    } as const;
  if (value === "aosp-api35")
    return {
      kind: "aosp-api35",
      systemImage: "system-images;android-35;default;x86_64",
      apiLevel: 35,
      abi: "x86_64",
    } as const;
  throw Error("RUNTIME_ANDROID_PROFILE_REQUIRED");
}
export function verifyOwnedAndroidImage(config: string, sdk: string, profileName: string) {
  const profile = androidRuntimeProfile(profileName);
  if (config.length > 65536) throw Error("RUNTIME_AVD_SYSTEM_IMAGE_MISMATCH");
  const rows = [...config.matchAll(/^image\.sysdir\.1[ \t]*=[ \t]*([^\r\n]+)$/gm)];
  if (
    rows.length !== 1 ||
    !rows[0]?.[1] ||
    resolve(sdk, rows[0][1].trim()) !== resolve(sdk, profile.systemImage.replaceAll(";", "/"))
  )
    throw Error("RUNTIME_AVD_SYSTEM_IMAGE_MISMATCH");
  return profile;
}
export function ownedAndroidPaths(out: string) {
  const avdHome = resolve(out, "android/avd"),
    userHome = resolve(out, "android/user");
  return {
    avdHome,
    userHome,
    environment: {
      ANDROID_AVD_HOME: avdHome,
      ANDROID_USER_HOME: userHome,
      ANDROID_EMULATOR_HOME: userHome,
    },
  };
}
export async function createOwnedAndroidAvd(
  sdk: string,
  out: string,
  avd: string,
  command: (args: string[], input?: string) => Promise<string>,
  profileName = "google-apis-api35",
) {
  androidRuntimeOptions(avd);
  const profile = androidRuntimeProfile(profileName);
  const paths = ownedAndroidPaths(out);
  await mkdir(paths.avdHome, { recursive: true });
  await mkdir(paths.userHome, { recursive: true });
  await command(
    [
      resolve(sdk, "cmdline-tools/latest/bin/avdmanager"),
      "create",
      "avd",
      "-n",
      avd,
      "-k",
      profile.systemImage,
      "--device",
      "pixel_6",
      "--path",
      resolve(paths.avdHome, `${avd}.avd`),
    ],
    "no\n",
  );
  const discovered = (await command([resolve(sdk, "emulator/emulator"), "-list-avds"]))
    .split(/\r?\n/)
    .map((line) => line.trim());
  if (!discovered.includes(avd) || !(await Bun.file(resolve(paths.avdHome, `${avd}.ini`)).exists()))
    throw new Error("RUNTIME_AVD_DISCOVERY_FAILED");
  let config: string;
  try {
    config = await readFile(resolve(paths.avdHome, `${avd}.avd/config.ini`), "utf8");
  } catch {
    throw Error("RUNTIME_AVD_IMAGE_READBACK_REQUIRED");
  }
  verifyOwnedAndroidImage(config, sdk, profile.kind);
  return paths;
}
export function runtimeDevelopmentUrl(profile: "dev" | "preview" = "dev") {
  if (profile !== "dev" && profile !== "preview")
    throw new Error("RUNTIME_DEVELOPMENT_PROFILE_REQUIRED");
  const url = new URL(
    profile === "preview"
      ? "baro-preview://expo-development-client/"
      : "baro-dev://expo-development-client/",
  );
  url.searchParams.set("url", "http://127.0.0.1:8081");
  for (const flag of [
    "__expo_disable_fab",
    "__expo_disable_auto_launch",
    "__expo_disable_onboarding",
  ])
    url.searchParams.set(flag, "1");
  return url.href;
}
/** adb shell joins arguments through the device shell; preserve reserved URL ampersands literally. */
export function quoteAdbShellArgument(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Keep Metro on the IPv4 localhost address used by adb reverse and the native URL. */
export function metroNodeOptions(previous = "") {
  return `${previous.trim()} --dns-result-order=ipv4first`.trim();
}
export function androidRuntimeOptions(avd: string) {
  if (!/^baro_runtime_[a-f0-9]{12}$/.test(avd)) throw new Error("RUNTIME_OWNED_AVD_REQUIRED");
  return [
    "-avd",
    avd,
    "-port",
    "5580",
    "-no-window",
    "-no-audio",
    "-no-boot-anim",
    "-no-snapshot",
    "-wipe-data",
    "-memory",
    "2048",
    "-cores",
    "2",
    "-gpu",
    "swiftshader",
    "-feature",
    "-Vulkan",
    "-camera-back",
    "none",
    "-camera-front",
    "none",
  ];
}
/** Export fixed diagnostic codes; never export raw emulator/app logs. */
export function emulatorStartupIssues(log: string) {
  const known: [string, RegExp][] = [
    [
      "RAM_UNAVAILABLE",
      /not enough (?:free )?(?:ram|memory)|insufficient (?:ram|memory)|cannot allocate memory/i,
    ],
    ["DISK_UNAVAILABLE", /not enough (?:disk )?space|insufficient disk|no space left on device/i],
    [
      "ACCELERATION_UNAVAILABLE",
      /kvm.*(?:denied|not found|not supported)|hardware acceleration.*(?:required|not available)/i,
    ],
    [
      "GPU_INITIALIZATION_FAILED",
      /failed to (?:initialize|create).*(?:vulkan|gpu|renderer)|vulkan.*(?:failed|error)/i,
    ],
    [
      "HOST_LIBRARY_MISSING",
      /error while loading shared libraries|could not load.*(?:libqt|libegl)/i,
    ],
    ["AVD_INVALID", /unknown avd|cannot find avd|avd.*(?:not found|missing)/i],
  ];
  return known.filter(([, pattern]) => pattern.test(log)).map(([code]) => code);
}
