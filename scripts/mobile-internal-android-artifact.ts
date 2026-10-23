import { createHash } from "node:crypto";
import { z } from "zod";
import { previewArtifactSchema } from "./mobile-preview-artifact";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
// Public Expo template development certificate; never an upload/store identity.
export const internalAndroidDevelopmentCertificate =
  "fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c";
export const internalAndroidArtifactSchema = previewArtifactSchema.extend({
  kind: z.literal("internal-bundled-preview-app"),
  platform: z.literal("android"),
  nativeConfiguration: z.literal("Release"),
  installTarget: z.literal("android-device-or-emulator"),
  signing: previewArtifactSchema.shape.signing.options[0].extend({
    certificateSha256: z.literal(internalAndroidDevelopmentCertificate),
  }),
  launchableActivity: z.literal("site.baro.app.preview.MainActivity"),
  artifact: z.strictObject({
    name: z.string().regex(/^baro-internal-preview-android-[a-f0-9]{40}\.apk$/),
    bytes: z.number().int().positive(),
    sha256: digest,
  }),
  debuggable: z.literal(false),
  embeddedBundle: z.strictObject({
    path: z.literal("assets/index.android.bundle"),
    format: z.literal("hermes-bytecode"),
    bytes: z.number().int().positive(),
    sha256: digest,
    compiledBytesMatch: z.literal(true),
    productEntry: z.literal("expo-router/entry"),
    productSourceObserved: z.literal(true),
    probeSourceAbsent: z.literal(true),
    sourceMapPackaged: z.literal(false),
    sourceModules: z.number().int().positive(),
  }),
  requiresMetro: z.literal(false),
});
export function verifyInternalAndroidArtifact(value: unknown, sourceSha: string) {
  const result = internalAndroidArtifactSchema.parse(value);
  if (
    result.sourceSha !== sourceSha ||
    result.artifact.name !== `baro-internal-preview-android-${sourceSha}.apk` ||
    result.architectures.some((arch) => !["arm64-v8a", "x86_64"].includes(arch))
  )
    throw new Error("INTERNAL_ANDROID_ARTIFACT_IDENTITY_MISMATCH");
  return result;
}
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export function inspectEmbeddedAndroidBundle(
  compiled: Uint8Array,
  packaged: Uint8Array,
  sourceMap: unknown,
  archivePaths: string[],
) {
  const sources = z.object({ sources: z.array(z.string()).min(1) }).parse(sourceMap).sources;
  if (
    compiled.byteLength < 32 ||
    Buffer.from(compiled.subarray(0, 8)).toString("hex") !== "c61fbc03c103191f" ||
    compiled.byteLength !== packaged.byteLength ||
    sha256(compiled) !== sha256(packaged)
  )
    throw new Error("INTERNAL_ANDROID_BUNDLE_BYTES_MISMATCH");
  if (
    !sources.some((path) => /(?:^|\/)src\/app\/index\.tsx$/.test(path)) ||
    sources.some((path) => /(?:^|\/)runtime-probe\//.test(path)) ||
    archivePaths.some((path) => /\.map$/i.test(path))
  )
    throw new Error("INTERNAL_ANDROID_PRODUCT_GRAPH_REQUIRED");
  return {
    path: "assets/index.android.bundle" as const,
    format: "hermes-bytecode" as const,
    bytes: packaged.byteLength,
    sha256: sha256(packaged),
    compiledBytesMatch: true as const,
    productEntry: "expo-router/entry" as const,
    productSourceObserved: true as const,
    probeSourceAbsent: true as const,
    sourceMapPackaged: false as const,
    sourceModules: sources.length,
  };
}
