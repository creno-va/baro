import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";

// Dependency and deployment configuration changes do not appear in the TypeScript
// import graph. Keep the actual admission/execution paths covered even when no
// application source or test file changes with them.
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
] as const;

/** Git paths and selectors use forward slashes; Bun.Glob uses native separators. */
function normalizedPaths(paths: string[]): string[] {
  return paths.map((path) => path.replaceAll("\\", "/"));
}
function affectsAiRuntime(file: string): boolean {
  return (
    /^(?:package\.json|bun\.lock|\.bun-version|wrangler(?:\.[^/]+)?\.(?:jsonc?|toml)|astro\.config\.ts|tsconfig(?:\.[^/]+)?\.json)$/.test(
      file,
    ) ||
    /^src\/(?:worker\.ts$|env\.d\.ts$|contracts\/|workflows\/|server\/(?:runtime\/|db\/|crypto\/|api\/(?:index\.ts$|v2\/(?:workspaces|files|reports)\.ts$)|modules\/(?:budget|llm-gateway|legal-retrieval|workspace|file-processing|asset-processing)\/))/.test(
      file,
    ) ||
    /^(?:\.github\/(?:workflows|actions)\/|drizzle\/|services\/file-processor\/|scripts\/(?:development-checks|provision-ai-budget|remote-budget-d1|apply-d1-migrations|ai-preflight|smoke|check-deployment|check-runtime-secrets)\.ts$)/.test(
      file,
    )
  );
}

export function validationScope(files: string[]) {
  files = normalizedPaths(files);
  return {
    native: files.some((file) =>
      /^(services\/file-processor\/|tests\/fixtures\/media\/)/.test(file),
    ),
    database: files.some((file) =>
      /^(drizzle\/|src\/server\/db\/|drizzle\.config|scripts\/(apply-d1-migrations|check-migrations)\.)/.test(
        file,
      ),
    ),
  };
}

/** HTTP browser flows require an explicit route map. Shared UI affects all non-corpus flows. */
export function browserTargets(files: string[], available: string[]): string[] {
  files = normalizedPaths(files);
  available = normalizedPaths(available);
  const selected = new Set(files.filter((file) => /^tests\/browser\/.*\.e2e\.ts$/.test(file)));
  const corpusChanged = files.some((file) =>
    /^tests\/(?:browser\/evals\.(?:e2e|config)\.ts|helpers\/eval-browser-server\.ts|evals\/pipeline\.ts)$/.test(
      file,
    ),
  );
  if (corpusChanged) {
    const corpus = available.find((path) => path.endsWith("/evals.e2e.ts"));
    if (!corpus) throw new Error("BROWSER_FEATURE_TEST_MISSING");
    selected.add(corpus);
  }
  if (files.some((file) => /^scripts\/(development-checks|full-browser)\.ts$/.test(file)))
    for (const path of available) selected.add(path);
  const caseFlows =
    /\/(cases|analysis|legacy-case-recovery|workspace(?:-[^/]+)?|intake(?:103|-[^/]+)?|conversation-home|files|xss|customer-[^/]+|upload-[^/]+|material-[^/]+)\.e2e\.ts$/;
  const lawyerFlows = /\/(directory(?:-[^/]+)?|lawyers?(?:-[^/]+)?)\.e2e\.ts$/;
  const reportFlows = /\/(reports?(?:-[^/]+)?|settings(?:-[^/]+)?|account(?:-[^/]+)?)\.e2e\.ts$/;
  const rules: [RegExp, RegExp][] = [
    [/^(?:src\/contracts\/|tests\/fixtures\/contracts\/)/, /\.e2e\.ts$/],
    // Shared session notifications and return paths affect every signed-in area.
    [/^src\/client\/(?:session-events|return-path)\.ts$/, /\.e2e\.ts$/],
    [/^playwright\.config\.ts$/, /\.e2e\.ts$/],
    [
      /^tests\/(?:browser\/(?:reports(?:-account-real|-integrated)?|report-real-download|material-report|account-session-recovery)\.config\.ts|helpers\/reports?[^/]*\.ts)$/,
      reportFlows,
    ],
    [
      /^tests\/(?:browser\/(?:customer|workspace|intake)[^/]*\.config\.ts|helpers\/(?:customer|workspace)[^/]*\.ts)$/,
      caseFlows,
    ],
    [/^tests\/browser\/(?:conversation|intake103)\.config\.ts$/, caseFlows],
    [/^tests\/browser\/lawyer-public\.config\.ts$/, lawyerFlows],
    [
      /^tests\/browser\/integration\.config\.ts$/,
      /\/(?:shell-integration|lawyer-api-mock)\.e2e\.ts$/,
    ],
    [
      /^tests\/helpers\/browser-session-server\.ts$/,
      /\/(?:auth|session|cases|analysis|settings|reports|legacy-case-recovery)\.e2e\.ts$/,
    ],
    [
      /src\/(worker\.|layouts\/|styles\/(global|shell)|server\/(router\.|api\/index)|components\/ui\/|client\/api\/(core|types|index|mock\/runtime))/,
      /\.e2e\.ts$/,
    ],
    [
      /src\/(server\/auth\/|client\/(auth|api\/session)|components\/(AuthButtons|ConsentForm)|pages\/(login|consent)|server\/api\/me\.)/,
      /\/(auth|session|settings)\.e2e\.ts$/,
    ],
    [
      /src\/(styles\/(intake|workspace)\.css|pages\/cases\/|components\/(intake|analysis|workspace)\/|client\/api\/(?:mock\/)?(cases|workspace|files)|server\/(api\/(cases|case-create|answers|retry|v2\/(files|workspaces))|modules\/(intake|cases|case-structure|workspace|files|file-processing)\/))/,
      caseFlows,
    ],
    [
      /src\/(styles\/lawyers\.css|pages\/lawyer|components\/lawyers\/|client\/api\/(?:mock\/)?lawyers|server\/(api\/v2\/(lawyers|directory|moderation)|modules\/(lawyers|moderation)\/))/,
      lawyerFlows,
    ],
    [
      /src\/(styles\/(reports|settings)\.css|pages\/(settings|help|polic)|components\/reports\/|components\/AccountSettings|client\/api\/(?:mock\/)?(account|reports)|server\/(api\/(account-delete|v2\/reports)|modules\/(deletion|reports|usage)\/))/,
      reportFlows,
    ],
    [
      /src\/(pages\/index|components\/AnalyticsChoice|server\/modules\/analytics\/)/,
      /\/(analytics|auth|conversation-home)\.e2e\.ts$/,
    ],
  ];
  for (const [source, tests] of rules) {
    if (!files.some((file) => source.test(file))) continue;
    const matched = available.filter((path) => tests.test(path) && !path.endsWith("/evals.e2e.ts"));
    if (!matched.length) throw new Error("BROWSER_FEATURE_TEST_MISSING");
    for (const path of matched) selected.add(path);
  }
  return [...selected].filter((path) => corpusChanged || !path.endsWith("/evals.e2e.ts")).sort();
}

/** Follow relative imports/re-exports to select existing consumer tests even
 * when a service/auth patch does not edit a test. */
export async function unitTargets(files: string[], tests: string[]): Promise<string[]> {
  files = normalizedPaths(files);
  tests = normalizedPaths(tests);
  const requiredAiTests = files.some(affectsAiRuntime) ? aiRuntimeTests : [];
  if (requiredAiTests.some((test) => !tests.includes(test)))
    throw new Error("AI_RUNTIME_TEST_MISSING");
  const changed = new Set(files.map((file) => resolve(file)));
  const cache = new Map<string, string[]>();
  const imports = async (path: string) => {
    const prior = cache.get(path);
    if (prior) return prior;
    const source = await Bun.file(path).text();
    const paths: string[] = [];
    for (const entry of ts.preProcessFile(source, true, true).importedFiles) {
      if (!entry.fileName.startsWith(".")) continue;
      const base = resolve(dirname(path), entry.fileName);
      const found = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.astro`,
        `${base}/index.ts`,
        `${base}/index.tsx`,
      ].find(
        (candidate) =>
          (existsSync(candidate) || changed.has(candidate)) && /\.(ts|tsx|astro)$/.test(candidate),
      );
      if (found) paths.push(found);
    }
    cache.set(path, paths);
    return paths;
  };
  const selected: string[] = [...requiredAiTests];
  for (const test of tests) {
    if (test.startsWith("tests/evals/") || test.startsWith("tests/fixtures/")) continue;
    const visited = new Set<string>();
    const touches = async (path: string): Promise<boolean> => {
      if (changed.has(path)) return true;
      if (visited.has(path)) return false;
      visited.add(path);
      for (const dependency of await imports(path)) if (await touches(dependency)) return true;
      return false;
    };
    if (await touches(resolve(test))) selected.push(test);
  }
  if (files.some((file) => file.startsWith("src/server/auth/")))
    selected.push(
      ...tests.filter((path) => /(^src\/server\/auth\/|^tests\/auth-lifecycle\.test)/.test(path)),
    );
  if (
    files.some((file) =>
      /^(?:\.github\/(?:workflows|actions)\/|wrangler\.jsonc$|astro\.config\.ts$)/.test(file),
    )
  )
    selected.push("tests/workflows.test.ts", "tests/deployment-config.test.ts");
  return [...new Set(selected)].sort();
}

/** Run wire tests and each mock adapter configuration sequentially in one checkout. */
export async function runBrowserTargets(targets: string[]) {
  targets = normalizedPaths(targets);
  const mockTargets = targets.filter((path) =>
    /\/(shell-integration|lawyer-api-mock|intake103|conversation-home|workspace-shared|customer-completion|workspace|reports-integrated)\.e2e\.ts$/.test(
      path,
    ),
  );
  const corpusTargets = targets.filter((path) => path.endsWith("/evals.e2e.ts"));
  const customerRealTargets = targets.filter((path) => path.endsWith("/customer-real.e2e.ts"));
  const reportRealTargets = targets.filter((path) => path.endsWith("/report-real-download.e2e.ts"));
  const recoveryTargets = targets.filter((path) =>
    /\/customer-recovery-(intake|real|workspace)\.e2e\.ts$/.test(path),
  );
  const standaloneTargets = targets.filter(
    (path) =>
      !mockTargets.includes(path) &&
      !corpusTargets.includes(path) &&
      !customerRealTargets.includes(path) &&
      !reportRealTargets.includes(path) &&
      !recoveryTargets.includes(path) &&
      existsSync(path.replace(".e2e.ts", ".config.ts")),
  );
  const regularTargets = targets.filter(
    (path) =>
      !mockTargets.includes(path) &&
      !corpusTargets.includes(path) &&
      !customerRealTargets.includes(path) &&
      !reportRealTargets.includes(path) &&
      !recoveryTargets.includes(path) &&
      !standaloneTargets.includes(path),
  );
  if (regularTargets.length) {
    const child = Bun.spawn(["bunx", "playwright", "test", ...regularTargets], {
      stdout: "inherit",
      stderr: "inherit",
    });
    if (await child.exited) process.exit(1);
  }
  if (corpusTargets.length) {
    const child = Bun.spawn(
      ["bunx", "playwright", "test", "--config", "tests/browser/evals.config.ts", ...corpusTargets],
      { stdout: "inherit", stderr: "inherit" },
    );
    if (await child.exited) process.exit(1);
  }
  if (customerRealTargets.length) {
    const child = Bun.spawn(
      [
        "bunx",
        "playwright",
        "test",
        "--config",
        "tests/browser/customer-real.config.ts",
        ...customerRealTargets,
      ],
      { stdout: "inherit", stderr: "inherit" },
    );
    if (await child.exited) process.exit(1);
  }
  if (reportRealTargets.length) {
    const child = Bun.spawn(
      [
        "bunx",
        "playwright",
        "test",
        "--config",
        "tests/browser/report-real-download.config.ts",
        ...reportRealTargets,
      ],
      { stdout: "inherit", stderr: "inherit" },
    );
    if (await child.exited) process.exit(1);
  }
  for (const target of recoveryTargets) {
    const config = target.replace(".e2e.ts", ".config.ts");
    const child = Bun.spawn(["bunx", "playwright", "test", "--config", config, target], {
      stdout: "inherit",
      stderr: "inherit",
    });
    if (await child.exited) process.exit(1);
  }
  // A new flow can declare its own server/fixture configuration without being
  // silently executed under the generic product server.
  for (const target of standaloneTargets) {
    const config = target.replace(".e2e.ts", ".config.ts");
    const child = Bun.spawn(["bunx", "playwright", "test", "--config", config, target], {
      stdout: "inherit",
      stderr: "inherit",
    });
    if (await child.exited) process.exit(1);
  }
  if (mockTargets.length) {
    for (const [config, selected] of [
      [
        "tests/browser/integration.config.ts",
        mockTargets.filter(
          (path) =>
            !/\/(intake103|conversation-home|workspace-shared|customer-completion|workspace|reports-integrated)\.e2e\.ts$/.test(
              path,
            ),
        ),
      ],
      [
        "tests/browser/conversation.config.ts",
        mockTargets.filter((path) => path.endsWith("/conversation-home.e2e.ts")),
      ],
      [
        "tests/browser/intake103.config.ts",
        mockTargets.filter((path) => path.endsWith("/intake103.e2e.ts")),
      ],
      [
        "tests/helpers/workspace.shared.playwright.config.ts",
        mockTargets.filter((path) => path.endsWith("/workspace-shared.e2e.ts")),
      ],
      [
        "tests/helpers/customer-completion.playwright.config.ts",
        mockTargets.filter((path) => path.endsWith("/customer-completion.e2e.ts")),
      ],
      [
        "tests/helpers/workspace.playwright.config.ts",
        mockTargets.filter((path) => path.endsWith("/workspace.e2e.ts")),
      ],
      [
        "tests/browser/reports-integrated.config.ts",
        mockTargets.filter((path) => path.endsWith("/reports-integrated.e2e.ts")),
      ],
    ] as const) {
      if (!selected.length) continue;
      const child = Bun.spawn(["bunx", "playwright", "test", "--config", config, ...selected], {
        stdout: "inherit",
        stderr: "inherit",
        env: {
          ...process.env,
          PUBLIC_API_MODE: "mock",
          BARO_WORKSPACE_SHARED_UI: "true",
          BARO_C_TEST_API: "true",
          BARO_D_SHARED_API: "true",
        },
      });
      if (await child.exited) process.exit(1);
    }
  }
}

async function main() {
  const mode = process.argv[2];
  if (!["unit", "browser", "scope"].includes(mode ?? "")) throw new Error("Unknown check mode");
  const candidate = process.env.CHECK_CANDIDATE_SHA ?? "HEAD";
  const suppliedBase = process.env.CHECK_BASE_SHA;
  const base = suppliedBase && !/^0+$/.test(suppliedBase) ? suppliedBase : `${candidate}^`;
  const diff = Bun.spawnSync([
    "git",
    "diff",
    "--name-only",
    "--diff-filter=ACMRD",
    base,
    candidate,
  ]);
  if (diff.exitCode !== 0) throw new Error("Cannot determine development check scope");
  const files = diff.stdout.toString().trim().split("\n").filter(Boolean);
  if (mode === "scope") {
    const output = process.env.GITHUB_OUTPUT;
    if (!output) throw new Error("GITHUB_OUTPUT is missing");
    const scope = validationScope(files);
    await Bun.write(
      output,
      `${await Bun.file(output).text()}native=${scope.native}\ndatabase=${scope.database}\n`,
    );
    return;
  }
  const tests = [
    ...new Bun.Glob(
      mode === "unit" ? "{tests,scripts,src}/**/*.test.ts" : "tests/browser/*.e2e.ts",
    ).scanSync("."),
  ];
  const targets = mode === "unit" ? await unitTargets(files, tests) : browserTargets(files, tests);
  if (targets.some((path) => !existsSync(path))) throw new Error("SELECTED_TEST_MISSING");
  console.log(`${mode}: ${targets.length ? targets.join(", ") : "no affected feature tests"}`);
  if (mode === "browser") await runBrowserTargets(targets);
  else if (targets.length) {
    const child = Bun.spawn(["bun", "test", ...targets], {
      stdout: "inherit",
      stderr: "inherit",
    });
    if (await child.exited) process.exit(1);
  }
}

if (import.meta.main) await main();
