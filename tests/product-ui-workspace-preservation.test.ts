import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  checkProductWorkspacePreservation,
  migrateProductWorkspaceSelectors,
  productWorkspaceCaseLayoutAllowed,
  productWorkspaceChangeFindings,
  productWorkspaceLockAllowed,
  productWorkspacePackageAllowed,
  productWorkspacePageAllowed,
  productWorkspaceSelectorPaths,
  productWorkspaceSelectorsAllowed,
} from "../scripts/check-product-workspace-preservation";

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
const baselinePackage = {
  name: "synthetic-workspace-phase",
  dependencies: { react: "19.3.0" },
  devDependencies: { typescript: "6.0.3" },
  scripts: {
    "product-ui:check": "bun scripts/check-product-shell-preservation.ts",
    "product-shell:check": "bun scripts/check-product-shell-preservation.ts",
    test: "bun test",
  },
};
const phasePackage = {
  ...baselinePackage,
  scripts: {
    ...baselinePackage.scripts,
    "product-ui:check": "bun scripts/check-product-workspace-preservation.ts",
    "product-workspace:check": "bun scripts/check-product-workspace-preservation.ts",
  },
};
const composerTest = 'await expect(page.locator(".workspace-composer")).toHaveCount(1);\n';
const baselineLock = `{
  "lockfileVersion": 3,
  "workspaces": {
    "": {
      "devDependencies": {
        "@playwright/test": "1.63.0",
        "typescript": "6.0.3",
      },
    },
    "apps/mobile": {
      "dependencies": { "react-native": "0.88.0" },
    },
  },
  "packages": { "transitive": ["transitive@1.0.0", "sha512-synthetic"] },
}\n`;
const compilerLock = baselineLock.replace(
  '        "@playwright/test": "1.63.0",\n',
  '        "@playwright/test": "1.63.0",\n        "@tailwindcss/node": "4.3.3",\n        "@tailwindcss/oxide": "4.3.3",\n',
);
const baselineCaseLayout = `---
// biome-ignore lint/correctness/noUnusedImports: Astro template reads component.
import CaseWorkbenchLayout from "./CaseWorkbenchLayout.astro";
import "../styles/cases.css";
import { env } from "cloudflare:workers";
Astro.csp?.insertDirective("img-src 'self' data: blob:");
---
<CaseWorkbenchLayout title={title}><slot /></CaseWorkbenchLayout>\n`;
const workspacePagePaths = [
  "src/pages/cases/[caseId].astro",
  "src/pages/cases/[caseId]/reports.astro",
  "src/pages/cases/[caseId]/actions.astro",
  "src/pages/cases/[caseId]/precedents.astro",
  "src/pages/cases/[caseId]/timeline.astro",
  "src/pages/cases/[caseId]/files.astro",
];
const baselineWorkspacePage = `---
import "../../styles/workspace.css";
const identity = opaqueIdSchema.safeParse(Astro.params.caseId);
if (!identity.success) return Astro.redirect("/cases");
---
<CaseLayout title="사건 작업 공간"><Workspace caseId={caseId} client:load /></CaseLayout>\n`;
async function repository() {
  const root = await mkdtemp(join(tmpdir(), "baro-product-workspace-"));
  roots.push(root);
  await git(root, "init", "-q");
  for (const path of [
    "src/components/workspace/Workspace.tsx",
    "src/components/intake/IntakeQuestions.tsx",
    "src/pages/index.astro",
    "src/layouts/BaseLayout.astro",
    "src/styles/global.css",
    "src/client/api/index.ts",
    "src/server/module.ts",
    "packages/api-client/src/index.ts",
    "apps/mobile/src/App.tsx",
  ])
    await file(root, path);
  await file(root, "package.json", JSON.stringify(baselinePackage));
  await file(root, "bun.lock", baselineLock);
  await file(root, "src/layouts/CaseLayout.astro", baselineCaseLayout);
  await file(root, "src/pages/cases/[caseId].astro", baselineWorkspacePage);
  await file(root, "tests/browser/workspace.e2e.ts", composerTest);
  await git(root, "add", ".");
  await commit(root);
  return { root, base: await git(root, "rev-parse", "HEAD") };
}

describe("conversation and questions phase preservation", () => {
  test("permits the agreed existing seams and exact new files without a product-ui wildcard", () => {
    const existing = [
      "src/components/ui/workspace-frame.tsx",
      "src/components/workspace/CaseNavigation.tsx",
      "src/components/workspace/Workspace.tsx",
      "src/components/intake/IntakeQuestions.tsx",
      "src/product-ui/product.css",
      "src/product-ui/intake/CaseInputView.tsx",
      "src/layouts/CaseLayout.astro",
      ...workspacePagePaths,
      "tests/helpers/product-shell-fixture.tsx",
      "tests/helpers/app-workspace-server.ts",
      ...productWorkspaceSelectorPaths,
    ];
    const additions = [
      "src/product-ui/conversation/ConversationComposer.tsx",
      "src/product-ui/conversation/ComposerAddMenu.tsx",
      "src/product-ui/conversation/CaseHeader.tsx",
      "src/product-ui/intake/QuestionsView.tsx",
      "src/product-ui/intake/useQuestionsController.ts",
      "src/product-ui/intake/QuestionAnswerField.tsx",
      "src/product-ui/intake/QuestionRecovery.tsx",
      "tests/product-ui-conversation.test.tsx",
      "tests/product-ui-questions.test.tsx",
      "scripts/check-product-workspace-preservation.ts",
      "tests/product-ui-workspace-preservation.test.ts",
      "docs/quality/conversation/questions.png",
    ];
    expect(
      productWorkspaceChangeFindings([
        ...existing.map((path) => ({ path, status: "M", existedAtBase: true })),
        ...additions.map((path) => ({ path, status: "A", existedAtBase: false })),
      ]),
    ).toEqual([]);
    expect(
      productWorkspaceChangeFindings([
        { path: "src/product-ui/intake/QuestionsView.tsx", status: "M", existedAtBase: true },
        { path: "src/product-ui/conversation/Unreviewed.tsx", status: "A", existedAtBase: false },
        { path: "src/product-ui/intake/QuestionsView.tsx", status: "D", existedAtBase: false },
        { path: "src/product-ui/intake/../navigation/file.ts", status: "A", existedAtBase: false },
      ]),
    ).toHaveLength(4);
  });

  test("keeps landing, shared visual sources, APIs, database, mobile and previous gates protected", () => {
    const protectedPaths = [
      "src/pages/index.astro",
      "src/pages/new.astro",
      "src/layouts/BaseLayout.astro",
      "src/layouts/ProductLayout.astro",
      "src/styles/global.css",
      "src/styles/shell.css",
      "src/styles/app-focus.css",
      "src/styles/design-system.css",
      "src/styles/case-workbench.css",
      "src/components/landing/HeroFilm.astro",
      "src/client/landing.ts",
      "src/client/api/index.ts",
      "src/client/theme.ts",
      "src/server/modules/rework/state.ts",
      "src/contracts/v2/index.ts",
      "src/workflows/workspace.ts",
      "src/worker.ts",
      "drizzle/0020_expand.sql",
      "public/fonts/PretendardVariable.woff2",
      "public/landing/hero-continuous.mp4",
      "apps/mobile/src/App.tsx",
      "packages/api-client/src/index.ts",
      "packages/design-tokens/tokens.css",
      "tests/browser/dialog-focus.e2e.ts",
      "tests/browser/conversation-agent.e2e.ts",
      "tests/browser/unreviewed.e2e.ts",
      "tests/helpers/product-shell-fixture-page.astro",
      "tests/helpers/product-shell-input-page.astro",
      "src/product-ui/Theme.tsx",
      "src/product-ui/intake/controller.ts",
      "src/product-ui/navigation/NavigationView.tsx",
      "scripts/check-product-shell-preservation.ts",
      "tests/product-ui-shell-preservation.test.ts",
      "scripts/validate.ts",
      "astro.config.ts",
      ".github/workflows/ci.yml",
    ];
    expect(
      productWorkspaceChangeFindings(
        protectedPaths.map((path) => ({ path, status: "M", existedAtBase: true })),
      ).map(({ path }) => path),
    ).toEqual(protectedPaths);
  });

  test("changes only the two current-phase aliases and keeps dependencies and prior commands exact", () => {
    expect(productWorkspacePackageAllowed(baselinePackage, baselinePackage)).toBe(true);
    expect(productWorkspacePackageAllowed(baselinePackage, phasePackage)).toBe(true);
    expect(
      productWorkspacePackageAllowed(baselinePackage, {
        ...phasePackage,
        dependencies: { react: "changed" },
      }),
    ).toBe(false);
    expect(
      productWorkspacePackageAllowed(baselinePackage, {
        ...phasePackage,
        scripts: { ...phasePackage.scripts, test: "true" },
      }),
    ).toBe(false);
    expect(
      productWorkspacePackageAllowed(baselinePackage, {
        ...phasePackage,
        scripts: { ...phasePackage.scripts, "product-shell:check": "true" },
      }),
    ).toBe(false);
    expect(
      productWorkspacePackageAllowed(baselinePackage, {
        ...phasePackage,
        scripts: { ...phasePackage.scripts, "product-workspace:check": "true" },
      }),
    ).toBe(false);
    expect(
      productWorkspacePackageAllowed(baselinePackage, {
        ...phasePackage,
        scripts: {
          ...phasePackage.scripts,
          "product-ui:check": baselinePackage.scripts["product-ui:check"],
        },
      }),
    ).toBe(false);
  });

  test("fixture compiler declarations add exactly two pinned development packages without policy changes", () => {
    const candidate = {
      ...phasePackage,
      devDependencies: {
        ...baselinePackage.devDependencies,
        "@tailwindcss/node": "4.3.3",
        "@tailwindcss/oxide": "4.3.3",
      },
    };
    expect(productWorkspacePackageAllowed(baselinePackage, candidate)).toBe(true);
    expect(
      productWorkspacePackageAllowed(baselinePackage, {
        ...candidate,
        devDependencies: { ...candidate.devDependencies, "@tailwindcss/oxide": "4.3.4" },
      }),
    ).toBe(false);
    expect(
      productWorkspacePackageAllowed(baselinePackage, {
        ...candidate,
        devDependencies: { ...baselinePackage.devDependencies, "@tailwindcss/node": "4.3.3" },
      }),
    ).toBe(false);
    expect(
      productWorkspacePackageAllowed(baselinePackage, {
        ...candidate,
        devDependencies: { ...candidate.devDependencies, typescript: "changed" },
      }),
    ).toBe(false);
    expect(
      productWorkspacePackageAllowed(baselinePackage, {
        ...candidate,
        overrides: { transitive: "changed" },
      }),
    ).toBe(false);
  });

  test("lock maintenance preserves every byte outside the two root compiler declarations", () => {
    expect(productWorkspaceLockAllowed(baselineLock, baselineLock)).toBe(true);
    expect(productWorkspaceLockAllowed(baselineLock, compilerLock)).toBe(true);
    expect(
      productWorkspaceLockAllowed(
        baselineLock,
        compilerLock.replace("transitive@1.0.0", "transitive@2.0.0"),
      ),
    ).toBe(false);
    expect(
      productWorkspaceLockAllowed(
        baselineLock,
        compilerLock.replace("sha512-synthetic", "sha512-changed"),
      ),
    ).toBe(false);
    expect(
      productWorkspaceLockAllowed(
        baselineLock,
        compilerLock.replace('"react-native": "0.88.0"', '"react-native": "changed"'),
      ),
    ).toBe(false);
    expect(
      productWorkspaceLockAllowed(
        baselineLock,
        compilerLock.replace('"@tailwindcss/oxide": "4.3.3"', '"@tailwindcss/oxide": "4.3.4"'),
      ),
    ).toBe(false);
    expect(productWorkspaceLockAllowed(baselineLock, `${compilerLock}\n`)).toBe(false);
  });

  test("a staged lock resolution edit cannot hide behind authorized working root declarations", async () => {
    const { root, base } = await repository();
    await file(root, "bun.lock", compilerLock);
    expect((await checkProductWorkspacePreservation(root, base)).findings).toEqual([]);
    await file(root, "bun.lock", compilerLock.replace("sha512-synthetic", "sha512-changed"));
    await git(root, "add", "bun.lock");
    await file(root, "bun.lock", compilerLock);
    expect((await checkProductWorkspacePreservation(root, base)).findings).toContainEqual({
      path: "bun.lock",
      code: "unapproved_workspace_lock_patch",
    });
  });

  test("the case layout may move only its legacy CSS import while retaining CSP and template bytes", () => {
    const candidate = baselineCaseLayout.replace('import "../styles/cases.css";\n', "");
    expect(productWorkspaceCaseLayoutAllowed(baselineCaseLayout, candidate)).toBe(true);
    expect(
      productWorkspaceCaseLayoutAllowed(baselineCaseLayout, candidate.replace("blob:", "https:")),
    ).toBe(false);
    expect(
      productWorkspaceCaseLayoutAllowed(
        baselineCaseLayout,
        candidate.replace("title={title}", 'title="changed"'),
      ),
    ).toBe(false);
  });

  test("the import removal accepts only the exact resulting Biome import sort", () => {
    const candidate = baselineCaseLayout
      .replace('import "../styles/cases.css";\n', "")
      .replace('import { env } from "cloudflare:workers";\n', "")
      .replace("---\n", '---\nimport { env } from "cloudflare:workers";\n');
    expect(productWorkspaceCaseLayoutAllowed(baselineCaseLayout, candidate)).toBe(true);
    expect(
      productWorkspaceCaseLayoutAllowed(baselineCaseLayout, candidate.replace("blob:", "https:")),
    ).toBe(false);
    expect(
      productWorkspaceCaseLayoutAllowed(
        baselineCaseLayout,
        candidate.replace('"cloudflare:workers"', '"changed"'),
      ),
    ).toBe(false);
    expect(
      productWorkspaceCaseLayoutAllowed(
        baselineCaseLayout,
        candidate.replace("title={title}", 'title="changed"'),
      ),
    ).toBe(false);
  });

  test("staged case-layout policy changes cannot hide behind the allowed import removal", async () => {
    const { root, base } = await repository();
    const path = "src/layouts/CaseLayout.astro";
    const candidate = baselineCaseLayout.replace('import "../styles/cases.css";\n', "");
    await file(root, path, candidate.replace("blob:", "https:"));
    await git(root, "add", path);
    await file(root, path, candidate);
    expect((await checkProductWorkspacePreservation(root, base)).findings).toContainEqual({
      path,
      code: "unapproved_workspace_case_layout_patch",
    });
  });

  test("exactly six case pages may remove only their existing workspace CSS import", () => {
    for (const path of workspacePagePaths) {
      const before =
        path === "src/pages/cases/[caseId].astro"
          ? baselineWorkspacePage
          : baselineWorkspacePage.replace(
              "../../styles/workspace.css",
              "../../../styles/workspace.css",
            );
      const candidate = before.replace(
        /import "\.\.\/(?:\.\.\/){1,2}styles\/workspace\.css";\n/,
        "",
      );
      expect(productWorkspacePageAllowed(path, before, candidate)).toBe(true);
      expect(
        productWorkspacePageAllowed(
          path,
          before,
          candidate.replace('Astro.redirect("/cases")', 'Astro.redirect("/new")'),
        ),
      ).toBe(false);
      expect(
        productWorkspacePageAllowed(
          path,
          before,
          candidate.replace("caseId={caseId}", 'caseId="changed"'),
        ),
      ).toBe(false);
    }
    expect(
      productWorkspacePageAllowed(
        "src/pages/cases/[caseId]/summary.astro",
        baselineWorkspacePage,
        baselineWorkspacePage,
      ),
    ).toBe(false);
  });

  test("a staged page-routing change cannot hide behind the allowed CSS import removal", async () => {
    const { root, base } = await repository();
    const path = "src/pages/cases/[caseId].astro";
    const candidate = baselineWorkspacePage.replace('import "../../styles/workspace.css";\n', "");
    await file(root, path, candidate);
    expect((await checkProductWorkspacePreservation(root, base)).findings).toEqual([]);
    await file(root, path, candidate.replace('Astro.redirect("/cases")', 'Astro.redirect("/new")'));
    await git(root, "add", path);
    await file(root, path, candidate);
    expect((await checkProductWorkspacePreservation(root, base)).findings).toContainEqual({
      path,
      code: "unapproved_workspace_page_patch",
    });
  });

  test("checks committed visual work together with untracked new views", async () => {
    const { root, base } = await repository();
    expect((await checkProductWorkspacePreservation(root, base)).findings).toEqual([]);
    await file(root, "src/components/workspace/Workspace.tsx", "synthetic visual extraction\n");
    await file(root, "package.json", JSON.stringify(phasePackage));
    await git(root, "add", ".");
    await commit(root);
    await file(
      root,
      "src/product-ui/conversation/ConversationComposer.tsx",
      "export const synthetic = true;\n",
    );
    const result = await checkProductWorkspacePreservation(root, base);
    expect(result.findings).toEqual([]);
    expect(result.changes).toBe(3);
  });

  test("a protected commit remains visible even if its working content is restored", async () => {
    const { root, base } = await repository();
    await file(root, "src/server/module.ts", "synthetic protected change\n");
    await git(root, "add", ".");
    await commit(root);
    await file(root, "src/server/module.ts");
    expect((await checkProductWorkspacePreservation(root, base)).findings).toContainEqual({
      path: "src/server/module.ts",
      code: "outside_product_workspace_scope",
    });
  });

  test("a staged shared-client edit cannot be hidden by an unchanged working file", async () => {
    const { root, base } = await repository();
    await file(root, "packages/api-client/src/index.ts", "synthetic protected change\n");
    await git(root, "add", ".");
    await file(root, "packages/api-client/src/index.ts");
    expect((await checkProductWorkspacePreservation(root, base)).findings).toContainEqual({
      path: "packages/api-client/src/index.ts",
      code: "outside_product_workspace_scope",
    });
  });

  test("new allowed paths must be regular files and renames cannot hide a landing removal", async () => {
    const { root, base } = await repository();
    await mkdir(join(root, "src/product-ui/conversation"), { recursive: true });
    await git(
      root,
      "mv",
      "src/pages/index.astro",
      "src/product-ui/conversation/ConversationComposer.tsx",
    );
    await mkdir(join(root, "src/product-ui/intake"), { recursive: true });
    await symlink("../../server/module.ts", join(root, "src/product-ui/intake/QuestionsView.tsx"));
    const result = await checkProductWorkspacePreservation(root, base);
    expect(result.findings).toContainEqual({
      path: "src/pages/index.astro",
      code: "workspace_phase_removal_or_type_change",
    });
    expect(result.findings).toContainEqual({
      path: "src/product-ui/intake/QuestionsView.tsx",
      code: "workspace_phase_regular_file_required",
    });
  });

  test("package snapshots reject a staged dependency edit hidden behind allowed aliases", async () => {
    const { root, base } = await repository();
    await file(
      root,
      "package.json",
      JSON.stringify({ ...phasePackage, dependencies: { react: "changed" } }),
    );
    await git(root, "add", "package.json");
    await file(root, "package.json", JSON.stringify(phasePackage));
    expect((await checkProductWorkspacePreservation(root, base)).findings).toContainEqual({
      path: "package.json",
      code: "unapproved_workspace_package_patch",
    });
  });

  test("selector migrations are limited to reviewed real components and keep runtime assertions exact", async () => {
    const path = "tests/browser/chat-attachments.e2e.ts";
    const before =
      'const row = page.locator(".workspace-composer-row");\nconst surface = page.locator(".workspace-composer-surface");\nconst form = page.locator(".workspace-composer");\nconst send = row.locator(".workspace-send");\nawait expect(send).toBeFocused();\nexpect(apiCalls).toBe(0);\n';
    const expected =
      'const row = page.locator("[data-product-composer-row]");\nconst surface = page.locator("[data-product-composer-surface]");\nconst form = page.locator("[data-product-composer]");\nconst send = row.locator("[data-product-composer-send]");\nawait expect(send).toBeFocused();\nexpect(apiCalls).toBe(0);\n';
    expect(productWorkspaceSelectorPaths).toHaveLength(18);
    expect(migrateProductWorkspaceSelectors(path, before)).toBe(expected);
    expect(await productWorkspaceSelectorsAllowed(path, before, expected)).toBe(true);
    expect(
      await productWorkspaceSelectorsAllowed(
        path,
        before,
        expected.replace("toBeFocused()", "toBeVisible()"),
      ),
    ).toBe(false);
    expect(
      await productWorkspaceSelectorsAllowed(path, before, expected.replace("toBe(0)", "toBe(1)")),
    ).toBe(false);
    expect(
      migrateProductWorkspaceSelectors("tests/browser/conversation-agent.e2e.ts", before),
    ).toBe(before);
    expect(
      await productWorkspaceSelectorsAllowed(
        "tests/browser/conversation-agent.e2e.ts",
        before,
        expected,
      ),
    ).toBe(false);
  });

  test("questions keep transition, recovery and geometry assertions while appearance uses the explicit hook", async () => {
    const path = "tests/browser/intake-saved-review.e2e.ts";
    const before =
      '  const panel = page.locator(".intake-recovery");\n  await expect(panel.getByRole("button", { name: "나중에 이어하기", exact: true })).toHaveClass(\n    /ui-button--outline/,\n  );\n  const navigation = page.locator(".intake-scene-navigation");\n  expect(gap).toBeGreaterThanOrEqual(24);\n';
    const expected =
      '  const panel = page.locator("[data-product-question-recovery]");\n  await expect(panel.getByRole("button", { name: "나중에 이어하기", exact: true })).toHaveAttribute(\n    "data-appearance",\n    "outline",\n  );\n  const navigation = page.locator("[data-product-question-navigation]");\n  expect(gap).toBeGreaterThanOrEqual(24);\n';
    expect(migrateProductWorkspaceSelectors(path, before)).toBe(expected);
    expect(await productWorkspaceSelectorsAllowed(path, before, expected)).toBe(true);
    expect(
      await productWorkspaceSelectorsAllowed(
        path,
        before,
        expected.replace("OrEqual(24)", "OrEqual(0)"),
      ),
    ).toBe(false);
  });

  test("responsive panel selectors keep the original inline/sheet mode assertion", async () => {
    const path = "tests/browser/app-workspace.e2e.ts";
    const before =
      'await expect(page.locator(".ds-responsive-panel")).toHaveAttribute("data-mode", "inline");\n';
    const expected =
      'await expect(page.locator("[data-product-workspace-panel]")).toHaveAttribute("data-mode", "inline");\n';
    expect(migrateProductWorkspaceSelectors(path, before)).toBe(expected);
    expect(await productWorkspaceSelectorsAllowed(path, before, expected)).toBe(true);
    expect(
      await productWorkspaceSelectorsAllowed(path, before, expected.replace('"inline"', '"sheet"')),
    ).toBe(false);
    expect(migrateProductWorkspaceSelectors("tests/browser/precedents.e2e.ts", before)).toBe(
      before,
    );
  });

  test("home target-size coverage uses real native controls and cannot pass on an empty list", async () => {
    const path = "tests/browser/conversation-home.e2e.ts";
    const before =
      'page.locator(".conversation-home button:not([role=radio]), .conversation-context label");\n  expect(targetHeights.every((height) => height >= 44)).toBe(true);\n';
    const expected = migrateProductWorkspaceSelectors(path, before);
    expect(expected).toContain("[data-product-case-input] label:has(input[type=radio])");
    expect(expected).toContain("expect(targetHeights.length).toBeGreaterThan(0)");
    expect(await productWorkspaceSelectorsAllowed(path, before, expected)).toBe(true);
    expect(
      await productWorkspaceSelectorsAllowed(
        path,
        before,
        expected.replace("height >= 44", "height >= 40"),
      ),
    ).toBe(false);
  });

  test("staged browser assertion edits cannot hide behind an authorized selector migration", async () => {
    const { root, base } = await repository();
    const path = "tests/browser/workspace.e2e.ts";
    const candidate = migrateProductWorkspaceSelectors(path, composerTest);
    await file(root, path, candidate);
    expect((await checkProductWorkspacePreservation(root, base)).findings).toEqual([]);
    await file(root, path, candidate.replace("toHaveCount(1)", "toHaveCount(0)"));
    await git(root, "add", path);
    await file(root, path, candidate);
    expect((await checkProductWorkspacePreservation(root, base)).findings).toContainEqual({
      path,
      code: "unapproved_workspace_selector_patch",
    });
  });
});
