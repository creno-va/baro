import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const cliZodPatchPaths = ["src/v3/types.ts", "v3/types.cjs", "v3/types.js"] as const;
export const cliZodPatchSchema = z
  .strictObject({
    version: z.literal(1),
    package: z.literal("zod"),
    packageVersion: z.literal("3.25.76"),
    consumer: z.literal("@expo/cli"),
    consumerVersion: z.literal("58.1.14"),
    registryIntegrity: z.string().regex(/^sha512-[A-Za-z0-9+/=]+$/),
    patch: z.literal("patches/zod@3.25.76.patch"),
    patchSha256: hash,
    beforeTreeSha256: hash,
    afterTreeSha256: hash,
    licenseSha256: hash,
    source: z.literal(
      "https://github.com/colinhacks/zod/commit/a0ebf970f2d752e5f58527cd2942ff48be4f46bd",
    ),
    coverage: z.literal("v3-constrained-array-set-upper-bounds-only"),
    rawAuditRequired: z.literal(true),
    unboundedCollectionsFixed: z.literal(false),
    bundledV4Fixed: z.literal(false),
    changes: z
      .array(
        z.strictObject({ path: z.enum(cliZodPatchPaths), beforeSha256: hash, afterSha256: hash }),
      )
      .length(3),
  })
  .refine((value) => new Set(value.changes.map((change) => change.path)).size === 3);

export async function cliZodPackageDirectory(root: string) {
  const cliRequire = createRequire(resolve(root, "node_modules/@expo/cli/package.json"));
  const packagePath = await realpath(cliRequire.resolve("zod/package.json"));
  const boundary = relative(await realpath(resolve(root, "node_modules")), packagePath);
  if (isAbsolute(boundary) || boundary === ".." || boundary.startsWith(`..${sep}`))
    throw Error("CLI_ZOD_PACKAGE_OUTSIDE_INSTALL");
  return dirname(packagePath);
}

export async function verifyCliZodPatch(
  root: string,
  inputs: {
    bytesHash(value: Uint8Array | string): string;
    packageTreeHash(directory: string): Promise<string>;
    patchFilePaths(source: string): string[];
  },
) {
  const manifest = cliZodPatchSchema.parse(
    JSON.parse(await readFile(resolve(root, "patches/cli-zod.json"), "utf8")),
  );
  const project = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const lock = Bun.JSONC.parse(await readFile(resolve(root, "bun.lock"), "utf8")) as {
    packages: Record<string, unknown[]>;
    patchedDependencies?: Record<string, string>;
  };
  const directory = await cliZodPackageDirectory(root);
  const pkg = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
  const cli = JSON.parse(
    await readFile(resolve(root, "node_modules/@expo/cli/package.json"), "utf8"),
  );
  const key = `${manifest.package}@${manifest.packageVersion}`;
  if (
    project.patchedDependencies?.[key] !== manifest.patch ||
    lock.patchedDependencies?.[key] !== manifest.patch ||
    lock.packages["@expo/cli/zod"]?.[0] !== key ||
    lock.packages["@expo/cli/zod"]?.[3] !== manifest.registryIntegrity ||
    lock.packages[manifest.consumer]?.[0] !== `${manifest.consumer}@${manifest.consumerVersion}` ||
    cli.name !== manifest.consumer ||
    cli.version !== manifest.consumerVersion ||
    cli.dependencies?.zod !== "^3.25.76" ||
    pkg.name !== manifest.package ||
    pkg.version !== manifest.packageVersion ||
    pkg.main !== "./index.cjs" ||
    pkg.module !== "./index.js" ||
    JSON.stringify(
      Object.entries(lock.packages)
        .filter(([, record]) => Array.isArray(record) && record[0] === key)
        .map(([name]) => name),
    ) !== JSON.stringify(["@expo/cli/zod"])
  )
    throw Error("CLI_ZOD_PATCH_VERSION_OR_CONSUMER_CHANGED");
  const cliRequire = createRequire(resolve(root, "node_modules/@expo/cli/package.json"));
  const mainRequire = createRequire(resolve(root, "package.json"));
  if (
    (await realpath(cliRequire.resolve("zod"))) !==
      (await realpath(resolve(directory, "index.cjs"))) ||
    (await realpath(mainRequire.resolve("zod/package.json"))) ===
      (await realpath(resolve(directory, "package.json")))
  )
    throw Error("CLI_ZOD_PATCH_RESOLUTION_CHANGED");
  const patch = await readFile(resolve(root, manifest.patch), "utf8");
  if (
    inputs.bytesHash(patch) !== manifest.patchSha256 ||
    JSON.stringify(inputs.patchFilePaths(patch)) !== JSON.stringify([...cliZodPatchPaths].sort()) ||
    (await inputs.packageTreeHash(directory)) !== manifest.afterTreeSha256 ||
    inputs.bytesHash(await readFile(resolve(directory, "LICENSE"))) !== manifest.licenseSha256
  )
    throw Error("CLI_ZOD_PATCH_BYTES_CHANGED");
  for (const file of manifest.changes)
    if (inputs.bytesHash(await readFile(resolve(directory, file.path))) !== file.afterSha256)
      throw Error("CLI_ZOD_PATCH_POSTIMAGE_CHANGED");
  return manifest;
}
