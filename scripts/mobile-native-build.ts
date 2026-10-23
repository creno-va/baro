import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  attestXcodeSimulatorControl,
  configureGeneratedXcodeControl,
  preserveCompiledXcodeControl,
  xcodeControlBuildFailure,
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
const controlBase = resolve(root, ".wrangler/ios-xcode-control");
let phase = "source-check",
  lastCommand: { tool: string; exitCode: number } | null = null;
async function run(args: string[], cwd = root) {
  const log = resolve(controlBase, `private-${phase}.log`);
  if (xcodeControl) {
    await mkdir(controlBase, { recursive: true });
    if (await Bun.file(log).exists()) throw new Error("XCODE_CONTROL_FRESH_OUTPUT_REQUIRED");
  }
  const child = Bun.spawn(args, {
    cwd,
    stdout: xcodeControl ? Bun.file(log) : "inherit",
    stderr: xcodeControl ? Bun.file(log) : "inherit",
    env: childEnvironment,
  });
  const code = await child.exited;
  if (xcodeControl) lastCommand = { tool: args[0] ?? "unknown", exitCode: code };
  if (code) {
    if (xcodeControl) throw new Error(xcodeControlBuildFailure(null, await readFile(log, "utf8")));
    throw new Error(`${args[0]} failed with exit ${code}`);
  }
}
async function main(platform: "android" | "ios") {
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

  phase = "prebuild";
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
    phase = "pods";
    await run(["pod", "install"], ios);
    phase = "workspace";
    const workspaces = (await readdir(ios)).filter((name) => name.endsWith(".xcworkspace"));
    if (workspaces.length !== 1) throw new Error("Expected one generated iOS workspace");
    const workspace = workspaces[0];
    if (!workspace) throw new Error("Missing iOS workspace");
    if (xcodeControl) {
      phase = "generated-entitlements";
      await configureGeneratedXcodeControl(ios, workspace.replace(/\.xcworkspace$/, ""));
    }
    phase = "xcode-build";
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
    if (xcodeControl) {
      phase = "preserve-compiled-output";
      await preserveCompiledXcodeControl(root, process.env.TARGET_SHA as string);
      phase = "attest-compiled-output";
      await attestXcodeSimulatorControl(root, process.env.TARGET_SHA as string);
    }
  }
  phase = "compiled-font";
  await verifyCompiledMobileFont(platform, root);
  console.log(
    `Native ${platform} debug build completed; no store signing, upload or deployment performed`,
  );
}
try {
  await main(platform);
} catch (error) {
  if (!xcodeControl) throw error;
  await mkdir(controlBase, { recursive: true });
  const observed = xcodeControlBuildFailure(error);
  await writeFile(
    resolve(controlBase, "failure.json"),
    `${JSON.stringify({ sourceSha: process.env.TARGET_SHA, observedAt: new Date().toISOString(), phase, code: observed, lastCommand, physicalDeviceVerified: false, storeSigned: false, deployed: false }, null, 2)}\n`,
    { flag: "wx" },
  );
  console.error(observed);
  process.exitCode = 1;
}
