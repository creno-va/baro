import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

/** Scope acceptance for the actual product-shell PR, based on the isolated foundation.
 * This does not replace runtime, behavioral, security or later-phase acceptance. */
export const PRODUCT_SHELL_BASE = "1f8c70dd2d6cccd95e067e0a5b0fc770cd7bf283";
export type ProductShellChange = { path: string; status: string; existedAtBase: boolean };
export type ProductShellFinding = { path: string; code: string };

const existingSource = new Set([
  "src/layouts/AppLayout.astro",
  "src/layouts/CaseWorkbenchLayout.astro",
  "src/components/ui/app-navigation.tsx",
  "src/components/intake/CaseInput.tsx",
  "src/product-ui/Theme.tsx",
]);
const newFiles = new Set([
  "src/layouts/ProductLayout.astro",
  "src/product-ui/GlobalTheme.tsx",
  "src/product-ui/product.css",
  "tests/helpers/product-shell-fixture-page.astro",
  "tests/helpers/product-shell-fixture.tsx",
  "tests/helpers/product-shell-input-page.astro",
  "scripts/check-product-shell-preservation.ts",
  "tests/product-ui-shell-preservation.test.ts",
  "tests/product-ui-global-theme.test.tsx",
]);

export function productShellChangeFindings(
  changes: readonly ProductShellChange[],
): ProductShellFinding[] {
  return changes.flatMap(({ path, status, existedAtBase }) => {
    if (
      !path ||
      path.startsWith("/") ||
      path.includes("\\") ||
      path.split("/").some((part) => !part || part === "." || part === "..") ||
      [...path].some((character) => character.charCodeAt(0) < 32)
    )
      return [{ path, code: "invalid_repository_path" }];
    if (!["A", "M"].includes(status)) return [{ path, code: "shell_phase_removal_or_type_change" }];
    if (
      path.startsWith("docs/") ||
      [
        "package.json",
        "astro.config.ts",
        "tests/browser/dialog-focus.e2e.ts",
        "tests/browser/precedents.e2e.ts",
      ].includes(path) ||
      (existingSource.has(path) && existedAtBase)
    )
      return [];
    const newSourceOrTest =
      newFiles.has(path) ||
      /^src\/product-ui\/(?:navigation|intake)\/[A-Za-z0-9_./-]+\.tsx?$/.test(path) ||
      /^tests\/product-ui-(?:navigation|case-input)[A-Za-z0-9._-]*\.test\.tsx?$/.test(path);
    return newSourceOrTest && !existedAtBase ? [] : [{ path, code: "outside_product_shell_scope" }];
  });
}

const existingFixtureRoute = `                injectRoute({
                  pattern: "/__product-ui",
                  entrypoint: fileURLToPath(
                    new URL("./tests/helpers/product-ui-page.astro", import.meta.url),
                  ),
                });`;
export const productShellFixtureRoute = `                injectRoute({
                  pattern: "/__product-shell",
                  entrypoint: fileURLToPath(
                    new URL("./tests/helpers/product-shell-fixture-page.astro", import.meta.url),
                  ),
                });`;
export const productShellInputFixtureRoute = `                injectRoute({
                  pattern: "/__product-shell/input",
                  entrypoint: fileURLToPath(
                    new URL("./tests/helpers/product-shell-input-page.astro", import.meta.url),
                  ),
                });`;

export function productShellConfigAllowed(base: string, candidate: string) {
  return (
    candidate === base ||
    (base.split(existingFixtureRoute).length === 2 &&
      candidate ===
        base.replace(
          existingFixtureRoute,
          `${existingFixtureRoute}\n${productShellFixtureRoute}\n${productShellInputFixtureRoute}`,
        ))
  );
}

export function productShellDialogFocusAllowed(base: string, candidate: string) {
  const oldTarget = `            const action = document.querySelector<HTMLButtonElement>(
              '.conversation-entry button[type="submit"]',
            );`;
  const nativeTarget = `            const action = document
              .querySelector<HTMLTextAreaElement>("#narrative")
              ?.form?.querySelector<HTMLButtonElement>('button[type="submit"]');`;
  return (
    candidate === base ||
    (base.split(oldTarget).length === 2 && candidate === base.replace(oldTarget, nativeTarget))
  );
}

export function productShellPrecedentsAllowed(base: string, candidate: string) {
  const oldHover = '  await page.locator(".sidebar-story").first().hover();';
  const currentHover = '  await page.getByRole("link", { name: oldTitle, exact: true }).hover();';
  const oldScope =
    '    page.locator(".sidebar-desktop").getByRole("link", { name: newTitle, exact: true }),';
  const currentScope = `    page
      .getByRole("navigation", { name: "최근 사건", exact: true })
      .getByRole("link", { name: newTitle, exact: true }),`;
  return (
    candidate === base ||
    (base.split(oldHover).length === 3 &&
      base.split(oldScope).length === 3 &&
      candidate === base.replaceAll(oldHover, currentHover).replaceAll(oldScope, currentScope))
  );
}

export function productShellPackageAllowed(base: unknown, candidate: unknown) {
  if (!base || !candidate || typeof base !== "object" || typeof candidate !== "object")
    return false;
  const next = structuredClone(candidate) as { scripts?: Record<string, unknown> };
  const prior = base as { scripts?: Record<string, unknown> };
  if (!next.scripts || !prior.scripts || Array.isArray(next.scripts)) return false;
  if (next.scripts["product-ui:check"] !== prior.scripts["product-ui:check"]) {
    if (
      prior.scripts["product-ui:check"] !== "bun scripts/check-product-ui-foundation.ts" ||
      next.scripts["product-ui:check"] !== "bun scripts/check-product-shell-preservation.ts"
    )
      return false;
    next.scripts["product-ui:check"] = prior.scripts["product-ui:check"];
  }
  if (Object.hasOwn(next.scripts, "product-shell:check")) {
    if (
      Object.hasOwn(prior.scripts, "product-shell:check") ||
      next.scripts["product-shell:check"] !== "bun scripts/check-product-shell-preservation.ts"
    )
      return false;
    delete next.scripts["product-shell:check"];
  }
  return isDeepStrictEqual(base, next);
}

async function git(root: string, args: string[], optional = false) {
  const process = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [output] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if ((await process.exited) !== 0) {
    if (optional) return null;
    throw new Error("PRODUCT_SHELL_GIT_READ_FAILED");
  }
  return output;
}

export async function collectProductShellChanges(root: string, base: string) {
  const sha = (
    await git(root, ["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`])
  )?.trim();
  if (!sha) throw new Error("PRODUCT_SHELL_BASE_REQUIRED");
  const filesAtBase = new Set(
    (await git(root, ["ls-tree", "-r", "--name-only", "-z", sha]))?.split("\0"),
  );
  const changes = new Map<string, ProductShellChange>();
  // Include committed, staged and unstaged deltas independently. A local revert
  // cannot conceal a protected change already committed or waiting in the index.
  for (const args of [[sha, "HEAD"], ["--cached"], []]) {
    const fields =
      (await git(root, ["diff", "--name-status", "--no-renames", "-z", ...args, "--"]))
        ?.split("\0")
        .filter(Boolean) ?? [];
    for (let index = 0; index < fields.length; index += 2) {
      const status = fields[index];
      const path = fields[index + 1];
      if (!status || !path) throw new Error("PRODUCT_SHELL_DIFF_INVALID");
      changes.set(`${path}:${status}`, { path, status, existedAtBase: filesAtBase.has(path) });
    }
  }
  for (const path of (await git(root, ["ls-files", "--others", "--exclude-standard", "-z"]))
    ?.split("\0")
    .filter(Boolean) ?? [])
    changes.set(`${path}:A`, { path, status: "A", existedAtBase: false });
  return { sha, changes: [...changes.values()] };
}

export async function checkProductShellPreservation(root: string, base = PRODUCT_SHELL_BASE) {
  const { sha, changes } = await collectProductShellChanges(root, base);
  const findings = productShellChangeFindings(changes);
  const paths = [...new Set(changes.map((change) => change.path))];
  for (const path of paths) {
    const stat = await lstat(join(root, path)).catch(() => null);
    if (!stat?.isFile()) findings.push({ path, code: "shell_phase_regular_file_required" });
  }
  for (const path of [
    "package.json",
    "astro.config.ts",
    "tests/browser/dialog-focus.e2e.ts",
    "tests/browser/precedents.e2e.ts",
  ]) {
    if (!paths.includes(path)) continue;
    const before = await git(root, ["show", `${sha}:${path}`]);
    const candidates = await Promise.all([
      git(root, ["show", `HEAD:${path}`], true),
      git(root, ["show", `:${path}`], true),
      readFile(join(root, path), "utf8").catch(() => null),
    ]);
    const allowed = candidates.every((candidate) => {
      if (candidate === null || before === null) return false;
      try {
        return path === "package.json"
          ? productShellPackageAllowed(JSON.parse(before), JSON.parse(candidate))
          : path === "astro.config.ts"
            ? productShellConfigAllowed(before, candidate)
            : path === "tests/browser/dialog-focus.e2e.ts"
              ? productShellDialogFocusAllowed(before, candidate)
              : productShellPrecedentsAllowed(before, candidate);
      } catch {
        return false;
      }
    });
    if (!allowed) findings.push({ path, code: "unapproved_shell_integration_patch" });
  }
  return { changes: paths.length, findings };
}

if (import.meta.main) {
  if (process.argv.length > 3) throw new Error("PRODUCT_SHELL_EXPECTS_ONE_BASE_REF");
  const result = await checkProductShellPreservation(
    process.cwd(),
    process.argv[2] ?? PRODUCT_SHELL_BASE,
  );
  if (result.findings.length) {
    for (const finding of result.findings) console.error(`${finding.path}: ${finding.code}`);
    process.exitCode = 1;
  } else console.log(`Product shell preservation passed (${result.changes} changed paths)`);
}
