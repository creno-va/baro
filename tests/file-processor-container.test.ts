import { expect, test } from "bun:test";
import {
  type ProcessorContainerPort,
  proxyProcessorRequest,
} from "../src/server/modules/file-processing/container-proxy";

function ingress(path = "/process", extra: Record<string, string> = {}) {
  return new Request(`https://internal${path}`, {
    method: "POST",
    headers: {
      "x-baro-bytes": "3",
      "x-baro-hash": "a".repeat(64),
      "x-baro-unit": "2",
      cookie: "synthetic-session",
      authorization: "synthetic-auth",
      "x-case-id": "synthetic-case",
      ...extra,
    },
    body: new Uint8Array([1, 2, 3]),
  });
}
function port(response: Response) {
  const calls = { start: 0, stop: 0, incoming: null as Request | null };
  const adapter: ProcessorContainerPort = {
    async start() {
      calls.start++;
    },
    async fetch(request) {
      calls.incoming = request;
      return response;
    },
    async stop() {
      calls.stop++;
    },
  };
  return { calls, adapter };
}

test("invalid paths, URLs and source bounds never start a native instance", async () => {
  for (const request of [
    ingress("/anything"),
    ingress("/process?url=https://external"),
    ingress("/probe", { "x-baro-bytes": "1000000001" }),
    ingress("/process", { "x-baro-unit": "-1" }),
    ingress("/process", { "x-baro-hash": "invalid" }),
  ]) {
    const { calls, adapter } = port(new Response());
    expect((await proxyProcessorRequest(request, adapter)).status).toBe(400);
    expect(calls.start).toBe(0);
    expect(calls.stop).toBe(0);
  }
});

test("only protocol headers reach native service; shutdown waits for stream completion", async () => {
  const { calls, adapter } = port(
    new Response('{"type":"complete"}\n', {
      headers: { "content-type": "application/x-ndjson", "set-cookie": "unsafe" },
    }),
  );
  const result = await proxyProcessorRequest(ingress(), adapter);
  expect(calls.stop).toBe(0);
  const incoming = calls.incoming as unknown as Request;
  expect(incoming.url).toBe("http://processor.internal/process");
  expect(incoming.headers.get("x-baro-unit")).toBe("2");
  expect(incoming.headers.get("x-baro-capability")).toMatch(/^[a-f0-9]{64}$/);
  for (const name of ["cookie", "authorization", "x-case-id"])
    expect(incoming.headers.has(name)).toBe(false);
  expect(result.headers.has("set-cookie")).toBe(false);
  expect(result.headers.get("cache-control")).toBe("no-store");
  await result.text();
  expect(calls.stop).toBe(1);
});

test("response cancellation stops native instance and discards remaining material", async () => {
  let cancelled = false;
  const { calls, adapter } = port(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "content-type": "application/x-ndjson" } },
    ),
  );
  const result = await proxyProcessorRequest(ingress(), adapter);
  await result.body?.cancel();
  expect(cancelled).toBe(true);
  expect(calls.stop).toBe(1);
});

test("expired attempt stops before any late output is released", async () => {
  const { calls, adapter } = port(
    new Response("late", {
      headers: { "content-type": "application/x-ndjson" },
    }),
  );
  const result = await proxyProcessorRequest(ingress(), adapter, 5);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await expect(result.text()).rejects.toThrow("PROCESSOR_UNAVAILABLE");
  expect(calls.stop).toBe(1);
});

test("only bounded native error codes survive; payload and stack never leave adapter", async () => {
  for (const [raw, status, code] of [
    [JSON.stringify({ code: "UNSUPPORTED_FORMAT", detail: "private" }), 422, "UNSUPPORTED_FORMAT"],
    [JSON.stringify({ code: "secret", stack: "private" }), 503, "PROCESSOR_UNAVAILABLE"],
    ["x".repeat(1025), 503, "INVALID_OUTPUT"],
  ] as const) {
    const { calls, adapter } = port(new Response(raw, { status: 422 }));
    const result = await proxyProcessorRequest(ingress(), adapter);
    expect(result.status).toBe(status);
    expect(await result.text()).toBe(JSON.stringify({ code }));
    expect(calls.stop).toBe(1);
  }
});

test("failed startup returns sanitized retryable result and stops instance", async () => {
  const { calls, adapter } = port(new Response());
  adapter.start = async () => {
    throw new Error("private stack and input");
  };
  const result = await proxyProcessorRequest(ingress(), adapter);
  expect(result.status).toBe(503);
  expect(await result.text()).toBe(JSON.stringify({ code: "PROCESSOR_UNAVAILABLE" }));
  expect(calls.stop).toBe(1);
});
