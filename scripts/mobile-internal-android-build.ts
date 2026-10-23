import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { androidBuildTools, runAndroidSignatureProbe } from "./mobile-android-signature";
import {
  inspectEmbeddedAndroidBundle,
  internalAndroidDevelopmentCertificate,
  verifyInternalAndroidArtifact,
} from "./mobile-internal-android-artifact";
import {
  generatedAndroidReleaseFiles,
  internalAndroidVerificationFailure,
  preserveCompiledAndroidInspection,
} from "./mobile-internal-android-inspection";
import { verifyCompiledMobileFont } from "./mobile-native-assets";
import { observePreviewApi, parseAndroidPackage } from "./mobile-preview-artifact";
import { metroNodeOptions } from "./mobile-runtime-host";

export function internalAndroidEnvironment(environment: Record<string, string | undefined>) {
  if (
    environment.EXPO_PUBLIC_APP_ENV !== "preview" ||
    environment.EXPO_PUBLIC_API_URL !== "https://preview.baro.site" ||
    environment.ENTRY_FILE
  )
    throw new Error("INTERNAL_ANDROID_EXPLICIT_PRODUCT_PREVIEW_REQUIRED");
  const inherited = [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "JAVA_HOME",
    "ANDROID_HOME",
    "ANDROID_SDK_ROOT",
    "LANG",
    "LC_ALL",
    "SHELL",
    "USER",
    "LOGNAME",
  ];
  const env: Record<string, string | undefined> = {
    ...Object.fromEntries(
      inherited
        .filter((key) => environment[key] !== undefined)
        .map((key) => [key, environment[key]]),
    ),
    EXPO_PUBLIC_APP_ENV: "preview",
    EXPO_PUBLIC_API_URL: "https://preview.baro.site",
    NODE_ENV: "production",
    CI: "1",
    EXPO_OFFLINE: "1",
    EXPO_NO_TELEMETRY: "1",
    EXPO_NO_TYPESCRIPT_SETUP: "1",
    EXPO_NO_DOTENV: "1",
    NODE_OPTIONS: metroNodeOptions(undefined),
  };
  return env;
}
export function internalAndroidFailureCategory(detail: string, expired: boolean) {
  if (expired) return "COMMAND_TIMEOUT" as const;
  if (/Unable to resolve module|Cannot find module/i.test(detail))
    return "METRO_MODULE_NOT_FOUND" as const;
  if (/OutOfMemoryError|Java heap space|not enough memory/i.test(detail))
    return "BUILD_MEMORY_LIMIT" as const;
  if (/SDK location not found|Failed to find Build Tools/i.test(detail))
    return "SDK_INSTALLATION" as const;
  if (/CMake Error|ninja: build stopped/i.test(detail)) return "NATIVE_BUILD_FAILED" as const;
  if (/Could not resolve all files|Could not GET/i.test(detail))
    return "DEPENDENCY_RESOLUTION" as const;
  return "UNKNOWN" as const;
}
async function main() {
  const root = process.cwd(),
    sourceSha = process.env.TARGET_SHA;
  if (!/^[a-f0-9]{40}$/.test(sourceSha ?? ""))
    throw new Error("INTERNAL_ANDROID_IMMUTABLE_SHA_REQUIRED");
  const env = internalAndroidEnvironment(process.env),
    sdk = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error("INTERNAL_ANDROID_SDK_REQUIRED");
  const base = resolve(root, ".wrangler/mobile-internal-android"),
    owned = resolve(base, randomUUID()),
    work = resolve(owned, "checkout"),
    mobile = resolve(work, "apps/mobile");
  if (
    (await Bun.file(resolve(base, "receipt-android.json")).exists()) ||
    (await Bun.file(resolve(base, "failure-android.json")).exists()) ||
    (await Bun.file(resolve(base, `baro-internal-preview-android-${sourceSha}.apk`)).exists()) ||
    (await Bun.file(resolve(base, "inspection/inspection.json")).exists()) ||
    (await Bun.file(resolve(base, "inspection/generated-index.android.bundle")).exists()) ||
    (await Bun.file(resolve(base, `inspection/compiled-android-${sourceSha}.apk`)).exists())
  )
    throw new Error("INTERNAL_ANDROID_FRESH_OUTPUT_REQUIRED");
  await mkdir(owned, { recursive: true });
  env.GRADLE_USER_HOME = resolve(owned, "gradle");
  env.EXPO_METRO_CACHE_OUTPUT_DIR = resolve(owned, "metro-cache");
  await Promise.all(
    ["gradle", "metro-cache", "metro-file-map"].map((part) =>
      mkdir(resolve(owned, part), { recursive: true }),
    ),
  );
  let sequence = 0;
  let failedTool: {
    exitCode: number;
    category: ReturnType<typeof internalAndroidFailureCategory>;
  } | null = null;
  async function command(args: string[], cwd = root, timeout = 120000, bytes = false) {
    failedTool = null;
    const child = Bun.spawn(args, { cwd, env, stdout: "pipe", stderr: "pipe" });
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      child.kill();
    }, timeout);
    try {
      const [buffer, stderr] = await Promise.all([
        new Response(child.stdout).arrayBuffer(),
        new Response(child.stderr).text(),
      ]);
      const body = new Uint8Array(buffer),
        exitCode = await child.exited;
      const detail = bytes ? stderr : `${new TextDecoder().decode(body)}\n${stderr}`;
      if (!bytes) await writeFile(resolve(owned, `private-command-${sequence++}.log`), detail);
      if (exitCode !== 0 || expired) {
        failedTool = { exitCode, category: internalAndroidFailureCategory(detail, expired) };
        throw new Error("INTERNAL_ANDROID_TOOL_FAILED");
      }
      return bytes ? body : new TextDecoder().decode(body).trim();
    } finally {
      clearTimeout(timer);
    }
  }
  const text = async (args: string[], cwd = root, timeout = 120000) =>
    (await command(args, cwd, timeout)) as string;
  let phase = "input",
    checkout = false;
  try {
    if ((await text(["git", "rev-parse", "HEAD"])) !== sourceSha)
      throw new Error("INTERNAL_ANDROID_CHECKOUT_MISMATCH");
    await text(["git", "diff", "--exit-code", "HEAD"]);
    await text(["git", "merge-base", "--is-ancestor", sourceSha as string, "origin/main"]);
    const manifest = JSON.parse(await readFile(resolve(root, "apps/mobile/package.json"), "utf8"));
    if (manifest.main !== "expo-router/entry")
      throw new Error("INTERNAL_ANDROID_PRODUCT_ENTRY_REQUIRED");
    const tools = await androidBuildTools(sdk);
    await runAndroidSignatureProbe(root, tools.path, text);
    await text(["git", "worktree", "add", "--detach", work, sourceSha as string]);
    checkout = true;
    await symlink(resolve(root, "node_modules"), resolve(work, "node_modules"), "dir");
    const aliases = Object.fromEntries(
      ["contracts", "api-client", "client-core", "design-tokens"].map((part) => [
        `@baro/${part}`,
        resolve(work, part === "contracts" ? "src/contracts" : `packages/${part}`),
      ]),
    );
    await writeFile(
      resolve(mobile, "metro.config.cjs"),
      `const {getDefaultConfig}=require('expo/metro-config');const config=getDefaultConfig(__dirname);config.watchFolders=[${JSON.stringify(root)}];config.resolver.extraNodeModules=${JSON.stringify(aliases)};config.fileMapCacheDirectory=${JSON.stringify(resolve(owned, "metro-file-map"))};config.cacheVersion=${JSON.stringify(`baro-internal-${sourceSha}-${owned}`)};module.exports=config;\n`,
    );
    phase = "prebuild";
    console.log("INTERNAL_ANDROID_STAGE", phase);
    await text(
      [
        "node",
        resolve(root, "node_modules/expo/bin/cli"),
        "prebuild",
        "--no-install",
        "--platform",
        "android",
      ],
      mobile,
    );
    const gradle = await readFile(resolve(mobile, "android/app/build.gradle"), "utf8");
    if (
      !/release\s*\{[^}]*signingConfig signingConfigs\.debug/s.test(gradle) ||
      !gradle.includes('bundleCommand = "export:embed"')
    )
      throw new Error("INTERNAL_ANDROID_TEMPLATE_SIGNING_OR_BUNDLE_CHANGED");
    phase = "compile";
    console.log("INTERNAL_ANDROID_STAGE", phase);
    await text(
      [
        "./gradlew",
        ":app:assembleRelease",
        "--no-daemon",
        "-PreactNativeArchitectures=arm64-v8a,x86_64",
      ],
      resolve(mobile, "android"),
      2400000,
    );
    phase = "preserve-compiled-inspection";
    await preserveCompiledAndroidInspection(base, mobile, sourceSha as string);
    phase = "apk-badging";
    console.log("INTERNAL_ANDROID_STAGE", phase);
    const apk = resolve(mobile, "android/app/build/outputs/apk/release/app-release.apk");
    const badging = await text([resolve(tools.path, "aapt"), "dump", "badging", apk]),
      metadata = parseAndroidPackage(badging);
    const activity = badging.match(/^launchable-activity: name='([^']+)'/m)?.[1];
    phase = "apk-signature";
    const certificate = await runAndroidSignatureProbe(work, tools.path, text, apk);
    if (certificate !== internalAndroidDevelopmentCertificate)
      throw new Error("INTERNAL_ANDROID_TEMPLATE_CERTIFICATE_REQUIRED");
    phase = "bundle-extract";
    const packaged = (await command(
      ["unzip", "-p", apk, "assets/index.android.bundle"],
      root,
      120000,
      true,
    )) as Uint8Array;
    phase = "generated-output-discovery";
    const generated = await generatedAndroidReleaseFiles(resolve(mobile, "android/app/build"));
    if (!generated.bundle || !generated.map)
      throw new Error("INTERNAL_ANDROID_GENERATED_OUTPUT_MISSING");
    phase = "compiled-bundle-read";
    const compiled = await readFile(generated.bundle);
    phase = "source-map-read";
    const sourceMap = JSON.parse(await readFile(generated.map, "utf8"));
    const paths = (await text(["unzip", "-Z1", apk])).split(/\r?\n/);
    phase = "bundle-and-graph";
    const bundle = inspectEmbeddedAndroidBundle(compiled, packaged, sourceMap, paths);
    phase = "compiled-font";
    const font = await verifyCompiledMobileFont("android", work, "Release");
    const name = `baro-internal-preview-android-${sourceSha}.apk`,
      artifact = resolve(base, name);
    await copyFile(apk, artifact);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(artifact)) hash.update(chunk);
    phase = "receipt";
    const receipt = verifyInternalAndroidArtifact(
      {
        version: 1,
        kind: "internal-bundled-preview-app",
        sourceSha,
        platform: "android",
        environment: "preview",
        apiOrigin: "https://preview.baro.site",
        apiObservation: await observePreviewApi(),
        versionName: metadata.versionName,
        buildVersion: metadata.buildVersion,
        expo: manifest.dependencies.expo,
        reactNative: manifest.dependencies["react-native"],
        applicationId: metadata.applicationId,
        minimumOS: metadata.minimumOS,
        architectures: metadata.architectures,
        debuggable: metadata.debuggable,
        launchableActivity: activity,
        nativeConfiguration: "Release",
        installTarget: "android-device-or-emulator",
        signing: {
          kind: "android-debug",
          certificateSha256: certificate,
          verifier: "android-sdk-apksig",
          buildTools: tools.version,
        },
        artifact: { name, bytes: (await stat(artifact)).size, sha256: hash.digest("hex") },
        compiledFont: font,
        embeddedBundle: bundle,
        compatibility: "runtime-smoke-required",
        requiresMetro: false,
        binaryMetadataVerified: true,
        appRuntimeVerified: false,
        remoteApiVerified: false,
        physicalDeviceVerified: false,
        storeSigned: false,
        deployed: false,
      },
      sourceSha as string,
    );
    if (receipt.versionName !== manifest.version)
      throw new Error("INTERNAL_ANDROID_NATIVE_VERSION_DRIFT");
    await writeFile(
      resolve(base, "receipt-android.json"),
      `${JSON.stringify(receipt, null, 2)}\n`,
      { flag: "wx" },
    );
    console.log(
      "Internal bundled preview APK verified; actual launch/API/OAuth/physical/store acceptance remains separate",
    );
  } catch (error) {
    await writeFile(
      resolve(base, "failure-android.json"),
      `${JSON.stringify({ sourceSha, phase, ...internalAndroidVerificationFailure(error), failedTool, appRuntimeVerified: false, remoteApiVerified: false, physicalDeviceVerified: false, storeSigned: false, deployed: false }, null, 2)}\n`,
      { flag: "wx" },
    );
    throw new Error("INTERNAL_ANDROID_BUILD_FAILED");
  } finally {
    if (checkout) await text(["git", "worktree", "remove", "--force", work]).catch(() => {});
  }
}
if (import.meta.main)
  await main().catch(() => {
    console.error("INTERNAL_ANDROID_BUILD_FAILED");
    process.exitCode = 1;
  });
