import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { verifyJestConfigVendor } from "../scripts/jest-config-vendor";
import { bytesHash, patchFilePaths } from "../scripts/toolchain-patches";
import { registryPackageTreeHash } from "../scripts/upstream-toolchain";

const root = process.cwd(),
  inputs = { bytesHash, patchFilePaths };

test("Jest replacement attests upstream provenance, local and installed bytes, both real consumers and the complete graph", async () => {
  const manifest = await verifyJestConfigVendor(root, inputs);
  expect(manifest.rawAuditRequired).toBe(true);
  expect(manifest.forkVersion).toBe("30.5.2-baro.1");
  expect(manifest.files).toHaveLength(5);
});

test("the local fork reconstructs the exact official tarball and only replaces the two merge consumers", async () => {
  const manifest = await verifyJestConfigVendor(root, inputs);
  const owned = await mkdtemp(resolve(tmpdir(), "baro-jest-preimage-"));
  try {
    await cp(resolve(root, "vendor/jest-config"), owned, { recursive: true });
    const reverse = Bun.spawn(
      [
        "git",
        "-c",
        "core.autocrlf=false",
        "-c",
        "core.eol=lf",
        "apply",
        "--reverse",
        resolve(root, manifest.patch),
      ],
      { cwd: owned, stdout: "ignore", stderr: "ignore" },
    );
    expect(await reverse.exited).toBe(0);
    expect(await registryPackageTreeHash(owned, bytesHash)).toBe(manifest.beforeTreeSha256);
    for (const file of manifest.files)
      expect(bytesHash(await readFile(resolve(owned, file.path)))).toBe(file.beforeSha256);
    const upstream = JSON.parse(await readFile(resolve(owned, "package.json"), "utf8"));
    const expected = {
      ...upstream,
      version: manifest.forkVersion,
      private: true,
      dependencies: { ...upstream.dependencies, "@fastify/deepmerge": "3.2.4" },
    };
    delete expected.devDependencies;
    delete expected.dependencies.deepmerge;
    expect(JSON.parse(await readFile("vendor/jest-config/package.json", "utf8"))).toEqual(expected);
    const source = await readFile(resolve(owned, "build/index.js"), "utf8");
    expect(source.split('require("deepmerge")')).toHaveLength(3);
    expect(await readFile("vendor/jest-config/build/index.js", "utf8")).toBe(
      source
        .replaceAll('require("deepmerge")', 'require("@fastify/deepmerge")({symbols: true})')
        .replace(".default.all([defaults, overrides])", ".default(defaults, overrides)"),
    );
    for (const file of manifest.files.filter(
      (file) => file.path !== "build/index.js" && file.path !== "package.json",
    ))
      expect(file.afterSha256).toBe(file.beforeSha256);
  } finally {
    await rm(owned, { recursive: true, force: true });
  }
});

test("actual Node Jest CLI/core mergeConfig and preset globals preserve compatibility and reject returned-prototype poisoning", async () => {
  const node = Bun.which("node");
  if (!node) throw Error("PINNED_NODE_REQUIRED");
  const child = Bun.spawn([node, "tests/fixtures/toolchain-security/jest-consumer.cjs", root], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(code).toBe(0);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    actualConsumers: 2,
    mergeCompatibility: 7,
    presetGlobals: true,
    prototypePoisoning: "rejected",
    syntheticOnly: true,
  });
});

test.each(["registry", "local"] as const)(
  "a remaining %s deepmerge consumer fails attestation before installed-byte checks",
  async (kind) => {
    const owned = await mkdtemp(resolve(tmpdir(), "baro-jest-graph-"));
    try {
      await mkdir(resolve(owned, "vendor/jest-config"), { recursive: true });
      await mkdir(resolve(owned, "patches"), { recursive: true });
      for (const path of [
        "package.json",
        "vendor/jest-config/package.json",
        "patches/jest-config-vendor.json",
      ])
        await cp(resolve(root, path), resolve(owned, path));
      const lock = Bun.JSONC.parse(await readFile("bun.lock", "utf8"));
      lock.packages["synthetic/leftover"] =
        kind === "registry"
          ? ["deepmerge@4.3.1", "", {}]
          : ["synthetic@file:local", { dependencies: { deepmerge: "4.3.1" } }];
      await writeFile(resolve(owned, "bun.lock"), JSON.stringify(lock));
      await expect(verifyJestConfigVendor(owned, inputs)).rejects.toThrow(
        "JEST_CONFIG_LEGACY_CONSUMER_REMAINS",
      );
    } finally {
      await rm(owned, { recursive: true, force: true });
    }
  },
);
