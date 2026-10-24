import { expect, test } from "bun:test";
import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

async function resolved(consumerManifest: string, dependency: string) {
  const require = createRequire(resolve(consumerManifest)),
    path = require.resolve(`${dependency}/package.json`);
  return { path: await realpath(path), package: JSON.parse(await readFile(path, "utf8")) };
}
test("root/shared contracts/API client resolve one fixed Zod4 runtime while Expo CLI keeps its existing major", async () => {
  const paths = new Set<string>();
  for (const manifest of [
    "package.json",
    "src/contracts/package.json",
    "packages/api-client/package.json",
  ]) {
    const result = await resolved(manifest, "zod");
    expect(result.package.version).toBe("4.6.6");
    paths.add(result.path);
  }
  expect(paths.size).toBe(1);
  const cli = await resolved("node_modules/@expo/cli/package.json", "zod");
  expect(cli.package.version).toMatch(/^3\./);
  expect(paths.has(cli.path)).toBe(false);
});
test("actual URI consumers receive fixed versions within their required major families", async () => {
  for (const [consumer, dependency, version] of [
    ["ajv", "fast-uri", "3.1.9"],
    ["miniflare", "undici", "7.30.1"],
    ["unifont", "undici", "8.12.2"],
  ] as const) {
    const result = await resolved(`node_modules/${consumer}/package.json`, dependency);
    expect(result.package.name).toBe(dependency);
    expect(result.package.version).toBe(version);
  }
});
