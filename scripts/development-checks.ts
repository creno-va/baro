import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";

export function validationScope(files: string[]) {
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
  const selected = new Set(files.filter((file) => /^tests\/browser\/.*\.e2e\.ts$/.test(file)));
  const rules: [RegExp, RegExp][] = [
    [
      /src\/(layouts\/|styles\/global|server\/router\.|components\/ui\/|client\/api\/(core|types|index|mock\/runtime))/,
      /\.e2e\.ts$/,
    ],
    [
      /src\/(server\/auth\/|client\/(auth|api\/session)|components\/(AuthButtons|ConsentForm)|pages\/(login|consent)|server\/api\/me\.)/,
      /\/(auth|session|settings)\.e2e\.ts$/,
    ],
    [
      /src\/(styles\/(intake|workspace)\.css|pages\/cases\/|components\/(intake|analysis|workspace)\/|client\/api\/(?:mock\/)?(cases|workspace|files)|server\/(api\/(cases|case-create|answers|retry|v2\/(files|workspaces))|modules\/(intake|cases|case-structure|workspace|files|file-processing)\/))/,
      /\/(cases|analysis|workspace|intake|files|xss)\.e2e\.ts$/,
    ],
    [
      /src\/(styles\/lawyers\.css|pages\/lawyer|components\/lawyers\/|client\/api\/(?:mock\/)?lawyers|server\/(api\/v2\/(lawyers|directory|moderation)|modules\/(lawyers|moderation)\/))/,
      /\/(directory|lawyer|lawyers)\.e2e\.ts$/,
    ],
    [
      /src\/(styles\/(reports|settings)\.css|pages\/(settings|help|polic)|components\/reports\/|components\/AccountSettings|client\/api\/(?:mock\/)?(account|reports)|server\/(api\/(account-delete|v2\/reports)|modules\/(deletion|reports|usage)\/))/,
      /\/(settings|reports|account)\.e2e\.ts$/,
    ],
    [
      /src\/(pages\/index|components\/AnalyticsChoice|server\/modules\/analytics\/)/,
      /\/(analytics|auth)\.e2e\.ts$/,
    ],
  ];
  for (const [source, tests] of rules) {
    if (!files.some((file) => source.test(file))) continue;
    const matched = available.filter((path) => tests.test(path) && !path.endsWith("/evals.e2e.ts"));
    if (!matched.length) throw new Error("BROWSER_FEATURE_TEST_MISSING");
    for (const path of matched) selected.add(path);
  }
  return [...selected].filter((path) => !path.endsWith("/evals.e2e.ts")).sort();
}

/** Follow relative imports/re-exports to select existing consumer tests even
 * when a service/auth patch does not edit a test. */
export async function unitTargets(files: string[], tests: string[]): Promise<string[]> {
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
  const selected: string[] = [];
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
  if (files.some((file) => file.startsWith(".github/workflows/")))
    selected.push("tests/workflows.test.ts");
  return [...new Set(selected)].sort();
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
  const mockTargets =
    mode === "browser"
      ? targets.filter((path) =>
          /\/(shell-integration|lawyer-api-mock|intake103)\.e2e\.ts$/.test(path),
        )
      : [];
  const regularTargets = targets.filter((path) => !mockTargets.includes(path));
  if (regularTargets.length) {
    const child = Bun.spawn(
      mode === "unit"
        ? ["bun", "test", ...regularTargets]
        : ["bunx", "playwright", "test", ...regularTargets],
      { stdout: "inherit", stderr: "inherit" },
    );
    if (await child.exited) process.exit(1);
  }
  if (mockTargets.length) {
    for (const [config, selected] of [
      [
        "tests/browser/integration.config.ts",
        mockTargets.filter((path) => !path.endsWith("/intake103.e2e.ts")),
      ],
      [
        "tests/browser/intake103.config.ts",
        mockTargets.filter((path) => path.endsWith("/intake103.e2e.ts")),
      ],
    ] as const) {
      if (!selected.length) continue;
      const child = Bun.spawn(["bunx", "playwright", "test", "--config", config, ...selected], {
        stdout: "inherit",
        stderr: "inherit",
        env: { ...process.env, PUBLIC_API_MODE: "mock" },
      });
      if (await child.exited) process.exit(1);
    }
  }
}

if (import.meta.main) await main();
