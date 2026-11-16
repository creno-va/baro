/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: Exact source comparisons retain literal interpolation syntax. */
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

/** Acceptance for conversation tools, follow-up drafts and account UI migration. Runtime authorization,
 * revision, download and browser behavior remain independent required checks. */
export const PRODUCT_TOOLS_BASE = "44caf3ae302bd2fafd4bb7f661b0b33130a0098c";
const command = "bun scripts/check-product-tools-preservation.ts";
const existingFiles = new Set([
  "src/components/workspace/ConversationAgent.tsx",
  "src/components/workspace/ConversationAnalysis.tsx",
  "src/components/workspace/ConversationPanel.tsx",
  "src/components/workspace/ConversationPreparation.tsx",
  "src/components/workspace/MessageContent.tsx",
  "src/components/workspace/ProgressiveReply.tsx",
  "src/components/workspace/SourceCards.tsx",
  "src/components/resolution/FollowUpResolution.tsx",
  "src/components/AccountSettings.tsx",
  "src/components/lawyers/LegacyProfileAssets.tsx",
  "src/product-ui/Disclosure.tsx",
  "tests/product-ui-detail-primitives.test.tsx",
]);
const newFiles = new Set([
  "src/product-ui/conversation-tools/AnalysisView.tsx",
  "src/product-ui/conversation-tools/PreparationView.tsx",
  "src/product-ui/conversation-tools/PanelView.tsx",
  "src/product-ui/conversation-tools/AgentView.tsx",
  "src/product-ui/conversation-tools/MessageView.tsx",
  "src/product-ui/conversation-tools/ProgressiveReplyView.tsx",
  "src/product-ui/conversation-tools/SourceCardsView.tsx",
  "src/product-ui/conversation-tools/useConversationAgentController.ts",
  "src/product-ui/conversation-tools/useConversationPanelController.ts",
  "src/product-ui/conversation-tools/useProgressiveReplyController.ts",
  "src/product-ui/resolution/useResolutionController.ts",
  "src/product-ui/resolution/ResolutionView.tsx",
  "src/product-ui/resolution/ResolutionScope.tsx",
  "src/product-ui/resolution/ResolutionGuide.tsx",
  "src/product-ui/resolution/ResolutionComponents.tsx",
  "src/product-ui/account/useAccountSettingsController.ts",
  "src/product-ui/account/useLegacyProfileAssetsController.ts",
  "src/product-ui/account/AccountSettingsView.tsx",
  "src/product-ui/account/LegacyProfileAssetsView.tsx",
  "src/product-ui/account/AccountComponents.tsx",
  "tests/product-ui-conversation-tools.test.tsx",
  "tests/product-ui-resolution.test.tsx",
  "tests/product-ui-account.test.tsx",
  "scripts/check-product-tools-preservation.ts",
  "tests/product-ui-tools-preservation.test.ts",
  "tests/product-ui-fixture-resolvers.test.ts",
  "tests/helpers/conversation-agent-legacy.css",
]);
const selectorReplacements: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  "tests/browser/resolution.e2e.ts": [[".resolution-path", "[data-product-resolution-path]"]],
  "tests/browser/report-rework-state.e2e.ts": [
    [".resolution-path", "[data-product-resolution-path]"],
    [".resolution", "[data-product-resolution]"],
  ],
  "tests/browser/chat-attachments.e2e.ts": [
    [".workspace-message-content", "[data-product-message-content]"],
  ],
  "tests/browser/product-ui.e2e.ts": [
    [".workspace-source-cards", "[data-product-source-cards]"],
    [".workspace-source-card", "[data-product-source-card]"],
    [".account-settings", "[data-product-account]"],
    [".usage-item", "[data-product-account-usage-item]"],
    [".settings-usage-guide", "[data-product-account-usage-guide]"],
  ],
  "tests/browser/conversation-agent.e2e.ts": [
    [".conversation-agent", "[data-product-conversation-agent]"],
  ],
  "tests/browser/settings.e2e.ts": [
    [".settings-provider", "[data-product-account-provider]"],
    [".settings-section-heading", "[data-product-account-section-heading]"],
  ],
  "tests/browser/shell-integration.e2e.ts": [
    [".settings-refresh", "[data-product-account-refresh]"],
  ],
  "tests/browser/reports.e2e.ts": [
    [".account-settings", "[data-product-account]"],
    [".report-modal", '[role="dialog"]'],
  ],
};
const accountHeadingTemplate = {
  before: "`.settings-${section} .settings-section-heading`",
  after: '`[aria-labelledby="settings-${section}-title"] [data-product-account-section-heading]`',
};
export const productToolsSelectorPaths = Object.keys(selectorReplacements);
const selectorFiles = new Set(productToolsSelectorPaths);
/** Only the named current consumers migrate; every other test byte is preserved. */
export function migrateProductToolsSelectors(path: string, source: string) {
  if (!Object.hasOwn(selectorReplacements, path)) return source;
  const replacements = selectorReplacements[path];
  if (!replacements) return source;
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edits: { start: number; end: number; text: string }[] = [];
  const selectorArgument = (node: ts.Node) => {
    const call = node.parent;
    return (
      ts.isCallExpression(call) &&
      call.arguments[0] === node &&
      ts.isPropertyAccessExpression(call.expression) &&
      ["locator", "querySelector", "querySelectorAll", "include"].includes(
        call.expression.name.text,
      )
    );
  };
  const visit = (node: ts.Node) => {
    if (
      path === "tests/browser/settings.e2e.ts" &&
      ts.isTemplateExpression(node) &&
      selectorArgument(node) &&
      node.getText(parsed) === accountHeadingTemplate.before
    ) {
      edits.push({
        start: node.getStart(parsed),
        end: node.end,
        text: accountHeadingTemplate.after,
      });
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!selectorArgument(node)) return;
      const original = node.getText(parsed);
      let value = node.text;
      for (const [before, after] of replacements) value = value.replaceAll(before, after);
      if (value === node.text) return;
      let text = JSON.stringify(value);
      if (ts.isNoSubstitutionTemplateLiteral(node)) {
        text = original;
        for (const [before, after] of replacements) text = text.replaceAll(before, after);
      }
      if (text !== original) edits.push({ start: node.getStart(parsed), end: node.end, text });
    } else node.forEachChild(visit);
  };
  visit(parsed);
  let next = source;
  for (const edit of edits.reverse())
    next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  return next;
}
export async function productToolsSelectorsAllowed(path: string, base: string, candidate: string) {
  if (candidate === base) return true;
  const expected = migrateProductToolsSelectors(path, base);
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
const styleIntegrationPatches: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  "src/pages/settings.astro": [['import "../styles/settings.css";\n', ""]],
  "tests/helpers/reports-ui-server.ts": [
    ["  (await Bun.file(`${root}/src/styles/resolution.css`).text()) +\n", ""],
    ["  (await Bun.file(`${root}/src/styles/settings.css`).text()) +\n", ""],
  ],
  "tests/helpers/resolution-server.ts": [
    [
      'import { resolve } from "node:path";\n',
      'import { resolve } from "node:path";\nimport { compileProductStyles } from "./product-styles";\n',
    ],
    [
      'const css =\n  (await Bun.file(`${root}/src/styles/global.css`).text())\n    .replace(/^@import .*;$/gm, "")\n    .replace(/@theme inline\\s*\\{[^}]*\\}/s, "") +\n  (await Bun.file(`${root}/src/styles/design-system.css`).text()) +\n  (await Bun.file(`${root}/src/styles/resolution.css`).text()) +\n',
      "const css =\n  (await compileProductStyles(root)) +\n",
    ],
    ['<html lang="ko">', '<html lang="ko" data-baro-ui data-product-chrome="v2">'],
  ],
  "src/product-ui/product.css": [
    [
      "/* Product routes retain the business islands' CSS while new Tailwind utilities\n * can own new chrome. The landing keeps its original BaseLayout and imports. */",
      "/* Retained business CSS stays in the legacy layer while Tailwind owns new\n * product views. The landing uses its own layout and stylesheet entry. */",
    ],
    [
      '@import "../styles/reports.css" layer(legacy);\n',
      '@import "../styles/reports.css" layer(legacy);\n@import "../styles/resolution.css" layer(legacy);\n@import "../styles/settings.css" layer(legacy);\n',
    ],
  ],
};
const fixtureIntegrationPatches: Readonly<Record<string, readonly (readonly [string, string])[]>> =
  {
    "tests/helpers/conversation-agent-page.astro": [
      [
        '---\n// biome-ignore lint/correctness/noUnusedImports: Astro renders the fixture layout.\nimport BaseLayout from "../../src/layouts/BaseLayout.astro";\n// biome-ignore lint/correctness/noUnusedImports: Astro hydrates the synthetic harness.\nimport { ConversationAgentFixture } from "./conversation-agent-fixture";\nimport "../../src/styles/workspace.css";\nimport "../../src/styles/product.css";\n---\n<BaseLayout title="합성 대화 연결 검증 · BARO" description="대화 에이전트의 격리 UI 검증">\n  <main id="main-content" tabindex="-1" class="app-frame app-frame--product"><ConversationAgentFixture client:load /></main>\n</BaseLayout>\n',
        '---\nimport "../../src/product-ui/product.css";\nimport "./conversation-agent-legacy.css";\n// biome-ignore lint/correctness/noUnusedImports: Astro renders the existing confirmation/theme island.\nimport { Experience } from "../../src/components/ui/experience";\n// biome-ignore lint/correctness/noUnusedImports: Astro hydrates the synthetic harness.\nimport { ConversationAgentFixture } from "./conversation-agent-fixture";\n\nAstro.response.headers.set("Cache-Control", "private, no-store, no-transform");\nconst pageBootstrap =\n  "Object.assign(globalThis, { __zod_globalConfig: { jitless: true } });" +\n  "try{var p=localStorage.getItem(\'baro-theme\');var d=p===\'dark\'||(p!==\'light\'&&matchMedia(\'(prefers-color-scheme: dark)\').matches);document.documentElement.dataset.theme=d?\'dark\':\'light\'}catch(e){document.documentElement.dataset.theme=matchMedia(\'(prefers-color-scheme: dark)\').matches?\'dark\':\'light\'}";\nconst bootstrapDigest = await crypto.subtle.digest(\n  "SHA-256",\n  new TextEncoder().encode(pageBootstrap),\n);\nAstro.csp?.insertScriptHash(\n  `sha256-${btoa(String.fromCharCode(...new Uint8Array(bootstrapDigest)))}`,\n);\n---\n\n<!doctype html>\n<html lang="ko" data-baro-ui="" data-theme="light" data-product-chrome="v2">\n  <head>\n    <meta charset="UTF-8" />\n    <script is:inline set:html={pageBootstrap} />\n    <meta name="viewport" content="width=device-width" />\n    <meta name="description" content="대화 에이전트의 격리 UI 검증" />\n    <link rel="icon" type="image/svg+xml" href="/brand/logo.svg" />\n    <title>합성 대화 연결 검증 · BARO</title>\n  </head>\n  <body>\n    <a class="skip-link" href="#main-content">본문으로 건너뛰기</a>\n    <main id="main-content" tabindex="-1" class="app-frame app-frame--product" data-product-ui=""><ConversationAgentFixture client:load /></main>\n    <div data-baro-experience><Experience client:load /></div>\n  </body>\n</html>\n\n<script>\n  import { installAppFocus } from "../../src/client/app-focus";\n\n  installAppFocus(document);\n</script>\n',
      ],
    ],
    "tests/helpers/conversation-agent.astro.config.ts": [
      [
        '        resolveId(source: string, importer?: string) {\n          if (\n            source === "../../client/api" &&\n            importer?.endsWith("/workspace/ConversationAgent.tsx")\n          )\n            return fileURLToPath(new URL("./conversation-agent-browser-api.ts", import.meta.url));\n          return null;\n',
        '        resolveId(source: string, importer?: string) {\n          if (\n            source === "../../client/api" &&\n            importer?.endsWith("/conversation-tools/useConversationAgentController.ts")\n          )\n            return fileURLToPath(new URL("./conversation-agent-browser-api.ts", import.meta.url));\n          return null;\n',
      ],
    ],
    "tests/helpers/workspace.astro.config.ts": [
      [
        '          if (\n            source === "../../client/api" &&\n            (importer?.endsWith("/components/workspace/Workspace.tsx") ||\n              importer?.endsWith("/components/workspace/ConversationAgent.tsx") ||\n              importer?.endsWith("/components/workspace/useEvidenceUpload.ts") ||\n              importer?.endsWith("/components/workspace/LookupDialog.tsx") ||\n              importer?.endsWith("/components/workspace/FileReview.tsx") ||\n              importer?.endsWith("/components/intake/useCustomerAccess.ts"))\n          )\n            return fileURLToPath(new URL("./workspace-client-fixture.ts", import.meta.url));\n',
        '          if (\n            source === "../../client/api" &&\n            (importer?.endsWith("/components/workspace/Workspace.tsx") ||\n              importer?.endsWith(\n                "/product-ui/conversation-tools/useConversationAgentController.ts",\n              ) ||\n              importer?.endsWith("/components/workspace/useEvidenceUpload.ts") ||\n              importer?.endsWith("/components/workspace/LookupDialog.tsx") ||\n              importer?.endsWith("/product-ui/materials/useFileReviewController.ts") ||\n              importer?.endsWith("/components/intake/useCustomerAccess.ts"))\n          )\n            return fileURLToPath(new URL("./workspace-client-fixture.ts", import.meta.url));\n',
      ],
    ],
    "tests/helpers/intake-reconfirmation.astro.config.ts": [
      [
        '        name: "isolated-intake-reconfirmation-facade",\n        enforce: "pre" as const,\n        resolveId(source: string, importer?: string) {\n          if (source === "../../client/api" && importer?.includes("/components/intake/"))\n            return fileURLToPath(new URL("./intake-rework-client-fixture.ts", import.meta.url));\n          return null;\n        },\n',
        '        name: "isolated-intake-reconfirmation-facade",\n        enforce: "pre" as const,\n        resolveId(source: string, importer?: string) {\n          if (\n            source === "../../client/api" &&\n            (importer?.includes("/components/intake/") ||\n              importer?.endsWith("/product-ui/intake/useCaseInputController.ts") ||\n              importer?.endsWith("/product-ui/intake/useQuestionsController.ts") ||\n              importer?.endsWith("/product-ui/summary/useSummaryReconfirmationController.ts"))\n          )\n            return fileURLToPath(new URL("./intake-rework-client-fixture.ts", import.meta.url));\n          return null;\n        },\n',
      ],
    ],
  };
const integrationPatches = { ...styleIntegrationPatches, ...fixtureIntegrationPatches };
const exactNewFixtures: Readonly<Record<string, string>> = {
  "tests/helpers/conversation-agent-legacy.css":
    '/* Preserve the isolated fixture\'s old chrome inside the same legacy layer. */\n@import "../../src/styles/product.css" layer(legacy);\n',
};
export function productToolsNewFixtureAllowed(path: string, candidate: string) {
  return Object.hasOwn(exactNewFixtures, path) && candidate === exactNewFixtures[path];
}
/** Exact CSS compiler/import changes only. Endpoints, resolvers, CSP and route bodies cannot change. */
export function migrateProductToolsIntegration(path: string, base: string): string | null {
  const patches = integrationPatches[path];
  if (!patches) return null;
  let next = base;
  for (const [before, after] of patches) {
    if (next.split(before).length !== 2) return null;
    next = next.replace(before, after);
  }
  return next;
}
export function productToolsIntegrationAllowed(path: string, base: string, candidate: string) {
  return (
    Object.hasOwn(integrationPatches, path) &&
    (candidate === base || candidate === migrateProductToolsIntegration(path, base))
  );
}
export function productToolsPackageAllowed(base: unknown, candidate: unknown) {
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
    prior.scripts["product-ui:check"] !== "bun scripts/check-product-landing-preservation.ts" ||
    Object.hasOwn(prior.scripts, "product-tools:check") ||
    next.scripts["product-ui:check"] !== command ||
    next.scripts["product-tools:check"] !== command
  )
    return false;
  next.scripts["product-ui:check"] = prior.scripts["product-ui:check"];
  delete next.scripts["product-tools:check"];
  return isDeepStrictEqual(base, next);
}
export function productToolsChangeFindings(
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
    if (!["A", "M"].includes(status)) return [{ path, code: "tools_phase_removal_or_type_change" }];
    const allowed =
      path.startsWith("docs/") ||
      path === "package.json" ||
      Object.hasOwn(integrationPatches, path) ||
      (existedAtBase ? existingFiles.has(path) || selectorFiles.has(path) : newFiles.has(path));
    return allowed ? [] : [{ path, code: "outside_product_tools_scope" }];
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
export async function checkProductToolsPreservation(root: string, base = PRODUCT_TOOLS_BASE) {
  const { sha, changes } = await collectProductShellChanges(root, base);
  const findings = productToolsChangeFindings(changes);
  const paths = [...new Set(changes.map(({ path }) => path))];
  for (const path of paths) {
    const stat = await lstat(join(root, path)).catch(() => null);
    if (!stat?.isFile()) findings.push({ path, code: "tools_phase_regular_file_required" });
  }
  for (const path of paths.filter(
    (value) =>
      value === "package.json" ||
      selectorFiles.has(value) ||
      Object.hasOwn(integrationPatches, value) ||
      Object.hasOwn(exactNewFixtures, value),
  )) {
    const before = await gitFile(root, `${sha}:${path}`);
    const candidates = await Promise.all([
      gitFile(root, `HEAD:${path}`),
      gitFile(root, `:${path}`),
      readFile(join(root, path), "utf8").catch(() => null),
    ]);
    const allowed =
      (before !== null || Object.hasOwn(exactNewFixtures, path)) &&
      (
        await Promise.all(
          candidates.map(async (candidate) => {
            if (Object.hasOwn(exactNewFixtures, path))
              return candidate === null || productToolsNewFixtureAllowed(path, candidate);
            if (candidate === null || before === null) return false;
            try {
              if (path === "package.json")
                return productToolsPackageAllowed(JSON.parse(before), JSON.parse(candidate));
              if (Object.hasOwn(integrationPatches, path))
                return productToolsIntegrationAllowed(path, before, candidate);
              return productToolsSelectorsAllowed(path, before, candidate);
            } catch {
              return false;
            }
          }),
        )
      ).every(Boolean);
    if (!allowed) findings.push({ path, code: "unapproved_tools_integration_patch" });
  }
  return { changes: paths.length, findings };
}
if (import.meta.main) {
  if (process.argv.length > 3) throw new Error("PRODUCT_TOOLS_EXPECTS_ONE_BASE_REF");
  const result = await checkProductToolsPreservation(
    process.cwd(),
    process.argv[2] ?? PRODUCT_TOOLS_BASE,
  );
  if (result.findings.length) {
    for (const finding of result.findings) console.error(`${finding.path}: ${finding.code}`);
    process.exitCode = 1;
  } else console.log(`Product tools preservation passed (${result.changes} changed paths)`);
}
