import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { z } from "zod";
import { verifyCliZodPatch } from "./cli-zod-patch";
import { verifyNativeTextInputPatch } from "./mobile-ios-text-input-patch";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const safePath = z
  .string()
  .regex(/^[A-Za-z0-9_./@-]+$/)
  .refine((path) => !path.startsWith("/") && !path.split("/").includes(".."));
const patchSchema = z.strictObject({
  name: z.enum(["braces", "node-forge"]),
  version: z.enum(["3.0.3", "1.4.0"]),
  registryIntegrity: z.string().regex(/^sha512-[A-Za-z0-9+/=]+$/),
  patch: safePath,
  patchSha256: digest,
  beforeTreeSha256: digest,
  afterTreeSha256: digest,
  entryPoint: safePath,
  licenseSha256: digest,
  coverage: z.enum(["bounded-commonjs-traversal", "commonjs-rsa-verifier-only"]),
  changes: z
    .array(z.strictObject({ path: safePath, beforeSha256: digest, afterSha256: digest }))
    .min(1),
  unmodifiedBrowserDistributions: z.array(z.strictObject({ path: safePath, sha256: digest })),
  source: z.url(),
  consumers: z
    .array(
      z.strictObject({
        name: safePath,
        version: z.string().regex(/^\d+\.\d+\.\d+$/),
        entryPoint: safePath,
      }),
    )
    .min(1),
});
export const toolchainPatchManifestSchema = z.strictObject({
  version: z.literal(1),
  rawAuditRequired: z.literal(true),
  packages: z.array(patchSchema).length(2),
});
export const bytesHash = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");
export async function packageTreeHash(directory: string) {
  const files: { path: string; sha256: string }[] = [];
  async function walk(path: string, relative = "") {
    for (const name of (await readdir(path)).sort()) {
      const local = relative ? `${relative}/${name}` : name,
        full = resolve(path, name),
        metadata = await lstat(full);
      if (
        !relative &&
        /^\.bun-tag-[a-f0-9]{16}$/.test(name) &&
        metadata.isFile() &&
        metadata.size === 0
      )
        continue;
      if (metadata.isDirectory()) await walk(full, local);
      else if (metadata.isFile())
        files.push({ path: local, sha256: bytesHash(await readFile(full)) });
      else throw new Error("PATCH_PACKAGE_NONREGULAR_ENTRY");
    }
  }
  await walk(directory);
  return bytesHash(
    files
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((file) => `${file.path}\0${file.sha256}\n`)
      .join(""),
  );
}
/** Resolve from the real CLI consumer, so a nested unpatched copy cannot bypass root attestation. */
export async function assertConsumerPatchResolution(
  root: string,
  consumerEntry: string,
  target: string,
  expectedEntry: string,
) {
  const requireFromRoot = createRequire(resolve(root, "package.json"));
  const requireFromConsumer = createRequire(requireFromRoot.resolve(consumerEntry));
  if ((await realpath(requireFromConsumer.resolve(target))) !== (await realpath(expectedEntry)))
    throw new Error("PATCH_CONSUMER_RESOLVES_DIFFERENT_COPY");
}
/** Reject path/mode changes before an offline test reconstructs the registry baseline. */
export function patchFilePaths(source: string) {
  if (
    /^(?:new file mode|deleted file mode|old mode|new mode|rename |copy |GIT binary patch)/m.test(
      source,
    )
  )
    throw new Error("PATCH_MODE_OR_RENAME_FORBIDDEN");
  const paths: string[] = [];
  for (const line of source.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git a\/(\S+) b\/(\S+)$/);
      if (!match?.[1] || match[1] !== match[2] || !safePath.safeParse(match[1]).success)
        throw new Error("PATCH_PATH_FORBIDDEN");
      paths.push(match[1]);
    }
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      const match = line.match(/^(?:--- a|\+\+\+ b)\/(\S+)$/);
      if (!match || !paths.includes(match[1] ?? "")) throw new Error("PATCH_HEADER_FORBIDDEN");
    }
  }
  if (!paths.length || new Set(paths).size !== paths.length) throw new Error("PATCH_FILES_INVALID");
  return paths.sort();
}
export async function verifyToolchainPatches(root = process.cwd()) {
  await verifyNativeTextInputPatch(root, { bytesHash, packageTreeHash, patchFilePaths });
  await verifyCliZodPatch(root, { bytesHash, packageTreeHash, patchFilePaths });
  const manifest = toolchainPatchManifestSchema.parse(
    JSON.parse(await readFile(resolve(root, "patches/manifest.json"), "utf8")),
  );
  const project = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
    patchedDependencies?: Record<string, string>;
  };
  const lock = Bun.JSONC.parse(await readFile(resolve(root, "bun.lock"), "utf8")) as {
    packages: Record<string, unknown[]>;
    patchedDependencies?: Record<string, string>;
  };
  if (
    new Set(manifest.packages.map((item) => item.name)).size !== 2 ||
    JSON.stringify(Object.keys(project.patchedDependencies ?? {}).sort()) !==
      JSON.stringify(["braces@3.0.3", "node-forge@1.4.0", "react-native@0.88.0", "zod@3.25.76"]) ||
    JSON.stringify(Object.keys(lock.patchedDependencies ?? {}).sort()) !==
      JSON.stringify(["braces@3.0.3", "node-forge@1.4.0", "react-native@0.88.0", "zod@3.25.76"])
  )
    throw new Error("PATCH_PACKAGE_SET_CHANGED");
  for (const item of manifest.packages) {
    const key = `${item.name}@${item.version}`,
      expectedVersion = item.name === "braces" ? "3.0.3" : "1.4.0";
    if (
      item.version !== expectedVersion ||
      item.patch !== `patches/${key}.patch` ||
      project.patchedDependencies?.[key] !== item.patch ||
      lock.patchedDependencies?.[key] !== item.patch ||
      lock.packages[item.name]?.[0] !== key ||
      lock.packages[item.name]?.[3] !== item.registryIntegrity
    )
      throw new Error("PATCH_LOCK_OR_VERSION_CHANGED");
    const directConsumers = Object.entries(lock.packages)
      .filter(([, record]) => {
        const metadata = record[2] as
          | { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }
          | undefined;
        return Boolean(
          metadata?.dependencies?.[item.name] || metadata?.optionalDependencies?.[item.name],
        );
      })
      .map(([name]) => name)
      .sort();
    if (
      JSON.stringify(directConsumers) !==
      JSON.stringify(item.consumers.map((consumer) => consumer.name).sort())
    )
      throw new Error("PATCH_CONSUMER_SET_CHANGED");
    const pkgRoot = resolve(root, "node_modules", item.name),
      pkg = JSON.parse(await readFile(resolve(pkgRoot, "package.json"), "utf8"));
    if (pkg.name !== item.name || pkg.version !== item.version || pkg.main !== item.entryPoint)
      throw new Error("PATCH_ENTRYPOINT_CHANGED");
    for (const consumer of item.consumers) {
      const consumerRoot = resolve(root, "node_modules", consumer.name);
      const consumerPackage = JSON.parse(
        await readFile(resolve(consumerRoot, "package.json"), "utf8"),
      );
      if (
        consumerPackage.name !== consumer.name ||
        consumerPackage.version !== consumer.version ||
        lock.packages[consumer.name]?.[0] !== `${consumer.name}@${consumer.version}`
      )
        throw new Error("PATCH_CONSUMER_VERSION_CHANGED");
      const consumerEntry = createRequire(resolve(root, "package.json")).resolve(consumer.name);
      if (
        (await realpath(consumerEntry)) !==
        (await realpath(resolve(consumerRoot, consumer.entryPoint)))
      )
        throw new Error("PATCH_CONSUMER_ENTRY_CHANGED");
      await assertConsumerPatchResolution(
        root,
        consumer.name,
        item.name,
        resolve(pkgRoot, item.entryPoint),
      );
    }
    const patch = await readFile(resolve(root, item.patch), "utf8");
    if (
      bytesHash(patch) !== item.patchSha256 ||
      JSON.stringify(patchFilePaths(patch)) !==
        JSON.stringify(item.changes.map((file) => file.path).sort())
    )
      throw new Error("PATCH_BYTES_OR_SCOPE_CHANGED");
    if (
      (await packageTreeHash(pkgRoot)) !== item.afterTreeSha256 ||
      bytesHash(await readFile(resolve(pkgRoot, "LICENSE"))) !== item.licenseSha256
    )
      throw new Error("PATCH_INSTALLED_TREE_OR_LICENSE_CHANGED");
    for (const file of item.changes)
      if (bytesHash(await readFile(resolve(pkgRoot, file.path))) !== file.afterSha256)
        throw new Error("PATCH_INSTALLED_POSTIMAGE_CHANGED");
    for (const file of item.unmodifiedBrowserDistributions)
      if (bytesHash(await readFile(resolve(pkgRoot, file.path))) !== file.sha256)
        throw new Error("PATCH_BROWSER_RESIDUAL_CHANGED");
  }
  return manifest;
}
