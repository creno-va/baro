import { expect, test } from "bun:test";
import { createMobileChallengeApi } from "../src/server/api/mobile-challenge";

const attemptId = "15a64c18-fd51-4f83-8205-4c917a245e6b";
test("the public widget page uses a fresh nonce/CSP without reading or reflecting auth and private input", async () => {
  const app = createMobileChallengeApi({ siteKey: "synthetic-public-key" });
  const page = await app.request(`/challenge?attemptId=${attemptId}`, {
    headers: { cookie: "SYNTHETIC_PRIVATE_SESSION" },
  });
  expect(page.status).toBe(200);
  const body = await page.text(),
    csp = page.headers.get("content-security-policy") ?? "";
  const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
  expect(nonce).toBeTruthy();
  expect(body).toContain(`nonce="${nonce}"`);
  expect(body).toContain("synthetic-public-key");
  expect(body).toContain("case_create");
  expect(body).toContain("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit");
  expect(body).not.toContain("SYNTHETIC_PRIVATE_SESSION");
  expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(page.headers.get("cache-control")).toContain("no-store");
  expect(page.headers.get("x-frame-options")).toBe("DENY");
  expect(page.headers.get("set-cookie")).toBeNull();
  const next = await app.request(`/challenge?attemptId=${attemptId}`);
  expect(next.headers.get("content-security-policy")).not.toBe(csp);
});
test("unknown, repeated and malformed intent fields and missing/malicious site keys cannot render a widget", async () => {
  const app = createMobileChallengeApi({ siteKey: "synthetic-public-key" });
  for (const query of [
    "",
    "attemptId=invalid",
    `attemptId=${attemptId}&attemptId=${attemptId}`,
    `attemptId=${attemptId}&cookie=SYNTHETIC_PRIVATE`,
    "attemptId=%3Cscript%3E",
  ]) {
    const response = await app.request(`/challenge?${query}`);
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("SYNTHETIC_PRIVATE");
  }
  for (const siteKey of [undefined, "", "</script><script>alert(1)</script>"]) {
    const response = await createMobileChallengeApi({ siteKey }).request(
      `/challenge?attemptId=${attemptId}`,
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/json");
  }
});
