import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { probeFailureCategory } from "../apps/mobile/runtime-probe/failures";
import {
  iosReadinessReportSchema,
  iosReadinessStages,
} from "../apps/mobile/runtime-probe/ios-keychain-protocol";
import {
  DOWNLOAD_BYTES,
  OWNER_COOKIE,
  PROBE_OWNER,
  RUNTIME_ORIGIN,
  type RuntimeConfig,
  UPLOAD_BYTES,
} from "../apps/mobile/runtime-probe/protocol";
import { mobileBoundaryFindings } from "../scripts/mobile-boundaries";
import {
  assertIosNativeInputs,
  iosHostCommandFailure,
  preserveIosReadiness,
  verifyIosHostBinary,
} from "../scripts/mobile-ios-keychain-host";
import {
  simulatorEntitlements,
  simulatorIdentity,
  verifySimulatorEntitlements,
} from "../scripts/mobile-ios-simulator-signing";
import {
  verifySimulatorBuildPlatform,
  verifyXcodeControlBinary,
  xcodeControlBuildFailure,
  xcodeControlEntitlements,
  xcodeControlEnvironment,
  xcodeControlReceiptSchema,
  xcodeEntitlementShape,
  xcodeHostSignatureEntitlementsSchema,
  xcodeSimulatorControlArguments,
} from "../scripts/mobile-ios-xcode-control";
import { productEntryOverlay } from "../scripts/mobile-runtime";
import { createRuntimeFixture, repeatedDigest } from "../scripts/mobile-runtime-fixture";
import {
  androidRuntimeOptions,
  emulatorStartupIssues,
  metroNodeOptions,
  ownedAndroidPaths,
  quoteAdbShellArgument,
  runtimeDevelopmentUrl,
} from "../scripts/mobile-runtime-host";
import {
  runtimeReceiptSchema,
  verifyRuntimeHomeReceipt,
  verifyRuntimeReceipt,
} from "../scripts/mobile-runtime-receipt";

const config: RuntimeConfig = {
  version: 1,
  sourceSha: "a".repeat(40),
  nonce: "15a64c18-fd51-4f83-8205-4c917a245e6b",
  origin: RUNTIME_ORIGIN,
};
const fixture = createRuntimeFixture(config);
const {
  validateOwnedIosDevice,
  iosLaunchFailureCode,
  iosFailureDomains,
  iosFailureDetail,
  iosLaunchStage,
} = createRequire(import.meta.url)("../scripts/mobile-runtime-ios-launch.cjs") as {
  validateOwnedIosDevice(inventory: unknown, udid: string, name: string): void;
  iosLaunchFailureCode(error: unknown): string;
  iosFailureDomains(detail: string): { domain: string; code: number }[];
  iosFailureDetail(error: unknown): string;
  iosLaunchStage(code: string, operation: () => unknown): Promise<unknown>;
};
test("iOS launch preparation accepts only the created booted UUID/name pair", () => {
  const udid = "15a64c18-fd51-4f83-8205-4c917a245e6b",
    name = "baro_runtime_012345abcdef";
  const inventory = { devices: { syntheticOS: [{ udid, name, state: "Booted" }] } };
  expect(() => validateOwnedIosDevice(inventory, udid, name)).not.toThrow();
  for (const changed of [
    { udid: "25a64c18-fd51-4f83-8205-4c917a245e6b", name, state: "Booted" },
    { udid, name: "personal-simulator", state: "Booted" },
    { udid, name, state: "Shutdown" },
  ])
    expect(() =>
      validateOwnedIosDevice({ devices: { syntheticOS: [changed] } }, udid, name),
    ).toThrow("RUNTIME_OWNED_IOS_DEVICE_REQUIRED");
  expect(() => validateOwnedIosDevice(inventory, "../outside", name)).toThrow();
});
test("Xcode control failure retains only known compiler categories and entitlement shape, never unknown values", () => {
  const privateDetail = "synthetic-private /private/fixture";
  for (const [detail, code] of [
    [`${privateDetail}\nUndefined symbols for architecture arm64`, "XCODE_CONTROL_LINK_FAILED"],
    [
      `${privateDetail}\nCommand PhaseScriptExecution failed with a nonzero exit code`,
      "XCODE_CONTROL_SCRIPT_FAILED",
    ],
    [`${privateDetail}\nCommand CodeSign failed`, "XCODE_CONTROL_SIGN_FAILED"],
  ] as const) {
    expect(xcodeControlBuildFailure(new Error(privateDetail), detail)).toBe(code);
    expect(xcodeControlBuildFailure(new Error(code))).toBe(code);
  }
  expect(xcodeControlBuildFailure(new Error("XCODE_CONTROL_ENTITLEMENTS_MISMATCH"))).toBe(
    "XCODE_CONTROL_ENTITLEMENTS_MISMATCH",
  );
  expect(xcodeControlBuildFailure(new Error("SYNTHETIC_PRIVATE_CAPS"), privateDetail)).toBe(
    "XCODE_CONTROL_BUILD_FAILED",
  );
  const shape = xcodeEntitlementShape({
    "keychain-access-groups": [privateDetail],
    "com.apple.developer.team-identifier": privateDetail,
    [privateDetail]: true,
  });
  expect(shape).toMatchObject({
    keychainGroupCount: 1,
    ownKeychainGroupOnly: false,
    unknownKeyCount: 1,
    strictAccepted: false,
  });
  expect(JSON.stringify(shape)).not.toContain(privateDetail);
  expect(
    xcodeEntitlementShape({
      "keychain-access-groups": ["FAKETEAMID.site.baro.app.preview"],
      "application-identifier": "FAKETEAMID.site.baro.app.preview",
    }).strictAccepted,
  ).toBe(true);
});
test("pinned Expo iOS launcher API loads in a real Node process without accessing a simulator", async () => {
  const node = Bun.which("node");
  if (!node) throw new Error("PINNED_NODE_REQUIRED");
  const child = Bun.spawn([node, "scripts/mobile-runtime-ios-launch.cjs", "--self-test"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = await new Response(child.stdout).text();
  expect(await child.exited).toBe(0);
  expect(output.trim()).toBe("IOS_RUNTIME_LAUNCH_API_READY");
});
test("remote launch targets fail before any simulator command and emit only a fixed code", async () => {
  const node = Bun.which("node");
  if (!node) throw new Error("PINNED_NODE_REQUIRED");
  const child = Bun.spawn(
    [
      node,
      "scripts/mobile-runtime-ios-launch.cjs",
      "--open",
      "15a64c18-fd51-4f83-8205-4c917a245e6b",
      "baro_runtime_012345abcdef",
      "https://outside.invalid/private-synthetic-value",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const error = await new Response(child.stderr).text();
  expect(await child.exited).toBe(1);
  expect(error.trim()).toBe("RUNTIME_IOS_LOCAL_DEVELOPMENT_URL_REQUIRED");
  expect(error).not.toContain("private-synthetic-value");
});
test("manual native launch URL carries Expo's noninteractive controls and survives the adb device shell", async () => {
  const url = runtimeDevelopmentUrl(),
    parsed = new URL(url);
  expect(parsed.searchParams.get("url")).toBe("http://127.0.0.1:8081");
  for (const flag of [
    "__expo_disable_fab",
    "__expo_disable_auto_launch",
    "__expo_disable_onboarding",
  ])
    expect(parsed.searchParams.get(flag)).toBe("1");
  const value = `${url}&literal='synthetic value'`;
  const child = Bun.spawn(["sh", "-c", `printf '%s' ${quoteAdbShellArgument(value)}`], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await new Response(child.stdout).text()).toBe(value);
  expect(await child.exited).toBe(0);
});
test("AVD manager and emulator share explicitly owned home locations", () => {
  const paths = ownedAndroidPaths("/synthetic/baro-runtime");
  expect(paths.environment.ANDROID_AVD_HOME).toBe(paths.avdHome);
  expect(paths.environment.ANDROID_USER_HOME).toBe(paths.userHome);
  expect(paths.environment.ANDROID_EMULATOR_HOME).toBe(paths.userHome);
  expect(paths.avdHome.startsWith("/synthetic/baro-runtime/")).toBe(true);
});
test("real Node localhost listener binds the IPv4 address used by native deep links", async () => {
  const node = Bun.which("node");
  if (!node) throw new Error("PINNED_NODE_REQUIRED");
  const child = Bun.spawn(
    [
      node,
      "--input-type=module",
      "-e",
      'import {createServer} from "node:net"; const s=createServer(); s.listen(0,"localhost",()=>{console.log(JSON.stringify(s.address()));s.close();});',
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NODE_OPTIONS: metroNodeOptions("--dns-result-order=ipv6first") },
    },
  );
  const timeout = setTimeout(() => child.kill(), 3000);
  try {
    const output = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    expect(JSON.parse(output)).toMatchObject({ address: "127.0.0.1", family: "IPv4" });
  } finally {
    clearTimeout(timeout);
  }
});
test("runtime AVD configuration is restricted to the fresh owned name and explicit host resources", () => {
  expect(androidRuntimeOptions("baro_runtime_012345abcdef")).toContain("2048");
  for (const name of ["personal-phone", "../other", "baro_runtime_012345abcdef -read-only"])
    expect(() => androidRuntimeOptions(name)).toThrow();
});
test("emulator diagnostic output contains fixed failure codes and excludes raw paths/tokens/stacks", () => {
  const input =
    "Not enough RAM; KVM permission denied; failed to initialize Vulkan; error while loading shared libraries; synthetic_token=private\n at /private/fixture/path";
  const classified = emulatorStartupIssues(input);
  expect(classified).toEqual([
    "RAM_UNAVAILABLE",
    "ACCELERATION_UNAVAILABLE",
    "GPU_INITIALIZATION_FAILED",
    "HOST_LIBRARY_MISSING",
  ]);
  expect(JSON.stringify(classified)).not.toContain("synthetic_token");
  expect(emulatorStartupIssues("unknown stack /private/fixture/path")).toEqual([]);
});
test("isolated probe public config replacement keeps Node/secret/dynamic environment reads forbidden", () => {
  const path = "apps/mobile/runtime-probe/run.ts";
  expect(
    mobileBoundaryFindings(
      path,
      "const sha=process.env.EXPO_PUBLIC_NATIVE_PROBE_SOURCE_SHA; const nonce=process.env.EXPO_PUBLIC_NATIVE_PROBE_NONCE;",
    ),
  ).toEqual([]);
  for (const source of [
    "process.env.SECRET",
    "process.env[key]",
    "process.version",
    "process.env.EXPO_PUBLIC_APP_ENV",
    'import fs from "node:fs"',
  ])
    expect(mobileBoundaryFindings(path, source).length).toBeGreaterThan(0);
  expect(
    mobileBoundaryFindings(
      "apps/mobile/src/app/index.tsx",
      "process.env.EXPO_PUBLIC_NATIVE_PROBE_NONCE",
    ).length,
  ).toBeGreaterThan(0);
});
const headers = {
  cookie: OWNER_COOKIE,
  origin: RUNTIME_ORIGIN,
  "x-baro-expected-owner": PROBE_OWNER,
};
const control = (path: string, body: unknown, nonce = config.nonce) =>
  new Request(`${RUNTIME_ORIGIN}/probe/${path}`, {
    method: "POST",
    headers: { "x-baro-probe-run": nonce, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("loopback fixture separates anonymous product boot, nonce control and exact owner native headers", async () => {
  expect(
    (await fixture.fetch(control("mounted", { width: 390, height: 700 }, "wrong"))).status,
  ).toBe(401);
  expect(fixture.state.productMount).toBeNull();
  expect((await fixture.fetch(new Request("https://outside.invalid/api/me/session"))).status).toBe(
    400,
  );
  const session = (await (
    await fixture.fetch(new Request(`${RUNTIME_ORIGIN}/api/me/session`))
  ).json()) as { user: null; needsConsent: boolean };
  expect(session).toEqual({ user: null, needsConsent: false });
  const denied = await fixture.fetch(
    new Request(`${RUNTIME_ORIGIN}/api/v2/cases/probe_case/files/unauthorized/content`, {
      headers: { ...headers, cookie: "wrong" },
    }),
  );
  expect(denied.status).toBe(401);
  expect((await fixture.fetch(control("mounted", { width: 390, height: 700 }))).status).toBe(200);
  expect(fixture.state.productMount).toEqual({ width: 390, height: 700 });
});

test("fixture computes complete streamed 100MB and 1GB hashes without allocating whole bodies", async () => {
  const chunk = new Uint8Array(65536).fill(97);
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === UPLOAD_BYTES) {
        controller.close();
        return;
      }
      const next = chunk.subarray(0, Math.min(chunk.length, UPLOAD_BYTES - offset));
      offset += next.length;
      controller.enqueue(next);
    },
  });
  const uploaded = await fixture.fetch(
    new Request(`${RUNTIME_ORIGIN}/api/v2/me/lawyer/assets/upload/content`, {
      method: "PUT",
      headers: {
        ...headers,
        "content-type": "application/octet-stream",
        "content-length": String(UPLOAD_BYTES),
        "if-match": "1",
      },
      body,
    }),
  );
  expect(uploaded.status).toBe(200);
  expect(fixture.state.upload).toEqual({
    bytes: UPLOAD_BYTES,
    sha256: repeatedDigest(UPLOAD_BYTES),
  });
  const response = await fixture.fetch(
    new Request(`${RUNTIME_ORIGIN}/api/v2/cases/probe_case/files/download/content`, { headers }),
  );
  const reader = response.body?.getReader();
  if (!reader) throw new Error("READER_REQUIRED");
  const hash = createHash("sha256");
  let received = 0,
    max = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    received += next.value.length;
    max = Math.max(max, next.value.length);
    hash.update(next.value);
  }
  expect(received).toBe(DOWNLOAD_BYTES);
  expect(max).toBe(65536);
  expect(hash.digest("hex")).toBe(fixture.largeHash);
  expect(fixture.state.downloadedBytes).toBe(DOWNLOAD_BYTES);
});

test("cancellation fixture stalls after the first received bytes, before consuming the whole upload", async () => {
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(32768).fill(97));
    },
  });
  const pending = fixture.fetch(
    new Request(`${RUNTIME_ORIGIN}/api/v2/me/lawyer/assets/cancel/content`, {
      method: "PUT",
      headers: {
        ...headers,
        "content-type": "application/octet-stream",
        "content-length": String(UPLOAD_BYTES),
        "if-match": "1",
      },
      body,
    }),
  );
  for (let i = 0; i < 10 && !fixture.state.cancelUploadStarted; i++) await Promise.resolve();
  expect(fixture.state.cancelUploadStarted).toBe(true);
  expect(fixture.state.cancelUploadBytes).toBe(32768);
  fixture.release();
  expect((await pending).status).toBe(400);
});

const candidate = () => ({
  version: 1,
  kind: "local-development-runtime",
  sourceSha: config.sourceSha,
  platform: "ios",
  environment: "local",
  apiOrigin: RUNTIME_ORIGIN,
  applicationId: "site.baro.app.dev",
  device: { kind: "simulator", model: "synthetic iPhone", osVersion: "26" },
  productEntry: {
    kind: "instrumented-home-layout-only",
    originalSha256: "1".repeat(64),
    overlaySha256: "2".repeat(64),
    layout: { width: 390, height: 700 },
    screenshot: "product-home-ios.png",
  },
  probeEntry: {
    kind: "alternate-entry-real-native-sdk",
    path: "apps/mobile/runtime-probe/entry.tsx",
    sha256: "3".repeat(64),
  },
  metroOverlaySha256: "4".repeat(64),
  assets: {
    kind: "compiled-resource-only",
    family: "BaroMobile",
    sha256: "5".repeat(64),
    weights: [400, 600, 700],
    glyphs: 14757,
    codepoints: 14336,
    hangul: 11172,
    licenseEmbedded: true,
    compiledBytesMatch: true,
    appRuntimeVerified: false,
  },
  result: {
    version: 1,
    sourceSha: config.sourceSha,
    platform: "ios",
    upload: { bytes: UPLOAD_BYTES, sha256: fixture.uploadHash },
    download: { bytes: DOWNLOAD_BYTES, sha256: fixture.largeHash },
    nativeCalls: 5,
    nativeMaxCopyBytes: 65536,
    sdkSourceReadback: true,
    sdkDownloadReadback: true,
    secureStoreReadback: true,
    unresolvedKeyPreserved: true,
    cancelUploadBytesReceived: 32768,
    unauthorizedRejected: true,
    crossOriginRejected: true,
    ownerChangeRejected: true,
    peerCookiePreserved: true,
    sourceClearRejectedActiveUpload: true,
    sourceFilesRemaining: 0,
    downloadFilesRemaining: 0,
    nativeFilesRemaining: 0,
    documentPickerVerified: false,
    oauthVerified: false,
    remoteApiVerified: false,
    physicalDeviceVerified: false,
    storeSigned: false,
    deployed: false,
  },
  transport: {
    requestCount: 5,
    rejectedHeaders: 0,
    upload: { bytes: UPLOAD_BYTES, sha256: fixture.uploadHash },
    downloadedBytes: DOWNLOAD_BYTES,
    delayedStarted: true,
    cancelUploadStarted: true,
    cancelUploadBytes: 32768,
  },
  memory: {
    metric: "sampled-process-rss",
    peakObservedBytes: 256000000,
    samples: 10,
    wholeRunPeakProven: false,
    jsHeapLimitProven: false,
  },
  productJourneysVerified: false,
  accessibilityVerified: false,
  storeSigned: false,
  deployed: false,
});
test("receipt rejects wrong source/platform, missing IO/cleanup and expanded acceptance claims", () => {
  const valid = candidate();
  expect(verifyRuntimeReceipt(valid, config.sourceSha, "ios").sourceSha).toBe(config.sourceSha);
  expect(() => verifyRuntimeReceipt(valid, "b".repeat(40), "ios")).toThrow();
  expect(() => verifyRuntimeReceipt(valid, config.sourceSha, "android")).toThrow();
  for (const field of [
    "productJourneysVerified",
    "accessibilityVerified",
    "storeSigned",
    "deployed",
  ]) {
    expect(runtimeReceiptSchema.safeParse({ ...valid, [field]: true }).success).toBe(false);
  }
  expect(
    runtimeReceiptSchema.safeParse({ ...valid, memory: { ...valid.memory, samples: 0 } }).success,
  ).toBe(false);
  expect(
    runtimeReceiptSchema.safeParse({
      ...valid,
      result: { ...valid.result, nativeFilesRemaining: 1 },
    }).success,
  ).toBe(false);
  expect(() =>
    verifyRuntimeReceipt(
      { ...valid, transport: { ...valid.transport, cancelUploadBytes: 32769 } },
      config.sourceSha,
      "ios",
    ),
  ).toThrow();
});
test("manual workflow preserves product entry and only uploads scoped receipts and synthetic screenshots", async () => {
  const manifest = await Bun.file("apps/mobile/package.json").json();
  expect(manifest.main).toBe("expo-router/entry");
  expect(productEntryOverlay()).toContain("<OriginalHome />");
  expect(productEntryOverlay()).toContain("/probe/mounted");
  const workflow = await Bun.file(".github/workflows/mobile-runtime.yml").text();
  expect(workflow).toContain("github.ref == 'refs/heads/main'");
  expect(workflow).toContain("cancel-in-progress: false");
  expect(workflow).not.toContain("private-command");
  for (const line of workflow.split("\n").filter((line) => line.includes("uses:")))
    expect(line).toMatch(/@[a-f0-9]{40}/);
});

test("Simulator signing rejects physical/production identity, traversal and broader access groups", () => {
  const info = {
    CFBundleIdentifier: "site.baro.app.preview",
    CFBundleSupportedPlatforms: ["iPhoneSimulator"],
    DTPlatformName: "iphonesimulator",
    CFBundleExecutable: "BAROPreview",
  };
  expect(simulatorIdentity(info, "site.baro.app.preview").CFBundleIdentifier).toBe(
    "site.baro.app.preview",
  );
  for (const invalid of [
    { ...info, CFBundleSupportedPlatforms: ["iPhoneOS"] },
    { ...info, DTPlatformName: "iphoneos" },
    { ...info, CFBundleIdentifier: "site.baro.app" },
    { ...info, CFBundleExecutable: "../outside" },
  ])
    expect(() => simulatorIdentity(invalid, "site.baro.app.preview")).toThrow();
  const entitlements = simulatorEntitlements("site.baro.app.preview");
  expect(verifySimulatorEntitlements(entitlements, "site.baro.app.preview")).toEqual(entitlements);
  for (const invalid of [
    { ...entitlements, "keychain-access-groups": ["*"] },
    { ...entitlements, "com.apple.developer.team-identifier": "synthetic-team" },
    { ...entitlements, "keychain-access-groups": ["site.baro.app.preview", "site.baro.app"] },
  ])
    expect(() => verifySimulatorEntitlements(invalid, "site.baro.app.preview")).toThrow();
});
test("a group-only Simulator experiment cannot claim an application identifier, Team or shared group", () => {
  const value = simulatorEntitlements("site.baro.app.preview", "group-only");
  expect(value).toEqual({ "keychain-access-groups": ["site.baro.app.preview"] });
  expect(verifySimulatorEntitlements(value, "site.baro.app.preview", "group-only")).toEqual(value);
  for (const invalid of [
    { ...value, "application-identifier": "site.baro.app.preview" },
    { ...value, "com.apple.developer.team-identifier": "synthetic-team" },
    { "keychain-access-groups": ["site.baro.app.preview", "site.baro.app.dev"] },
  ])
    expect(() =>
      verifySimulatorEntitlements(invalid, "site.baro.app.preview", "group-only"),
    ).toThrow();
});
test("the launcher preserves a fixed stage and only parses bounded known domains from native Buffer errors", async () => {
  const privateText = "synthetic-private /private/fixture";
  const original = Object.assign(new Error(privateText), {
    stderr: Buffer.from(
      `An error was encountered (domain=NSPOSIXErrorDomain, code=153): ${privateText}\nError Domain=NSOSStatusErrorDomain Code=-10814`,
    ),
  });
  const failure = await iosLaunchStage("RUNTIME_IOS_OPEN_URL_FAILED", () => {
    throw original;
  }).catch((error) => error);
  expect(iosLaunchFailureCode(failure)).toBe("RUNTIME_IOS_OPEN_URL_FAILED");
  const domains = iosFailureDomains(iosFailureDetail(failure));
  expect(domains).toEqual([
    { domain: "NSPOSIXErrorDomain", code: 153 },
    { domain: "NSOSStatusErrorDomain", code: -10814 },
  ]);
  expect(JSON.stringify({ code: iosLaunchFailureCode(failure), domains })).not.toContain(
    privateText,
  );
});
test("SDK error observations contain fixed categories and readiness cannot omit or reorder failed work", () => {
  const error = Object.assign(
    new Error("A required entitlement isn't present. synthetic-private-value /private/fixture"),
    { code: "ERR_KEY_CHAIN", stack: "synthetic-stack" },
  );
  expect(probeFailureCategory(error)).toBe("KEYCHAIN_ENTITLEMENT_MISSING");
  expect(probeFailureCategory({ code: "PRIVATE_DOWNLOAD_FAILED", message: "private" })).toBe(
    "PRIVATE_TRANSFER_FAILURE",
  );
  const value = {
    version: 1,
    kind: "simulator-sdk-readiness",
    sourceSha: "a".repeat(40),
    phase: "baseline",
    operations: iosReadinessStages.map((stage) => ({ stage, ok: true })),
    allSucceeded: true,
    externalFetchAttempts: 0,
  };
  expect(iosReadinessReportSchema.parse(value).allSucceeded).toBe(true);
  expect(() => iosReadinessReportSchema.parse({ ...value, externalFetchAttempts: 1 })).toThrow();
  expect(() =>
    iosReadinessReportSchema.parse({ ...value, operations: [...value.operations].reverse() }),
  ).toThrow();
  expect(() => iosReadinessReportSchema.parse({ ...value, rawStack: "synthetic-stack" })).toThrow();
  expect(() =>
    iosReadinessReportSchema.parse({
      ...value,
      operations: value.operations.map((op, index) => (index ? op : { ...op, ok: false })),
    }),
  ).toThrow();
});
test("a later host failure cannot discard an observed baseline or persist another run's report", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "baro-ios-partial-"));
  const baseline = {
    version: 1,
    kind: "simulator-sdk-readiness",
    sourceSha: "a".repeat(40),
    phase: "baseline",
    operations: iosReadinessStages.map((stage) => ({ stage, ok: false, category: "UNKNOWN" })),
    allSucceeded: false,
    externalFetchAttempts: 0,
  };
  try {
    await preserveIosReadiness(directory, baseline, "a".repeat(40), "baseline");
    // The signed install can fail before any final receipt is written.
    await expect(
      preserveIosReadiness(
        directory,
        { ...baseline, phase: "signed", sourceSha: "b".repeat(40) },
        "a".repeat(40),
        "signed",
      ),
    ).rejects.toThrow("IOS_HOST_REPORT_IDENTITY_MISMATCH");
    expect(await Bun.file(resolve(directory, "baseline.json")).json()).toEqual(baseline);
    expect(await Bun.file(resolve(directory, "signed.json")).exists()).toBe(false);
    await expect(
      preserveIosReadiness(
        directory,
        { ...baseline, rawStack: "private-synthetic" },
        "a".repeat(40),
        "baseline",
      ),
    ).rejects.toThrow();
    expect(await Bun.file(resolve(directory, "baseline.json")).json()).toEqual(baseline);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("host command failure categories cannot expose stderr, paths, signing data or raw errors", () => {
  const secret = "synthetic-private-value /private/fixture";
  expect(iosHostCommandFailure(`ApplicationVerificationFailed ${secret}`, false)).toBe(
    "SIGNATURE_REJECTED",
  );
  expect(iosHostCommandFailure(`FBSOpenApplicationServiceErrorDomain ${secret}`, false)).toBe(
    "LAUNCH_DENIED",
  );
  expect(iosHostCommandFailure(secret, true)).toBe("COMMAND_TIMEOUT");
  expect(iosHostCommandFailure(secret, false)).toBe("UNKNOWN");
  expect(iosHostCommandFailure(`RUNTIME_IOS_LAUNCH_FAILED ${secret}`, false)).toBe("LAUNCH_FAILED");
  const signature = iosLaunchFailureCode(
    Object.assign(new Error(secret), { stderr: `ApplicationVerificationFailed ${secret}` }),
  );
  expect(signature).toBe("RUNTIME_IOS_APPLICATION_SIGNATURE_REJECTED");
  expect(iosHostCommandFailure(signature, false)).toBe("SIGNATURE_REJECTED");
  expect(iosLaunchFailureCode(new Error(`FBSOpenApplicationServiceErrorDomain ${secret}`))).toBe(
    "RUNTIME_IOS_APPLICATION_LAUNCH_DENIED",
  );
  expect(iosLaunchFailureCode(new Error(secret))).toBe("RUNTIME_IOS_LAUNCH_FAILED");
  expect(iosLaunchFailureCode(new Error("SYNTHETIC_PRIVATE_CAPS"))).toBe(
    "RUNTIME_IOS_LAUNCH_FAILED",
  );
  const domains = iosFailureDomains(
    `Error Domain=NSOSStatusErrorDomain Code=-10814 "${secret}" UserInfo={NSPOSIXErrorDomain Code=5}\nIOS_RUNTIME_FAILURE_DOMAIN NSOSStatusErrorDomain -10814\nUnknownPrivateDomain Code=42\nNSCocoaErrorDomain Code=999999999999999999`,
  );
  expect(domains).toEqual([
    { domain: "NSOSStatusErrorDomain", code: -10814 },
    { domain: "NSPOSIXErrorDomain", code: 5 },
  ]);
  expect(JSON.stringify(domains)).not.toContain(secret);
});
test("a Home-only receipt preserves exact identity and cannot claim later native IO success", async () => {
  const full = await Bun.file("docs/quality/mobile-runtime-2026-10-23/receipt-android.json").json();
  const home = {
    version: 1,
    kind: "instrumented-home-only",
    sourceSha: full.sourceSha,
    platform: full.platform,
    applicationId: full.applicationId,
    device: full.device,
    productEntry: full.productEntry,
    assets: full.assets,
    nativeIoVerified: false,
    productJourneysVerified: false,
    accessibilityVerified: false,
    remoteApiVerified: false,
    oauthVerified: false,
    physicalDeviceVerified: false,
    storeSigned: false,
    deployed: false,
  };
  expect(verifyRuntimeHomeReceipt(home, full.sourceSha, "android").nativeIoVerified).toBe(false);
  expect(() =>
    verifyRuntimeHomeReceipt({ ...home, nativeIoVerified: true }, full.sourceSha, "android"),
  ).toThrow();
  expect(() => verifyRuntimeHomeReceipt(home, full.sourceSha, "ios")).toThrow();
});
test("binary reuse permits JS-only changes and rejects any native input drift before creating a device", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "baro-ios-inputs-"));
  async function git(args: string[]) {
    const child = Bun.spawn(["git", ...args], { cwd: directory, stdout: "pipe", stderr: "ignore" });
    const output = await new Response(child.stdout).text();
    if (await child.exited) throw new Error("SYNTHETIC_GIT_FAILED");
    return output.trim();
  }
  async function commit() {
    await git(["add", "."]);
    await git([
      "-c",
      "user.name=BARO synthetic fixture",
      "-c",
      "user.email=synthetic@baro.invalid",
      "commit",
      "-m",
      "synthetic fixture",
    ]);
    return git(["rev-parse", "HEAD"]);
  }
  try {
    await git(["init"]);
    await mkdir(resolve(directory, "apps/mobile/modules"), { recursive: true });
    await mkdir(resolve(directory, "apps/mobile/src"), { recursive: true });
    await writeFile(resolve(directory, "apps/mobile/modules/native.swift"), "native-v1");
    await writeFile(resolve(directory, "apps/mobile/src/view.ts"), "js-v1");
    const binary = await commit();
    await writeFile(resolve(directory, "apps/mobile/src/view.ts"), "js-v2");
    const js = await commit();
    await expect(assertIosNativeInputs(directory, binary, js)).resolves.toBeUndefined();
    await writeFile(resolve(directory, "apps/mobile/modules/native.swift"), "native-v2");
    const native = await commit();
    await expect(assertIosNativeInputs(directory, binary, native)).rejects.toThrow(
      "IOS_HOST_NATIVE_INPUTS_DIFFER",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("pinned input byte attestation rejects modified archives without installing anything", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "baro-ios-bytes-")),
    input = resolve(directory, "input");
  try {
    await mkdir(resolve(directory, "tests/fixtures"), { recursive: true });
    await mkdir(input);
    const manifest = await Bun.file("tests/fixtures/ios-host-binary.json").json(),
      receipt = await Bun.file("docs/quality/mobile-runtime-2026-10-23/preview-ios.json").json(),
      body = new Uint8Array([1, 2, 3, 4]);
    manifest.zipBytes = body.length;
    manifest.zipSha256 = createHash("sha256").update(body).digest("hex");
    receipt.sourceSha = manifest.sourceSha;
    receipt.artifact = {
      name: manifest.zipName,
      bytes: manifest.zipBytes,
      sha256: manifest.zipSha256,
    };
    manifest.receiptSha256 = createHash("sha256").update(JSON.stringify(receipt)).digest("hex");
    await writeFile(
      resolve(directory, "tests/fixtures/ios-host-binary.json"),
      JSON.stringify(manifest),
    );
    await writeFile(resolve(input, "receipt-ios.json"), JSON.stringify(receipt));
    await writeFile(resolve(input, manifest.zipName), body);
    expect((await verifyIosHostBinary(directory, input)).manifest.zipBytes).toBe(4);
    await writeFile(resolve(input, manifest.zipName), new Uint8Array([1, 2, 3, 5]));
    await expect(verifyIosHostBinary(directory, input)).rejects.toThrow(
      "IOS_HOST_BINARY_BYTES_CHANGED",
    );
    await writeFile(resolve(input, manifest.zipName), body);
    await writeFile(resolve(input, "receipt-ios.json"), JSON.stringify(receipt) + " ");
    await expect(verifyIosHostBinary(directory, input)).rejects.toThrow(
      "IOS_HOST_RECEIPT_BYTES_CHANGED",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Xcode signing control stays in a fresh preview CI context without accounts, profiles or broader entitlements", () => {
  const input = {
    GITHUB_ACTIONS: "true",
    EXPO_PUBLIC_APP_ENV: "preview",
    EXPO_PUBLIC_API_URL: "https://preview.baro.site",
    TARGET_SHA: "a".repeat(40),
    PATH: "/synthetic/bin",
    GEM_HOME: "/synthetic/gems",
    APPLE_ID: "synthetic-private",
    GITHUB_TOKEN: "synthetic-private",
    DEVELOPMENT_TEAM: "synthetic-private",
    NODE_OPTIONS: "--require /private/synthetic",
  };
  const env = xcodeControlEnvironment(input);
  expect(env).toMatchObject({
    TARGET_SHA: "a".repeat(40),
    EXPO_PUBLIC_APP_ENV: "preview",
    GEM_HOME: "/synthetic/gems",
    EXPO_NO_DOTENV: "1",
  });
  expect(JSON.stringify(env)).not.toContain("synthetic-private");
  expect(JSON.stringify(env)).not.toContain("/private/synthetic");
  for (const change of [
    { GITHUB_ACTIONS: "false" },
    { EXPO_PUBLIC_APP_ENV: "production" },
    { EXPO_PUBLIC_API_URL: "http://127.0.0.1:8765" },
    { TARGET_SHA: "main" },
  ])
    expect(() => xcodeControlEnvironment({ ...input, ...change })).toThrow();
  expect(xcodeSimulatorControlArguments).toContain("CODE_SIGN_IDENTITY=-");
  expect(xcodeSimulatorControlArguments).toContain("DEVELOPMENT_TEAM=");
  expect(xcodeSimulatorControlArguments).toContain("PROVISIONING_PROFILE_SPECIFIER=");
  expect(xcodeSimulatorControlArguments.join(" ")).not.toContain("allowProvisioningUpdates");
  expect(xcodeSimulatorControlArguments.join(" ")).not.toContain("FAKETEAMID");
  const own = {
    "keychain-access-groups": ["FAKETEAMID.site.baro.app.preview"] as [
      "FAKETEAMID.site.baro.app.preview",
    ],
    "application-identifier": "FAKETEAMID.site.baro.app.preview" as const,
  };
  expect(xcodeControlEntitlements(own)).toEqual(own);
  for (const invalid of [
    { ...own, "com.apple.developer.team-identifier": "synthetic-team" },
    { ...own, "keychain-access-groups": ["*"] },
    { ...own, "keychain-access-groups": ["site.baro.app.preview", "site.baro.app.dev"] },
    { ...own, "application-identifier": "synthetic-team.site.baro.app.preview" },
    { ...own, "keychain-access-groups": ["FAKETEAMID.site.baro.app.dev"] },
  ])
    expect(() => xcodeControlEntitlements(invalid)).toThrow("XCODE_CONTROL_ENTITLEMENTS_MISMATCH");
});
test("simulated rights never become host signature privileges or authorize a non-Simulator binary", () => {
  expect(xcodeHostSignatureEntitlementsSchema.parse({})).toEqual({});
  expect(() =>
    xcodeHostSignatureEntitlementsSchema.parse({
      "keychain-access-groups": ["FAKETEAMID.site.baro.app.preview"],
    }),
  ).toThrow();
  expect(() => xcodeControlEntitlements({})).toThrow("XCODE_CONTROL_ENTITLEMENTS_MISMATCH");
  expect(() =>
    verifySimulatorBuildPlatform("cmd LC_BUILD_VERSION\n  platform IOSSIMULATOR\n"),
  ).not.toThrow();
  for (const bad of [
    "platform IOS\n",
    "platform MACOS\n",
    "platform MACCATALYST\n",
    "platform IOSSIMULATOR\nplatform IOS\n",
    "",
  ])
    expect(() => verifySimulatorBuildPlatform(bad)).toThrow(
      "XCODE_CONTROL_MACHO_SIMULATOR_REQUIRED",
    );
});
test("fresh Xcode archive attestation binds source and exact bytes without accepting synthetic data as an installed app", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "baro-xcode-control-bytes-"));
  try {
    const source = "a".repeat(40),
      handoff = resolve(root, ".wrangler/mobile-handoff"),
      build = resolve(root, ".wrangler/mobile-build"),
      bytes = Buffer.from("synthetic-not-an-app-archive");
    await mkdir(handoff, { recursive: true });
    await mkdir(build, { recursive: true });
    const preview = await Bun.file(
      "docs/quality/mobile-runtime-2026-10-23/preview-ios.json",
    ).json();
    preview.sourceSha = source;
    preview.artifact = {
      name: `baro-preview-ios-simulator-${source}.zip`,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    const control = {
      version: 2,
      kind: "xcode-simulator-signing-control",
      sourceSha: source,
      toolingSourceSha: source,
      observedAt: new Date().toISOString(),
      applicationId: "site.baro.app.preview",
      signature: "ad-hoc",
      teamIdentifier: "not set",
      architectures: ["arm64"],
      entitlements: {
        "keychain-access-groups": ["FAKETEAMID.site.baro.app.preview"],
        "application-identifier": "FAKETEAMID.site.baro.app.preview",
      },
      entitlementsSource: "simulator-macho-xml-and-der",
      signatureEntitlements: {},
      sectionHashes: [
        { architecture: "arm64", xmlSha256: "b".repeat(64), derSha256: "c".repeat(64) },
      ],
      executableSha256: "b".repeat(64),
      infoPlistSha256: "c".repeat(64),
      appRuntimeVerified: false,
      physicalDeviceVerified: false,
      storeSigned: false,
      deployed: false,
    };
    await writeFile(resolve(handoff, "receipt-ios.json"), JSON.stringify(preview));
    await writeFile(resolve(handoff, preview.artifact.name), bytes);
    await writeFile(resolve(build, "xcode-control-ios.json"), JSON.stringify(control));
    expect((await verifyXcodeControlBinary(root, source)).manifest.control.appRuntimeVerified).toBe(
      false,
    );
    expect(() =>
      xcodeControlReceiptSchema.parse({ ...control, physicalDeviceVerified: true }),
    ).toThrow();
    await writeFile(
      resolve(handoff, preview.artifact.name),
      Buffer.from("modified-synthetic-archive"),
    );
    await expect(verifyXcodeControlBinary(root, source)).rejects.toThrow(
      "XCODE_CONTROL_ARCHIVE_BYTES_MISMATCH",
    );
    await writeFile(resolve(handoff, preview.artifact.name), bytes);
    await writeFile(
      resolve(build, "xcode-control-ios.json"),
      JSON.stringify({ ...control, sourceSha: "b".repeat(40) }),
    );
    await expect(verifyXcodeControlBinary(root, source)).rejects.toThrow(
      "XCODE_CONTROL_SOURCE_OR_SIGNATURE_MISMATCH",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
