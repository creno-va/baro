import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { verifyInternalAndroidArtifact } from "./mobile-internal-android-artifact";

const source = z.string().regex(/^[a-f0-9]{40}$/);
export const androidCompiledInputSchema = z.strictObject({
  version: z.literal(1),
  sourceSha: source,
  workflowRunId: z.string().regex(/^\d+$/),
  artifactId: z.string().regex(/^\d+$/),
  artifactName: z.string().regex(/^mobile-internal-android-[a-f0-9]{40}$/),
  receiptSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export function verifyCompiledAndroidProvenance(
  value: unknown,
  runValue: unknown,
  artifactValue: unknown,
) {
  const pin = androidCompiledInputSchema.parse(value),
    run = z
      .object({
        id: z.number().int().positive(),
        head_sha: source,
        path: z.literal(".github/workflows/mobile-internal-android.yml"),
        status: z.literal("completed"),
        conclusion: z.literal("success"),
      })
      .parse(runValue),
    artifact = z
      .object({
        id: z.number().int().positive(),
        name: z.string(),
        expired: z.literal(false),
        workflow_run: z.object({ id: z.number().int().positive(), head_sha: source }),
      })
      .parse(artifactValue);
  if (
    pin.artifactName !== `mobile-internal-android-${pin.sourceSha}` ||
    String(run.id) !== pin.workflowRunId ||
    run.head_sha !== pin.sourceSha ||
    String(artifact.id) !== pin.artifactId ||
    artifact.name !== pin.artifactName ||
    String(artifact.workflow_run.id) !== pin.workflowRunId ||
    artifact.workflow_run.head_sha !== pin.sourceSha
  )
    throw Error("COMPILED_ANDROID_PROVENANCE_MISMATCH");
  return pin;
}
const hash = (body: Uint8Array) => createHash("sha256").update(body).digest("hex");
export async function verifyPinnedCompiledAndroidInput(root: string, directory: string) {
  const pin = androidCompiledInputSchema.parse(
    JSON.parse(
      await readFile(resolve(root, "tests/fixtures/android-internal-preview.json"), "utf8"),
    ),
  );
  if (pin.artifactName !== `mobile-internal-android-${pin.sourceSha}`)
    throw Error("COMPILED_ANDROID_PIN_IDENTITY_MISMATCH");
  const raw = await readFile(resolve(directory, "receipt-android.json"));
  if (hash(raw) !== pin.receiptSha256) throw Error("COMPILED_ANDROID_RECEIPT_CHANGED");
  const receipt = verifyInternalAndroidArtifact(JSON.parse(raw.toString()), pin.sourceSha);
  if (receipt.artifact.name !== `baro-internal-preview-android-${pin.sourceSha}.apk`)
    throw Error("COMPILED_ANDROID_PIN_IDENTITY_MISMATCH");
  const apk = resolve(directory, receipt.artifact.name),
    body = await readFile(apk);
  if (body.length !== receipt.artifact.bytes || hash(body) !== receipt.artifact.sha256)
    throw Error("COMPILED_ANDROID_APK_CHANGED");
  return { pin, raw, receipt, apk };
}

export function verifyCompiledAndroidBundle(
  body: Uint8Array,
  expected: { bytes: number; sha256: string },
  paths: string[],
) {
  if (
    body.length !== expected.bytes ||
    hash(body) !== expected.sha256 ||
    Buffer.from(body.subarray(0, 8)).toString("hex") !== "c61fbc03c103191f" ||
    paths.filter((path) => path === "assets/index.android.bundle").length !== 1 ||
    paths.some((path) => /\.map$/i.test(path))
  )
    throw Error("COMPILED_ANDROID_HBC_MISMATCH");
}
