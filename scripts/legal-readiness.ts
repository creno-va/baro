import { inspectLegalV2, legalDiagnosticReceipt, legalReadinessScope } from "./legal-readiness-v2";

// Run only after reviewed credential/approval/diagnostic changes. Never execute offline.
if (import.meta.main) {
  const checkedAt = new Date().toISOString();
  const candidateSha = process.env.READINESS_CANDIDATE_SHA ?? "";
  let report: Record<string, unknown> = {
    candidateSha,
    checkedAt,
    environment: "preview-credential-ci-adapter",
    runtimeWorker: false,
    status: "failed",
    requests: 0,
    schemaVersion: "2",
  };
  try {
    if (!/^[a-f0-9]{40}$/.test(candidateSha)) throw new Error();
    if (!process.env.LAW_API_OC) throw new Error();
    const selected = legalReadinessScope(process.env.READINESS_LEGAL_SCOPE ?? "standard");
    const observed = await inspectLegalV2({ LAW_API_OC: process.env.LAW_API_OC }, checkedAt, {
      plans: selected.plans,
    });
    report = {
      ...report,
      ...(selected.scope === "standard" ? observed : legalDiagnosticReceipt(observed)),
      scope: selected.scope,
    };
    if (report.status !== "passed" && report.status !== "diagnostic_passed") process.exitCode = 1;
  } catch {
    process.exitCode = 1;
  }
  await Bun.write(".wrangler/readiness/legal.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify({
      check: "official-v2-source-integrity",
      status: report.status,
      requests: report.requests,
      runtimeWorker: false,
    }),
  );
}
