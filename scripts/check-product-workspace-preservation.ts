import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  collectProductShellChanges,
  type ProductShellChange,
  type ProductShellFinding,
} from "./check-product-shell-preservation";

/** Acceptance scope for the conversation/questions visual migration. Behavioral
 * and security gates remain independent; previous phase checkers stay historical. */
export const PRODUCT_WORKSPACE_BASE = "27a09b10b9d51192bb534fbdcd07ff0214031352";
const command = "bun scripts/check-product-workspace-preservation.ts";
const existingFiles = new Set([
  "src/components/ui/workspace-frame.tsx",
  "src/components/workspace/CaseNavigation.tsx",
  "src/components/workspace/Workspace.tsx",
  "src/components/intake/IntakeQuestions.tsx",
  "src/product-ui/product.css",
  "src/product-ui/intake/CaseInputView.tsx",
  "tests/helpers/product-shell-fixture.tsx",
  "tests/helpers/app-workspace-server.ts",
  "tests/helpers/reports-ui-server.ts",
  "tests/helpers/report-real-server.ts",
]);
const workspaceStyleImports: Record<string, string> = {
  "src/pages/cases/[caseId].astro": 'import "../../styles/workspace.css";\n',
  "src/pages/cases/[caseId]/reports.astro": 'import "../../../styles/workspace.css";\n',
  "src/pages/cases/[caseId]/actions.astro": 'import "../../../styles/workspace.css";\n',
  "src/pages/cases/[caseId]/precedents.astro": 'import "../../../styles/workspace.css";\n',
  "src/pages/cases/[caseId]/timeline.astro": 'import "../../../styles/workspace.css";\n',
  "src/pages/cases/[caseId]/files.astro": 'import "../../../styles/workspace.css";\n',
};

export const productWorkspaceSelectorPaths = [
  "tests/browser/rework-shared-mock.e2e.ts",
  "tests/browser/precedents.e2e.ts",
  "tests/browser/chat-attachments.e2e.ts",
  "tests/browser/intake-persistence.e2e.ts",
  "tests/browser/product-ui.e2e.ts",
  "tests/browser/intake-saved-review.e2e.ts",
  "tests/browser/app-workspace-app.e2e.ts",
  "tests/browser/workspace-drafts.e2e.ts",
  "tests/browser/case-workbench.e2e.ts",
  "tests/browser/shell-integration.e2e.ts",
  "tests/browser/rework-conversation.e2e.ts",
  "tests/browser/workspace.e2e.ts",
  "tests/browser/intake103.e2e.ts",
  "tests/browser/report-rework-state.e2e.ts",
  "tests/browser/app-workspace.e2e.ts",
  "tests/browser/conversation-home.e2e.ts",
  "tests/helpers/case-navigation.ts",
  "tests/helpers/workspace-navigation.ts",
] as const;
const selectorFiles = new Set<string>(productWorkspaceSelectorPaths);
const conversationSelectors = [
  [".case-tools > [data-popover-button]", "[data-product-case-navigation] [data-popover-button]"],
  [".workspace-composer-surface", "[data-product-composer-surface]"],
  [".workspace-composer-row", "[data-product-composer-row]"],
  [".workspace-composer", "[data-product-composer]"],
  [".composer-add-menu", "[data-product-composer-menu]"],
  [".workspace-send", "[data-product-composer-send]"],
  [".case-navigation", "[data-product-case-navigation]"],
  [".case-header", "[data-product-case-navigation]"],
] as const;
const questionSelectors = [
  [".intake-scene-answer-state", "[data-product-question-answer-state]"],
  [".intake-scene-navigation", "[data-product-question-navigation]"],
  [".intake-scene-content", "[data-product-question-content]"],
  [".intake-scene-primary", "[data-product-question-primary]"],
  [".intake-scene-action", "[data-product-question-action]"],
  [".intake-scene-back", "[data-product-question-back]"],
  [".intake-recovery", "[data-product-question-recovery]"],
  [".intake-scene", "[data-product-question-scene]"],
  [".intake-flow", "[data-product-questions]"],
] as const;

/** Only selectors in the reviewed actual-component tests change. Fixture-owned
 * markup such as ConversationAgent's independent composer remains untouched. */
export function migrateProductWorkspaceSelectors(path: string, source: string) {
  if (!selectorFiles.has(path)) return source;
  let next = source;
  if (path === "tests/browser/conversation-home.e2e.ts") {
    next = next.replace(
      ".conversation-home button:not([role=radio]), .conversation-context label",
      "[data-product-case-input] button:not([role=radio]), [data-product-case-input] label:has(input[type=radio])",
    );
    return next.replace(
      "  expect(targetHeights.every((height) => height >= 44)).toBe(true);",
      "  expect(targetHeights.length).toBeGreaterThan(0);\n  expect(targetHeights.every((height) => height >= 44)).toBe(true);",
    );
  }
  for (const [before, after] of conversationSelectors) next = next.replaceAll(before, after);
  if (
    ["tests/browser/app-workspace.e2e.ts", "tests/browser/chat-attachments.e2e.ts"].includes(path)
  )
    next = next.replaceAll(".ds-responsive-panel", "[data-product-workspace-panel]");
  if (
    [
      "tests/browser/intake103.e2e.ts",
      "tests/browser/intake-persistence.e2e.ts",
      "tests/browser/intake-saved-review.e2e.ts",
    ].includes(path)
  )
    for (const [before, after] of questionSelectors) next = next.replaceAll(before, after);
  if (path === "tests/browser/intake103.e2e.ts") {
    next = next.replace(
      'page.locator(".conversation-home")',
      'page.locator("[data-product-case-input]")',
    );
    next = next.replace(
      '    await expect(page.getByRole("button", { name: "나중에 이어하기", exact: true })).toHaveClass(\n      /ui-button--outline/,\n    );',
      '    await expect(page.getByRole("button", { name: "나중에 이어하기", exact: true })).toHaveAttribute(\n      "data-appearance",\n      "outline",\n    );',
    );
  }
  if (path === "tests/browser/intake-saved-review.e2e.ts")
    next = next.replace(
      '  await expect(panel.getByRole("button", { name: "나중에 이어하기", exact: true })).toHaveClass(\n    /ui-button--outline/,\n  );',
      '  await expect(panel.getByRole("button", { name: "나중에 이어하기", exact: true })).toHaveAttribute(\n    "data-appearance",\n    "outline",\n  );',
    );
  return next;
}

export async function productWorkspaceSelectorsAllowed(
  path: string,
  base: string,
  candidate: string,
) {
  if (candidate === base) return true;
  const expected = migrateProductWorkspaceSelectors(path, base);
  if (expected === base) return false;
  if (candidate === expected) return true;
  // Longer selectors can require line wrapping. Accept the pinned formatter's
  // exact output, rather than ignoring whitespace or comparing compiled code.
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
const newFiles = new Set([
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
  "tests/helpers/product-styles.ts",
]);

export function productWorkspaceChangeFindings(
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
      return [{ path, code: "workspace_phase_removal_or_type_change" }];
    const allowed =
      path.startsWith("docs/") ||
      ["package.json", "bun.lock", "src/layouts/CaseLayout.astro"].includes(path) ||
      Object.hasOwn(workspaceStyleImports, path) ||
      (existedAtBase ? existingFiles.has(path) || selectorFiles.has(path) : newFiles.has(path));
    return allowed ? [] : [{ path, code: "outside_product_workspace_scope" }];
  });
}

export function productWorkspacePackageAllowed(base: unknown, candidate: unknown) {
  if (isDeepStrictEqual(base, candidate)) return true;
  if (!base || !candidate || typeof base !== "object" || typeof candidate !== "object")
    return false;
  const prior = base as {
    scripts?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
  };
  const next = structuredClone(candidate) as typeof prior;
  if (
    !prior.scripts ||
    !next.scripts ||
    Array.isArray(next.scripts) ||
    prior.scripts["product-ui:check"] !== "bun scripts/check-product-shell-preservation.ts" ||
    Object.hasOwn(prior.scripts, "product-workspace:check") ||
    next.scripts["product-ui:check"] !== command ||
    next.scripts["product-workspace:check"] !== command
  )
    return false;
  next.scripts["product-ui:check"] = prior.scripts["product-ui:check"];
  delete next.scripts["product-workspace:check"];
  const compilerDependencies = ["@tailwindcss/node", "@tailwindcss/oxide"];
  if (compilerDependencies.some((name) => Object.hasOwn(next.devDependencies ?? {}, name))) {
    if (
      !next.devDependencies ||
      compilerDependencies.some(
        (name) =>
          Object.hasOwn(prior.devDependencies ?? {}, name) ||
          next.devDependencies?.[name] !== "4.3.3",
      )
    )
      return false;
    for (const name of compilerDependencies) delete next.devDependencies[name];
  }
  return isDeepStrictEqual(base, next);
}

/** The compiler packages already exist transitively. Only their two explicit
 * root development entries may change; all resolution/integrity bytes stay exact. */
export function productWorkspaceLockAllowed(base: string, candidate: string) {
  const rootStart = base.indexOf('  "workspaces": {\n    "": {');
  const rootEnd = base.indexOf('\n    "apps/mobile": {');
  const anchor = '        "@playwright/test": "1.63.0",\n';
  const position = base.indexOf(anchor);
  return (
    candidate === base ||
    (rootStart >= 0 &&
      rootEnd > rootStart &&
      position > rootStart &&
      position < rootEnd &&
      base.split(anchor).length === 2 &&
      candidate ===
        base.replace(
          anchor,
          `${anchor}        "@tailwindcss/node": "4.3.3",\n        "@tailwindcss/oxide": "4.3.3",\n`,
        ))
  );
}

export function productWorkspaceCaseLayoutAllowed(base: string, candidate: string) {
  const legacyImport = 'import "../styles/cases.css";\n';
  if (candidate === base) return true;
  if (base.split(legacyImport).length !== 2) return false;
  const removed = base.replace(legacyImport, "");
  if (candidate === removed) return true;
  const layoutImport =
    '// biome-ignore lint/correctness/noUnusedImports: Astro template reads component.\nimport CaseWorkbenchLayout from "./CaseWorkbenchLayout.astro";\n';
  const environmentImport = 'import { env } from "cloudflare:workers";\n';
  // Removing the side-effect import permits Biome's exact import ordering.
  const original = `---\n${layoutImport}${environmentImport}`;
  return (
    removed.startsWith(original) &&
    candidate === removed.replace(original, `---\n${environmentImport}${layoutImport}`)
  );
}

export function productWorkspacePageAllowed(path: string, base: string, candidate: string) {
  const legacyImport = workspaceStyleImports[path];
  return (
    Object.hasOwn(workspaceStyleImports, path) &&
    legacyImport !== undefined &&
    (candidate === base ||
      (base.split(legacyImport).length === 2 && candidate === base.replace(legacyImport, "")))
  );
}

async function gitFile(root: string, revision: string) {
  const child = Bun.spawn(["git", "show", revision], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [output] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return (await child.exited) === 0 ? output : null;
}

export async function checkProductWorkspacePreservation(
  root: string,
  base = PRODUCT_WORKSPACE_BASE,
) {
  const { sha, changes } = await collectProductShellChanges(root, base);
  const findings = productWorkspaceChangeFindings(changes);
  const paths = [...new Set(changes.map(({ path }) => path))];
  for (const path of paths) {
    const stat = await lstat(join(root, path)).catch(() => null);
    if (!stat?.isFile()) findings.push({ path, code: "workspace_phase_regular_file_required" });
  }
  if (paths.includes("package.json")) {
    const before = await gitFile(root, `${sha}:package.json`);
    const candidates = await Promise.all([
      gitFile(root, "HEAD:package.json"),
      gitFile(root, ":package.json"),
      readFile(join(root, "package.json"), "utf8").catch(() => null),
    ]);
    if (
      !candidates.every((candidate) => {
        if (before === null || candidate === null) return false;
        try {
          return productWorkspacePackageAllowed(JSON.parse(before), JSON.parse(candidate));
        } catch {
          return false;
        }
      })
    )
      findings.push({ path: "package.json", code: "unapproved_workspace_package_patch" });
  }
  if (paths.includes("bun.lock")) {
    const before = await gitFile(root, `${sha}:bun.lock`);
    const candidates = await Promise.all([
      gitFile(root, "HEAD:bun.lock"),
      gitFile(root, ":bun.lock"),
      readFile(join(root, "bun.lock"), "utf8").catch(() => null),
    ]);
    if (
      !candidates.every(
        (candidate) =>
          before !== null && candidate !== null && productWorkspaceLockAllowed(before, candidate),
      )
    )
      findings.push({ path: "bun.lock", code: "unapproved_workspace_lock_patch" });
  }
  if (paths.includes("src/layouts/CaseLayout.astro")) {
    const path = "src/layouts/CaseLayout.astro";
    const before = await gitFile(root, `${sha}:${path}`);
    const candidates = await Promise.all([
      gitFile(root, `HEAD:${path}`),
      gitFile(root, `:${path}`),
      readFile(join(root, path), "utf8").catch(() => null),
    ]);
    if (
      !candidates.every(
        (candidate) =>
          before !== null &&
          candidate !== null &&
          productWorkspaceCaseLayoutAllowed(before, candidate),
      )
    )
      findings.push({ path, code: "unapproved_workspace_case_layout_patch" });
  }
  for (const path of paths.filter((value) => Object.hasOwn(workspaceStyleImports, value))) {
    const before = await gitFile(root, `${sha}:${path}`);
    const candidates = await Promise.all([
      gitFile(root, `HEAD:${path}`),
      gitFile(root, `:${path}`),
      readFile(join(root, path), "utf8").catch(() => null),
    ]);
    if (
      !candidates.every(
        (candidate) =>
          before !== null &&
          candidate !== null &&
          productWorkspacePageAllowed(path, before, candidate),
      )
    )
      findings.push({ path, code: "unapproved_workspace_page_patch" });
  }
  for (const path of paths.filter((value) => selectorFiles.has(value))) {
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
          candidates.map(
            (candidate) =>
              candidate !== null && productWorkspaceSelectorsAllowed(path, before, candidate),
          ),
        )
      ).every(Boolean);
    if (!allowed) findings.push({ path, code: "unapproved_workspace_selector_patch" });
  }
  return { changes: paths.length, findings };
}

if (import.meta.main) {
  if (process.argv.length > 3) throw new Error("PRODUCT_WORKSPACE_EXPECTS_ONE_BASE_REF");
  const result = await checkProductWorkspacePreservation(
    process.cwd(),
    process.argv[2] ?? PRODUCT_WORKSPACE_BASE,
  );
  if (result.findings.length) {
    for (const finding of result.findings) console.error(`${finding.path}: ${finding.code}`);
    process.exitCode = 1;
  } else console.log(`Product workspace preservation passed (${result.changes} changed paths)`);
}
