import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.platform !== "darwin") throw new Error("Apple native transfer probe needs macOS/Swift");
const core = "apps/mobile/modules/baro-private-download/ios/DiskTransferStore.swift";
const entry = "tests/native/mobile-download/main.swift";
const directory = await mkdtemp(join(tmpdir(), "baro-native-network-"));
const binary = join(directory, "probe");
const compiled = Bun.spawn(["swiftc", "-swift-version", "5", "-O", core, entry, "-o", binary], {
  stdout: "inherit",
  stderr: "inherit",
});
if (await compiled.exited) throw new Error("NATIVE_SWIFT_PROBE_COMPILE_FAILED");
const chunk = Uint8Array.from({ length: 65536 }, (_, index) => index % 251);
const hash = (size: number) => {
  const value = createHash("sha256");
  for (let offset = 0; offset < size; offset += chunk.length)
    value.update(chunk.subarray(0, Math.min(chunk.length, size - offset)));
  return value.digest("hex");
};
let unexpectedCookie = false,
  redirected = 0;
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  idleTimeout: 0,
  fetch(request) {
    const url = new URL(request.url);
    const expectedCookie = url.pathname.endsWith("/jar") ? "" : "baro_probe=synthetic_explicit";
    if ((request.headers.get("cookie") ?? "") !== expectedCookie) unexpectedCookie = true;
    if (url.pathname === "/api/target") redirected++;
    if (url.pathname === "/api/redirect")
      return new Response(null, { status: 307, headers: { location: "/api/target" } });
    if (url.pathname === "/api/error")
      return Response.json(
        { error: { code: "UNAUTHENTICATED" } },
        { status: 401, headers: { "set-cookie": "download_probe=synthetic; Path=/" } },
      );
    if (url.pathname === "/api/gzip")
      return new Response(Bun.gzipSync(chunk), {
        headers: { "content-encoding": "gzip", "content-type": "application/octet-stream" },
      });
    if (url.pathname === "/api/post" && request.method !== "POST")
      return new Response(null, { status: 400 });
    const size = Number(url.searchParams.get("size") ?? 100000),
      slow = url.pathname === "/api/slow";
    let sent = 0,
      canceled = false;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (slow) await Bun.sleep(4);
        if (canceled) return;
        if (sent === size) {
          controller.close();
          return;
        }
        const bytes = chunk.subarray(0, Math.min(chunk.length, size - sent));
        sent += bytes.length;
        controller.enqueue(bytes);
      },
      cancel() {
        canceled = true;
      },
    });
    return new Response(body, {
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(size),
        "set-cookie": "download_probe=synthetic; Path=/",
      },
    });
  },
});
type Receipt = {
  success: boolean;
  status: number;
  size: number;
  sha256: string;
  maxCopyBytes: number;
  peakResidentBytes: number;
  remainingFiles: number;
  setCookieReturned: boolean;
  responseCookieStored: boolean;
  errorCodeOnly: boolean;
};
const receipts: { scenario: string; receipt: Receipt }[] = [];
async function probe(scenario: string, path: string, maximum: number, mode = "get") {
  const child = Bun.spawn([binary, server.url.origin, path, String(maximum), mode, directory], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [output, error, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code || error.trim()) throw new Error(`NATIVE_PROBE_FAILED:${scenario}:${code}`);
  const receipt = JSON.parse(output) as Receipt;
  if (receipt.remainingFiles !== 0 || receipt.responseCookieStored || receipt.maxCopyBytes > 65536)
    throw new Error(`NATIVE_PROBE_BOUNDARY_FAILED:${scenario}`);
  receipts.push({ scenario, receipt });
  return receipt;
}
try {
  for (const size of process.argv.includes("--large")
    ? [100_000_000, 1_000_000_000]
    : [1_000_000]) {
    const receipt = await probe(`bytes-${size}`, `/api/bytes?size=${size}`, size);
    if (
      !receipt.success ||
      receipt.size !== size ||
      receipt.sha256 !== hash(size) ||
      !receipt.setCookieReturned ||
      receipt.peakResidentBytes > 192 * 1024 * 1024
    )
      throw new Error("NATIVE_LARGE_BYTES_OR_MEMORY_FAILED");
  }
  for (const [scenario, path, maximum, mode] of [
    ["oversize", "/api/bytes?size=1000000", 65536, "get"],
    ["redirect", "/api/redirect", 100000, "get"],
    ["normalized-path", "/api/%2e%2e/bytes?size=1000", 1000, "get"],
    ["preview-rejects-local", "/api/bytes?size=1000", 1000, "preview-fence"],
    ["cancel", "/api/slow?size=1000000000", 1000000000, "cancel"],
    ["pre-cancel", "/api/bytes?size=1000", 1000, "pre-cancel"],
  ] as const)
    if ((await probe(scenario, path, maximum, mode)).success)
      throw new Error(`NATIVE_REJECTION_FAILED:${scenario}`);
  if (!(await probe("jar", "/api/jar?size=1000", 1000, "jar")).success)
    throw new Error("NATIVE_COOKIE_JAR_FAILED");
  if (!(await probe("startup-orphan", "/api/bytes?size=1000", 1000, "orphan")).success)
    throw new Error("NATIVE_STARTUP_CLEANUP_FAILED");
  const post = await probe("post", "/api/post?size=1000", 1000, "post");
  if (!post.success || post.sha256 !== hash(1000)) throw new Error("NATIVE_POST_FAILED");
  const error = await probe("http-error", "/api/error", 1000);
  if (!error.success || error.status !== 401 || error.size !== 0 || !error.errorCodeOnly)
    throw new Error("NATIVE_ERROR_METADATA_FAILED");
  const gzip = await probe("gzip", "/api/gzip", chunk.length);
  if (!gzip.success || gzip.size !== chunk.length || gzip.sha256 !== hash(chunk.length))
    throw new Error("NATIVE_GZIP_FAILED");
  if (unexpectedCookie || redirected) throw new Error("NATIVE_ORIGIN_OR_COOKIE_LEAK");
  console.log(
    JSON.stringify(
      {
        platform: "macOS-native-core",
        appDeviceAcceptance: false,
        copyBufferBytes: 65536,
        receipts,
      },
      null,
      2,
    ),
  );
} finally {
  server.stop(true);
  await rm(directory, { recursive: true, force: true });
}
