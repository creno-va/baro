import { expect, test } from "bun:test";
import { dependencyCategory } from "../src/server/dependency-diagnostics";
import { providerStatus } from "../src/server/modules/llm-gateway/attempts";
import { createLlmGateway } from "../src/server/modules/llm-gateway/service";
import { gatewayRequestIssue, gatewayResponse } from "../src/server/modules/llm-gateway/transport";

test("HTTP request diagnostics classify thinking and schema settings without retaining provider text", async () => {
  for (const [message, issue] of [
    ["reasoning_effort medium is not supported private sentinel", "thinking_configuration"],
    [
      "thinking budget must be less than max_output_tokens private sentinel",
      "thinking_output_limit",
    ],
    ["Unknown parameter private sentinel", "unsupported_parameter"],
    ["Invalid response_format JSON schema private sentinel", "schema_constraint"],
  ] as const) {
    const error = await gatewayResponse(
      Response.json({ error: { message } }, { status: 400 }),
    ).catch((error) => error);
    expect(gatewayRequestIssue(error)).toBe(issue);
    expect(JSON.stringify(error)).not.toContain("sentinel");
    expect(String(error)).toBe("Error: GATEWAY_HTTP_ERROR");
  }
});

test("wrapped/string upstream diagnostics retain only a finite category", async () => {
  for (const body of [
    { description: "schema produces a constraint with too many states private sentinel" },
    { error: "schema has too much branching private sentinel" },
    { errors: [{ details: [{ message: "schema too complex private sentinel" }] }] },
  ]) {
    const error = await gatewayResponse(Response.json(body, { status: 400 })).catch((e) => e);
    expect(gatewayRequestIssue(error)).toBe("schema_complexity");
    expect(Object.keys(error as object)).toEqual(["status"]);
    expect(String(error)).toBe("Error: GATEWAY_HTTP_ERROR");
  }
});

for (const [status, body, category] of [
  [
    400,
    { error: { message: "Invalid schema for response_format: private sentinel" } },
    "provider_schema",
  ],
  [400, { internalCode: 5007, description: "No such model private sentinel" }, "provider_request"],
  [401, { errors: [{ code: 10000, message: "private sentinel" }] }, "provider_auth"],
  [402, {}, "provider_budget"],
  [429, {}, "provider_rate"],
  [503, {}, "provider_unavailable"],
] as const)
  test(`raw AI HTTP ${status} retains only safe status/category: ${category}`, async () => {
    const error = await gatewayResponse(Response.json(body, { status })).catch((error) => error);
    expect(providerStatus(error)).toBe(status);
    expect(dependencyCategory(error)).toBe(category);
    expect(String(error)).toBe("Error: GATEWAY_HTTP_ERROR");
    expect(JSON.stringify(error)).not.toContain("private");
    expect(error).not.toHaveProperty("cause");
  });

test("invalid/oversized error bodies retain their HTTP status; oversized success is rejected", async () => {
  for (const body of ["not json: private sentinel", "x".repeat(16385)]) {
    const error = await gatewayResponse(new Response(body, { status: 502 })).catch(
      (error) => error,
    );
    expect(providerStatus(error)).toBe(502);
    expect(dependencyCategory(error)).toBe("provider_unavailable");
  }
  await expect(gatewayResponse(new Response("x".repeat(1024 * 1024 + 1)))).rejects.toThrow(
    "GATEWAY_RESPONSE_TOO_LARGE",
  );
  // Internal Cloudflare error numbers must never be inferred as HTTP status.
  expect(providerStatus(new Error("503: private sentinel"))).toBeNull();
});

test("simultaneous raw responses keep their own HTTP statuses", async () => {
  let finish: (bytes: Uint8Array) => void = () => {};
  const slow = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        finish = (bytes) => {
          controller.enqueue(bytes);
          controller.close();
        };
      },
    }),
    { status: 400 },
  );
  const pending = gatewayResponse(slow).catch((error) => error);
  const fast = await gatewayResponse(Response.json({}, { status: 503 })).catch((error) => error);
  finish(
    new TextEncoder().encode(
      JSON.stringify({ error: { message: "Invalid schema private sentinel" } }),
    ),
  );
  const first = await pending;
  expect(providerStatus(first)).toBe(400);
  expect(dependencyCategory(first)).toBe("provider_schema");
  expect(providerStatus(fast)).toBe(503);
});

test("raw rate limits preserve bounded Retry-After without reflecting arbitrary headers", async () => {
  for (const [header, expected] of [
    ["12", 12],
    ["999999", 30],
    ["private sentinel", undefined],
  ] as const) {
    const error = await gatewayResponse(
      new Response("{}", { status: 429, headers: { "retry-after": header } }),
    ).catch((error) => error);
    expect((error as { retryAfter?: number }).retryAfter).toBe(expected);
    expect(JSON.stringify(error)).not.toContain("private");
  }
});

test("gateway reads raw success and reports non-retryable provider rejection without payloads", async () => {
  const output = { schemaVersion: "1", inScope: true, urgency: "none", reasonCode: "IN_SCOPE" };
  const failures: unknown[] = [];
  let reject = false,
    calls = 0;
  const gateway = createLlmGateway(
    {
      AI_GATEWAY_ID: "synthetic",
      AI: {
        async run(_model, _input, options) {
          calls++;
          expect(options.returnRawResponse).toBe(true);
          return reject
            ? Response.json(
                { error: { message: "Invalid schema private sentinel" } },
                { status: 400 },
              )
            : Response.json({
                choices: [
                  { message: { content: JSON.stringify({ output }) }, finish_reason: "stop" },
                ],
              });
        },
      },
    },
    { observeFailure: (failure) => failures.push(failure) },
  );
  expect(await gateway.call("screening", {}, "safe", async () => true)).toEqual(output);
  reject = true;
  await expect(gateway.call("screening", {}, "safe", async () => true)).rejects.toThrow(
    "MODEL_UNAVAILABLE",
  );
  expect(calls).toBe(2);
  expect(failures).toEqual([{ phase: "screening", category: "provider_schema", httpStatus: 400 }]);
});
