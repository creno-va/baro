import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { productBoundaryFindings } from "../scripts/product-boundaries";
import {
  processorFailureCategory,
  reportProcessorFailure,
} from "../src/server/modules/file-processing/container-diagnostics";
import { createProcessorLifecycle } from "../src/server/modules/file-processing/container-lifecycle";

const log = spyOn(console, "error");
afterEach(() => log.mockClear());
afterAll(() => log.mockRestore());

test("only the reviewed container diagnostic file may log its exact sanitized fields", async () => {
  const path = "src/server/modules/file-processing/container-diagnostics.ts";
  const source = await Bun.file(path).text();
  expect(productBoundaryFindings(path, source)).toEqual([]);
  expect(
    productBoundaryFindings("src/server/modules/file-processing/container-proxy.ts", source),
  ).toContain("unapproved_payload_log");
  for (const unsafe of [
    'console.error(JSON.stringify({event:"file_processor_failure",stage,category,durationMs,httpStatus,error}),)',
    'console.error(JSON.stringify({event:"file_processor_failure",stage,category,durationMs,httpStatus,message:error.message}),)',
    'console.error(JSON.stringify({event:"file_processor_failure",stage,category,durationMs,httpStatus,stack:error.stack}),)',
    'console.error(JSON.stringify({event:"file_processor_failure",stage,category,durationMs,httpStatus,...payload}),)',
    'console.error(JSON.stringify({event:"file_processor_failure",stage,category:error.message,durationMs,httpStatus}),)',
    "console.error(error)",
    'console["error"](JSON.stringify({event:"file_processor_failure",stage,category,durationMs,httpStatus}))',
    "const emit = console.error; emit(error)",
  ])
    expect(productBoundaryFindings(path, unsafe)).toContain("unapproved_payload_log");
});

function capture() {
  log.mockImplementation(() => {});
  return () => log.mock.calls.map(([line]) => JSON.parse(String(line)));
}
function fixture() {
  const calls = { fetch: 0, start: 0, destroy: 0 };
  const port = {
    isRevoked: async () => false,
    persistRevoked: async () => {},
    start: async (_signal: AbortSignal) => {
      calls.start++;
    },
    destroy: async () => {
      calls.destroy++;
    },
    fetch: async (_request: Request) => {
      calls.fetch++;
      return Response.json({ ready: true });
    },
  };
  return { calls, port, lifecycle: createProcessorLifecycle(port) };
}

test("SDK startup failures retain only a fixed category and stage before sanitized cleanup", async () => {
  const events = capture();
  for (const [message, category] of [
    [
      "there is no container instance that can be provided to this durable object",
      "instance_unavailable",
    ],
    ["you are requesting too many containers per second", "start_rate_limited"],
    ["the container is not listening", "port_not_ready"],
    ["Container crashed while checking for ports", "instance_stopped"],
    ["Network connection lost", "connection_lost"],
    ["Container did not start after 15000ms", "startup_timeout"],
  ]) {
    log.mockClear();
    const f = fixture();
    f.port.start = async () => {
      throw new Error(`${message}; private-token, prompt and SQL`, {
        cause: new Error("private-input"),
      });
    };
    const result = await f.lifecycle.fetch(new Request("https://internal/ready"));
    expect(result.status).toBe(503);
    expect(await result.text()).toBe(JSON.stringify({ code: "PROCESSOR_UNAVAILABLE" }));
    expect(f.calls.fetch).toBe(0);
    expect(f.calls.destroy).toBe(2);
    expect(events()).toEqual([
      {
        event: "file_processor_failure",
        stage: "startup",
        category,
        durationMs: expect.any(Number),
        httpStatus: null,
      },
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|prompt|SQL|stack|cause/);
  }
});

test("durable revocation read and pristine reset failures are distinguished from startup", async () => {
  const events = capture();
  for (const stage of ["revocation_read", "reset"] as const) {
    log.mockClear();
    const f = fixture();
    if (stage === "revocation_read")
      f.port.isRevoked = async () => {
        throw new Error("private-durable-error");
      };
    else {
      let first = true;
      f.port.destroy = async () => {
        f.calls.destroy++;
        if (first) {
          first = false;
          throw new Error("private-reset-error");
        }
      };
    }
    expect((await f.lifecycle.fetch(new Request("https://internal/ready"))).status).toBe(503);
    expect(f.calls.start).toBe(0);
    expect(f.calls.fetch).toBe(0);
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ stage, category: "unknown" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
  }
});

test("post-start RPC failure and native HTTP failure do not look like allocation failures", async () => {
  const events = capture();
  const f = fixture();
  f.port.fetch = async () => {
    throw new Error("Network connection lost: private-rpc");
  };
  expect((await f.lifecycle.fetch(new Request("https://internal/ready"))).status).toBe(503);
  expect(events()[0]).toMatchObject({ stage: "dispatch", category: "connection_lost" });
  expect(f.calls.start).toBe(1);
  expect(f.calls.destroy).toBe(2);
  log.mockClear();
  f.port.fetch = async () => new Response("private native failure", { status: 503 });
  expect((await f.lifecycle.fetch(new Request("https://internal/ready"))).status).toBe(503);
  expect(events()[0]).toMatchObject({
    stage: "response",
    category: "native_response_failed",
    httpStatus: 503,
  });
  expect(JSON.stringify(log.mock.calls)).not.toContain("private");
});

test("late stream failure is recorded without bytes and still destroys the native instance", async () => {
  const events = capture(),
    f = fixture();
  f.port.fetch = async () =>
    new Response(
      new ReadableStream(
        {
          pull() {
            throw new Error("private streaming data");
          },
        },
        { highWaterMark: 0 },
      ),
      { headers: { "content-type": "application/json" } },
    );
  const response = await f.lifecycle.fetch(new Request("https://internal/ready"));
  await expect(response.text()).rejects.toThrow("PROCESSOR_UNAVAILABLE");
  expect(events()[0]).toMatchObject({ stage: "stream", category: "unknown" });
  expect(f.calls.destroy).toBe(2);
  expect(JSON.stringify(log.mock.calls)).not.toContain("private");
});

test("diagnostic fields are clamped and logging failures cannot alter processor cleanup", async () => {
  const events = capture();
  reportProcessorFailure(
    "private-stage",
    new Error("private-error"),
    Number.POSITIVE_INFINITY,
    999,
  );
  reportProcessorFailure("cleanup", new Error("private-error"), -100, 503);
  expect(events()).toEqual([
    {
      event: "file_processor_failure",
      stage: "unclassified",
      category: "unknown",
      durationMs: null,
      httpStatus: null,
    },
    {
      event: "file_processor_failure",
      stage: "cleanup",
      category: "unknown",
      durationMs: 0,
      httpStatus: 503,
    },
  ]);
  expect(
    processorFailureCategory({
      get message() {
        throw new Error("private getter");
      },
    }),
  ).toBe("unknown");
  log.mockImplementation(() => {
    throw new Error("logging unavailable");
  });
  const f = fixture();
  f.port.start = async () => {
    throw new Error("private startup error");
  };
  expect((await f.lifecycle.fetch(new Request("https://internal/ready"))).status).toBe(503);
  expect(f.calls.destroy).toBe(2);
  log.mockImplementation(() => {});
});
