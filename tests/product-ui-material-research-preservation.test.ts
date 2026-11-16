import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  checkProductMaterialsPreservation,
  migrateProductMaterialsIntegration,
  migrateProductMaterialsSelectors,
  productMaterialsChangeFindings,
  productMaterialsIntegrationAllowed,
  productMaterialsPackageAllowed,
  productMaterialsSelectorsAllowed,
} from "../scripts/check-product-materials-preservation";

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
async function submittedPrecedentTest() {
  let source = await readFile(new URL("./browser/precedents.e2e.ts", import.meta.url), "utf8");
  const selectors = [
    [
      `    page
      .getByRole("button", { name: "공식 원문 확인 중…", exact: true })
      .locator("[data-product-research-spinner]"),`,
      '    page.getByRole("button", { name: "공식 원문 확인 중…", exact: true }).locator(".ui-spinner"),',
    ],
    [
      '  const reason = page.getByRole("dialog", { name: "비교 근거와 이유" }).locator("[data-dialog]");',
      '  const reason = page.getByRole("dialog", { name: "비교 근거와 이유" });',
    ],
  ] as const;
  for (const [before, after] of selectors) {
    if (source.split(before).length !== 2) throw new Error("EXACT_REVIEWED_SELECTOR_REQUIRED");
    source = source.replace(before, after);
  }
  if (
    createHash("sha256").update(source).digest("hex") !==
    "69d756d72a26bdda266643cb0aa04f607f1196996deb91bf88614b5cdf0e5e3a"
  )
    throw new Error("VERIFIED_SUBMITTED_TEST_REQUIRED");
  return source;
}
const baselinePackage = {
  name: "synthetic-material-research-phase",
  dependencies: { react: "19.3.0" },
  devDependencies: { "@tailwindcss/node": "4.3.3" },
  overrides: { transitive: "1.0.0" },
  scripts: {
    "product-ui:check": "bun scripts/check-product-tools-preservation.ts",
    "product-shell:check": "bun scripts/check-product-shell-preservation.ts",
    "product-workspace:check": "bun scripts/check-product-workspace-preservation.ts",
    "product-details:check": "bun scripts/check-product-details-preservation.ts",
    "product-landing:check": "bun scripts/check-product-landing-preservation.ts",
    "product-tools:check": "bun scripts/check-product-tools-preservation.ts",
    test: "bun test",
  },
};
const phasePackage = {
  ...baselinePackage,
  scripts: {
    ...baselinePackage.scripts,
    "product-ui:check": "bun scripts/check-product-materials-preservation.ts",
    "product-materials:check": "bun scripts/check-product-materials-preservation.ts",
  },
};
const browserSource =
  'const next = { ...precedentState };\nconst payload = { message: ".precedent-card" };\npage.locator(".precedent-card .precedent-snippet");\npage.locator(".precedent-state-card,.comparison-result");\nexpect(calls).toBe(0);\nexpect(rgb).toBe("rgb(1, 2, 3)");\nexpect(height).toBeLessThan(240);\n';
const integrationFixtures = {
  "src/product-ui/product.css": {
    before:
      '@layer legacy, utilities;\n@import "../styles/settings.css" layer(legacy);\n@import "../styles/case-workbench.css" layer(legacy);\n@import "./tokens.css";\n',
    after:
      '@layer legacy, utilities;\n@import "../styles/settings.css" layer(legacy);\n@import "../styles/precedents.css" layer(legacy);\n@import "../styles/case-workbench.css" layer(legacy);\n@import "./tokens.css";\n',
  },
  "src/pages/cases/[caseId]/precedents.astro": {
    before:
      '---\nimport "../../../styles/precedents.css";\nconst identity = opaqueIdSchema.safeParse(Astro.params.caseId);\nif (!identity.success) return Astro.redirect("/cases");\n---\n<CaseLayout />\n',
    after:
      '---\nconst identity = opaqueIdSchema.safeParse(Astro.params.caseId);\nif (!identity.success) return Astro.redirect("/cases");\n---\n<CaseLayout />\n',
  },
  "tests/helpers/workspace.astro.config.ts": {
    before:
      'if (source === "../../client/api" && importer?.endsWith("/components/workspace/LookupDialog.tsx")) return fixtureURL;\nreturn null;\n',
    after:
      'if (source === "../../client/api" && importer?.endsWith("/product-ui/research/useLookupController.ts")) return fixtureURL;\nreturn null;\n',
  },
  "tests/product-ui-fixture-resolvers.test.ts": {
    before:
      'const positive = [\n      "components/workspace/LookupDialog.tsx",\n];\nconst negative = [\n      "components/workspace/FileReview.tsx",\n      "product-ui/materials/FileReviewView.tsx",\n];\nexpect(resolve(source)).toBeNull();\n',
    after:
      'const positive = [\n      "product-ui/research/useLookupController.ts",\n];\nconst negative = [\n      "components/workspace/FileReview.tsx",\n      "components/workspace/LookupDialog.tsx",\n      "product-ui/research/LookupView.tsx",\n      "product-ui/materials/FileReviewView.tsx",\n];\nexpect(resolve(source)).toBeNull();\n',
  },
};
async function repository() {
  const root = await mkdtemp(join(tmpdir(), "baro-product-material-research-"));
  roots.push(root);
  await git(root, "init", "-q");
  for (const path of [
    "src/components/workspace/PrecedentResearch.tsx",
    "src/components/workspace/EvidenceUpload.tsx",
    "src/client/api/index.ts",
    "src/server/module.ts",
    "src/pages/index.astro",
    "src/styles/global.css",
    "src/utils/precedent-document.ts",
    "bun.lock",
  ])
    await file(root, path);
  await file(root, "package.json", JSON.stringify(baselinePackage));
  await file(root, "tests/browser/precedents.e2e.ts", browserSource);
  for (const [path, fixture] of Object.entries(integrationFixtures))
    await file(root, path, fixture.before);
  await git(root, "add", ".");
  await commit(root);
  return { root, base: await git(root, "rev-parse", "HEAD") };
}

describe("material/research named scope and aliases", () => {
  test("protects API/storage/contracts/business helpers, unrelated views, existing gates, media/timeline and landing", () => {
    for (const path of [
      "src/client/api/precedents.ts",
      "src/server/modules/files/review.ts",
      "src/contracts/v2/precedent-comparison.ts",
      "src/worker.ts",
      "src/workflows/files.ts",
      "drizzle/schema.ts",
      "packages/api-client/src/precedents.ts",
      "apps/mobile/src/App.tsx",
      "src/utils/precedent-document.ts",
      "src/client/precedent-highlights.ts",
      "src/components/workspace/source-label.ts",
      "src/components/workspace/useEvidenceUpload.ts",
      "src/components/workspace/Workspace.tsx",
      "src/components/ui/media-player.tsx",
      "src/components/workspace/TimelineEvidence.tsx",
      "src/components/workspace/timeline-draft.ts",
      "src/product-ui/materials/FileReviewView.tsx",
      "src/product-ui/conversation-tools/AgentView.tsx",
      "src/product-ui/Button.tsx",
      "src/product-ui/Dialog.tsx",
      "src/product-ui/Select.tsx",
      "src/product-ui/Disclosure.tsx",
      "src/product-ui/landing/LandingPage.astro",
      "src/layouts/LandingLayout.astro",
      "src/pages/index.astro",
      "public/landing/hero-continuous.mp4",
      "public/brand/logo.svg",
      "src/styles/global.css",
      "src/styles/precedents.css",
      "src/styles/evidence.css",
      "astro.config.ts",
      "scripts/validate.ts",
      "scripts/check-product-tools-preservation.ts",
      "tests/product-ui-tools-preservation.test.ts",
      "tests/helpers/evidence-ui-server.ts",
      "tests/helpers/workspace-client-fixture.ts",
      "bun.lock",
    ])
      expect(
        productMaterialsChangeFindings([{ path, status: "M", existedAtBase: true }]),
      ).toContainEqual({ path, code: "outside_product_materials_scope" });
  });

  test("accepts exactly the named facades, new views/controllers and focused tests", () => {
    const existing = [
      "CaseMaterials",
      "ChatAttachments",
      "EvidencePicker",
      "EvidenceRequirements",
      "EvidenceUpload",
      "PrecedentResearch",
      "PrecedentDocument",
      "PrecedentComparisonPanel",
      "ComparisonResult",
      "LookupDialog",
    ].map((name) => `src/components/workspace/${name}.tsx`);
    const added = [
      "src/product-ui/research/ResearchView.tsx",
      "src/product-ui/research/useLookupController.ts",
      "src/product-ui/research/presentation.ts",
      "src/product-ui/evidence/AttachmentPreview.tsx",
      "src/product-ui/evidence/useEvidenceUploadController.ts",
      "tests/product-ui-evidence.test.tsx",
      "tests/product-ui-research.test.tsx",
      "scripts/check-product-materials-preservation.ts",
      "tests/product-ui-material-research-preservation.test.ts",
      "docs/quality/material-research/synthetic.png",
    ];
    expect(
      productMaterialsChangeFindings([
        ...existing.map((path) => ({ path, status: "M", existedAtBase: true })),
        ...added.map((path) => ({ path, status: "A", existedAtBase: false })),
      ]),
    ).toEqual([]);
    for (const path of [
      "src/product-ui/research/NewAPI.ts",
      "src/product-ui/evidence/Unreviewed.tsx",
      "tests/product-ui-material-research-preservation.test.tsx",
    ])
      expect(
        productMaterialsChangeFindings([{ path, status: "A", existedAtBase: false }]),
      ).not.toEqual([]);
    expect(
      productMaterialsChangeFindings([
        { path: "src/product-ui/research/ResearchView.tsx", status: "M", existedAtBase: true },
      ]),
    ).not.toEqual([]);
  });

  test("rejects invalid paths, deletions, renames and type changes", () => {
    for (const path of [
      "",
      "/tmp/allowed.ts",
      "src/../secret.ts",
      "src\\secret.ts",
      "src//secret.ts",
      "src/\nsecret.ts",
    ])
      expect(
        productMaterialsChangeFindings([{ path, status: "M", existedAtBase: true }]),
      ).toContainEqual({ path, code: "invalid_repository_path" });
    for (const status of ["D", "T", "R100"])
      expect(
        productMaterialsChangeFindings([
          { path: "src/components/workspace/PrecedentResearch.tsx", status, existedAtBase: true },
        ]),
      ).toContainEqual({
        path: "src/components/workspace/PrecedentResearch.tsx",
        code: "materials_phase_removal_or_type_change",
      });
  });

  test("the exact two aliases retain every prior script, dependency, override and command", () => {
    expect(productMaterialsPackageAllowed(baselinePackage, baselinePackage)).toBe(true);
    expect(productMaterialsPackageAllowed(baselinePackage, phasePackage)).toBe(true);
    for (const candidate of [
      { ...phasePackage, dependencies: {} },
      { ...phasePackage, devDependencies: {} },
      { ...phasePackage, overrides: {} },
      ...Object.keys(baselinePackage.scripts)
        .filter((key) => key !== "product-ui:check")
        .map((key) => ({ ...phasePackage, scripts: { ...phasePackage.scripts, [key]: "true" } })),
      { ...phasePackage, scripts: { ...phasePackage.scripts, "product-materials:check": "true" } },
      { ...phasePackage, scripts: { ...phasePackage.scripts, extra: "true" } },
    ])
      expect(productMaterialsPackageAllowed(baselinePackage, candidate)).toBe(false);
    for (const value of [null, [], true, { scripts: [] }])
      expect(productMaterialsPackageAllowed(value, phasePackage)).toBe(false);
    expect(
      productMaterialsPackageAllowed(
        {
          ...baselinePackage,
          scripts: {
            ...baselinePackage.scripts,
            "product-ui:check": "bun scripts/check-product-landing-preservation.ts",
          },
        },
        phasePackage,
      ),
    ).toBe(false);
  });
});

describe("reviewed route, stylesheet and resolver integrations", () => {
  test("accepts only the four exact reviewed integrations while keeping every surrounding byte", () => {
    for (const [path, { before, after }] of Object.entries(integrationFixtures)) {
      expect(productMaterialsChangeFindings([{ path, status: "M", existedAtBase: true }])).toEqual(
        [],
      );
      expect(migrateProductMaterialsIntegration(path, before)).toBe(after);
      expect(productMaterialsIntegrationAllowed(path, before, before)).toBe(true);
      expect(productMaterialsIntegrationAllowed(path, before, after)).toBe(true);
      expect(productMaterialsIntegrationAllowed(path, before, `${after}// weakened\n`)).toBe(false);
      expect(migrateProductMaterialsIntegration(path, `${before}${before}`)).toBeNull();
      expect(migrateProductMaterialsIntegration(path, "unrecognized baseline\n")).toBeNull();
    }
    expect(migrateProductMaterialsIntegration("astro.config.ts", "unchanged\n")).toBeNull();
    expect(productMaterialsIntegrationAllowed("astro.config.ts", "same", "same")).toBe(false);
  });

  test("rejects routing, CSS cascade, resolver scope/URL and assertion changes alongside approved patches", () => {
    const mutations = [
      ["src/product-ui/product.css", (text: string) => text.replace("layer(legacy)", "")],
      [
        "src/pages/cases/[caseId]/precedents.astro",
        (text: string) => text.replace("!identity.success", "false"),
      ],
      [
        "tests/helpers/workspace.astro.config.ts",
        (text: string) => text.replace('source === "../../client/api" && ', ""),
      ],
      [
        "tests/helpers/workspace.astro.config.ts",
        (text: string) => text.replace("fixtureURL", "otherURL"),
      ],
      [
        "tests/product-ui-fixture-resolvers.test.ts",
        (text: string) => text.replace("toBeNull()", "toBeDefined()"),
      ],
    ] as const;
    for (const [path, mutate] of mutations) {
      const { before, after } = integrationFixtures[path];
      expect(productMaterialsIntegrationAllowed(path, before, mutate(after))).toBe(false);
    }
  });
});

describe("research consumers preserve document, zero-state and nonselector bytes", () => {
  test("comparison geometry retains its exact role/name and assertions while targeting the actual dialog panel", async () => {
    const path = "tests/browser/precedents.e2e.ts";
    const before =
      '  const reason = page.getByRole("dialog", { name: "비교 근거와 이유" });\nexpect(bounds.y + bounds.height).toBeLessThanOrEqual(901);';
    const after = before.replace(
      'name: "비교 근거와 이유" });',
      'name: "비교 근거와 이유" }).locator("[data-dialog]");',
    );
    expect(migrateProductMaterialsSelectors(path, before)).toBe(after);
    expect(await productMaterialsSelectorsAllowed(path, before, after)).toBe(true);
    expect(await productMaterialsSelectorsAllowed(path, before, after.replace("901", "1001"))).toBe(
      false,
    );
    expect(migrateProductMaterialsSelectors("tests/browser/product-ui.e2e.ts", before)).toBe(
      before,
    );
  });

  test("migrates only the real research spinner selector and preserves its busy action and count", async () => {
    const source =
      'const payload = ".ui-spinner";\nawait expect(page.getByRole("button", { name: "공식 원문 확인 중…", exact: true }).locator(".ui-spinner")).toHaveCount(1);';
    const expected = source.replace(
      'locator(".ui-spinner")',
      'locator("[data-product-research-spinner]")',
    );
    const path = "tests/browser/precedents.e2e.ts";
    expect(migrateProductMaterialsSelectors(path, source)).toBe(expected);
    expect(await productMaterialsSelectorsAllowed(path, source, expected)).toBe(true);
    expect(
      await productMaterialsSelectorsAllowed(
        path,
        source,
        expected.replace("toHaveCount(1)", "toHaveCount(0)"),
      ),
    ).toBe(false);
    expect(migrateProductMaterialsSelectors("tests/browser/product-ui.e2e.ts", source)).toBe(
      source,
    );
  });

  test("changes only CSS selector literal arguments, leaving spread/API/RGB/geometry/call-count assertions untouched", async () => {
    const path = "tests/browser/precedents.e2e.ts";
    const expected = browserSource
      .replace(
        'page.locator(".precedent-card .precedent-snippet")',
        'page.locator("[data-product-precedent-card] .precedent-snippet")',
      )
      .replace(
        'page.locator(".precedent-state-card,.comparison-result")',
        'page.locator("[data-product-precedent-state],[data-product-comparison-result]")',
      );
    expect(migrateProductMaterialsSelectors(path, browserSource)).toBe(expected);
    expect(await productMaterialsSelectorsAllowed(path, browserSource, expected)).toBe(true);
    for (const candidate of [
      expected.replace("toBe(0)", "toBe(1)"),
      expected.replace("rgb(1, 2, 3)", "rgb(0, 0, 0)"),
      expected.replace("Than(240)", "Than(9999)"),
      expected.replace("...precedentState", "...otherState"),
    ])
      expect(await productMaterialsSelectorsAllowed(path, browserSource, candidate)).toBe(false);
  });

  test("keeps the original reading-body hook and obsolete child-zero checks while migrating their parent scope", () => {
    const source =
      'page.locator(".precedent-result-heading > p,.precedent-result-heading > div,.precedent-result-note");\nregion.locator(".precedent-body");\nexpect(page.locator(".workspace-file-preview")).toHaveCount(0);\n';
    const next = migrateProductMaterialsSelectors("tests/browser/precedents.e2e.ts", source);
    expect(next).toContain(
      "[data-product-precedent-results-heading] > p,[data-product-precedent-results-heading] > div,.precedent-result-note",
    );
    expect(next).toContain('region.locator(".precedent-body")');
    expect(next).toContain('expect(page.locator(".workspace-file-preview")).toHaveCount(0)');
  });

  test("maps only actual consumers and keeps scope/focus/source IDs, URLs and screenshot names", () => {
    const source =
      'page.locator("[data-product-case-context] .precedent-full-text");\nconst sourceId = ".precedent-full-text";\nawait page.screenshot({path:".precedent-full-text.png"});\n';
    const expected = source.replace(
      'page.locator("[data-product-case-context] .precedent-full-text")',
      'page.locator("[data-product-case-context] [data-product-precedent-document]")',
    );
    expect(migrateProductMaterialsSelectors("tests/browser/case-workbench.e2e.ts", source)).toBe(
      expected,
    );
    expect(
      migrateProductMaterialsSelectors(
        "tests/browser/product-ui.e2e.ts",
        'page.locator(".precedent-search [data-disclosure] > [data-disclosure-button]");',
      ),
    ).toBe(
      'page.locator("[data-product-precedent-search] [data-disclosure] > [data-disclosure-button]");',
    );
    expect(
      migrateProductMaterialsSelectors("tests/browser/workspace-materials.e2e.ts", source),
    ).toBe(source);
    expect(
      migrateProductMaterialsSelectors(
        "tests/browser/precedents.e2e.ts",
        'document.querySelector(".conversation-panel");\npage.locator(".workspace-message-attachments");',
      ),
    ).toBe(
      'document.querySelector(".conversation-panel");\npage.locator(".workspace-message-attachments");',
    );
  });
});

describe("material/research git-state preservation", () => {
  test("only the exact prior submitted file may remain in HEAD/index; old working selectors and unknown staged bytes fail", async () => {
    const { root, base } = await repository();
    const path = "tests/browser/precedents.e2e.ts";
    const submitted = await submittedPrecedentTest();
    const working = migrateProductMaterialsSelectors(path, browserSource);
    await file(root, path, submitted);
    await git(root, "add", path);
    await commit(root);
    await file(root, path, working);
    expect((await checkProductMaterialsPreservation(root, base)).findings).toEqual([]);
    await file(root, path, browserSource);
    expect((await checkProductMaterialsPreservation(root, base)).findings).toContainEqual({
      path,
      code: "unapproved_materials_integration_patch",
    });
    await file(root, path, submitted);
    expect((await checkProductMaterialsPreservation(root, base)).findings).toContainEqual({
      path,
      code: "unapproved_materials_integration_patch",
    });
    await file(root, path, `${submitted}// unreviewed staged assertion change\n`);
    await git(root, "add", path);
    await file(root, path, working);
    expect((await checkProductMaterialsPreservation(root, base)).findings).toContainEqual({
      path,
      code: "unapproved_materials_integration_patch",
    });
  });

  test("accepts reviewed integrations but catches an unsafe staged resolver and committed route hidden by approved working bytes", async () => {
    const { root, base } = await repository();
    for (const [path, fixture] of Object.entries(integrationFixtures))
      await file(root, path, fixture.after);
    expect((await checkProductMaterialsPreservation(root, base)).findings).toEqual([]);
    const route = "src/pages/cases/[caseId]/precedents.astro";
    const config = "tests/helpers/workspace.astro.config.ts";
    await file(root, route, integrationFixtures[route].after.replace("!identity.success", "false"));
    await git(root, "add", ".");
    await commit(root);
    await file(root, route, integrationFixtures[route].after);
    await file(
      root,
      config,
      integrationFixtures[config].after.replace("fixtureURL", "differentFixtureURL"),
    );
    await git(root, "add", config);
    await file(root, config, integrationFixtures[config].after);
    const result = await checkProductMaterialsPreservation(root, base);
    for (const path of [route, config])
      expect(result.findings).toContainEqual({
        path,
        code: "unapproved_materials_integration_patch",
      });
  });

  test("accepts committed named facade changes and new untracked declared views", async () => {
    const { root, base } = await repository();
    expect((await checkProductMaterialsPreservation(root, base)).findings).toEqual([]);
    await file(root, "src/components/workspace/PrecedentResearch.tsx", "synthetic facade\n");
    await file(root, "package.json", JSON.stringify(phasePackage));
    await git(root, "add", ".");
    await commit(root);
    await file(
      root,
      "src/product-ui/research/ResearchView.tsx",
      "export const synthetic = true;\n",
    );
    expect((await checkProductMaterialsPreservation(root, base)).findings).toEqual([]);
  });

  test("protected HEAD and index changes remain visible after a working-copy restoration", async () => {
    const { root, base } = await repository();
    await file(root, "src/server/module.ts", "synthetic protected change\n");
    await git(root, "add", ".");
    await commit(root);
    await file(root, "src/server/module.ts");
    await file(root, "src/client/api/index.ts", "synthetic protected change\n");
    await git(root, "add", "src/client/api/index.ts");
    await file(root, "src/client/api/index.ts");
    const result = await checkProductMaterialsPreservation(root, base);
    for (const path of ["src/server/module.ts", "src/client/api/index.ts"])
      expect(result.findings).toContainEqual({ path, code: "outside_product_materials_scope" });
  });

  test("staged selector assertion weakening cannot hide behind the approved working selector mapping", async () => {
    const { root, base } = await repository();
    const path = "tests/browser/precedents.e2e.ts";
    const migrated = migrateProductMaterialsSelectors(path, browserSource);
    await file(root, path, migrated.replace("toBe(0)", "toBe(1)"));
    await git(root, "add", path);
    await file(root, path, migrated);
    expect((await checkProductMaterialsPreservation(root, base)).findings).toContainEqual({
      path,
      code: "unapproved_materials_integration_patch",
    });
  });

  test("rejects undeclared views, symlinks and renamed landing deletion", async () => {
    const { root, base } = await repository();
    await file(root, "src/product-ui/research/unreviewed.ts", "synthetic\n");
    await mkdir(join(root, "src/product-ui/research"), { recursive: true });
    await git(root, "mv", "src/pages/index.astro", "src/product-ui/research/ResearchView.tsx");
    await symlink("../../server/module.ts", join(root, "src/product-ui/research/LookupView.tsx"));
    const result = await checkProductMaterialsPreservation(root, base);
    expect(result.findings).toContainEqual({
      path: "src/product-ui/research/unreviewed.ts",
      code: "outside_product_materials_scope",
    });
    expect(result.findings).toContainEqual({
      path: "src/pages/index.astro",
      code: "materials_phase_removal_or_type_change",
    });
    expect(result.findings).toContainEqual({
      path: "src/product-ui/research/LookupView.tsx",
      code: "materials_phase_regular_file_required",
    });
  });
});
