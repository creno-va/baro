// Opt-in local protocol proof. Startup-only shims replace /app, native PATH and
// the listen address; the actual ingress/hash/NDJSON/cleanup code is unchanged.
// Fixed synthetic fixtures only, one service and one request at a time.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const repo = resolve(directory, "../..");
const [baselineArg, pythonArg, nativePathArg] = process.argv.slice(2);
assert(baselineArg && pythonArg && nativePathArg, "Pass baseline.py, Python executable and native PATH");
const baseline = resolve(baselineArg);
const python = resolve(pythonArg);
const nativePath = nativePathArg;
const cases = [
  { id: "pdf-text", fixture: "text-two-pages.pdf", action: "process", units: [0, 1] },
  { id: "text-small", fixture: "utf8-markers.txt", action: "process", units: [0] },
  { id: "image-png", fixture: "image-markers.png", action: "process", units: [0] },
  { id: "audio-wav", fixture: "speech-ko.wav", action: "process", units: [0] },
  { id: "video-silent", fixture: "scenes-silent.mp4", action: "process", units: [0] },
  { id: "pdf-sanitize", fixture: "text-two-pages.pdf", action: "sanitize", units: [0] },
];
const temporary = await mkdtemp(join(repo, ".wrangler/performance-http-"));
const source = await readFile(join(directory, "server.mjs"), "utf8");

function startupShim(processor) {
  const replacements = [
    ['spawn("python3",', `spawn(${JSON.stringify(python)},`],
    ['"/app/processor.py"', JSON.stringify(processor)],
    ['PATH: "/usr/bin:/bin"', `PATH: ${JSON.stringify(nativePath)}`],
    ['server.listen(8080, "0.0.0.0");', 'server.listen(0, "127.0.0.1", () => process.stdout.write(JSON.stringify({ port: server.address().port }) + "\\n"));'],
  ];
  let result = source;
  for (const [from, to] of replacements) {
    assert.equal(result.split(from).length, 2, "Startup shim source drift");
    result = result.replace(from, to);
  }
  return result;
}

async function run(processor, label) {
  const script = join(temporary, `${label}.mjs`);
  await writeFile(script, startupShim(processor));
  const child = spawn(process.execPath, [script], {
    stdio: ["ignore", "pipe", "ignore"],
    env: { PATH: nativePath, TMPDIR: temporary, DYLD_FALLBACK_LIBRARY_PATH: process.env.DYLD_FALLBACK_LIBRARY_PATH ?? "" },
  });
  const exited = once(child, "exit");
  const deadline = setTimeout(() => child.kill("SIGTERM"), 30_000);
  try {
    const [chunk] = await Promise.race([
      once(child.stdout, "data", { signal: AbortSignal.timeout(5000) }),
      exited.then(() => { throw new Error("Native loopback server exited before ready"); }),
    ]);
    const { port } = JSON.parse(chunk.toString());
    assert(Number.isInteger(port) && port > 0);
    const results = [];
    for (const test of cases) {
      const input = await readFile(join(repo, "tests/fixtures/media", test.fixture));
      assert(input.length <= 250_000);
      for (const unit of test.units) {
        const started = performance.now();
        const response = await fetch(`http://127.0.0.1:${port}/${test.action}`, {
          method: "POST", body: input, signal: AbortSignal.timeout(10_000), headers: {
            "x-baro-capability": "0".repeat(64), "x-baro-bytes": String(input.length),
            "x-baro-hash": createHash("sha256").update(input).digest("hex"),
            "x-baro-unit": String(unit),
          },
        });
        assert.equal(response.status, 200, "Native loopback request failed");
        const wire = Buffer.from(await response.arrayBuffer());
        assert(wire.length <= 1_000_000);
        const records = wire.toString("utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
        assert.equal(records.at(-1).type, "complete");
        const manifest = records[0].value;
        if (test.action === "process") {
          assert.equal(records[0].type, "manifest");
          assert.equal(manifest.unit, unit);
          assert.equal(records.length, manifest.artifacts.length + 2);
          for (const [index, artifact] of manifest.artifacts.entries()) {
            assert(!("path" in artifact));
            const record = records[index + 1];
            assert.equal(record.type, "artifact");
            assert.equal(record.index, index);
            const bytes = Buffer.from(record.data, "base64");
            assert.equal(bytes.length, artifact.byteLength);
            assert(createHash("sha256").update(bytes).digest("hex") === artifact.contentHash, "Artifact digest mismatch");
          }
        } else {
          assert.equal(records[0].type, "sanitized_manifest");
          assert.equal(manifest.passes, 2);
          assert.equal(records.length, manifest.chunkCount * 2 + 2);
          for (let pass = 0; pass < 2; pass++) {
            const hasher = createHash("sha256");
            let total = 0;
            for (let index = 0; index < manifest.chunkCount; index++) {
              const record = records[1 + pass * manifest.chunkCount + index];
              assert.equal(record.type, "sanitized_chunk");
              assert.equal(record.pass, pass);
              assert.equal(record.index, index);
              const bytes = Buffer.from(record.data, "base64");
              total += bytes.length;
              hasher.update(bytes);
            }
            assert.equal(total, manifest.byteLength);
            assert(hasher.digest("hex") === manifest.contentHash, "Sanitized digest mismatch");
          }
        }
        assert(!(await readdir(temporary)).some((name) => name.startsWith("baro-job-")), "Job directory not cleaned before completion");
        results.push({ case: test.id, unit, wire, wireBytes: wire.length,
                       wallSeconds: (performance.now() - started) / 1000 });
      }
    }
    return results;
  } finally {
    clearTimeout(deadline);
    child.kill("SIGTERM");
    await exited;
  }
}

try {
  const before = await run(baseline, "before");
  const after = await run(join(directory, "processor.py"), "after");
  assert.equal(before.length, after.length);
  const results = before.map((item, index) => {
    assert(item.wire.equals(after[index].wire), "Native HTTP bytes/manifest/coverage mismatch");
    return { case: item.case, unit: item.unit, wireBytes: item.wireBytes,
             beforeWallSeconds: item.wallSeconds, afterWallSeconds: after[index].wallSeconds,
             exactWireEqual: true, cleanupBeforeCompletion: true };
  });
  const report = { syntheticOnly: true, serial: true, repetitions: 1,
                   scope: "local Node ingress + native subprocess + validated NDJSON; startup-only shims; no remote Containers/R2/models",
                   results };
  await writeFile(join(repo, ".wrangler/performance/http-results.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(`Local native HTTP: ${results.length} units, exact wire/coverage/hash/cleanup PASS`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
