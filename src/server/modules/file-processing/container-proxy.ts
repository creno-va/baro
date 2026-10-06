/** Internal-only ingress. Never forward case/session headers into the native service. */
export interface ProcessorContainerPort {
  start(signal: AbortSignal): Promise<void>;
  fetch(request: Request): Promise<Response>;
  stop(): Promise<void>;
}

const maximumBytes = 1_000_000_000;
const failure = (code: string, status: number) =>
  Response.json({ code }, { status, headers: { "cache-control": "no-store" } });

async function nativeFailure(response: Response): Promise<Response> {
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
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "code" in parsed &&
      typeof parsed.code === "string" &&
      ["UNSUPPORTED_FORMAT", "INVALID_MEDIA", "LIMIT", "OUTPUT_LIMIT"].includes(parsed.code)
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
        !["/probe", "/process"].includes(url.pathname) ||
        !bytes ||
        !/^[1-9]\d{0,9}$/.test(bytes) ||
        Number(bytes) > maximumBytes ||
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
  let finished = false;
  const finish = async () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
    controller.abort();
    await port.stop();
  };
  const abort = () => {
    controller.abort();
    void finish().catch(() => {});
  };
  const timer = setTimeout(abort, deadlineMs);
  request.signal.addEventListener("abort", abort, { once: true });
  try {
    if (request.signal.aborted) throw new Error("ABORTED");
    await port.start(controller.signal);
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
    const response = await port.fetch(
      new Request(`http://processor.internal${url.pathname}`, {
        method: request.method,
        headers,
        ...(ready ? {} : { body: request.body }),
        signal: controller.signal,
        redirect: "error",
      }),
    );
    if (!response.ok || !response.body) {
      const error = await nativeFailure(response);
      await finish();
      return response.status === 409 ? failure("BUSY", 409) : error;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (
      !(url.pathname === "/process"
        ? contentType === "application/x-ndjson"
        : contentType.startsWith("application/json"))
    ) {
      await response.body.cancel();
      await finish();
      return failure("INVALID_OUTPUT", 503);
    }
    const reader = response.body.getReader();
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
          } catch {
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
    return failure("PROCESSOR_UNAVAILABLE", 503);
  }
}
