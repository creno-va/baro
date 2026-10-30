// The native PDF job covers report/export behavior. Full-project regressions
// remain in validate:full instead of repeating all domains for every PDF change.
const files: string[] = [];
for await (const path of new Bun.Glob("tests/**/*report*.test.ts").scan("."))
  files.push(path.replaceAll("\\", "/"));
if (!files.length) throw new Error("REPORT_REGRESSION_TESTS_MISSING");
const targets = [...new Set([...files, "tests/fsd-feedback.test.ts"])].sort();
console.info(`Report and export regressions: ${targets.length} test files`);
const child = Bun.spawn(["bun", "test", ...targets], { stdout: "inherit", stderr: "inherit" });
process.exitCode = await child.exited;

export {};
