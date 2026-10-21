import { processorStage, reportProcessorFailure } from "./container-diagnostics";
import { definitiveRejectionSchema } from "./protocol";

/** Internal-only ingress. Never forward case/session headers into the native service. */
export interface ProcessorContainerPort {
  start(signal: AbortSignal): Promise<void>;
  fetch(request: Request): Promise<Response>;
  stop(): Promise<void>;
}

const maximumBytes = 1_000_000_000;
const failure = (code: string, status: number) =>
  Response.json({ code }, { status, headers: { "cache-control": "no-store" } });

async function nativeFailure(response: Response, probe: boolean): Promise<Response> {
  const reader = response.body?.getReader();
  try {
    if (response.status !== 422 || !reader) return failure("PROCESSOR_UNAVAILABLE", 503);
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 1024) return failure("INVALID_OUTPUT", 503);
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const rejection = definitiveRejectionSchema.safeParse(parsed);
    if (
      probe &&
      !response.redirected &&
      response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ===
        "application/json" &&
      rejection.success
    )
      return Response.json(rejection.data, {
        status: 422,
        headers: { "cache-control": "no-store" },
      });
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "code" in parsed &&
      typeof parsed.code === "string" &&
      [
        "UNSUPPORTED_FORMAT",
        "UNSUPPORTED_TIMELINE",
        "INVALID_UNIT",
        "INVALID_MEDIA",
        "LIMIT",
        "OUTPUT_LIMIT",
      ].includes(parsed.code)
    )
      return failure(parsed.code, 422);
    return failure("PROCESSOR_UNAVAILABLE", 503);
  } catch {
    return failure("INVALID_OUTPUT", 503);
  } finally {
    await reader?.cancel().catch(() => {});
  }
}

export async function proxyProcessorRequest(
  request: Request,
  port: ProcessorContainerPort,
  deadlineMs = 265_000,
  lifecycleSignal?: AbortSignal,
): Promise<Response> {
  const url = new URL(request.url);
  const ready = request.method === "GET" && url.pathname === "/ready";
  const bytes = request.headers.get("x-baro-bytes");
  const hash = request.headers.get("x-baro-hash");
  const unit = request.headers.get("x-baro-unit");
  const frameOffset = request.headers.get("x-baro-frame-offset");
  if (
    url.search ||
    (!ready &&
      (request.method !== "POST" ||
        !["/probe", "/process", "/sanitize", "/report"].includes(url.pathname) ||
        !bytes ||
        !/^[1-9]\d{0,9}$/.test(bytes) ||
        Number(bytes) > maximumBytes ||
        (url.pathname === "/sanitize" && Number(bytes) > 100_000_000) ||
        (url.pathname === "/report" && Number(bytes) > 20_000_000) ||
        !hash ||
        !/^[a-f0-9]{64}$/.test(hash) ||
        !request.body ||
        (unit !== null && !/^(?:0|[1-9]\d{0,5})$/.test(unit)) ||
        (frameOffset !== null &&
          (!/^(?:0|[1-9]\d{0,7})$/.test(frameOffset) || Number(frameOffset) > 10_000_000))))
  ) {
    return failure("INVALID_REQUEST", 400);
  }
  const controller = new AbortController();
  const signal = lifecycleSignal
    ? AbortSignal.any([request.signal, lifecycleSignal])
    : request.signal;
  let finished = false;
  const finish = async () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    controller.abort();
    await processorStage("cleanup", () => port.stop());
  };
  const abort = () => {
    controller.abort();
    void finish().catch(() => {});
  };
  const timer = setTimeout(abort, deadlineMs);
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) throw new Error("ABORTED");
    await processorStage("startup", () => port.start(controller.signal));
    if (controller.signal.aborted) {
      // Cancellation may have stopped the instance before a delayed startup
      // completed. Stop that late instance too, before dispatching any material.
      await port.stop();
      throw new Error("ABORTED");
    }
    const headers = new Headers();
    if (!ready) {
      headers.set("content-type", "application/octet-stream");
      headers.set("x-baro-bytes", bytes as string);
      headers.set("x-baro-hash", hash as string);
      headers.set(
        "x-baro-capability",
        Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join(""),
      );
      if (unit !== null) headers.set("x-baro-unit", unit);
      if (frameOffset !== null) headers.set("x-baro-frame-offset", frameOffset);
    }
    const responseStarted = performance.now();
    const response = await processorStage("dispatch", () =>
      port.fetch(
        new Request(`http://processor.internal${url.pathname}`, {
          method: request.method,
          headers,
          ...(ready ? {} : { body: request.body }),
          signal: controller.signal,
          // Workers supports manual/follow. Surface redirects to the !ok
          // rejection below without forwarding private material to another URL.
          redirect: "manual",
        }),
      ),
    );
    if (!response.ok || !response.body) {
      reportProcessorFailure(
        "response",
        new Error("NATIVE_RESPONSE_FAILED"),
        performance.now() - responseStarted,
        response.status,
      );
      const error = await nativeFailure(response, url.pathname === "/probe");
      if (controller.signal.aborted) throw new Error("ABORTED");
      await finish();
      if (signal.aborted) throw new Error("ABORTED");
      return response.status === 409 ? failure("BUSY", 409) : error;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (
      !(url.pathname === "/report"
        ? contentType === "application/pdf"
        : ["/process", "/sanitize"].includes(url.pathname)
          ? contentType === "application/x-ndjson"
          : contentType.startsWith("application/json"))
    ) {
      reportProcessorFailure(
        "response",
        new Error("INVALID_OUTPUT"),
        performance.now() - responseStarted,
      );
      await response.body.cancel();
      await finish();
      return failure("INVALID_OUTPUT", 503);
    }
    const reader = response.body.getReader();
    const streamStarted = performance.now();
    const body = new ReadableStream<Uint8Array>(
      {
        async pull(stream) {
          try {
            if (controller.signal.aborted) throw new Error("ABORTED");
            const next = await reader.read();
            if (controller.signal.aborted) throw new Error("ABORTED");
            if (next.done) {
              await finish();
              stream.close();
            } else stream.enqueue(next.value);
          } catch (error) {
            reportProcessorFailure("stream", error, performance.now() - streamStarted);
            await reader.cancel().catch(() => {});
            await finish().catch(() => {});
            stream.error(new Error("PROCESSOR_UNAVAILABLE"));
          }
        },
        async cancel() {
          controller.abort();
          await reader.cancel().catch(() => {});
          await finish();
        },
      },
      { highWaterMark: 0 },
    );
    return new Response(body, {
      headers: { "content-type": contentType, "cache-control": "no-store" },
    });
  } catch {
    await finish().catch(() => {});
    // Startup may fail before fetch ever takes ownership of this private stream.
    // Release its upstream RPC/read resources after stopping native work; an
    // already-forwarded locked stream remains governed by controller.abort().
    if (request.body && !request.body.locked) await request.body.cancel().catch(() => {});
    return failure("PROCESSOR_UNAVAILABLE", 503);
  }
}
