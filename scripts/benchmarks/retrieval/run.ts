import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { candidateSource, loadFactory, variants } from "./candidates";
import { runSample, type Shape, scenarios } from "./harness";

const baselineSha = "b6cfdfe3676506bf2b4880af0911138a9b3f107e";
const source = await Bun.file("src/server/modules/legal-retrieval/v2/service.ts").text();
assert.equal(
  source,
  execFileSync("git", ["show", `${baselineSha}:src/server/modules/legal-retrieval/v2/service.ts`], {
    encoding: "utf8",
  }),
  "Pinned retrieval implementation changed; rebase/review benchmark anchors first",
);
const repetitions = Number(process.env.BARO_BENCH_REPEATS ?? 5);
assert.ok(Number.isInteger(repetitions) && repetitions >= 1 && repetitions <= 20);
const rows = [];
const signatures = new Map<string, string>();
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
for (const variant of variants) {
  const factory = await loadFactory(variant);
  // Discard one unmeasured JIT/initialization sample, no corpus iteration.
  await runSample(factory, "cold-single", 0, "article");
  for (const shape of ["article", "full"] as Shape[]) {
    for (const delayMs of [0, 5]) {
      for (const scenario of scenarios) {
        const samples = [];
        for (let i = 0; i < repetitions; i++)
          samples.push(await runSample(factory, scenario, delayMs, shape));
        const first = samples[0];
        assert.ok(first);
        const key = `${shape}:${delayMs}:${scenario}`;
        if (variant === "baseline") signatures.set(key, first.signature);
        assert.equal(first.signature, signatures.get(key), `${variant} output equivalence ${key}`);
        for (const s of samples) {
          assert.equal(s.signature, first.signature);
          for (const counter of [
            "calls",
            "dbQueries",
            "dbReads",
            "dbWrites",
            "upstreamResponseBytes",
            "outputBytes",
            "jsonParses",
            "articleParses",
          ] as const)
            assert.equal(s[counter], first[counter]);
        }
        const { signature: _signature, ...row } = first;
        rows.push({
          variant,
          ...row,
          wallMs: median(samples.map((s) => s.wallMs)),
          waitWallMs: median(samples.map((s) => s.waitWallMs)),
          nonWaitingWallMs: median(samples.map((s) => s.nonWaitingWallMs)),
          upstreamWaitSumMs: median(samples.map((s) => s.upstreamWaitSumMs)),
          injectedLatencyWaitSumMs: median(samples.map((s) => s.injectedLatencyWaitSumMs)),
          timeoutWaitSumMs: median(samples.map((s) => s.timeoutWaitSumMs)),
          wallMinMs: Math.min(...samples.map((s) => s.wallMs)),
          wallMaxMs: Math.max(...samples.map((s) => s.wallMs)),
        });
      }
    }
  }
  console.error(`Completed ${variant}`);
}
const result = {
  baselineSha,
  researchHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  candidateGeneratorSha256: await Bun.CryptoHasher.hash(
    "sha256",
    await Bun.file("scripts/benchmarks/retrieval/candidates.ts").arrayBuffer(),
    "hex",
  ),
  measuredAt: new Date().toISOString(),
  runtime: `Bun ${Bun.version}`,
  platform: `${process.platform}/${process.arch}`,
  repetitions,
  timing:
    "Median local wall time; nonWaitingWallMs subtracts union of injected latency waits and actual timeout deadline waits, not CPU time. Zero-delay success profile has no fake network waits. Backoff configured delays are recorded but virtualized.",
  database:
    "Actual migrated in-memory SQLite via existing D1 adapter; counts are executed statements, not real remote D1 latency. Includes consent/workspace guards/cache/bindings. Setup/priming/integrity checks excluded.",
  responseBytes:
    "UTF-8 supplied upstream bodies including 429 bodies (timeouts 0 bytes); output UTF-8 JSON including random but fixed-length citation IDs. No HTTP headers.",
  fixtures:
    "Three synthetic articles in one synthetic statute. article shape is JO-specific, full shape intentionally repeats a complete synthetic body; neither represents a new live API capture.",
  rows,
};
const destination = resolve(
  process.env.BARO_BENCH_OUTPUT ?? ".wrangler/retrieval-benchmark/results.json",
);
await Bun.write(destination, `${JSON.stringify(result, null, 2)}\n`);
console.log(destination);
// Emit only the recommended product delta, without benchmark instrumentation.
await Bun.write(".wrangler/retrieval-benchmark/service-before.ts", source);
const formatted = Bun.spawnSync(
  [
    process.execPath,
    "x",
    "biome",
    "format",
    "--stdin-file-path=src/server/modules/legal-retrieval/v2/service.ts",
  ],
  { stdin: new TextEncoder().encode(candidateSource(source, "list-dedup")) },
);
assert.equal(formatted.exitCode, 0);
await Bun.write(".wrangler/retrieval-benchmark/service-after.ts", formatted.stdout);
const diff = Bun.spawnSync([
  "diff",
  "-u",
  "--label",
  "a/src/server/modules/legal-retrieval/v2/service.ts",
  "--label",
  "b/src/server/modules/legal-retrieval/v2/service.ts",
  ".wrangler/retrieval-benchmark/service-before.ts",
  ".wrangler/retrieval-benchmark/service-after.ts",
]);
assert.equal(diff.exitCode, 1);
await Bun.write(".wrangler/retrieval-benchmark/list-dedup.patch", diff.stdout);
