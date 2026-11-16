import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  collectProductShellChanges,
  type ProductShellChange,
  type ProductShellFinding,
} from "./check-product-shell-preservation";

/** Acceptance for material/summary/report UI migration. Runtime authorization,
 * revision, download and browser behavior remain independent required checks. */
export const PRODUCT_DETAILS_BASE = "8c642ea1dd157e83456314095251a8d58f9d4c38";
const command = "bun scripts/check-product-details-preservation.ts";
const existingFiles = new Set([
  "src/components/intake/FactAnswer.tsx",
  "src/components/intake/SummaryReading.tsx",
  "src/components/intake/SummaryReconfirmation.tsx",
  "src/components/reports/ReportReading.tsx",
  "src/components/reports/ReportReview.tsx",
  "src/components/workspace/CaseContextPanel.tsx",
  "src/components/workspace/ConversationContextReview.tsx",
  "src/components/workspace/FileReview.tsx",
  "src/components/workspace/MaterialsPanel.tsx",
  "src/product-ui/Dialog.tsx",
  "src/product-ui/utils.ts",
  "src/product-ui/product.css",
  "tests/helpers/reports-ui-server.ts",
  "tests/helpers/report-real-server.ts",
  "tests/helpers/report-rework-layout-server.ts",
  "tests/helpers/report-official-source-server.ts",
  "tests/helpers/evidence-ui-server.ts",
  "tests/helpers/product-shell-fixture.tsx",
]);
const newFiles = new Set([
  "src/product-ui/Select.tsx",
  "src/product-ui/Disclosure.tsx",
  "src/product-ui/materials/types.ts",
  "src/product-ui/materials/coverage.ts",
  "src/product-ui/materials/useFileReviewController.ts",
  "src/product-ui/materials/FileReviewView.tsx",
  "src/product-ui/materials/ReviewObservation.tsx",
  "src/product-ui/materials/MaterialsPanelView.tsx",
  "src/product-ui/materials/useCaseContextController.ts",
  "src/product-ui/materials/CaseContextView.tsx",
  "src/product-ui/summary/SummaryDisclosure.tsx",
  "src/product-ui/summary/SummaryProblem.tsx",
  "src/product-ui/summary/SummaryReading.tsx",
  "src/product-ui/summary/SummaryContext.tsx",
  "src/product-ui/summary/useSummaryReconfirmationController.ts",
  "src/product-ui/summary/SummaryMaterials.tsx",
  "src/product-ui/summary/SummaryReconfirmationView.tsx",
  "src/product-ui/summary/FactAnswer.tsx",
  "src/product-ui/summary/completion.ts",
  "src/product-ui/summary/useContextReviewController.ts",
  "src/product-ui/summary/ContextReviewView.tsx",
  "src/product-ui/reports/ReportComponents.tsx",
  "src/product-ui/reports/ReportReviewView.tsx",
  "src/product-ui/reports/ReportReading.tsx",
  "src/product-ui/reports/SectionEditor.tsx",
  "src/product-ui/reports/report-status.ts",
  "src/product-ui/reports/useReportReviewController.ts",
  "tests/product-ui-materials.test.tsx",
  "tests/product-ui-summary.test.tsx",
  "tests/product-ui-report-reading.test.tsx",
  "tests/product-ui-detail-primitives.test.tsx",
  "tests/product-ui-report-review.test.tsx",
  "scripts/check-product-details-preservation.ts",
  "tests/product-ui-details-preservation.test.ts",
]);
const styleImports: Record<string, string> = {
  "src/components/workspace/CaseMaterials.tsx": 'import "../../styles/evidence.css";\n',
  "src/components/workspace/ChatAttachments.tsx": 'import "../../styles/evidence.css";\n',
  "src/components/workspace/ConversationReconfirmation.tsx": 'import "../../styles/intake.css";\n',
  "src/components/workspace/EvidencePicker.tsx": 'import "../../styles/evidence.css";\n',
  "src/components/workspace/EvidenceRequirements.tsx": 'import "../../styles/evidence.css";\n',
  "src/pages/cases/[caseId]/intake.astro": 'import "../../../styles/intake.css";\n',
  "src/pages/cases/[caseId]/reports.astro": 'import "../../../styles/reports.css";\n',
  "src/pages/cases/[caseId]/summary.astro": 'import "../../../styles/intake.css";\n',
  "src/pages/cases/new.astro": 'import "../../styles/intake.css";\n',
  "src/pages/new.astro": 'import "../styles/intake.css";\n',
  "src/pages/settings.astro": 'import "../styles/reports.css";\n',
};

export const productDetailsSelectorPaths = [
  "tests/browser/workspace-materials.e2e.ts",
  "tests/browser/workspace-drafts.e2e.ts",
  "tests/browser/human-review.e2e.ts",
  "tests/browser/evidence-capture.e2e.ts",
  "tests/browser/chat-attachments.e2e.ts",
  "tests/browser/headless-ui.e2e.ts",
  "tests/browser/customer-real.e2e.ts",
  "tests/browser/case-workbench.e2e.ts",
  "tests/browser/rework-conversation.e2e.ts",
  "tests/browser/workspace.e2e.ts",
  "tests/browser/rework-shared-mock.e2e.ts",
  "tests/browser/workspace-shared.e2e.ts",
  "tests/browser/reports-integrated.e2e.ts",
  "tests/browser/theme-palette.e2e.ts",
  "tests/browser/reports.e2e.ts",
  "tests/browser/report-mock-photos.e2e.ts",
  "tests/browser/report-retained-pdf.e2e.ts",
  "tests/browser/report-draft-revision.e2e.ts",
  "tests/browser/report-real-download.e2e.ts",
  "tests/browser/account-session-recovery.e2e.ts",
  "tests/browser/product-ui.e2e.ts",
  "tests/browser/report-inline.e2e.ts",
  "tests/browser/report-rework-state.e2e.ts",
  "tests/browser/intake103.e2e.ts",
  "tests/browser/intake-persistence.e2e.ts",
  "tests/helpers/report-controls.ts",
  "tests/helpers/workspace-navigation.ts",
] as const;
const selectorFiles = new Set<string>(productDetailsSelectorPaths);
const materialSelectors = [
  [".materials-panel__report", "[data-product-material-report]"],
  [".workspace-file-list", "[data-product-material-list]"],
  [".evidence-file-review", "[data-product-file-review]"],
  [".file-review-item", "[data-product-review-observation]"],
  [".case-context", "[data-product-case-context]"],
] as const;
const reportSelectors = [
  [".report-export .primary", "[data-product-report-export] [data-product-report-primary]"],
  [".report-basis-details", "[data-product-report-basis-details]"],
  [".report-save-state", "[data-product-report-save-state]"],
  [".report-edit-toggle", "[data-product-report-edit-toggle]"],
  [".report-read-content", "[data-product-report-read-content]"],
  [".report-preparation", "[data-product-report-preparation]"],
  [".report-progress", "[data-product-report-progress]"],
  [".report-controls", "[data-product-report-controls]"],
  [".report-heading", "[data-product-report-heading]"],
  [".report-canvas", "[data-product-report-canvas]"],
  [".report-export", "[data-product-report-export]"],
  [".report-error", "[data-product-report-error]"],
  [".report-workspace", "[data-product-report]"],
  [".report-review", "[data-product-report]"],
] as const;

/** These paths all render the migrated components. Reading-only harnesses keep
 * their own legacy wrappers and report document/photo/source class contracts. */
export function migrateProductDetailsSelectors(path: string, source: string) {
  if (!selectorFiles.has(path)) return source;
  let next = source;
  for (const [before, after] of [...materialSelectors, ...reportSelectors])
    next = next.replaceAll(before, after);
  if (
    ["tests/browser/intake103.e2e.ts", "tests/browser/intake-persistence.e2e.ts"].includes(path)
  ) {
    next = next.replaceAll(".summary-reading-overview", "[data-product-summary-overview]");
    next = next.replaceAll(".fact-answer__text", "[data-product-summary-fact-text]");
  }
  return next;
}
export async function productDetailsSelectorsAllowed(
  path: string,
  base: string,
  candidate: string,
) {
  if (candidate === base) return true;
  const expected = migrateProductDetailsSelectors(path, base);
  if (expected === base) return false;
  if (candidate === expected) return true;
  const formatter = fileURLToPath(
    new URL("../node_modules/@biomejs/biome/bin/biome", import.meta.url),
  );
  const child = Bun.spawn([process.execPath, formatter, "format", `--stdin-file-path=${path}`], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  child.stdin.write(expected);
  child.stdin.end();
  const [formatted] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return (await child.exited) === 0 && candidate === formatted;
}
export function productDetailsStyleImportAllowed(path: string, base: string, candidate: string) {
  const line = styleImports[path];
  return (
    Object.hasOwn(styleImports, path) &&
    line !== undefined &&
    (candidate === base || (base.split(line).length === 2 && candidate === base.replace(line, "")))
  );
}
export function productDetailsPackageAllowed(base: unknown, candidate: unknown) {
  if (isDeepStrictEqual(base, candidate)) return true;
  if (!base || !candidate || typeof base !== "object" || typeof candidate !== "object")
    return false;
  const prior = base as { scripts?: Record<string, unknown> };
  const next = structuredClone(candidate) as typeof prior;
  if (
    !prior.scripts ||
    !next.scripts ||
    Array.isArray(next.scripts) ||
    prior.scripts["product-ui:check"] !== "bun scripts/check-product-workspace-preservation.ts" ||
    Object.hasOwn(prior.scripts, "product-details:check") ||
    next.scripts["product-ui:check"] !== command ||
    next.scripts["product-details:check"] !== command
  )
    return false;
  next.scripts["product-ui:check"] = prior.scripts["product-ui:check"];
  delete next.scripts["product-details:check"];
  return isDeepStrictEqual(base, next);
}
export function productDetailsChangeFindings(
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
    if (!["A", "M"].includes(status))
      return [{ path, code: "details_phase_removal_or_type_change" }];
    const allowed =
      path.startsWith("docs/") ||
      path === "package.json" ||
      Object.hasOwn(styleImports, path) ||
      (existedAtBase ? existingFiles.has(path) || selectorFiles.has(path) : newFiles.has(path));
    return allowed ? [] : [{ path, code: "outside_product_details_scope" }];
  });
}
async function gitFile(root: string, revision: string) {
  const child = Bun.spawn(["git", "show", revision], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [output] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return (await child.exited) === 0 ? output : null;
}
export async function checkProductDetailsPreservation(root: string, base = PRODUCT_DETAILS_BASE) {
  const { sha, changes } = await collectProductShellChanges(root, base);
  const findings = productDetailsChangeFindings(changes);
  const paths = [...new Set(changes.map(({ path }) => path))];
  for (const path of paths) {
    const stat = await lstat(join(root, path)).catch(() => null);
    if (!stat?.isFile()) findings.push({ path, code: "details_phase_regular_file_required" });
  }
  for (const path of paths.filter(
    (value) =>
      value === "package.json" || selectorFiles.has(value) || Object.hasOwn(styleImports, value),
  )) {
    const before = await gitFile(root, `${sha}:${path}`);
    const candidates = await Promise.all([
      gitFile(root, `HEAD:${path}`),
      gitFile(root, `:${path}`),
      readFile(join(root, path), "utf8").catch(() => null),
    ]);
    const allowed =
      before !== null &&
      (
        await Promise.all(
          candidates.map(async (candidate) => {
            if (candidate === null) return false;
            try {
              if (path === "package.json")
                return productDetailsPackageAllowed(JSON.parse(before), JSON.parse(candidate));
              if (Object.hasOwn(styleImports, path))
                return productDetailsStyleImportAllowed(path, before, candidate);
              return productDetailsSelectorsAllowed(path, before, candidate);
            } catch {
              return false;
            }
          }),
        )
      ).every(Boolean);
    if (!allowed) findings.push({ path, code: "unapproved_details_integration_patch" });
  }
  return { changes: paths.length, findings };
}
if (import.meta.main) {
  if (process.argv.length > 3) throw new Error("PRODUCT_DETAILS_EXPECTS_ONE_BASE_REF");
  const result = await checkProductDetailsPreservation(
    process.cwd(),
    process.argv[2] ?? PRODUCT_DETAILS_BASE,
  );
  if (result.findings.length) {
    for (const finding of result.findings) console.error(`${finding.path}: ${finding.code}`);
    process.exitCode = 1;
  } else console.log(`Product details preservation passed (${result.changes} changed paths)`);
}
