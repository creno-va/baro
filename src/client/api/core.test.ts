import { expect, test } from "bun:test";
import { ApiError, apiRequest, cacheClient, responseError } from "./core";

test("real API errors preserve consent and security-check boundaries without echoing server details", async () => {
  const consent = await responseError(
    Response.json({ error: { code: "CONSENT_REQUIRED" } }, { status: 403 }),
  );
  expect(consent.code).toBe("CONSENT_REQUIRED");
  const security = await responseError(
    Response.json(
      { error: { code: "TURNSTILE_FAILED", message: "private stack" } },
      { status: 403 },
    ),
  );
  expect(security.code).toBe("VALIDATION_ERROR");
  expect(security.message).toContain("보안 확인");
  expect(security.message).not.toContain("private stack");
  const budget = await responseError(
    Response.json({ error: { code: "BUDGET_UNAVAILABLE" } }, { status: 503 }),
  );
  expect(budget.code).toBe("UNAVAILABLE");
  expect(budget.retryable).toBe(true);
  const role = await responseError(
    Response.json(
      { error: { code: "ROLE_REQUIRED", message: "private role detail" } },
      { status: 403 },
    ),
  );
  expect(role.code).toBe("NOT_FOUND");
  expect(role.retryable).toBe(false);
  expect(role.message).toContain("이용 유형");
  expect(role.message).not.toContain("private role detail");
  expect((await responseError(new Response("untrusted raw detail", { status: 403 }))).code).toBe(
    "VALIDATION_ERROR",
  );
});

test("a failed load retries but an API failure retains its domain instance and pending request state", async () => {
  let loads = 0;
  const client = {
    key: "same-request",
    save: () => {
      throw new Error("temporary API failure");
    },
  };
  const get = cacheClient(async () => {
    if (++loads === 1) throw new Error("module load failed");
    return client;
  });
  await expect(get()).rejects.toThrow("module load failed");
  const loaded = await get();
  expect(() => loaded.save()).toThrow("temporary API failure");
  expect(await get()).toBe(loaded);
  expect((await get()).key).toBe("same-request");
  expect(loads).toBe(2);
});

test("real transport failures keep only a finite class without changing retry or HTTP semantics", async () => {
  const originalFetch = globalThis.fetch;
  const privateText = "SYNTHETIC_PRIVATE_BODY_URL_TOKEN_STACK";
  const cases = [
    { error: new DOMException(privateText, "TimeoutError"), kind: "timeout" },
    { error: new DOMException(privateText, "AbortError"), kind: "abort" },
    { error: new Error(privateText), kind: "unknown" },
    {
      error: { name: "TimeoutError", message: privateText, stack: privateText, httpStatus: 503 },
      kind: "unknown",
    },
  ] as const;
  let calls = 0;
  try {
    for (const sample of cases) {
      globalThis.fetch = (() => {
        calls++;
        return Promise.reject(sample.error);
      }) as unknown as typeof fetch;
      const error = await apiRequest("/api/synthetic-transport", {
        method: "PATCH",
        body: "{}",
      }).then(
        () => null,
        (e: unknown) => e,
      );
      if (!(error instanceof ApiError)) throw Error("missing normalized transport failure");
      expect(error.code).toBe("UNAVAILABLE");
      expect(error.retryable).toBe(true);
      expect(error.httpStatus).toBeUndefined();
      expect(error.transportFailure).toBe(sample.kind);
      expect(error.message).toBe("연결하지 못했어요. 다시 시도해 주세요.");
      expect(JSON.stringify(error)).not.toContain(privateText);
      expect(Object.hasOwn(error, "cause")).toBe(false);
    }
    expect(calls).toBe(cases.length);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const server = await responseError(
    Response.json({ error: { code: "UNAVAILABLE", message: privateText } }, { status: 503 }),
  );
  expect(server.httpStatus).toBe(503);
  expect(server.transportFailure).toBeUndefined();
  expect(server.message).not.toContain(privateText);
});
