import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { verifyInternalIosArtifact } from "./mobile-internal-ios-artifact";
import { iosLargestContentSize } from "./mobile-ios-ui-capabilities";

const sha = z.string().regex(/^[a-f0-9]{40}$/),
  digest = z.string().regex(/^[a-f0-9]{64}$/);
export const iosInternalInputSchema = z.strictObject({
  version: z.literal(1),
  sourceSha: sha,
  workflowRunId: z.string().regex(/^\d+$/),
  artifactId: z.string().regex(/^\d+$/),
  artifactName: z.string().regex(/^mobile-internal-ios-[a-f0-9]{40}$/),
  receiptSha256: digest,
});
export const iosBundledInputPaths = [
  "apps/mobile",
  ":(exclude)apps/mobile/README.md",
  "src/contracts",
  "packages",
  "package.json",
  "bun.lock",
  "patches",
  "public/fonts/OFL.txt",
];
export async function assertIosBundledInputs(root: string, binary: string, tooling: string) {
  if (![binary, tooling].every((s) => /^[a-f0-9]{40}$/.test(s)))
    throw new Error("INTERNAL_IOS_SOURCE_REFERENCES_REQUIRED");
  const c = Bun.spawn(["git", "diff", "--quiet", binary, tooling, "--", ...iosBundledInputPaths], {
    cwd: root,
    stdout: "ignore",
    stderr: "ignore",
  });
  if (await c.exited) throw new Error("INTERNAL_IOS_BUNDLED_INPUTS_CHANGED");
}
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
export async function verifyPinnedInternalIosInput(root: string, directory: string) {
  const pin = iosInternalInputSchema.parse(
    JSON.parse(await readFile(resolve(root, "tests/fixtures/ios-internal-preview.json"), "utf8")),
  );
  if (pin.artifactName !== `mobile-internal-ios-${pin.sourceSha}`)
    throw new Error("INTERNAL_IOS_PIN_IDENTITY_MISMATCH");
  const raw = await readFile(resolve(directory, "receipt-ios.json"));
  if (hash(raw) !== pin.receiptSha256) throw new Error("INTERNAL_IOS_RECEIPT_CHANGED");
  const receipt = verifyInternalIosArtifact(JSON.parse(raw.toString()), pin.sourceSha),
    zip = resolve(directory, receipt.artifact.name),
    body = await readFile(zip);
  if (body.length !== receipt.artifact.bytes || hash(body) !== receipt.artifact.sha256)
    throw new Error("INTERNAL_IOS_ARCHIVE_CHANGED");
  return { pin, receipt, zip, raw };
}
export const iosColdLaunchReceiptSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("ios-bundled-cold-launch-observation"),
  binarySourceSha: sha,
  toolingSourceSha: sha,
  observedAt: z.iso.datetime(),
  applicationId: z.literal("site.baro.app.preview"),
  nativeConfiguration: z.literal("Release"),
  requiresMetro: z.literal(false),
  archiveSha256: digest,
  compilerReceiptSha256: digest,
  device: z.strictObject({
    kind: z.literal("simulator"),
    model: z.string().min(1).max(160),
    osVersion: z.string().regex(/^\d+(?:\.\d+){0,2}$/),
  }),
  coldLaunches: z.tuple([
    z.strictObject({
      ordinal: z.literal(1),
      elapsedSeconds: z.number().int().min(15),
      samePidReadbackSamples: z.literal(3),
    }),
    z.strictObject({
      ordinal: z.literal(2),
      elapsedSeconds: z.number().int().min(15),
      samePidReadbackSamples: z.literal(3),
    }),
  ]),
  nativeProcessLaunchVerified: z.literal(true),
  distinctColdLaunchPids: z.literal(true),
  wholeIntervalContinuityProven: z.literal(false),
  metroStarted: z.literal(false),
  metroGuardRequests: z.literal(0),
  anonymousFreshInstall: z.literal(true),
  publicDataNavigation: z.literal(false),
  screenshot: z.strictObject({
    name: z.literal("home-ios.png"),
    bytes: z.number().int().positive(),
    sha256: digest,
  }),
  homeContentVerified: z.literal(false),
  visualReviewRequired: z.literal(true),
  productJourneysVerified: z.literal(false),
  accessibilityVerified: z.literal(false),
  httpTransportSeparatelyObserved: z.literal(false),
  remoteApiVerified: z.literal(false),
  oauthVerified: z.literal(false),
  physicalDeviceVerified: z.literal(false),
  storeSigned: z.literal(false),
  deployed: z.literal(false),
});
export function verifyIosColdLaunchReceipt(
  value: unknown,
  binary: string,
  tooling: string,
  identity: { archiveSha256: string; compilerReceiptSha256: string },
) {
  const result = iosColdLaunchReceiptSchema.parse(value);
  if (
    result.binarySourceSha !== binary ||
    result.toolingSourceSha !== tooling ||
    result.archiveSha256 !== identity.archiveSha256 ||
    result.compilerReceiptSha256 !== identity.compilerReceiptSha256
  )
    throw new Error("INTERNAL_IOS_COLD_LAUNCH_IDENTITY_MISMATCH");
  return result;
}

export const iosLargeFontReceiptSchema = iosColdLaunchReceiptSchema
  .omit({
    coldLaunches: true,
    distinctColdLaunchPids: true,
  })
  .extend({
    kind: z.literal("ios-bundled-large-font-observation"),
    requestedContentSize: z.literal(iosLargestContentSize),
    contentSizeBeforeRestart: z.literal(iosLargestContentSize),
    contentSizeAfterRestart: z.literal(iosLargestContentSize),
    sdkHelpSha256: digest,
    nativeContentSizeReadbackVerified: z.literal(true),
    processRestarted: z.literal(true),
    elapsedSeconds: z.number().int().min(15),
    samePidReadbackSamples: z.literal(3),
    semanticTextScaleProven: z.literal(false),
    screenshot: z.strictObject({
      name: z.literal("large-font-ios.png"),
      bytes: z.number().int().positive(),
      sha256: digest,
    }),
  });
export function verifyIosLargeFontReceipt(
  value: unknown,
  baseline: z.infer<typeof iosColdLaunchReceiptSchema>,
) {
  const result = iosLargeFontReceiptSchema.parse(value);
  if (
    result.binarySourceSha !== baseline.binarySourceSha ||
    result.toolingSourceSha !== baseline.toolingSourceSha ||
    result.archiveSha256 !== baseline.archiveSha256 ||
    result.compilerReceiptSha256 !== baseline.compilerReceiptSha256 ||
    JSON.stringify(result.device) !== JSON.stringify(baseline.device)
  )
    throw Error("INTERNAL_IOS_LARGE_FONT_IDENTITY_MISMATCH");
  return result;
}
