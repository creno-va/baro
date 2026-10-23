import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { verifyArchivedAndroidFont } from "./mobile-android-font";
import { androidBuildTools, runAndroidSignatureProbe } from "./mobile-android-signature";
import {
  internalAndroidDevelopmentCertificate,
  verifyInternalAndroidArtifact,
} from "./mobile-internal-android-artifact";
import { internalAndroidEnvironment } from "./mobile-internal-android-build";
import { internalAndroidVerificationFailure } from "./mobile-internal-android-inspection";
import { observePreviewApi, parseAndroidPackage } from "./mobile-preview-artifact";

const sha = z.string().regex(/^[a-f0-9]{40}$/),
  digest = z.string().regex(/^[a-f0-9]{64}$/),
  file = z.strictObject({ name: z.string(), bytes: z.number().int().positive(), sha256: digest });
export const androidInspectionInputSchema = z.strictObject({
  version: z.literal(1),
  sourceSha: sha,
  workflowRunId: z.string().regex(/^\d+$/),
  artifactId: z.string().regex(/^\d+$/),
  artifactName: z.string().regex(/^mobile-internal-android-failure-[a-f0-9]{40}$/),
  inspectionSha256: digest,
});
export const androidReverificationSchema = z
  .strictObject({
    version: z.literal(1),
    kind: z.literal("reverified-preserved-android-binary"),
    toolingSourceSha: sha,
    binarySourceSha: sha,
    input: androidInspectionInputSchema,
    observedAt: z.iso.datetime(),
    originalInspectionAccepted: z.literal(false),
    bundledInputParityVerified: z.literal(true),
    retainedGeneratedBundleCompared: z.literal(true),
    sdkBinaryMetadataVerified: z.literal(true),
    appRuntimeVerified: z.literal(false),
    remoteApiVerified: z.literal(false),
    physicalDeviceVerified: z.literal(false),
    storeSigned: z.literal(false),
    deployed: z.literal(false),
  })
  .refine((v) => v.binarySourceSha === v.input.sourceSha);
export const preservedAndroidInspectionSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("unaccepted-android-inspection"),
  sourceSha: sha,
  observedAt: z.iso.datetime(),
  apk: file.extend({ name: z.string().regex(/^compiled-android-[a-f0-9]{40}\.apk$/) }),
  generatedBundle: file.extend({
    name: z.literal("generated-index.android.bundle"),
    relativePath: z
      .string()
      .regex(
        /^generated\/assets\/(?:react\/release|createBundleReleaseJsAndAssets)\/index\.android\.bundle$/,
      ),
  }),
  graph: z.strictObject({
    sourceMapSha256: digest,
    sourceModules: z.number().int().positive(),
    productHomeSourceObserved: z.literal(true),
    probeSourceAbsent: z.literal(true),
  }),
  fontDeclaration: file.extend({ name: z.literal("font-faces.xml") }),
  accepted: z.literal(false),
  binaryMetadataVerified: z.literal(false),
  appRuntimeVerified: z.literal(false),
  remoteApiVerified: z.literal(false),
  physicalDeviceVerified: z.literal(false),
  storeSigned: z.literal(false),
  deployed: z.literal(false),
});
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
export async function verifyPinnedAndroidInspection(root: string, input: string) {
  const manifest = androidInspectionInputSchema.parse(
    JSON.parse(
      await readFile(resolve(root, "tests/fixtures/android-internal-inspection.json"), "utf8"),
    ),
  );
  if (manifest.artifactName !== `mobile-internal-android-failure-${manifest.sourceSha}`)
    throw new Error("INTERNAL_ANDROID_PIN_IDENTITY_MISMATCH");
  const directory = resolve(input, "inspection"),
    raw = await readFile(resolve(directory, "inspection.json"));
  if (hash(raw) !== manifest.inspectionSha256)
    throw new Error("INTERNAL_ANDROID_INSPECTION_BYTES_CHANGED");
  const report = preservedAndroidInspectionSchema.parse(JSON.parse(raw.toString()));
  if (
    report.sourceSha !== manifest.sourceSha ||
    report.apk.name !== `compiled-android-${manifest.sourceSha}.apk`
  )
    throw new Error("INTERNAL_ANDROID_PIN_IDENTITY_MISMATCH");
  for (const file of [report.apk, report.generatedBundle, report.fontDeclaration]) {
    const body = await readFile(resolve(directory, file.name));
    if (body.byteLength !== file.bytes || hash(body) !== file.sha256)
      throw new Error("INTERNAL_ANDROID_INSPECTION_FILE_CHANGED");
  }
  return { manifest, report, apk: resolve(directory, report.apk.name), directory };
}
export function inspectPreservedAndroidBundle(
  compiled: Uint8Array,
  packaged: Uint8Array,
  graph: z.infer<typeof preservedAndroidInspectionSchema>["graph"],
  paths: string[],
) {
  preservedAndroidInspectionSchema.shape.graph.parse(graph);
  if (
    compiled.byteLength < 32 ||
    Buffer.from(compiled.subarray(0, 8)).toString("hex") !== "c61fbc03c103191f" ||
    compiled.byteLength !== packaged.byteLength ||
    hash(compiled) !== hash(packaged)
  )
    throw new Error("INTERNAL_ANDROID_BUNDLE_BYTES_MISMATCH");
  if (paths.some((p) => /\.map$/i.test(p)))
    throw new Error("INTERNAL_ANDROID_PRODUCT_GRAPH_REQUIRED");
  return {
    path: "assets/index.android.bundle" as const,
    format: "hermes-bytecode" as const,
    bytes: packaged.byteLength,
    sha256: hash(packaged),
    compiledBytesMatch: true as const,
    productEntry: "expo-router/entry" as const,
    productSourceObserved: true as const,
    probeSourceAbsent: true as const,
    sourceMapPackaged: false as const,
    sourceModules: graph.sourceModules,
  };
}
export const androidBundledInputPaths = [
  "apps/mobile",
  ":(exclude)apps/mobile/README.md",
  "src/contracts",
  "packages",
  "package.json",
  "bun.lock",
  "patches",
  ".bun-version",
];
async function main() {
  const root = process.cwd(),
    toolingSha = sha.parse(process.env.TARGET_SHA),
    out = resolve(root, ".wrangler/mobile-internal-android-reverified"),
    env = internalAndroidEnvironment(process.env),
    sdk = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
  if (!sdk || process.env.GITHUB_ACTIONS !== "true")
    throw new Error("INTERNAL_ANDROID_FRESH_SDK_CI_REQUIRED");
  for (const path of ["receipt-android.json", "verification.json", "failure.json"])
    if (await Bun.file(resolve(out, path)).exists())
      throw new Error("INTERNAL_ANDROID_FRESH_OUTPUT_REQUIRED");
  await mkdir(out, { recursive: true });
  let phase = "source";
  async function command(args: string[]) {
    const child = Bun.spawn(args, { cwd: root, env, stdout: "pipe", stderr: "pipe" }),
      timer = setTimeout(() => child.kill(), 120000);
    try {
      const [body] = await Promise.all([
        new Response(child.stdout).arrayBuffer(),
        new Response(child.stderr).arrayBuffer(),
      ]);
      if (await child.exited) throw new Error("INTERNAL_ANDROID_TOOL_FAILED");
      return new Uint8Array(body);
    } finally {
      clearTimeout(timer);
    }
  }
  const text = async (args: string[]) => new TextDecoder().decode(await command(args));
  try {
    if ((await text(["git", "rev-parse", "HEAD"])).trim() !== toolingSha)
      throw new Error("INTERNAL_ANDROID_CHECKOUT_MISMATCH");
    await command(["git", "diff", "--quiet", "HEAD"]);
    phase = "pinned-input";
    const pin = await verifyPinnedAndroidInspection(
      root,
      resolve(root, ".wrangler/android-inspection-input"),
    );
    phase = "bundled-input-parity";
    await command([
      "git",
      "diff",
      "--exit-code",
      pin.manifest.sourceSha,
      toolingSha,
      "--",
      ...androidBundledInputPaths,
    ]);
    const tools = await androidBuildTools(sdk),
      manifest = JSON.parse(await readFile(resolve(root, "apps/mobile/package.json"), "utf8"));
    phase = "apk-metadata";
    const badging = await text([resolve(tools.path, "aapt"), "dump", "badging", pin.apk]),
      metadata = parseAndroidPackage(badging),
      activity = badging.match(/^launchable-activity: name='([^']+)'/m)?.[1];
    phase = "apk-signature";
    await runAndroidSignatureProbe(root, tools.path, text);
    const certificate = await runAndroidSignatureProbe(root, tools.path, text, pin.apk);
    if (certificate !== internalAndroidDevelopmentCertificate)
      throw new Error("INTERNAL_ANDROID_TEMPLATE_CERTIFICATE_REQUIRED");
    phase = "retained-generated-vs-packaged-bundle";
    const packaged = await command(["unzip", "-p", pin.apk, "assets/index.android.bundle"]),
      compiled = await readFile(resolve(pin.directory, pin.report.generatedBundle.name)),
      paths = (await text(["unzip", "-Z1", pin.apk])).split(/\r?\n/),
      bundle = inspectPreservedAndroidBundle(compiled, packaged, pin.report.graph, paths);
    phase = "compiled-resource-font";
    const font = await verifyArchivedAndroidFont(root, pin.apk, resolve(tools.path, "aapt2")),
      name = `baro-internal-preview-android-${pin.manifest.sourceSha}.apk`;
    phase = "strict-final-receipt";
    const receipt = verifyInternalAndroidArtifact(
      {
        version: 1,
        kind: "internal-bundled-preview-app",
        sourceSha: pin.manifest.sourceSha,
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
        artifact: { ...pin.report.apk, name },
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
      pin.manifest.sourceSha,
    );
    if (receipt.versionName !== manifest.version)
      throw new Error("INTERNAL_ANDROID_NATIVE_VERSION_DRIFT");
    await copyFile(pin.apk, resolve(out, name));
    await writeFile(resolve(out, "receipt-android.json"), `${JSON.stringify(receipt, null, 2)}\n`, {
      flag: "wx",
    });
    await writeFile(
      resolve(out, "verification.json"),
      `${JSON.stringify(
        androidReverificationSchema.parse({
          version: 1,
          kind: "reverified-preserved-android-binary",
          toolingSourceSha: toolingSha,
          binarySourceSha: pin.manifest.sourceSha,
          input: pin.manifest,
          observedAt: new Date().toISOString(),
          originalInspectionAccepted: false,
          bundledInputParityVerified: true,
          retainedGeneratedBundleCompared: true,
          sdkBinaryMetadataVerified: true,
          appRuntimeVerified: false,
          remoteApiVerified: false,
          physicalDeviceVerified: false,
          storeSigned: false,
          deployed: false,
        }),
        null,
        2,
      )}\n`,
      { flag: "wx" },
    );
    console.log("PINNED_ANDROID_BINARY_REVERIFIED_RUNTIME_UNVERIFIED");
  } catch (error) {
    await writeFile(
      resolve(out, "failure.json"),
      `${JSON.stringify({ toolingSourceSha: toolingSha, phase, ...internalAndroidVerificationFailure(error), appRuntimeVerified: false, physicalDeviceVerified: false, storeSigned: false, deployed: false }, null, 2)}\n`,
      { flag: "wx" },
    );
    throw new Error("INTERNAL_ANDROID_REVERIFICATION_FAILED");
  }
}
if (import.meta.main)
  await main().catch(() => {
    console.error("INTERNAL_ANDROID_REVERIFICATION_FAILED");
    process.exitCode = 1;
  });
