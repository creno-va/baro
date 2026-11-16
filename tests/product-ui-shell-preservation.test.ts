import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  checkProductShellPreservation,
  productShellChangeFindings,
  productShellConfigAllowed,
  productShellDialogFocusAllowed,
  productShellFixtureRoute,
  productShellInputFixtureRoute,
  productShellPackageAllowed,
  productShellPrecedentsAllowed,
} from "../scripts/check-product-shell-preservation";
import {
  ProductShellFixture,
  prepareProductShellFixture,
  productShellFixtureEnabled,
  productShellFixtureValues,
} from "./helpers/product-shell-fixture";

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
const initialPackage = {
  name: "synthetic-shell-preservation",
  scripts: { "product-ui:check": "bun scripts/check-product-ui-foundation.ts", check: "bun test" },
  dependencies: { react: "19.3.0" },
};
const fixtureAnchor = `                injectRoute({
                  pattern: "/__product-ui",
                  entrypoint: fileURLToPath(
                    new URL("./tests/helpers/product-ui-page.astro", import.meta.url),
                  ),
                });`;
const initialConfig = `if (explicitFixtureFlag) {\n${fixtureAnchor}\n}\n`;
const oldFocusTarget = `            const action = document.querySelector<HTMLButtonElement>(
              '.conversation-entry button[type="submit"]',
            );`;
const nativeFocusTarget = `            const action = document
              .querySelector<HTMLTextAreaElement>("#narrative")
              ?.form?.querySelector<HTMLButtonElement>('button[type="submit"]');`;
const initialFocusTest = `// Synthetic focus regression\n${oldFocusTarget}\nawait expect(submit).toBeFocused();\n`;
const oldPrecedentsHover = '  await page.locator(".sidebar-story").first().hover();';
const currentPrecedentsHover =
  '  await page.getByRole("link", { name: oldTitle, exact: true }).hover();';
const oldPrecedentsScope =
  '    page.locator(".sidebar-desktop").getByRole("link", { name: newTitle, exact: true }),';
const currentPrecedentsScope = `    page
      .getByRole("navigation", { name: "최근 사건", exact: true })
      .getByRole("link", { name: newTitle, exact: true }),`;
const initialPrecedentsTest = `${oldPrecedentsHover}\nawait expect(modal).toBeHidden();\n${oldPrecedentsHover}\nawait expect(button).toBeDisabled();\n${oldPrecedentsScope}\nawait page.reload();\n${oldPrecedentsScope}\nawait expect(heading).toBeVisible();\n`;
const currentPrecedentsTest = initialPrecedentsTest
  .replaceAll(oldPrecedentsHover, currentPrecedentsHover)
  .replaceAll(oldPrecedentsScope, currentPrecedentsScope);
async function repository() {
  const root = await mkdtemp(join(tmpdir(), "baro-product-shell-"));
  roots.push(root);
  await git(root, "init", "-q");
  for (const path of [
    "src/pages/index.astro",
    "src/layouts/BaseLayout.astro",
    "src/layouts/CaseWorkbenchLayout.astro",
    "src/server/module.ts",
    "src/client/api/index.ts",
    "public/landing/synthetic.webm",
  ])
    await file(root, path);
  await file(root, "package.json", JSON.stringify(initialPackage));
  await file(root, "astro.config.ts", initialConfig);
  await file(root, "tests/browser/dialog-focus.e2e.ts", initialFocusTest);
  await file(root, "tests/browser/precedents.e2e.ts", initialPrecedentsTest);
  await git(root, "add", ".");
  await commit(root);
  return { root, base: await git(root, "rev-parse", "HEAD") };
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

describe("actual product-shell preservation scope", () => {
  test("protects the landing graph and backend/API/database/mobile/shared files", () => {
    const paths = [
      "src/pages/index.astro",
      "src/pages/new.astro",
      "src/pages/cases/[caseId]/precedents.astro",
      "src/layouts/BaseLayout.astro",
      "src/layouts/CaseLayout.astro",
      "src/components/ui/workspace-frame.tsx",
      "src/components/ui/brand.tsx",
      "src/styles/global.css",
      "src/styles/shell.css",
      "src/styles/app-focus.css",
      "src/styles/design-system.css",
      "src/client/landing.ts",
      "src/client/api/index.ts",
      "src/server/api/v2/reports.ts",
      "src/contracts/v2/resolution.ts",
      "src/workflows/workspace.ts",
      "src/worker.ts",
      "public/landing/hero-continuous.mp4",
      "drizzle/0020_expand.sql",
      "services/file-processor/report.py",
      "apps/mobile/src/App.tsx",
      "packages/api-client/src/rework.ts",
      ".github/workflows/ci.yml",
      "bun.lock",
      "scripts/validate.ts",
      "tests/browser/app-workspace-app.e2e.ts",
      "tests/helpers/product-ui-fixture.tsx",
    ];
    expect(
      productShellChangeFindings(
        paths.map((path) => ({ path, status: "M", existedAtBase: true })),
      ).map(({ path }) => path),
    ).toEqual(paths);
    expect(
      productShellChangeFindings([
        {
          path: "src/product-ui/navigation/../../server/module.ts",
          status: "A",
          existedAtBase: false,
        },
        { path: "src/product-ui/Theme.tsx", status: "D", existedAtBase: true },
      ]),
    ).toHaveLength(2);
  });

  test("allows only the agreed layouts, facades, new shell source and focused tests", () => {
    const existing = [
      "src/layouts/AppLayout.astro",
      "src/layouts/CaseWorkbenchLayout.astro",
      "src/components/ui/app-navigation.tsx",
      "src/components/intake/CaseInput.tsx",
      "src/product-ui/Theme.tsx",
      "tests/browser/dialog-focus.e2e.ts",
      "tests/browser/precedents.e2e.ts",
    ];
    const additions = [
      "src/layouts/ProductLayout.astro",
      "src/product-ui/GlobalTheme.tsx",
      "src/product-ui/product.css",
      "src/product-ui/navigation/NavigationView.tsx",
      "src/product-ui/navigation/useNavigationController.ts",
      "src/product-ui/intake/CaseInputView.tsx",
      "src/product-ui/intake/useCaseInputController.ts",
      "tests/helpers/product-shell-fixture-page.astro",
      "tests/helpers/product-shell-fixture.tsx",
      "tests/helpers/product-shell-input-page.astro",
      "scripts/check-product-shell-preservation.ts",
      "tests/product-ui-shell-preservation.test.ts",
      "tests/product-ui-navigation.test.tsx",
      "tests/product-ui-case-input-controller.test.tsx",
      "tests/product-ui-global-theme.test.tsx",
      "docs/quality/product-shell/acceptance.md",
    ];
    expect(
      productShellChangeFindings([
        ...existing.map((path) => ({ path, status: "M", existedAtBase: true })),
        ...additions.map((path) => ({ path, status: "A", existedAtBase: false })),
      ]),
    ).toEqual([]);
    expect(
      productShellChangeFindings([
        { path: "tests/product-ui-navigation.test.tsx", status: "M", existedAtBase: true },
      ]),
    ).toHaveLength(1);
  });

  test("configuration permits the exact preparation/input routes and preserves the gate", () => {
    const candidate = initialConfig.replace(
      fixtureAnchor,
      `${fixtureAnchor}\n${productShellFixtureRoute}\n${productShellInputFixtureRoute}`,
    );
    expect(productShellConfigAllowed(initialConfig, candidate)).toBe(true);
    expect(productShellConfigAllowed(initialConfig, initialConfig)).toBe(true);
    expect(
      productShellConfigAllowed(initialConfig, candidate.replace("explicitFixtureFlag", "true")),
    ).toBe(false);
    expect(
      productShellConfigAllowed(initialConfig, `${initialConfig}${productShellFixtureRoute}`),
    ).toBe(false);
    expect(
      productShellConfigAllowed(
        initialConfig,
        initialConfig.replace(fixtureAnchor, `${fixtureAnchor}\n${productShellFixtureRoute}`),
      ),
    ).toBe(false);
    expect(
      productShellConfigAllowed(initialConfig, candidate.replace("/__product-shell/input", "/new")),
    ).toBe(false);
    expect(
      productShellConfigAllowed(
        initialConfig,
        candidate.replace("product-shell-input-page.astro", "../../src/pages/new.astro"),
      ),
    ).toBe(false);
    expect(
      productShellConfigAllowed(
        initialConfig,
        candidate.replace("/__product-shell", "/product-shell"),
      ),
    ).toBe(false);
  });

  test("package permits exact phase aliases while retaining every dependency and other script", () => {
    const candidate = {
      ...initialPackage,
      scripts: {
        ...initialPackage.scripts,
        "product-ui:check": "bun scripts/check-product-shell-preservation.ts",
        "product-shell:check": "bun scripts/check-product-shell-preservation.ts",
      },
    };
    expect(productShellPackageAllowed(initialPackage, initialPackage)).toBe(true);
    expect(productShellPackageAllowed(initialPackage, candidate)).toBe(true);
    expect(
      productShellPackageAllowed(initialPackage, {
        ...candidate,
        dependencies: { react: "changed" },
      }),
    ).toBe(false);
    expect(
      productShellPackageAllowed(initialPackage, {
        ...candidate,
        scripts: { ...candidate.scripts, check: "true" },
      }),
    ).toBe(false);
    expect(
      productShellPackageAllowed(initialPackage, {
        ...candidate,
        scripts: { ...candidate.scripts, "product-ui:check": "true" },
      }),
    ).toBe(false);
    expect(
      productShellPackageAllowed(initialPackage, {
        ...candidate,
        scripts: { ...candidate.scripts, "product-shell:check": "true" },
      }),
    ).toBe(false);
  });

  test("focus maintenance changes only the target selector and preserves every existing assertion", () => {
    const candidate = initialFocusTest.replace(oldFocusTarget, nativeFocusTarget);
    expect(productShellDialogFocusAllowed(initialFocusTest, initialFocusTest)).toBe(true);
    expect(productShellDialogFocusAllowed(initialFocusTest, candidate)).toBe(true);
    expect(
      productShellDialogFocusAllowed(
        initialFocusTest,
        candidate.replace("toBeFocused()", "toBeVisible()"),
      ),
    ).toBe(false);
    expect(
      productShellDialogFocusAllowed(
        initialFocusTest,
        candidate.replace('"#narrative"', '"textarea"'),
      ),
    ).toBe(false);
    expect(productShellDialogFocusAllowed(initialFocusTest, `${candidate}\n`)).toBe(false);
    expect(
      productShellDialogFocusAllowed(
        `${initialFocusTest}${oldFocusTarget}`,
        `${candidate}${nativeFocusTarget}`,
      ),
    ).toBe(false);
  });

  test("precedents maintenance permits exactly four semantic selectors and preserves all assertions", () => {
    expect(productShellPrecedentsAllowed(initialPrecedentsTest, initialPrecedentsTest)).toBe(true);
    expect(productShellPrecedentsAllowed(initialPrecedentsTest, currentPrecedentsTest)).toBe(true);
    expect(
      productShellPrecedentsAllowed(
        initialPrecedentsTest,
        currentPrecedentsTest.replace("toBeDisabled()", "toBeEnabled()"),
      ),
    ).toBe(false);
    expect(
      productShellPrecedentsAllowed(
        initialPrecedentsTest,
        currentPrecedentsTest.replace('name: "최근 사건"', 'name: "다른 사건"'),
      ),
    ).toBe(false);
    expect(
      productShellPrecedentsAllowed(
        initialPrecedentsTest,
        initialPrecedentsTest.replace(oldPrecedentsHover, currentPrecedentsHover),
      ),
    ).toBe(false);
    expect(productShellPrecedentsAllowed(initialPrecedentsTest, `${currentPrecedentsTest}\n`)).toBe(
      false,
    );
  });

  test("checks clean repositories, committed allowed work and untracked source", async () => {
    const { root, base } = await repository();
    expect((await checkProductShellPreservation(root, base)).findings).toEqual([]);
    await file(root, "src/layouts/CaseWorkbenchLayout.astro", "synthetic new shell\n");
    await git(root, "add", ".");
    await commit(root);
    await file(
      root,
      "src/product-ui/navigation/NavigationView.tsx",
      "export const synthetic = true;\n",
    );
    const result = await checkProductShellPreservation(root, base);
    expect(result.changes).toBe(2);
    expect(result.findings).toEqual([]);
  });

  test("detects staged protected content concealed by a local restore", async () => {
    const { root, base } = await repository();
    await file(root, "src/client/api/index.ts", "synthetic protected change\n");
    await git(root, "add", ".");
    await file(root, "src/client/api/index.ts");
    expect((await checkProductShellPreservation(root, base)).findings).toContainEqual({
      path: "src/client/api/index.ts",
      code: "outside_product_shell_scope",
    });
  });

  test("detects protected committed content even after a local restore", async () => {
    const { root, base } = await repository();
    await file(root, "src/server/module.ts", "synthetic protected change\n");
    await git(root, "add", ".");
    await commit(root);
    await file(root, "src/server/module.ts");
    expect((await checkProductShellPreservation(root, base)).findings).toContainEqual({
      path: "src/server/module.ts",
      code: "outside_product_shell_scope",
    });
  });

  test("does not hide a landing rename or permit a new helper symlink", async () => {
    const { root, base } = await repository();
    await mkdir(join(root, "src/product-ui/navigation"), { recursive: true });
    await git(root, "mv", "src/pages/index.astro", "src/product-ui/navigation/renamed.ts");
    await mkdir(join(root, "tests/helpers"), { recursive: true });
    await symlink(
      "../../src/server/module.ts",
      join(root, "tests/helpers/product-shell-fixture.tsx"),
    );
    const result = await checkProductShellPreservation(root, base);
    expect(result.findings).toContainEqual({
      path: "src/pages/index.astro",
      code: "shell_phase_removal_or_type_change",
    });
    expect(result.findings).toContainEqual({
      path: "tests/helpers/product-shell-fixture.tsx",
      code: "shell_phase_regular_file_required",
    });
  });

  test("checks restricted package/config snapshots in both index and worktree", async () => {
    const { root, base } = await repository();
    await file(
      root,
      "package.json",
      JSON.stringify({ ...initialPackage, dependencies: { react: "changed" } }),
    );
    await git(root, "add", ".");
    await file(root, "package.json", JSON.stringify(initialPackage));
    await file(root, "astro.config.ts", initialConfig.replace("explicitFixtureFlag", "true"));
    const result = await checkProductShellPreservation(root, base);
    expect(result.findings).toContainEqual({
      path: "package.json",
      code: "unapproved_shell_integration_patch",
    });
    expect(result.findings).toContainEqual({
      path: "astro.config.ts",
      code: "unapproved_shell_integration_patch",
    });
    expect(await readFile(join(root, "src/layouts/BaseLayout.astro"), "utf8")).toBe(
      "synthetic baseline\n",
    );
  });

  test("checks the exact focus-test delta in the index as well as the worktree", async () => {
    const { root, base } = await repository();
    const path = "tests/browser/dialog-focus.e2e.ts";
    const candidate = initialFocusTest.replace(oldFocusTarget, nativeFocusTarget);
    await file(root, path, candidate);
    expect((await checkProductShellPreservation(root, base)).findings).toEqual([]);
    await file(root, path, candidate.replace("toBeFocused()", "toBeVisible()"));
    await git(root, "add", path);
    await file(root, path, candidate);
    expect((await checkProductShellPreservation(root, base)).findings).toContainEqual({
      path,
      code: "unapproved_shell_integration_patch",
    });
  });

  test("checks precedents assertions in the index despite an allowed worktree selector patch", async () => {
    const { root, base } = await repository();
    const path = "tests/browser/precedents.e2e.ts";
    await file(root, path, currentPrecedentsTest);
    expect((await checkProductShellPreservation(root, base)).findings).toEqual([]);
    await file(root, path, currentPrecedentsTest.replace("toBeDisabled()", "toBeEnabled()"));
    await git(root, "add", path);
    await file(root, path, currentPrecedentsTest);
    expect((await checkProductShellPreservation(root, base)).findings).toContainEqual({
      path,
      code: "unapproved_shell_integration_patch",
    });
  });
});

describe("visible local mock preparation", () => {
  test("matches actual-route synthetic identity, ownership, revision and empty resources", () => {
    const values = productShellFixtureValues("2026-11-16T00:00:00.000Z");
    expect(values.session).toEqual({
      user: { id: "shell-app-owner", name: "합성 고객", accountType: "customer" },
      needsConsent: false,
    });
    expect(values.caseOwners).toEqual({ "shell-app-case": "shell-app-owner" });
    expect(values.cases["shell-app-case"]).toMatchObject({
      id: "shell-app-case",
      schemaVersion: "2",
      stage: "active",
      revision: 1,
      updatedAt: "2026-11-16T00:00:00.000Z",
      subjectContext: "individual",
    });
    expect(values.reworkContexts["shell-app-case"]).toEqual({
      casePurpose: "prepare_claim",
      subjectContext: "individual",
      procedure: { kind: "unconfirmed", stage: "unconfirmed", description: null },
    });
    expect(values.workspace).toEqual({
      "shell-app-case": { messages: [], timeline: [], actions: [] },
    });
    expect(values.files).toEqual({ "shell-app-case": [] });
  });

  test("refuses real or remote mode before any write and seeds only explicit local mock keys", () => {
    const values = new Map<string, string>();
    const storage = { setItem: (key: string, value: string) => values.set(key, value) };
    for (const [mode, hostname] of [
      ["real", "localhost"],
      ["mock", "baro.example"],
      [undefined, "127.0.0.1"],
    ]) {
      expect(productShellFixtureEnabled(mode, hostname ?? "")).toBe(false);
      expect(() => prepareProductShellFixture(mode, hostname ?? "", storage)).toThrow(
        "LOCAL_MOCK_FIXTURE_REQUIRED",
      );
    }
    expect(values.size).toBe(0);
    prepareProductShellFixture("mock", "127.0.0.1", storage);
    expect([...values.keys()].sort()).toEqual([
      "baro-api-mock-v1:caseOwners",
      "baro-api-mock-v1:cases",
      "baro-api-mock-v1:files",
      "baro-api-mock-v1:reworkContexts",
      "baro-api-mock-v1:session",
      "baro-api-mock-v1:workspace",
      "shell-app-seeded",
    ]);
    expect(JSON.parse(values.get("baro-api-mock-v1:session") ?? "null")).toEqual(
      productShellFixtureValues().session,
    );
  });

  test("initial HTML offers explicit preparation without a prepared case link or login claim", () => {
    const html = renderToStaticMarkup(createElement(ProductShellFixture));
    expect(html).toContain("합성 계정 준비");
    expect(html).toContain("방문자 상태로 초기화");
    expect(html).toContain("실제 로그인이나 약관 동의가 아니며");
    expect(html).not.toContain('href="/cases/shell-app-case"');
    expect(html).not.toContain('href="/settings"');
  });
});
