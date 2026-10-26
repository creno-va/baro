import { afterAll, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  assertConsumerPatchResolution,
  bytesHash,
  packageTreeHash,
  patchFilePaths,
  verifyToolchainPatches,
} from "../scripts/toolchain-patches";
import { validationCommands } from "../scripts/validate";

const root = process.cwd(),
  temporary = await mkdtemp(resolve(tmpdir(), "baro-security-patches-"));
afterAll(async () => {
  await rm(temporary, { recursive: true, force: true });
});
async function command(args: string[], cwd: string, env = process.env) {
  const child = Bun.spawn(args, { cwd, env, stdout: "pipe", stderr: "pipe" });
  const timeout = setTimeout(() => child.kill(), 10000);
  try {
    const output = await new Response(child.stdout).text();
    if (await child.exited) throw new Error("SYNTHETIC_SECURITY_COMMAND_FAILED");
    return output;
  } finally {
    clearTimeout(timeout);
  }
}
type Probe = {
  mode: string;
  attacks?: Record<string, string>;
  malformed?: Record<string, string>;
  compatibility: unknown;
  rangeLimitPreserved?: boolean;
};
async function probe(mode: "braces" | "forge", directory: string): Promise<Probe> {
  const node = Bun.which("node");
  if (!node) throw new Error("PINNED_NODE_REQUIRED");
  return JSON.parse(
    await command(
      [
        node,
        "--stack_size=512",
        "--max-old-space-size=128",
        resolve(root, "tests/fixtures/toolchain-security/probe.cjs"),
        mode,
        directory,
      ],
      root,
      { ...process.env, NODE_PATH: resolve(root, "node_modules") },
    ),
  ) as Probe;
}
test("frozen package versions, patch/lock/complete installed tree and original licenses match attested bytes", async () => {
  const manifest = await verifyToolchainPatches(root);
  expect(manifest.rawAuditRequired).toBe(true);
  expect(manifest.packages.map((item) => `${item.name}@${item.version}`)).toEqual([
    "braces@3.0.3",
    "node-forge@1.4.0",
  ]);
  expect(validationCommands("security")[0]).toEqual(["bun", "audit"]);
});
test("registry baseline reconstruction demonstrates original failures and strict patched behavior without changing normal operations", async () => {
  const manifest = await verifyToolchainPatches(root);
  for (const item of manifest.packages) {
    const installed = resolve(root, "node_modules", item.name),
      before = resolve(temporary, item.name);
    await cp(installed, before, { recursive: true });
    // npm tarball bytes are canonical; a Windows Git installation may otherwise
    // rewrite patched LF files to CRLF while reconstructing the original tree.
    await command(
      [
        "git",
        "-c",
        "core.autocrlf=false",
        "-c",
        "core.eol=lf",
        "apply",
        "--reverse",
        resolve(root, item.patch),
      ],
      before,
    );
    expect(await packageTreeHash(before)).toBe(item.beforeTreeSha256);
    for (const file of item.changes)
      expect(bytesHash(await readFile(resolve(before, file.path)))).toBe(file.beforeSha256);
    const mode = item.name === "braces" ? "braces" : "forge";
    const baseline = await probe(mode, before),
      patched = await probe(mode, installed);
    expect(patched.compatibility).toEqual(baseline.compatibility);
    if (mode === "braces") {
      expect(
        Object.values(baseline.attacks ?? {}).filter((value) => value === "stack-overflow").length,
      ).toBeGreaterThanOrEqual(6);
      expect(Object.values(patched.attacks ?? {})).toHaveLength(15);
      expect(new Set(Object.values(patched.attacks ?? {}))).toEqual(new Set(["depth-rejected"]));
      expect(patched.rangeLimitPreserved).toBe(true);
    } else {
      const malformed = [
        "extraChild",
        "garbageInsteadOfNull",
        "repeatedNull",
        "nonemptyNull",
        "constructedNull",
      ];
      for (const field of malformed) {
        expect(baseline.malformed?.[field]).toBe("accepted");
        expect(patched.malformed?.[field]).toBe("rejected");
      }
      expect(patched.malformed?.trailingBytes).toBe("rejected");
      expect(patched.malformed?.wrongDigest).toBe("rejected");
    }
  }
}, 20000);
test("patch paths, mode changes and malformed headers cannot escape the isolated package", () => {
  const valid =
    "diff --git a/lib/rsa.js b/lib/rsa.js\n--- a/lib/rsa.js\n+++ b/lib/rsa.js\n@@ -1 +1 @@\n-a\n+b\n";
  expect(patchFilePaths(valid)).toEqual(["lib/rsa.js"]);
  for (const invalid of [
    valid.replaceAll("lib/rsa.js", "../outside"),
    valid.replace("+++ b/lib/rsa.js", "+++ b/other.js"),
    `${valid}new file mode 120000\n`,
    `${valid}${valid}`,
  ])
    expect(() => patchFilePaths(invalid)).toThrow();
});
test("changed installed bytes and nonempty Bun metadata are rejected instead of accepted as an applied patch", async () => {
  const directory = resolve(temporary, "drift");
  await cp(resolve(root, "node_modules/braces"), directory, { recursive: true });
  const original = await packageTreeHash(directory);
  await writeFile(resolve(directory, ".bun-tag-0000000000000000"), "");
  expect(await packageTreeHash(directory)).toBe(original);
  await writeFile(resolve(directory, ".bun-tag-0000000000000000"), "not empty");
  expect(await packageTreeHash(directory)).not.toBe(original);
  await writeFile(resolve(directory, "lib/compile.js"), "module.exports = () => 'corrupted';");
  expect(await packageTreeHash(directory)).not.toBe(original);
});

test("a consumer resolving a nested unpatched copy fails even when a root patched copy exists", async () => {
  const directory = resolve(temporary, "consumer-resolution");
  const consumer = resolve(directory, "node_modules/consumer");
  const expected = resolve(directory, "node_modules/braces/index.js");
  await mkdir(consumer, { recursive: true });
  await mkdir(resolve(directory, "node_modules/braces"), { recursive: true });
  await writeFile(resolve(directory, "package.json"), "{}");
  await writeFile(resolve(consumer, "index.js"), "module.exports = {};\n");
  await writeFile(expected, "module.exports = 'patched';\n");
  await expect(
    assertConsumerPatchResolution(directory, "consumer", "braces", expected),
  ).resolves.toBeUndefined();
  await mkdir(resolve(consumer, "node_modules/braces"), { recursive: true });
  await writeFile(
    resolve(consumer, "node_modules/braces/index.js"),
    "module.exports = 'unpatched';\n",
  );
  // A fresh Node subprocess avoids the module resolver's cache of the prior positive lookup.
  const node = Bun.which("node");
  if (!node) throw new Error("PINNED_NODE_REQUIRED");
  const resolved = await command(
    [
      node,
      "--input-type=module",
      "-e",
      `import {createRequire} from 'node:module';const r=createRequire(${JSON.stringify(resolve(consumer, "index.js"))});console.log(r.resolve('braces'));`,
    ],
    directory,
  );
  expect(resolved.trim()).not.toBe(expected);
  const secondConsumer = resolve(directory, "node_modules/consumer-second");
  await cp(consumer, secondConsumer, { recursive: true });
  await expect(
    assertConsumerPatchResolution(directory, "consumer-second", "braces", expected),
  ).rejects.toThrow("PATCH_CONSUMER_RESOLVES_DIFFERENT_COPY");
});
