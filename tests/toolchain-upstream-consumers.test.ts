import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const directory = await mkdtemp(resolve(tmpdir(), "baro-coverage-compatibility-"));
afterAll(() => rm(directory, { recursive: true, force: true }));

test("updated coverage consumer preserves include/exclude, sync/async discovery and Babel instrumentation", async () => {
  for (const file of [
    "src/app.js",
    "src/view.tsx",
    "src/app.test.js",
    "test/helper.js",
    "node_modules/fixture/index.js",
  ])
    await mkdir(resolve(directory, file, ".."), { recursive: true });
  for (const file of [
    "src/app.js",
    "src/view.tsx",
    "src/app.test.js",
    "test/helper.js",
    "node_modules/fixture/index.js",
  ])
    await writeFile(resolve(directory, file), "export const synthetic = 1;\n");
  const TestExclude = require("test-exclude") as new (
    options: Record<string, unknown>,
  ) => {
    shouldInstrument(path: string): boolean;
    globSync(): string[];
    glob(): Promise<string[]>;
  };
  const exclude = new TestExclude({
    cwd: directory,
    include: ["src/**"],
    exclude: ["**/*.test.*"],
    extension: [".js", ".tsx"],
    excludeNodeModules: true,
  });
  expect(exclude.globSync().sort()).toEqual(["src/app.js", "src/view.tsx"]);
  expect((await exclude.glob()).sort()).toEqual(["src/app.js", "src/view.tsx"]);
  for (const [file, expected] of [
    ["src/app.js", true],
    ["src/view.tsx", true],
    ["src/app.test.js", false],
    ["test/helper.js", false],
    ["node_modules/fixture/index.js", false],
  ] as const)
    expect(exclude.shouldInstrument(resolve(directory, file))).toBe(expected);
  const { transformSync } = require("@babel/core") as {
    transformSync(source: string, options: Record<string, unknown>): { code?: string };
  };
  const plugin = require("babel-plugin-istanbul");
  const transform = (file: string) =>
    transformSync("export function add(a, b) { return a + b; }", {
      filename: resolve(directory, file),
      babelrc: false,
      configFile: false,
      plugins: [[plugin, { cwd: directory, include: ["src/**"], exclude: ["**/*.test.*"] }]],
    }).code;
  expect(transform("src/app.js")).toContain("__coverage__");
  expect(transform("src/app.test.js")).not.toContain("__coverage__");
});

test("updated glob honors a pre-aborted signal instead of traversing the fixture tree", async () => {
  const { glob } = require("glob") as {
    glob(pattern: string, options: { cwd: string; signal: AbortSignal }): Promise<string[]>;
  };
  const controller = new AbortController();
  controller.abort();
  await expect(glob("**/*", { cwd: directory, signal: controller.signal })).rejects.toMatchObject({
    name: "AbortError",
  });
});

test("actual Expo, glob and coverage consumers resolve the fixed matcher and filesystem majors", () => {
  for (const consumer of ["glob", "@expo/fingerprint", "test-exclude"]) {
    const from = createRequire(require.resolve(`${consumer}/package.json`));
    expect(from("minimatch/package.json").version).toBe("11.0.4");
  }
  for (const consumer of ["@expo/cli", "@expo/config", "test-exclude", "jest-config"]) {
    const from = createRequire(require.resolve(`${consumer}/package.json`));
    expect(from("glob/package.json").version).toBe("14.0.3");
  }
});
