import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  inspectEmbeddedIosBundle,
  verifyInternalIosArtifact,
} from "./mobile-internal-ios-artifact";
import { simulatorIdentity } from "./mobile-ios-simulator-signing";
import {
  attestXcodeSimulatorControl,
  configureGeneratedXcodeControl,
  xcodeControlBuildFailure,
  xcodeControlEnvironment,
  xcodeSimulatorControlArguments,
} from "./mobile-ios-xcode-control";
import { verifyCompiledMobileFont } from "./mobile-native-assets";
import { observePreviewApi } from "./mobile-preview-artifact";
import { metroNodeOptions } from "./mobile-runtime-host";

export function internalIosEnvironment(input: Record<string, string | undefined>) {
  if (input.ENTRY_FILE || input.SKIP_BUNDLING || input.FORCE_BUNDLING || input.SOURCEMAP_FILE)
    throw new Error("INTERNAL_IOS_PRODUCT_BUILD_OVERRIDES_FORBIDDEN");
  return {
    ...xcodeControlEnvironment(input),
    NODE_ENV: "production",
    NODE_OPTIONS: metroNodeOptions(undefined),
  };
}
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
async function main() {
  if (process.platform !== "darwin") throw new Error("INTERNAL_IOS_MAC_REQUIRED");
  const root = process.cwd(),
    env: Record<string, string | undefined> = internalIosEnvironment(process.env),
    source = env.TARGET_SHA as string,
    base = resolve(root, ".wrangler/mobile-internal-ios"),
    owned = resolve(base, randomUUID()),
    work = resolve(owned, "checkout"),
    mobile = resolve(work, "apps/mobile");
  if (
    (
      await Promise.all(
        [
          "receipt-ios.json",
          "inspection.json",
          "failure-ios.json",
          `unaccepted-internal-ios-simulator-${source}.zip`,
          `baro-internal-preview-ios-simulator-${source}.zip`,
        ].map((p) => Bun.file(resolve(base, p)).exists()),
      )
    ).some(Boolean)
  )
    throw new Error("INTERNAL_IOS_FRESH_OUTPUT_REQUIRED");
  await mkdir(owned, { recursive: true });
  env.EXPO_METRO_CACHE_OUTPUT_DIR = resolve(owned, "metro-cache");
  env.SOURCEMAP_FILE = resolve(owned, "private-main.jsbundle.map");
  let checkout = false,
    phase = "source",
    sequence = 0,
    lastExit: number | null = null;
  async function command(args: string[], cwd = root, timeout = 120000, bytes = false) {
    lastExit = null;
    const c = Bun.spawn(args, { cwd, env, stdout: "pipe", stderr: "pipe" }),
      timer = setTimeout(() => c.kill(), timeout);
    try {
      const [out, err] = await Promise.all([
        new Response(c.stdout).arrayBuffer(),
        new Response(c.stderr).text(),
      ]);
      lastExit = await c.exited;
      if (!bytes)
        await writeFile(
          resolve(owned, `private-command-${sequence++}.log`),
          `${new TextDecoder().decode(out)}\n${err}`,
        );
      if (lastExit !== 0)
        throw new Error(
          bytes
            ? "INTERNAL_IOS_TOOL_FAILED"
            : xcodeControlBuildFailure(null, `${new TextDecoder().decode(out)}\n${err}`),
        );
      return bytes ? new Uint8Array(out) : new TextDecoder().decode(out).trim();
    } finally {
      clearTimeout(timer);
    }
  }
  const text = async (args: string[], cwd = root, timeout = 120000) =>
    (await command(args, cwd, timeout)) as string;
  try {
    if ((await text(["git", "rev-parse", "HEAD"])) !== source)
      throw new Error("INTERNAL_IOS_CHECKOUT_MISMATCH");
    await text(["git", "diff", "--quiet", "HEAD"]);
    await text(["git", "merge-base", "--is-ancestor", source, "origin/main"]);
    const manifest = JSON.parse(await readFile(resolve(root, "apps/mobile/package.json"), "utf8"));
    if (manifest.main !== "expo-router/entry")
      throw new Error("INTERNAL_IOS_PRODUCT_ENTRY_REQUIRED");
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
      `const {getDefaultConfig}=require('expo/metro-config');const c=getDefaultConfig(__dirname);c.watchFolders=[${JSON.stringify(root)}];c.resolver.extraNodeModules=${JSON.stringify(aliases)};c.fileMapCacheDirectory=${JSON.stringify(resolve(owned, "metro-file-map"))};c.cacheVersion=${JSON.stringify(`baro-internal-ios-${source}-${owned}`)};module.exports=c;\n`,
    );
    phase = "prebuild";
    console.log("INTERNAL_IOS_STAGE", phase);
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
    console.log("INTERNAL_IOS_STAGE", phase);
    await text(["pod", "install"], ios, 300000);
    const workspaces = (await readdir(ios)).filter((p) => p.endsWith(".xcworkspace"));
    if (workspaces.length !== 1 || !workspaces[0])
      throw new Error("INTERNAL_IOS_WORKSPACE_REQUIRED");
    const name = workspaces[0].replace(/\.xcworkspace$/, "");
    phase = "generated-entitlements";
    await configureGeneratedXcodeControl(ios, name);
    phase = "compile";
    console.log("INTERNAL_IOS_STAGE", phase);
    await text(
      [
        "xcodebuild",
        "-workspace",
        resolve(ios, workspaces[0]),
        "-scheme",
        name,
        "-configuration",
        "Release",
        "-sdk",
        "iphonesimulator",
        "-destination",
        "generic/platform=iOS Simulator",
        "-derivedDataPath",
        resolve(work, ".wrangler/mobile-build/ios"),
        "ONLY_ACTIVE_ARCH=NO",
        ...xcodeSimulatorControlArguments,
        "build",
      ],
      mobile,
      2400000,
    );
    phase = "preserve-compiled-output";
    console.log("INTERNAL_IOS_STAGE", phase);
    const products = resolve(
        work,
        ".wrangler/mobile-build/ios/Build/Products/Release-iphonesimulator",
      ),
      apps = (await readdir(products)).filter((p) => p.endsWith(".app"));
    if (apps.length !== 1 || !apps[0]) throw new Error("INTERNAL_IOS_COMPILED_APP_REQUIRED");
    const app = resolve(products, apps[0]),
      info = JSON.parse(
        await text(["/usr/bin/plutil", "-convert", "json", "-o", "-", resolve(app, "Info.plist")]),
      );
    simulatorIdentity(info, "site.baro.app.preview");
    const archive = resolve(base, `unaccepted-internal-ios-simulator-${source}.zip`);
    await text(["/usr/bin/ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", app, archive]);
    const archived = await readFile(archive);
    await writeFile(
      resolve(base, "inspection.json"),
      `${JSON.stringify({ version: 1, kind: "unaccepted-internal-ios-output", sourceSha: source, observedAt: new Date().toISOString(), nativeConfiguration: "Release", nativeCompileSucceeded: true, archive: { name: `unaccepted-internal-ios-simulator-${source}.zip`, bytes: archived.length, sha256: hash(archived) }, infoPlistSha256: hash(await readFile(resolve(app, "Info.plist"))), executableSha256: hash(await readFile(resolve(app, info.CFBundleExecutable))), accepted: false, bundleVerified: false, signatureAccepted: false, appRuntimeVerified: false, physicalDeviceVerified: false, storeSigned: false, deployed: false }, null, 2)}\n`,
      { flag: "wx" },
    );
    phase = "simulator-signature-and-sections";
    console.log("INTERNAL_IOS_STAGE", phase);
    await mkdir(resolve(work, ".wrangler/ios-xcode-control"), { recursive: true });
    const control = await attestXcodeSimulatorControl(work, source, source, "Release");
    phase = "compiled-font";
    const font = await verifyCompiledMobileFont("ios", work, "Release");
    phase = "embedded-bundle";
    const paths = (await text(["unzip", "-Z1", archive])).split(/\r?\n/),
      bundle = inspectEmbeddedIosBundle(
        await readFile(resolve(app, "main.jsbundle")),
        (await command(
          ["unzip", "-p", archive, `${apps[0]}/main.jsbundle`],
          root,
          120000,
          true,
        )) as Uint8Array,
        await readFile(resolve(products, "main.jsbundle")),
        await readFile(env.SOURCEMAP_FILE as string),
        paths,
      );
    const artifactName = `baro-internal-preview-ios-simulator-${source}.zip`;
    phase = "receipt";
    const receipt = verifyInternalIosArtifact(
      {
        version: 1,
        kind: "internal-bundled-preview-app",
        sourceSha: source,
        platform: "ios",
        environment: "preview",
        apiOrigin: "https://preview.baro.site",
        apiObservation: await observePreviewApi(),
        versionName: info.CFBundleShortVersionString,
        buildVersion: info.CFBundleVersion,
        expo: manifest.dependencies.expo,
        reactNative: manifest.dependencies["react-native"],
        applicationId: info.CFBundleIdentifier,
        minimumOS: info.MinimumOSVersion,
        installTarget: "ios-simulator",
        architectures: control.architectures,
        signing: { kind: "simulator-only", codeSignature: "ad-hoc" },
        control,
        artifact: { name: artifactName, bytes: archived.length, sha256: hash(archived) },
        compiledFont: font,
        nativeConfiguration: "Release",
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
      source,
    );
    const target = resolve(base, artifactName);
    await copyFile(archive, target);
    if (
      (await stat(target)).size !== archived.length ||
      hash(await readFile(target)) !== receipt.artifact.sha256
    )
      throw new Error("INTERNAL_IOS_ARCHIVE_CHANGED");
    await writeFile(resolve(base, "receipt-ios.json"), `${JSON.stringify(receipt, null, 2)}\n`, {
      flag: "wx",
    });
    console.log("INTERNAL_IOS_COMPILED_BUNDLED_PREVIEW_VERIFIED_RUNTIME_PENDING");
  } catch (error) {
    const code = error instanceof Error ? error.message : "",
      known = new Set([
        "INTERNAL_IOS_CHECKOUT_MISMATCH",
        "INTERNAL_IOS_PRODUCT_ENTRY_REQUIRED",
        "INTERNAL_IOS_WORKSPACE_REQUIRED",
        "INTERNAL_IOS_COMPILED_APP_REQUIRED",
        "INTERNAL_IOS_BUNDLE_BYTES_MISMATCH",
        "INTERNAL_IOS_PRODUCT_GRAPH_REQUIRED",
        "INTERNAL_IOS_ARTIFACT_IDENTITY_MISMATCH",
        "INTERNAL_IOS_ARCHIVE_CHANGED",
        "COMPILED_FONT_BYTES_OR_LICENSE_CHANGED",
      ]);
    await writeFile(
      resolve(base, "failure-ios.json"),
      `${JSON.stringify({ sourceSha: source, phase, code: known.has(code) ? code : xcodeControlBuildFailure(error), lastCommandExit: lastExit, appRuntimeVerified: false, physicalDeviceVerified: false, storeSigned: false, deployed: false }, null, 2)}\n`,
      { flag: "wx" },
    );
    throw new Error("INTERNAL_IOS_BUILD_FAILED");
  } finally {
    if (checkout) await text(["git", "worktree", "remove", "--force", work]).catch(() => {});
    await rm(owned, { recursive: true, force: true });
  }
}
if (import.meta.main)
  await main().catch(() => {
    console.error("INTERNAL_IOS_BUILD_FAILED");
    process.exitCode = 1;
  });
