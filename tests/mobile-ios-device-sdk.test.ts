import { expect, test } from "bun:test";
import {
  inspectIosDeviceExecutable,
  inspectIosDeviceInfo,
  iosDeviceSdkBuildArguments,
  iosDeviceSdkEnvironment,
  iosDeviceSdkFailureCode,
  normalizedIosSdkVersion,
  verifyIosDeviceSdkReceipt,
} from "../scripts/mobile-ios-device-sdk";

const source = "a".repeat(40);
function executable() {
  const bytes = new Uint8Array(64),
    view = new DataView(bytes.buffer);
  for (const [offset, value] of [
    [0, 0xfeedfacf],
    [4, 0x0100000c],
    [12, 2],
    [16, 1],
    [20, 32],
    [32, 0x32],
    [36, 32],
    [40, 2],
    [44, 0x100400],
    [48, 0x1a0500],
    [52, 1],
    [56, 3],
  ])
    view.setUint32(offset ?? 0, value ?? 0, true);
  return bytes;
}
function info() {
  return {
    CFBundleIdentifier: "site.baro.app.preview",
    CFBundleExecutable: "BAROPreview",
    CFBundleShortVersionString: "0.1.0",
    CFBundleVersion: "1",
    MinimumOSVersion: "16.4",
    CFBundleSupportedPlatforms: ["iPhoneOS"],
    DTPlatformName: "iphoneos",
    UIDeviceFamily: [1, 2],
    UIAppFonts: ["BaroMobile.ttf"],
    CFBundleURLTypes: [{ CFBundleURLSchemes: ["baro-preview"] }],
  };
}
test("device SDK attestation reads actual thin arm64 iOS load commands and rejects Simulator, Catalyst or signatures", () => {
  expect(inspectIosDeviceExecutable(executable())).toMatchObject({
    architecture: "arm64",
    platform: "iphoneos",
    minimumOS: "16.4",
    sdkVersion: "26.5",
    codeSignature: "none",
  });
  for (const [offset, value] of [
    [0, 0xfeedface],
    [4, 0x01000007],
    [8, 2],
    [12, 6],
    [16, 0],
    [16, 2],
    [20, 33],
    [36, 0],
    [36, 8],
    [40, 7],
    [40, 6],
    [44, 0x100500],
    [48, 0],
    [32, 0x1d],
    [32, 0x25],
  ]) {
    const bytes = executable();
    new DataView(bytes.buffer).setUint32(offset ?? 0, value ?? 0, true);
    expect(() => inspectIosDeviceExecutable(bytes)).toThrow();
  }
  for (const bytes of [new Uint8Array(), executable().slice(0, 55)])
    expect(() => inspectIosDeviceExecutable(bytes)).toThrow();
  const duplicate = new Uint8Array(96);
  duplicate.set(executable());
  duplicate.set(executable().slice(32), 64);
  const view = new DataView(duplicate.buffer);
  view.setUint32(16, 2, true);
  view.setUint32(20, 64, true);
  expect(() => inspectIosDeviceExecutable(duplicate)).toThrow(
    "IOS_DEVICE_SDK_IPHONEOS_PLATFORM_REQUIRED",
  );
});
test("device SDK metadata cannot relabel a Simulator, another environment or an unsafe executable path", () => {
  expect(inspectIosDeviceInfo(info()).CFBundleIdentifier).toBe("site.baro.app.preview");
  for (const patch of [
    { CFBundleIdentifier: "site.baro.app" },
    { CFBundleExecutable: "../private" },
    { CFBundleExecutable: ".." },
    { CFBundleSupportedPlatforms: ["iPhoneSimulator"] },
    { DTPlatformName: "iphonesimulator" },
    { MinimumOSVersion: "17.0" },
    { UIDeviceFamily: [1] },
    { UIAppFonts: [] },
    { CFBundleURLTypes: [{ CFBundleURLSchemes: ["baro"] }] },
    { CFBundleURLTypes: [{ CFBundleURLSchemes: ["baro-preview", "baro"] }] },
  ])
    expect(() => inspectIosDeviceInfo({ ...info(), ...patch })).toThrow();
  expect(normalizedIosSdkVersion("26.0.0")).toBe(normalizedIosSdkVersion("26.0"));
  expect(() => normalizedIosSdkVersion("private-sdk-value")).toThrow();
});
test("device SDK build requires explicit fresh preview CI, strips credentials and refuses signing and bundle overrides", () => {
  const env = {
    GITHUB_ACTIONS: "true",
    TARGET_SHA: source,
    EXPO_PUBLIC_APP_ENV: "preview",
    EXPO_PUBLIC_API_URL: "https://preview.baro.site",
    PATH: "/synthetic/bin",
    GITHUB_TOKEN: "synthetic-private",
    APPLE_PRIVATE_KEY: "synthetic-private",
  };
  const result = iosDeviceSdkEnvironment(env);
  expect(result.EXPO_PUBLIC_APP_ENV).toBe("preview");
  expect(JSON.stringify(result)).not.toContain("synthetic-private");
  for (const patch of [
    { GITHUB_ACTIONS: "false" },
    { TARGET_SHA: "private" },
    { EXPO_PUBLIC_APP_ENV: "production" },
    { EXPO_PUBLIC_API_URL: "https://baro.site" },
    { DEVELOPMENT_TEAM: "private" },
    { CODE_SIGN_IDENTITY: "-" },
    { SDKROOT: "iphonesimulator" },
    { ENTRY_FILE: "runtime-probe/index" },
    { SOURCEMAP_FILE: "public/map" },
  ])
    expect(() => iosDeviceSdkEnvironment({ ...env, ...patch })).toThrow();
  expect(iosDeviceSdkBuildArguments).toContain("CODE_SIGNING_ALLOWED=NO");
  expect(iosDeviceSdkBuildArguments).not.toContain("-allowProvisioningUpdates");
  expect(iosDeviceSdkFailureCode(Error("IOS_DEVICE_SDK_UNSIGNED_EXECUTABLE_REQUIRED"))).toBe(
    "IOS_DEVICE_SDK_UNSIGNED_EXECUTABLE_REQUIRED",
  );
  expect(iosDeviceSdkFailureCode(Error("IOS_DEVICE_SDK_PRIVATE_TOKEN_VALUE"))).toBe(
    "IOS_DEVICE_SDK_VALIDATION_FAILED",
  );
});
test("device SDK receipt remains an unprovisioned compile result and cannot substitute for installation or store signing", async () => {
  const shared = await Bun.file(
    "docs/quality/mobile-internal-ios-2026-10-23/receipt-171989e.json",
  ).json();
  const value = {
    version: 1,
    kind: "ios-device-sdk-unsigned-compile-preflight",
    sourceSha: source,
    observedAt: "2026-10-24T00:00:00.000Z",
    platform: "ios",
    buildSdk: "iphoneos",
    nativeConfiguration: "Release",
    applicationId: "site.baro.app.preview",
    environment: "preview",
    apiOrigin: "https://preview.baro.site",
    apiObservation: { status: "unavailable", observedAt: "2026-10-24T00:00:00.000Z" },
    versionName: "0.1.0",
    buildVersion: "1",
    expo: shared.expo,
    reactNative: shared.reactNative,
    minimumOS: "16.4",
    sdkVersion: "26.5",
    architectures: ["arm64"],
    infoPlistSha256: "b".repeat(64),
    executableSha256: "c".repeat(64),
    signing: {
      codeSignature: "none",
      developmentTeamProvided: false,
      provisioningProfilePresent: false,
    },
    embeddedBundle: shared.embeddedBundle,
    compiledFont: shared.compiledFont,
    artifact: {
      name: `baro-ios-device-sdk-unprovisioned-${source}.zip`,
      bytes: 100,
      sha256: "d".repeat(64),
    },
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
  };
  expect(verifyIosDeviceSdkReceipt(value, source).buildSdk).toBe("iphoneos");
  for (const patch of [
    { sourceSha: "e".repeat(40) },
    { buildSdk: "iphonesimulator" },
    { architectures: ["x86_64"] },
    {
      signing: {
        codeSignature: "ad-hoc",
        developmentTeamProvided: false,
        provisioningProfilePresent: false,
      },
    },
    { installableOnPhysicalDevice: true },
    { appRuntimeVerified: true },
    { physicalDeviceVerified: true },
    { storeSigned: true },
    { storeSubmitted: true },
    { deployed: true },
    { rawTeamSecret: "synthetic-private" },
  ])
    expect(() => verifyIosDeviceSdkReceipt({ ...value, ...patch }, source)).toThrow();
  expect(() => verifyIosDeviceSdkReceipt(shared, shared.sourceSha)).toThrow();
});

test("device SDK workflow cannot provision, submit or export private build diagnostics", async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file(".github/workflows/mobile-ios-device-sdk.yml").text(),
  ) as {
    on: Record<string, unknown>;
    permissions: Record<string, string>;
    jobs: Record<
      string,
      {
        if: string;
        environment?: unknown;
        steps: {
          run?: string;
          uses?: string;
          env?: Record<string, string>;
          with?: Record<string, string>;
        }[];
      }
    >;
  };
  expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
  expect(workflow.permissions).toEqual({ contents: "read", actions: "read" });
  const jobs = Object.values(workflow.jobs);
  expect(jobs).toHaveLength(1);
  const job = jobs[0];
  expect(job?.if).toBe("github.ref == 'refs/heads/main'");
  expect(job?.environment).toBeUndefined();
  const commands = job?.steps.map((step) => step.run ?? "").join("\n") ?? "";
  expect(commands).toContain("bun scripts/verify-release.ts");
  expect(commands).not.toMatch(
    /allowProvisioningUpdates|eas\s+(?:submit|build)|wrangler\s+deploy|devicectl|simctl/,
  );
  const upload = job?.steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
  expect(upload?.with?.path?.trim().split("\n")).toEqual([
    ".wrangler/mobile-ios-device-sdk/receipt.json",
    ".wrangler/mobile-ios-device-sdk/inspection.json",
    ".wrangler/mobile-ios-device-sdk/failure.json",
    ".wrangler/mobile-ios-device-sdk/baro-ios-device-sdk-unprovisioned-*.zip",
    ".wrangler/mobile-ios-device-sdk/unaccepted-ios-device-sdk-*.zip",
  ]);
  const build = job?.steps.find(
    (step) => step.run === "bun scripts/mobile-ios-device-sdk-build.ts",
  );
  expect(build?.env).toBeUndefined();
});
