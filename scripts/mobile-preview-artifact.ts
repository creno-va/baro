import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { z } from "zod";

const sha = z.string().regex(/^[a-f0-9]{40}$/),
  digest = z.string().regex(/^[a-f0-9]{64}$/);
const nativeVersion = z.string().regex(/^\d+(?:\.\d+){0,2}$/);
const apiObservationSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("observed"), observedAt: z.iso.datetime(), sourceSha: sha }),
  z.strictObject({ status: z.literal("unavailable"), observedAt: z.iso.datetime() }),
]);
export const previewArtifactSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("preview-development-app"),
  sourceSha: sha,
  platform: z.enum(["android", "ios"]),
  environment: z.literal("preview"),
  apiOrigin: z.literal("https://preview.baro.site"),
  apiObservation: apiObservationSchema,
  versionName: nativeVersion,
  buildVersion: z.string().regex(/^\d+$/),
  expo: nativeVersion,
  reactNative: nativeVersion,
  applicationId: z.literal("site.baro.app.preview"),
  minimumOS: nativeVersion,
  installTarget: z.enum(["android-device-or-emulator", "ios-simulator"]),
  architectures: z.array(z.enum(["arm64-v8a", "x86_64", "arm64"])).min(1),
  signing: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("android-debug"), certificateSha256: digest }),
    z.strictObject({
      kind: z.literal("simulator-only"),
      codeSignature: z.enum(["none", "ad-hoc"]),
    }),
  ]),
  artifact: z.strictObject({
    name: z.string().regex(/^baro-preview-(android|ios-simulator)-[a-f0-9]{40}\.(apk|zip)$/),
    bytes: z.number().int().positive(),
    sha256: digest,
  }),
  compiledFont: z.strictObject({
    kind: z.literal("compiled-resource-only"),
    family: z.literal("BaroMobile"),
    sha256: digest,
    weights: z.tuple([z.literal(400), z.literal(600), z.literal(700)]),
    glyphs: z.number().int().positive(),
    codepoints: z.number().int().positive(),
    hangul: z.literal(11172),
    licenseEmbedded: z.literal(true),
    compiledBytesMatch: z.literal(true),
    appRuntimeVerified: z.literal(false),
  }),
  compatibility: z.literal("runtime-smoke-required"),
  requiresMetro: z.literal(true),
  binaryMetadataVerified: z.literal(true),
  appRuntimeVerified: z.literal(false),
  remoteApiVerified: z.literal(false),
  physicalDeviceVerified: z.literal(false),
  storeSigned: z.literal(false),
  deployed: z.literal(false),
});
export function verifyPreviewArtifact(
  value: unknown,
  sourceSha: string,
  platform: "android" | "ios",
) {
  const receipt = previewArtifactSchema.parse(value);
  const android = platform === "android";
  if (
    receipt.sourceSha !== sourceSha ||
    receipt.platform !== platform ||
    receipt.installTarget !== (android ? "android-device-or-emulator" : "ios-simulator") ||
    receipt.signing.kind !== (android ? "android-debug" : "simulator-only") ||
    receipt.architectures.some(
      (abi) => !(android ? ["arm64-v8a", "x86_64"] : ["arm64", "x86_64"]).includes(abi),
    ) ||
    receipt.artifact.name !==
      `baro-preview-${android ? "android" : "ios-simulator"}-${sourceSha}.${android ? "apk" : "zip"}`
  )
    throw new Error("PREVIEW_ARTIFACT_IDENTITY_MISMATCH");
  return receipt;
}
export function parseAndroidBadging(value: string) {
  const pkg = value.match(
    /^package:\s+name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/m,
  );
  const minimumOS = value.match(/^sdkVersion:'([0-9]+)'/m)?.[1];
  const architecture = value.match(/^native-code:\s*(.+)$/m)?.[1] ?? "";
  const architectures = [...architecture.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  if (!pkg || !minimumOS || !value.includes("application-debuggable") || !architectures.length)
    throw new Error("PREVIEW_ANDROID_METADATA_MISSING");
  return {
    applicationId: pkg[1],
    buildVersion: pkg[2],
    versionName: pkg[3],
    minimumOS,
    architectures,
  };
}
/** apksigner uses SDK-range labels for v3.1. Repeated ranges must keep the same debug certificate. */
export function androidSignerDigest(value: string) {
  const matches = [
    ...value.matchAll(
      /^(?:Signer #\d+|Signer \(minSdkVersion=\d+(?: \(dev release=true\))?, maxSdkVersion=\d+\)) certificate SHA-256 digest:\s*([a-f0-9]{64})\s*$/gim,
    ),
  ];
  const certificates = [...new Set(matches.map((match) => match[1]?.toLowerCase()))];
  if (certificates.length !== 1 || !certificates[0])
    throw new Error("PREVIEW_ANDROID_SIGNER_REQUIRED");
  return certificates[0];
}
export function simulatorSignature(exitCode: number, report: string): "none" | "ad-hoc" {
  if (exitCode !== 0 && report.includes("code object is not signed at all")) return "none";
  if (
    exitCode === 0 &&
    /^Signature=adhoc$/m.test(report) &&
    !/^Authority=/m.test(report) &&
    (!/^TeamIdentifier=/m.test(report) || /^TeamIdentifier=not set$/m.test(report))
  )
    return "ad-hoc";
  throw new Error("PREVIEW_SIMULATOR_DISTRIBUTION_IDENTITY_UNEXPECTED");
}
export async function observePreviewApi(
  request: (url: string, init: RequestInit) => Promise<Response> = fetch,
) {
  try {
    const response = await request("https://preview.baro.site/api/health/live", {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("API_OBSERVATION_UNAVAILABLE");
    const health = z
      .object({
        status: z.literal("ok"),
        service: z.literal("baro"),
        environment: z.literal("preview"),
        release: sha,
      })
      .parse(await response.json());
    return apiObservationSchema.parse({
      status: "observed",
      observedAt: new Date().toISOString(),
      sourceSha: health.release,
    });
  } catch {
    return apiObservationSchema.parse({
      status: "unavailable",
      observedAt: new Date().toISOString(),
    });
  }
}
async function main() {
  const platform = process.argv[2],
    sourceSha = process.env.TARGET_SHA;
  if (
    (platform !== "android" && platform !== "ios") ||
    !sha.safeParse(sourceSha).success ||
    process.env.EXPO_PUBLIC_APP_ENV !== "preview" ||
    process.env.EXPO_PUBLIC_API_URL !== "https://preview.baro.site"
  )
    throw new Error("PREVIEW_ARTIFACT_EXPLICIT_TARGET_REQUIRED");
  const root = process.cwd(),
    mobile = resolve(root, "apps/mobile"),
    out = resolve(root, ".wrangler/mobile-handoff");
  async function command(args: string[]) {
    const child = Bun.spawn(args, { cwd: root, stdout: "pipe", stderr: "ignore" });
    const timer = setTimeout(() => child.kill(), 120000);
    try {
      const value = await new Response(child.stdout).text();
      if (await child.exited) throw new Error("PREVIEW_ARTIFACT_TOOL_FAILED");
      return value.trim();
    } finally {
      clearTimeout(timer);
    }
  }
  if ((await command(["git", "rev-parse", "HEAD"])) !== sourceSha)
    throw new Error("PREVIEW_ARTIFACT_SOURCE_MISMATCH");
  await command(["git", "diff", "--exit-code", "HEAD"]);
  const manifest = JSON.parse(await readFile(resolve(mobile, "package.json"), "utf8"));
  if (manifest.main !== "expo-router/entry")
    throw new Error("PREVIEW_ARTIFACT_PRODUCT_ENTRY_REQUIRED");
  await mkdir(out, { recursive: true });
  const name = `baro-preview-${platform === "android" ? "android" : "ios-simulator"}-${sourceSha}.${platform === "android" ? "apk" : "zip"}`;
  const artifact = resolve(out, name);
  let metadata: unknown, signing: unknown;
  if (platform === "android") {
    const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
    if (!sdk) throw new Error("PREVIEW_ANDROID_SDK_REQUIRED");
    const versions = (await readdir(resolve(sdk, "build-tools")))
      .filter((value) => /^\d+\.\d+\.\d+$/.test(value))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const version = versions.at(-1);
    if (!version) throw new Error("PREVIEW_ANDROID_TOOLS_REQUIRED");
    const tools = resolve(sdk, "build-tools", version),
      apk = resolve(mobile, "android/app/build/outputs/apk/debug/app-debug.apk");
    metadata = parseAndroidBadging(await command([resolve(tools, "aapt"), "dump", "badging", apk]));
    const cert = androidSignerDigest(
      await command([resolve(tools, "apksigner"), "verify", "--print-certs", apk]),
    );
    signing = { kind: "android-debug", certificateSha256: cert };
    await copyFile(apk, artifact);
  } else {
    if (process.platform !== "darwin") throw new Error("PREVIEW_IOS_XCODE_REQUIRED");
    const products = resolve(
      root,
      ".wrangler/mobile-build/ios/Build/Products/Debug-iphonesimulator",
    );
    const apps = (await readdir(products)).filter((name) => name.endsWith(".app"));
    if (apps.length !== 1 || !apps[0]) throw new Error("PREVIEW_IOS_APP_AMBIGUOUS");
    const app = resolve(products, apps[0]);
    const info = JSON.parse(
      await command(["plutil", "-convert", "json", "-o", "-", resolve(app, "Info.plist")]),
    );
    if (
      info.DTPlatformName !== "iphonesimulator" ||
      JSON.stringify(info.CFBundleSupportedPlatforms) !== JSON.stringify(["iPhoneSimulator"]) ||
      typeof info.CFBundleExecutable !== "string" ||
      basename(info.CFBundleExecutable) !== info.CFBundleExecutable
    )
      throw new Error("PREVIEW_IOS_SIMULATOR_ONLY");
    const architectures = (
      await command(["lipo", "-archs", resolve(app, info.CFBundleExecutable)])
    ).split(/\s+/);
    metadata = {
      applicationId: info.CFBundleIdentifier,
      versionName: info.CFBundleShortVersionString,
      buildVersion: info.CFBundleVersion,
      minimumOS: info.MinimumOSVersion,
      architectures,
    };
    const signed = Bun.spawn(["codesign", "-dv", "--verbose=2", app], {
      stdout: "ignore",
      stderr: "pipe",
    });
    const signatureReport = await new Response(signed.stderr).text();
    signing = {
      kind: "simulator-only",
      codeSignature: simulatorSignature(await signed.exited, signatureReport),
    };
    await command(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", app, artifact]);
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(artifact)) hash.update(chunk);
  const receipt = verifyPreviewArtifact(
    {
      version: 1,
      kind: "preview-development-app",
      sourceSha,
      platform,
      environment: "preview",
      apiOrigin: "https://preview.baro.site",
      apiObservation: await observePreviewApi(),
      expo: manifest.dependencies.expo,
      reactNative: manifest.dependencies["react-native"],
      ...z
        .object({
          applicationId: z.string(),
          versionName: z.string(),
          buildVersion: z.string(),
          minimumOS: z.string(),
          architectures: z.array(z.string()),
        })
        .parse(metadata),
      signing,
      installTarget: platform === "android" ? "android-device-or-emulator" : "ios-simulator",
      artifact: { name, bytes: (await stat(artifact)).size, sha256: hash.digest("hex") },
      compiledFont: JSON.parse(
        await readFile(resolve(root, `.wrangler/mobile-build/assets-${platform}.json`), "utf8"),
      ),
      compatibility: "runtime-smoke-required",
      requiresMetro: true,
      binaryMetadataVerified: true,
      appRuntimeVerified: false,
      remoteApiVerified: false,
      physicalDeviceVerified: false,
      storeSigned: false,
      deployed: false,
    },
    sourceSha as string,
    platform,
  );
  if (receipt.versionName !== manifest.version) throw new Error("PREVIEW_NATIVE_VERSION_DRIFT");
  await writeFile(
    resolve(out, `receipt-${platform}.json`),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  console.log(
    `Preview ${platform} development artifact packaged; actual binary metadata/hash verified, runtime/API/physical/store acceptance remains open`,
  );
}
if (import.meta.main)
  await main().catch((error: unknown) => {
    console.error(
      error instanceof Error && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.message)
        ? error.message
        : "PREVIEW_ARTIFACT_FAILED",
    );
    process.exitCode = 1;
  });
