import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  checkProductSurfacesPreservation,
  migrateProductSurfacesIntegration,
  migrateProductSurfacesSelectors,
  productSurfacesChangeFindings,
  productSurfacesIntegrationAllowed,
  productSurfacesPackageAllowed,
  productSurfacesSelectorsAllowed,
} from "../scripts/check-product-surfaces-preservation";

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
const priorPackage = {
  dependencies: { react: "19.3.0" },
  devDependencies: { typescript: "6.0.0" },
  overrides: { transitive: "1.0.0" },
  scripts: {
    "product-ui:check": "bun scripts/check-product-materials-preservation.ts",
    "product-shell:check": "bun scripts/check-product-shell-preservation.ts",
    "product-workspace:check": "bun scripts/check-product-workspace-preservation.ts",
    "product-details:check": "bun scripts/check-product-details-preservation.ts",
    "product-landing:check": "bun scripts/check-product-landing-preservation.ts",
    "product-tools:check": "bun scripts/check-product-tools-preservation.ts",
    "product-materials:check": "bun scripts/check-product-materials-preservation.ts",
    test: "bun test",
  },
};
const phasePackage = {
  ...priorPackage,
  scripts: {
    ...priorPackage.scripts,
    "product-ui:check": "bun scripts/check-product-surfaces-preservation.ts",
    "product-surfaces:check": "bun scripts/check-product-surfaces-preservation.ts",
  },
};
const browserSource = [
  "const next = { ...workspaceState };",
  'const payload = { text: ".workspace-main", url: "/api/cases/synthetic" };',
  'page.locator(".workspace .workspace-message--assistant .workspace-main");',
  'page.locator(".workspace-dialog");',
  'node.querySelector<HTMLElement>(".workspace-preview > .workspace-buttons");',
  'page.locator(".workspace-status--ready");',
  "await expect(primary).toHaveClass(/ui-button--primary/);",
  'expect(rgb).toBe("rgb(255, 255, 255)");',
  "expect(calls).toBe(1);",
  "expect(Math.abs(left - right)).toBeLessThanOrEqual(1);",
  "",
].join("\n");
async function repository() {
  const root = await mkdtemp(join(tmpdir(), "baro-product-surfaces-"));
  roots.push(root);
  await git(root, "init", "-q");
  for (const path of [
    "src/components/workspace/Workspace.tsx",
    "src/server/module.ts",
    "src/client/api/index.ts",
    "src/pages/index.astro",
    "src/product-ui/Dialog.tsx",
    "bun.lock",
  ])
    await file(root, path);
  await file(root, "package.json", JSON.stringify(priorPackage));
  await file(root, "tests/browser/workspace.e2e.ts", browserSource);
  await git(root, "add", ".");
  await commit(root);
  return { root, base: await git(root, "rev-parse", "HEAD") };
}

describe("remaining surfaces named scope and preserved package gates", () => {
  test("protects APIs, contracts, domain helpers, old experience/range, landing, all prior guards and the lockfile", () => {
    for (const path of [
      "src/client/api/session.ts",
      "src/server/api/cases.ts",
      "packages/api-client/src/workspace.ts",
      "packages/client-core/src/session.ts",
      "src/contracts/results.ts",
      "src/server/modules/files/review.ts",
      "drizzle/schema.ts",
      "apps/mobile/src/App.tsx",
      "src/client/confirm.ts",
      "src/client/theme.ts",
      "src/components/ui/experience.tsx",
      "src/components/ui/range.tsx",
      "src/components/workspace/timeline-draft.ts",
      "src/components/workspace/processing-progress.ts",
      "src/components/workspace/useEvidenceUpload.ts",
      "src/utils/report-markdown.ts",
      "src/product-ui/landing/LandingPage.astro",
      "src/pages/index.astro",
      "public/landing/hero-continuous.mp4",
      "src/styles/workspace.css",
      "src/styles/global.css",
      "src/product-ui/product.css",
      "src/product-ui/Field.tsx",
      "src/product-ui/state.ts",
      "scripts/check-product-materials-preservation.ts",
      "tests/product-ui-material-research-preservation.test.ts",
      "scripts/validate.ts",
      "astro.config.ts",
      "tests/helpers/workspace-client-fixture.ts",
      "bun.lock",
    ])
      expect(
        productSurfacesChangeFindings([{ path, status: "M", existedAtBase: true }]),
      ).toContainEqual({ path, code: "outside_product_surfaces_scope" });
  });

  test("accepts only declared legacy/workspace/playback/public sources and isolated fixture names", () => {
    for (const path of [
      "src/components/analysis/CaseDetail.tsx",
      "src/components/analysis/Feedback.tsx",
      "src/components/workspace/Workspace.tsx",
      "src/components/workspace/TimelineEvidence.tsx",
      "src/components/ui/media-player.tsx",
      "src/components/AuthButtons.tsx",
      "src/components/ConsentForm.tsx",
      "src/components/HelpFaq.tsx",
    ])
      expect(productSurfacesChangeFindings([{ path, status: "M", existedAtBase: true }])).toEqual(
        [],
      );
    for (const path of [
      "src/product-ui/legacy-case/useCaseDetailController.ts",
      "src/product-ui/workspace/WorkspaceFileViewer.tsx",
      "src/product-ui/playback/Range.tsx",
      "src/product-ui/public/ProviderIcon.tsx",
      "tests/helpers/product-legacy-case-entry.tsx",
      "tests/helpers/product-legacy-case-server.ts",
      "tests/product-ui-legacy-case.test.tsx",
      "tests/product-ui-surfaces-preservation.test.ts",
    ])
      expect(productSurfacesChangeFindings([{ path, status: "A", existedAtBase: false }])).toEqual(
        [],
      );
    for (const path of [
      "src/product-ui/workspace/Unreviewed.tsx",
      "src/product-ui/public/AuthBypass.ts",
      "tests/helpers/product-legacy-case-api.ts",
    ])
      expect(
        productSurfacesChangeFindings([{ path, status: "A", existedAtBase: false }]),
      ).not.toEqual([]);
    expect(
      productSurfacesChangeFindings([
        { path: "src/product-ui/legacy-case/ResultView.tsx", status: "M", existedAtBase: true },
      ]),
    ).not.toEqual([]);
  });

  test("rejects invalid paths and all removals, renames and type changes", () => {
    for (const path of [
      "",
      "/tmp/allowed.ts",
      "src/../secret.ts",
      "src\\secret.ts",
      "src//secret.ts",
      "src/\nsecret.ts",
    ])
      expect(
        productSurfacesChangeFindings([{ path, status: "M", existedAtBase: true }]),
      ).toContainEqual({ path, code: "invalid_repository_path" });
    for (const status of ["D", "T", "R100"])
      expect(
        productSurfacesChangeFindings([
          { path: "src/components/workspace/Workspace.tsx", status, existedAtBase: true },
        ]),
      ).toContainEqual({
        path: "src/components/workspace/Workspace.tsx",
        code: "surfaces_phase_removal_or_type_change",
      });
  });

  test("only the two exact aliases may change; every prior gate, dependency and override remains exact", () => {
    expect(productSurfacesPackageAllowed(priorPackage, priorPackage)).toBe(true);
    expect(productSurfacesPackageAllowed(priorPackage, phasePackage)).toBe(true);
    for (const candidate of [
      { ...phasePackage, dependencies: {} },
      { ...phasePackage, devDependencies: {} },
      { ...phasePackage, overrides: {} },
      ...Object.keys(priorPackage.scripts)
        .filter((key) => key !== "product-ui:check")
        .map((key) => ({ ...phasePackage, scripts: { ...phasePackage.scripts, [key]: "true" } })),
      { ...phasePackage, scripts: { ...phasePackage.scripts, "product-surfaces:check": "true" } },
      { ...phasePackage, scripts: { ...phasePackage.scripts, other: "true" } },
    ])
      expect(productSurfacesPackageAllowed(priorPackage, candidate)).toBe(false);
    for (const candidate of [null, true, [], { scripts: [] }])
      expect(productSurfacesPackageAllowed(priorPackage, candidate)).toBe(false);
  });
});

describe("bounded primitive and compatibility integrations", () => {
  test("the explicit native Select name extension permits only the reviewed candidate", async () => {
    const path = "src/product-ui/Select.tsx";
    const candidate = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    expect(productSurfacesChangeFindings([{ path, status: "M", existedAtBase: true }])).toEqual([]);
    expect(productSurfacesIntegrationAllowed(path, "synthetic prior", candidate)).toBe(true);
    for (const changed of [
      candidate.replace('props["aria-label"] === undefined', 'props["aria-label"] !== undefined'),
      candidate.replace("externalLabel === undefined ? labelId : undefined", "labelId"),
      candidate.replace("onChange={onValueChange}", "onChange={() => {}}"),
      candidate.replace("disabled={disabled}", "disabled={false}"),
      `${candidate}// unreviewed change\n`,
    ])
      expect(productSurfacesIntegrationAllowed(path, "synthetic prior", changed)).toBe(false);
  });

  test("the four final imports/resolver patches retain CSP, cache, API source, fixture URLs and every assertion", () => {
    const fixtures = [
      {
        path: "src/layouts/ProductLayout.astro",
        before:
          'import { Experience } from "../components/ui/experience";\nAstro.response.headers.set("Cache-Control", "private, no-store, no-transform");\nAstro.csp?.insertScriptHash(hash);\n<Experience client:load />',
        after:
          'import { ProductExperience as Experience } from "../product-ui/experience/ProductExperience";\nAstro.response.headers.set("Cache-Control", "private, no-store, no-transform");\nAstro.csp?.insertScriptHash(hash);\n<Experience client:load />',
      },
      {
        path: "src/components/AccountSettings.tsx",
        before:
          'import { ProviderIcon } from "./AuthButtons";\nreturn <AccountSettingsView providerIcon={(provider) => <ProviderIcon provider={provider} />} />;',
        after:
          'import { ProviderIcon } from "../product-ui/public/ProviderIcon";\nreturn <AccountSettingsView providerIcon={(provider) => <ProviderIcon provider={provider} />} />;',
      },
      {
        path: "tests/helpers/workspace.astro.config.ts",
        before:
          'if (source === "../../client/api" && importer?.endsWith("/components/workspace/Workspace.tsx")) return fixtureURL;\nreturn null;',
        after:
          'if (source === "../../client/api" && importer?.endsWith("/product-ui/workspace/useWorkspaceController.ts")) return fixtureURL;\nreturn null;',
      },
      {
        path: "tests/product-ui-fixture-resolvers.test.ts",
        before:
          'test("workspace retains its original subjects while moving only Agent and FileReview owners", () => {\nconst positive = [\n      "components/workspace/Workspace.tsx",\n];\nconst negative = [\n      "components/workspace/ConversationAgent.tsx",\n      "components/workspace/FileReview.tsx",\n];\nexpect(resolve(source)).toBeNull();\n});',
        after:
          'test("workspace isolates the actual owning controllers after each UI migration", () => {\nconst positive = [\n      "product-ui/workspace/useWorkspaceController.ts",\n];\nconst negative = [\n      "components/workspace/Workspace.tsx",\n      "product-ui/workspace/WorkspaceView.tsx",\n      "components/workspace/ConversationAgent.tsx",\n      "components/workspace/FileReview.tsx",\n];\nexpect(resolve(source)).toBeNull();\n});',
      },
    ];
    for (const { path, before, after } of fixtures) {
      expect(migrateProductSurfacesIntegration(path, before)).toBe(after);
      expect(productSurfacesIntegrationAllowed(path, before, after)).toBe(true);
      expect(productSurfacesIntegrationAllowed(path, before, `${after}\n// arbitrary change`)).toBe(
        false,
      );
    }
    const layout = fixtures[0];
    if (!layout) throw new Error("MISSING_SYNTHETIC_LAYOUT");
    expect(
      productSurfacesIntegrationAllowed(
        layout.path,
        layout.before,
        layout.after.replace("private, no-store, no-transform", "public"),
      ),
    ).toBe(false);
    expect(
      productSurfacesIntegrationAllowed(
        layout.path,
        layout.before,
        layout.after.replace("insertScriptHash(hash)", "insertScriptHash(unverifiedHash)"),
      ),
    ).toBe(false);
  });

  test("the two variant markers preserve Button default, native handlers and link availability bytes", () => {
    const path = "src/product-ui/Button.tsx";
    const base = [
      "function Button() { return (",
      "    <HeadlessButton",
      "      {...props}",
      "      {...(ref === undefined ? {} : { ref })}",
      "      type={type}",
      "      disabled={disabled}",
      "      onClick={onClick}",
      "    />); }",
      "function Link() { return (",
      "    <a",
      "      {...props}",
      "      href={unavailable ? undefined : href}",
      "      rel={safeRel}",
      "      onClick={click}",
      "    />); }",
      "",
    ].join("\n");
    const expected = base
      .replace(
        "      type={type}",
        '      data-variant={variant === undefined ? "primary" : variant}\n      type={type}',
      )
      .replace(
        "      href={unavailable ? undefined : href}",
        '      data-variant={variant === undefined ? "primary" : variant}\n      href={unavailable ? undefined : href}',
      );
    expect(migrateProductSurfacesIntegration(path, base)).toBe(expected);
    expect(productSurfacesIntegrationAllowed(path, base, expected)).toBe(true);
    for (const candidate of [
      expected.replace("variant === undefined", "!variant"),
      expected.replace("disabled={disabled}", "disabled={false}"),
      expected.replace("onClick={click}", "onClick={onClick}"),
      expected.replace("unavailable ? undefined : href", "href"),
    ])
      expect(productSurfacesIntegrationAllowed(path, base, candidate)).toBe(false);
  });

  test("the reviewed complete Dialog extension is pinned, including its default layout, close and focus behavior", async () => {
    const path = "src/product-ui/Dialog.tsx";
    const candidate = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    expect(productSurfacesIntegrationAllowed(path, "synthetic prior", candidate)).toBe(true);
    for (const changed of [
      candidate.replace('placement = "center"', 'placement = "responsive-sheet"'),
      candidate.replace("onClose={onClose}", "onClose={() => {}}"),
      candidate.replace(
        "restoreFocus(returnFocusRef.current ?? origin.current)",
        "restoreFocus(null)",
      ),
      `${candidate}// extra\n`,
    ])
      expect(productSurfacesIntegrationAllowed(path, "synthetic prior", changed)).toBe(false);
    expect(productSurfacesIntegrationAllowed("src/product-ui/Field.tsx", "same", "same")).toBe(
      false,
    );
  });
});

describe("actual consumer selectors retain behavior and assertion bytes", () => {
  test("public consumers keep the complete focus scope, provider accessibility and policy-zero selectors", () => {
    const focus = 'document.querySelector(".app-frame, .login-page, .consent-page");';
    expect(migrateProductSurfacesSelectors("tests/browser/product-ui.e2e.ts", focus)).toBe(
      'document.querySelector(".app-frame, [data-product-public]");',
    );
    const auth =
      'page.locator(".login-options");\npage.locator(".login-panel__description");\npage.getByRole("link", {name:"BARO 홈"});';
    const next = migrateProductSurfacesSelectors("tests/browser/auth.e2e.ts", auth);
    expect(next).toContain("[data-product-auth]");
    expect(next).toContain("[data-product-login-description]");
    expect(next).toContain('page.getByRole("link", {name:"BARO 홈"})');
    expect(
      migrateProductSurfacesSelectors(
        "tests/browser/policy-content.e2e.ts",
        "expect(page.locator('.policy-document a[href^=\"#\"]')).toHaveCount(0);",
      ),
    ).toBe(
      `expect(page.locator(${JSON.stringify('[data-product-policy-document] a[href^="#"]')})).toHaveCount(0);`,
    );
    expect(
      migrateProductSurfacesSelectors(
        "tests/browser/theme-palette.e2e.ts",
        'page.locator(".login-provider");',
      ),
    ).toBe('page.locator("[data-product-auth-provider]");');
  });

  test("keeps imperative workspace/message classes and variants, API data, spread expressions and all measurements", async () => {
    const path = "tests/browser/workspace.e2e.ts";
    const next = migrateProductSurfacesSelectors(path, browserSource);
    expect(next).toContain(
      ".workspace .workspace-message--assistant [data-product-workspace-main]",
    );
    expect(next).toContain('text: ".workspace-main"');
    expect(next).toContain("...workspaceState");
    expect(next).toContain('page.locator(".workspace-status--ready")');
    expect(next).toContain('expect(rgb).toBe("rgb(255, 255, 255)")');
    expect(next).toContain("expect(calls).toBe(1)");
    expect(next).toContain("toBeLessThanOrEqual(1)");
    expect(await productSurfacesSelectorsAllowed(path, browserSource, next)).toBe(true);
    for (const candidate of [
      next.replace("toBe(1)", "toBe(2)"),
      next.replace("rgb(255, 255, 255)", "rgb(0, 0, 0)"),
      next.replace("ThanOrEqual(1)", "ThanOrEqual(100)"),
      next.replace("...workspaceState", "...otherState"),
      next.replace("/api/cases/synthetic", "/api/cases/other"),
    ])
      expect(await productSurfacesSelectorsAllowed(path, browserSource, candidate)).toBe(false);
  });

  test("scopes the original dialog panel through its actual labelled Headless ancestor, and changes no timeout/count", () => {
    const source =
      'page.locator(".workspace-dialog").locator(".workspace-preview > .workspace-buttons");\nexpect(count).toBe(0);';
    const next = migrateProductSurfacesSelectors("tests/browser/workspace.e2e.ts", source);
    expect(next).toContain(
      JSON.stringify('[role="dialog"][aria-labelledby="workspace-dialog-title"] [data-dialog]'),
    );
    expect(next).toContain("[data-product-workspace-preview] > [data-product-workspace-buttons]");
    expect(next).toContain("expect(count).toBe(0)");
  });

  test("maps only the reviewed local geometry helper in its actual consumer; method-independent strings stay intact", () => {
    const source =
      'const measured = box(".workspace-grid");\nother(".workspace-grid");\nconst payload = ".workspace-grid";';
    expect(migrateProductSurfacesSelectors("tests/browser/chat-attachments.e2e.ts", source)).toBe(
      source.replace('box(".workspace-grid")', 'box("[data-product-workspace-grid]")'),
    );
    expect(migrateProductSurfacesSelectors("tests/browser/workspace.e2e.ts", source)).toBe(source);
    expect(
      migrateProductSurfacesSelectors(
        "tests/browser/media-player.e2e.ts",
        'page.locator(".ui-range__track,.ui-media__time");',
      ),
    ).toBe('page.locator(".ui-range__track,.ui-media__time");');
  });

  test("migrates only the approved primary-style assertion and one legacy ready selector with its original timeout", async () => {
    const primary =
      "  await expect(primary).toHaveClass(/ui-button--primary/);\nexpect(height).toBeGreaterThanOrEqual(44);";
    const expected = primary.replace(
      "toHaveClass(/ui-button--primary/)",
      'toHaveAttribute("data-variant", "primary")',
    );
    expect(migrateProductSurfacesSelectors("tests/browser/workspace.e2e.ts", primary)).toBe(
      expected,
    );
    expect(migrateProductSurfacesSelectors("tests/browser/product-ui.e2e.ts", primary)).toBe(
      primary,
    );
    const ready =
      'await expect(page.locator(".workspace-status--ready")).toBeVisible({ timeout: 15000 });';
    const next = ready.replace(
      'page.locator(".workspace-status--ready")',
      'page.getByText("결과 확인 가능", { exact: true })',
    );
    expect(migrateProductSurfacesSelectors("tests/browser/shell-integration.e2e.ts", ready)).toBe(
      next,
    );
    expect(
      await productSurfacesSelectorsAllowed(
        "tests/browser/shell-integration.e2e.ts",
        ready,
        next.replace("15000", "1000"),
      ),
    ).toBe(false);
  });

  test("public route candidates keep HTTP statuses, OAuth branches, policy rendering and restored start actions exact", async () => {
    const cases = [
      ["src/pages/404.astro", "Astro.response.status = 404", "Astro.response.status = 200"],
      [
        "src/pages/lawyers/index.astro",
        "Astro.response.status = 410",
        "Astro.response.status = 200",
      ],
      ["src/pages/login.astro", 'Astro.url.searchParams.has("error")', "false"],
      ["src/pages/help.astro", "ProductPublicLayout showStart", "ProductPublicLayout"],
      ["src/pages/policies/privacy.astro", 'kind="privacy"', 'kind="terms"'],
      ["src/components/PolicyDocument.astro", "policy.sections.map", "[].map"],
    ] as const;
    for (const [path, before, after] of cases) {
      const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
      expect(source).toContain(before);
      expect(productSurfacesIntegrationAllowed(path, "synthetic prior", source)).toBe(true);
      expect(
        productSurfacesIntegrationAllowed(path, "synthetic prior", source.replace(before, after)),
      ).toBe(false);
    }
  });
});

describe("all Git states remain protected", () => {
  test("an unsafe committed primitive cannot hide behind the approved frozen working candidate", async () => {
    const { root, base } = await repository();
    const path = "src/product-ui/Dialog.tsx";
    const candidate = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    await file(root, path, candidate);
    expect((await checkProductSurfacesPreservation(root, base)).findings).toEqual([]);
    await file(root, path, candidate.replace("onClose={onClose}", "onClose={() => {}}"));
    await git(root, "add", path);
    await commit(root);
    await file(root, path, candidate);
    expect((await checkProductSurfacesPreservation(root, base)).findings).toContainEqual({
      path,
      code: "unapproved_surfaces_integration_patch",
    });
  });

  test("accepts declared committed facades and untracked named presentation files", async () => {
    const { root, base } = await repository();
    expect((await checkProductSurfacesPreservation(root, base)).findings).toEqual([]);
    await file(root, "src/components/workspace/Workspace.tsx", "synthetic facade\n");
    await file(root, "package.json", JSON.stringify(phasePackage));
    await git(root, "add", ".");
    await commit(root);
    await file(root, "src/product-ui/legacy-case/ResultView.tsx", "synthetic view\n");
    expect((await checkProductSurfacesPreservation(root, base)).findings).toEqual([]);
  });

  test("protected committed/index changes cannot hide behind restored working bytes", async () => {
    const { root, base } = await repository();
    await file(root, "src/server/module.ts", "protected change\n");
    await git(root, "add", ".");
    await commit(root);
    await file(root, "src/server/module.ts");
    await file(root, "src/client/api/index.ts", "protected change\n");
    await git(root, "add", "src/client/api/index.ts");
    await file(root, "src/client/api/index.ts");
    const result = await checkProductSurfacesPreservation(root, base);
    for (const path of ["src/server/module.ts", "src/client/api/index.ts"])
      expect(result.findings).toContainEqual({ path, code: "outside_product_surfaces_scope" });
  });

  test("an assertion weakened in the index cannot hide behind approved working selectors", async () => {
    const { root, base } = await repository();
    const path = "tests/browser/workspace.e2e.ts";
    const next = migrateProductSurfacesSelectors(path, browserSource);
    await file(root, path, next.replace("toBe(1)", "toBe(0)"));
    await git(root, "add", path);
    await file(root, path, next);
    expect((await checkProductSurfacesPreservation(root, base)).findings).toContainEqual({
      path,
      code: "unapproved_surfaces_integration_patch",
    });
  });

  test("symlinks, removed/renamed landing files and undeclared additions fail closed", async () => {
    const { root, base } = await repository();
    await file(root, "src/product-ui/legacy-case/Unreviewed.tsx", "synthetic\n");
    await symlink(
      "../../server/module.ts",
      join(root, "src/product-ui/legacy-case/CaseDetailView.tsx"),
    );
    await git(root, "mv", "src/pages/index.astro", "src/product-ui/legacy-case/ResultView.tsx");
    const result = await checkProductSurfacesPreservation(root, base);
    expect(result.findings).toContainEqual({
      path: "src/product-ui/legacy-case/CaseDetailView.tsx",
      code: "surfaces_phase_regular_file_required",
    });
    expect(result.findings).toContainEqual({
      path: "src/pages/index.astro",
      code: "surfaces_phase_removal_or_type_change",
    });
    expect(result.findings).toContainEqual({
      path: "src/product-ui/legacy-case/Unreviewed.tsx",
      code: "outside_product_surfaces_scope",
    });
  });
});
