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
