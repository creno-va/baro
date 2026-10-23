import { expect, test } from "bun:test";
import {
  inspectEmbeddedIosBundle,
  verifyInternalIosArtifact,
} from "../scripts/mobile-internal-ios-artifact";
import { internalIosEnvironment } from "../scripts/mobile-internal-ios-build";

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
