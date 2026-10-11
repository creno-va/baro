import ts from "typescript";

// A conservative source gate, not a proof of safety or a general-purpose SAST.
export function productBoundaryFindings(file: string, content: string): string[] {
  const findings: string[] = [];
  const source = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const approvedLog =
    'console.error(JSON.stringify({event:"deletion_cleanup_failed",jobId:row.id,attempts:Math.min(attempt,CLEANUP_ATTEMPTS),}),)';
  const v2DeletionLog =
    'console.error(JSON.stringify({event:"v2_deletion_cleanup_failed",environment:event.environment,reason:event.reason,attempts:event.attempts,ageSeconds:event.ageSeconds,}),)';
  // Only the reviewed enum-only diagnostics module may emit these exact fields.
  const dependencyLogs = new Set([
    'console.error(JSON.stringify({event:"workspace_dependency_failure",stage:failure?.stage??"unclassified",category:dependencyCategory(error),}),)',
    'console.error(JSON.stringify({event:"workspace_provider_failure",phase,category,httpStatus}),)',
  ]);
  function visit(node: ts.Node) {
    if (ts.isStringLiteralLike(node)) {
      const value = node.text;
      // Also catches require(), dynamic import(), and aliased import sources.
      if (
        /^(?:node:)?(?:fs(?:\/promises)?|child_process|process|cluster|worker_threads|bun:sqlite)$/.test(
          value,
        )
      )
        findings.push("development_runtime_import");
      if (/(?:^|\/)(?:tests|fixtures)\//.test(value)) findings.push("fixture_import");
    }
    if (
      ts.isIdentifier(node) &&
      [
        "Bun",
        "process",
        "MOCK_AUTH",
        "TEST_USER_ID",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
      ].includes(node.text)
    )
      findings.push("runtime_or_auth_bypass");
    // Forbid references as well as calls, so aliases/destructuring/computed access fail.
    if (ts.isIdentifier(node) && ["console", "logger"].includes(node.text)) {
      const parent = node.parent;
      const call = parent?.parent;
      if (
        ts.isPropertyAssignment(parent) &&
        parent.name === node &&
        parent.getText(source).replace(/\s+/g, "") === "logger:{disabled:true}"
      )
        return;
      if (
        !(
          ts.isCallExpression(call) &&
          ((file.replaceAll("\\", "/") === "src/server/modules/deletion/service.ts" &&
            call.getText(source).replace(/\s+/g, "") === approvedLog) ||
            (file.replaceAll("\\", "/") === "src/server/modules/deletion/v2-reconcile.ts" &&
              call.getText(source).replace(/\s+/g, "") === v2DeletionLog) ||
            (file.replaceAll("\\", "/") === "src/server/dependency-diagnostics.ts" &&
              dependencyLogs.has(call.getText(source).replace(/\s+/g, ""))))
        )
      )
        findings.push("unapproved_payload_log");
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (/collectLog:\s*true|skipCache:\s*false|store:\s*true/.test(content))
    findings.push("provider_payload_logging_or_cache");
  return [...new Set(findings)];
}
