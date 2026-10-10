import { expect, test } from "bun:test";
import { browserTargets, unitTargets, validationScope } from "./development-checks";

const browserTests = [...new Bun.Glob("tests/browser/*.e2e.ts").scanSync(".")].map((path) =>
  path.replaceAll("\\", "/"),
);
const unitTests = [...new Bun.Glob("{tests,scripts,src}/**/*.test.ts").scanSync(".")].map((path) =>
  path.replaceAll("\\", "/"),
);
const aiRuntimeTests = [
  "src/server/api/health.test.ts",
  "tests/ai-preflight.test.ts",
  "tests/ai-runtime-provisioning.test.ts",
  "tests/ai-runtime-execution.test.ts",
  "tests/ai-runtime-workerd.test.ts",
  "tests/llm-gateway-attempts.test.ts",
  "tests/llm-gateway.test.ts",
  "tests/budget-gateway-ledger.test.ts",
  "tests/media-gateway.test.ts",
  "tests/file-processing-execution.test.ts",
  "tests/asset-processing-runtime.test.ts",
];

test("dependency and deployment-only changes cannot skip AI admission and execution regressions", async () => {
  for (const file of [
    "package.json",
    "bun.lock",
    ".bun-version",
    "wrangler.jsonc",
    "wrangler.json",
    "wrangler.toml",
    "astro.config.ts",
    "tsconfig.json",
    ".github/workflows/deploy-preview.yml",
    ".github/actions/deploy-worker/action.yml",
    "scripts/smoke.ts",
    "scripts/check-deployment.ts",
    "scripts/check-runtime-secrets.ts",
    "scripts/ai-preflight.ts",
  ]) {
    const selected = await unitTargets([file], unitTests);
    for (const required of aiRuntimeTests) expect(selected).toContain(required);
    expect(selected.some((path) => path.startsWith("tests/evals/"))).toBe(false);
  }
}, 15_000);

test("AI runtime, schema, capability and dispatch changes retain the complete focused suite", async () => {
  for (const file of [
    "src/server/runtime/workspace.ts",
    "src/server/runtime/processing-proofs.ts",
    "src/server/modules/llm-gateway/service.ts",
    "src/server/modules/budget/gateway-ledger.ts",
    "src/workflows/workspace.ts",
    "src/server/api/v2/workspaces.ts",
    "drizzle/0007_runtime_paid_execution.sql",
    "scripts/provision-ai-budget.ts",
    "scripts/development-checks.ts",
  ]) {
    const selected = await unitTargets([file], unitTests);
    for (const required of aiRuntimeTests) expect(selected).toContain(required);
  }
}, 15_000);

test("a missing required AI regression fails closed while unrelated styles stay scoped", async () => {
  for (const missing of aiRuntimeTests)
    await expect(
      unitTargets(
        ["bun.lock"],
        unitTests.filter((path) => path !== missing),
      ),
    ).rejects.toThrow("AI_RUNTIME_TEST_MISSING");
  const selected = await unitTargets(["src/styles/global.css"], unitTests);
  expect(selected.some((path) => aiRuntimeTests.includes(path))).toBe(false);
});

test("deployment actions and runtime configuration cannot skip environment parity checks", async () => {
  for (const file of [
    ".github/actions/deploy-worker/action.yml",
    ".github/workflows/deploy-production.yml",
    "wrangler.jsonc",
    "astro.config.ts",
  ]) {
    const selected = await unitTargets([file], unitTests);
    expect(selected).toContain("tests/workflows.test.ts");
    expect(selected).toContain("tests/deployment-config.test.ts");
  }
});

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

test("explicit corpus harness changes select its compiled owner-session browser regression", () => {
  for (const file of [
    "tests/helpers/eval-browser-server.ts",
    "tests/browser/evals.e2e.ts",
    "tests/browser/evals.config.ts",
    "tests/evals/pipeline.ts",
  ])
    expect(browserTargets([file], browserTests)).toContain("tests/browser/evals.e2e.ts");
  expect(() => browserTargets(["tests/helpers/eval-browser-server.ts"], [])).toThrow(
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

test("Windows changed paths and native inventories select the same required checks as Git paths", async () => {
  const posix = (paths: string[]) => paths.map((path) => path.replaceAll("\\", "/"));
  const windows = (paths: string[]) => paths.map((path) => path.replaceAll("/", "\\"));
  const availableBrowser = posix(browserTests);
  const availableUnit = posix(unitTests);
  const changed = ["src/server/auth/session.ts", "src/components/reports/ReportReview.tsx"];
  expect(browserTargets(windows(changed), windows(availableBrowser))).toEqual(
    browserTargets(changed, availableBrowser),
  );
  expect(await unitTargets(windows(changed), windows(availableUnit))).toEqual(
    await unitTargets(changed, availableUnit),
  );
  const config = ["src/server/db/v2-core.ts", "services/file-processor/Dockerfile"];
  expect(validationScope(windows(config))).toEqual(validationScope(config));
  expect(validationScope(windows(config))).toEqual({ native: true, database: true });
  await expect(
    unitTargets(["bun.lock"], windows(availableUnit.filter((path) => path !== aiRuntimeTests[0]))),
  ).rejects.toThrow("AI_RUNTIME_TEST_MISSING");
});

test("lawyer source changes retain portal, mock API and future recovery consumers", () => {
  const recovery = "tests/browser/lawyer-draft-recovery.e2e.ts";
  for (const file of ["src/components/lawyers/Editor.tsx", "src/styles/lawyers.css"]) {
    const selected = browserTargets([file], [...browserTests, recovery]);
    for (const name of ["directory", "lawyer-portal", "lawyer-api-mock"])
      expect(selected).toContain(`tests/browser/${name}.e2e.ts`);
    expect(selected).toContain(recovery);
    expect(selected).not.toContain("tests/browser/evals.e2e.ts");
    expect(selected).not.toContain("tests/browser/reports.e2e.ts");
  }
});

test("report and case edits retain completion, shared and export regression consumers", () => {
  const reports = browserTargets(["src/components/reports/ReportReview.tsx"], browserTests);
  for (const name of ["report-html", "report-draft-revision", "report-retained-pdf"])
    expect(reports).toContain(`tests/browser/${name}.e2e.ts`);
  for (const file of [
    "src/components/intake/IntakeQuestions.tsx",
    "src/components/intake/FileReview.tsx",
  ]) {
    const selected = browserTargets(
      [file],
      [
        ...browserTests,
        "tests/browser/intake-persistence.e2e.ts",
        "tests/browser/workspace-drafts.e2e.ts",
      ],
    );
    for (const name of [
      "intake-persistence",
      "workspace-drafts",
      "customer-completion",
      "customer-real",
      "workspace-shared",
      "customer-recovery-real",
    ])
      expect(selected).toContain(`tests/browser/${name}.e2e.ts`);
    expect(selected).not.toContain("tests/browser/evals.e2e.ts");
  }
});

test("return-path and session invalidation changes cannot skip signed-in browser consumers", () => {
  for (const file of ["src/client/return-path.ts", "src/client/session-events.ts"])
    expect(browserTargets([file], browserTests)).toEqual(
      browserTests.filter((file) => !file.endsWith("/evals.e2e.ts")).sort(),
    );
});

test("browser config and fixture-only edits select their actual consumers", () => {
  const rows = [
    ["tests/browser/reports.config.ts", "reports"],
    ["tests/browser/reports-account-real.config.ts", "settings"],
    ["tests/helpers/reports-ui-api.ts", "reports"],
    ["tests/helpers/report-real-api.ts", "report-retained-pdf"],
    ["tests/helpers/report-http-fixture.ts", "report-html"],
    ["tests/helpers/customer-browser-server.ts", "customer-real"],
    ["tests/helpers/workspace-client-fixture.ts", "workspace-shared"],
    ["tests/helpers/customer-completion.playwright.config.ts", "customer-completion"],
    ["tests/browser/conversation.config.ts", "conversation-home"],
    ["tests/browser/intake103.config.ts", "intake103"],
    ["tests/browser/lawyer-public.config.ts", "lawyer-portal"],
    ["tests/browser/integration.config.ts", "lawyer-api-mock"],
    ["tests/helpers/browser-session-server.ts", "session"],
    ["tests/browser/intake-persistence.config.ts", "intake-persistence"],
    ["tests/browser/workspace-drafts.config.ts", "workspace-drafts"],
    ["tests/browser/account-session-recovery.config.ts", "account-session-recovery"],
  ] as const;
  const available = [
    ...browserTests,
    "tests/browser/intake-persistence.e2e.ts",
    "tests/browser/workspace-drafts.e2e.ts",
    "tests/browser/account-session-recovery.e2e.ts",
  ];
  for (const [file, name] of rows) {
    const selected = browserTargets([file], available);
    expect(selected).toContain(`tests/browser/${name}.e2e.ts`);
    expect(selected).not.toContain("tests/browser/evals.e2e.ts");
    expect(() => browserTargets([file], [])).toThrow("BROWSER_FEATURE_TEST_MISSING");
  }
  expect(browserTargets(["playwright.config.ts"], browserTests)).toContain(
    "tests/browser/auth.e2e.ts",
  );
  expect(browserTargets(["tests/fixtures/unused.txt"], browserTests)).toEqual([]);
});
