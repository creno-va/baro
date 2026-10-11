import { inspectLegalV2 } from "./legal-readiness-v2";

// Run only after credential/approval conditions change. Never execute from an offline check.
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
    report = {
      ...report,
      ...(await inspectLegalV2({ LAW_API_OC: process.env.LAW_API_OC ?? "" }, checkedAt)),
    };
    if (report.status !== "passed") process.exitCode = 1;
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
