import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __syntheticBridge: string[];
    ReactNativeWebView: { postMessage(data: string): void };
    __baroChallengeConnect(secret: string): void;
    __syntheticToken(token: string): void;
    __syntheticError(): void;
    __syntheticExpired(): void;
    __syntheticOptions: { sitekey: string; action: string; size: string };
    __syntheticUntrusted?: boolean;
  }
}
const id = "71e770bb-933a-450a-9fe3-512710a708bc",
  secret = "s".repeat(43);
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__syntheticBridge = [];
    window.ReactNativeWebView = { postMessage: (data) => window.__syntheticBridge.push(data) };
  });
  // Only provider JavaScript is synthetic. Product HTML, bridge, headers and CSP execute unchanged.
  await page.route("https://challenges.cloudflare.com/**", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.turnstile={render(element,options){
      window.__syntheticOptions={sitekey:options.sitekey,action:options.action,size:options.size};
      window.__syntheticToken=options.callback;
      window.__syntheticError=options["error-callback"];
      window.__syntheticExpired=options["expired-callback"];
      element.textContent="합성 보안 위젯";
    }};`,
    }),
  );
});

test("real CSP allows the nonce bootstrap and defers proof until the native secret arrives", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 680 });
  const response = await page.goto(`/api/mobile/challenge?attemptId=${id}`);
  expect(response?.headers()["content-security-policy"]).not.toContain("unsafe-inline");
  await expect(page.getByText("합성 보안 위젯")).toBeVisible();
  expect(await page.evaluate(() => window.__syntheticOptions)).toEqual({
    sitekey: "synthetic-site-key",
    action: "case_create",
    size: "compact",
  });
  await page.evaluate(() => {
    window.__syntheticToken("synthetic-provider-token");
    const script = document.createElement("script");
    script.textContent = "window.__syntheticUntrusted=true";
    document.body.appendChild(script);
  });
  expect(await page.evaluate(() => window.__syntheticUntrusted)).toBeUndefined();
  expect(await page.evaluate(() => window.__syntheticBridge.map((x) => JSON.parse(x)))).toEqual([
    { type: "ready", attemptId: id },
  ]);
  await page.evaluate((value) => window.__baroChallengeConnect(value), secret);
  expect(await page.evaluate(() => window.__syntheticBridge.map((x) => JSON.parse(x)))).toEqual([
    { type: "ready", attemptId: id },
    { type: "token", attemptId: id, secret, token: "synthetic-provider-token" },
  ]);
  await page.evaluate(() => window.__syntheticToken("late-token"));
  expect(await page.evaluate(() => window.__syntheticBridge.length)).toBe(2);
  expect(page.url()).not.toContain(secret);
  expect(page.url()).not.toContain("provider-token");
});

for (const reason of ["failed", "expired"] as const)
  test(`provider ${reason} emits a bounded error after handshake`, async ({ page }) => {
    await page.goto(`/api/mobile/challenge?attemptId=${id}`);
    await expect(page.getByText("합성 보안 위젯")).toBeVisible();
    await page.evaluate((value) => window.__baroChallengeConnect(value), secret);
    await page.evaluate((kind) => {
      if (kind === "failed") window.__syntheticError();
      else window.__syntheticExpired();
    }, reason);
    expect(await page.evaluate(() => JSON.parse(window.__syntheticBridge[1] ?? "null"))).toEqual({
      type: "error",
      attemptId: id,
      secret,
      reason,
    });
    await expect(page.getByRole("status")).toHaveText(
      "보안 확인이 끝나지 않았어요. 앱에서 다시 시도해 주세요.",
    );
  });

test("provider load failure also settles through the same private handshake", async ({ page }) => {
  await page.unroute("https://challenges.cloudflare.com/**");
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.goto(`/api/mobile/challenge?attemptId=${id}`);
  await expect(page.getByRole("status")).toHaveText(
    "보안 확인이 끝나지 않았어요. 앱에서 다시 시도해 주세요.",
  );
  await page.evaluate((value) => window.__baroChallengeConnect(value), secret);
  expect(await page.evaluate(() => JSON.parse(window.__syntheticBridge[1] ?? "null"))).toEqual({
    type: "error",
    attemptId: id,
    secret,
    reason: "unavailable",
  });
});
