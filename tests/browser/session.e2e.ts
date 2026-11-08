import { spawn } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";

async function startSignedSessionServer(baseURL: string, mode?: "cases") {
  const child = spawn(
    "bun",
    ["tests/helpers/browser-session-server.ts", baseURL, ...(mode ? [mode] : [])],
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
    return { child, seed };
  } catch (error) {
    child.stdin.end();
    child.kill();
    throw error;
  }
}

test("signed SQL session completes the real consent API through the browser, then logout removes access", async ({
  page,
  context,
  baseURL,
}) => {
  const { child, seed } = await startSignedSessionServer(baseURL ?? "");
  try {
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
    await expect(page.getByRole("checkbox")).toHaveCount(1);
    await page.getByRole("checkbox").nth(0).check();
    await page.getByRole("button", { name: "동의하고 계속하기" }).click();
    await expect(page).toHaveURL(/\/app$/);
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
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fapp(?:&error=session_expired)?$/);
  } finally {
    child.stdin.end();
    child.kill();
  }
});

test("persisted SQL role changes reauthorize peers while preserving common case access", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const { child, seed } = await startSignedSessionServer(baseURL ?? "", "cases");
  let peer: Page | undefined;
  try {
    const peerSessions: Array<{ id: string; accountType: string }> = [];
    const retiredRequests: string[] = [];
    let browserRoleWrites = 0;
    await context.route("**/api/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (!url.pathname.startsWith("/api/")) return route.continue();
      if (/^\/api\/(?:v2\/)?lawyers?(?:\/|$)/.test(url.pathname))
        retiredRequests.push(url.pathname);
      if (url.pathname === "/api/me/account-type" && request.method() === "PUT")
        browserRoleWrites++;
      const response = await route.fetch({
        url: `${seed.origin}${url.pathname}${url.search}`,
        headers: await request.allHeaders(),
      });
      if (url.pathname === "/api/me/session" && request.frame().page() === peer) {
        const value = await response.json();
        if (value.user)
          peerSessions.push({ id: value.user.id, accountType: value.user.accountType });
      }
      await route.fulfill({ response });
    });
    await page.goto("/login");
    await expect(
      page.getByRole("button", { name: "Google로 계속하기", exact: true }),
    ).toBeEnabled();
    await expect(page.getByRole("radio", { name: "변호사", exact: true })).toHaveCount(0);
    await context.addCookies([seed.cookie]);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/app$/);
    peer = await context.newPage();
    await peer.goto("/app");
    const peerNav = peer.getByRole("navigation", { name: "주 메뉴", exact: true });
    await expect(peerNav.getByRole("link", { name: "새 사건 입력", exact: true })).toBeVisible();
    await expect(peer.getByRole("textbox", { name: "지금까지 있었던 일" })).toBeEnabled();
    await expect.poll(() => peerSessions.at(-1)?.accountType).toBe("customer");
    const original = peerSessions.at(-1);
    if (!original) throw new Error("Missing signed peer session");
    // The real notification carries only an opaque UUID. It triggers a fresh
    // server read and cannot grant a role before SQL has changed.
    const notifyPeer = () =>
      page.evaluate(async () => {
        const modulePath = "/src/client/session-events.ts";
        const { notifySessionChanged } = await import(modulePath);
        notifySessionChanged();
      });
    const initialReads = peerSessions.length;
    await notifyPeer();
    await expect.poll(() => peerSessions.length).toBeGreaterThan(initialReads);
    expect(peerSessions.at(-1)).toEqual(original);

    const isolated = await browser.newContext();
    try {
      const denied = await isolated.request.put(`${seed.origin}/api/me/account-type`, {
        headers: { origin: baseURL ?? "" },
        data: { accountType: "lawyer" },
      });
      expect(denied.status()).toBe(401);
    } finally {
      await isolated.close();
    }
    // An existing installed client may still use this authenticated API. The
    // web UI neither exposes role switching nor rewrites the stored account.
    const changed = await context.request.put(`${seed.origin}/api/me/account-type`, {
      headers: { origin: baseURL ?? "" },
      data: { accountType: "lawyer" },
    });
    expect(changed.status()).toBe(200);
    expect(await changed.json()).toEqual({ accountType: "lawyer" });
    const readsBeforeChange = peerSessions.length;
    await notifyPeer();
    await expect.poll(() => peerSessions.length).toBeGreaterThan(readsBeforeChange);
    await expect
      .poll(() => peerSessions.at(-1))
      .toEqual({ id: original.id, accountType: "lawyer" });
    expect(await page.evaluate(() => localStorage.getItem("baro-session-changed"))).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    await peer.reload();
    await expect(peer).toHaveURL(/\/app$/);
    await expect(peerNav.getByRole("link", { name: "새 사건 입력", exact: true })).toBeVisible();
    await expect(peerNav.getByRole("link", { name: "내 사건", exact: true })).toHaveAttribute(
      "href",
      "/cases",
    );
    await expect(peer.getByRole("textbox", { name: "지금까지 있었던 일" })).toBeEnabled();
    expect(
      await peer.evaluate(async () => {
        const response = await fetch("/api/cases");
        return response.status;
      }),
    ).toBe(200);
    await expect(
      peer.locator(
        'a[href="/lawyer"], a[href^="/lawyer/"], a[href="/lawyers"], a[href^="/lawyers/"]',
      ),
    ).toHaveCount(0);
    await expect(
      peer.getByRole("link", { name: /변호사 프로필|변호사 찾기|변호사 등록/ }),
    ).toHaveCount(0);
    expect(peerSessions.at(-1)).toEqual({ id: original.id, accountType: "lawyer" });
    expect(browserRoleWrites).toBe(0);
    expect(retiredRequests).toEqual([]);
  } finally {
    await peer?.close();
    child.stdin.end();
    child.kill();
  }
});
