import { lstat, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const path = z
  .string()
  .regex(/^[A-Za-z0-9_./@-]+$/)
  .refine((p) => !p.startsWith("/") && !p.split("/").includes(".."));
const schema = z.strictObject({
  version: z.literal(1),
  rawAuditRequired: z.literal(true),
  packages: z
    .array(
      z.strictObject({
        name: z.enum(["node-forge", "@expo/cli"]),
        version: z.string(),
        registryIntegrity: z.string().regex(/^sha512-[A-Za-z0-9+/=]+$/),
        treeSha256: hash,
        licenseSha256: hash,
        entryPoint: path,
        consumers: z
          .array(z.strictObject({ name: path, version: z.string(), entryPoint: path }))
          .min(1),
      }),
    )
    .length(2),
  retired: z.array(z.strictObject({ path, sha256: hash })).min(4),
});

/** npm-owned bytes only: installed dependency directories are not tarball files.
 * Their versions remain in raw audit/lock validation and security consumers are
 * resolved separately below. No existing vendor-patch tree check is relaxed. */
export async function registryPackageTreeHash(
  directory: string,
  hashBytes: (value: Uint8Array | string) => string,
) {
  const files: { path: string; sha256: string }[] = [];
  async function visit(path: string, relative: string) {
    const entries = (await readdir(path)).sort();
    for (const name of entries) {
      if (!relative && name === "node_modules") continue;
      const full = resolve(path, name),
        metadata = await lstat(full);
      if (
        !relative &&
        /^\.bun-tag-[a-f0-9]{16}$/.test(name) &&
        metadata.isFile() &&
        metadata.size === 0
      )
        continue;
      const local = relative ? `${relative}/${name}` : name;
      if (metadata.isDirectory()) await visit(full, local);
      else if (metadata.isFile())
        files.push({ path: local, sha256: hashBytes(await readFile(full)) });
      else throw Error("UPSTREAM_PACKAGE_NONREGULAR_ENTRY");
    }
  }
  await visit(directory, "");
  return hashBytes(
    files
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((f) => `${f.path}\0${f.sha256}\n`)
      .join(""),
  );
}
export async function verifyUpstreamToolchain(
  root: string,
  inputs: {
    bytesHash(value: Uint8Array | string): string;
    packageTreeHash(directory: string): Promise<string>;
    assertConsumerPatchResolution(
      root: string,
      consumerEntry: string,
      target: string,
      expectedEntry: string,
    ): Promise<void>;
  },
) {
  const manifest = schema.parse(
    JSON.parse(await readFile(resolve(root, "patches/upstream.json"), "utf8")),
  );
  const project = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const lock = Bun.JSONC.parse(await readFile(resolve(root, "bun.lock"), "utf8")) as {
    packages: Record<string, unknown[]>;
    patchedDependencies?: Record<string, string>;
  };
  const expected = { "node-forge": "1.4.3", "@expo/cli": "58.1.18" };
  if (new Set(manifest.packages.map((p) => p.name)).size !== 2)
    throw Error("UPSTREAM_PACKAGE_SET_CHANGED");
  for (const item of manifest.packages) {
    const directory = resolve(root, "node_modules", item.name);
    const metadata = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
    if (
      item.version !== expected[item.name] ||
      metadata.name !== item.name ||
      metadata.version !== item.version ||
      lock.packages[item.name]?.[0] !== `${item.name}@${item.version}` ||
      lock.packages[item.name]?.[3] !== item.registryIntegrity ||
      Object.keys(project.patchedDependencies ?? {}).some((key) =>
        key.startsWith(`${item.name}@`),
      ) ||
      Object.keys(lock.patchedDependencies ?? {}).some((key) => key.startsWith(`${item.name}@`)) ||
      (await registryPackageTreeHash(directory, inputs.bytesHash)) !== item.treeSha256 ||
      inputs.bytesHash(await readFile(resolve(directory, "LICENSE"))) !== item.licenseSha256
    )
      throw Error("UPSTREAM_PACKAGE_BYTES_OR_VERSION_CHANGED");
    for (const consumer of item.consumers) {
      const consumerMetadata = JSON.parse(
        await readFile(resolve(root, "node_modules", consumer.name, "package.json"), "utf8"),
      );
      if (
        consumerMetadata.version !== consumer.version ||
        lock.packages[consumer.name]?.[0] !== `${consumer.name}@${consumer.version}`
      )
        throw Error("UPSTREAM_CONSUMER_CHANGED");
      await inputs.assertConsumerPatchResolution(
        root,
        resolve(root, "node_modules", consumer.name, consumer.entryPoint),
        item.name,
        resolve(directory, item.entryPoint),
      );
    }
  }
  // The upgraded CLI uses JSON Schema and receives the MCP host's validator.
  // No obsolete private Zod3 copy may silently survive the frozen install.
  const cli = JSON.parse(
    await readFile(resolve(root, "node_modules/@expo/cli/package.json"), "utf8"),
  );
  if (
    cli.dependencies?.zod ||
    Object.values(lock.packages).some((p) => typeof p[0] === "string" && /^zod@3\./.test(p[0]))
  )
    throw Error("CLI_LEGACY_ZOD_RETAINED");
  for (const item of manifest.retired)
    if (inputs.bytesHash(await readFile(resolve(root, item.path))) !== item.sha256)
      throw Error("HISTORICAL_PATCH_EVIDENCE_CHANGED");
  return manifest;
}
