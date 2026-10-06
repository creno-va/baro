import { expect, test } from "bun:test";
import { cacheClient, responseError } from "./core";

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
