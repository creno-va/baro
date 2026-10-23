import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { verifyCompiledMobileFont } from "./mobile-native-assets";

const platform = process.argv[2];
if (platform !== "android" && platform !== "ios")
  throw new Error("Usage: bun run mobile:native android|ios");
const runtimeLocal = process.argv[3] === "--runtime-local";
if (
  runtimeLocal
    ? process.env.EXPO_PUBLIC_APP_ENV !== "local" ||
      process.env.EXPO_PUBLIC_API_URL !== "http://127.0.0.1:8765"
    : process.env.EXPO_PUBLIC_APP_ENV !== "preview"
)
  throw new Error("Native verification must explicitly target preview");

const root = process.cwd();
const mobileRoot = resolve(root, "apps/mobile");
async function run(args: string[], cwd = root) {
  const child = Bun.spawn(args, { cwd, stdout: "inherit", stderr: "inherit", env: process.env });
  const code = await child.exited;
  if (code) throw new Error(`${args[0]} failed with exit ${code}`);
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
      "CODE_SIGNING_ALLOWED=NO",
      "build",
    ],
    mobileRoot,
  );
}
await verifyCompiledMobileFont(platform, root);
console.log(
  `Native ${platform} debug build completed; no store signing, upload or deployment performed`,
);
