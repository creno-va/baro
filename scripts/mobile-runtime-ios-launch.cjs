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
  if (
    url.protocol !== "baro-dev:" ||
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
  await api.openUrlAsync({ udid }, { url: rawUrl, appId: "site.baro.app.dev" });
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
  if (approval["com.apple.CoreSimulator.CoreSimulatorBridge-->baro-dev"] !== "site.baro.app.dev")
    throw new Error("RUNTIME_IOS_SCHEME_APPROVAL_NOT_CONFIRMED");
}
module.exports = { validateOwnedIosDevice };
if (require.main === module)
  main().catch((error) => {
    console.error(
      error instanceof Error && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.message)
        ? error.message
        : "RUNTIME_IOS_LAUNCH_FAILED",
    );
    process.exitCode = 1;
  });
