import type { createDomainRepository } from "../src/server/db/repository";
import {
  createLegalRetrieval,
  type LegalRetrievalDiagnostic,
} from "../src/server/modules/legal-retrieval/service";

// Synthetic concepts, real retrieval/parser, ephemeral cache. No D1 writes or case payloads.
if (import.meta.main) {
  const checkedAt = new Date().toISOString();
  const candidateSha = process.env.READINESS_CANDIDATE_SHA ?? "";
  let requests = 0;
  const report: {
    candidateSha: string;
    checkedAt: string;
    environment: string;
    runtimeWorker: false;
    status: "passed" | "failed";
    requests: number;
    diagnostics: LegalRetrievalDiagnostic[];
    citations: { effectiveDate: string; contentHash: string }[];
  } = {
    candidateSha,
    checkedAt,
    environment: "preview-credential-ci-adapter",
    runtimeWorker: false,
    status: "failed",
    requests: 0,
    diagnostics: [],
    citations: [],
  };
  try {
    if (!/^[a-f0-9]{40}$/.test(candidateSha)) throw new Error();
    const repository = {
      findLatestLegalSource: async () => null,
      putLegalSource: async () => {},
    } as unknown as ReturnType<typeof createDomainRepository>;
    const result = await createLegalRetrieval(
      { LAW_API_OC: process.env.LAW_API_OC ?? "" },
      repository,
      undefined,
      undefined,
      (diagnostic) => report.diagnostics.push(diagnostic),
    ).retrieve(
      ["loan", "interest", "repayment"],
      checkedAt.slice(0, 10),
      checkedAt,
      async () => ++requests <= 4,
    );
    report.status = "passed";
    report.citations = result.chunks.map(({ citation }) => ({
      effectiveDate: citation.effectiveDate,
      contentHash: citation.contentHash,
    }));
  } catch {
    process.exitCode = 1;
  }
  report.requests = requests;
  await Bun.write(".wrangler/readiness/legal.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify({
      check: "official-legal-schema-date-hash",
      status: report.status,
      requests,
      diagnostics: report.diagnostics,
      runtimeWorker: false,
    }),
  );
}
