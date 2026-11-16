import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  checkProductDetailsPreservation,
  migrateProductDetailsSelectors,
  productDetailsChangeFindings,
  productDetailsPackageAllowed,
  productDetailsSelectorsAllowed,
  productDetailsStyleImportAllowed,
} from "../scripts/check-product-details-preservation";

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
  name: "synthetic-details-phase",
  dependencies: { react: "19.3.0" },
  devDependencies: { "@tailwindcss/node": "4.3.3" },
  overrides: { transitive: "1.0.0" },
  scripts: {
    "product-ui:check": "bun scripts/check-product-workspace-preservation.ts",
    "product-workspace:check": "bun scripts/check-product-workspace-preservation.ts",
    test: "bun test",
  },
};
const phasePackage = {
  ...baselinePackage,
  scripts: {
    ...baselinePackage.scripts,
    "product-ui:check": "bun scripts/check-product-details-preservation.ts",
    "product-details:check": "bun scripts/check-product-details-preservation.ts",
  },
};
const styleSource =
  'import "../../../styles/reports.css";\nconst id = authorize(Astro.params.caseId);\n<ReportReview caseId={id} rework client:load />\n';
const reportTest =
  'const root = page.locator(".report-review");\nawait expect(root).toHaveAttribute("aria-busy", "false");\nexpect(downloads).toHaveLength(1);\n';
async function repository() {
  const root = await mkdtemp(join(tmpdir(), "baro-product-details-"));
  roots.push(root);
  await git(root, "init", "-q");
  for (const path of [
    "src/components/workspace/FileReview.tsx",
    "src/server/module.ts",
    "src/client/api/index.ts",
    "src/pages/index.astro",
    "src/styles/global.css",
    "src/components/reports/download.ts",
    "apps/mobile/src/App.tsx",
    "packages/api-client/src/index.ts",
    "bun.lock",
  ])
    await file(root, path);
  await file(root, "package.json", JSON.stringify(baselinePackage));
  await file(root, "src/pages/cases/[caseId]/reports.astro", styleSource);
  await file(root, "tests/browser/reports.e2e.ts", reportTest);
  await git(root, "add", ".");
  await commit(root);
  return { root, base: await git(root, "rev-parse", "HEAD") };
}

describe("details phase scope and exact integration patches", () => {
  test("protects landing/backend/mobile/contracts, shared CSS, document rendering and prior gates", () => {
    const paths = [
      "src/pages/index.astro",
      "src/layouts/BaseLayout.astro",
      "src/client/landing.ts",
      "src/client/api/files.ts",
      "src/server/modules/files/review.ts",
      "src/contracts/v2/files.ts",
      "src/worker.ts",
      "src/workflows/files.ts",
      "drizzle/schema.ts",
      "apps/mobile/src/App.tsx",
      "packages/api-client/src/files.ts",
      "public/landing/hero-continuous.mp4",
      "public/fonts/PretendardVariable.woff2",
      "src/styles/global.css",
      "src/styles/evidence.css",
      "src/styles/reports.css",
      "src/components/reports/document.ts",
      "src/components/reports/download.ts",
      "src/components/reports/review-sections.ts",
      "src/utils/report-markdown.ts",
      "src/utils/sanitize.ts",
      "bun.lock",
      "astro.config.ts",
      "scripts/validate.ts",
      "scripts/check-product-workspace-preservation.ts",
      "tests/product-ui-workspace-preservation.test.ts",
      "tests/helpers/report-official-source-entry.tsx",
      "tests/browser/report-rework-layout.e2e.ts",
      ".github/workflows/ci.yml",
    ];
    expect(
      productDetailsChangeFindings(
        paths.map((path) => ({ path, status: "M", existedAtBase: true })),
      ).map(({ path }) => path),
    ).toEqual(paths);
    expect(
      productDetailsChangeFindings([
        { path: "src/product-ui/reports/Unreviewed.tsx", status: "A", existedAtBase: false },
        { path: "src/product-ui/materials/../server/file.ts", status: "A", existedAtBase: false },
        { path: "src/components/workspace/FileReview.tsx", status: "D", existedAtBase: true },
      ]),
    ).toHaveLength(3);
  });

  test("accepts named visual facades, explicit new source/tests and only named fixture tooling", () => {
    const existing = [
      "src/components/workspace/FileReview.tsx",
      "src/components/reports/ReportReview.tsx",
      "src/product-ui/Dialog.tsx",
      "src/product-ui/utils.ts",
      "tests/helpers/evidence-ui-server.ts",
      "tests/helpers/report-official-source-server.ts",
    ];
    const added = [
      "src/product-ui/materials/FileReviewView.tsx",
      "src/product-ui/summary/ContextReviewView.tsx",
      "src/product-ui/reports/ReportReading.tsx",
      "src/product-ui/reports/report-status.ts",
      "src/product-ui/Select.tsx",
      "src/product-ui/Disclosure.tsx",
      "tests/product-ui-materials.test.tsx",
      "tests/product-ui-detail-primitives.test.tsx",
      "tests/product-ui-report-review.test.tsx",
      "scripts/check-product-details-preservation.ts",
      "tests/product-ui-details-preservation.test.ts",
      "docs/quality/details/synthetic.png",
    ];
    expect(
      productDetailsChangeFindings([
        ...existing.map((path) => ({ path, status: "M", existedAtBase: true })),
        ...added.map((path) => ({ path, status: "A", existedAtBase: false })),
      ]),
    ).toEqual([]);
  });

  test("package changes only the two current aliases, retaining dependencies, overrides and prior commands", () => {
    expect(productDetailsPackageAllowed(baselinePackage, phasePackage)).toBe(true);
    for (const candidate of [
      { ...phasePackage, dependencies: { react: "changed" } },
      { ...phasePackage, devDependencies: { "@tailwindcss/node": "changed" } },
      { ...phasePackage, overrides: { transitive: "changed" } },
      { ...phasePackage, scripts: { ...phasePackage.scripts, test: "true" } },
      { ...phasePackage, scripts: { ...phasePackage.scripts, "product-workspace:check": "true" } },
      { ...phasePackage, scripts: { ...phasePackage.scripts, "product-details:check": "true" } },
    ])
      expect(productDetailsPackageAllowed(baselinePackage, candidate)).toBe(false);
  });

  test("the CSS import move preserves every route authorization/template byte", () => {
    const path = "src/pages/cases/[caseId]/reports.astro";
    const candidate = styleSource.replace('import "../../../styles/reports.css";\n', "");
    expect(productDetailsStyleImportAllowed(path, styleSource, candidate)).toBe(true);
    expect(
      productDetailsStyleImportAllowed(
        path,
        styleSource,
        candidate.replace("authorize", "skipAccess"),
      ),
    ).toBe(false);
    expect(
      productDetailsStyleImportAllowed(
        path,
        styleSource,
        candidate.replace("rework client:load", "client:load"),
      ),
    ).toBe(false);
    expect(productDetailsStyleImportAllowed("src/pages/index.astro", styleSource, candidate)).toBe(
      false,
    );
  });

  test("report selectors preserve document/photo/source classes and every PDF geometry/API assertion", async () => {
    const path = "tests/browser/reports.e2e.ts";
    const source =
      'page.locator(".report-export .primary");\npage.locator(".report-modal");\npage.locator(".report-reading .report-markdown .report-inline-photo .report-official-source");\nexpect(width).toBeGreaterThanOrEqual(170);\nexpect(downloads).toHaveLength(1);\n';
    const expected =
      'page.locator("[data-product-report-export] [data-product-report-primary]");\npage.locator(".report-modal");\npage.locator(".report-reading .report-markdown .report-inline-photo .report-official-source");\nexpect(width).toBeGreaterThanOrEqual(170);\nexpect(downloads).toHaveLength(1);\n';
    expect(migrateProductDetailsSelectors(path, source)).toBe(expected);
    expect(await productDetailsSelectorsAllowed(path, source, expected)).toBe(true);
    expect(
      await productDetailsSelectorsAllowed(
        path,
        source,
        expected.replace("OrEqual(170)", "OrEqual(0)"),
      ),
    ).toBe(false);
    expect(
      await productDetailsSelectorsAllowed(
        path,
        source,
        expected.replace("toHaveLength(1)", "toHaveLength(0)"),
      ),
    ).toBe(false);
    expect(
      migrateProductDetailsSelectors("tests/browser/report-rework-layout.e2e.ts", source),
    ).toBe(source);
    expect(
      migrateProductDetailsSelectors("tests/browser/report-official-source-links.e2e.ts", source),
    ).toBe(source);
  });

  test("material and summary selectors retain owner, content, native field and call-count assertions", async () => {
    const source =
      'page.locator(".workspace-file-list > li");\npage.locator(".evidence-file-review textarea");\nexpect(calls).toBe(0);\n';
    const path = "tests/browser/evidence-capture.e2e.ts";
    const expected =
      'page.locator("[data-product-material-list] > li");\npage.locator("[data-product-file-review] textarea");\nexpect(calls).toBe(0);\n';
    expect(migrateProductDetailsSelectors(path, source)).toBe(expected);
    expect(
      await productDetailsSelectorsAllowed(path, source, expected.replace("toBe(0)", "toBe(1)")),
    ).toBe(false);
    expect(
      migrateProductDetailsSelectors(
        "tests/browser/intake103.e2e.ts",
        'page.locator(".summary-reading-overview");',
      ),
    ).toContain("[data-product-summary-overview]");
  });

  test("checks committed visual changes and untracked new views", async () => {
    const { root, base } = await repository();
    expect((await checkProductDetailsPreservation(root, base)).findings).toEqual([]);
    await file(root, "src/components/workspace/FileReview.tsx", "synthetic visual facade\n");
    await file(root, "package.json", JSON.stringify(phasePackage));
    await git(root, "add", ".");
    await commit(root);
    await file(
      root,
      "src/product-ui/materials/FileReviewView.tsx",
      "export const synthetic = true;\n",
    );
    expect((await checkProductDetailsPreservation(root, base)).findings).toEqual([]);
  });

  test("protected commits and staged API changes remain visible after local restoration", async () => {
    const { root, base } = await repository();
    await file(root, "src/server/module.ts", "synthetic protected change\n");
    await git(root, "add", ".");
    await commit(root);
    await file(root, "src/server/module.ts");
    await file(root, "src/client/api/index.ts", "synthetic protected change\n");
    await git(root, "add", "src/client/api/index.ts");
    await file(root, "src/client/api/index.ts");
    const result = await checkProductDetailsPreservation(root, base);
    for (const path of ["src/server/module.ts", "src/client/api/index.ts"])
      expect(result.findings).toContainEqual({ path, code: "outside_product_details_scope" });
  });

  test("new allowed views must be regular files and renames cannot conceal landing deletion", async () => {
    const { root, base } = await repository();
    await mkdir(join(root, "src/product-ui/materials"), { recursive: true });
    await git(root, "mv", "src/pages/index.astro", "src/product-ui/materials/FileReviewView.tsx");
    await symlink(
      "../../server/module.ts",
      join(root, "src/product-ui/materials/CaseContextView.tsx"),
    );
    const result = await checkProductDetailsPreservation(root, base);
    expect(result.findings).toContainEqual({
      path: "src/pages/index.astro",
      code: "details_phase_removal_or_type_change",
    });
    expect(result.findings).toContainEqual({
      path: "src/product-ui/materials/CaseContextView.tsx",
      code: "details_phase_regular_file_required",
    });
  });

  test("staged selector assertions and route access cannot hide behind allowed working patches", async () => {
    const { root, base } = await repository();
    const path = "tests/browser/reports.e2e.ts";
    const candidate = migrateProductDetailsSelectors(path, reportTest);
    await file(root, path, candidate.replace("toHaveLength(1)", "toHaveLength(0)"));
    const style = "src/pages/cases/[caseId]/reports.astro";
    const moved = styleSource.replace('import "../../../styles/reports.css";\n', "");
    await file(root, style, moved.replace("authorize", "skipAccess"));
    await git(root, "add", ".");
    await file(root, path, candidate);
    await file(root, style, moved);
    const result = await checkProductDetailsPreservation(root, base);
    for (const value of [path, style])
      expect(result.findings).toContainEqual({
        path: value,
        code: "unapproved_details_integration_patch",
      });
  });
});
