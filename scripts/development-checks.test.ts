import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  browserTargets,
  runBrowserTargets,
  unitTargets,
  validationScope,
} from "./development-checks";

test("bounded concurrent selection retains cycles and shared consumers, then reads changed imports afresh", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "baro-selector-"));
  const source = (name: string) => resolve(directory, name);
  const roots = Array.from({ length: 12 }, (_, i) => source(`root-${i}.test.ts`));
  try {
    await Promise.all([
      writeFile(source("first.ts"), "export const value = 1;"),
      writeFile(source("second.ts"), "export const value = 2;"),
      writeFile(source("shared.ts"), "export { value } from './first'; import './cycle';"),
      writeFile(source("cycle.ts"), "import './shared';"),
      ...roots.map((path) => writeFile(path, "import './shared';")),
    ]);
    const expected = roots.map((path) => path.replaceAll("\\", "/")).sort();
    const [first, second] = await Promise.all([
      unitTargets([source("first.ts")], roots),
      unitTargets([source("second.ts")], roots),
    ]);
    expect(first).toEqual(expected);
    expect(second).toEqual([]);
    await writeFile(source("shared.ts"), "export { value } from './second'; import './cycle';");
    expect(await unitTargets([source("first.ts")], roots)).toEqual([]);
    expect(await unitTargets([source("second.ts")], roots)).toEqual(expected);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("browser failures do not hide later adapter failures and still reject the complete run", async () => {
  const calls: { command: string[]; env: Record<string, string | undefined> | undefined }[] = [];
  const codes = [1, 0, 2];
  let failure = "";
  try {
    await runBrowserTargets(
      [
        "tests/browser/auth.e2e.ts",
        "tests/browser/precedents.e2e.ts",
        "tests/browser/intake103.e2e.ts",
      ],
      async (command, env) => {
        calls.push({ command, env });
        return codes[calls.length - 1] ?? 0;
      },
    );
  } catch (cause) {
    failure = String(cause);
  }
  expect(calls.map(({ command }) => command.at(-1))).toEqual([
    "tests/browser/auth.e2e.ts",
    "tests/browser/precedents.e2e.ts",
    "tests/browser/intake103.e2e.ts",
  ]);
  expect(failure).toContain("tests/browser/auth.e2e.ts (exit 1)");
  expect(failure).toContain("tests/browser/intake103.e2e.ts (exit 2)");
  expect(failure).not.toContain("tests/browser/precedents.e2e.ts");
  expect(calls[0]?.env).toBeUndefined();
  expect(calls[1]?.env).toBeUndefined();
  // The dedicated config owns its mock server and environment.
  expect(calls[2]?.command).toContain("tests/browser/intake103.config.ts");
  expect(calls[2]?.env).toBeUndefined();
});

test("dedicated mock configurations execute once with their own managed server", async () => {
  const calls: string[][] = [];
  const targets = [
    "tests/browser/intake103.e2e.ts",
    "tests/browser/reports-integrated.e2e.ts",
    "tests/browser/customer-completion.e2e.ts",
  ];
  await runBrowserTargets(targets, async (command) => {
    calls.push(command);
    return 0;
  });
  expect(calls).toHaveLength(targets.length);
  for (const target of targets) {
    expect(calls.filter((command) => command.includes(target))).toEqual([
      ["bunx", "playwright", "test", "--config", target.replace(".e2e.ts", ".config.ts"), target],
    ]);
  }
});

test("follow-up fixture, configuration and product changes retain the managed browser flow", () => {
  for (const source of [
    "tests/browser/resolution.config.ts",
    "tests/helpers/resolution-server.ts",
    "tests/helpers/resolution-fixture.tsx",
    "src/components/resolution/ResolutionPanel.tsx",
    "src/styles/resolution.css",
    "src/server/modules/resolution/service.ts",
  ])
    expect(
      browserTargets([source], ["tests/browser/resolution.e2e.ts", "tests/browser/auth.e2e.ts"]),
    ).toEqual(["tests/browser/resolution.e2e.ts"]);
});

test("full browser dispatch retains every discovered flow exactly once", async () => {
  const targets = [...new Bun.Glob("tests/browser/*.e2e.ts").scanSync(".")]
    .map((target) => target.replaceAll("\\", "/"))
    .sort();
  expect(targets.length).toBeGreaterThan(0);
  const commands: string[][] = [];
  await runBrowserTargets(targets, async (command) => {
    commands.push(command);
    return 0;
  });
  for (const target of targets)
    expect(commands.filter((command) => command.includes(target))).toHaveLength(1);
  expect(commands.filter((command) => command[0] === "docker")).toHaveLength(1);
});

test("Windows-discovered browser paths dispatch the same canonical flow once", async () => {
  const commands: string[][] = [];
  await runBrowserTargets(["tests\\browser\\auth.e2e.ts"], async (command) => {
    commands.push(command);
    return 0;
  });
  expect(commands.filter((command) => command.includes("tests/browser/auth.e2e.ts"))).toHaveLength(
    1,
  );
});

test("browser validation succeeds only when every selected group succeeds", async () => {
  let calls = 0;
  await expect(
    runBrowserTargets(
      ["tests/browser/auth.e2e.ts", "tests/browser/precedents.e2e.ts"],
      async () => {
        calls++;
        return 0;
      },
    ),
  ).resolves.toBeUndefined();
  expect(calls).toBe(2);
});

test("full rework journeys use their actual composers and opt in without silently skipping integration", async () => {
  const calls: { command: string[]; env: Record<string, string | undefined> | undefined }[] = [];
  await runBrowserTargets(
    [
      "tests/browser/auth.e2e.ts",
      "tests/browser/conversation-agent.e2e.ts",
      "tests/browser/rework-shared-mock.e2e.ts",
      "tests/browser/rework-conversation.e2e.ts",
    ],
    async (command, env) => {
      calls.push({ command, env });
      return 0;
    },
  );
  expect(calls.map(({ command }) => command.at(-1))).toEqual([
    "tests/browser/auth.e2e.ts",
    "tests/browser/conversation-agent.e2e.ts",
    "tests/browser/rework-shared-mock.e2e.ts",
    ".",
    "tests/browser/rework-conversation.e2e.ts",
  ]);
  expect(calls[0]?.env).toBeUndefined();
  expect(calls[1]?.command).toContain("tests/helpers/conversation-agent.playwright.config.ts");
  expect(calls[2]?.command).toContain("tests/helpers/rework-mock-browser.playwright.config.ts");
  expect(calls[2]?.env?.BARO_REWORK_SHARED_MOCK).toBe("true");
  expect(calls[3]?.command).toEqual([
    "docker",
    "build",
    "--target",
    "office-runtime",
    "-f",
    "services/file-processor/Dockerfile",
    "-t",
    "baro-report-rendering",
    ".",
  ]);
  expect(calls[4]?.command).toContain("tests/helpers/rework-browser.playwright.config.ts");
  expect(calls[4]?.env?.BARO_REWORK_BROWSER_INTEGRATED).toBe("true");
});

test("an integrated PDF runtime build failure is retained while the browser corpus still reports its own result", async () => {
  const commands: string[][] = [];
  await expect(
    runBrowserTargets(["tests/browser/rework-conversation.e2e.ts"], async (command) => {
      commands.push(command);
      return command[0] === "docker" ? 7 : 0;
    }),
  ).rejects.toThrow("docker build --target office-runtime");
  expect(commands).toHaveLength(2);
  expect(commands[1]?.at(-1)).toBe("tests/browser/rework-conversation.e2e.ts");
});

test("case, report and rework fixture changes retain their inline conversation consumers", () => {
  const flows: [string, string, string, string] = [
    "tests/browser/conversation-agent.e2e.ts",
    "tests/browser/rework-shared-mock.e2e.ts",
    "tests/browser/rework-conversation.e2e.ts",
    "tests/browser/auth.e2e.ts",
  ];
  for (const source of [
    "src/components/workspace/Workspace.tsx",
    "tests/helpers/rework-browser.playwright.config.ts",
    "tests/helpers/conversation-agent-fixture.tsx",
  ]) {
    const selected = browserTargets([source], flows);
    for (const flow of flows.slice(0, 3)) expect(selected).toContain(flow);
    expect(selected).not.toContain(flows[3]);
  }
  const report = browserTargets(["src/components/reports/ReportReview.tsx"], flows);
  expect(report).toContain(flows[1]);
  expect(report).toContain(flows[2]);
});

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

// Independent configurations each retain the original deadline and assertions.
test.each([
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
])(
  "dependency/deployment changes retain AI admission and execution regressions: %s",
  async (file) => {
    const selected = await unitTargets([file], unitTests);
    for (const required of aiRuntimeTests) expect(selected).toContain(required);
    expect(selected.some((path) => path.startsWith("tests/evals/"))).toBe(false);
  },
  15_000,
);

test.each([
  "src/server/model-policy.ts",
  "docs/operations/GEMINI-MODEL-CAPABILITY.json",
  "src/server/runtime/workspace.ts",
  "src/server/runtime/processing-proofs.ts",
  "src/server/modules/llm-gateway/service.ts",
  "src/server/modules/budget/gateway-ledger.ts",
  "src/workflows/workspace.ts",
  "src/server/api/v2/workspaces.ts",
  "drizzle/0007_runtime_paid_execution.sql",
  "scripts/provision-ai-budget.ts",
  "scripts/development-checks.ts",
])(
  "AI runtime/schema/capability changes retain the complete focused suite: %s",
  async (file) => {
    const selected = await unitTargets([file], unitTests);
    for (const required of aiRuntimeTests) expect(selected).toContain(required);
  },
  15_000,
);

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

test.each([
  ".github/actions/deploy-worker/action.yml",
  ".github/workflows/deploy-production.yml",
  "wrangler.jsonc",
  "astro.config.ts",
])("deployment/runtime changes retain environment parity checks: %s", async (file) => {
  const selected = await unitTargets([file], unitTests);
  expect(selected).toContain("tests/workflows.test.ts");
  expect(selected).toContain("tests/deployment-config.test.ts");
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
  expect(browserTargets(["src/styles/product.css"], browserTests)).toEqual(
    browserTests.filter((file) => !file.endsWith("/evals.e2e.ts")).sort(),
  );
  expect(() => browserTargets(["src/styles/product.css"], [])).toThrow(
    "BROWSER_FEATURE_TEST_MISSING",
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
    ["tests/helpers/case-ui-capture.ts", "workspace"],
    ["tests/helpers/case-ui-capture.ts", "reports-integrated"],
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

test("shared contract and contract-fixture changes retain browser consumers without corpus", () => {
  const expected = browserTests.filter((path) => !path.endsWith("/evals.e2e.ts")).sort();
  for (const file of [
    "src/contracts/v2/reports.ts",
    "src/contracts/v2/files.ts",
    "src/contracts/questions.ts",
    "src/contracts/common.ts",
    "src/contracts/v2/index.ts",
    "tests/fixtures/contracts/v2/index.ts",
    "tests/fixtures/contracts/index.ts",
  ]) {
    expect(browserTargets([file], browserTests)).toEqual(expected);
    expect(browserTargets([file.replaceAll("/", "\\")], browserTests)).toEqual(expected);
    expect(() => browserTargets([file], [])).toThrow("BROWSER_FEATURE_TEST_MISSING");
  }
  expect(browserTargets(["tests/fixtures/unused.txt"], browserTests)).toEqual([]);
});

test("mock review and session changes retain their browser consumers on either path separator", () => {
  const expected = browserTests.filter((path) => !path.endsWith("/evals.e2e.ts")).sort();
  for (const path of ["src/client/api/mock/session.ts", "src\\client\\api\\mock\\session.ts"]) {
    expect(browserTargets([path], browserTests)).toEqual(expected);
    expect(() => browserTargets([path], [])).toThrow("BROWSER_FEATURE_TEST_MISSING");
  }
  for (const path of [
    "src/client/api/mock/file-review.ts",
    "src\\client\\api\\mock\\file-review.ts",
  ]) {
    const selected = browserTargets([path], browserTests);
    for (const name of [
      "workspace-shared",
      "customer-completion",
      "report-html",
      "reports-integrated",
    ])
      expect(selected).toContain(`tests/browser/${name}.e2e.ts`);
    expect(selected).not.toContain("tests/browser/evals.e2e.ts");
    expect(selected).not.toContain("tests/browser/lawyer-portal.e2e.ts");
    expect(() => browserTargets([path], [])).toThrow("BROWSER_FEATURE_TEST_MISSING");
  }
  expect(browserTargets(["src/client/api/mock/unrelated.ts"], browserTests)).toEqual([]);
});

test("workbench styles retain the case regression and protected public layout checks", () => {
  const selected = browserTargets(["src/styles/case-workbench.css"], browserTests);
  expect(selected).toContain("tests/browser/case-workbench.e2e.ts");
  expect(selected).toContain("tests/browser/workspace-materials.e2e.ts");
  expect(selected).toContain("tests/browser/landing.e2e.ts");
  expect(selected).not.toContain("tests/browser/evals.e2e.ts");
  expect(browserTargets(["src/components/workspace/CaseContextPanel.tsx"], browserTests)).toContain(
    "tests/browser/case-workbench.e2e.ts",
  );
});
