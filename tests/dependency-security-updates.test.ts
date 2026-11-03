import { expect, test } from "bun:test";
import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

async function resolved(consumerManifest: string, dependency: string) {
  const require = createRequire(resolve(consumerManifest)),
    path = require.resolve(`${dependency}/package.json`);
  return { path: await realpath(path), package: JSON.parse(await readFile(path, "utf8")) };
}
test("root/shared contracts/API client resolve fixed Zod4 and the upgraded CLI no longer declares Zod3", async () => {
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
  const cli = JSON.parse(await readFile("node_modules/@expo/cli/package.json", "utf8"));
  expect(cli.version).toBe("58.1.18");
  expect(cli.dependencies.zod).toBeUndefined();
  const cliResolved = await resolved("node_modules/@expo/cli/package.json", "zod");
  expect(cliResolved.package.version).toBe("4.6.6");
  expect(paths.has(cliResolved.path)).toBe(true);
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
