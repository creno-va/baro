/** Development checks cover the changed feature; corpus evaluations are separate release work. */
export {};

const mode = process.argv[2];
if (!["unit", "browser", "scope"].includes(mode ?? "")) throw new Error("Unknown check mode");
const candidate = process.env.CHECK_CANDIDATE_SHA ?? "HEAD";
const suppliedBase = process.env.CHECK_BASE_SHA;
const base = suppliedBase && !/^0+$/.test(suppliedBase) ? suppliedBase : `${candidate}^`;
const diff = Bun.spawnSync(["git", "diff", "--name-only", "--diff-filter=ACMR", base, candidate]);
if (diff.exitCode !== 0) throw new Error("Cannot determine development check scope");
const files = diff.stdout.toString().trim().split("\n").filter(Boolean);
const changed = (pattern: RegExp) => files.some((file) => pattern.test(file));
const available = async (paths: string[]) => {
  const found = await Promise.all(
    paths.map(async (path) => ((await Bun.file(path).exists()) ? path : null)),
  );
  return found.filter((path): path is string => path !== null);
};
if (mode === "scope") {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error("GITHUB_OUTPUT is missing");
  const native = changed(/^(services\/file-processor\/|tests\/fixtures\/media\/)/);
  const database = changed(/^(drizzle\/|src\/server\/db\/schema\.|drizzle\.config)/);
  await Bun.write(
    output,
    `${await Bun.file(output).text()}native=${native}\ndatabase=${database}\n`,
  );
} else {
  const selected = new Set(
    files.filter((file) =>
      mode === "unit"
        ? /\.test\.ts$/.test(file) &&
          !file.startsWith("tests/evals/") &&
          !file.startsWith("tests/fixtures/")
        : /^tests\/browser\/.*\.e2e\.ts$/.test(file) && !file.endsWith("/evals.e2e.ts"),
    ),
  );
  const add = (paths: string[]) => {
    for (const path of paths) selected.add(path);
  };
  if (mode === "unit") {
    if (
      changed(
        /(\/directory(?:\/|\.)|\/public-read\.|\/lawyers\/(Directory|Profile)|pages\/lawyers\/)/,
      )
    )
      add(["tests/v2-directory-api.test.ts", "tests/v2-public-asset-read.test.ts"]);
    if (changed(/\/workspace\/|\/v2\/workspaces\./))
      add([
        "tests/v2-workspace-service.test.ts",
        "tests/v2-workspace-api.test.ts",
        "tests/workspace-pipeline.test.ts",
      ]);
    if (changed(/\/llm-gateway\//))
      add(["tests/llm-gateway.test.ts", "tests/llm-gateway-attempts.test.ts"]);
    if (changed(/^\.github\/workflows\//)) add(["tests/workflows.test.ts"]);
  } else {
    if (changed(/src\/(components\/lawyers\/|pages\/lawyers\/)/))
      add(["tests/browser/directory.e2e.ts"]);
    if (changed(/src\/(components\/workspace\/|pages\/dashboard|pages\/cases\/)/))
      add(["tests/browser/workspace.e2e.ts"]);
  }
  const targets = await available([...selected].sort());
  console.log(`${mode}: ${targets.length ? targets.join(", ") : "no changed feature tests"}`);
  if (targets.length) {
    const command =
      mode === "unit" ? ["bun", "test", ...targets] : ["bunx", "playwright", "test", ...targets];
    const child = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" });
    const result = await child.exited;
    if (result) process.exit(result);
  }
}
