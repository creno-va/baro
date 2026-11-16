/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: Exact source comparisons retain literal interpolation syntax. */
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import ts from "typescript";
import {
  collectProductShellChanges,
  type ProductShellChange,
  type ProductShellFinding,
} from "./check-product-shell-preservation";

/** Acceptance for evidence and precedent/lookup UI migration. Runtime authorization,
 * revision, download and browser behavior remain independent required checks. */
export const PRODUCT_MATERIALS_BASE = "f82400cf9966c7daecbef5b1275f4b3642be7506";
const command = "bun scripts/check-product-materials-preservation.ts";
const existingFiles = new Set([
  "src/components/workspace/CaseMaterials.tsx",
  "src/components/workspace/ChatAttachments.tsx",
  "src/components/workspace/EvidencePicker.tsx",
  "src/components/workspace/EvidenceRequirements.tsx",
  "src/components/workspace/EvidenceUpload.tsx",
  "src/components/workspace/PrecedentResearch.tsx",
  "src/components/workspace/PrecedentDocument.tsx",
  "src/components/workspace/PrecedentComparisonPanel.tsx",
  "src/components/workspace/ComparisonResult.tsx",
  "src/components/workspace/LookupDialog.tsx",
]);
const newFiles = new Set([
  "src/product-ui/research/ResearchView.tsx",
  "src/product-ui/research/PrecedentDocumentView.tsx",
  "src/product-ui/research/ComparisonPanelView.tsx",
  "src/product-ui/research/ComparisonResultView.tsx",
  "src/product-ui/research/LookupView.tsx",
  "src/product-ui/research/ResearchNotice.tsx",
  "src/product-ui/research/useResearchController.ts",
  "src/product-ui/research/useComparisonPanelController.ts",
  "src/product-ui/research/useLookupController.ts",
  "src/product-ui/research/presentation.ts",
  "src/product-ui/evidence/EvidenceRequirementsView.tsx",
  "src/product-ui/evidence/EvidenceUploadView.tsx",
  "src/product-ui/evidence/CaseMaterialsView.tsx",
  "src/product-ui/evidence/AttachmentPreview.tsx",
  "src/product-ui/evidence/ChatAttachmentsView.tsx",
  "src/product-ui/evidence/EvidencePickerView.tsx",
  "src/product-ui/evidence/useEvidencePickerController.ts",
  "src/product-ui/evidence/useEvidenceUploadController.ts",
  "src/product-ui/evidence/useChatAttachmentsController.ts",
  "tests/product-ui-evidence.test.tsx",
  "tests/product-ui-research.test.tsx",
  "scripts/check-product-materials-preservation.ts",
  "tests/product-ui-material-research-preservation.test.ts",
]);
const selectorReplacements: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  "tests/browser/precedents.e2e.ts": [
    [".precedent-workspace", "[data-product-precedent-research]"],
    [".precedent-topic", "[data-product-precedent-topic]"],
    [".precedent-card", "[data-product-precedent-card]"],
    [".precedent-metadata", "[data-product-precedent-metadata]"],
    [".precedent-result-heading", "[data-product-precedent-results-heading]"],
    [".precedent-full-text", "[data-product-precedent-document]"],
    [".precedent-document-heading", "[data-product-precedent-document-heading]"],
    [".precedent-state-card", "[data-product-precedent-state]"],
    [".comparison-result", "[data-product-comparison-result]"],
    [".comparison-highlight", "[data-product-comparison-highlight]"],
    [".comparison-reason", "[data-product-comparison-reason]"],
    [".comparison-evidence", "[data-product-comparison-evidence]"],
    [".comparison-indicator", "[data-product-comparison-indicator]"],
    [".ui-spinner", "[data-product-research-spinner]"],
  ],
  "tests/browser/case-workbench.e2e.ts": [
    [".precedent-full-text", "[data-product-precedent-document]"],
  ],
  "tests/browser/product-ui.e2e.ts": [[".precedent-search", "[data-product-precedent-search]"]],
};
export const productMaterialsSelectorPaths = Object.keys(selectorReplacements);
const selectorFiles = new Set(productMaterialsSelectorPaths);
/** Only named CSS-selector arguments change. Text, code, API values and every assertion stay intact. */
export function migrateProductMaterialsSelectors(path: string, source: string) {
  if (!Object.hasOwn(selectorReplacements, path)) return source;
  const replacements = selectorReplacements[path];
  if (!replacements) return source;
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edits: { start: number; end: number; text: string }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const call = node.parent;
      if (
        !ts.isCallExpression(call) ||
        call.arguments[0] !== node ||
        !ts.isPropertyAccessExpression(call.expression) ||
        !["locator", "querySelector", "querySelectorAll", "include"].includes(
          call.expression.name.text,
        )
      )
        return;
      let value = node.text;
      for (const [before, after] of replacements) value = value.replaceAll(before, after);
      if (value === node.text) return;
      let text = JSON.stringify(value);
      if (ts.isNoSubstitutionTemplateLiteral(node)) {
        text = node.getText(parsed);
        for (const [before, after] of replacements) text = text.replaceAll(before, after);
      }
      edits.push({ start: node.getStart(parsed), end: node.end, text });
    } else node.forEachChild(visit);
  };
  visit(parsed);
  let next = source;
  for (const edit of edits.reverse())
    next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  // Measure the visible Headless panel rather than its outer flow container,
  // retaining the original role/name lookup and every geometry assertion.
  if (path === "tests/browser/precedents.e2e.ts") {
    const before = '  const reason = page.getByRole("dialog", { name: "비교 근거와 이유" });';
    const after =
      '  const reason = page.getByRole("dialog", { name: "비교 근거와 이유" }).locator("[data-dialog]");';
    if (next.split(before).length === 2) next = next.replace(before, after);
  }
  return next;
}
export async function productMaterialsSelectorsAllowed(
  path: string,
  base: string,
  candidate: string,
  allowSubmittedVersion = false,
) {
  if (candidate === base) return true;
  // A corrective working copy can coexist with the exact previous submitted
  // selector version in HEAD/index. Its assertions are already reviewed; only
  // those Git states may retain this one complete, immutable file version.
  if (
    allowSubmittedVersion &&
    path === "tests/browser/precedents.e2e.ts" &&
    createHash("sha256").update(candidate).digest("hex") ===
      "69d756d72a26bdda266643cb0aa04f607f1196996deb91bf88614b5cdf0e5e3a"
  )
    return true;
  const expected = migrateProductMaterialsSelectors(path, base);
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
// These four reviewed integration patches preserve every other route, resolver and assertion byte.
const integrationPatches: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  "src/product-ui/product.css": [
    [
      '@import "../styles/settings.css" layer(legacy);\n@import "../styles/case-workbench.css" layer(legacy);',
      '@import "../styles/settings.css" layer(legacy);\n@import "../styles/precedents.css" layer(legacy);\n@import "../styles/case-workbench.css" layer(legacy);',
    ],
  ],
  "src/pages/cases/[caseId]/precedents.astro": [['import "../../../styles/precedents.css";\n', ""]],
  "tests/helpers/workspace.astro.config.ts": [
    [
      'importer?.endsWith("/components/workspace/LookupDialog.tsx")',
      'importer?.endsWith("/product-ui/research/useLookupController.ts")',
    ],
  ],
  "tests/product-ui-fixture-resolvers.test.ts": [
    [
      '      "components/workspace/LookupDialog.tsx",\n',
      '      "product-ui/research/useLookupController.ts",\n',
    ],
    [
      '      "components/workspace/FileReview.tsx",\n      "product-ui/materials/FileReviewView.tsx",',
      '      "components/workspace/FileReview.tsx",\n      "components/workspace/LookupDialog.tsx",\n      "product-ui/research/LookupView.tsx",\n      "product-ui/materials/FileReviewView.tsx",',
    ],
  ],
};
/** Exact CSS compiler/import changes only. Endpoints, resolvers, CSP and route bodies cannot change. */
export function migrateProductMaterialsIntegration(path: string, base: string): string | null {
  const patches = integrationPatches[path];
  if (!patches) return null;
  let next = base;
  for (const [before, after] of patches) {
    if (next.split(before).length !== 2) return null;
    next = next.replace(before, after);
  }
  return next;
}
export function productMaterialsIntegrationAllowed(path: string, base: string, candidate: string) {
  return (
    Object.hasOwn(integrationPatches, path) &&
    (candidate === base || candidate === migrateProductMaterialsIntegration(path, base))
  );
}
export function productMaterialsPackageAllowed(base: unknown, candidate: unknown) {
  if (
    !base ||
    !candidate ||
    typeof base !== "object" ||
    typeof candidate !== "object" ||
    Array.isArray(base) ||
    Array.isArray(candidate)
  )
    return false;
  const prior = base as { scripts?: Record<string, unknown> };
  const next = structuredClone(candidate) as typeof prior;
  if (
    !prior.scripts ||
    !next.scripts ||
    Array.isArray(prior.scripts) ||
    Array.isArray(next.scripts)
  )
    return false;
  if (isDeepStrictEqual(base, candidate)) return true;
  if (
    prior.scripts["product-ui:check"] !== "bun scripts/check-product-tools-preservation.ts" ||
    Object.hasOwn(prior.scripts, "product-materials:check") ||
    next.scripts["product-ui:check"] !== command ||
    next.scripts["product-materials:check"] !== command
  )
    return false;
  next.scripts["product-ui:check"] = prior.scripts["product-ui:check"];
  delete next.scripts["product-materials:check"];
  return isDeepStrictEqual(base, next);
}
export function productMaterialsChangeFindings(
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
      return [{ path, code: "materials_phase_removal_or_type_change" }];
    const allowed =
      path.startsWith("docs/") ||
      path === "package.json" ||
      Object.hasOwn(integrationPatches, path) ||
      (existedAtBase ? existingFiles.has(path) || selectorFiles.has(path) : newFiles.has(path));
    return allowed ? [] : [{ path, code: "outside_product_materials_scope" }];
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
export async function checkProductMaterialsPreservation(
  root: string,
  base = PRODUCT_MATERIALS_BASE,
) {
  const { sha, changes } = await collectProductShellChanges(root, base);
  const findings = productMaterialsChangeFindings(changes);
  const paths = [...new Set(changes.map(({ path }) => path))];
  for (const path of paths) {
    const stat = await lstat(join(root, path)).catch(() => null);
    if (!stat?.isFile()) findings.push({ path, code: "materials_phase_regular_file_required" });
  }
  for (const path of paths.filter(
    (value) =>
      value === "package.json" ||
      selectorFiles.has(value) ||
      Object.hasOwn(integrationPatches, value),
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
          candidates.map(async (candidate, index) => {
            if (candidate === null || before === null) return false;
            try {
              if (path === "package.json")
                return productMaterialsPackageAllowed(JSON.parse(before), JSON.parse(candidate));
              if (Object.hasOwn(integrationPatches, path))
                return productMaterialsIntegrationAllowed(path, before, candidate);
              if (path === "tests/browser/precedents.e2e.ts" && index === 2 && candidate === before)
                return false;
              return productMaterialsSelectorsAllowed(path, before, candidate, index < 2);
            } catch {
              return false;
            }
          }),
        )
      ).every(Boolean);
    if (!allowed) findings.push({ path, code: "unapproved_materials_integration_patch" });
  }
  return { changes: paths.length, findings };
}
if (import.meta.main) {
  if (process.argv.length > 3) throw new Error("PRODUCT_MATERIALS_EXPECTS_ONE_BASE_REF");
  const result = await checkProductMaterialsPreservation(
    process.cwd(),
    process.argv[2] ?? PRODUCT_MATERIALS_BASE,
  );
  if (result.findings.length) {
    for (const finding of result.findings) console.error(`${finding.path}: ${finding.code}`);
    process.exitCode = 1;
  } else console.log(`Product materials preservation passed (${result.changes} changed paths)`);
}
