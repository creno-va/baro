import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const MAX_BYTES = 1_000_000_000;
const MAX_LINE = 1_500_000;
let busy = false;
const response = (res, status, code) => {
  if (res.headersSent) return res.destroy();
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify({ code }));
};
export const server = createServer(async (req, res) => {
  if (req.url === "/ready" && req.method === "GET") return response(res, 200, "READY");
  const capability = req.headers["x-baro-capability"];
  const size = Number(req.headers["x-baro-bytes"]);
  const hash = req.headers["x-baro-hash"];
  const unit = Number(req.headers["x-baro-unit"] ?? 0);
  const frameOffset = Number(req.headers["x-baro-frame-offset"] ?? 0);
  // Internal ingress only. Worker DO supplies a fresh per-request capability; no public route.
  if (
    req.method !== "POST" ||
    !["/probe", "/process"].includes(req.url) ||
    typeof capability !== "string" ||
    !/^[a-f0-9]{64}$/.test(capability) ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > MAX_BYTES ||
    !Number.isInteger(frameOffset) || frameOffset < 0 || frameOffset > 10_000_000 || !Number.isInteger(unit) ||
    unit < 0 ||
    unit >= 100_000 ||
    typeof hash !== "string" ||
    !/^[a-f0-9]{64}$/.test(hash)
  )
    return response(res, 400, "INVALID_REQUEST");
  if (busy) return response(res, 409, "BUSY");
  busy = true;
  let root;
  let child;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 240_000);
  res.on("close", () => {
    if (!res.writableFinished) abort.abort();
  });
  const kill = () => {
    if (child?.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    }
  };
  abort.signal.addEventListener("abort", kill, { once: true });
  try {
    root = await mkdtemp(join(tmpdir(), "baro-job-"));
    let received = 0;
    const hasher = createHash("sha256");
    const bounded = new Transform({
      transform(chunk, _encoding, done) {
        received += chunk.length;
        if (received > size) return done(new Error("LIMIT"));
        hasher.update(chunk);
        done(null, chunk);
      },
    });
    await pipeline(req, bounded, createWriteStream(join(root, "input"), { mode: 0o600 }), {
      signal: abort.signal,
    });
    if (received !== size || hasher.digest("hex") !== hash) throw new Error("INVALID_REQUEST");
    child = spawn("python3", ["/app/processor.py", root, req.url.slice(1), String(unit), String(frameOffset)], {
      stdio: ["ignore", "ignore", "ignore"],
      env: { PATH: "/usr/bin:/bin", PYTHONDONTWRITEBYTECODE: "1", HOME: root },
      detached: true,
    });
    const exited = await once(child, "exit", { signal: abort.signal });
    if (exited[0] !== 0) {
      const safe = JSON.parse(await readFile(join(root, "error.json"), "utf8"));
      const code = ["UNSUPPORTED_FORMAT", "INVALID_MEDIA", "LIMIT", "OUTPUT_LIMIT"].includes(
        safe.code,
      )
        ? safe.code
        : "PROCESSING_FAILED";
      return response(res, 422, code);
    }
    const manifestFile = join(root, "manifest.json");
    if ((await stat(manifestFile)).size > MAX_LINE - 100) throw new Error("OUTPUT_LIMIT");
    const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
    if (req.url === "/probe") {
      await rm(root, { recursive: true, force: true });
      root = undefined;
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return res.end(JSON.stringify(manifest));
    }
    res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
    const write = async (value) => {
      const line = JSON.stringify(value) + "\n";
      if (Buffer.byteLength(line) > MAX_LINE || abort.signal.aborted)
        throw new Error("OUTPUT_LIMIT");
      if (!res.write(line)) await once(res, "drain", { signal: abort.signal });
    };
    await write({
      type: "manifest",
      value: { ...manifest, artifacts: manifest.artifacts.map(({ path, ...rest }) => rest) },
    });
    for (const artifact of manifest.artifacts) {
      if (!/^artifact-\d{6}\.(txt|wav|jpg)$/.test(artifact.path) || artifact.byteLength > 1_048_576)
        throw new Error("INVALID_OUTPUT");
      const file = await open(join(root, artifact.path), "r");
      let bytes;
      try {
        bytes = await file.readFile();
      } finally {
        await file.close();
      }
      if (
        bytes.length !== artifact.byteLength ||
        createHash("sha256").update(bytes).digest("hex") !== artifact.contentHash
      )
        throw new Error("INVALID_OUTPUT");
      await write({ type: "artifact", index: artifact.index, data: bytes.toString("base64") });
      bytes.fill(0);
    }
    await rm(root, { recursive: true, force: true });
    root = undefined;
    await write({ type: "complete" });
    res.end();
  } catch {
    kill();
    if (root) await rm(root, { recursive: true, force: true }).catch(() => {});
    root = undefined;
    response(
      res,
      abort.signal.aborted ? 408 : 422,
      abort.signal.aborted ? "TIMEOUT" : "PROCESSING_FAILED",
    );
  } finally {
    clearTimeout(timer);
    kill();
    if (root) await rm(root, { recursive: true, force: true }).catch(() => {});
    busy = false;
  }
});
server.requestTimeout = 250_000;
server.headersTimeout = 10_000;
server.listen(8080, "0.0.0.0");
