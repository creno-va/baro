import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { developmentFiles } from "./development-checks";

test("local feature selection includes committed, staged, unstaged and new files without changing immutable selection", () => {
  const cwd = mkdtempSync(join(tmpdir(), "baro-validation-scope-"));
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { cwd });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    return result.stdout.toString().trim();
  };
  try {
    git("init", "-q");
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "Synthetic test");
    for (const name of ["committed.ts", "staged.ts", "unstaged.ts", "removed.ts"])
      writeFileSync(join(cwd, name), "export const value = 1;\n");
    git("add", ".");
    git("commit", "-qm", "baseline");
    const base = git("rev-parse", "HEAD");
    writeFileSync(join(cwd, "committed.ts"), "export const value = 2;\n");
    git("add", "committed.ts");
    git("commit", "-qm", "feature");
    const candidate = git("rev-parse", "HEAD");
    writeFileSync(join(cwd, "staged.ts"), "export const value = 3;\n");
    git("add", "staged.ts");
    writeFileSync(join(cwd, "unstaged.ts"), "export const value = 4;\n");
    writeFileSync(join(cwd, "new file.ts"), "export const value = 5;\n");
    rmSync(join(cwd, "removed.ts"));
    expect(developmentFiles(base, undefined, cwd)).toEqual([
      "committed.ts",
      "new file.ts",
      "removed.ts",
      "staged.ts",
      "unstaged.ts",
    ]);
    expect(developmentFiles(base, candidate, cwd)).toEqual(["committed.ts"]);
    expect(() => developmentFiles("missing-ref", candidate, cwd)).toThrow();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
