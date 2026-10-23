import { expect, test } from "bun:test";
import {
  observePreviewApi,
  parseAndroidBadging,
  previewArtifactSchema,
  simulatorSignature,
  verifyPreviewArtifact,
} from "../scripts/mobile-preview-artifact";

const sourceSha = "a".repeat(40);
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
  signing: { kind: "android-debug", certificateSha256: "1".repeat(64) },
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
