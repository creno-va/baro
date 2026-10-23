import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const sha = z.string().regex(/^[a-f0-9]{40}$/),
  digest = z.string().regex(/^[a-f0-9]{64}$/);
export const xcodeCompilerInputSchema = z.strictObject({
  version: z.literal(1),
  sourceSha: sha,
  workflowRunId: z.string().regex(/^\d+$/),
  artifactId: z.string().regex(/^\d+$/),
  artifactName: z.string().regex(/^mobile-ios-xcode-control-[a-f0-9]{40}$/),
  inspectionSha256: digest,
});
export const xcodeCompilerInspectionSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("unaccepted-xcode-simulator-output"),
  sourceSha: sha,
  observedAt: z.iso.datetime(),
  applicationId: z.literal("site.baro.app.preview"),
  nativeCompileSucceeded: z.literal(true),
  archive: z.strictObject({
    name: z.string().regex(/^unaccepted-simulator-[a-f0-9]{40}\.zip$/),
    bytes: z.number().int().positive(),
    sha256: digest,
  }),
  infoPlistSha256: digest,
  executableSha256: digest,
  accepted: z.literal(false),
  signatureAccepted: z.literal(false),
  sdkReadinessVerified: z.literal(false),
  physicalDeviceVerified: z.literal(false),
  storeSigned: z.literal(false),
  deployed: z.literal(false),
});
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
export async function verifyPinnedXcodeCompilerInput(root: string, input: string) {
  const manifest = xcodeCompilerInputSchema.parse(
    JSON.parse(
      await readFile(resolve(root, "tests/fixtures/ios-xcode-compiler-input.json"), "utf8"),
    ),
  );
  if (manifest.artifactName !== `mobile-ios-xcode-control-${manifest.sourceSha}`)
    throw new Error("XCODE_INPUT_IDENTITY_MISMATCH");
  const directory = resolve(input, "ios-xcode-control"),
    raw = await readFile(resolve(directory, "inspection.json"));
  if (hash(raw) !== manifest.inspectionSha256) throw new Error("XCODE_INPUT_INSPECTION_CHANGED");
  const inspection = xcodeCompilerInspectionSchema.parse(JSON.parse(raw.toString()));
  if (
    inspection.sourceSha !== manifest.sourceSha ||
    inspection.archive.name !== `unaccepted-simulator-${manifest.sourceSha}.zip`
  )
    throw new Error("XCODE_INPUT_IDENTITY_MISMATCH");
  const zip = resolve(directory, inspection.archive.name),
    body = await readFile(zip);
  if (body.length !== inspection.archive.bytes || hash(body) !== inspection.archive.sha256)
    throw new Error("XCODE_INPUT_ARCHIVE_CHANGED");
  return { manifest, inspection, zip };
}
