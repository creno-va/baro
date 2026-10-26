import { afterAll, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  cliZodPackageDirectory,
  cliZodPatchSchema,
  verifyCliZodPatch,
} from "../scripts/cli-zod-patch";
import { bytesHash, packageTreeHash, patchFilePaths } from "../scripts/toolchain-patches";

const root = process.cwd();
const temporary = await mkdtemp(resolve(tmpdir(), "baro-cli-zod-patch-"));
afterAll(() => rm(temporary, { recursive: true, force: true }));
async function run(args: string[], cwd = root) {
  const child = Bun.spawn(args, {
    cwd,
    stdout: "pipe",
    stderr: "ignore",
    env: { PATH: process.env.PATH, NODE_ENV: "test" },
  });
  const timeout = setTimeout(() => child.kill(), 7500);
  try {
    const output = await new Response(child.stdout).text();
    if (await child.exited) throw Error("SYNTHETIC_ZOD_PROBE_FAILED");
    if (output.length > 16384) throw Error("SYNTHETIC_ZOD_PROBE_OUTPUT_BOUND");
    return output;
  } finally {
    clearTimeout(timeout);
  }
}
type Probe = {
  kind: string;
  networkStarted: boolean;
  providerCalled: boolean;
  results: {
    oversized: {
      kind: string;
      async: boolean;
      rejected: boolean;
      visits: number;
      issues: number;
      code: string;
    }[];
    compatibility: {
      async: boolean;
      accepted: boolean;
      output: unknown;
      issues: { code: string; path: (string | number)[] }[];
      visits: number;
    }[];
  }[];
};
const inputs = { bytesHash, packageTreeHash, patchFilePaths };

test("CLI Zod3 patch retains the exact consumer, version, lock, all installed bytes and license independently of product Zod4", async () => {
  const manifest = await verifyCliZodPatch(root, inputs);
  expect(manifest.rawAuditRequired).toBe(true);
  expect(manifest.unboundedCollectionsFixed).toBe(false);
  expect(manifest.bundledV4Fixed).toBe(false);
  expect(manifest.changes).toHaveLength(3);
  for (const change of [
    { rawAuditRequired: false },
    { unboundedCollectionsFixed: true },
    { bundledV4Fixed: true },
    { packageVersion: "4.6.6" },
    { coverage: "all-validators" },
  ])
    expect(cliZodPatchSchema.safeParse({ ...manifest, ...change }).success).toBe(false);
  await expect(
    verifyCliZodPatch(root, { ...inputs, packageTreeHash: async () => "0".repeat(64) }),
  ).rejects.toThrow("CLI_ZOD_PATCH_BYTES_CHANGED");
});

test("original CJS and ESM parse every oversized element; the backport rejects before sync/async traversal and preserves valid CLI shapes", async () => {
  const manifest = await verifyCliZodPatch(root, inputs);
  const installed = await cliZodPackageDirectory(root);
  const original = resolve(temporary, "original");
  await cp(installed, original, { recursive: true });
  await run(
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
    original,
  );
  expect(await packageTreeHash(original)).toBe(manifest.beforeTreeSha256);
  for (const file of manifest.changes)
    expect(bytesHash(await readFile(resolve(original, file.path)))).toBe(file.beforeSha256);
  const node = Bun.which("node");
  if (!node) throw Error("NODE_RUNTIME_REQUIRED");
  const probe = async (directory: string) =>
    JSON.parse(
      await run([
        node,
        "--max-old-space-size=128",
        resolve(root, "tests/fixtures/toolchain-security/zod-cap-probe.mjs"),
        directory,
      ]),
    ) as Probe;
  const baseline = await probe(original),
    patched = await probe(installed);
  for (const observation of [baseline, patched]) {
    expect(observation.kind).toBe("bounded-v3-array-set-probe");
    expect(observation.networkStarted).toBe(false);
    expect(observation.providerCalled).toBe(false);
    expect(observation.results).toHaveLength(2);
    expect(observation.results[0]).toEqual(observation.results[1]);
  }
  for (let format = 0; format < 2; format++) {
    const before = baseline.results[format],
      after = patched.results[format];
    if (!before || !after) throw Error("SYNTHETIC_ZOD_PROBE_INCOMPLETE");
    expect(before.oversized).toHaveLength(6);
    expect(after.oversized).toHaveLength(6);
    for (const result of before.oversized)
      expect(result).toMatchObject({ rejected: true, visits: 512, issues: 513, code: "too_big" });
    for (const result of after.oversized)
      expect(result).toMatchObject({ rejected: true, visits: 0, issues: 1, code: "too_big" });
    // Error enumeration changes only for oversized inputs. Accepted values,
    // undersized/within-bound errors, unbounded traversal and catch stay intact.
    expect(after.compatibility.map(({ visits: _visits, ...value }) => value)).toEqual(
      before.compatibility.map(({ visits: _visits, ...value }) => value),
    );
    for (const index of [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12])
      expect(after.compatibility[index]).toEqual(before.compatibility[index]);
    expect(after.compatibility[5]).toMatchObject({ accepted: false, visits: 16 });
    expect(after.compatibility[6]).toMatchObject({ accepted: true, output: [0], visits: 0 });
  }
}, 20000);
