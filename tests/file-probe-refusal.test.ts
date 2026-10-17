import { expect, test } from "bun:test";
import { proxyProcessorRequest } from "../src/server/modules/file-processing/container-proxy";
import {
  DefinitiveFileRejection,
  ProcessingError,
} from "../src/server/modules/file-processing/protocol";
import { createProcessorTransport } from "../src/server/modules/file-processing/transport";

const marker = { code: "INVALID_MEDIA", rejection: "office_input" };
const source = {
  byteLength: 3,
  contentHash: "a".repeat(64),
  open: () =>
    new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(new Uint8Array([1, 2, 3]));
        stream.close();
      },
    }),
};

async function rejected(
  response: Response,
  options: {
    proxy?: boolean;
    revoke?: "body" | "cleanup";
    abort?: boolean;
    process?: boolean;
  } = {},
) {
  const controller = new AbortController();
  let allowed = true;
  let dispatches = 0;
  let stops = 0;
  const receipts: string[] = [];
  const transport = createProcessorTransport({
    costs: {
      before: async () => ({ attemptId: "synthetic", dispatchToken: null }),
      after: async (_, receipt) => {
        receipts.push(receipt.transport);
      },
    },
    fetch: async (request) => {
      dispatches++;
      if (options.revoke === "body") {
        if (!response.body) throw new Error("Synthetic body missing");
        const body = response.body.getReader();
        response = new Response(
          new ReadableStream(
            {
              async pull(stream) {
                const next = await body.read();
                if (next.done) {
                  if (options.abort) controller.abort();
                  else allowed = false;
                  stream.close();
                } else stream.enqueue(next.value);
              },
              cancel: () => body.cancel(),
            },
            { highWaterMark: 0 },
          ),
          response,
        );
      }
      return options.proxy
        ? proxyProcessorRequest(request, {
            start: async () => {},
            fetch: async () => response,
            stop: async () => {
              if (options.revoke === "cleanup") controller.abort();
            },
          })
        : response;
    },
    stop: async () => {
      stops++;
    },
  });
  let error: unknown;
  try {
    const access = { authorize: async () => allowed, signal: controller.signal };
    if (options.process)
      await transport.processUnit({ ...source, unit: 0, frameOffset: 0 }, access, {
        manifest: async () => {},
        artifact: async () => {},
      });
    else await transport.probe(source, access);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeDefined();
  expect(dispatches).toBe(1);
  expect(stops).toBe(1);
  expect(receipts[0]).toBe("response");
  expect(receipts.every((receipt) => receipt === "response" || receipt === "unknown")).toBe(true);
  if (error instanceof DefinitiveFileRejection) expect(receipts).toEqual(["response"]);
  return error;
}

for (const code of ["UNSUPPORTED_FORMAT", "INVALID_MEDIA"])
  test(`explicit native Office ${code} survives the real proxy and becomes definitive`, async () => {
    const error = await rejected(Response.json({ ...marker, code }, { status: 422 }), {
      proxy: true,
    });
    expect(error).toBeInstanceOf(DefinitiveFileRejection);
    expect(error).toBeInstanceOf(ProcessingError);
    expect((error as ProcessingError).code).toBe("FILE_REJECTED");
  });

const invalid = [
  ["legacy refusal", () => Response.json({ code: "INVALID_MEDIA" }, { status: 422 })],
  [
    "unknown process failure",
    () => Response.json({ ...marker, code: "PROCESSING_FAILED" }, { status: 422 }),
  ],
  ["technical limit", () => Response.json({ ...marker, code: "LIMIT" }, { status: 422 })],
  ["false marker", () => Response.json({ ...marker, rejection: false }, { status: 422 })],
  ["unknown field", () => Response.json({ ...marker, detail: "synthetic" }, { status: 422 })],
  ["missing code", () => Response.json({ rejection: "office_input" }, { status: 422 })],
  [
    "malformed JSON",
    () => new Response("{", { status: 422, headers: { "content-type": "application/json" } }),
  ],
  [
    "oversized JSON",
    () =>
      new Response(` ${JSON.stringify(marker)}${" ".repeat(1024)}`, {
        status: 422,
        headers: { "content-type": "application/json" },
      }),
  ],
  [
    "invalid UTF8",
    () =>
      new Response(Uint8Array.of(255), {
        status: 422,
        headers: { "content-type": "application/json" },
      }),
  ],
  ["wrong content type", () => new Response(JSON.stringify(marker), { status: 422 })],
  ["success protocol mismatch", () => Response.json(marker)],
  ["timeout", () => Response.json(marker, { status: 408 })],
  ["busy", () => Response.json(marker, { status: 409 })],
  [
    "redirect",
    () => {
      const response = Response.json(marker, { status: 422 });
      Object.defineProperty(response, "redirected", { value: true });
      return response;
    },
  ],
  [
    "body read failure",
    () =>
      new Response(
        new ReadableStream({
          start(stream) {
            stream.error(new Error("synthetic read failure"));
          },
        }),
        { status: 422, headers: { "content-type": "application/json" } },
      ),
  ],
] as const;

for (const [name, response] of invalid)
  for (const proxy of [false, true])
    test(`${name} is never definitive (proxy=${proxy})`, async () => {
      expect(await rejected(response(), { proxy })).not.toBeInstanceOf(DefinitiveFileRejection);
    });

for (const proxy of [false, true])
  for (const abort of [false, true])
    test(`authorization loss while reading never becomes definitive (proxy=${proxy}, abort=${abort})`, async () => {
      const error = await rejected(Response.json(marker, { status: 422 }), {
        proxy,
        revoke: "body",
        abort,
      });
      expect(error).not.toBeInstanceOf(DefinitiveFileRejection);
      expect((error as ProcessingError).code).toBe("STALE_REVISION");
    });

test("cancellation during native cleanup cannot return a terminal marker", async () => {
  expect(
    await rejected(Response.json(marker, { status: 422 }), {
      proxy: true,
      revoke: "cleanup",
    }),
  ).not.toBeInstanceOf(DefinitiveFileRejection);
});

test("a process-unit refusal cannot be promoted as an admission probe", async () => {
  for (const proxy of [false, true])
    expect(
      await rejected(Response.json(marker, { status: 422 }), { proxy, process: true }),
    ).not.toBeInstanceOf(DefinitiveFileRejection);
});
