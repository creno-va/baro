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
    'console.error(JSON.stringify({event:"v2_deletion_cleanup_failed",environment:event.environment,reason:event.reason,attempts:event.attempts,ageSeconds:event.ageSeconds,stage:event.stage,namespace:event.namespace,errorShape:event.errorShape,errorName:event.errorName,messageClass:event.messageClass,codeClass:event.codeClass,httpStatus:event.httpStatus,}),)';
  // Only the reviewed enum-only diagnostics module may emit these exact fields.
  const dependencyLogs = new Set([
    'console.error(JSON.stringify({event:"workspace_dependency_failure",stage:failure?.stage??"unclassified",category:dependencyCategory(error),}),)',
    'console.error(JSON.stringify({event:"workspace_provider_failure",phase,category,httpStatus}),)',
    'console.error(JSON.stringify({event:"workspace_legal_retrieval",kind,availability,reason}))',
    'console.error(JSON.stringify({event:"workspace_policy_failure",reason}))',
    'console.error(JSON.stringify({event:"workspace_fact_failure",stage,category,attribution,referenceKind,factCount,referenceCount,availableSourceCount,}),)',
    'console.error(JSON.stringify({event:"model_cost_observation_failure",phase,category}))',
    'console.error(JSON.stringify({event:"cost_observation_failure",phase:"month_bucket",category}),)',
  ]);
  const reportDependencyLog =
    'console.error(JSON.stringify({event:"report_dependency_failure",stage,category,code}))';
  const fileProcessorLog =
    'console.error(JSON.stringify({event:"file_processor_failure",stage,category,durationMs,httpStatus}),)';
  // Reviewed preview timing serializer emits only a bounded numeric/enum header.
  const previewD1TimingLog =
    'console.info(JSON.stringify({event:"preview_d1_timing",measurements:timing}))';
  const previewFileRuntimeLog =
    'console.info(JSON.stringify({event:"preview_file_runtime_d1",phase:"runtime_admission",outcome,wallMs,sqlMs,region,colo,primary,attempts,}),)';
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
              dependencyLogs.has(call.getText(source).replace(/\s+/g, ""))) ||
            (file.replaceAll("\\", "/") === "src/server/modules/reports/diagnostics.ts" &&
              call.getText(source).replace(/\s+/g, "") === reportDependencyLog) ||
            (file.replaceAll("\\", "/") ===
              "src/server/modules/file-processing/container-diagnostics.ts" &&
              call.getText(source).replace(/\s+/g, "") === fileProcessorLog) ||
            (file.replaceAll("\\", "/") === "src/server/api/v2/workspaces.ts" &&
              call.getText(source).replace(/\s+/g, "") === previewD1TimingLog) ||
            (file.replaceAll("\\", "/") ===
              "src/server/modules/file-processing/runtime-admission-observation.ts" &&
              call.getText(source).replace(/\s+/g, "") === previewFileRuntimeLog))
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
