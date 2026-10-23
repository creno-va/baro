import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  attestXcodeSimulatorControl,
  configureGeneratedXcodeControl,
  xcodeControlEnvironment,
  xcodeSimulatorControlArguments,
} from "./mobile-ios-xcode-control";
import { verifyCompiledMobileFont } from "./mobile-native-assets";

const platform = process.argv[2];
if (platform !== "android" && platform !== "ios")
  throw new Error("Usage: bun run mobile:native android|ios");
const runtimeLocal = process.argv[3] === "--runtime-local";
const xcodeControl = process.argv[3] === "--xcode-control";
if (xcodeControl && (platform !== "ios" || process.platform !== "darwin"))
  throw new Error("XCODE_CONTROL_SIMULATOR_ONLY");
if (
  runtimeLocal
    ? process.env.EXPO_PUBLIC_APP_ENV !== "local" ||
      process.env.EXPO_PUBLIC_API_URL !== "http://127.0.0.1:8765"
    : process.env.EXPO_PUBLIC_APP_ENV !== "preview"
)
  throw new Error("Native verification must explicitly target preview");

const root = process.cwd();
const mobileRoot = resolve(root, "apps/mobile");
const childEnvironment = xcodeControl ? xcodeControlEnvironment(process.env) : process.env;
async function run(args: string[], cwd = root) {
  const child = Bun.spawn(args, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    env: childEnvironment,
  });
  const code = await child.exited;
  if (code) throw new Error(`${args[0]} failed with exit ${code}`);
}
if (xcodeControl) {
  if (await Bun.file(resolve(root, ".wrangler/mobile-build/xcode-control-ios.json")).exists())
    throw new Error("XCODE_CONTROL_FRESH_OUTPUT_REQUIRED");
  const head = Bun.spawn(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "ignore" });
  if (
    (await new Response(head.stdout).text()).trim() !== process.env.TARGET_SHA ||
    (await head.exited)
  )
    throw new Error("XCODE_CONTROL_CHECKOUT_MISMATCH");
  await run(["git", "diff", "--quiet", "HEAD"]);
}

await run(["bun", "run", "prebuild", "--platform", platform], mobileRoot);
if (platform === "android") {
  await run(
    [
      "./gradlew",
      ":app:assembleDebug",
      "--no-daemon",
      "-PreactNativeArchitectures=arm64-v8a,x86_64",
    ],
    resolve(mobileRoot, "android"),
  );
} else {
  if (process.platform !== "darwin") throw new Error("iOS verification requires macOS and Xcode");
  const ios = resolve(mobileRoot, "ios");
  await run(["pod", "install"], ios);
  const workspaces = (await readdir(ios)).filter((name) => name.endsWith(".xcworkspace"));
  if (workspaces.length !== 1) throw new Error("Expected one generated iOS workspace");
  const workspace = workspaces[0];
  if (!workspace) throw new Error("Missing iOS workspace");
  if (xcodeControl)
    await configureGeneratedXcodeControl(ios, workspace.replace(/\.xcworkspace$/, ""));
  await run(
    [
      "xcodebuild",
      "-workspace",
      resolve(ios, workspace),
      "-scheme",
      workspace.replace(/\.xcworkspace$/, ""),
      "-configuration",
      "Debug",
      "-sdk",
      "iphonesimulator",
      "-destination",
      "generic/platform=iOS Simulator",
      "-derivedDataPath",
      resolve(root, ".wrangler/mobile-build/ios"),
      ...(xcodeControl ? xcodeSimulatorControlArguments : ["CODE_SIGNING_ALLOWED=NO"]),
      "build",
    ],
    mobileRoot,
  );
  if (xcodeControl) await attestXcodeSimulatorControl(root, process.env.TARGET_SHA as string);
}
await verifyCompiledMobileFont(platform, root);
console.log(
  `Native ${platform} debug build completed; no store signing, upload or deployment performed`,
);
