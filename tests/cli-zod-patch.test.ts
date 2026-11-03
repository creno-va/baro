import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { cliZodPatchPaths, cliZodPatchSchema } from "../scripts/cli-zod-patch";
import {
  assertConsumerPatchResolution,
  bytesHash,
  packageTreeHash,
  patchFilePaths,
} from "../scripts/toolchain-patches";
import { registryPackageTreeHash, verifyUpstreamToolchain } from "../scripts/upstream-toolchain";

const root = process.cwd();
const temporary = await mkdtemp(resolve(tmpdir(), "baro-upstream-cli-"));
afterAll(() => rm(temporary, { recursive: true, force: true }));
const inputs = { bytesHash, packageTreeHash, assertConsumerPatchResolution };

test("official CLI and forge registry bytes, actual consumers and retired vendor evidence remain attested", async () => {
  const manifest = await verifyUpstreamToolchain(root, inputs);
  expect(manifest.rawAuditRequired).toBe(true);
  expect(manifest.packages.map((p) => `${p.name}@${p.version}`)).toEqual([
    "node-forge@1.4.2",
    "@expo/cli@58.1.18",
  ]);
  expect(manifest.retired.map((p) => p.path)).toContain("patches/zod@3.25.76.patch");
  const lock = Bun.JSONC.parse(await readFile("bun.lock", "utf8")) as {
    packages: Record<string, unknown[]>;
  };
  expect(
    Object.values(lock.packages).some((p) => typeof p[0] === "string" && p[0].startsWith("zod@3.")),
  ).toBe(false);
});

test("historical Zod3 constrained-only patch and its original limitations remain unchanged after the official consumer upgrade", async () => {
  const legacy = cliZodPatchSchema.parse(
    JSON.parse(await readFile("patches/cli-zod.json", "utf8")),
  );
  const patch = await readFile(legacy.patch, "utf8");
  expect(bytesHash(patch)).toBe(legacy.patchSha256);
  expect(patchFilePaths(patch)).toEqual([...cliZodPatchPaths].sort());
  expect(legacy.rawAuditRequired).toBe(true);
  expect(legacy.unboundedCollectionsFixed).toBe(false);
  expect(legacy.bundledV4Fixed).toBe(false);
  expect(legacy.consumerVersion).toBe("58.1.14");
});

test("registry attestation covers all package-owned bytes while dependency resolution stays a separate check", async () => {
  const directory = resolve(temporary, "package");
  await mkdir(resolve(directory, "node_modules/fixture-dependency"), { recursive: true });
  await writeFile(resolve(directory, "index.js"), "module.exports = 'original';\n");
  const original = await registryPackageTreeHash(directory, bytesHash);
  await writeFile(
    resolve(directory, "node_modules/fixture-dependency/index.js"),
    "module.exports = 'dependency';\n",
  );
  expect(await registryPackageTreeHash(directory, bytesHash)).toBe(original);
  await writeFile(resolve(directory, "index.js"), "module.exports = 'altered';\n");
  expect(await registryPackageTreeHash(directory, bytesHash)).not.toBe(original);
  await writeFile(resolve(directory, "extra.js"), "unexpected package-owned file");
  expect(await registryPackageTreeHash(directory, bytesHash)).not.toBe(original);
});
