import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { verifySimulatorBuildPlatform } from "./mobile-ios-xcode-control";

export type IOSCompileArchitecture = "arm64" | "x86_64";

/** Explicit CI-only verification mode; normal/universal and runtime builds retain their settings. */
export function iosCompileVerificationArchitecture(
  platform: string,
  args: string[],
  ci: string | undefined,
): IOSCompileArchitecture | null {
  if (!args.some((arg) => arg.startsWith("--verify-architecture"))) return null;
  const match = args.length === 1 && /^--verify-architecture=(arm64|x86_64)$/.exec(args[0] ?? "");
  if (platform !== "ios" || ci !== "1" || !match)
    throw new Error("IOS_COMPILE_VERIFICATION_MODE_REQUIRED");
  return match[1] as IOSCompileArchitecture;
}

export function iosCompileArchitectureArguments(architecture: IOSCompileArchitecture | null) {
  if (architecture !== null && architecture !== "arm64" && architecture !== "x86_64")
    throw new Error("IOS_COMPILE_ARCHITECTURE_REQUIRED");
  if (architecture !== null && architecture !== "arm64" && architecture !== "x86_64")
    throw new Error("IOS_COMPILE_ARCHITECTURE_REQUIRED");
  return architecture ? [`ARCHS=${architecture}`, "ONLY_ACTIVE_ARCH=NO"] : [];
}

async function command(args: string[]) {
  const child = Bun.spawn(args, { stdout: "pipe", stderr: "ignore" });
  const timer = setTimeout(() => child.kill(), 30000);
  try {
    const output = await new Response(child.stdout).text();
    if (await child.exited) throw new Error("IOS_COMPILE_IDENTITY_TOOL_FAILED");
    return output.trim();
  } finally {
    clearTimeout(timer);
  }
}

export async function recordIOSCompileVerification(
  root: string,
  sourceSha: string,
  architecture: IOSCompileArchitecture,
  inspect: (args: string[]) => Promise<string> = command,
) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error("IOS_COMPILE_SOURCE_REQUIRED");
  iosCompileArchitectureArguments(architecture);
  iosCompileArchitectureArguments(architecture);
  const products = resolve(root, ".wrangler/mobile-build/ios/Build/Products/Debug-iphonesimulator");
  const apps = (await readdir(products)).filter((name) => name.endsWith(".app"));
  if (apps.length !== 1 || !apps[0]) throw new Error("IOS_COMPILE_APP_AMBIGUOUS");
  const app = resolve(products, apps[0]);
  const info = JSON.parse(
    await inspect(["/usr/bin/plutil", "-convert", "json", "-o", "-", resolve(app, "Info.plist")]),
  );
  if (
    info.CFBundleIdentifier !== "site.baro.app.preview" ||
    info.DTPlatformName !== "iphonesimulator" ||
    JSON.stringify(info.CFBundleSupportedPlatforms) !== JSON.stringify(["iPhoneSimulator"]) ||
    typeof info.CFBundleExecutable !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(info.CFBundleExecutable)
  )
    throw new Error("IOS_COMPILE_SIMULATOR_IDENTITY_REQUIRED");
  const binaries = [];
  for (const name of [info.CFBundleExecutable, `${info.CFBundleExecutable}.debug.dylib`]) {
    const path = resolve(app, name);
    const file = await stat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" && name.endsWith(".debug.dylib")) return null;
      throw new Error("IOS_COMPILE_BINARY_MISSING");
    });
    if (!file) continue;
    if (!file.isFile()) throw new Error("IOS_COMPILE_BINARY_MISSING");
    if ((await inspect(["/usr/bin/lipo", "-archs", path])).trim() !== architecture)
      throw new Error("IOS_COMPILE_ARCHITECTURE_MISMATCH");
    verifySimulatorBuildPlatform(
      await inspect(["/usr/bin/xcrun", "vtool", "-arch", architecture, "-show-build", path]),
    );
    const hash = createHash("sha256");
    for await (const bytes of createReadStream(path)) hash.update(bytes);
    binaries.push({ name, bytes: file.size, digest: hash.digest("hex") });
  }
  const receipt = {
    sourceSha,
    architecture,
    platform: "ios-simulator" as const,
    kind: "single-architecture-compile-verification" as const,
    binaries,
    appRuntimeVerified: false as const,
    storeSigned: false as const,
    deployed: false as const,
  };
  await writeFile(
    resolve(root, ".wrangler/mobile-build/ios-verification-architecture.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { flag: "wx" },
  );
  return receipt;
}
