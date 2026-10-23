import { posix } from "node:path";
import ts from "typescript";

const forbiddenGlobals = new Set([
  "window",
  "document",
  "localStorage",
  "sessionStorage",
  "Bun",
  "D1Database",
]);

export function sourceImports(source: string): string[] {
  const file = ts.createSourceFile(
    "source.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const imports: string[] = [];
  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      imports.push(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) imports.push(arg.text);
      else imports.push("<dynamic-module>");
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return imports;
}

export function mobileBoundaryFindings(path: string, source: string): string[] {
  const findings: string[] = [];
  const contract = path.startsWith("src/contracts/");
  const shared = path.startsWith("packages/");
  for (const specifier of sourceImports(source)) {
    if ((shared || path.startsWith("apps/mobile/")) && specifier.startsWith(".")) {
      const prefix = shared ? `${path.split("/").slice(0, 2).join("/")}/src/` : "apps/mobile/";
      const target = posix.normalize(posix.join(posix.dirname(path), specifier));
      if (!target.startsWith(prefix)) findings.push("relative import escapes its workspace source");
    }
    if (specifier === "@baro/contracts")
      findings.push("use explicit public contract subpaths; package root is legacy-only");
    if (
      specifier === "<dynamic-module>" ||
      specifier.startsWith("node:") ||
      /^(?:fs|path|child_process|bun:|cloudflare:)/.test(specifier) ||
      /(?:server|workflows|fixtures|client\/api)(?:\/|$)/.test(specifier)
    )
      findings.push(`forbidden import: ${specifier}`);
    if (contract && !specifier.startsWith(".") && specifier !== "zod")
      findings.push(`nonportable contract import: ${specifier}`);
    if (
      shared &&
      !specifier.startsWith(".") &&
      specifier !== "zod" &&
      !specifier.startsWith("@baro/contracts/") &&
      specifier !== "@baro/client-core"
    )
      findings.push(`nonportable shared import: ${specifier}`);
    if (contract && /(?:^|\/)pipeline(?:\.|$)/.test(specifier))
      findings.push("internal pipeline entered public contract graph");
    if (
      path.startsWith("apps/mobile/src/") &&
      specifier.includes("contracts") &&
      !specifier.startsWith("@baro/contracts")
    )
      findings.push("mobile contracts must use package exports");
  }
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(node: ts.Node) {
    if (ts.isIdentifier(node) && forbiddenGlobals.has(node.text))
      findings.push(`platform global: ${node.text}`);
    if (
      shared &&
      ts.isIdentifier(node) &&
      ["fetch", "XMLHttpRequest", "FormData"].includes(node.text)
    )
      findings.push(`shared IO must use an adapter: ${node.text}`);
    if (ts.isIdentifier(node) && node.text === "process") {
      const parent = node.parent;
      const expression = parent?.parent;
      const allowed =
        ts.isPropertyAccessExpression(parent) &&
        ts.isPropertyAccessExpression(expression) &&
        ((path === "apps/mobile/src/composition/config.ts" &&
          ["process.env.EXPO_PUBLIC_APP_ENV", "process.env.EXPO_PUBLIC_API_URL"].includes(
            expression.getText(file),
          )) ||
          (path === "apps/mobile/runtime-probe/run.ts" &&
            [
              "process.env.EXPO_PUBLIC_NATIVE_PROBE_SOURCE_SHA",
              "process.env.EXPO_PUBLIC_NATIVE_PROBE_NONCE",
            ].includes(expression.getText(file))));
      if (!allowed) findings.push("Node process outside Expo public config replacement");
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return [...new Set(findings)];
}
