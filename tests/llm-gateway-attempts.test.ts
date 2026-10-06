import { expect, test } from "bun:test";
import type {
  GatewayAttemptHandle,
  GatewayAttemptLedger,
  GatewayAttemptRequest,
  GatewayTransportReceipt,
} from "../src/server/modules/llm-gateway/attempts";
import { responseReceipt } from "../src/server/modules/llm-gateway/attempts";
import { createLlmGateway, type GatewayBinding } from "../src/server/modules/llm-gateway/service";

const invocationId = "00000000-0000-4000-8000-000000000001";
const output = { schemaVersion: "1", inScope: true, urgency: "none", reasonCode: "IN_SCOPE" };
const completion = () => ({
  id: "chatcmpl-synthetic-1",
  choices: [{ message: { content: JSON.stringify({ output }) }, finish_reason: "stop" }],
  service_tier: "default",
  usage: {
    prompt_tokens: 10,
    completion_tokens: 20,
    prompt_tokens_details: { cached_tokens: 2, cache_write_tokens: 3 },
  },
});

test("preview and production composition cannot fall back to an unaccounted paid call", async () => {
  let runs = 0;
  let quota = 0;
  for (const APP_ENV of ["preview", "production"]) {
    const gateway = createLlmGateway({
      APP_ENV,
      AI_GATEWAY_ID: "synthetic",
      AI: {
        run: async () => {
          runs++;
          return completion();
        },
      },
    });
    await expect(
      gateway.call("screening", {}, "safe-request-id", async () => {
        quota++;
        return true;
      }),
    ).rejects.toThrow("MODEL_UNAVAILABLE");
  }
  const gateway = createLlmGateway(
    {
      AI_GATEWAY_ID: "synthetic",
      AI: {
        run: async () => {
          runs++;
          return completion();
        },
      },
    },
    { requireAttemptLedger: true },
  );
  await expect(
    gateway.call("screening", {}, "safe-request-id", async () => {
      quota++;
      return true;
    }),
  ).rejects.toThrow("MODEL_UNAVAILABLE");
  expect(runs).toBe(0);
  expect(quota).toBe(0);
});

function harness(
  run: GatewayBinding["run"],
  overrides: Partial<GatewayAttemptLedger> = {},
  timeoutMs = 1000,
) {
  const requests: GatewayAttemptRequest[] = [];
  const receipts: { handle: GatewayAttemptHandle; receipt: GatewayTransportReceipt }[] = [];
  const background: Promise<void>[] = [];
  const events: string[] = [];
  let runs = 0;
  const ledger: GatewayAttemptLedger = {
    beforeDispatch: async (request) => {
      requests.push(request);
      events.push("hold");
      return {
        invocationId: request.invocationId,
        attemptId: `00000000-0000-4000-8000-00000000000${request.attemptOrdinal + 1}`,
      };
    },
    confirmDispatch: async () => {
      events.push("dispatch-guard");
      return true;
    },
    afterTransport: async (handle, receipt) => {
      events.push(receipt.transport);
      receipts.push({ handle, receipt });
    },
    waitUntil: (promise) => {
      background.push(promise);
      void promise.catch(() => {});
    },
    ...overrides,
  };
  const gateway = createLlmGateway(
    {
      AI_GATEWAY_ID: "synthetic",
      AI: {
        run: async (...args) => {
          runs++;
          events.push("remote");
          return run(...args);
        },
      },
    },
    { attemptLedger: ledger, sleep: async () => {}, timeoutMs },
  );
  const call = (
    reserve = async () => {
      events.push("quota");
      return true;
    },
  ) =>
    gateway.call(
      "screening",
      { narrative: "private-prompt-sentinel" },
      "safe-request-id",
      reserve,
      async () => {
        events.push("correction-quota");
        return true;
      },
      invocationId,
    );
  return { call, gateway, requests, receipts, background, events, runs: () => runs };
}

test("accounted calls require server invocation identity and denied funding does not consume quota or call model", async () => {
  const missing = harness(async () => completion());
  let quota = 0;
  for (const id of [undefined, "safe-request-id", "00000000-0000-0000-0000-000000000001"]) {
    await expect(
      missing.gateway.call(
        "screening",
        {},
        "safe-request-id",
        async () => {
          quota++;
          return true;
        },
        undefined,
        id,
      ),
    ).rejects.toThrow("MODEL_UNAVAILABLE");
  }
  expect(quota).toBe(0);
  expect(missing.requests).toHaveLength(0);
  expect(missing.runs()).toBe(0);
  const denied = harness(async () => completion(), { beforeDispatch: async () => null });
  await expect(
    denied.call(async () => {
      quota++;
      return true;
    }),
  ).rejects.toThrow("MODEL_UNAVAILABLE");
  expect(quota).toBe(0);
  expect(denied.runs()).toBe(0);
});

test("the final dispatch guard runs after quota; pre-transport cancellation is definitively unsent", async () => {
  for (const mode of ["quota-denied", "quota-error", "guard-denied", "guard-error"] as const) {
    const h = harness(async () => completion(), {
      confirmDispatch: async () => {
        if (mode === "guard-error") throw new Error("private SQL sentinel");
        return false;
      },
    });
    await expect(
      h.call(async () => {
        if (mode === "quota-error") throw new Error("private SQL sentinel");
        return mode !== "quota-denied";
      }),
    ).rejects.toThrow("MODEL_UNAVAILABLE");
    expect(h.runs()).toBe(0);
    expect(h.receipts).toHaveLength(1);
    expect(h.receipts[0]?.receipt).toMatchObject({
      transport: "not_sent",
      definitiveNoCharge: true,
      inputTokens: null,
      outputTokens: null,
    });
  }
  const valid = harness(async () => completion());
  expect(await valid.call()).toEqual(output);
  expect(valid.events).toEqual(["hold", "quota", "dispatch-guard", "remote", "response"]);
  expect(valid.requests[0]).toMatchObject({
    invocationId,
    attemptOrdinal: 1,
    correction: false,
    outputTokenUpperBound: 800,
  });
  expect(valid.requests[0]?.inputBytes).toBeGreaterThan(100);
});

test("refusal and raw error envelopes are metered before rejection without exposing model content", async () => {
  for (const raw of [
    {
      ...completion(),
      choices: [
        { message: { content: null, refusal: "private-refusal-sentinel" }, finish_reason: "stop" },
      ],
    },
    { ...completion(), error: { message: "private-error-sentinel" } },
  ]) {
    const h = harness(async () => raw);
    await expect(h.call()).rejects.toThrow(
      "error" in raw ? "MODEL_UNAVAILABLE" : "POLICY_REJECTED",
    );
    expect(h.runs()).toBe(1);
    expect(h.receipts[0]?.receipt).toMatchObject({
      transport: "response",
      providerRequestId: "chatcmpl-synthetic-1",
      inputTokens: 10,
      outputTokens: 20,
      cachedInputTokens: 2,
      cacheWriteInputTokens: 3,
      serviceTier: "default",
      meteringStatus: "complete",
      definitiveNoCharge: false,
    });
    const metadata = JSON.stringify({ requests: h.requests, receipts: h.receipts });
    expect(metadata).not.toContain("sentinel");
    expect(metadata).not.toContain("choices");
    expect(metadata).not.toContain("reasonCode");
  }
});

test("invalid output and its correction have distinct durable attempts and both usage receipts", async () => {
  let count = 0;
  const h = harness(async () =>
    ++count === 1
      ? {
          ...completion(),
          choices: [
            { message: { content: "invalid private-content-sentinel" }, finish_reason: "length" },
          ],
        }
      : completion(),
  );
  expect(await h.call()).toEqual(output);
  expect(h.requests.map((r) => [r.attemptOrdinal, r.correction])).toEqual([
    [1, false],
    [2, true],
  ]);
  expect(h.receipts).toHaveLength(2);
  expect(h.receipts[0]?.handle.attemptId).not.toBe(h.receipts[1]?.handle.attemptId);
  expect(h.receipts.every(({ handle }) => handle.invocationId === invocationId)).toBe(true);
  expect(h.events.indexOf("response")).toBeLessThan(h.events.indexOf("correction-quota"));
});

test("malformed choices still retain usage; missing or unsafe metering never becomes a zero receipt", async () => {
  const malformed = harness(async () => ({ ...completion(), choices: [] }));
  await expect(malformed.call()).rejects.toThrow("MODEL_SCHEMA_INVALID");
  expect(malformed.receipts).toHaveLength(2);
  expect(
    malformed.receipts.every(
      ({ receipt }) => receipt.inputTokens === 10 && receipt.outputTokens === 20,
    ),
  ).toBe(true);
  for (const usage of [
    undefined,
    { prompt_tokens: -1, completion_tokens: Number.MAX_SAFE_INTEGER + 1 },
    { prompt_tokens: "10", completion_tokens: 1.5 },
  ]) {
    const h = harness(async () => ({ ...completion(), id: "private id with spaces", usage }));
    if (usage === undefined) expect(await h.call()).toEqual(output);
    else await expect(h.call()).rejects.toThrow("MODEL_SCHEMA_INVALID");
    expect(h.receipts[0]?.receipt).toMatchObject({
      inputTokens: null,
      outputTokens: null,
      providerRequestId: null,
      definitiveNoCharge: false,
    });
  }
});

test("provider rejection records unresolved exposure before bounded retry; uncertain network failures never retry", async () => {
  let count = 0;
  const retry = harness(async () => {
    if (++count === 1) throw { status: 429, retryAfter: 0 };
    return completion();
  });
  expect(await retry.call()).toEqual(output);
  expect(retry.receipts.map(({ receipt }) => receipt.transport)).toEqual([
    "provider_error",
    "response",
  ]);
  expect(retry.receipts[0]?.receipt.definitiveNoCharge).toBe(false);
  expect(retry.events.indexOf("provider_error")).toBeLessThan(retry.events.lastIndexOf("hold"));
  const network = harness(async () => {
    throw new Error("private transport sentinel");
  });
  await expect(network.call()).rejects.toThrow("MODEL_UNAVAILABLE");
  expect(network.runs()).toBe(1);
  expect(network.receipts[0]?.receipt).toMatchObject({
    transport: "unknown",
    definitiveNoCharge: false,
  });
});

test("timeout retains liability and later records usage on the same attempt without publishing or retrying", async () => {
  let resolveRemote: (value: unknown) => void = () => {};
  const remote = new Promise<unknown>((resolve) => {
    resolveRemote = resolve;
  });
  let releaseUnknown: () => void = () => {};
  const blocked = new Promise<void>((resolve) => {
    releaseUnknown = resolve;
  });
  const stored: GatewayTransportReceipt[] = [];
  const h = harness(
    async () => remote,
    {
      afterTransport: async (_handle, receipt) => {
        if (receipt.transport === "unknown") await blocked;
        stored.push(receipt);
      },
    },
    5,
  );
  const result = h.call().catch((error: unknown) => error);
  await new Promise((resolve) => setTimeout(resolve, 20));
  resolveRemote(completion());
  await Promise.resolve();
  expect(stored).toHaveLength(0);
  releaseUnknown();
  expect(await result).toMatchObject({ code: "MODEL_UNAVAILABLE" });
  await Promise.all(h.background);
  expect(stored.map((r) => r.transport)).toEqual(["unknown", "response"]);
  expect(stored[1]).toMatchObject({
    inputTokens: 10,
    outputTokens: 20,
    cachedInputTokens: 2,
    cacheWriteInputTokens: 3,
    serviceTier: "default",
    meteringStatus: "complete",
  });
  expect(h.runs()).toBe(1);
  expect(h.requests).toHaveLength(1);
});

test("durable receipt failure suppresses output and correction, and sanitizes persistence errors", async () => {
  for (const raw of [completion(), { ...completion(), choices: [] }]) {
    const h = harness(async () => raw, {
      afterTransport: async () => {
        throw new Error("private SQL sentinel");
      },
    });
    await expect(h.call()).rejects.toThrow("MODEL_UNAVAILABLE");
    expect(h.runs()).toBe(1);
    expect(h.events).not.toContain("correction-quota");
  }
});

test("mismatched durable handles and failed hold storage cannot dispatch", async () => {
  for (const beforeDispatch of [
    async () => ({ invocationId: "00000000-0000-4000-8000-000000000099", attemptId: invocationId }),
    async () => ({ invocationId, attemptId: "not-a-server-attempt" }),
    async () => {
      throw new Error("private SQL sentinel");
    },
  ]) {
    const h = harness(async () => completion(), { beforeDispatch });
    await expect(h.call()).rejects.toThrow("MODEL_UNAVAILABLE");
    expect(h.runs()).toBe(0);
    expect(h.events).not.toContain("quota");
  }
});

test("settlement registration failure cannot dispatch, consume quota, or lose late metering", async () => {
  let quota = 0;
  let confirms = 0;
  let settlement: Promise<void> | undefined;
  const h = harness(async () => completion(), {
    waitUntil: (promise) => {
      settlement = promise;
      throw new Error("private context sentinel");
    },
    confirmDispatch: async () => {
      confirms++;
      return true;
    },
  });
  await expect(
    h.call(async () => {
      quota++;
      return true;
    }),
  ).rejects.toThrow("MODEL_UNAVAILABLE");
  await settlement;
  expect(h.runs()).toBe(0);
  expect(quota).toBe(0);
  expect(confirms).toBe(0);
  expect(h.receipts).toHaveLength(1);
  expect(h.receipts[0]?.receipt).toMatchObject({
    transport: "not_sent",
    definitiveNoCharge: true,
    meteringStatus: "incomplete",
  });
  expect(JSON.stringify(h.receipts)).not.toContain("sentinel");
});

test("metering preserves exclusive cache counts and full-context input independently of output", () => {
  for (const input of [272000, 272001, Number.MAX_SAFE_INTEGER]) {
    const receipt = responseReceipt({
      ...completion(),
      choices: [],
      usage: {
        prompt_tokens: input,
        completion_tokens: 40,
        prompt_tokens_details: { cached_tokens: 2, cache_write_tokens: input - 2 },
      },
    });
    expect(receipt).toMatchObject({
      inputTokens: input,
      outputTokens: 40,
      cachedInputTokens: 2,
      cacheWriteInputTokens: input - 2,
      meteringStatus: "complete",
    });
  }
  const ordinary = responseReceipt({
    ...completion(),
    usage: {
      prompt_tokens: 10,
      completion_tokens: 20,
      prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    },
  });
  expect(ordinary.cacheWriteInputTokens).toBe(0);
  expect(ordinary).not.toEqual(responseReceipt(completion()));
});

test("partial or invalid metering never invents cache zeros, a price tier, or complete billing evidence", () => {
  const totalOnly = responseReceipt({
    usage: { prompt_tokens: 10, completion_tokens: 20 },
    service_tier: "default",
  });
  expect(totalOnly).toMatchObject({
    inputTokens: 10,
    outputTokens: 20,
    cachedInputTokens: null,
    cacheWriteInputTokens: null,
    meteringStatus: "incomplete",
  });
  const partial = responseReceipt({
    ...completion(),
    usage: {
      prompt_tokens: 10,
      completion_tokens: 20,
      prompt_tokens_details: { cached_tokens: 2 },
    },
  });
  expect(partial).toMatchObject({
    cachedInputTokens: 2,
    cacheWriteInputTokens: null,
    meteringStatus: "incomplete",
  });
  for (const detail of [
    { cached_tokens: -1, cache_write_tokens: 0 },
    { cached_tokens: 0.5, cache_write_tokens: 0 },
    { cached_tokens: "2", cache_write_tokens: 0 },
    { cached_tokens: 8, cache_write_tokens: 3 },
    { cached_tokens: 11 },
    { cache_write_tokens: 11 },
    { cached_tokens: Number.MAX_SAFE_INTEGER + 1, cache_write_tokens: 0 },
    [],
  ]) {
    expect(
      responseReceipt({
        ...completion(),
        usage: { prompt_tokens: 10, completion_tokens: 20, prompt_tokens_details: detail },
      }).meteringStatus,
    ).toBe("invalid");
  }
  for (const serviceTier of [undefined, null, "private-tier-sentinel", "auto", {}]) {
    const receipt = responseReceipt({ ...completion(), service_tier: serviceTier });
    expect(receipt.serviceTier).toBeNull();
    expect(receipt.meteringStatus).toBe(serviceTier == null ? "incomplete" : "invalid");
    expect(JSON.stringify(receipt)).not.toContain("sentinel");
  }
  for (const tier of ["default", "flex", "scale", "priority"] as const) {
    expect(responseReceipt({ ...completion(), service_tier: tier })).toMatchObject({
      serviceTier: tier,
      meteringStatus: "complete",
    });
  }
  expect(responseReceipt({ ...completion(), usage: [] }).meteringStatus).toBe("invalid");
});
