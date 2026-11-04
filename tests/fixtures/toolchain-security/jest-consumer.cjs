const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const { realpathSync, readFileSync } = require("node:fs");
const root = process.argv[2];
if (!root) throw Error("SYNTHETIC_ROOT_REQUIRED");
const project = createRequire(resolve(root, "package.json"));
const configPath = project.resolve("jest-config");
const metadata = JSON.parse(readFileSync(project.resolve("jest-config/package.json"), "utf8"));
assert.equal(metadata.version, "30.5.2-baro.1");
assert.equal(metadata.dependencies.deepmerge, undefined);
assert.equal(metadata.dependencies["@fastify/deepmerge"], "3.2.4");
for (const name of ["@jest/core", "jest-cli"]) {
  const consumer = createRequire(project.resolve(name));
  assert.equal(realpathSync(consumer.resolve("jest-config")), realpathSync(configPath));
}
const config = project("jest-config");
const legacy = require(
  resolve(root, "tests/fixtures/toolchain-security/retired-deepmerge/dist/cjs.js"),
);
const symbol = Symbol("synthetic");
const cases = [
  [
    { globals: { a: { x: 1 } }, roots: ["one"] },
    { globals: { a: { y: 2 } }, roots: ["two"] },
  ],
  [
    { transform: { "^.+$": ["babel-jest", { plugins: ["one"] }] } },
    { transform: { "^.+$": ["ts-jest", { plugins: ["two"] }] } },
  ],
  [{ globals: { a: null, b: [1, { x: 2 }] } }, { globals: { a: { x: 1 }, b: [3, { y: 4 }] } }],
  [{ globals: { a: 1, b: false } }, { globals: { a: undefined, b: 0 } }],
  [{ value: new Date("2026-10-01") }, { matcher: /foo/gi }],
  [{ [symbol]: { a: 1 } }, { [symbol]: { b: 2 } }],
  [Object.assign(Object.create(null), { a: { x: 1 } }), { a: { y: 2 } }],
];
for (const [target, source] of cases) {
  assert.deepStrictEqual(config.mergeConfig(target, source), legacy.all([target, source]));
}
assert.throws(() => config.mergeConfig(() => ({}), {}), TypeError);
for (const target of [
  JSON.parse('{"__proto__":{"syntheticPoison":true},"ok":1}'),
  Object.assign(Object.create(null), JSON.parse('{"__proto__":{"syntheticPoison":true},"ok":1}')),
]) {
  const result = config.mergeConfig(target, { legitimate: true });
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(result.syntheticPoison, undefined);
  assert.equal(result.legitimate, true);
  assert.equal({}.syntheticPoison, undefined);
}
const result = config.mergeConfig(
  {},
  JSON.parse(
    '{"globals":{"__proto__":{"syntheticPoison":true},"constructor":{"prototype":{"syntheticPoison":true}},"safe":1}}',
  ),
);
assert.equal(Object.getPrototypeOf(result.globals), Object.prototype);
assert.equal(result.globals.syntheticPoison, undefined);
assert.equal(result.globals.safe, 1);
assert.equal(Object.hasOwn(result.globals, "constructor"), false);
(async () => {
  const normalized = await config.normalize(
    {
      rootDir: resolve(root, "apps/mobile"),
      preset: resolve(root, "tests/fixtures/toolchain-security/jest-preset.cjs"),
      globals: { baroMergeProbe: { override: true, nested: { b: 2 } } },
    },
    {},
  );
  assert.deepStrictEqual(normalized.options.globals.baroMergeProbe, {
    preset: true,
    override: true,
    nested: { a: 1, b: 2 },
  });
  console.log(
    JSON.stringify({
      actualConsumers: 2,
      mergeCompatibility: cases.length,
      presetGlobals: true,
      prototypePoisoning: "rejected",
      syntheticOnly: true,
    }),
  );
})().catch(() => {
  console.log(JSON.stringify({ failed: true, code: "SYNTHETIC_JEST_CONSUMER_FAILED" }));
  process.exitCode = 1;
});
