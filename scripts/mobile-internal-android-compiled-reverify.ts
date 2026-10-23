import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  androidCompiledInputSchema,
  verifyCompiledAndroidBundle,
  verifyPinnedCompiledAndroidInput,
} from "./mobile-android-compiled-input";
import { verifyArchivedAndroidFont } from "./mobile-android-font";
import { androidBuildTools, runAndroidSignatureProbe } from "./mobile-android-signature";
import { internalAndroidDevelopmentCertificate } from "./mobile-internal-android-artifact";
import { internalAndroidEnvironment } from "./mobile-internal-android-build";
import { androidBundledInputPaths } from "./mobile-internal-android-reverify";
import {
  observePreviewApi,
  parseAndroidPackage,
  previewArtifactSchema,
} from "./mobile-preview-artifact";

const source = z.string().regex(/^[a-f0-9]{40}$/);
export const androidCompiledReverificationSchema = z
  .strictObject({
    version: z.literal(1),
    kind: z.literal("reverified-compiled-android-binary"),
    toolingSourceSha: source,
    binarySourceSha: source,
    input: androidCompiledInputSchema,
    observedAt: z.iso.datetime(),
    originalReceiptUnchanged: z.literal(true),
    bundledInputParityVerified: z.literal(true),
    sdkBinaryMetadataVerified: z.literal(true),
    compiledHbcBytesVerified: z.literal(true),
    graphFromPinnedCompilerReceipt: z.literal(true),
    sourceMapRebuilt: z.literal(false),
    retainedGeneratedBundleCompared: z.literal(false),
    sdkBuildToolsVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    actualCertificateSha256: z.literal(internalAndroidDevelopmentCertificate),
    recompiled: z.literal(false),
    resigned: z.literal(false),
    apiObservation: previewArtifactSchema.shape.apiObservation,
    appRuntimeVerified: z.literal(false),
    remoteApiVerified: z.literal(false),
    physicalDeviceVerified: z.literal(false),
    storeSigned: z.literal(false),
    deployed: z.literal(false),
  })
  .refine((value) => value.binarySourceSha === value.input.sourceSha);
const hash = (body: Uint8Array) => createHash("sha256").update(body).digest("hex");
async function main() {
  const root = process.cwd(),
    tooling = source.parse(process.env.TARGET_SHA),
    env = internalAndroidEnvironment(process.env),
    sdk = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT,
    out = resolve(root, ".wrangler/mobile-internal-android-reverified");
  if (!sdk || process.env.GITHUB_ACTIONS !== "true")
    throw Error("COMPILED_ANDROID_FRESH_SDK_CI_REQUIRED");
  for (const name of ["receipt-android.json", "verification.json", "failure.json"])
    if (await Bun.file(resolve(out, name)).exists())
      throw Error("COMPILED_ANDROID_FRESH_OUTPUT_REQUIRED");
  await mkdir(out, { recursive: true });
  let phase = "source";
  async function bytes(args: string[]) {
    const child = Bun.spawn(args, { cwd: root, env, stdout: "pipe", stderr: "pipe" });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 120000);
    try {
      const [body] = await Promise.all([
        new Response(child.stdout).arrayBuffer(),
        new Response(child.stderr).arrayBuffer(),
      ]);
      if ((await child.exited) || timedOut) throw Error("COMPILED_ANDROID_SDK_COMMAND_FAILED");
      return new Uint8Array(body);
    } finally {
      clearTimeout(timer);
    }
  }
  const text = async (args: string[]) => new TextDecoder().decode(await bytes(args));
  try {
    if ((await text(["git", "rev-parse", "HEAD"])).trim() !== tooling)
      throw Error("COMPILED_ANDROID_SOURCE_MISMATCH");
    await bytes(["git", "diff", "--quiet", "HEAD"]);
    await bytes(["git", "merge-base", "--is-ancestor", tooling, "origin/main"]);
    phase = "pinned-original-input";
    const input = await verifyPinnedCompiledAndroidInput(
      root,
      resolve(root, ".wrangler/android-compiled-input"),
    );
    phase = "bundled-input-parity";
    await bytes([
      "git",
      "diff",
      "--quiet",
      input.pin.sourceSha,
      tooling,
      "--",
      ...androidBundledInputPaths,
    ]);
    const tools = await androidBuildTools(sdk);
    phase = "actual-sdk-signature";
    await runAndroidSignatureProbe(root, tools.path, text);
    const certificate = await runAndroidSignatureProbe(root, tools.path, text, input.apk);
    if (
      certificate !== internalAndroidDevelopmentCertificate ||
      certificate !== input.receipt.signing.certificateSha256
    )
      throw Error("COMPILED_ANDROID_CERTIFICATE_MISMATCH");
    phase = "actual-sdk-metadata";
    const badging = await text([resolve(tools.path, "aapt"), "dump", "badging", input.apk]),
      metadata = parseAndroidPackage(badging),
      activity = badging.match(/^launchable-activity: name='([^']+)'/m)?.[1];
    if (
      metadata.applicationId !== input.receipt.applicationId ||
      metadata.versionName !== input.receipt.versionName ||
      metadata.buildVersion !== input.receipt.buildVersion ||
      metadata.minimumOS !== input.receipt.minimumOS ||
      metadata.debuggable !== input.receipt.debuggable ||
      activity !== input.receipt.launchableActivity ||
      JSON.stringify([...metadata.architectures].sort()) !==
        JSON.stringify([...input.receipt.architectures].sort())
    )
      throw Error("COMPILED_ANDROID_METADATA_MISMATCH");
    phase = "packaged-hbc-bytes";
    const bundle = await bytes(["unzip", "-p", input.apk, "assets/index.android.bundle"]),
      paths = (await text(["unzip", "-Z1", input.apk])).split(/\r?\n/);
    verifyCompiledAndroidBundle(bundle, input.receipt.embeddedBundle, paths);
    phase = "compiled-font";
    const font = await verifyArchivedAndroidFont(root, input.apk, resolve(tools.path, "aapt2"));
    if (JSON.stringify(font) !== JSON.stringify(input.receipt.compiledFont))
      throw Error("COMPILED_ANDROID_FONT_MISMATCH");
    phase = "preserve-original-receipt";
    await writeFile(resolve(out, "receipt-android.json"), input.raw, { flag: "wx" });
    await copyFile(input.apk, resolve(out, input.receipt.artifact.name));
    if (
      hash(await readFile(resolve(out, input.receipt.artifact.name))) !==
      input.receipt.artifact.sha256
    )
      throw Error("COMPILED_ANDROID_APK_CHANGED");
    const verification = androidCompiledReverificationSchema.parse({
      version: 1,
      kind: "reverified-compiled-android-binary",
      toolingSourceSha: tooling,
      binarySourceSha: input.pin.sourceSha,
      input: input.pin,
      observedAt: new Date().toISOString(),
      originalReceiptUnchanged: true,
      bundledInputParityVerified: true,
      sdkBinaryMetadataVerified: true,
      compiledHbcBytesVerified: true,
      graphFromPinnedCompilerReceipt: true,
      sourceMapRebuilt: false,
      retainedGeneratedBundleCompared: false,
      sdkBuildToolsVersion: tools.version,
      actualCertificateSha256: certificate,
      recompiled: false,
      resigned: false,
      apiObservation: await observePreviewApi(),
      appRuntimeVerified: false,
      remoteApiVerified: false,
      physicalDeviceVerified: false,
      storeSigned: false,
      deployed: false,
    });
    await writeFile(
      resolve(out, "verification.json"),
      `${JSON.stringify(verification, null, 2)}\n`,
      { flag: "wx" },
    );
    console.log("ORIGINAL_COMPILED_ANDROID_BINARY_REVERIFIED_RUNTIME_PENDING");
  } catch (error) {
    const known = new Set([
        "COMPILED_ANDROID_SOURCE_MISMATCH",
        "COMPILED_ANDROID_PIN_IDENTITY_MISMATCH",
        "COMPILED_ANDROID_RECEIPT_CHANGED",
        "COMPILED_ANDROID_APK_CHANGED",
        "COMPILED_ANDROID_SDK_COMMAND_FAILED",
        "COMPILED_ANDROID_CERTIFICATE_MISMATCH",
        "COMPILED_ANDROID_METADATA_MISMATCH",
        "COMPILED_ANDROID_HBC_MISMATCH",
        "COMPILED_ANDROID_FONT_MISMATCH",
      ]),
      code = error instanceof Error ? error.message : "";
    await writeFile(
      resolve(out, "failure.json"),
      `${JSON.stringify({ toolingSourceSha: tooling, phase, code: known.has(code) ? code : "COMPILED_ANDROID_REVERIFICATION_FAILED", appRuntimeVerified: false, remoteApiVerified: false, physicalDeviceVerified: false, storeSigned: false, deployed: false }, null, 2)}\n`,
      { flag: "wx" },
    );
    throw Error("COMPILED_ANDROID_REVERIFICATION_FAILED");
  }
}
if (import.meta.main)
  await main().catch(() => {
    console.error("COMPILED_ANDROID_REVERIFICATION_FAILED");
    process.exitCode = 1;
  });
