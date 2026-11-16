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

/** Acceptance for remaining workspace, public and legacy-case UI migration. Runtime authorization,
 * revision, download and browser behavior remain independent required checks. */
export const PRODUCT_SURFACES_BASE = "92cb1add152b1144e2baba06d4011455c173f4dc";
const command = "bun scripts/check-product-surfaces-preservation.ts";
const existingFiles = new Set([
  "src/components/AuthButtons.tsx",
  "src/components/ConsentForm.tsx",
  "src/components/HelpFaq.tsx",
  "src/components/analysis/CaseDetail.tsx",
  "src/components/analysis/Feedback.tsx",
  "src/components/ui/media-player.tsx",
  "src/components/workspace/Workspace.tsx",
  "src/components/workspace/TimelineEvidence.tsx",
]);
const newFiles = new Set([
  "src/product-ui/legacy-case/CaseDetailView.tsx",
  "src/product-ui/legacy-case/FeedbackView.tsx",
  "src/product-ui/legacy-case/LegacyCaseParts.tsx",
  "src/product-ui/legacy-case/QuestionsView.tsx",
  "src/product-ui/legacy-case/ResultView.tsx",
  "src/product-ui/legacy-case/presentation.ts",
  "src/product-ui/legacy-case/useCaseDetailController.ts",
  "src/product-ui/legacy-case/useFeedbackController.ts",
  "src/product-ui/legacy-case/useLegacyQuestionsController.ts",
  "src/product-ui/legacy-case/useLegacyResultController.ts",
  "src/product-ui/workspace/TimelineEvidenceView.tsx",
  "src/product-ui/workspace/WorkspaceContext.tsx",
  "src/product-ui/workspace/WorkspaceControls.tsx",
  "src/product-ui/workspace/WorkspaceFeedback.tsx",
  "src/product-ui/workspace/WorkspaceFileViewer.tsx",
  "src/product-ui/workspace/WorkspaceHistory.tsx",
  "src/product-ui/workspace/WorkspaceMaterials.tsx",
  "src/product-ui/workspace/WorkspacePanes.tsx",
  "src/product-ui/workspace/WorkspaceView.tsx",
  "src/product-ui/workspace/presentation.ts",
  "src/product-ui/workspace/slots.ts",
  "src/product-ui/workspace/useWorkspaceController.ts",
  "src/product-ui/public/AuthView.tsx",
  "src/product-ui/public/ConsentView.tsx",
  "src/product-ui/public/HelpFaqView.tsx",
  "src/product-ui/public/ProviderIcon.tsx",
  "src/product-ui/public/PublicThemeControl.tsx",
  "src/product-ui/public/UnavailableFeature.astro",
  "src/product-ui/public/useAuthController.ts",
  "src/product-ui/public/useConsentController.ts",
  "src/product-ui/playback/MediaPlayerView.tsx",
  "src/product-ui/playback/Range.tsx",
  "src/product-ui/playback/useMediaPlayerController.ts",
  "src/product-ui/experience/ProductExperience.tsx",
  "src/product-ui/experience/useExperienceController.ts",
  "src/layouts/ProductPublicLayout.astro",
  "tests/product-ui-legacy-case.test.tsx",
  "tests/product-ui-workspace.test.tsx",
  "tests/product-ui-public.test.tsx",
  "tests/product-ui-consent-fixture.test.ts",
  "tests/product-ui-playback.test.tsx",
  "tests/product-ui-experience.test.tsx",
  "tests/product-ui-select-name.test.tsx",
  "tests/helpers/product-legacy-case-entry.tsx",
  "tests/helpers/product-legacy-case-server.ts",
  "scripts/check-product-surfaces-preservation.ts",
  "tests/product-ui-surfaces-preservation.test.ts",
]);
const selectorReplacements: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  "tests/browser/workspace.e2e.ts": [
    [
      ".workspace-dialog",
      '[role="dialog"][aria-labelledby="workspace-dialog-title"] [data-dialog]',
    ],
    [".workspace-buttons", "[data-product-workspace-buttons]"],
    [".workspace-main", "[data-product-workspace-main]"],
    [".workspace-material-apply", "[data-product-workspace-material-apply]"],
    [".workspace-message-attachments", "[data-product-workspace-message-attachments]"],
    [".workspace-next", "[data-product-workspace-next]"],
    [".workspace-preview", "[data-product-workspace-preview]"],
  ],
  "tests/browser/rework-conversation.e2e.ts": [
    [".workspace-error", "[data-product-workspace-error]"],
    [".workspace-message-attachments", "[data-product-workspace-message-attachments]"],
  ],
  "tests/browser/public-preview.e2e.ts": [
    [".workspace-action-list", "[data-product-workspace-action-list]"],
  ],
  "tests/browser/workspace-drafts.e2e.ts": [
    [".workspace-action-list", "[data-product-workspace-action-list]"],
    [".workspace-timeline", "[data-product-workspace-timeline]"],
  ],
  "tests/browser/product-ui.e2e.ts": [
    [".workspace-context", "[data-product-workspace-context]"],
    [".workspace-main", "[data-product-workspace-main]"],
    [".app-frame, .login-page, .consent-page", ".app-frame, [data-product-public]"],
  ],
  "tests/browser/customer-recovery-workspace.e2e.ts": [
    [".workspace-action-list", "[data-product-workspace-action-list]"],
  ],
  "tests/browser/chat-attachments.e2e.ts": [
    [".workspace-context", "[data-product-workspace-context]"],
    [".workspace-grid", "[data-product-workspace-grid]"],
    [".workspace-main", "[data-product-workspace-main]"],
    [".workspace-sidebar", "[data-product-workspace-sidebar]"],
    [".workspace-upload-target", "[data-product-workspace-upload-target]"],
  ],
  "tests/browser/workspace-materials.e2e.ts": [
    [".workspace-message-attachments", "[data-product-workspace-message-attachments]"],
  ],
  "tests/browser/rework-shared-mock.e2e.ts": [
    [".workspace-message-attachments", "[data-product-workspace-message-attachments]"],
  ],
  "tests/browser/shell-integration.e2e.ts": [],
  "tests/browser/auth.e2e.ts": [
    [".login-panel__description", "[data-product-login-description]"],
    [".login-options", "[data-product-auth]"],
  ],
  "tests/browser/headless-ui.e2e.ts": [[".login-provider", "[data-product-auth-provider]"]],
  "tests/browser/theme-palette.e2e.ts": [[".login-provider", "[data-product-auth-provider]"]],
  "tests/browser/policy-content.e2e.ts": [
    [".policy-heading", "[data-product-policy-heading]"],
    [".policy-document", "[data-product-policy-document]"],
  ],
};
const browserPatches: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  "tests/browser/workspace.e2e.ts": [
    [
      "  await expect(primary).toHaveClass(/ui-button--primary/);",
      '  await expect(primary).toHaveAttribute("data-variant", "primary");',
    ],
  ],
  "tests/browser/shell-integration.e2e.ts": [
    [
      'page.locator(".workspace-status--ready")',
      'page.getByText("결과 확인 가능", { exact: true })',
    ],
  ],
};
export const productSurfacesSelectorPaths = Object.keys(selectorReplacements);
const selectorFiles = new Set(productSurfacesSelectorPaths);
/** Only named CSS-selector arguments change. Text, code, API values and every assertion stay intact. */
export function migrateProductSurfacesSelectors(path: string, source: string) {
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
        !(
          (ts.isPropertyAccessExpression(call.expression) &&
            ["locator", "querySelector", "querySelectorAll", "include"].includes(
              call.expression.name.text,
            )) ||
          (path === "tests/browser/chat-attachments.e2e.ts" &&
            ts.isIdentifier(call.expression) &&
            call.expression.text === "box")
        )
      )
        return;
      let value = node.text;
      for (const [before, after] of replacements)
        value = value.replace(
          new RegExp(`${before.replaceAll(".", "\\.")}(?![\\w-])`, "g"),
          () => after,
        );
      if (value === node.text) return;
      let text = JSON.stringify(value);
      if (ts.isNoSubstitutionTemplateLiteral(node)) {
        text = node.getText(parsed);
        for (const [before, after] of replacements)
          text = text.replace(
            new RegExp(`${before.replaceAll(".", "\\.")}(?![\\w-])`, "g"),
            () => after,
          );
      }
      edits.push({ start: node.getStart(parsed), end: node.end, text });
    } else node.forEachChild(visit);
  };
  visit(parsed);
  let next = source;
  for (const edit of edits.reverse())
    next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  for (const [before, after] of browserPatches[path] ?? []) {
    if (next.split(before).length === 2) next = next.replace(before, after);
  }
  return next;
}
export async function productSurfacesSelectorsAllowed(
  path: string,
  base: string,
  candidate: string,
) {
  if (candidate === base) return true;
  const expected = migrateProductSurfacesSelectors(path, base);
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
// Exact reviewed integration patches against the verified 818 parent.
const integrationPatches: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  "src/layouts/ProductLayout.astro": [
    [
      'import { Experience } from "../components/ui/experience";',
      'import { ProductExperience as Experience } from "../product-ui/experience/ProductExperience";',
    ],
  ],
  "src/components/AccountSettings.tsx": [
    [
      'import { ProviderIcon } from "./AuthButtons";',
      'import { ProviderIcon } from "../product-ui/public/ProviderIcon";',
    ],
  ],
  "tests/helpers/workspace.astro.config.ts": [
    [
      'importer?.endsWith("/components/workspace/Workspace.tsx")',
      'importer?.endsWith("/product-ui/workspace/useWorkspaceController.ts")',
    ],
  ],
  "tests/product-ui-fixture-resolvers.test.ts": [
    [
      "workspace retains its original subjects while moving only Agent and FileReview owners",
      "workspace isolates the actual owning controllers after each UI migration",
    ],
    [
      '      "components/workspace/Workspace.tsx",\n',
      '      "product-ui/workspace/useWorkspaceController.ts",\n',
    ],
    [
      '      "components/workspace/ConversationAgent.tsx",\n      "components/workspace/FileReview.tsx",',
      '      "components/workspace/Workspace.tsx",\n      "product-ui/workspace/WorkspaceView.tsx",\n      "components/workspace/ConversationAgent.tsx",\n      "components/workspace/FileReview.tsx",',
    ],
  ],
  "src/components/workspace/ConversationReconfirmation.tsx": [
    [
      '        <p className="workspace-muted">',
      '        <p className="text-sm leading-7 text-[var(--pui-muted)]">',
    ],
  ],
  "src/components/intake/CaseList.tsx": [
    [
      'import { api } from "../../client/api";\nimport type { CaseView } from "../../client/api/types";\nimport type { CaseStatus } from "../../contracts";\nimport { Button, ButtonLink } from "../ui/button";\nimport { LoadingContent } from "../ui/loading";\n',
      'import { api } from "../../client/api";\nimport type { CaseView } from "../../client/api/types";\nimport { Button, ButtonLink } from "../ui/button";\nimport { LoadingContent } from "../ui/loading";\n',
    ],
    [
      'import { useCustomerAccess } from "./useCustomerAccess";\n\n// Used by the preserved v1 detail UI.\nexport const statusLabels: Record<CaseStatus, string> = {\n  screening: "입력 확인",\n  needs_clarification: "추가 질문",\n  queued: "분석 대기",\n  analyzing: "공식 자료 확인·결과 점검",\n  completed: "결과 완료",\n  out_of_scope: "지원 범위 안내",\n  urgent_redirect: "긴급 안전 안내",\n  failed: "분석 실패",\n};\nconst stageLabels = {\n  intake: "질문 답변 중",\n',
      'import { useCustomerAccess } from "./useCustomerAccess";\n\n// Compatibility export for callers of the former list module.\nexport { statusLabels } from "../../product-ui/legacy-case/presentation";\n\nconst stageLabels = {\n  intake: "질문 답변 중",\n',
    ],
  ],
  "src/product-ui/Button.tsx": [
    [
      "      {...(ref === undefined ? {} : { ref })}\n      type={type}",
      '      {...(ref === undefined ? {} : { ref })}\n      data-variant={variant === undefined ? "primary" : variant}\n      type={type}',
    ],
    [
      "    <a\n      {...props}\n      href={unavailable ? undefined : href}",
      '    <a\n      {...props}\n      data-variant={variant === undefined ? "primary" : variant}\n      href={unavailable ? undefined : href}',
    ],
  ],
};
// Root reviewed this complete DS extension: optional sheet placement, panel ref,
// title identity and header actions. Reviewed public route/content candidates are
// also pinned, including status, OAuth branches, policy copy, links and start CTAs.
const frozenIntegrationBlobs: Readonly<Record<string, string>> = {
  "src/product-ui/Select.tsx": "4f50e113c111aae2626c113af528cb9bf7290ec1b92aaab6f5cd6a1e8e7f0bfa",
  "tests/helpers/product-shell-fixture.tsx":
    "365f4fdfd68a78042a02ff093c5beb49efc39ba27899c94ffada2e8c1543b136",
  "src/components/PolicyDocument.astro":
    "184bfd3832a34ec805d087f55d67d7c0bc8d5b8d7b74382221d4bd8417efd6c4",
  "src/pages/404.astro": "ac5e0dd4603941605d0a27fbf2988eac9e9d3bb375cdd06e4e454f927fa61664",
  "src/pages/consent.astro": "0cc8a067b4274c217a38e14bb3e2e43ab46efd733cfe90c8ec17882d67653395",
  "src/pages/help.astro": "8b213818944b4e7a309a4da03bddfd12f481bc8a4a4cb23d4ac658f723aed8f2",
  "src/pages/lawyer/index.astro":
    "93c3711432198f9ead7b6459992a5bc7dc1852a402697281e1db3531f7de9927",
  "src/pages/lawyers/[id].astro":
    "ad32cd158324695fd6bad4299638ad5260922142d2461d74cd724de3677d37b9",
  "src/pages/lawyers/index.astro":
    "ad32cd158324695fd6bad4299638ad5260922142d2461d74cd724de3677d37b9",
  "src/pages/login.astro": "40e0c4515ad701316d8327dd5678abba19f363e892521495fab16bb61cab4ef5",
  "src/pages/policies/ai.astro": "259e4b761ed795439c3d6a2b63682463d6ac938c4862bded88221f5a9662b2c2",
  "src/pages/policies/privacy.astro":
    "fc130c551b23bf7c99093b17c7359c1ebbf6dc4b179c0755a595250b5e2d9f39",
  "src/pages/policies/terms.astro":
    "07bda6ecea773de154594c20fd3d868e44e1076c1ec4b55150aa2b3ec0040e0c",
  "src/product-ui/Dialog.tsx": "5f20cea82eb7b58300811202efb8b9c51544b10dafcf8bc1e7c08a986da7dbd0",
};
const integrationFile = (path: string) =>
  Object.hasOwn(integrationPatches, path) || Object.hasOwn(frozenIntegrationBlobs, path);
/** Only the reviewed compatibility/import and primitive deltas may change. */
export function migrateProductSurfacesIntegration(path: string, base: string): string | null {
  const patches = integrationPatches[path];
  if (!patches) return null;
  let next = base;
  for (const [before, after] of patches) {
    if (next.split(before).length !== 2) return null;
    next = next.replace(before, after);
  }
  return next;
}
export function productSurfacesIntegrationAllowed(path: string, base: string, candidate: string) {
  return (
    integrationFile(path) &&
    (candidate === base ||
      candidate === migrateProductSurfacesIntegration(path, base) ||
      (Object.hasOwn(frozenIntegrationBlobs, path) &&
        createHash("sha256").update(candidate).digest("hex") === frozenIntegrationBlobs[path]))
  );
}
export function productSurfacesPackageAllowed(base: unknown, candidate: unknown) {
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
    prior.scripts["product-ui:check"] !== "bun scripts/check-product-materials-preservation.ts" ||
    Object.hasOwn(prior.scripts, "product-surfaces:check") ||
    next.scripts["product-ui:check"] !== command ||
    next.scripts["product-surfaces:check"] !== command
  )
    return false;
  next.scripts["product-ui:check"] = prior.scripts["product-ui:check"];
  delete next.scripts["product-surfaces:check"];
  return isDeepStrictEqual(base, next);
}
export function productSurfacesChangeFindings(
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
      return [{ path, code: "surfaces_phase_removal_or_type_change" }];
    const allowed =
      path.startsWith("docs/") ||
      path === "package.json" ||
      integrationFile(path) ||
      (existedAtBase ? existingFiles.has(path) || selectorFiles.has(path) : newFiles.has(path));
    return allowed ? [] : [{ path, code: "outside_product_surfaces_scope" }];
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
export async function checkProductSurfacesPreservation(root: string, base = PRODUCT_SURFACES_BASE) {
  const { sha, changes } = await collectProductShellChanges(root, base);
  const findings = productSurfacesChangeFindings(changes);
  const paths = [...new Set(changes.map(({ path }) => path))];
  for (const path of paths) {
    const stat = await lstat(join(root, path)).catch(() => null);
    if (!stat?.isFile()) findings.push({ path, code: "surfaces_phase_regular_file_required" });
  }
  for (const path of paths.filter(
    (value) => value === "package.json" || selectorFiles.has(value) || integrationFile(value),
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
            if (candidate === null || before === null) return false;
            try {
              if (path === "package.json")
                return productSurfacesPackageAllowed(JSON.parse(before), JSON.parse(candidate));
              if (integrationFile(path))
                return productSurfacesIntegrationAllowed(path, before, candidate);
              return productSurfacesSelectorsAllowed(path, before, candidate);
            } catch {
              return false;
            }
          }),
        )
      ).every(Boolean);
    if (!allowed) findings.push({ path, code: "unapproved_surfaces_integration_patch" });
  }
  return { changes: paths.length, findings };
}
if (import.meta.main) {
  if (process.argv.length > 3) throw new Error("PRODUCT_SURFACES_EXPECTS_ONE_BASE_REF");
  const result = await checkProductSurfacesPreservation(
    process.cwd(),
    process.argv[2] ?? PRODUCT_SURFACES_BASE,
  );
  if (result.findings.length) {
    for (const finding of result.findings) console.error(`${finding.path}: ${finding.code}`);
    process.exitCode = 1;
  } else console.log(`Product surfaces preservation passed (${result.changes} changed paths)`);
}
