import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { z } from "zod";
import { inspectEmbeddedIosBundle } from "./mobile-internal-ios-artifact";
import {
  inspectIosDeviceExecutable,
  inspectIosDeviceInfo,
  iosDeviceSdkBuildArguments,
  iosDeviceSdkEnvironment,
  iosDeviceSdkFailureCode,
  iosDeviceSdkReceiptSchema,
  normalizedIosSdkVersion,
  verifyIosDeviceSdkReceipt,
} from "./mobile-ios-device-sdk";
import { xcodeControlBuildFailure } from "./mobile-ios-xcode-control";
import { compiledMobileFontProof } from "./mobile-native-assets";
import { observePreviewApi } from "./mobile-preview-artifact";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function main() {
  if (process.platform !== "darwin") throw Error("IOS_DEVICE_SDK_MAC_REQUIRED");
  const root = process.cwd(),
    env: Record<string, string | undefined> = iosDeviceSdkEnvironment(process.env),
    source = env.TARGET_SHA as string;
  const out = resolve(root, ".wrangler/mobile-ios-device-sdk"),
    owned = resolve(out, `owned-${randomUUID()}`),
    work = resolve(owned, "checkout"),
    mobile = resolve(work, "apps/mobile");
  for (const name of [
    "receipt.json",
    "inspection.json",
    "failure.json",
    `baro-ios-device-sdk-unprovisioned-${source}.zip`,
    `unaccepted-ios-device-sdk-${source}.zip`,
  ])
    if (await Bun.file(resolve(out, name)).exists())
      throw Error("IOS_DEVICE_SDK_FRESH_OUTPUT_REQUIRED");
  await mkdir(owned, { recursive: true });
  env.EXPO_METRO_CACHE_OUTPUT_DIR = resolve(owned, "metro-cache");
  env.SOURCEMAP_FILE = resolve(owned, "private-main.jsbundle.map");
  let checkout = false,
    phase = "source",
    sequence = 0,
    lastCommand: { exitCode: number; timedOut: boolean; buildFailure: string } | null = null;
  async function command(args: string[], cwd = root, timeout = 120000, binary = false) {
    lastCommand = null;
    const child = Bun.spawn(args, { cwd, env, stdout: "pipe", stderr: "pipe" });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeout);
    try {
      const [stdout, stderr] = await Promise.all([
        new Response(child.stdout).arrayBuffer(),
        new Response(child.stderr).text(),
      ]);
      const exitCode = await child.exited;
      if (!binary)
        await writeFile(
          resolve(owned, `private-command-${sequence++}.log`),
          `${new TextDecoder().decode(stdout)}\n${stderr}`,
        );
      if (exitCode || timedOut) {
        lastCommand = {
          exitCode,
          timedOut,
          buildFailure: xcodeControlBuildFailure(
            null,
            `${new TextDecoder().decode(stdout)}\n${stderr}`,
          ),
        };
        throw Error("IOS_DEVICE_SDK_COMMAND_FAILED");
      }
      return new Uint8Array(stdout);
    } finally {
      clearTimeout(timer);
    }
  }
  const text = async (args: string[], cwd = root, timeout = 120000) =>
    new TextDecoder().decode(await command(args, cwd, timeout)).trim();
  try {
    if ((await text(["git", "rev-parse", "HEAD"])) !== source)
      throw Error("IOS_DEVICE_SDK_SOURCE_MISMATCH");
    await text(["git", "diff", "--quiet", "HEAD"]);
    await text(["git", "merge-base", "--is-ancestor", source, "origin/main"]);
    const manifest = JSON.parse(await readFile(resolve(root, "apps/mobile/package.json"), "utf8"));
    if (manifest.main !== "expo-router/entry") throw Error("IOS_DEVICE_SDK_PRODUCT_ENTRY_REQUIRED");
    await text(["git", "worktree", "add", "--detach", work, source]);
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
      `const {getDefaultConfig}=require('expo/metro-config');const c=getDefaultConfig(__dirname);c.watchFolders=[${JSON.stringify(root)}];c.resolver.extraNodeModules=${JSON.stringify(aliases)};c.fileMapCacheDirectory=${JSON.stringify(resolve(owned, "metro-file-map"))};c.cacheVersion=${JSON.stringify(`baro-device-sdk-${source}-${owned}`)};module.exports=c;\n`,
    );
    phase = "prebuild";
    console.log("IOS_DEVICE_SDK_STAGE", phase);
    await text(
      [
        "node",
        resolve(root, "node_modules/expo/bin/cli"),
        "prebuild",
        "--no-install",
        "--platform",
        "ios",
      ],
      mobile,
    );
    const ios = resolve(mobile, "ios");
    phase = "pods";
    console.log("IOS_DEVICE_SDK_STAGE", phase);
    await text(["pod", "install"], ios, 300000);
    const workspaces = (await readdir(ios)).filter((name) => name.endsWith(".xcworkspace"));
    if (workspaces.length !== 1 || !workspaces[0]) throw Error("IOS_DEVICE_SDK_WORKSPACE_REQUIRED");
    phase = "iphoneos-release-compile";
    console.log("IOS_DEVICE_SDK_STAGE", phase);
    // No Simulator entitlement/signing configuration and no provisioning updates.
    await text(
      [
        "xcodebuild",
        "-workspace",
        resolve(ios, workspaces[0]),
        "-scheme",
        workspaces[0].replace(/\.xcworkspace$/, ""),
        "-derivedDataPath",
        resolve(work, ".wrangler/device-sdk-build"),
        ...iosDeviceSdkBuildArguments,
        "build",
      ],
      mobile,
      2400000,
    );
    phase = "compiled-device-metadata";
    const products = resolve(work, ".wrangler/device-sdk-build/Build/Products/Release-iphoneos"),
      apps = (await readdir(products)).filter((name) => name.endsWith(".app"));
    if (apps.length !== 1 || !apps[0]) throw Error("IOS_DEVICE_SDK_COMPILED_APP_REQUIRED");
    const app = resolve(products, apps[0]),
      infoBytes = await readFile(resolve(app, "Info.plist"));
    const info = inspectIosDeviceInfo(
      JSON.parse(
        await text(["/usr/bin/plutil", "-convert", "json", "-o", "-", resolve(app, "Info.plist")]),
      ),
    );
    const executable = inspectIosDeviceExecutable(
      await readFile(resolve(app, info.CFBundleExecutable)),
    );
    const sdkVersion = await text(["xcrun", "--sdk", "iphoneos", "--show-sdk-version"]);
    if (normalizedIosSdkVersion(sdkVersion) !== normalizedIosSdkVersion(executable.sdkVersion))
      throw Error("IOS_DEVICE_SDK_SDK_VERSION_MISMATCH");
    const files = (await text(["find", app, "-type", "f"])).split(/\r?\n/);
    if (
      files.some((name) => /\.(mobileprovision|p8|p12|map)$/i.test(name)) ||
      (await Bun.file(resolve(app, "_CodeSignature/CodeResources")).exists())
    )
      throw Error("IOS_DEVICE_SDK_PRIVATE_OR_SIGNED_OUTPUT_FORBIDDEN");
    const archive = resolve(out, `unaccepted-ios-device-sdk-${source}.zip`);
    await text(["/usr/bin/ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", app, archive]);
    const archiveBytes = await readFile(archive);
    await writeFile(
      resolve(out, "inspection.json"),
      `${JSON.stringify({ version: 1, kind: "unaccepted-ios-device-sdk-output", sourceSha: source, observedAt: new Date().toISOString(), nativeCompileSucceeded: true, platform: "iphoneos", architectures: ["arm64"], codeSignature: "none", archive: { name: `unaccepted-ios-device-sdk-${source}.zip`, bytes: archiveBytes.length, sha256: hash(archiveBytes) }, accepted: false, appRuntimeVerified: false, physicalDeviceVerified: false, storeSigned: false, storeSubmitted: false, deployed: false }, null, 2)}\n`,
      { flag: "wx" },
    );
    phase = "compiled-product-bundle-and-font";
    const paths = (await text(["unzip", "-Z1", archive])).split(/\r?\n/);
    const embeddedBundle = inspectEmbeddedIosBundle(
      await readFile(resolve(app, "main.jsbundle")),
      await command(["unzip", "-p", archive, `${apps[0]}/main.jsbundle`], root, 120000, true),
      await readFile(resolve(products, "main.jsbundle")),
      await readFile(env.SOURCEMAP_FILE as string),
      paths,
    );
    const compiledFont = iosDeviceSdkReceiptSchema.shape.compiledFont.parse(
      await compiledMobileFontProof(work, await readFile(resolve(app, "BaroMobile.ttf"))),
    );
    const artifactName = `baro-ios-device-sdk-unprovisioned-${source}.zip`;
    const receipt = verifyIosDeviceSdkReceipt(
      {
        version: 1,
        kind: "ios-device-sdk-unsigned-compile-preflight",
        sourceSha: source,
        observedAt: new Date().toISOString(),
        platform: "ios",
        buildSdk: "iphoneos",
        nativeConfiguration: "Release",
        applicationId: info.CFBundleIdentifier,
        environment: "preview",
        apiOrigin: "https://preview.baro.site",
        apiObservation: await observePreviewApi(),
        versionName: info.CFBundleShortVersionString,
        buildVersion: info.CFBundleVersion,
        expo: manifest.dependencies.expo,
        reactNative: manifest.dependencies["react-native"],
        minimumOS: executable.minimumOS,
        sdkVersion: executable.sdkVersion,
        architectures: ["arm64"],
        infoPlistSha256: hash(infoBytes),
        executableSha256: executable.sha256,
        signing: {
          codeSignature: "none",
          developmentTeamProvided: false,
          provisioningProfilePresent: false,
        },
        embeddedBundle,
        compiledFont,
        artifact: { name: artifactName, bytes: archiveBytes.length, sha256: hash(archiveBytes) },
        requiresMetro: false,
        binaryMetadataVerified: true,
        appleDeveloperCredentialsUsed: false,
        installableOnPhysicalDevice: false,
        appRuntimeVerified: false,
        remoteApiVerified: false,
        physicalDeviceVerified: false,
        oauthVerified: false,
        storeSigned: false,
        storeSubmitted: false,
        deployed: false,
      } satisfies z.input<typeof iosDeviceSdkReceiptSchema>,
      source,
    );
    await copyFile(archive, resolve(out, artifactName));
    if (hash(await readFile(resolve(out, artifactName))) !== receipt.artifact.sha256)
      throw Error("IOS_DEVICE_SDK_ARCHIVE_CHANGED");
    await writeFile(resolve(out, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, {
      flag: "wx",
    });
    console.log("IOS_DEVICE_SDK_COMPILE_PREFLIGHT_PASSED_RUNTIME_AND_SIGNING_PENDING");
  } catch (error) {
    const code = iosDeviceSdkFailureCode(error);
    await writeFile(
      resolve(out, "failure.json"),
      `${JSON.stringify({ version: 1, sourceSha: source, phase, code, lastCommand, appRuntimeVerified: false, physicalDeviceVerified: false, storeSigned: false, storeSubmitted: false, deployed: false }, null, 2)}\n`,
      { flag: "wx" },
    );
    throw Error("IOS_DEVICE_SDK_PREFLIGHT_FAILED");
  } finally {
    if (checkout) await text(["git", "worktree", "remove", "--force", work]).catch(() => {});
    await rm(owned, { recursive: true, force: true });
  }
}
if (import.meta.main)
  await main().catch(() => {
    console.error("IOS_DEVICE_SDK_PREFLIGHT_FAILED");
    process.exitCode = 1;
  });
