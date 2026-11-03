import { expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  assertConsumerPatchResolution,
  bytesHash,
  packageTreeHash,
} from "../scripts/toolchain-patches";
import { verifyUpstreamToolchain } from "../scripts/upstream-toolchain";

const root = process.cwd();
const inputs = { bytesHash, packageTreeHash, assertConsumerPatchResolution };
async function probe(mode: string, path: string) {
  const node = Bun.which("node");
  if (!node) throw Error("NODE_RUNTIME_REQUIRED");
  const child = Bun.spawn(
    [
      node,
      "--max-old-space-size=128",
      resolve(root, "tests/fixtures/toolchain-security/probe.cjs"),
      mode,
      path,
    ],
    { stdout: "pipe", stderr: "ignore", env: { PATH: process.env.PATH, NODE_ENV: "test" } },
  );
  const timer = setTimeout(() => child.kill(), 10000);
  try {
    const output = await new Response(child.stdout).text();
    if ((await child.exited) || output.length > 8192) throw Error("SYNTHETIC_FORGE_PROBE_FAILED");
    return JSON.parse(output) as {
      mode: string;
      malformed: Record<string, string>;
      compatibility: Record<string, string | boolean>;
    };
  } finally {
    clearTimeout(timer);
  }
}

test("official forge includes both browser distributions and preserves the historical vendor patch evidence", async () => {
  const manifest = await verifyUpstreamToolchain(root, inputs);
  expect(manifest.packages.find((p) => p.name === "node-forge")?.version).toBe("1.4.2");
  expect(manifest.retired.map((p) => p.path)).toContain("patches/node-forge@1.4.0.patch");
  expect(manifest.retired.map((p) => p.path)).toContain("patches/archive/2026-10-27-manifest.json");
});

test("official CJS and both browser distributions reject every retained ASN.1 attack and preserve signatures/certificate/CSR APIs", async () => {
  const installed = resolve(root, "node_modules/node-forge");
  const cjs = await probe("forge", installed);
  for (const result of [
    cjs,
    await probe("forge-browser", resolve(installed, "dist/forge.min.js")),
    await probe("forge-browser", resolve(installed, "dist/forge.all.min.js")),
  ]) {
    expect(Object.keys(result.malformed)).toHaveLength(7);
    expect(new Set(Object.values(result.malformed))).toEqual(new Set(["rejected"]));
    expect(result.compatibility).toEqual(cjs.compatibility);
    expect(result.compatibility).toMatchObject({
      "sha256:null": "accepted",
      "sha256:omitted": "accepted",
      "md5:null": "accepted",
      "md5:omitted": "rejected",
      selfSignedCertificate: true,
      certificateSigningRequest: true,
    });
  }
}, 30000);
