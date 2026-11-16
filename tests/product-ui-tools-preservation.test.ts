/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: Synthetic source retains literal interpolation syntax. */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import ts from "typescript";
import {
  checkProductToolsPreservation,
  migrateProductToolsIntegration,
  migrateProductToolsSelectors,
  productToolsChangeFindings,
  productToolsIntegrationAllowed,
  productToolsNewFixtureAllowed,
  productToolsPackageAllowed,
  productToolsSelectorsAllowed,
} from "../scripts/check-product-tools-preservation";

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
  name: "synthetic-tools-phase",
  dependencies: { react: "19.3.0" },
  devDependencies: { "@tailwindcss/node": "4.3.3" },
  overrides: { transitive: "1.0.0" },
  scripts: {
    "product-ui:check": "bun scripts/check-product-landing-preservation.ts",
    "product-shell:check": "bun scripts/check-product-shell-preservation.ts",
    "product-workspace:check": "bun scripts/check-product-workspace-preservation.ts",
    "product-details:check": "bun scripts/check-product-details-preservation.ts",
    "product-landing:check": "bun scripts/check-product-landing-preservation.ts",
    test: "bun test",
  },
};
const phasePackage = {
  ...baselinePackage,
  scripts: {
    ...baselinePackage.scripts,
    "product-ui:check": "bun scripts/check-product-tools-preservation.ts",
    "product-tools:check": "bun scripts/check-product-tools-preservation.ts",
  },
};
const settingsSource =
  'import "../styles/settings.css";\nimport "../styles/public-compat.css";\nconst id = authorize(Astro.params.caseId);\n<AccountSettings client:load />\n';
const resolutionSource =
  'import { resolve } from "node:path";\nconst css =\n  (await Bun.file(`${root}/src/styles/global.css`).text())\n    .replace(/^@import .*;$/gm, "")\n    .replace(/@theme inline\\s*\\{[^}]*\\}/s, "") +\n  (await Bun.file(`${root}/src/styles/design-system.css`).text()) +\n  (await Bun.file(`${root}/src/styles/resolution.css`).text()) +\n  "main{max-width:840px}";\nconst endpoint = "/fixture/session";\nconst csp = "default-src self";\nconst html = \'<html lang="ko">\';\n';
const reportSource =
  'const css =\n  (await compileProductStyles(root)) +\n  (await Bun.file(`${root}/src/styles/resolution.css`).text()) +\n  (await Bun.file(`${root}/src/styles/settings.css`).text()) +\n  "main{padding:20px}";\nconst endpoint = "/synthetic-photo.jpg";\nconst csp = "default-src self";\n';
const productStyle =
  '/* Product routes retain the business islands\' CSS while new Tailwind utilities\n * can own new chrome. The landing keeps its original BaseLayout and imports. */\n@import "../styles/reports.css" layer(legacy);\n@import "./tokens.css";\n[data-product-shell] { --preserved: 1; }\n';
const resolutionTest =
  'page.locator(".resolution-path");\npage.locator(".resolution");\nexpect(calls.update).toBe(0);\nexpect(gap).toBeGreaterThanOrEqual(24);\n';
async function repository() {
  const root = await mkdtemp(join(tmpdir(), "baro-product-tools-"));
  roots.push(root);
  await git(root, "init", "-q");
  for (const path of [
    "src/components/resolution/FollowUpResolution.tsx",
    "src/components/AccountSettings.tsx",
    "src/components/workspace/ConversationAgent.tsx",
    "src/server/module.ts",
    "src/client/api/index.ts",
    "src/pages/index.astro",
    "src/styles/global.css",
    "src/utils/resolution.ts",
    "src/components/reports/download.ts",
    "apps/mobile/src/App.tsx",
    "packages/api-client/src/index.ts",
    "bun.lock",
  ])
    await file(root, path);
  await file(root, "package.json", JSON.stringify(baselinePackage));
  await file(root, "src/pages/settings.astro", settingsSource);
  await file(root, "src/product-ui/product.css", productStyle);
  await file(root, "tests/helpers/resolution-server.ts", resolutionSource);
  await file(root, "tests/helpers/reports-ui-server.ts", reportSource);
  await file(root, "tests/browser/report-rework-state.e2e.ts", resolutionTest);
  await git(root, "add", ".");
  await commit(root);
  return { root, base: await git(root, "rev-parse", "HEAD") };
}

describe("tools phase explicit scope", () => {
  test("protects all API/storage/contracts/landing/business helpers and earlier acceptance gates", () => {
    for (const path of [
      "src/server/modules/resolution/service.ts",
      "src/client/api/rework.ts",
      "src/contracts/v2/resolution.ts",
      "src/workflows/files.ts",
      "src/worker.ts",
      "drizzle/schema.ts",
      "migrations/0024.sql",
      "apps/mobile/src/App.tsx",
      "packages/api-client/src/rework.ts",
      "packages/client-core/src/context.ts",
      "src/product-ui/landing/LandingPage.astro",
      "src/product-ui/landing/motion/index.ts",
      "src/layouts/LandingLayout.astro",
      "src/pages/index.astro",
      "public/landing/hero-continuous.mp4",
      "public/fonts/PretendardVariable.woff2",
      "src/styles/global.css",
      "src/styles/resolution.css",
      "src/styles/settings.css",
      "src/components/ui/media-player.tsx",
      "src/utils/resolution.ts",
      "src/components/resolution/draft-review.ts",
      "src/components/resolution/error-diagnostic.ts",
      "src/components/reports/download.ts",
      "src/utils/report-markdown.ts",
      "src/components/workspace/Workspace.tsx",
      "src/product-ui/Button.tsx",
      "src/product-ui/Dialog.tsx",
      "src/product-ui/Select.tsx",
      "scripts/check-product-landing-preservation.ts",
      "scripts/check-product-details-preservation.ts",
      "tests/product-ui-details-preservation.test.ts",
      "tests/helpers/product-shell-fixture.tsx",
      "tests/helpers/conversation-agent-browser-api.ts",
      "tests/helpers/workspace-client-fixture.ts",
      "astro.config.ts",
      "scripts/validate.ts",
      "bun.lock",
    ])
      expect(
        productToolsChangeFindings([{ path, status: "M", existedAtBase: true }]),
      ).toContainEqual({ path, code: "outside_product_tools_scope" });
  });

  test("accepts only declared facades, views, controllers, tests and current named integration paths", () => {
    const existing = [
      "src/components/workspace/ConversationAgent.tsx",
      "src/components/workspace/MessageContent.tsx",
      "src/components/resolution/FollowUpResolution.tsx",
      "src/components/AccountSettings.tsx",
      "src/components/lawyers/LegacyProfileAssets.tsx",
      "src/product-ui/Disclosure.tsx",
      "src/product-ui/product.css",
      "src/pages/settings.astro",
      "tests/helpers/resolution-server.ts",
      "tests/helpers/reports-ui-server.ts",
      "tests/helpers/conversation-agent-page.astro",
      "tests/helpers/conversation-agent.astro.config.ts",
      "tests/helpers/workspace.astro.config.ts",
      "tests/helpers/intake-reconfirmation.astro.config.ts",
      "tests/product-ui-detail-primitives.test.tsx",
    ];
    const added = [
      "src/product-ui/conversation-tools/AnalysisView.tsx",
      "src/product-ui/conversation-tools/useConversationPanelController.ts",
      "src/product-ui/resolution/ResolutionView.tsx",
      "src/product-ui/account/useAccountSettingsController.ts",
      "src/product-ui/account/LegacyProfileAssetsView.tsx",
      "tests/product-ui-resolution.test.tsx",
      "tests/product-ui-account.test.tsx",
      "scripts/check-product-tools-preservation.ts",
      "tests/product-ui-tools-preservation.test.ts",
      "docs/quality/tools/synthetic.png",
    ];
    expect(
      productToolsChangeFindings([
        ...existing.map((path) => ({ path, status: "M", existedAtBase: true })),
        ...added.map((path) => ({ path, status: "A", existedAtBase: false })),
      ]),
    ).toEqual([]);
    for (const path of [
      "src/product-ui/resolution/NewAPI.ts",
      "src/product-ui/account/Unreviewed.tsx",
      "tests/product-ui-tools-preservation.test.tsx",
      "src/product-ui/conversation-tools/debug.ts",
    ])
      expect(productToolsChangeFindings([{ path, status: "A", existedAtBase: false }])).not.toEqual(
        [],
      );
    expect(
      productToolsChangeFindings([
        { path: "src/product-ui/resolution/ResolutionView.tsx", status: "M", existedAtBase: true },
      ]),
    ).not.toEqual([]);
  });

  test("rejects invalid paths, deletions, type changes and rename status instead of widening the phase", () => {
    for (const path of [
      "",
      "/tmp/allowed.ts",
      "src/../secret.ts",
      "src\\secret.ts",
      "src//secret.ts",
      "src/\nsecret.ts",
    ])
      expect(
        productToolsChangeFindings([{ path, status: "M", existedAtBase: true }]),
      ).toContainEqual({ path, code: "invalid_repository_path" });
    for (const status of ["D", "T", "R100"])
      expect(
        productToolsChangeFindings([
          { path: "src/components/AccountSettings.tsx", status, existedAtBase: true },
        ]),
      ).toContainEqual({
        path: "src/components/AccountSettings.tsx",
        code: "tools_phase_removal_or_type_change",
      });
  });

  test("only switches the current landing alias and adds tools, preserving every prior command/dependency/override", () => {
    expect(productToolsPackageAllowed(baselinePackage, baselinePackage)).toBe(true);
    expect(productToolsPackageAllowed(baselinePackage, phasePackage)).toBe(true);
    for (const candidate of [
      { ...phasePackage, dependencies: { react: "changed" } },
      { ...phasePackage, devDependencies: {} },
      { ...phasePackage, overrides: {} },
      ...Object.keys(baselinePackage.scripts)
        .filter((key) => key !== "product-ui:check")
        .map((key) => ({ ...phasePackage, scripts: { ...phasePackage.scripts, [key]: "true" } })),
      { ...phasePackage, scripts: { ...phasePackage.scripts, "product-tools:check": "true" } },
      { ...phasePackage, scripts: { ...phasePackage.scripts, extra: "true" } },
    ])
      expect(productToolsPackageAllowed(baselinePackage, candidate)).toBe(false);
    for (const value of [null, [], true, { scripts: [] }])
      expect(productToolsPackageAllowed(value, phasePackage)).toBe(false);
    expect(
      productToolsPackageAllowed(
        {
          ...baselinePackage,
          scripts: {
            ...baselinePackage.scripts,
            "product-ui:check": "bun scripts/check-product-details-preservation.ts",
          },
        },
        phasePackage,
      ),
    ).toBe(false);
  });
});

describe("tools phase exact selectors and style integration", () => {
  test("resolution selectors preserve owner/API counts, output and geometry assertions", async () => {
    const path = "tests/browser/report-rework-state.e2e.ts";
    const expected =
      'page.locator("[data-product-resolution-path]");\npage.locator("[data-product-resolution]");\nexpect(calls.update).toBe(0);\nexpect(gap).toBeGreaterThanOrEqual(24);\n';
    expect(migrateProductToolsSelectors(path, resolutionTest)).toBe(expected);
    expect(await productToolsSelectorsAllowed(path, resolutionTest, expected)).toBe(true);
    const spread =
      'const next = { ...resolution, ...resolutionState(report) };\nconst payload = { message: ".resolution" };\n';
    expect(migrateProductToolsSelectors(path, spread + resolutionTest)).toBe(spread + expected);
    for (const candidate of [
      expected.replace("toBe(0)", "toBe(1)"),
      expected.replace("OrEqual(24)", "OrEqual(0)"),
      expected.replace("page.locator", "page.firstLocator"),
    ])
      expect(await productToolsSelectorsAllowed(path, resolutionTest, candidate)).toBe(false);
  });

  test("consumer-specific conversation maps preserve pane focus and plural source containers", async () => {
    const source =
      'page.locator(".workspace-source-card");\nelement.querySelector(".workspace-source-cards");\ndocument.querySelector(".conversation-panel");\nexpect(rgb).toBe("rgb(1, 2, 3)");\n';
    const expected =
      'page.locator("[data-product-source-card]");\nelement.querySelector("[data-product-source-cards]");\ndocument.querySelector(".conversation-panel");\nexpect(rgb).toBe("rgb(1, 2, 3)");\n';
    expect(migrateProductToolsSelectors("tests/browser/product-ui.e2e.ts", source)).toBe(expected);
    expect(
      await productToolsSelectorsAllowed(
        "tests/browser/product-ui.e2e.ts",
        source,
        expected.replace("rgb(1, 2, 3)", "rgb(0, 0, 0)"),
      ),
    ).toBe(false);
    expect(
      migrateProductToolsSelectors("tests/browser/report-official-source-links.e2e.ts", source),
    ).toBe(source);
    expect(
      migrateProductToolsSelectors(
        "tests/browser/chat-attachments.e2e.ts",
        'page.locator(".workspace-message--assistant .workspace-message-content");',
      ),
    ).toBe('page.locator(".workspace-message--assistant [data-product-message-content]");');
    expect(
      migrateProductToolsSelectors(
        "tests/browser/conversation-agent.e2e.ts",
        'expect(page.locator(".conversation-agent")).toHaveCount(0);',
      ),
    ).toBe('expect(page.locator("[data-product-conversation-agent]")).toHaveCount(0);');
  });

  test("settings removes one raw CSS import and preserves public-compat, route authorization and island bytes", () => {
    const path = "src/pages/settings.astro";
    const expected = settingsSource.replace('import "../styles/settings.css";\n', "");
    expect(productToolsIntegrationAllowed(path, settingsSource, expected)).toBe(true);
    for (const candidate of [
      expected.replace("authorize", "skipAccess"),
      expected.replace("client:load", "client:only"),
      expected.replace('import "../styles/public-compat.css";\n', ""),
    ])
      expect(productToolsIntegrationAllowed(path, settingsSource, candidate)).toBe(false);
    expect(productToolsIntegrationAllowed("src/pages/new.astro", settingsSource, expected)).toBe(
      false,
    );
    expect(
      migrateProductToolsIntegration(path, `${settingsSource}import "../styles/settings.css";\n`),
    ).toBeNull();
  });

  test("account consumers retain section relationships, geometry and legacy zero checks without corrupting quoted Axe selectors", async () => {
    const path = "tests/browser/settings.e2e.ts";
    const source =
      'page.locator(`.settings-${section} .settings-section-heading`);\npage.locator(".settings-provider");\nexpect(center).toBeLessThanOrEqual(1);\n';
    const migrated = migrateProductToolsSelectors(path, source);
    expect(migrated).toContain(
      '`[aria-labelledby="settings-${section}-title"] [data-product-account-section-heading]`',
    );
    expect(migrated).toContain("[data-product-account-provider]");
    expect(await productToolsSelectorsAllowed(path, source, migrated)).toBe(true);
    expect(
      await productToolsSelectorsAllowed(
        path,
        source,
        migrated.replace("OrEqual(1)", "OrEqual(2)"),
      ),
    ).toBe(false);
    expect(
      migrateProductToolsSelectors(
        "tests/browser/shell-integration.e2e.ts",
        'page.locator(".settings-refresh");\nexpect(page.locator(".settings-case-delete")).toHaveCount(0);',
      ),
    ).toContain('expect(page.locator(".settings-case-delete")).toHaveCount(0)');
    const axe = migrateProductToolsSelectors(
      "tests/browser/reports.e2e.ts",
      'new AxeBuilder({page}).include(".report-modal");\n',
    );
    const checked = ts.transpileModule(axe, { reportDiagnostics: true });
    expect(
      checked.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error),
    ).toEqual([]);
    expect(axe).toContain(String.raw`[role=\"dialog\"]`);
    expect(
      migrateProductToolsSelectors(
        "tests/browser/resolution.e2e.ts",
        'page.locator(".report-modal");',
      ),
    ).toBe('page.locator(".report-modal");');
  });

  test("fixture changes are limited to stylesheet compilation and the approved HTML root marker", () => {
    for (const [path, source] of [
      ["tests/helpers/resolution-server.ts", resolutionSource],
      ["tests/helpers/reports-ui-server.ts", reportSource],
    ] as const) {
      const expected = migrateProductToolsIntegration(path, source);
      if (!expected) throw new Error("MISSING_SYNTHETIC_COMPILER_PATCH");
      expect(productToolsIntegrationAllowed(path, source, expected)).toBe(true);
      expect(expected).toContain("compileProductStyles(root)");
      expect(expected).not.toContain("src/styles/settings.css");
      for (const candidate of [
        expected
          .replace("/fixture/session", "/fixture/other")
          .replace("/synthetic-photo.jpg", "/other.jpg"),
        expected.replace("default-src self", "default-src unsafe"),
        expected.replace("const endpoint", "const changedEndpoint"),
      ])
        expect(productToolsIntegrationAllowed(path, source, candidate)).toBe(false);
    }
    const migrated = migrateProductToolsIntegration(
      "tests/helpers/resolution-server.ts",
      resolutionSource,
    );
    expect(migrated).toContain('data-baro-ui data-product-chrome="v2"');
    expect(
      productToolsIntegrationAllowed(
        "tests/helpers/product-shell-fixture.tsx",
        resolutionSource,
        resolutionSource,
      ),
    ).toBe(false);
  });

  test("product stylesheet adds only the two legacy imports and approved explanatory comment", () => {
    const path = "src/product-ui/product.css";
    const expected = migrateProductToolsIntegration(path, productStyle);
    if (!expected) throw new Error("MISSING_SYNTHETIC_PRODUCT_STYLE_PATCH");
    expect(productToolsIntegrationAllowed(path, productStyle, expected)).toBe(true);
    expect(expected).toContain('@import "../styles/resolution.css" layer(legacy);');
    expect(expected).toContain('@import "../styles/settings.css" layer(legacy);');
    expect(
      productToolsIntegrationAllowed(
        path,
        productStyle,
        expected.replace("--preserved: 1", "--preserved: 0"),
      ),
    ).toBe(false);
  });

  test("the new conversation fixture CSS permits only the existing legacy layer import", () => {
    const path = "tests/helpers/conversation-agent-legacy.css";
    const approved =
      '/* Preserve the isolated fixture\'s old chrome inside the same legacy layer. */\n@import "../../src/styles/product.css" layer(legacy);\n';
    expect(productToolsNewFixtureAllowed(path, approved)).toBe(true);
    expect(productToolsNewFixtureAllowed(path, approved.replace("layer(legacy)", ""))).toBe(false);
    expect(
      productToolsNewFixtureAllowed(
        path,
        `${approved}@import "https://untrusted.example/style.css";\n`,
      ),
    ).toBe(false);
    expect(productToolsNewFixtureAllowed("src/styles/product.css", approved)).toBe(false);
  });
});

describe("tools phase git state cannot conceal protected changes", () => {
  test("accepts committed allowed facades and untracked declared views against the explicit baseline", async () => {
    const { root, base } = await repository();
    expect((await checkProductToolsPreservation(root, base)).findings).toEqual([]);
    await file(root, "src/components/AccountSettings.tsx", "synthetic new facade\n");
    await file(root, "package.json", JSON.stringify(phasePackage));
    await git(root, "add", ".");
    await commit(root);
    await file(
      root,
      "src/product-ui/resolution/ResolutionView.tsx",
      "export const synthetic = true;\n",
    );
    expect((await checkProductToolsPreservation(root, base)).findings).toEqual([]);
  });

  test("protected HEAD and index edits stay visible after restoring the working tree", async () => {
    const { root, base } = await repository();
    await file(root, "src/server/module.ts", "synthetic protected change\n");
    await git(root, "add", ".");
    await commit(root);
    await file(root, "src/server/module.ts");
    await file(root, "src/client/api/index.ts", "synthetic protected change\n");
    await git(root, "add", "src/client/api/index.ts");
    await file(root, "src/client/api/index.ts");
    const result = await checkProductToolsPreservation(root, base);
    for (const path of ["src/server/module.ts", "src/client/api/index.ts"])
      expect(result.findings).toContainEqual({ path, code: "outside_product_tools_scope" });
  });

  test("staged selector weakening, endpoint changes and settings access changes cannot hide behind approved working patches", async () => {
    const { root, base } = await repository();
    const browser = "tests/browser/report-rework-state.e2e.ts";
    const helper = "tests/helpers/resolution-server.ts";
    const settings = "src/pages/settings.astro";
    const patches = [
      [browser, migrateProductToolsSelectors(browser, resolutionTest)],
      [helper, migrateProductToolsIntegration(helper, resolutionSource)],
      [settings, migrateProductToolsIntegration(settings, settingsSource)],
    ] as const;
    for (const [path, source] of patches) {
      if (!source) throw new Error("MISSING_SYNTHETIC_PATCH");
      await file(
        root,
        path,
        source
          .replace("toBe(0)", "toBe(1)")
          .replace("/fixture/session", "/fixture/other")
          .replace("authorize", "skipAccess"),
      );
    }
    await git(root, "add", ".");
    for (const [path, source] of patches) {
      if (!source) throw new Error("MISSING_SYNTHETIC_PATCH");
      await file(root, path, source);
    }
    const result = await checkProductToolsPreservation(root, base);
    for (const [path] of patches)
      expect(result.findings).toContainEqual({ path, code: "unapproved_tools_integration_patch" });
  });

  test("untracked undeclared files, symlinks and renamed landing deletions are rejected", async () => {
    const { root, base } = await repository();
    await file(root, "src/product-ui/account/unreviewed.ts", "synthetic\n");
    await mkdir(join(root, "src/product-ui/resolution"), { recursive: true });
    await git(root, "mv", "src/pages/index.astro", "src/product-ui/resolution/ResolutionView.tsx");
    await symlink(
      "../../server/module.ts",
      join(root, "src/product-ui/resolution/ResolutionScope.tsx"),
    );
    const result = await checkProductToolsPreservation(root, base);
    expect(result.findings).toContainEqual({
      path: "src/product-ui/account/unreviewed.ts",
      code: "outside_product_tools_scope",
    });
    expect(result.findings).toContainEqual({
      path: "src/pages/index.astro",
      code: "tools_phase_removal_or_type_change",
    });
    expect(result.findings).toContainEqual({
      path: "src/product-ui/resolution/ResolutionScope.tsx",
      code: "tools_phase_regular_file_required",
    });
  });

  test("a staged new fixture stylesheet cannot hide unapproved imports behind a restored working copy", async () => {
    const { root, base } = await repository();
    const path = "tests/helpers/conversation-agent-legacy.css";
    const approved =
      '/* Preserve the isolated fixture\'s old chrome inside the same legacy layer. */\n@import "../../src/styles/product.css" layer(legacy);\n';
    await file(root, path, approved);
    expect((await checkProductToolsPreservation(root, base)).findings).toEqual([]);
    await file(root, path, approved.replace("layer(legacy)", ""));
    await git(root, "add", path);
    await file(root, path, approved);
    expect((await checkProductToolsPreservation(root, base)).findings).toContainEqual({
      path,
      code: "unapproved_tools_integration_patch",
    });
  });
});
