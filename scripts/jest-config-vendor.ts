import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { z } from "zod";
import { registryPackageTreeHash } from "./upstream-toolchain";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const jestVendorFiles = [
  "LICENSE",
  "package.json",
  "build/index.js",
  "build/index.mjs",
  "build/index.d.ts",
] as const;
const schema = z
  .strictObject({
    version: z.literal(1),
    rawAuditRequired: z.literal(true),
    upstreamVersion: z.literal("30.5.2"),
    forkVersion: z.literal("30.5.2-baro.1"),
    registryIntegrity: z.literal(
      "sha512-U6221OZekabePvGcGPf4raIBKMvYQWFHvhobDJRojOYaFMj2HaGytAdknjDhYc6JTz2fdHW9+6k0wWUDaNeOFQ==",
    ),
    beforeTreeSha256: hash,
    afterTreeSha256: hash,
    licenseSha256: hash,
    patch: z.literal("patches/jest-config-30.5.2-baro.1.patch"),
    patchSha256: hash,
    historicalManifestSha256: hash,
    historicalNativeManifestSha256: hash,
    nativeLayout: z
      .strictObject({
        registryIntegrity: z.literal(
          "sha512-Cxwpt2SfTzTtXcfOlzGEee8O+c+MmUgGrNiBcXnuWxuFJHe6a5Hz7qwhwe5OgaSYI0IJvkLqWX1ASG+cJOkEiA==",
        ),
        treeSha256: hash,
        files: z
          .array(
            z.strictObject({
              path: z
                .string()
                .regex(
                  /^node_modules\/pretty-format\/node_modules\/ansi-styles\/(?:index\.d\.ts|index\.js|license|package\.json|readme\.md)$/,
                ),
              sha256: hash,
            }),
          )
          .length(5),
        beforeTreeSha256: hash,
        afterTreeSha256: hash,
      })
      .refine((value) => new Set(value.files.map((file) => file.path)).size === 5),
    files: z
      .array(
        z.strictObject({ path: z.enum(jestVendorFiles), beforeSha256: hash, afterSha256: hash }),
      )
      .length(5),
    replacement: z.strictObject({
      name: z.literal("@fastify/deepmerge"),
      version: z.literal("3.2.4"),
      registryIntegrity: z.literal(
        "sha512-kc8GQq5gX9RRhw0rov3DMrN8wS8yRlxJRdDzsYwwdBV/wazuVgc/1K7CKL90tlvu3RlHan6Y0R0aE3nJtBz2eQ==",
      ),
      treeSha256: hash,
      licenseSha256: hash,
    }),
  })
  .refine((value) => new Set(value.files.map((file) => file.path)).size === 5);

type LockMetadata = {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};
const metadataOf = (record: unknown[] | undefined) =>
  (typeof record?.[1] === "object" ? record[1] : record?.[2]) as LockMetadata | undefined;

/** A real consumer replacement, with explicit local version and upstream bytes.
 * Raw audit remains mandatory; historical mitigation proofs are separately kept. */
export async function verifyJestConfigVendor(
  root: string,
  inputs: {
    bytesHash(value: Uint8Array | string): string;
    patchFilePaths(value: string): string[];
  },
) {
  const manifest = schema.parse(
    JSON.parse(await readFile(resolve(root, "patches/jest-config-vendor.json"), "utf8")),
  );
  const project = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const lock = Bun.JSONC.parse(await readFile(resolve(root, "bun.lock"), "utf8")) as {
    packages: Record<string, unknown[]>;
  };
  const vendor = resolve(root, "vendor/jest-config");
  const local = JSON.parse(await readFile(resolve(vendor, "package.json"), "utf8"));
  const record = lock.packages["jest-config"];
  if (
    project.overrides?.["jest-config"] !== "file:vendor/jest-config" ||
    project.devDependencies?.["jest-config"] !== "file:vendor/jest-config" ||
    record?.[0] !== "jest-config@file:vendor/jest-config" ||
    local.name !== "jest-config" ||
    local.version !== manifest.forkVersion ||
    local.private !== true ||
    local.dependencies?.deepmerge !== undefined ||
    local.dependencies?.[manifest.replacement.name] !== manifest.replacement.version ||
    metadataOf(record)?.dependencies?.[manifest.replacement.name] !== manifest.replacement.version
  )
    throw Error("JEST_CONFIG_VENDOR_GRAPH_CHANGED");
  for (const item of Object.values(lock.packages)) {
    const metadata = metadataOf(item);
    if (
      (typeof item[0] === "string" && item[0].startsWith("deepmerge@")) ||
      metadata?.dependencies?.deepmerge ||
      metadata?.optionalDependencies?.deepmerge
    )
      throw Error("JEST_CONFIG_LEGACY_CONSUMER_REMAINS");
  }
  const patch = await readFile(resolve(root, manifest.patch), "utf8");
  if (
    inputs.bytesHash(patch) !== manifest.patchSha256 ||
    JSON.stringify(inputs.patchFilePaths(patch)) !==
      JSON.stringify(["build/index.js", "package.json"]) ||
    inputs.bytesHash(
      await readFile(resolve(root, "patches/archive/manifest-before-jest-replacement.json")),
    ) !== manifest.historicalManifestSha256
  )
    throw Error("JEST_CONFIG_VENDOR_PROVENANCE_CHANGED");
  const nativeArchiveBytes = await readFile(
    resolve(root, "patches/archive/native-manifest-before-jest-replacement.json"),
  );
  const nativeArchive = JSON.parse(new TextDecoder().decode(nativeArchiveBytes));
  const nativeCurrent = JSON.parse(
    await readFile(resolve(root, "patches/react-native-ios-input.json"), "utf8"),
  );
  if (
    inputs.bytesHash(nativeArchiveBytes) !== manifest.historicalNativeManifestSha256 ||
    JSON.stringify(nativeCurrent) !==
      JSON.stringify({
        ...nativeArchive,
        beforeTreeSha256: manifest.nativeLayout.beforeTreeSha256,
        afterTreeSha256: manifest.nativeLayout.afterTreeSha256,
      }) ||
    lock.packages["react-native/pretty-format/ansi-styles"]?.[0] !== "ansi-styles@5.2.0" ||
    lock.packages["react-native/pretty-format/ansi-styles"]?.[3] !==
      manifest.nativeLayout.registryIntegrity
  )
    throw Error("JEST_CONFIG_NATIVE_LAYOUT_PROVENANCE_CHANGED");
  const native = resolve(root, "node_modules/react-native");
  for (const file of manifest.nativeLayout.files)
    if (inputs.bytesHash(await readFile(resolve(native, file.path))) !== file.sha256)
      throw Error("JEST_CONFIG_NATIVE_LAYOUT_BYTES_CHANGED");
  if (
    (await registryPackageTreeHash(
      resolve(native, "node_modules/pretty-format/node_modules/ansi-styles"),
      inputs.bytesHash,
    )) !== manifest.nativeLayout.treeSha256
  )
    throw Error("JEST_CONFIG_NATIVE_LAYOUT_TREE_CHANGED");
  for (const file of manifest.files)
    if (inputs.bytesHash(await readFile(resolve(vendor, file.path))) !== file.afterSha256)
      throw Error("JEST_CONFIG_VENDOR_FILE_CHANGED");
  if (
    (await registryPackageTreeHash(vendor, inputs.bytesHash)) !== manifest.afterTreeSha256 ||
    inputs.bytesHash(await readFile(resolve(vendor, "LICENSE"))) !== manifest.licenseSha256
  )
    throw Error("JEST_CONFIG_VENDOR_TREE_OR_LICENSE_CHANGED");
  const requireRoot = createRequire(resolve(root, "package.json"));
  // Bun uses hard links on Windows and may use directory links elsewhere.
  // Attest the complete installed copy as well as the checked-in source.
  const installed = resolve(root, "node_modules/jest-config");
  if ((await registryPackageTreeHash(installed, inputs.bytesHash)) !== manifest.afterTreeSha256)
    throw Error("JEST_CONFIG_INSTALLED_TREE_CHANGED");
  const expectedEntry = await realpath(resolve(installed, "build/index.js"));
  if ((await realpath(requireRoot.resolve("jest-config"))) !== expectedEntry)
    throw Error("JEST_CONFIG_VENDOR_RESOLUTION_CHANGED");
  const consumers = Object.entries(lock.packages)
    .filter(([, item]) => metadataOf(item)?.dependencies?.["jest-config"])
    .map(([name]) => name)
    .sort();
  if (JSON.stringify(consumers) !== JSON.stringify(["@jest/core", "jest-cli"]))
    throw Error("JEST_CONFIG_VENDOR_CONSUMER_SET_CHANGED");
  for (const name of consumers) {
    const consumer = createRequire(requireRoot.resolve(name));
    if (
      lock.packages[name]?.[0] !== `${name}@30.5.2` ||
      (await realpath(consumer.resolve("jest-config"))) !== expectedEntry
    )
      throw Error("JEST_CONFIG_VENDOR_CONSUMER_CHANGED");
  }
  const replacement = manifest.replacement;
  const replacementRoot = resolve(root, "node_modules", replacement.name);
  const requireVendor = createRequire(resolve(installed, "build/index.js"));
  if (
    lock.packages[replacement.name]?.[0] !== `${replacement.name}@${replacement.version}` ||
    lock.packages[replacement.name]?.[3] !== replacement.registryIntegrity ||
    (await realpath(requireVendor.resolve(replacement.name))) !==
      (await realpath(resolve(replacementRoot, "index.js"))) ||
    (await registryPackageTreeHash(replacementRoot, inputs.bytesHash)) !== replacement.treeSha256 ||
    inputs.bytesHash(await readFile(resolve(replacementRoot, "LICENSE"))) !==
      replacement.licenseSha256
  )
    throw Error("JEST_CONFIG_REPLACEMENT_BYTES_OR_RESOLUTION_CHANGED");
  return manifest;
}
