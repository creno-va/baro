import { createHash } from "node:crypto";
import {
  DOWNLOAD_BYTES,
  OWNER_COOKIE,
  PROBE_OWNER,
  probeFailureSchema,
  probeResultSchema,
  productMountSchema,
  type RuntimeConfig,
  runtimeConfigSchema,
  UPLOAD_BYTES,
} from "../apps/mobile/runtime-probe/protocol";

const chunk = new Uint8Array(65536).fill(97);
export function repeatedDigest(length: number) {
  const hash = createHash("sha256");
  for (let offset = 0; offset < length; offset += chunk.length)
    hash.update(chunk.subarray(0, Math.min(chunk.length, length - offset)));
  return hash.digest("hex");
}
const error = (status: number) =>
  Response.json(
    { error: { code: status === 401 ? "UNAUTHENTICATED" : "VALIDATION_ERROR" } },
    { status },
  );
/** Explicit loopback transport fixture. Never impersonates a signed remote API or provider. */
export function createRuntimeFixture(input: RuntimeConfig) {
  const config = runtimeConfigSchema.parse(input);
  const state = {
    sourceSha: config.sourceSha,
    productMount: null as null | { width: number; height: number },
    result: null as null | ReturnType<typeof probeResultSchema.parse>,
    failure: null as null | { code: string },
    upload: null as null | { bytes: number; sha256: string },
    downloadedBytes: 0,
    delayedStarted: false,
    cancelUploadStarted: false,
    cancelUploadBytes: 0,
    rejectedHeaders: 0,
    requestCount: 0,
  };
  const releases = new Set<() => void>();
  const pause = () =>
    new Promise<void>((resolve) => {
      releases.add(resolve);
    });
  const release = () => {
    for (const done of releases) done();
    releases.clear();
  };
  const largeHash = repeatedDigest(DOWNLOAD_BYTES),
    uploadHash = repeatedDigest(UPLOAD_BYTES);
  return {
    state,
    config,
    largeHash,
    uploadHash,
    release,
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (url.origin !== config.origin) return error(400);
      if (url.pathname.startsWith("/probe/")) {
        if (request.headers.get("x-baro-probe-run") !== config.nonce) return error(401);
        if (request.method === "GET" && url.pathname === "/probe/control")
          return Response.json({
            delayedStarted: state.delayedStarted,
            cancelUploadStarted: state.cancelUploadStarted,
            cancelUploadBytes: state.cancelUploadBytes,
          });
        if (request.method === "POST") {
          const raw: unknown = await request.json();
          if (url.pathname === "/probe/release") {
            release();
            return Response.json({ ok: true });
          }
          if (url.pathname === "/probe/mounted") {
            state.productMount = productMountSchema.parse(raw);
            return Response.json({ ok: true });
          }
          if (url.pathname === "/probe/result") {
            const result = probeResultSchema.parse(raw);
            if (
              result.sourceSha !== config.sourceSha ||
              result.upload.sha256 !== uploadHash ||
              result.download.sha256 !== largeHash ||
              state.upload?.sha256 !== uploadHash ||
              state.upload.bytes !== UPLOAD_BYTES ||
              state.downloadedBytes !== DOWNLOAD_BYTES ||
              result.cancelUploadBytesReceived !== state.cancelUploadBytes ||
              !state.delayedStarted ||
              !state.cancelUploadStarted
            )
              return error(400);
            state.result = result;
            return Response.json({ ok: true });
          }
          if (url.pathname === "/probe/failure") {
            state.failure = probeFailureSchema.parse(raw);
            return Response.json({ ok: true });
          }
        }
        return error(404);
      }
      // Product entry remains anonymous; no fixture login or mutation route is added to the product.
      if (request.method === "GET" && url.pathname === "/api/me/session")
        return Response.json({ user: null, needsConsent: false });
      if (!url.pathname.startsWith("/api/v2/")) return error(404);
      state.requestCount++;
      if (
        request.headers.get("cookie") !== OWNER_COOKIE ||
        request.headers.get("origin") !== config.origin ||
        request.headers.get("x-baro-expected-owner") !== PROBE_OWNER
      ) {
        state.rejectedHeaders++;
        return error(401);
      }
      if (request.method === "GET" && url.pathname.endsWith("/unauthorized/content"))
        return error(401);
      if (
        request.method === "PUT" &&
        /^\/api\/v2\/me\/lawyer\/assets\/(upload|cancel)\/content$/.test(url.pathname)
      ) {
        const size = Number(request.headers.get("content-length"));
        if (
          request.headers.get("content-type") !== "application/octet-stream" ||
          request.headers.get("if-match") !== "1" ||
          !request.body ||
          !Number.isSafeInteger(size) ||
          size <= 0 ||
          size > UPLOAD_BYTES
        )
          return error(400);
        const hash = createHash("sha256"),
          reader = request.body.getReader();
        let bytes = 0;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            bytes += part.value.length;
            if (bytes > size) return error(400);
            if (url.pathname.includes("/cancel/")) {
              state.cancelUploadBytes = bytes;
              state.cancelUploadStarted = true;
              await pause();
              await reader.cancel().catch(() => {});
              return error(400);
            }
            hash.update(part.value);
          }
        } catch {
          return error(400);
        } finally {
          reader.releaseLock();
        }
        if (bytes !== size) return error(400);
        state.upload = { bytes, sha256: hash.digest("hex") };
        return Response.json({ ok: true, ...state.upload });
      }
      if (request.method === "GET" && url.pathname.endsWith("/delayed/content")) {
        state.delayedStarted = true;
        await pause();
        return new Response(chunk, {
          headers: {
            "content-type": "application/octet-stream",
            "set-cookie": "better-auth.session_token=fixture-native-retired; Path=/",
          },
        });
      }
      if (request.method === "GET" && url.pathname.endsWith("/download/content")) {
        let offset = 0;
        const body = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (offset === DOWNLOAD_BYTES) {
              controller.close();
              return;
            }
            const bytes = chunk.subarray(0, Math.min(chunk.length, DOWNLOAD_BYTES - offset));
            offset += bytes.length;
            state.downloadedBytes += bytes.length;
            controller.enqueue(bytes);
          },
        });
        return new Response(body, {
          headers: {
            "content-type": "application/octet-stream",
            "content-length": String(DOWNLOAD_BYTES),
          },
        });
      }
      return error(404);
    },
  };
}
