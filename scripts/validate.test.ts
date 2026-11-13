import { expect, test } from "bun:test";
import { resolve, sep } from "node:path";
import { executeValidation, validationCommands, validationProfiles } from "./validate";

test("quick validation never builds, starts browsers, containers, remote calls or broad tests", () => {
  const commands = validationCommands("quick");
  expect(commands).toContainEqual(["bun", "run", "typecheck"]);
  expect(commands).toContainEqual(["bun", "test", "tests/headless-ui-ssr.test.tsx"]);
  expect(commands).toContainEqual(["bun", "test", "tests/theme-palette.test.ts"]);
  expect(commands).toContainEqual(["bun", "run", "lint"]);
  expect(commands.some((command) => command.includes("tests/native-auth-codes.test.ts"))).toBe(
    true,
  );
  expect(commands.some((command) => command.includes("tests/native-auth-http.test.ts"))).toBe(true);
  expect(commands.some((command) => command.includes("tests/legacy-analysis-ledger.test.ts"))).toBe(
    true,
  );
  expect(
    commands.some((command) => command.includes("tests/gemini-native-structure.test.ts")),
  ).toBe(true);
  expect(commands.some((command) => command.includes("tests/gemini-native-legacy.test.ts"))).toBe(
    true,
  );
  expect(commands.some((command) => command.includes("tests/preview-legacy-fixture.test.ts"))).toBe(
    true,
  );
  expect(commands).not.toContainEqual(["bun", "test"]);
  expect(commands.flat().join(" ")).not.toMatch(
    /playwright|docker|wrangler|audit|gitleaks|build|deploy\.ts/,
  );
  expect(() => validationCommands("typo")).toThrow("Unknown validation profile");
});

test("explicit profiles preserve full browser, database, native and security coverage", () => {
  for (const profile of validationProfiles)
    expect(validationCommands(profile).length).toBeGreaterThan(0);
  const root = resolve("scratch", "project with spaces");
  const full = validationCommands("full", root);
  expect(full).toContainEqual(["bun", "test"]);
  expect(full).toContainEqual(["bun", "scripts/full-browser.ts"]);
  expect(full).toContainEqual(["bun", "run", "eval:offline"]);
  expect(full).toContainEqual(["bun", "run", "db:check"]);
  expect(full).toContainEqual(["bun", "run", "test:csp"]);
  expect(full).toContainEqual(["bun", "run", "cf:dry-run"]);
  expect(full.filter((command) => command.includes("build:production"))).toHaveLength(1);
  for (const script of [
    "report-test.py",
    "office-security-test.py",
    "heif-fixture-test.py",
    "office-fixture-test.py",
  ])
    expect(full.some((command) => command.at(-1) === `/app/${script}`)).toBe(true);
  for (const command of full.filter((command) => command[0] === "docker" && command[1] === "run")) {
    expect(command).toContain("none");
    expect(command).toContain("--pids-limit");
    expect(command.some((arg) => arg.startsWith(`${root}${sep}`))).toBe(true);
  }
});

test("validation preserves failure and never runs later commands after a failed check", async () => {
  const observed: string[][] = [];
  const code = await executeValidation(
    [["first"], ["fails"], ["must-not-run"]],
    async (command) => {
      observed.push(command);
      return command[0] === "fails" ? 7 : 0;
    },
  );
  expect(code).toBe(7);
  expect(observed).toEqual([["first"], ["fails"]]);
});

test("full sections retain every full command and keep browser build and native limits", () => {
  const root = resolve("scratch", "project with spaces");
  const full = validationCommands("full", root);
  const sections = ["full-core", "full-browser", "full-native"].flatMap((profile) =>
    validationCommands(profile, root),
  );
  const key = (commands: string[][]) => commands.map((c) => JSON.stringify(c)).sort();
  expect(key(sections)).toEqual(key([...full, ...validationCommands("build", root)]));
  const browserStart = full.findIndex((c) => c[1] === "scripts/full-browser.ts");
  const securityStart = full.findIndex((c) => c[1] === "audit");
  const nativeStart = full.findIndex((c) => c[0] === "docker");
  expect(validationCommands("full-core", root)).toEqual([
    ...full.slice(0, browserStart),
    ...full.slice(securityStart, nativeStart),
  ]);
  expect(full.filter((c) => c[1] === "scripts/apply-d1-migrations.ts")).toHaveLength(2);
  expect(validationCommands("full-browser", root)).toContainEqual(["bun", "run", "test:csp"]);
  expect(validationCommands("full-browser", root)).toContainEqual([
    "bun",
    "run",
    "build:production",
  ]);
  expect(validationCommands("full-core", root)).toContainEqual(["bun", "audit"]);
  expect(validationCommands("full-native", root)).toEqual(validationCommands("native", root));
});
