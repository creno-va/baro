import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  checkProductLandingPreservation,
  landingBrowserAllowed,
  landingBrowserExpected,
  landingBrowserReplacements,
  landingChangeFindings,
  landingLegacyPaths,
  landingNewSourcePaths,
  landingPackageAllowed,
} from "../scripts/check-product-landing-preservation";

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function git(root: string, ...args: string[]) {
  const child = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [output, error] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if ((await child.exited) !== 0) throw new Error(error);
  return output.trim();
}
async function file(root: string, path: string, content = "synthetic baseline\n") {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}
async function commit(root: string) {
  await git(
    root,
    "-c",
    "user.name=Synthetic Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--no-gpg-sign",
    "-qm",
    "synthetic test",
  );
}
const initialPackage = {
  name: "synthetic-landing-preservation",
  scripts: {
    "product-ui:check": "bun scripts/check-product-details-preservation.ts",
    "product-shell:check": "bun scripts/check-product-shell-preservation.ts",
    "product-workspace:check": "bun scripts/check-product-workspace-preservation.ts",
    "product-details:check": "bun scripts/check-product-details-preservation.ts",
    "product-ui:measure": "bun scripts/measure-web-query-baseline.ts",
    check: "bun test",
  },
  dependencies: { react: "19.3.0" },
  devDependencies: { typescript: "6.0.2" },
  overrides: { vite: "8.0.0" },
};
const currentPackage = {
  ...initialPackage,
  scripts: {
    ...initialPackage.scripts,
    "product-ui:check": "bun scripts/check-product-landing-preservation.ts",
    "product-landing:check": "bun scripts/check-product-landing-preservation.ts",
  },
};
const unchangedAssertions = `await expect(targetWidth).toBeGreaterThanOrEqual(44);
await expect(requestCount).toBe(0);
await expect(trigger).toBeFocused();
`;
const initialBrowser = `${landingBrowserReplacements.map(([before]) => before).join("\n")}\n${unchangedAssertions}`;
const currentBrowser = `${landingBrowserReplacements.map(([, after]) => after).join("\n")}\n${unchangedAssertions}`;
const firstReplacement = landingBrowserReplacements[0];
if (!firstReplacement) throw new Error("LANDING_BROWSER_PATCH_REQUIRED");

async function repository() {
  const root = await mkdtemp(join(tmpdir(), "baro-product-landing-"));
  roots.push(root);
  await git(root, "init", "-q");
  for (const path of [
    "src/client/landing.ts",
    "src/pages/index.astro",
    "src/layouts/BaseLayout.astro",
    "src/client/api/index.ts",
    "src/server/module.ts",
    "public/landing/synthetic.webm",
    "apps/mobile/src/App.tsx",
    "packages/api-client/src/index.ts",
    "bun.lock",
  ])
    await file(root, path);
  await file(root, "package.json", JSON.stringify(initialPackage));
  await file(root, "tests/browser/landing.e2e.ts", initialBrowser);
  await git(root, "add", ".");
  await commit(root);
  return { root, base: await git(root, "rev-parse", "HEAD") };
}

describe("landing phase named scope", () => {
  test("allows exactly the reviewed retirement, source additions and phase tooling", () => {
    expect(landingLegacyPaths).toHaveLength(43);
    expect(new Set(landingLegacyPaths).size).toBe(43);
    expect(landingNewSourcePaths).toHaveLength(46);
    expect(new Set(landingNewSourcePaths).size).toBe(46);
    expect(
      landingChangeFindings([
        ...landingLegacyPaths.map((path) => ({ path, status: "D", existedAtBase: true })),
        ...landingNewSourcePaths.map((path) => ({ path, status: "A", existedAtBase: false })),
        ...[
          "src/layouts/LandingLayout.astro",
          "tests/product-ui-landing.test.tsx",
          "scripts/check-product-landing-preservation.ts",
          "tests/product-ui-landing-preservation.test.ts",
          "docs/development/LANDING-UI.md",
        ].map((path) => ({ path, status: "A", existedAtBase: false })),
        ...["src/pages/index.astro", "package.json", "tests/browser/landing.e2e.ts"].map(
          (path) => ({ path, status: "M", existedAtBase: true }),
        ),
      ]),
    ).toEqual([]);
  });

  test("protects shared runtime, assets, infrastructure, other UI and prior acceptance", () => {
    const paths = [
      "src/layouts/BaseLayout.astro",
      "src/layouts/ProductLayout.astro",
      "src/pages/new.astro",
      "src/components/ui/app-navigation.tsx",
      "src/styles/global.css",
      "src/styles/shell.css",
      "src/styles/app-focus.css",
      "src/styles/design-system.css",
      "src/product-ui/product.css",
      "src/product-ui/Button.tsx",
      "src/client/api/index.ts",
      "src/server/module.ts",
      "src/contracts/v2/workspace.ts",
      "src/workflows/workspace.ts",
      "src/worker.ts",
      "drizzle/0020_expand.sql",
      "apps/mobile/src/App.tsx",
      "packages/api-client/src/index.ts",
      "public/landing/synthetic.webm",
      "astro.config.ts",
      "bun.lock",
      ".github/workflows/ci.yml",
      "scripts/validate.ts",
      "scripts/check-product-workspace-preservation.ts",
      "tests/browser/app-workspace-app.e2e.ts",
      "tests/product-ui-workspace-preservation.test.ts",
    ];
    expect(
      landingChangeFindings(paths.map((path) => ({ path, status: "M", existedAtBase: true }))).map(
        ({ path }) => path,
      ),
    ).toEqual(paths);
  });

  test("rejects unreviewed additions, retirement edits, traversal, deletions and type changes", () => {
    const changes = [
      { path: "src/product-ui/landing/unreviewed.ts", status: "A", existedAtBase: false },
      { path: "src/client/landing.ts", status: "M", existedAtBase: true },
      { path: "src/client/landing.ts", status: "D", existedAtBase: false },
      { path: "tests/browser/landing.e2e.ts", status: "D", existedAtBase: true },
      { path: "src/pages/index.astro", status: "T", existedAtBase: true },
      { path: "src/product-ui/landing/../../server.ts", status: "A", existedAtBase: false },
      { path: "docs/../src/server.ts", status: "A", existedAtBase: false },
      { path: "docs\\escape.md", status: "A", existedAtBase: false },
      { path: "/docs/absolute.md", status: "A", existedAtBase: false },
      { path: "docs/a\n.md", status: "A", existedAtBase: false },
      { path: "src/product-ui/landing/DemoLab.tsx", status: "M", existedAtBase: true },
    ];
    expect(landingChangeFindings(changes)).toHaveLength(changes.length);
  });
});

describe("bounded package and browser patches", () => {
  test("allows only both exact command aliases, preserving dependencies and other scripts", () => {
    expect(landingPackageAllowed(initialPackage, initialPackage)).toBe(true);
    expect(landingPackageAllowed(initialPackage, currentPackage)).toBe(true);
    for (const candidate of [
      { ...currentPackage, dependencies: { react: "0.0.0" } },
      { ...currentPackage, devDependencies: { typescript: "0.0.0" } },
      { ...currentPackage, overrides: {} },
      { ...currentPackage, scripts: { ...currentPackage.scripts, check: "true" } },
      {
        ...currentPackage,
        scripts: { ...currentPackage.scripts, "product-workspace:check": "true" },
      },
      {
        ...currentPackage,
        scripts: { ...currentPackage.scripts, "product-landing:check": "true" },
      },
      { ...initialPackage, scripts: { ...initialPackage.scripts, "product-ui:check": "true" } },
      { ...currentPackage, extra: true },
      null,
    ])
      expect(landingPackageAllowed(initialPackage, candidate)).toBe(false);
    for (const name of [
      "product-shell:check",
      "product-workspace:check",
      "product-details:check",
      "product-ui:measure",
    ]) {
      expect(
        landingPackageAllowed(initialPackage, {
          ...currentPackage,
          scripts: { ...currentPackage.scripts, [name]: "true" },
        }),
      ).toBe(false);
      const removed = structuredClone(currentPackage);
      Reflect.deleteProperty(removed.scripts, name);
      expect(landingPackageAllowed(initialPackage, removed)).toBe(false);
    }
  });

  test("accepts exactly the reviewed modal/fallback patch with all unrelated assertions intact", () => {
    expect(landingBrowserExpected(initialBrowser)).toBe(currentBrowser);
    expect(landingBrowserAllowed(initialBrowser, initialBrowser)).toBe(true);
    expect(landingBrowserAllowed(initialBrowser, currentBrowser)).toBe(true);
    for (const candidate of [
      currentBrowser.replace("GreaterThanOrEqual(44)", "GreaterThanOrEqual(0)"),
      currentBrowser.replace("requestCount).toBe(0)", "requestCount).toBe(1)"),
      currentBrowser.replace(
        '    await expect(page.locator(".landing")).toHaveAttribute("inert", "");\n',
        "",
      ),
      currentBrowser.replace("await expect(trigger).toBeFocused();", ""),
      `${currentBrowser}\n// unreviewed modification`,
      initialBrowser.replace(firstReplacement[0], firstReplacement[1]),
      "",
    ])
      expect(landingBrowserAllowed(initialBrowser, candidate)).toBe(false);
    expect(landingBrowserExpected(`${initialBrowser}\n${firstReplacement[0]}`)).toBeNull();
  });
});

describe("committed, staged, worktree and untracked coverage", () => {
  test("accepts an approved replacement across committed, staged and untracked changes", async () => {
    const { root, base } = await repository();
    expect((await checkProductLandingPreservation(root, base)).findings).toEqual([]);
    await file(root, "src/pages/index.astro", "approved landing entry\n");
    await git(root, "add", "src/pages/index.astro");
    await commit(root);
    await git(root, "rm", "src/client/landing.ts");
    await file(root, "src/product-ui/landing/DemoLab.tsx", "export const demo = true;\n");
    await file(root, "package.json", JSON.stringify(currentPackage));
    await file(root, "tests/browser/landing.e2e.ts", currentBrowser);
    expect((await checkProductLandingPreservation(root, base)).findings).toEqual([]);
  });

  test("finds a protected committed edit even when the working tree restores its baseline", async () => {
    const { root, base } = await repository();
    await file(root, "src/layouts/BaseLayout.astro", "unapproved committed edit\n");
    await git(root, "add", "src/layouts/BaseLayout.astro");
    await commit(root);
    await file(root, "src/layouts/BaseLayout.astro");
    expect((await checkProductLandingPreservation(root, base)).findings).toContainEqual({
      path: "src/layouts/BaseLayout.astro",
      code: "outside_product_landing_scope",
    });
  });

  test("finds staged API changes concealed by a baseline working file", async () => {
    const { root, base } = await repository();
    await file(root, "src/client/api/index.ts", "unapproved staged API\n");
    await git(root, "add", "src/client/api/index.ts");
    await file(root, "src/client/api/index.ts");
    expect((await checkProductLandingPreservation(root, base)).findings).toContainEqual({
      path: "src/client/api/index.ts",
      code: "outside_product_landing_scope",
    });
  });

  test("checks browser assertions and package dependencies in the index independently", async () => {
    const { root, base } = await repository();
    await file(
      root,
      "tests/browser/landing.e2e.ts",
      currentBrowser.replace("GreaterThanOrEqual(44)", "GreaterThanOrEqual(0)"),
    );
    await file(root, "package.json", JSON.stringify({ ...currentPackage, dependencies: {} }));
    await git(root, "add", "tests/browser/landing.e2e.ts", "package.json");
    await file(root, "tests/browser/landing.e2e.ts", currentBrowser);
    await file(root, "package.json", JSON.stringify(currentPackage));
    const { findings } = await checkProductLandingPreservation(root, base);
    for (const path of ["tests/browser/landing.e2e.ts", "package.json"])
      expect(findings).toContainEqual({ path, code: "unapproved_landing_integration_patch" });
  });

  test("does not hide a protected media removal as a rename into an approved source path", async () => {
    const { root, base } = await repository();
    await mkdir(join(root, "src/product-ui/landing"), { recursive: true });
    await git(root, "mv", "public/landing/synthetic.webm", "src/product-ui/landing/DemoLab.tsx");
    expect((await checkProductLandingPreservation(root, base)).findings).toContainEqual({
      path: "public/landing/synthetic.webm",
      code: "unapproved_landing_removal_or_type_change",
    });
  });

  test("rejects a new allowlisted source path that is a symlink", async () => {
    const { root, base } = await repository();
    await mkdir(join(root, "src/product-ui/landing"), { recursive: true });
    await symlink("../../server/module.ts", join(root, "src/product-ui/landing/DemoLab.tsx"));
    expect((await checkProductLandingPreservation(root, base)).findings).toContainEqual({
      path: "src/product-ui/landing/DemoLab.tsx",
      code: "landing_regular_file_required",
    });
  });
});
