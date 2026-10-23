import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import {
  androidCertificateDigest,
  runAndroidSignatureProbe,
} from "../scripts/mobile-android-signature";
import {
  inspectEmbeddedAndroidBundle,
  internalAndroidDevelopmentCertificate,
  verifyInternalAndroidArtifact,
} from "../scripts/mobile-internal-android-artifact";
import {
  internalAndroidEnvironment,
  internalAndroidFailureCategory,
} from "../scripts/mobile-internal-android-build";
import {
  generatedAndroidReleaseFiles,
  internalAndroidVerificationFailure,
  preserveCompiledAndroidInspection,
} from "../scripts/mobile-internal-android-inspection";
import {
  inspectEmbeddedIosBundle,
  verifyInternalIosArtifact,
} from "../scripts/mobile-internal-ios-artifact";
import { internalIosEnvironment } from "../scripts/mobile-internal-ios-build";
import {
  assertIosBundledInputs,
  verifyIosColdLaunchReceipt,
  verifyPinnedInternalIosInput,
} from "../scripts/mobile-internal-ios-input";
import {
  observePreviewApi,
  parseAndroidBadging,
  parseAndroidPackage,
  previewArtifactSchema,
  simulatorSignature,
  verifyPreviewArtifact,
} from "../scripts/mobile-preview-artifact";

const sourceSha = "a".repeat(40);
test("pinned iOS input integrity rejects changed compiler receipts and archives before any SDK action", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "baro-ios-pin-test-")),
    input = resolve(root, "input"),
    body = Buffer.from([1, 2, 3, 4]);
  const hash = (b: Uint8Array | string) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
  try {
    await mkdir(resolve(root, "tests/fixtures"), { recursive: true });
    await mkdir(input);
    const original = await Bun.file(
      "docs/quality/mobile-internal-ios-2026-10-23/receipt-ff5c208.json",
    ).json();
    const name = `baro-internal-preview-ios-simulator-${sourceSha}.zip`,
      receipt = {
        ...original,
        sourceSha,
        control: { ...original.control, sourceSha, toolingSourceSha: sourceSha },
        artifact: { name, bytes: body.length, sha256: hash(body) },
      },
      raw = JSON.stringify(receipt),
      pin = {
        version: 1,
        sourceSha,
        workflowRunId: "123456789",
        artifactId: "123456789",
        artifactName: `mobile-internal-ios-${sourceSha}`,
        receiptSha256: hash(raw),
      };
    await writeFile(resolve(root, "tests/fixtures/ios-internal-preview.json"), JSON.stringify(pin));
    await writeFile(resolve(input, "receipt-ios.json"), raw);
    await writeFile(resolve(input, name), body);
    expect((await verifyPinnedInternalIosInput(root, input)).receipt.sourceSha).toBe(sourceSha);
    await writeFile(resolve(input, name), Buffer.from([1, 2, 3, 5]));
    await expect(verifyPinnedInternalIosInput(root, input)).rejects.toThrow(
      "INTERNAL_IOS_ARCHIVE_CHANGED",
    );
    await writeFile(resolve(input, name), body);
    await writeFile(resolve(input, "receipt-ios.json"), `${raw} `);
    await expect(verifyPinnedInternalIosInput(root, input)).rejects.toThrow(
      "INTERNAL_IOS_RECEIPT_CHANGED",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("bundled iOS reuse allows documentation changes but rejects JS drift as well as native drift", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "baro-ios-bundled-inputs-"));
  async function git(args: string[]) {
    const c = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "ignore" }),
      out = await new Response(c.stdout).text();
    if (await c.exited) throw Error("SYNTHETIC_GIT_FAILED");
    return out.trim();
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
    await mkdir(resolve(root, "apps/mobile/src"), { recursive: true });
    await writeFile(resolve(root, "apps/mobile/src/index.ts"), "v1");
    await writeFile(resolve(root, "apps/mobile/README.md"), "fixture");
    const binary = await commit();
    await writeFile(resolve(root, "apps/mobile/README.md"), "documentation");
    const docs = await commit();
    await expect(assertIosBundledInputs(root, binary, docs)).resolves.toBeUndefined();
    await writeFile(resolve(root, "apps/mobile/src/index.ts"), "v2");
    const changed = await commit();
    await expect(assertIosBundledInputs(root, binary, changed)).rejects.toThrow(
      "INTERNAL_IOS_BUNDLED_INPUTS_CHANGED",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("iOS cold-launch observations bind the compiler archive and cannot claim Home, continuity or full runtime acceptance", () => {
  const identity = { archiveSha256: "c".repeat(64), compilerReceiptSha256: "d".repeat(64) },
    tooling = "b".repeat(40);
  const value = {
    version: 1,
    kind: "ios-bundled-cold-launch-observation",
    binarySourceSha: sourceSha,
    toolingSourceSha: tooling,
    observedAt: "2026-10-24T00:00:00.000Z",
    applicationId: "site.baro.app.preview",
    nativeConfiguration: "Release",
    requiresMetro: false,
    ...identity,
    device: { kind: "simulator", model: "synthetic iPhone", osVersion: "26.5" },
    coldLaunches: [
      { ordinal: 1, elapsedSeconds: 15, samePidReadbackSamples: 3 },
      { ordinal: 2, elapsedSeconds: 15, samePidReadbackSamples: 3 },
    ],
    nativeProcessLaunchVerified: true,
    distinctColdLaunchPids: true,
    wholeIntervalContinuityProven: false,
    metroStarted: false,
    metroGuardRequests: 0,
    anonymousFreshInstall: true,
    publicDataNavigation: false,
    screenshot: { name: "home-ios.png", bytes: 100, sha256: "e".repeat(64) },
    homeContentVerified: false,
    visualReviewRequired: true,
    productJourneysVerified: false,
    accessibilityVerified: false,
    httpTransportSeparatelyObserved: false,
    remoteApiVerified: false,
    oauthVerified: false,
    physicalDeviceVerified: false,
    storeSigned: false,
    deployed: false,
  };
  expect(verifyIosColdLaunchReceipt(value, sourceSha, tooling, identity).homeContentVerified).toBe(
    false,
  );
  for (const patch of [
    { binarySourceSha: "f".repeat(40) },
    { archiveSha256: "f".repeat(64) },
    { compilerReceiptSha256: "f".repeat(64) },
    { homeContentVerified: true },
    { visualReviewRequired: false },
    { wholeIntervalContinuityProven: true },
    { metroStarted: true },
    { metroGuardRequests: 1 },
    { requiresMetro: true },
    { nativeConfiguration: "Debug" },
    { remoteApiVerified: true },
    { oauthVerified: true },
    { physicalDeviceVerified: true },
    { storeSigned: true },
    { deployed: true },
    {
      coldLaunches: [
        { ordinal: 1, elapsedSeconds: 14, samePidReadbackSamples: 3 },
        { ordinal: 2, elapsedSeconds: 15, samePidReadbackSamples: 3 },
      ],
    },
  ])
    expect(() =>
      verifyIosColdLaunchReceipt({ ...value, ...patch }, sourceSha, tooling, identity),
    ).toThrow();
});
const badging =
  "package: name='site.baro.app.preview' versionCode='1' versionName='0.1.0' platformBuildVersionName='16'\nsdkVersion:'24'\ntargetSdkVersion:'36'\napplication-debuggable\nnative-code: 'arm64-v8a' 'x86_64'\n";
const candidate = () => ({
  version: 1,
  kind: "preview-development-app",
  sourceSha,
  platform: "android",
  environment: "preview",
  apiOrigin: "https://preview.baro.site",
  apiObservation: {
    status: "observed",
    observedAt: new Date().toISOString(),
    sourceSha: "b".repeat(40),
  },
  ...parseAndroidBadging(badging),
  expo: "58.0.17",
  reactNative: "0.88.0",
  installTarget: "android-device-or-emulator",
  signing: {
    kind: "android-debug",
    certificateSha256: "1".repeat(64),
    verifier: "android-sdk-apksig",
    buildTools: "36.1.0",
  },
  artifact: {
    name: `baro-preview-android-${sourceSha}.apk`,
    bytes: 100000000,
    sha256: "2".repeat(64),
  },
  compiledFont: {
    kind: "compiled-resource-only",
    family: "BaroMobile",
    sha256: "3".repeat(64),
    weights: [400, 600, 700],
    glyphs: 14757,
    codepoints: 14336,
    hangul: 11172,
    licenseEmbedded: true,
    compiledBytesMatch: true,
    appRuntimeVerified: false,
  },
  compatibility: "runtime-smoke-required",
  requiresMetro: true,
  binaryMetadataVerified: true,
  appRuntimeVerified: false,
  remoteApiVerified: false,
  physicalDeviceVerified: false,
  storeSigned: false,
  deployed: false,
});
test("structured SDK signature report rejects missing verification and multiple certificate identities", () => {
  const digest = "a1".repeat(32);
  expect(
    androidCertificateDigest({
      version: 1,
      kind: "apk-verified",
      certificateSha256: [digest, digest],
    }),
  ).toBe(digest);
  for (const value of [
    { version: 1, kind: "sdk-api-ready" },
    { version: 1, kind: "apk-fixture-verified-api24", certificateSha256: [digest] },
    { version: 1, kind: "apk-verified", certificateSha256: [] },
    { version: 1, kind: "apk-verified", certificateSha256: [digest, "b2".repeat(32)] },
    `Signer #1 certificate SHA-256 digest: ${digest}`,
  ])
    expect(() => androidCertificateDigest(value)).toThrow();
});
test("SDK preflight cannot substitute for verification of the requested APK", async () => {
  const calls: string[][] = [];
  await runAndroidSignatureProbe("/synthetic project", "/synthetic sdk", async (args) => {
    calls.push(args);
    return JSON.stringify({ version: 1, kind: "sdk-api-ready" });
  });
  expect(calls[0]?.at(-1)).toBe("--self-test");
  await expect(
    runAndroidSignatureProbe(
      "/synthetic project",
      "/synthetic sdk",
      async () => JSON.stringify({ version: 1, kind: "sdk-api-ready" }),
      "/synthetic.apk",
    ),
  ).rejects.toThrow();
  const value = await runAndroidSignatureProbe(
    "/synthetic project",
    "/synthetic sdk",
    async (args) => {
      calls.push(args);
      return JSON.stringify({
        version: 1,
        kind: "apk-verified",
        certificateSha256: ["a1".repeat(32)],
      });
    },
    "/synthetic.apk",
  );
  expect(calls.at(-1)?.at(-1)).toBe("/synthetic.apk");
  expect(value).toBe("a1".repeat(32));
});
test("preview receipt binds exact source, environment, application, actual metadata and artifact identity", () => {
  const receipt = verifyPreviewArtifact(candidate(), sourceSha, "android");
  expect(receipt.apiObservation.status).toBe("observed");
  expect(receipt.compatibility).toBe("runtime-smoke-required");
  expect(() => verifyPreviewArtifact(candidate(), "b".repeat(40), "android")).toThrow();
  expect(() =>
    verifyPreviewArtifact(
      { ...candidate(), applicationId: "site.baro.app.dev" },
      sourceSha,
      "android",
    ),
  ).toThrow();
  expect(() =>
    verifyPreviewArtifact({ ...candidate(), architectures: ["arm64"] }, sourceSha, "android"),
  ).toThrow();
  expect(() =>
    verifyPreviewArtifact(
      {
        ...candidate(),
        artifact: { ...candidate().artifact, name: `baro-preview-android-${"b".repeat(40)}.apk` },
      },
      sourceSha,
      "android",
    ),
  ).toThrow();
  for (const key of [
    "appRuntimeVerified",
    "remoteApiVerified",
    "physicalDeviceVerified",
    "storeSigned",
    "deployed",
  ])
    expect(previewArtifactSchema.safeParse({ ...candidate(), [key]: true }).success).toBe(false);
});
test("actual Android metadata must identify debug state, minimum API, version and shipped ABIs", () => {
  expect(parseAndroidBadging(badging)).toEqual({
    applicationId: "site.baro.app.preview",
    buildVersion: "1",
    versionName: "0.1.0",
    minimumOS: "24",
    architectures: ["arm64-v8a", "x86_64"],
  });
  for (const malformed of [
    badging.replace("application-debuggable", ""),
    badging.replace("sdkVersion:'24'", ""),
    badging.replace("native-code: 'arm64-v8a' 'x86_64'", ""),
  ])
    expect(() => parseAndroidBadging(malformed)).toThrow();
});
test("iOS artifacts stay simulator only and cannot silently adopt a distribution signing identity", () => {
  expect(simulatorSignature(1, "app: code object is not signed at all")).toBe("none");
  expect(simulatorSignature(0, "Signature=adhoc\nTeamIdentifier=not set\n")).toBe("ad-hoc");
  expect(() =>
    simulatorSignature(0, "Authority=Apple Development: Someone\nTeamIdentifier=UNKNOWN\n"),
  ).toThrow();
  expect(() => simulatorSignature(1, "invalid signature")).toThrow();
  const ios = {
    ...candidate(),
    platform: "ios",
    installTarget: "ios-simulator",
    architectures: ["arm64"],
    minimumOS: "16.0",
    signing: { kind: "simulator-only", codeSignature: "ad-hoc" },
    artifact: { ...candidate().artifact, name: `baro-preview-ios-simulator-${sourceSha}.zip` },
  };
  expect(verifyPreviewArtifact(ios, sourceSha, "ios").installTarget).toBe("ios-simulator");
  expect(() =>
    verifyPreviewArtifact(
      { ...ios, installTarget: "android-device-or-emulator" },
      sourceSha,
      "ios",
    ),
  ).toThrow();
});
test("preview health is a timestamped observation and cannot substitute for app/API runtime acceptance", async () => {
  const request = async () =>
    Response.json({
      status: "ok",
      service: "baro",
      environment: "preview",
      release: "c".repeat(40),
    });
  const observed = await observePreviewApi(request);
  expect(observed.status).toBe("observed");
  expect(observed.observedAt).toMatch(/^\d{4}-/);
  for (const response of [
    new Response("unavailable", { status: 503 }),
    Response.json({
      status: "ok",
      service: "baro",
      environment: "production",
      release: "c".repeat(40),
    }),
  ])
    expect((await observePreviewApi(async () => response)).status).toBe("unavailable");
});
test("manual preview build only uploads public development binary and scoped receipts", async () => {
  const workflow = await Bun.file(".github/workflows/mobile-native.yml").text();
  expect(workflow).toMatch(/bun scripts\/mobile-preview-artifact.ts \$\{\{ matrix.platform \}\}/);
  const parsed = Bun.YAML.parse(workflow) as {
    jobs: { native: { steps: { name?: string; with?: { path?: string } }[] } };
  };
  const paths = parsed.jobs.native.steps
    .find((step) => step.name === "Save preview development app for internal testing")
    ?.with?.path?.trim()
    .split("\n");
  expect(paths).toHaveLength(3);
  for (const path of paths ?? [])
    expect(path.trim()).toMatch(
      /^\.wrangler\/mobile-handoff\/(?:baro-preview-\*\.(?:apk|zip)|receipt-\$\{\{ matrix.platform \}\}\.json)$/,
    );
});
test("AOSP signature fixture bytes are pinned, licensed and limited to the separate SDK fixture job", async () => {
  const root = "tests/fixtures/android-signature/",
    manifest = (await Bun.file(`${root}manifest.json`).json()) as {
      sourceCommit: string;
      files: { name: string; bytes: number; sha256: string; valid: boolean }[];
    };
  expect(manifest.sourceCommit).toMatch(/^[a-f0-9]{40}$/);
  expect(manifest.files.map((file) => file.valid)).toEqual([true, false]);
  for (const file of manifest.files) {
    const body = await Bun.file(`${root}${file.name}`).arrayBuffer();
    expect(body.byteLength).toBe(file.bytes);
    expect(new Bun.CryptoHasher("sha256").update(body).digest("hex")).toBe(file.sha256);
  }
  expect(await Bun.file(`${root}LICENSE`).text()).toContain("Apache License");
  const workflow = await Bun.file(".github/workflows/mobile-android-host.yml").text();
  expect(workflow).toContain("github.event.pull_request.head.sha");
  expect(workflow).not.toContain("mobile:native");
  for (const line of workflow.split("\n").filter((line) => line.includes("uses:")))
    expect(line).toMatch(/@[a-f0-9]{40}/);
});

test("bundled internal receipts distinguish configuration, development identity and unverified runtime", () => {
  const release = parseAndroidPackage(badging.replace("application-debuggable\n", ""));
  expect(release.debuggable).toBe(false);
  expect(() => parseAndroidBadging(badging.replace("application-debuggable\n", ""))).toThrow();
  const value = {
    ...candidate(),
    ...release,
    kind: "internal-bundled-preview-app",
    nativeConfiguration: "Release",
    launchableActivity: "site.baro.app.preview.MainActivity",
    requiresMetro: false,
    signing: { ...candidate().signing, certificateSha256: internalAndroidDevelopmentCertificate },
    artifact: { ...candidate().artifact, name: `baro-internal-preview-android-${sourceSha}.apk` },
    embeddedBundle: {
      path: "assets/index.android.bundle",
      format: "hermes-bytecode",
      bytes: 100,
      sha256: "b".repeat(64),
      compiledBytesMatch: true,
      productEntry: "expo-router/entry",
      productSourceObserved: true,
      probeSourceAbsent: true,
      sourceMapPackaged: false,
      sourceModules: 1,
    },
  };
  expect(verifyInternalAndroidArtifact(value, sourceSha)).toMatchObject({
    requiresMetro: false,
    appRuntimeVerified: false,
    storeSigned: false,
  });
  for (const mutation of [
    { requiresMetro: true },
    { debuggable: true },
    { storeSigned: true },
    { appRuntimeVerified: true },
    { applicationId: "site.baro.app" },
    { signing: { ...value.signing, certificateSha256: "1".repeat(64) } },
  ])
    expect(() => verifyInternalAndroidArtifact({ ...value, ...mutation }, sourceSha)).toThrow();
  expect(() => verifyInternalAndroidArtifact(value, "c".repeat(40))).toThrow();
});
test("internal build rejects alternate entry/target and supplies only explicit nonsecret tool environment", () => {
  const input = {
    EXPO_PUBLIC_APP_ENV: "preview",
    EXPO_PUBLIC_API_URL: "https://preview.baro.site",
    PATH: "/synthetic/bin",
    HOME: "/synthetic/home",
    ANDROID_HOME: "/synthetic/sdk",
    JAVA_HOME: "/synthetic/jdk",
    GITHUB_TOKEN: "synthetic-private",
    PRIVATE_KEY: "synthetic-private",
    COOKIE: "synthetic-private",
    EXPO_PUBLIC_NATIVE_PROBE_NONCE: "synthetic-private",
    NODE_OPTIONS: "--require /private/synthetic",
  };
  const result = internalAndroidEnvironment(input);
  expect(result).toMatchObject({
    EXPO_PUBLIC_APP_ENV: "preview",
    EXPO_PUBLIC_API_URL: "https://preview.baro.site",
    ANDROID_HOME: "/synthetic/sdk",
    JAVA_HOME: "/synthetic/jdk",
    EXPO_NO_DOTENV: "1",
  });
  expect(JSON.stringify(result)).not.toContain("synthetic-private");
  expect(result.NODE_OPTIONS).not.toContain("/private/synthetic");
  for (const mutation of [
    { EXPO_PUBLIC_APP_ENV: "production" },
    { EXPO_PUBLIC_API_URL: "http://127.0.0.1:8765" },
    { ENTRY_FILE: "runtime-probe/entry.tsx" },
  ])
    expect(() => internalAndroidEnvironment({ ...input, ...mutation })).toThrow();
  expect(internalAndroidFailureCategory("Unable to resolve module synthetic-private", false)).toBe(
    "METRO_MODULE_NOT_FOUND",
  );
  expect(internalAndroidFailureCategory("synthetic-private", true)).toBe("COMMAND_TIMEOUT");
  expect(internalAndroidFailureCategory("synthetic-private", false)).toBe("UNKNOWN");
});
test("actual SDK-generated Hermes bytes must match the packaged copy and exclude alternate graph or maps", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "baro-internal-hbc-"));
  try {
    const require = createRequire(import.meta.url),
      compilerRoot = dirname(
        require.resolve("hermes-compiler/package.json", {
          paths: [require.resolve("react-native/package.json")],
        }),
      );
    const compiler = resolve(
      compilerRoot,
      "hermesc",
      process.platform === "darwin" ? "osx-bin" : "linux64-bin",
      "hermesc",
    );
    const input = resolve(root, "synthetic.js"),
      output = resolve(root, "synthetic.hbc");
    await writeFile(input, "globalThis.__baro_internal_fixture = true;\n");
    const child = Bun.spawn([compiler, "-emit-binary", "-out", output, input], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await child.exited).toBe(0);
    const bytes = await readFile(output),
      map = { sources: ["src/app/index.tsx"] },
      paths = ["assets/index.android.bundle"];
    expect(inspectEmbeddedAndroidBundle(bytes, bytes, map, paths)).toMatchObject({
      format: "hermes-bytecode",
      compiledBytesMatch: true,
      sourceMapPackaged: false,
    });
    const changed = Buffer.from(bytes);
    changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 1;
    expect(() => inspectEmbeddedAndroidBundle(bytes, changed, map, paths)).toThrow(
      "INTERNAL_ANDROID_BUNDLE_BYTES_MISMATCH",
    );
    expect(() =>
      inspectEmbeddedAndroidBundle(
        bytes,
        bytes,
        { sources: [...map.sources, "runtime-probe/entry.tsx"] },
        paths,
      ),
    ).toThrow("INTERNAL_ANDROID_PRODUCT_GRAPH_REQUIRED");
    expect(() =>
      inspectEmbeddedAndroidBundle(bytes, bytes, map, [
        ...paths,
        "assets/index.android.bundle.map",
      ]),
    ).toThrow("INTERNAL_ANDROID_PRODUCT_GRAPH_REQUIRED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a post-compile verification failure preserves unaccepted bytes and graph facts without private map content", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "baro-compiled-inspection-")),
    mobile = resolve(root, "mobile"),
    build = resolve(mobile, "android/app/build");
  try {
    const files = {
      "outputs/apk/release/app-release.apk": "synthetic-not-a-real-apk",
      "generated/assets/createBundleReleaseJsAndAssets/index.android.bundle":
        "synthetic-not-real-hbc",
      "generated/sourcemaps/react/release/index.android.bundle.map": JSON.stringify({
        sources: ["src/app/index.tsx", "runtime-probe/entry.tsx"],
        sourcesContent: ["synthetic-private-map-content"],
      }),
    };
    for (const [path, body] of Object.entries(files)) {
      await mkdir(dirname(resolve(build, path)), { recursive: true });
      await writeFile(resolve(build, path), body);
    }
    const result = await preserveCompiledAndroidInspection(resolve(root, "out"), mobile, sourceSha);
    expect(result.receipt).toMatchObject({
      kind: "unaccepted-android-inspection",
      accepted: false,
      binaryMetadataVerified: false,
      appRuntimeVerified: false,
      graph: { sourceModules: 2, productHomeSourceObserved: true, probeSourceAbsent: false },
    });
    expect(await readFile(resolve(root, "out/inspection", result.receipt.apk.name), "utf8")).toBe(
      files["outputs/apk/release/app-release.apk"],
    );
    expect(JSON.stringify(result.receipt)).not.toContain("synthetic-private-map-content");
    expect(() => verifyInternalAndroidArtifact(result.receipt, sourceSha)).toThrow();
    expect(result.files.bundle).toBe(
      resolve(build, "generated/assets/createBundleReleaseJsAndAssets/index.android.bundle"),
    );
    await expect(
      preserveCompiledAndroidInspection(resolve(root, "out"), mobile, sourceSha),
    ).rejects.toThrow();
    await mkdir(resolve(build, "generated/assets/react/release"), { recursive: true });
    await writeFile(
      resolve(build, "generated/assets/react/release/index.android.bundle"),
      "second-output",
    );
    await expect(generatedAndroidReleaseFiles(build)).rejects.toThrow(
      "INTERNAL_ANDROID_GENERATED_OUTPUT_AMBIGUOUS",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("post-compile failure export preserves only fixed codes and allowed metadata issue fields", () => {
  const detail = "synthetic-private /private/fixture";
  expect(internalAndroidVerificationFailure(new Error("COMPILED_FONT_READ_FAILED"))).toEqual({
    code: "COMPILED_FONT_READ_FAILED",
    invalidFields: [],
  });
  expect(
    internalAndroidVerificationFailure(Object.assign(new Error(detail), { code: "ENOENT" })),
  ).toEqual({ code: "INTERNAL_ANDROID_FILE_MISSING", invalidFields: [] });
  let error: unknown;
  try {
    verifyInternalAndroidArtifact(
      { ...candidate(), kind: "internal-bundled-preview-app", applicationId: detail },
      sourceSha,
    );
  } catch (value) {
    error = value;
  }
  const exported = internalAndroidVerificationFailure(error);
  expect(exported.invalidFields).toContain("applicationId");
  expect(JSON.stringify(exported)).not.toContain(detail);
  expect(internalAndroidVerificationFailure(new Error("SYNTHETIC_PRIVATE_CAPS")).code).toBe(
    "INTERNAL_ANDROID_BUILD_FAILED",
  );
});

test("internal iOS builds allow only immutable preview CI and exclude user signing and bundle overrides", () => {
  const input = {
    GITHUB_ACTIONS: "true",
    TARGET_SHA: "a".repeat(40),
    EXPO_PUBLIC_APP_ENV: "preview",
    EXPO_PUBLIC_API_URL: "https://preview.baro.site",
    PATH: "/synthetic/bin",
    APPLE_ID: "synthetic-private",
    DEVELOPMENT_TEAM: "synthetic-private",
    GITHUB_TOKEN: "synthetic-private",
    NODE_OPTIONS: "--require /private/synthetic",
  };
  const env = internalIosEnvironment(input);
  expect(env.NODE_ENV).toBe("production");
  expect(env.EXPO_NO_DOTENV).toBe("1");
  expect(JSON.stringify(env)).not.toContain("synthetic-private");
  expect(JSON.stringify(env)).not.toContain("/private/synthetic");
  for (const change of [
    { GITHUB_ACTIONS: "false" },
    { EXPO_PUBLIC_APP_ENV: "production" },
    { EXPO_PUBLIC_API_URL: "http://127.0.0.1:8765" },
    { TARGET_SHA: "main" },
    ...["ENTRY_FILE", "SKIP_BUNDLING", "FORCE_BUNDLING", "SOURCEMAP_FILE"].map((key) => ({
      [key]: "synthetic",
    })),
  ])
    expect(() => internalIosEnvironment({ ...input, ...change })).toThrow();
});
test("iOS archive checks preserve compiled HBC bytes, a separate generated JS digest and the product-only source graph", () => {
  const hbc = new Uint8Array(64);
  hbc.set(Buffer.from("c61fbc03c103191f", "hex"));
  const js = new TextEncoder().encode("synthetic generated JavaScript, never an app or SDK result"),
    map = new TextEncoder().encode(JSON.stringify({ sources: ["/synthetic/src/app/index.tsx"] }));
  const valid = inspectEmbeddedIosBundle(hbc, hbc, js, map, ["BAROPreview.app/main.jsbundle"]);
  expect(valid.archiveBytesMatch).toBe(true);
  expect(valid.sha256).not.toBe(valid.generatedJavascriptSha256);
  const changed = hbc.slice();
  changed[63] = 1;
  expect(() => inspectEmbeddedIosBundle(hbc, changed, js, map, [])).toThrow(
    "INTERNAL_IOS_BUNDLE_BYTES_MISMATCH",
  );
  expect(() => inspectEmbeddedIosBundle(hbc, hbc, hbc, map, [])).toThrow(
    "INTERNAL_IOS_BUNDLE_BYTES_MISMATCH",
  );
  for (const sources of [
    [],
    ["/synthetic/runtime-probe/entry.tsx"],
    ["/synthetic/src/app/index.tsx", "/synthetic/runtime-probe/run.ts"],
  ])
    expect(() =>
      inspectEmbeddedIosBundle(
        hbc,
        hbc,
        js,
        new TextEncoder().encode(JSON.stringify({ sources })),
        [],
      ),
    ).toThrow();
  expect(() =>
    inspectEmbeddedIosBundle(hbc, hbc, js, map, ["BAROPreview.app/private.map"]),
  ).toThrow("INTERNAL_IOS_PRODUCT_GRAPH_REQUIRED");
});
test("internal iOS receipts bind Release Simulator identity and cannot claim runtime, physical or store acceptance", async () => {
  const original = await Bun.file("docs/quality/mobile-runtime-2026-10-23/preview-ios.json").json(),
    control = await Bun.file("docs/quality/mobile-ios-host-2026-10-23/control-238624b.json").json(),
    source = "a".repeat(40);
  const hbc = new Uint8Array(64);
  hbc.set(Buffer.from("c61fbc03c103191f", "hex"));
  const bundle = inspectEmbeddedIosBundle(
    hbc,
    hbc,
    new TextEncoder().encode("synthetic generated javascript longer than 32 bytes"),
    new TextEncoder().encode(JSON.stringify({ sources: ["src/app/index.tsx"] })),
    [],
  );
  const candidate = {
    ...original,
    kind: "internal-bundled-preview-app",
    sourceSha: source,
    nativeConfiguration: "Release",
    signing: { kind: "simulator-only", codeSignature: "ad-hoc" },
    control: { ...control, sourceSha: source, toolingSourceSha: source },
    architectures: control.architectures,
    artifact: { ...original.artifact, name: `baro-internal-preview-ios-simulator-${source}.zip` },
    embeddedBundle: bundle,
    requiresMetro: false,
  };
  expect(verifyInternalIosArtifact(candidate, source).appRuntimeVerified).toBe(false);
  for (const changes of [
    { platform: "android" },
    { installTarget: "android-device-or-emulator" },
    { nativeConfiguration: "Debug" },
    { applicationId: "site.baro.app" },
    { requiresMetro: true },
    { appRuntimeVerified: true },
    { physicalDeviceVerified: true },
    { storeSigned: true },
    { deployed: true },
    { control: { ...candidate.control, sourceSha: "b".repeat(40) } },
    { architectures: ["arm64"] },
    { signing: { kind: "simulator-only", codeSignature: "none" } },
  ])
    expect(() => verifyInternalIosArtifact({ ...candidate, ...changes }, source)).toThrow();
});
