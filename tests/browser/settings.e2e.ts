import { spawn } from "node:child_process";
import { expect, test } from "@playwright/test";

const tag = "a".repeat(64),
  marker = "baro.account-reauth.v1";
test("settings uses real signed session, OAuth state/callback, SQL account deletion and revoked cookie", async ({
  page,
  context,
  baseURL,
}) => {
  const child = spawn(
    "bun",
    ["tests/helpers/browser-session-server.ts", baseURL ?? "", "account"],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
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
      const timeout = setTimeout(() => reject(new Error("Synthetic startup failed")), 15000);
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += String(chunk);
        if (!output.includes("\n")) return;
        clearTimeout(timeout);
        resolve(JSON.parse(output.slice(0, output.indexOf("\n"))));
      });
      child.once("error", () => {
        clearTimeout(timeout);
        reject(new Error("Synthetic startup failed"));
      });
    });
    await context.addCookies([seed.cookie]);
    await page.route("**/api/**", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (!url.pathname.startsWith("/api/")) return route.continue();
      const response = await route.fetch({
        url: `${seed.origin}${url.pathname}${url.search}`,
        headers: await request.allHeaders(),
        maxRedirects: 0,
      });
      await route.fulfill({ response });
    });
    // Only the provider exchange is synthetic. The returned state/cookie and
    // completed callback route are validated by Better Auth + real SQL.
    await page.route("https://accounts.google.com/**", async (route) => {
      const url = new URL(route.request().url());
      const callback = `${baseURL}/api/auth/callback/google?state=${encodeURIComponent(url.searchParams.get("state") ?? "")}&code=synthetic-code`;
      // Start a new navigation so Playwright's API route intercepts the callback.
      await route.fulfill({
        contentType: "text/html",
        body: `<script>location.replace(${JSON.stringify(callback)})</script>`,
      });
    });
    await page.goto("/settings");
    await page.getByRole("button", { name: "google로 재인증" }).click();
    const openDeletion = page.getByRole("button", { name: "계정과 모든 사건 삭제", exact: true });
    await expect(openDeletion).toBeEnabled();
    await openDeletion.click();
    const confirmation = page.getByLabel("삭제 확인 — DELETE 입력");
    await expect(confirmation).toBeEnabled();
    await confirmation.fill("DELETE");
    await page.getByRole("button", { name: "삭제 요청 확인", exact: true }).click();
    await expect(page.getByRole("heading", { name: "계정 삭제를 접수했어요" })).toBeVisible();
    const response = await context.request.get(`${seed.origin}/api/me/deletion`, {
      headers: { cookie: `${seed.cookie.name}=${seed.cookie.value}` },
    });
    expect(response.status()).toBe(401);
  } finally {
    child.stdin.end();
    child.kill();
  }
});
test("settings reauth needs a newer callback for same owner and a fresh explicit keyboard confirmation", async ({
  page,
  baseURL,
}) => {
  let stamp: string | null = null,
    deletes = 0;
  await page.route("**/api/me/deletion", (route) =>
    route.fulfill({
      json: {
        ownerTag: tag,
        recentOAuth: stamp !== null,
        authenticatedAt: stamp,
        providers: ["google"],
      },
    }),
  );
  await page.route("**/api/auth/sign-in/social", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      provider: "google",
      callbackURL: "/settings",
    });
    stamp = new Date(Date.now() + 20).toISOString();
    await route.fulfill({ json: { url: `${baseURL}/settings`, redirect: true } });
  });
  await page.route("**/api/me", async (route) => {
    deletes++;
    expect(route.request().postDataJSON()).toEqual({ confirmation: "DELETE" });
    await new Promise((r) => setTimeout(r, 150));
    await route.fulfill({ status: 202, json: { status: "accepted" } });
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/settings?reauth=success");
  const confirm = page.getByLabel("삭제 확인 — DELETE 입력");
  const remove = page.getByRole("button", { name: "계정과 모든 사건 삭제" });
  await expect(confirm).toHaveCount(0);
  await expect(remove).toBeDisabled();
  const auth = page.getByRole("button", { name: "google로 재인증" });
  await auth.focus();
  await page.keyboard.press("Enter");
  await expect(remove).toBeEnabled();
  await remove.click();
  await expect(confirm).toBeEnabled();
  await expect(confirm).toBeFocused();
  await page.screenshot({ path: ".wrangler/settings-320.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    document.body.style.zoom = "2";
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".wrangler/settings-200.png", fullPage: true });
  expect(deletes).toBe(0);
  await confirm.fill("DELETE");
  await page.reload();
  await expect(remove).toBeEnabled();
  await remove.click();
  await expect(confirm).toHaveValue("");
  const finish = page.getByRole("button", { name: "삭제 요청 확인", exact: true });
  await expect(finish).toBeDisabled();
  await confirm.fill("DELETE");
  await finish.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "계정 삭제를 접수했어요" })).toBeVisible();
  expect(deletes).toBe(1);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), marker)).toBeNull();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
test("loading/error/cancel, expired callback and switched account never arm deletion", async ({
  page,
}) => {
  await page.route("**/api/me/deletion", (route) => route.fulfill({ status: 503 }));
  await page.goto("/settings");
  await expect(page.getByRole("alert")).toContainText("계정 상태를 확인하지 못했어요.");
  await page.unroute("**/api/me/deletion");
  await page.route("**/api/me/deletion", (route) =>
    route.fulfill({
      json: {
        ownerTag: tag,
        recentOAuth: true,
        authenticatedAt: new Date(Date.now() - 60_000).toISOString(),
        providers: ["google"],
      },
    }),
  );
  await page.evaluate(
    ({ key, ownerTag }) =>
      sessionStorage.setItem(key, JSON.stringify({ ownerTag, startedAt: Date.now() })),
    { key: marker, ownerTag: tag },
  );
  await page.reload();
  await expect(page.getByRole("button", { name: "google로 재인증" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "계정과 모든 사건 삭제", exact: true }),
  ).toBeDisabled();
  await page.evaluate(
    (key) =>
      sessionStorage.setItem(
        key,
        JSON.stringify({ ownerTag: "b".repeat(64), startedAt: Date.now() - 120_000 }),
      ),
    marker,
  );
  await page.reload();
  await expect(page.getByRole("alert")).toContainText(
    "다른 계정으로 인증했어요. 삭제할 계정으로 다시 로그인해 주세요.",
  );
  await expect(
    page.getByRole("button", { name: "계정과 모든 사건 삭제", exact: true }),
  ).toBeDisabled();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), marker)).toBeNull();
});

test("a previous page's late access failure cannot erase the next OAuth reauthentication marker", async ({
  page,
}) => {
  let pause = false;
  let held: import("@playwright/test").Route | undefined;
  let signal: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    signal = resolve;
  });
  await page.route("**/api/me/deletion", async (route) => {
    if (pause) {
      held = route;
      signal?.();
      return;
    }
    await route.fulfill({
      json: {
        ownerTag: tag,
        recentOAuth: true,
        authenticatedAt: new Date(Date.now() + 60).toISOString(),
        providers: ["google"],
      },
    });
  });
  await page.goto("/settings");
  await expect(page.getByRole("button", { name: "다시 확인" })).toBeEnabled();
  pause = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await pending;
  const nextMarker = JSON.stringify({ ownerTag: tag, startedAt: Date.now() });
  await page.evaluate(
    ({ key, value }) => {
      window.dispatchEvent(new PageTransitionEvent("pagehide"));
      sessionStorage.setItem(key, value);
    },
    { key: marker, value: nextMarker },
  );
  if (!held) throw new Error("Synthetic pending access read missing");
  await held.fulfill({ status: 503 });
  await expect
    .poll(() => page.evaluate((key) => sessionStorage.getItem(key), marker))
    .toBe(nextMarker);
  pause = false;
  await page.reload();
  await expect(
    page.getByRole("button", { name: "계정과 모든 사건 삭제", exact: true }),
  ).toBeEnabled();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), marker)).toBe(nextMarker);
});

test("late OAuth request failure after leaving preserves the next ticket; back navigation still requires a fresh callback", async ({
  page,
}) => {
  let held: import("@playwright/test").Route | undefined;
  let signal: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    signal = resolve;
  });
  await page.route("**/api/me/deletion", (route) =>
    route.fulfill({
      json: {
        ownerTag: tag,
        recentOAuth: true,
        authenticatedAt: new Date(Date.now() - 60_000).toISOString(),
        providers: ["google"],
      },
    }),
  );
  await page.route("**/api/auth/sign-in/social", (route) => {
    held = route;
    signal?.();
  });
  await page.goto("/settings");
  await expect(page.getByRole("button", { name: "다시 확인" })).toBeEnabled();
  await page.getByRole("button", { name: "google로 재인증" }).click();
  await pending;
  const nextMarker = JSON.stringify({ ownerTag: tag, startedAt: Date.now() });
  await page.evaluate(
    ({ key, value }) => {
      window.dispatchEvent(new PageTransitionEvent("pagehide"));
      sessionStorage.setItem(key, value);
    },
    { key: marker, value: nextMarker },
  );
  if (!held) throw new Error("Synthetic pending OAuth request missing");
  await held.fulfill({ status: 503, json: { error: { message: "synthetic unavailable" } } });
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })),
  );
  await expect(page.getByRole("button", { name: "다시 확인" })).toBeEnabled();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), marker)).toBe(nextMarker);
  await expect(
    page.getByRole("button", { name: "계정과 모든 사건 삭제", exact: true }),
  ).toBeDisabled();
});
