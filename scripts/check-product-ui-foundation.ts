import { lstat, readdir, readFile } from "node:fs/promises";
import { extname, join, posix } from "node:path";
import ts from "typescript";

/** Acceptance for the initial isolated foundation PR, not a permanent scope gate
 * for later feature ports. This supplements the existing runtime/security gates. */
export const FOUNDATION_ROOT_SELECTOR = "[data-product-ui]";
export type FoundationChange = { path: string; status: string; existedAtBase: boolean };
export type FoundationFinding = { path: string; code: string };

export function repositoryPath(value: string): string | null {
  const path = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    !path ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    [...path].some((character) => character.charCodeAt(0) < 32) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    return null;
  return path;
}

export function foundationChangeFindings(
  changes: readonly FoundationChange[],
): FoundationFinding[] {
  return changes.flatMap((change) => {
    const path = repositoryPath(change.path);
    if (!path) return [{ path: change.path, code: "invalid_repository_path" }];
    if (
      path.startsWith("docs/") ||
      path.startsWith("src/product-ui/") ||
      ["package.json", "bun.lock", "astro.config.ts", "scripts/validate.ts"].includes(path)
    )
      return [];
    const newToolOrTest =
      /^tests\/product-ui-[A-Za-z0-9._-]+\.test\.tsx?$/.test(path) ||
      /^tests\/browser\/product-ui-foundation[A-Za-z0-9._-]*\.ts$/.test(path) ||
      /^scripts\/product-ui-[A-Za-z0-9._-]+\.ts$/.test(path) ||
      [
        "scripts/check-product-ui-foundation.ts",
        "scripts/measure-web-query-baseline.ts",
        "tests/helpers/product-ui-page.astro",
        "tests/helpers/product-ui-fixture.tsx",
        "tests/helpers/product-ui-fixture.css",
      ].includes(path);
    return newToolOrTest && !change.existedAtBase && change.status === "A"
      ? []
      : [{ path, code: "outside_initial_foundation_scope" }];
  });
}

const designRoute = `                injectRoute({
                  pattern: "/__design-system",
                  entrypoint: fileURLToPath(
                    new URL("./tests/helpers/design-system-page.astro", import.meta.url),
                  ),
                });`;
export const productUIFixtureRoute = `                injectRoute({
                  pattern: "/__product-ui",
                  entrypoint: fileURLToPath(
                    new URL("./tests/helpers/product-ui-page.astro", import.meta.url),
                  ),
                });`;

export function foundationConfigAllowed(base: string, candidate: string): boolean {
  return (
    candidate === base ||
    (base.split(designRoute).length === 2 &&
      candidate === base.replace(designRoute, `${designRoute}\n${productUIFixtureRoute}`))
  );
}

export function foundationValidationAllowed(base: string, candidate: string): boolean {
  const anchor = '      "tests/rework-",';
  return (
    candidate === base ||
    (base.split(anchor).length === 2 &&
      candidate === base.replace(anchor, `${anchor}\n      "tests/product-ui-",`))
  );
}

const packageAdditions: Record<string, Record<string, readonly string[]>> = {
  dependencies: {
    "@tanstack/react-query": ["5.107.1"],
    zustand: ["5.1.0"],
  },
  scripts: {
    "product-ui:check": [
      "bun scripts/check-product-ui-foundation.ts",
      "bun scripts/check-product-ui-foundation.ts && bun test tests/product-ui-",
    ],
    "product-ui:measure": ["bun scripts/measure-web-query-baseline.ts"],
  },
};
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function sameJSON(first: unknown, second: unknown): boolean {
  if (Array.isArray(first) && Array.isArray(second))
    return first.length === second.length && first.every((value, i) => sameJSON(value, second[i]));
  if (record(first) && record(second))
    return (
      Object.keys(first).length === Object.keys(second).length &&
      Object.keys(first).every(
        (key) => Object.hasOwn(second, key) && sameJSON(first[key], second[key]),
      )
    );
  return Object.is(first, second);
}
export function foundationPackageAllowed(base: unknown, candidate: unknown): boolean {
  if (!record(base) || !record(candidate)) return false;
  const remaining = structuredClone(candidate);
  for (const [section, additions] of Object.entries(packageAdditions)) {
    if (!record(remaining[section]) || !record(base[section])) return false;
    const next = remaining[section];
    const prior = base[section];
    for (const [key, values] of Object.entries(additions)) {
      if (Object.hasOwn(prior, key) || !Object.hasOwn(next, key)) continue;
      if (typeof next[key] !== "string" || !values.includes(next[key])) return false;
      delete next[key];
    }
  }
  return sameJSON(base, remaining);
}

/** Tokens-only grammar: scoped root/attribute variants and custom properties.
 * It intentionally rejects general CSS rather than trying to prove it safe. */
export function foundationTokenCSSFindings(css: string): string[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const findings = new Set<string>();
  const rules = [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  if (!rules.length || source.replace(/([^{}]+)\{([^{}]*)\}/g, "").trim())
    findings.add("unsupported_token_stylesheet");
  for (const rule of rules) {
    const selectors = rule[1] ?? "";
    for (const selector of selectors.split(",")) {
      if (!/^\[data-product-ui\](?:\[data-[a-z0-9-]+(?:="[a-z0-9_-]+")?\])*$/.test(selector.trim()))
        findings.add("unscoped_token_selector");
    }
    for (const declaration of (rule[2] ?? "").split(";")) {
      if (!declaration.trim()) continue;
      const match = /^\s*--[a-z][a-z0-9-]*\s*:\s*(\S[\s\S]*)$/.exec(declaration);
      if (!match) findings.add("non_token_declaration");
      else if (/[@\\{}]|\b(?:url|expression)\s*\(/i.test(match[1] ?? ""))
        findings.add("unsupported_token_value");
    }
  }
  return [...findings];
}

const allowedModules = new Set([
  "react",
  "react/jsx-runtime",
  "react-dom",
  "@headlessui/react",
  "@tanstack/react-query",
  "zustand",
  "zustand/vanilla",
  "zod",
  "lucide-react",
  "clsx",
  "tailwind-merge",
  "class-variance-authority",
]);
function scriptParts(file: string, content: string): string[] {
  if (!file.endsWith(".astro")) return [content];
  return [
    /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1] ?? "",
    ...[...content.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? ""),
  ];
}
function importReferences(file: string, content: string) {
  const imports: string[] = [];
  let dynamic = false;
  for (const part of scriptParts(file, content)) {
    const source = ts.createSourceFile(file, part, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      )
        imports.push(node.moduleSpecifier.text);
      if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression &&
        ts.isStringLiteralLike(node.moduleReference.expression)
      )
        imports.push(node.moduleReference.expression.text);
      if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteralLike(node.argument.literal)
      )
        imports.push(node.argument.literal.text);
      if (ts.isCallExpression(node)) {
        const moduleCall =
          node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === "require");
        if (moduleCall) {
          const argument = node.arguments[0];
          if (argument && ts.isStringLiteralLike(argument)) imports.push(argument.text);
          else dynamic = true;
        }
        if (/^import\.meta\.glob/.test(node.expression.getText(source))) dynamic = true;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { imports, dynamic };
}
function importPath(file: string, specifier: string): string | null {
  const source = specifier.replaceAll("\\", "/");
  if (source.startsWith("@/")) return posix.normalize(`src/${source.slice(2)}`);
  if (source.startsWith("."))
    return posix.normalize(posix.join(posix.dirname(file.replaceAll("\\", "/")), source));
  return null;
}
export function foundationImportFindings(file: string, content: string): string[] {
  const findings = new Set<string>();
  const references = importReferences(file, content);
  if (references.dynamic) findings.add("non_static_module_graph");
  for (const specifier of references.imports) {
    const local = importPath(file, specifier);
    if (local ? !local.startsWith("src/product-ui/") : !allowedModules.has(specifier))
      findings.add("foundation_import_outside_isolated_root");
  }
  for (const part of scriptParts(file, content)) {
    const source = ts.createSourceFile(file, part, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (
        ts.isIdentifier(node) &&
        ["fetch", "XMLHttpRequest", "WebSocket", "EventSource"].includes(node.text)
      )
        findings.add("foundation_network_runtime");
      if (
        file === "src/product-ui/state.ts" &&
        ts.isIdentifier(node) &&
        ["localStorage", "sessionStorage", "indexedDB"].includes(node.text)
      )
        findings.add("ui_store_persistence");
      if (
        file === "src/product-ui/state.ts" &&
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "productUIStateSchema"
      ) {
        const init = node.initializer;
        const object = init && ts.isCallExpression(init) ? init.arguments[0] : undefined;
        if (!object || !ts.isObjectLiteralExpression(object))
          findings.add("ui_store_schema_not_explicit");
        else
          for (const property of object.properties) {
            const key = property.name;
            if (
              !ts.isPropertyAssignment(property) ||
              !key ||
              !(ts.isIdentifier(key) || ts.isStringLiteralLike(key)) ||
              !["sidebarCollapsed", "mobileNavigationOpen", "activePanel", "theme"].includes(
                key.text,
              )
            )
              findings.add("ui_store_non_display_field");
          }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return [...findings];
}

export function activeFoundationImportFindings(file: string, content: string): string[] {
  return importReferences(file, content).imports.some((specifier) =>
    importPath(file, specifier)?.startsWith("src/product-ui/"),
  )
    ? ["foundation_wired_into_active_entry"]
    : [];
}

async function git(root: string, args: string[]): Promise<string> {
  const child = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [output] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if ((await child.exited) !== 0) throw new Error("FOUNDATION_GIT_READ_FAILED");
  return output;
}
export async function collectFoundationChanges(
  root: string,
  base: string,
): Promise<FoundationChange[]> {
  const sha = (
    await git(root, ["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`])
  ).trim();
  const fields = (await git(root, ["diff", "--name-status", "--no-renames", "-z", sha, "--"]))
    .split("\0")
    .filter(Boolean);
  const changes: FoundationChange[] = [];
  for (let index = 0; index < fields.length; index += 2) {
    const status = fields[index];
    const path = fields[index + 1];
    if (!status || !path) throw new Error("FOUNDATION_GIT_DIFF_INVALID");
    changes.push({ path, status, existedAtBase: status !== "A" });
  }
  for (const path of (await git(root, ["ls-files", "--others", "--exclude-standard", "-z"]))
    .split("\0")
    .filter(Boolean))
    changes.push({ path, status: "A", existedAtBase: false });
  return changes;
}

async function sources(root: string, directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    const path = posix.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("FOUNDATION_SOURCE_SYMLINK_REJECTED");
    if (entry.isDirectory()) files.push(...(await sources(root, path)));
    else if ([".ts", ".tsx", ".astro", ".css"].includes(extname(path))) files.push(path);
  }
  return files;
}
export async function checkProductUIFoundation(root: string, base = "origin/main") {
  const changes = await collectFoundationChanges(root, base);
  const findings = foundationChangeFindings(changes);
  for (const path of ["package.json", "astro.config.ts", "scripts/validate.ts"]) {
    if (!changes.some((change) => change.path === path)) continue;
    const before = await git(root, ["show", `${base}:${path}`]);
    const after = await readFile(join(root, path), "utf8");
    const allowed =
      path === "package.json"
        ? foundationPackageAllowed(JSON.parse(before), JSON.parse(after))
        : path === "astro.config.ts"
          ? foundationConfigAllowed(before, after)
          : foundationValidationAllowed(before, after);
    if (!allowed) findings.push({ path, code: "unapproved_foundation_integration_patch" });
  }
  for (const path of await sources(root, "src")) {
    const content = await readFile(join(root, path), "utf8");
    const own = path.startsWith("src/product-ui/");
    const codes =
      extname(path) === ".css"
        ? own
          ? foundationTokenCSSFindings(content)
          : []
        : own
          ? foundationImportFindings(path, content)
          : activeFoundationImportFindings(path, content);
    for (const code of codes) findings.push({ path, code });
  }
  // Git detects protected tracked asset changes by blob/mode metadata. Assets
  // never need to be read into this process to prove this PR leaves them alone.
  return { changes: changes.length, findings };
}

if (import.meta.main) {
  const base = process.argv[2] ?? "origin/main";
  if (process.argv.length > 3) throw new Error("FOUNDATION_EXPECTS_ONE_BASE_REF");
  await lstat(join(process.cwd(), ".git"));
  const result = await checkProductUIFoundation(process.cwd(), base);
  if (result.findings.length) {
    for (const finding of result.findings) console.error(`${finding.path}: ${finding.code}`);
    process.exitCode = 1;
  } else
    console.log(
      `Initial isolated product UI foundation boundary passed (${result.changes} changed paths)`,
    );
}
