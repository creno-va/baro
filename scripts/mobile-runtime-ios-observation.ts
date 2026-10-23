import { createRequire } from "node:module";

const { iosLaunchFailureCodes, iosFailureDomains } = createRequire(import.meta.url)(
  "./mobile-runtime-ios-launch.cjs",
) as {
  iosLaunchFailureCodes: string[];
  iosFailureDomains: (detail: string) => { domain: string; code: number }[];
};
/** The launcher emits fixed codes/domains; every other private stderr value is discarded. */
export function observeIosLauncherFailure(stderr: string, timedOut: boolean) {
  const lines = new Set(stderr.split(/\r?\n/).map((line) => line.trim()));
  return {
    code:
      iosLaunchFailureCodes.find((code) => lines.has(code)) ??
      (timedOut ? "RUNTIME_IOS_LAUNCH_COMMAND_TIMEOUT" : "RUNTIME_IOS_LAUNCH_FAILED"),
    timedOut,
    domains: iosFailureDomains(stderr),
  };
}
