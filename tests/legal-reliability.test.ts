import { expect, spyOn, test } from "bun:test";
import { productBoundaryFindings } from "../scripts/product-boundaries";
import {
  reportLegalOutcome,
  reportLegalRejection,
  reportLegalRequest,
} from "../src/server/dependency-diagnostics";
import type { Access } from "../src/server/modules/legal-retrieval/v2/contracts";
import { createBoundedTransport } from "../src/server/modules/legal-retrieval/v2/transport";

const url = new URL("https://www.law.go.kr/DRF/lawSearch.do?target=eflaw&type=JSON");
const access: Access = {
  authorize: async () => true,
  authorizeQuery: async () => true,
  reserveRequest: async () => true,
};
const ok = () => new Response("{}", { headers: { "content-type": "application/json" } });

test.each([429, 503])(
  "HTTP%s honors Retry-After before retrying within the same three-attempt budget",
  async (status) => {
    let calls = 0;
    let reservations = 0;
    const delays: number[] = [];
    const observations: unknown[] = [];
    const send = createBoundedTransport(
      async () =>
        ++calls === 1 ? new Response("", { status, headers: { "retry-after": "1" } }) : ok(),
      {
        sleep: async (delay) => {
          delays.push(delay);
        },
        observeRequest: (value) => {
          observations.push(value);
        },
      },
    );
    expect(
      await send(url, "moleg_eflaw_list", {
        ...access,
        reserveRequest: async () => {
          reservations++;
          return true;
        },
      }),
    ).toBe("{}");
    expect(calls).toBe(2);
    expect(reservations).toBe(2);
    expect(delays).toEqual([1000]);
    expect(observations).toMatchObject([
      {
        attempt: 1,
        httpStatus: status,
        reason: status === 429 ? "rate_limited" : "upstream_unavailable",
      },
      { attempt: 2, httpStatus: 200, reason: null },
    ]);
  },
);

test("an HTTP date Retry-After is respected and an excessive wait never extends the original budget", async () => {
  let calls = 0;
  const delays: number[] = [];
  const send = createBoundedTransport(
    async () =>
      ++calls === 1
        ? new Response("", {
            status: 429,
            headers: { "retry-after": new Date(Date.now() + 5000).toUTCString() },
          })
        : ok(),
    {
      sleep: async (delay) => {
        delays.push(delay);
      },
    },
  );
  expect(await send(url, "moleg_eflaw_list", access)).toBe("{}");
  expect(delays[0]).toBeGreaterThan(200);
  expect(delays[0]).toBeLessThanOrEqual(5000);
  calls = 0;
  const blocked = createBoundedTransport(
    async () => {
      calls++;
      return new Response("", {
        status: 429,
        headers: { "retry-after": "99999999999999999999999" },
      });
    },
    {
      sleep: async () => {
        throw new Error("must not wait or retry early");
      },
    },
  );
  await expect(blocked(url, "moleg_eflaw_list", access)).rejects.toMatchObject({
    reason: "rate_limited",
  });
  expect(calls).toBe(1);
});

test("cancellation during a provider-directed wait cannot reserve or send another request", async () => {
  const controller = new AbortController();
  let calls = 0;
  const send = createBoundedTransport(
    async () => {
      calls++;
      return new Response("", { status: 429, headers: { "retry-after": "2" } });
    },
    {
      sleep: async () => {
        controller.abort();
        return new Promise(() => {});
      },
    },
  );
  await expect(
    send(url, "moleg_eflaw_list", { ...access, signal: controller.signal }),
  ).rejects.toMatchObject({ reason: "cancelled" });
  expect(calls).toBe(1);
});

test("a nonconforming sleep adapter cannot stall beyond the existing total timeout ceiling", async () => {
  let calls = 0;
  const send = createBoundedTransport(
    async () => {
      calls++;
      return new Response("", { status: 429 });
    },
    { timeoutMs: 5, sleep: async () => new Promise(() => {}) },
  );
  await expect(send(url, "moleg_eflaw_list", access)).rejects.toMatchObject({ reason: "timeout" });
  expect(calls).toBe(1);
});

test("diagnostic failure never changes a successfully verified HTTP response", async () => {
  const send = createBoundedTransport(async () => ok(), {
    observeRequest: () => {
      throw new Error("synthetic observer failure");
    },
  });
  expect(await send(url, "moleg_eflaw_list", access)).toBe("{}");
});

test("authorization latency cannot send a new request after the existing total deadline", async () => {
  let calls = 0;
  const send = createBoundedTransport(
    async () => {
      calls++;
      return ok();
    },
    { timeoutMs: 5 },
  );
  await expect(
    send(url, "moleg_eflaw_list", {
      ...access,
      authorize: async () => {
        await new Promise((resolve) => setTimeout(resolve, 180));
        return true;
      },
    }),
  ).rejects.toMatchObject({ reason: "timeout" });
  expect(calls).toBe(0);
});

test("production diagnostics reject raw fields, private endpoint strings and arbitrary reason text", () => {
  const logs: string[] = [];
  const spy = spyOn(console, "warn").mockImplementation((value) => {
    logs.push(String(value));
  });
  try {
    const request = {
      endpointId: "moleg_eflaw_list",
      attempt: 1,
      durationMs: 6450,
      httpStatus: 200,
      reason: null,
    };
    reportLegalRequest({ ...request, url: "https://private.invalid/?OC=SYNTHETIC_PRIVATE" });
    reportLegalRequest({ ...request, endpointId: "SYNTHETIC_PRIVATE" });
    reportLegalRequest({ ...request, reason: "SYNTHETIC_PRIVATE" });
    reportLegalRequest(request);
    const outcome = {
      kind: "precedent",
      availability: "verified",
      reason: null,
      sourceFailures: ["identity_mismatch"],
      verifiedSourceCount: 1,
      durationMs: 20,
    };
    reportLegalOutcome({ ...outcome, body: "SYNTHETIC_PRIVATE" });
    reportLegalOutcome(outcome);
    reportLegalRejection({
      endpointId: "moleg_prec_list",
      category: "upstream-credential-rejected",
      message: "SYNTHETIC_PRIVATE",
    });
    reportLegalRejection({
      endpointId: "moleg_prec_list",
      category: "upstream-credential-rejected",
    });
    expect(logs).toHaveLength(3);
    expect(logs.join("")).not.toContain("SYNTHETIC_PRIVATE");
    expect(JSON.parse(logs[0] ?? "{}").durationMs).toBe(6450);
    expect(JSON.parse(logs[1] ?? "{}").sourceFailures).toEqual(["identity_mismatch"]);
  } finally {
    spy.mockRestore();
  }
});

test("only the exact finite legal log shapes in the central logger are approved", () => {
  const calls = [
    'console.warn(JSON.stringify({event:"legal_request_observation",endpointId,attempt,durationMs,httpStatus,reason,}),)',
    'console.warn(JSON.stringify({event:"legal_source_observation",kind,availability,reason,sourceFailures,verifiedSourceCount,durationMs,}),)',
    'console.warn(JSON.stringify({event:"legal_upstream_rejection",endpointId,category}))',
  ];
  for (const call of calls) {
    expect(productBoundaryFindings("src/server/dependency-diagnostics.ts", call)).toEqual([]);
    expect(productBoundaryFindings("src/server/other.ts", call)).toContain(
      "unapproved_payload_log",
    );
    expect(
      productBoundaryFindings(
        "src/server/dependency-diagnostics.ts",
        call.replace("event:", "body, event:"),
      ),
    ).toContain("unapproved_payload_log");
  }
});
