const { execFileSync } = require("node:child_process");
const { dirname, resolve } = require("node:path");
const { homedir } = require("node:os");

function validateOwnedIosDevice(inventory, udid, name) {
  if (!/^[a-f0-9-]{36}$/i.test(udid) || !/^baro_runtime_[a-f0-9]{12}$/.test(name))
    throw new Error("RUNTIME_OWNED_IOS_DEVICE_REQUIRED");
  const devices = Object.values(inventory.devices).flat();
  if (
    !devices.some(
      (device) => device.udid === udid && device.name === name && device.state === "Booted",
    )
  )
    throw new Error("RUNTIME_OWNED_IOS_DEVICE_REQUIRED");
}
function sdk() {
  const metadata = require.resolve("@expo/cli/package.json");
  if (require(metadata).version !== "58.1.14") throw new Error("RUNTIME_IOS_LAUNCH_SDK_CHANGED");
  const api = require(resolve(dirname(metadata), "build/src/start/platforms/ios/simctl.js"));
  if (typeof api.openUrlAsync !== "function") throw new Error("RUNTIME_IOS_LAUNCH_API_REQUIRED");
  return api;
}
function iosLaunchFailureCode(error) {
  const message = error instanceof Error ? error.message : "";
  if (
    new Set([
      "RUNTIME_OWNED_IOS_DEVICE_REQUIRED",
      "RUNTIME_IOS_LAUNCH_SDK_CHANGED",
      "RUNTIME_IOS_LAUNCH_API_REQUIRED",
      "RUNTIME_IOS_LAUNCH_ARGUMENTS_REQUIRED",
      "RUNTIME_IOS_LOCAL_DEVELOPMENT_URL_REQUIRED",
      "RUNTIME_IOS_SCHEME_APPROVAL_NOT_CONFIRMED",
    ]).has(message)
  )
    return message;
  const stderr = error && typeof error.stderr === "string" ? error.stderr : "";
  const detail = `${message}\n${stderr}`;
  if (
    /code signature.*(?:invalid|rejected)|Invalid code signature|0xe80080|ApplicationVerificationFailed/i.test(
      detail,
    )
  )
    return "RUNTIME_IOS_APPLICATION_SIGNATURE_REJECTED";
  if (/FBSOpenApplicationService|RBSRequestError|not allowed to launch/i.test(detail))
    return "RUNTIME_IOS_APPLICATION_LAUNCH_DENIED";
  return "RUNTIME_IOS_LAUNCH_FAILED";
}
function iosFailureDomains(detail) {
  const names = [
    "NSOSStatusErrorDomain",
    "NSPOSIXErrorDomain",
    "FBSOpenApplicationServiceErrorDomain",
    "RBSRequestErrorDomain",
    "LSApplicationWorkspaceErrorDomain",
    "MIInstallerErrorDomain",
    "IXUserPresentableErrorDomain",
    "NSCocoaErrorDomain",
  ];
  const expression = new RegExp(
    `\\b(${names.join("|")})\\b\\s+(?:Code\\s*[=:]\\s*)?(-?\\d{1,10})(?!\\d)`,
    "g",
  );
  const result = [];
  for (const match of detail.matchAll(expression)) {
    const code = Number(match[2]);
    if (!Number.isInteger(code) || code < -2147483648 || code > 4294967295) continue;
    if (!result.some((item) => item.domain === match[1] && item.code === code))
      result.push({ domain: match[1], code });
    if (result.length === 4) break;
  }
  return result;
}
async function main() {
  const [mode, udid, name, rawUrl] = process.argv.slice(2);
  const api = sdk();
  if (mode === "--self-test" && process.argv.length === 3) {
    console.log("IOS_RUNTIME_LAUNCH_API_READY");
    return;
  }
  if (mode !== "--open" || process.argv.length !== 6)
    throw new Error("RUNTIME_IOS_LAUNCH_ARGUMENTS_REQUIRED");
  const url = new URL(rawUrl);
  const allowed = { "baro-dev:": "site.baro.app.dev", "baro-preview:": "site.baro.app.preview" };
  const appId = allowed[url.protocol];
  if (
    !appId ||
    url.hostname !== "expo-development-client" ||
    url.searchParams.get("url") !== "http://127.0.0.1:8081"
  )
    throw new Error("RUNTIME_IOS_LOCAL_DEVELOPMENT_URL_REQUIRED");
  const inventory = JSON.parse(
    execFileSync("xcrun", ["simctl", "list", "devices", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  );
  validateOwnedIosDevice(inventory, udid, name);
  // Use Expo's pinned simulator scheme-approval preparation, restricted to our fresh device.
  // This does not grant OAuth, application consent, local-network or physical-device permissions.
  await api.openUrlAsync({ udid }, { url: rawUrl, appId });
  const approvalPath = resolve(
    homedir(),
    "Library/Developer/CoreSimulator/Devices",
    udid,
    "data/Library/Preferences/com.apple.launchservices.schemeapproval.plist",
  );
  const approval = JSON.parse(
    execFileSync("plutil", ["-convert", "json", "-o", "-", approvalPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  );
  if (
    approval[`com.apple.CoreSimulator.CoreSimulatorBridge-->${url.protocol.slice(0, -1)}`] !== appId
  )
    throw new Error("RUNTIME_IOS_SCHEME_APPROVAL_NOT_CONFIRMED");
}
module.exports = { validateOwnedIosDevice, iosLaunchFailureCode, iosFailureDomains };
if (require.main === module)
  main().catch((error) => {
    console.error(iosLaunchFailureCode(error));
    const detail = `${error instanceof Error ? error.message : ""}\n${error && typeof error.stderr === "string" ? error.stderr : ""}`;
    for (const { domain, code } of iosFailureDomains(detail))
      console.error(`IOS_RUNTIME_FAILURE_DOMAIN ${domain} ${code}`);
    process.exitCode = 1;
  });
