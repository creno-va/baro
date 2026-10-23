import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { z } from "zod";

async function fileIdentity(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return { bytes: (await stat(path)).size, sha256: hash.digest("hex") };
}
/** SDK layouts vary; accept exactly one actual Release output, never the packaged file as its own counterpart. */
export async function generatedAndroidReleaseFiles(build: string) {
  async function locate(directory: string, pattern: string) {
    if (!(await stat(resolve(build, directory)).catch(() => null))?.isDirectory()) return null;
    const paths = [];
    for await (const path of new Bun.Glob(pattern).scan({
      cwd: resolve(build, directory),
      onlyFiles: true,
    })) {
      if (/(?:^|\/)(?:release|createBundleReleaseJsAndAssets)(?:\/|$)/i.test(path))
        paths.push(resolve(build, directory, path));
    }
    if (paths.length > 1) throw new Error("INTERNAL_ANDROID_GENERATED_OUTPUT_AMBIGUOUS");
    const selected = paths[0];
    if (
      selected &&
      ((await lstat(selected)).isSymbolicLink() ||
        !(await realpath(selected)).startsWith(`${await realpath(build)}/`))
    )
      throw new Error("INTERNAL_ANDROID_GENERATED_OUTPUT_NOT_OWNED");
    return selected ?? null;
  }
  return {
    bundle: await locate("generated/assets", "**/index.android.bundle"),
    map: await locate("generated/sourcemaps", "**/index.android.bundle.map"),
  };
}
/** Public compiled code only. This snapshot is explicitly not an accepted or installable handoff receipt. */
export async function preserveCompiledAndroidInspection(
  base: string,
  mobile: string,
  sourceSha: string,
) {
  z.string()
    .regex(/^[a-f0-9]{40}$/)
    .parse(sourceSha);
  const out = resolve(base, "inspection"),
    build = resolve(mobile, "android/app/build");
  await mkdir(out, { recursive: true });
  const apkName = `compiled-android-${sourceSha}.apk`,
    apk = resolve(out, apkName);
  await copyFile(
    resolve(build, "outputs/apk/release/app-release.apk"),
    apk,
    constants.COPYFILE_EXCL,
  );
  let files: { bundle: string | null; map: string | null } = { bundle: null, map: null };
  try {
    files = await generatedAndroidReleaseFiles(build);
  } catch {
    /* Preserve the APK even if output discovery fails; the verifier will report its own phase. */
  }
  let generatedBundle = null,
    graph = null,
    fontDeclaration = null;
  if (files.bundle) {
    await copyFile(
      files.bundle,
      resolve(out, "generated-index.android.bundle"),
      constants.COPYFILE_EXCL,
    );
    generatedBundle = {
      name: "generated-index.android.bundle",
      relativePath: relative(build, files.bundle),
      ...(await fileIdentity(files.bundle)),
    };
  }
  if (files.map) {
    const bytes = await readFile(files.map);
    try {
      const decoded = z
        .object({ sources: z.array(z.string()).min(1) })
        .safeParse(JSON.parse(bytes.toString()));
      if (decoded.success)
        graph = {
          sourceMapSha256: createHash("sha256").update(bytes).digest("hex"),
          sourceModules: decoded.data.sources.length,
          productHomeSourceObserved: decoded.data.sources.some((p) =>
            /(?:^|\/)src\/app\/index\.tsx$/.test(p),
          ),
          probeSourceAbsent: !decoded.data.sources.some((p) => /(?:^|\/)runtime-probe\//.test(p)),
        };
    } catch {
      /* Invalid generated JSON is not accepted, but must not erase the completed APK snapshot. */
    }
  }
  const font = resolve(mobile, "android/app/src/main/res/font/xml_baro_mobile.xml");
  if (await Bun.file(font).exists()) {
    await copyFile(font, resolve(out, "font-faces.xml"), constants.COPYFILE_EXCL);
    fontDeclaration = { name: "font-faces.xml", ...(await fileIdentity(font)) };
  }
  const receipt = {
    version: 1,
    kind: "unaccepted-android-inspection",
    sourceSha,
    observedAt: new Date().toISOString(),
    apk: { name: apkName, ...(await fileIdentity(apk)) },
    generatedBundle,
    graph,
    fontDeclaration,
    accepted: false,
    binaryMetadataVerified: false,
    appRuntimeVerified: false,
    remoteApiVerified: false,
    physicalDeviceVerified: false,
    storeSigned: false,
    deployed: false,
  };
  await writeFile(resolve(out, "inspection.json"), `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: "wx",
  });
  return { files, receipt };
}
export function internalAndroidVerificationFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const known = new Set([
    "INTERNAL_ANDROID_GENERATED_OUTPUT_AMBIGUOUS",
    "INTERNAL_ANDROID_GENERATED_OUTPUT_NOT_OWNED",
    "INTERNAL_ANDROID_TEMPLATE_CERTIFICATE_REQUIRED",
    "INTERNAL_ANDROID_BUNDLE_BYTES_MISMATCH",
    "INTERNAL_ANDROID_PRODUCT_GRAPH_REQUIRED",
    "INTERNAL_ANDROID_NATIVE_VERSION_DRIFT",
    "PREVIEW_ANDROID_METADATA_MISSING",
    "COMPILED_FONT_BYTES_OR_LICENSE_CHANGED",
    "ANDROID_FONT_FACES_MISSING",
    "COMPILED_FONT_READ_FAILED",
    "ANDROID_FONT_RESOURCE_IDENTITY_REQUIRED",
    "ANDROID_FONT_RESOURCE_AMBIGUOUS",
    "ANDROID_FONT_RESOURCE_PATH_REQUIRED",
    "ANDROID_FONT_COMPILED_FACES_REQUIRED",
    "ANDROID_FONT_RESOURCE_TOOL_FAILED",
    "INTERNAL_ANDROID_PIN_IDENTITY_MISMATCH",
    "INTERNAL_ANDROID_INSPECTION_BYTES_CHANGED",
    "INTERNAL_ANDROID_INSPECTION_FILE_CHANGED",
    "INTERNAL_ANDROID_CHECKOUT_MISMATCH",
    "INTERNAL_ANDROID_PRODUCT_ENTRY_REQUIRED",
    "INTERNAL_ANDROID_TEMPLATE_SIGNING_OR_BUNDLE_CHANGED",
    "INTERNAL_ANDROID_TOOL_FAILED",
    "INTERNAL_ANDROID_GENERATED_OUTPUT_MISSING",
  ]);
  const fsCode = error && typeof error === "object" && "code" in error ? error.code : undefined;
  const code = known.has(message)
    ? message
    : fsCode === "ENOENT"
      ? "INTERNAL_ANDROID_FILE_MISSING"
      : fsCode === "EACCES"
        ? "INTERNAL_ANDROID_FILE_PERMISSION_DENIED"
        : "INTERNAL_ANDROID_BUILD_FAILED";
  const fields = new Set([
    "kind",
    "sourceSha",
    "applicationId",
    "architectures",
    "minimumOS",
    "debuggable",
    "launchableActivity",
    "signing",
    "embeddedBundle",
    "compiledFont",
    "artifact",
    "nativeConfiguration",
    "requiresMetro",
  ]);
  const invalidFields =
    error instanceof z.ZodError
      ? [
          ...new Set(
            error.issues
              .map((issue) => issue.path[0])
              .filter((field): field is string => typeof field === "string" && fields.has(field)),
          ),
        ].slice(0, 6)
      : [];
  return { code, invalidFields };
}
