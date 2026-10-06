import { spawn } from "node:child_process";
import { expect, test } from "@playwright/test";

test("signed SQL session completes the real consent API through the browser, then logout removes access", async ({
  page,
  context,
  baseURL,
}) => {
  const child = spawn("bun", ["tests/helpers/browser-session-server.ts", baseURL ?? ""], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  try {
    const seed = await new Promise<{
      origin: string;
      cookie: {
        name: string;
        value: string;
        url: string;
        httpOnly: boolean;
        secure: boolean;
        sameSite: "Lax";
      };
    }>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Synthetic session server did not start")),
        15_000,
      );
      let output = "";
      child.once("error", () => {
        clearTimeout(timeout);
        reject(new Error("Synthetic session server could not start"));
      });
      child.once("exit", () => {
        clearTimeout(timeout);
        reject(new Error("Synthetic session server exited before startup"));
      });
      child.stdout.on("data", (chunk) => {
        output += String(chunk);
        if (!output.includes("\n")) return;
        clearTimeout(timeout);
        try {
          resolve(JSON.parse(output.slice(0, output.indexOf("\n"))));
        } catch {
          reject(new Error("Invalid synthetic server handshake"));
        }
      });
    });
    await context.addCookies([seed.cookie]);
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (!path.startsWith("/api/")) return route.continue();
      const response = await route.fetch({
        url: `${seed.origin}${path}`,
        headers: await request.allHeaders(),
      });
      await route.fulfill({ response });
    });
    await page.goto("/consent");
    await expect(page.getByRole("button", { name: "동의하고 계속하기" })).toBeDisabled();
    await page.getByRole("checkbox").nth(0).check();
    await page.getByRole("checkbox").nth(1).check();
    await page.getByRole("button", { name: "동의하고 계속하기" }).click();
    await expect(page.getByRole("link", { name: "내 화면으로 계속하기" })).toBeVisible();
    const saved = await page.evaluate(async () => (await fetch("/api/me/consent")).json());
    expect(saved).toMatchObject({ needsConsent: false });
    const signedOut = await page.evaluate(
      async () =>
        (
          await fetch("/api/auth/sign-out", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          })
        ).status,
    );
    expect(signedOut).toBe(200);
    expect((await context.cookies()).some(({ name }) => name === seed.cookie.name)).toBe(false);
    const replay = await context.request.get(`${seed.origin}/api/me/consent`, {
      headers: { cookie: `${seed.cookie.name}=${seed.cookie.value}` },
    });
    expect(replay.status()).toBe(401);
    await page.reload();
    await expect(page).toHaveURL(/\/login\?error=session_expired$/);
  } finally {
    child.stdin.end();
    child.kill();
  }
});

test("persisted role changes invalidate peer navigation without sharing session data", async ({
  page,
  context,
}) => {
  let accountType = "customer";
  await context.route("**/api/me/session", (route) =>
    route.fulfill({
      json: {
        user: { id: "synthetic-owner", name: "합성 이용자", accountType },
        needsConsent: false,
      },
    }),
  );
  await context.route("**/api/cases", (route) => route.fulfill({ json: { cases: [] } }));
  await context.route("**/api/me/account-type", async (route) => {
    accountType = route.request().postDataJSON().accountType;
    await route.fulfill({ json: { accountType } });
  });
  await context.route("**/api/me/consent", (route) =>
    route.fulfill({ json: { needsConsent: false } }),
  );
  await page.goto("/login");
  const peer = await context.newPage();
  await peer.goto("/");
  const peerNav = peer.getByRole("navigation", { name: "주 메뉴" });
  await expect(peerNav.getByRole("link", { name: "내 사건", exact: true })).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem("baro-account-type", "lawyer"));
  await page.goto("/consent");
  await expect(page.getByRole("link", { name: "내 화면으로 계속하기" })).toBeVisible();
  await expect(peerNav.getByRole("link", { name: "변호사 프로필", exact: true })).toBeVisible();
  await expect(peerNav.getByRole("link", { name: "내 사건", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("baro-session-changed"))).toMatch(
    /^[0-9a-f-]{36}$/,
  );
  await peer.close();
});
