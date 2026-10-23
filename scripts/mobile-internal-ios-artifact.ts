import { createHash } from "node:crypto";
import { z } from "zod";
import { xcodeControlReceiptSchema } from "./mobile-ios-xcode-control";
import { previewArtifactSchema } from "./mobile-preview-artifact";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const internalIosArtifactSchema = previewArtifactSchema.extend({
  kind: z.literal("internal-bundled-preview-app"),
  platform: z.literal("ios"),
  nativeConfiguration: z.literal("Release"),
  installTarget: z.literal("ios-simulator"),
  signing: z.strictObject({
    kind: z.literal("simulator-only"),
    codeSignature: z.literal("ad-hoc"),
  }),
  control: xcodeControlReceiptSchema,
  artifact: z.strictObject({
    name: z.string().regex(/^baro-internal-preview-ios-simulator-[a-f0-9]{40}\.zip$/),
    bytes: z.number().int().positive(),
    sha256: digest,
  }),
  embeddedBundle: z.strictObject({
    path: z.literal("main.jsbundle"),
    format: z.literal("hermes-bytecode"),
    bytes: z.number().int().positive(),
    sha256: digest,
    generatedJavascriptSha256: digest,
    sourceMapSha256: digest,
    archiveBytesMatch: z.literal(true),
    productEntry: z.literal("expo-router/entry"),
    productSourceObserved: z.literal(true),
    probeSourceAbsent: z.literal(true),
    sourceMapPackaged: z.literal(false),
    sourceModules: z.number().int().positive(),
  }),
  requiresMetro: z.literal(false),
});
export function verifyInternalIosArtifact(value: unknown, sourceSha: string) {
  const result = internalIosArtifactSchema.parse(value);
  if (
    result.sourceSha !== sourceSha ||
    result.control.sourceSha !== sourceSha ||
    result.control.toolingSourceSha !== sourceSha ||
    result.artifact.name !== `baro-internal-preview-ios-simulator-${sourceSha}.zip` ||
    result.architectures.some((a) => !["arm64", "x86_64"].includes(a)) ||
    new Set(result.architectures).size !== result.architectures.length ||
    JSON.stringify([...result.architectures].sort()) !==
      JSON.stringify([...result.control.architectures].sort())
  )
    throw new Error("INTERNAL_IOS_ARTIFACT_IDENTITY_MISMATCH");
  return result;
}
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
export function inspectEmbeddedIosBundle(
  compiled: Uint8Array,
  archived: Uint8Array,
  generated: Uint8Array,
  sourceMap: Uint8Array,
  archivePaths: string[],
) {
  const sources = z
    .object({ sources: z.array(z.string()).min(1) })
    .parse(JSON.parse(new TextDecoder().decode(sourceMap))).sources;
  if (
    compiled.length < 32 ||
    Buffer.from(compiled.subarray(0, 8)).toString("hex") !== "c61fbc03c103191f" ||
    compiled.length !== archived.length ||
    hash(compiled) !== hash(archived) ||
    generated.length < 32 ||
    Buffer.from(generated.subarray(0, 8)).toString("hex") === "c61fbc03c103191f"
  )
    throw new Error("INTERNAL_IOS_BUNDLE_BYTES_MISMATCH");
  if (
    !sources.some((p) => /(?:^|\/)src\/app\/index\.tsx$/.test(p)) ||
    sources.some((p) => /(?:^|\/)runtime-probe\//.test(p)) ||
    archivePaths.some((p) => /\.map$/i.test(p))
  )
    throw new Error("INTERNAL_IOS_PRODUCT_GRAPH_REQUIRED");
  return {
    path: "main.jsbundle" as const,
    format: "hermes-bytecode" as const,
    bytes: archived.length,
    sha256: hash(archived),
    generatedJavascriptSha256: hash(generated),
    sourceMapSha256: hash(sourceMap),
    archiveBytesMatch: true as const,
    productEntry: "expo-router/entry" as const,
    productSourceObserved: true as const,
    probeSourceAbsent: true as const,
    sourceMapPackaged: false as const,
    sourceModules: sources.length,
  };
}
