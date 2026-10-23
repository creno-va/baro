import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const readySchema = z.strictObject({ version: z.literal(1), kind: z.literal("sdk-api-ready") });
const verifiedSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("apk-verified"),
  certificateSha256: z
    .array(z.string().regex(/^[a-f0-9]{64}$/))
    .min(1)
    .max(8),
});
export function androidCertificateDigest(value: unknown) {
  const report = verifiedSchema.parse(value),
    hashes = [...new Set(report.certificateSha256)];
  if (hashes.length !== 1) throw new Error("PREVIEW_ANDROID_SIGNER_MULTIPLE_IDENTITIES");
  return hashes[0] as string;
}
export async function androidBuildTools(sdk: string) {
  const versions = (await readdir(resolve(sdk, "build-tools")))
    .filter((value) => /^\d+\.\d+\.\d+$/.test(value))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const version = versions.at(-1);
  if (!version) throw new Error("PREVIEW_ANDROID_TOOLS_REQUIRED");
  return { version, path: resolve(sdk, "build-tools", version) };
}
export async function runAndroidSignatureProbe(
  root: string,
  tools: string,
  command: (args: string[]) => Promise<string>,
  apk?: string,
) {
  const args = [
    "java",
    "--class-path",
    resolve(tools, "lib/apksigner.jar"),
    resolve(root, "scripts/java/BaroApkCertificateProbe.java"),
    apk ?? "--self-test",
  ];
  const result: unknown = JSON.parse(await command(args));
  if (apk) return androidCertificateDigest(result);
  readySchema.parse(result);
  return null;
}
/** AOSP v2-only fixtures are explicitly scoped to API24+, never accepted as a BARO artifact report. */
export async function runAndroidSignatureFixtureProbe(
  root: string,
  tools: string,
  command: (args: string[]) => Promise<string>,
  fixture: string,
) {
  const value: unknown = JSON.parse(
    await command([
      "java",
      "--class-path",
      resolve(tools, "lib/apksigner.jar"),
      resolve(root, "scripts/java/BaroApkCertificateProbe.java"),
      "--fixture-api24",
      fixture,
    ]),
  );
  const report = verifiedSchema
    .extend({ kind: z.literal("apk-fixture-verified-api24") })
    .parse(value);
  return androidCertificateDigest({ ...report, kind: "apk-verified" });
}
