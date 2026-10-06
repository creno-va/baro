import { expect, test } from "bun:test";
import { responseError } from "./core";

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
  expect((await responseError(new Response("untrusted raw detail", { status: 403 }))).code).toBe(
    "VALIDATION_ERROR",
  );
});
