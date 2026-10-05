import { runPipelineFixture } from "../tests/evals/pipeline";
import checksums from "../tests/fixtures/evals/checksums.json";
import corpus from "../tests/fixtures/evals/corpus.json";
import { corpusSchema, fixtureChecksum } from "../tests/helpers/evals";

const parsed = corpusSchema.parse(corpus);
if (fixtureChecksum(corpus) !== checksums.corpus) throw new Error("FIXTURE_CHECKSUM_MISMATCH");
const reports = [];
for (const fixture of parsed.fixtures) {
  const result = await runPipelineFixture(fixture);
  reports.push(result.report);
  result.db.close();
}
const sha = process.env.EVAL_CANDIDATE_SHA ?? "local";
if (!/^(local|[a-f0-9]{40})$/.test(sha)) throw new Error("INVALID_CANDIDATE_SHA");
if (sha !== "local") {
  const child = Bun.spawn(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
  const actual = (await new Response(child.stdout).text()).trim();
  if ((await child.exited) || actual !== sha) throw new Error("EVAL_CANDIDATE_CHECKOUT_MISMATCH");
}
await Bun.write(
  ".wrangler/eval/offline.json",
  JSON.stringify(
    {
      mode: "deterministic-product-pipeline",
      candidateSha: sha,
      corpusVersion: parsed.metadata.version,
      corpusChecksum: checksums.corpus,
      reports,
    },
    null,
    2,
  ),
);
const critical = reports.reduce((sum, r) => sum + r.findings.length, 0);
console.log(
  `Deterministic product pipeline: ${reports.length} fixtures, ${critical} critical findings. Live model quality remains unverified.`,
);
if (critical) process.exitCode = 1;
