import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { z } from "zod";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const nativeTextInputPatchPaths = [
  "React/Fabric/Mounting/ComponentViews/TextInput/RCTTextInputComponentView.mm",
  "ReactCommon/react/renderer/textlayoutmanager/platform/ios/react/renderer/textlayoutmanager/RCTAttributedTextUtils.h",
  "ReactCommon/react/renderer/textlayoutmanager/platform/ios/react/renderer/textlayoutmanager/RCTAttributedTextUtils.mm",
] as const;
export const nativeTextInputPatchSchema = z
  .strictObject({
    version: z.literal(1),
    package: z.literal("react-native"),
    packageVersion: z.literal("0.88.0"),
    registryIntegrity: z.string().regex(/^sha512-[A-Za-z0-9+/=]+$/),
    patch: z.literal("patches/react-native@0.88.0.patch"),
    patchSha256: digest,
    beforeTreeSha256: digest,
    afterTreeSha256: digest,
    licenseSha256: digest,
    upstreamPullRequest: z.literal("https://github.com/react/react-native/pull/59197"),
    upstreamHeadSha: z.literal("a91468ffe62122bc49d964a08b493374f0af4775"),
    upstreamMergedAtAdoption: z.literal(false),
    coverage: z.literal("ios-attributed-text-comparison-source-only"),
    changes: z
      .array(
        z.strictObject({
          path: z.enum(nativeTextInputPatchPaths),
          beforeSha256: digest,
          afterSha256: digest,
        }),
      )
      .length(3),
    nativeRuntimeVerified: z.literal(false),
  })
  .refine((v) => new Set(v.changes.map((f) => f.path)).size === 3);
type Inputs = {
  bytesHash(value: Uint8Array | string): string;
  packageTreeHash(directory: string): Promise<string>;
  patchFilePaths(source: string): string[];
};
export async function verifyNativeTextInputPatch(root: string, inputs: Inputs) {
  const manifest = nativeTextInputPatchSchema.parse(
      JSON.parse(await readFile(resolve(root, "patches/react-native-ios-input.json"), "utf8")),
    ),
    project = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")),
    mobile = JSON.parse(await readFile(resolve(root, "apps/mobile/package.json"), "utf8")),
    lock = z
      .object({
        patchedDependencies: z.record(z.string(), z.string()),
        packages: z.record(z.string(), z.array(z.unknown())),
      })
      .parse(Bun.JSONC.parse(await readFile(resolve(root, "bun.lock"), "utf8"))),
    key = "react-native@0.88.0",
    directory = resolve(root, "node_modules/react-native"),
    installed = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
  if (
    mobile.dependencies?.["react-native"] !== manifest.packageVersion ||
    project.patchedDependencies?.[key] !== manifest.patch ||
    lock.patchedDependencies?.[key] !== manifest.patch ||
    lock.packages["react-native"]?.[0] !== key ||
    lock.packages["react-native"]?.[3] !== manifest.registryIntegrity ||
    installed.name !== manifest.package ||
    installed.version !== manifest.packageVersion
  )
    throw Error("NATIVE_INPUT_PATCH_VERSION_OR_LOCK_CHANGED");
  const requireMobile = createRequire(resolve(root, "apps/mobile/package.json"));
  if (
    (await realpath(requireMobile.resolve("react-native/package.json"))) !==
    (await realpath(resolve(directory, "package.json")))
  )
    throw Error("NATIVE_INPUT_PATCH_CONSUMER_CHANGED");
  const patch = await readFile(resolve(root, manifest.patch), "utf8");
  if (
    inputs.bytesHash(patch) !== manifest.patchSha256 ||
    JSON.stringify(inputs.patchFilePaths(patch)) !==
      JSON.stringify([...nativeTextInputPatchPaths].sort())
  )
    throw Error("NATIVE_INPUT_PATCH_BYTES_OR_SCOPE_CHANGED");
  if (
    (await inputs.packageTreeHash(directory)) !== manifest.afterTreeSha256 ||
    inputs.bytesHash(await readFile(resolve(directory, "LICENSE"))) !== manifest.licenseSha256
  )
    throw Error("NATIVE_INPUT_PATCH_TREE_OR_LICENSE_CHANGED");
  for (const file of manifest.changes)
    if (inputs.bytesHash(await readFile(resolve(directory, file.path))) !== file.afterSha256)
      throw Error("NATIVE_INPUT_PATCH_POSTIMAGE_CHANGED");
  return manifest;
}

export const nativeTextInputCompileSchema = z.strictObject({
  kind: z.literal("ios-text-input-patched-source-compile-only"),
  reactNative: z.literal("0.88.0"),
  patchSha256: digest,
  manifestSha256: digest,
  generatedSourceBuildPropertyVerified: z.literal(true),
  prebuiltRnCoreDisabled: z.literal(true),
  compiledArchitectures: z.tuple([z.literal("arm64"), z.literal("x86_64")]),
  bothSourcesObservedForEveryArchitecture: z.literal(true),
  nativeRuntimeVerified: z.literal(false),
});
export function verifyNativeTextInputCompilation(
  output: string,
  packageRoots: string[],
  properties: unknown,
) {
  if (
    !properties ||
    typeof properties !== "object" ||
    !("ios.buildReactNativeFromSource" in properties) ||
    properties["ios.buildReactNativeFromSource"] !== "true" ||
    !packageRoots.length ||
    packageRoots.some((p) => !p.startsWith("/") || /\s/.test(p))
  )
    throw Error("NATIVE_INPUT_SOURCE_BUILD_PROPERTY_REQUIRED");
  const lines = output.split(/\r?\n/).filter((line) => line.startsWith("CompileC "));
  for (const architecture of ["arm64", "x86_64"])
    for (const source of nativeTextInputPatchPaths.filter((path) => path.endsWith(".mm")))
      if (
        !lines.some(
          (line) =>
            line.includes(` normal ${architecture} objective-c++ `) &&
            packageRoots.some((root) => line.includes(` ${resolve(root, source)} `)),
        )
      )
        throw Error("NATIVE_INPUT_PATCHED_SOURCE_COMPILE_REQUIRED");
}
