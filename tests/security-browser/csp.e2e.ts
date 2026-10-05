import { expect, test } from "@playwright/test";

test("built Worker hash CSP blocks injected script while React and allowlisted Turnstile script work", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as { injected: number; blocked: number; challengeLoaded: boolean };
    w.injected = 0;
    w.blocked = 0;
    w.challengeLoaded = false;
    document.addEventListener("securitypolicyviolation", () => w.blocked++);
  });
  const response = await page.goto("/login");
  expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  const policy = response?.headers()["content-security-policy"];
  expect(policy).toContain("sha256-");
  expect(policy).toContain("https://challenges.cloudflare.com");
  expect(policy).not.toMatch(/unsafe-inline|unsafe-eval/);
  await page.route("**/api/auth/sign-in/social", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  const button = page.getByRole("button", { name: /Google/ });
  await button.press("Enter");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(button).toBeEnabled();
  await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.injected=1";
    document.body.appendChild(script);
  });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { blocked: number }).blocked))
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as unknown as { injected: number }).injected)).toBe(0);
  await page.route(
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
    (route) =>
      route.fulfill({ contentType: "application/javascript", body: "window.challengeLoaded=true" }),
  );
  await page.evaluate(() => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    document.body.appendChild(script);
  });
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { challengeLoaded: boolean }).challengeLoaded),
    )
    .toBe(true);
});
