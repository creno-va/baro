import { createHash } from "node:crypto";
import { z } from "zod";
import { internalIosArtifactSchema } from "./mobile-internal-ios-artifact";
import { xcodeControlEnvironment } from "./mobile-ios-xcode-control";
import { previewArtifactSchema } from "./mobile-preview-artifact";
import { metroNodeOptions } from "./mobile-runtime-host";

export const iosDeviceSdkBuildArguments = [
  "-configuration",
  "Release",
  "-sdk",
  "iphoneos",
  "-destination",
  "generic/platform=iOS",
  "ARCHS=arm64",
  "ONLY_ACTIVE_ARCH=NO",
  "CODE_SIGNING_ALLOWED=NO",
  "CODE_SIGNING_REQUIRED=NO",
  "CODE_SIGN_IDENTITY=",
  "DEVELOPMENT_TEAM=",
  "PROVISIONING_PROFILE_SPECIFIER=",
  "CODE_SIGN_INJECT_BASE_ENTITLEMENTS=NO",
] as const;
export function iosDeviceSdkEnvironment(input: Record<string, string | undefined>) {
  for (const key of [
    "SDKROOT",
    "CODE_SIGNING_ALLOWED",
    "CODE_SIGNING_REQUIRED",
    "CODE_SIGN_IDENTITY",
    "DEVELOPMENT_TEAM",
    "PROVISIONING_PROFILE_SPECIFIER",
    "ENTRY_FILE",
    "SKIP_BUNDLING",
    "FORCE_BUNDLING",
    "SOURCEMAP_FILE",
  ])
    if (input[key] !== undefined) throw Error("IOS_DEVICE_SDK_OVERRIDES_FORBIDDEN");
  return {
    ...xcodeControlEnvironment(input),
    NODE_ENV: "production",
    NODE_OPTIONS: metroNodeOptions(undefined),
  };
}
function version(value: number) {
  const parts = [value >>> 16, (value >>> 8) & 255, value & 255];
  return parts[2] ? parts.join(".") : parts.slice(0, 2).join(".");
}
export function inspectIosDeviceExecutable(bytes: Uint8Array) {
  if (bytes.length < 32) throw Error("IOS_DEVICE_SDK_EXECUTABLE_REQUIRED");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(0, true) !== 0xfeedfacf ||
    view.getUint32(4, true) !== 0x0100000c ||
    (view.getUint32(8, true) & 0xffffff) !== 0 ||
    view.getUint32(12, true) !== 2
  )
    throw Error("IOS_DEVICE_SDK_THIN_ARM64_EXECUTABLE_REQUIRED");
  const count = view.getUint32(16, true),
    size = view.getUint32(20, true),
    end = 32 + size;
  if (!count || count > 4096 || end > bytes.length || size < count * 8)
    throw Error("IOS_DEVICE_SDK_LOAD_COMMANDS_INVALID");
  let offset = 32,
    platform: { minimumOS: string; sdkVersion: string } | undefined;
  for (let index = 0; index < count; index++) {
    if (offset + 8 > end) throw Error("IOS_DEVICE_SDK_LOAD_COMMANDS_INVALID");
    const command = view.getUint32(offset, true),
      length = view.getUint32(offset + 4, true);
    if (length < 8 || length % 8 || offset + length > end)
      throw Error("IOS_DEVICE_SDK_LOAD_COMMANDS_INVALID");
    if (command === 0x1d) throw Error("IOS_DEVICE_SDK_UNSIGNED_EXECUTABLE_REQUIRED");
    if ([0x24, 0x25, 0x2f, 0x30].includes(command))
      throw Error("IOS_DEVICE_SDK_AMBIGUOUS_PLATFORM");
    if (command === 0x32) {
      if (
        platform ||
        length < 24 ||
        length !== 24 + view.getUint32(offset + 20, true) * 8 ||
        view.getUint32(offset + 8, true) !== 2
      )
        throw Error("IOS_DEVICE_SDK_IPHONEOS_PLATFORM_REQUIRED");
      const minimum = view.getUint32(offset + 12, true),
        sdk = view.getUint32(offset + 16, true);
      if (minimum !== 0x100400 || sdk < minimum) throw Error("IOS_DEVICE_SDK_MINIMUM_OS_CHANGED");
      platform = { minimumOS: version(minimum), sdkVersion: version(sdk) };
    }
    offset += length;
  }
  if (offset !== end || !platform) throw Error("IOS_DEVICE_SDK_PLATFORM_MISSING");
  return {
    ...platform,
    minimumOS: "16.4" as const,
    architecture: "arm64" as const,
    platform: "iphoneos" as const,
    codeSignature: "none" as const,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
const nativeVersion = z.string().regex(/^\d+(?:\.\d+){0,2}$/);
export function normalizedIosSdkVersion(value: string) {
  const parts = nativeVersion.parse(value).split(".").map(Number);
  while (parts.length > 1 && parts.at(-1) === 0) parts.pop();
  return parts.join(".");
}
export function inspectIosDeviceInfo(value: unknown) {
  const info = z
    .object({
      CFBundleIdentifier: z.literal("site.baro.app.preview"),
      CFBundleExecutable: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
      CFBundleShortVersionString: nativeVersion,
      CFBundleVersion: z.string().regex(/^\d+$/),
      MinimumOSVersion: z.enum(["16.4", "16.4.0"]),
      CFBundleSupportedPlatforms: z.tuple([z.literal("iPhoneOS")]),
      DTPlatformName: z.literal("iphoneos"),
      UIDeviceFamily: z.tuple([z.literal(1), z.literal(2)]),
      UIAppFonts: z.array(z.string()),
      CFBundleURLTypes: z.array(z.object({ CFBundleURLSchemes: z.array(z.string()) })),
    })
    .parse(value);
  const schemes = info.CFBundleURLTypes.flatMap((entry) => entry.CFBundleURLSchemes);
  if (
    !info.UIAppFonts.includes("BaroMobile.ttf") ||
    schemes.filter((scheme) => scheme === "baro-preview").length !== 1 ||
    schemes.some((scheme) => scheme === "baro" || scheme === "baro-dev")
  )
    throw Error("IOS_DEVICE_SDK_RESOURCES_OR_SCHEME_CHANGED");
  return info;
}
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const iosDeviceSdkReceiptSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("ios-device-sdk-unsigned-compile-preflight"),
  sourceSha: z.string().regex(/^[a-f0-9]{40}$/),
  observedAt: z.iso.datetime(),
  platform: z.literal("ios"),
  buildSdk: z.literal("iphoneos"),
  nativeConfiguration: z.literal("Release"),
  applicationId: z.literal("site.baro.app.preview"),
  environment: z.literal("preview"),
  apiOrigin: z.literal("https://preview.baro.site"),
  apiObservation: previewArtifactSchema.shape.apiObservation,
  versionName: nativeVersion,
  buildVersion: z.string().regex(/^\d+$/),
  expo: nativeVersion,
  reactNative: nativeVersion,
  minimumOS: z.literal("16.4"),
  sdkVersion: nativeVersion,
  architectures: z.tuple([z.literal("arm64")]),
  infoPlistSha256: digest,
  executableSha256: digest,
  signing: z.strictObject({
    codeSignature: z.literal("none"),
    developmentTeamProvided: z.literal(false),
    provisioningProfilePresent: z.literal(false),
  }),
  embeddedBundle: internalIosArtifactSchema.shape.embeddedBundle,
  compiledFont: previewArtifactSchema.shape.compiledFont,
  artifact: z.strictObject({
    name: z.string().regex(/^baro-ios-device-sdk-unprovisioned-[a-f0-9]{40}\.zip$/),
    bytes: z.number().int().positive(),
    sha256: digest,
  }),
  requiresMetro: z.literal(false),
  binaryMetadataVerified: z.literal(true),
  appleDeveloperCredentialsUsed: z.literal(false),
  installableOnPhysicalDevice: z.literal(false),
  appRuntimeVerified: z.literal(false),
  remoteApiVerified: z.literal(false),
  physicalDeviceVerified: z.literal(false),
  oauthVerified: z.literal(false),
  storeSigned: z.literal(false),
  storeSubmitted: z.literal(false),
  deployed: z.literal(false),
});
export function verifyIosDeviceSdkReceipt(value: unknown, sourceSha: string) {
  const result = iosDeviceSdkReceiptSchema.parse(value);
  if (
    result.sourceSha !== sourceSha ||
    result.artifact.name !== `baro-ios-device-sdk-unprovisioned-${sourceSha}.zip`
  )
    throw Error("IOS_DEVICE_SDK_RECEIPT_IDENTITY_MISMATCH");
  return result;
}
export function iosDeviceSdkFailureCode(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return new Set([
    "IOS_DEVICE_SDK_SOURCE_MISMATCH",
    "IOS_DEVICE_SDK_PRODUCT_ENTRY_REQUIRED",
    "IOS_DEVICE_SDK_WORKSPACE_REQUIRED",
    "IOS_DEVICE_SDK_COMPILED_APP_REQUIRED",
    "IOS_DEVICE_SDK_SDK_VERSION_MISMATCH",
    "IOS_DEVICE_SDK_PRIVATE_OR_SIGNED_OUTPUT_FORBIDDEN",
    "IOS_DEVICE_SDK_ARCHIVE_CHANGED",
    "IOS_DEVICE_SDK_COMMAND_FAILED",
    "IOS_DEVICE_SDK_EXECUTABLE_REQUIRED",
    "IOS_DEVICE_SDK_THIN_ARM64_EXECUTABLE_REQUIRED",
    "IOS_DEVICE_SDK_LOAD_COMMANDS_INVALID",
    "IOS_DEVICE_SDK_UNSIGNED_EXECUTABLE_REQUIRED",
    "IOS_DEVICE_SDK_AMBIGUOUS_PLATFORM",
    "IOS_DEVICE_SDK_IPHONEOS_PLATFORM_REQUIRED",
    "IOS_DEVICE_SDK_MINIMUM_OS_CHANGED",
    "IOS_DEVICE_SDK_PLATFORM_MISSING",
    "IOS_DEVICE_SDK_RESOURCES_OR_SCHEME_CHANGED",
    "IOS_DEVICE_SDK_RECEIPT_IDENTITY_MISMATCH",
  ]).has(code)
    ? code
    : "IOS_DEVICE_SDK_VALIDATION_FAILED";
}
