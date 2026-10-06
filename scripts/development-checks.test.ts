import { expect, test } from "bun:test";
import { browserTargets, unitTargets, validationScope } from "./development-checks";

const browserTests = [...new Bun.Glob("tests/browser/*.e2e.ts").scanSync(".")];
const unitTests = [...new Bun.Glob("{tests,scripts,src}/**/*.test.ts").scanSync(".")];

test("source-only authentication and file changes run existing consumer tests", async () => {
  const auth = await unitTargets(["src/server/auth/session.ts"], unitTests);
  expect(auth).toContain("tests/auth-lifecycle.test.ts");
  const files = await unitTargets(["src/server/modules/files/service.ts"], unitTests);
  expect(files).toContain("tests/files-service.test.ts");
  expect(files).toContain("tests/v2-files-api.test.ts");
  expect(files.some((path) => path.startsWith("tests/evals/"))).toBe(false);
});

test("v2 schema and repository changes cannot skip the migration gate", () => {
  for (const file of [
    "src/server/db/v2-schema.ts",
    "src/server/db/v2-storage-capacity-schema.ts",
    "drizzle/0009_storage_capacity_maintenance.sql",
    "scripts/apply-d1-migrations.ts",
  ])
    expect(validationScope([file]).database).toBe(true);
  expect(validationScope(["src/components/intake/CaseInput.tsx"]).database).toBe(false);
});

test("case pages and input islands select existing browser flows, including the workspace flow", () => {
  for (const file of [
    "src/pages/cases/new.astro",
    "src/components/intake/CaseInput.tsx",
    "src/components/workspace/Chat.tsx",
  ]) {
    const selected = browserTargets([file], browserTests);
    expect(selected).toContain("tests/browser/cases.e2e.ts");
    expect(selected).toContain("tests/browser/analysis.e2e.ts");
    expect(selected).toContain("tests/browser/workspace.e2e.ts");
  }
  expect(browserTargets(["src/server/auth/session.ts"], browserTests)).toContain(
    "tests/browser/session.e2e.ts",
  );
});

test("shared UI excludes corpus flows and a missing feature test fails explicitly", () => {
  for (const file of ["src/styles/shell.css", "src/pages/index.astro"])
    expect(browserTargets([file], browserTests)).toContain(
      "tests/browser/conversation-home.e2e.ts",
    );
  expect(browserTargets(["src/styles/global.css"], browserTests)).not.toContain(
    "tests/browser/evals.e2e.ts",
  );
  expect(() => browserTargets(["src/pages/cases/new.astro"], [])).toThrow(
    "BROWSER_FEATURE_TEST_MISSING",
  );
});

test("source-only report and global router changes include the real download consumer", () => {
  const download = "tests/browser/report-real-download.e2e.ts";
  const available = [...browserTests, download];
  for (const file of [
    "src/server/modules/reports/storage.ts",
    "src/server/api/v2/reports.ts",
    "src/server/api/index.ts",
    "src/worker.ts",
  ]) {
    expect(browserTargets([file], available)).toContain(download);
    expect(browserTargets([file], available)).not.toContain("tests/browser/evals.e2e.ts");
  }
});
