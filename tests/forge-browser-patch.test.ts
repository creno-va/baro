import { afterAll, expect, test } from "bun:test";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { packageTreeHash, verifyToolchainPatches } from "../scripts/toolchain-patches";

const root = process.cwd();
const temporary = await mkdtemp(resolve(tmpdir(), "baro-forge-browser-"));
afterAll(() => rm(temporary, { recursive: true, force: true }));
async function command(args: string[], cwd = root) {
  const child = Bun.spawn(args, {
    cwd,
    stdout: "pipe",
    stderr: "ignore",
    env: { PATH: process.env.PATH, NODE_ENV: "test" },
  });
  const timeout = setTimeout(() => child.kill(), 10000);
  try {
    const output = await new Response(child.stdout).text();
    if ((await child.exited) || output.length > 8192)
      throw Error("SYNTHETIC_BROWSER_FORGE_PROBE_FAILED");
    return output;
  } finally {
    clearTimeout(timeout);
  }
}
type Probe = {
  mode: string;
  malformed: Record<string, string>;
  compatibility: Record<string, string | boolean>;
};

test("forge attestation covers the CommonJS and both original browser RSA entries, with untouched worker/map bytes explicit", async () => {
  const manifest = await verifyToolchainPatches(root);
  const forge = manifest.packages.find((item) => item.name === "node-forge");
  expect(forge?.coverage).toBe("commonjs-and-browser-rsa-verifier");
  expect(forge?.changes.map((file) => file.path).sort()).toEqual([
    "dist/forge.all.min.js",
    "dist/forge.min.js",
    "lib/rsa.js",
  ]);
  expect(forge?.unmodifiedBrowserDistributions.map((file) => file.path).sort()).toEqual([
    "dist/forge.all.min.js.map",
    "dist/forge.min.js.map",
    "dist/prime.worker.min.js",
    "dist/prime.worker.min.js.map",
  ]);
  expect(manifest.rawAuditRequired).toBe(true);
});

test("both browser distributions reject the original nested DigestInfo gaps while preserving valid signatures, certificate and CSR APIs", async () => {
  const manifest = await verifyToolchainPatches(root);
  const forge = manifest.packages.find((item) => item.name === "node-forge");
  if (!forge) throw Error("FORGE_MANIFEST_REQUIRED");
  const installed = resolve(root, "node_modules/node-forge"),
    original = resolve(temporary, "original");
  await cp(installed, original, { recursive: true });
  await command(
    [
      "git",
      "-c",
      "core.autocrlf=false",
      "-c",
      "core.eol=lf",
      "apply",
      "--reverse",
      resolve(root, forge.patch),
    ],
    original,
  );
  expect(await packageTreeHash(original)).toBe(forge.beforeTreeSha256);
  const node = Bun.which("node");
  if (!node) throw Error("NODE_RUNTIME_REQUIRED");
  const probe = async (path: string) =>
    JSON.parse(
      await command([
        node,
        "--max-old-space-size=128",
        resolve(root, "tests/fixtures/toolchain-security/probe.cjs"),
        "forge-browser",
        path,
      ]),
    ) as Probe;
  for (const file of ["forge.min.js", "forge.all.min.js"]) {
    const before = await probe(resolve(original, "dist", file)),
      after = await probe(resolve(installed, "dist", file));
    expect(before.mode).toBe("forge-browser");
    expect(after.mode).toBe("forge-browser");
    expect(after.compatibility).toEqual(before.compatibility);
    expect(after.compatibility).toMatchObject({
      "sha256:null": "accepted",
      "sha256:omitted": "accepted",
      "md5:null": "accepted",
      "md5:omitted": "rejected",
      selfSignedCertificate: true,
      certificateSigningRequest: true,
    });
    for (const shape of [
      "extraChild",
      "garbageInsteadOfNull",
      "repeatedNull",
      "nonemptyNull",
      "constructedNull",
    ]) {
      expect(before.malformed[shape]).toBe("accepted");
      expect(after.malformed[shape]).toBe("rejected");
    }
    for (const shape of ["trailingBytes", "wrongDigest"]) {
      expect(before.malformed[shape]).toBe("rejected");
      expect(after.malformed[shape]).toBe("rejected");
    }
  }
}, 30000);
