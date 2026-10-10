import { spawn } from "node:child_process";
import { expect, test } from "@playwright/test";
import { CURRENT_POLICY_VERSIONS } from "../../src/contracts/consent";

for (const role of ["customer", "lawyer"] as const) {
  test(`settings loads ${role} resources and offers legacy cases their existing detail`, async ({
    page,
  }) => {
    let caseReads = 0;
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (!path.startsWith("/api/")) return route.continue();
      if (path === "/api/me/session")
        return route.fulfill({
          json: {
            user: { id: "synthetic-owner", name: "Synthetic", accountType: role },
            needsConsent: false,
          },
        });
      if (path === "/api/me/deletion")
        return route.fulfill({
          json: {
            ownerTag: "a".repeat(64),
            recentOAuth: false,
            authenticatedAt: null,
            providers: ["google"],
          },
        });
      if (path.endsWith("/usage"))
        return route.fulfill({
          json: {
            newCases: { used: 0, limit: 3 },
            aiResponses: { used: 0, limit: 200 },
            mediaMinutes: { used: 0, limit: 60 },
            storageBytes: { used: 0, limit: 10000000000 },
          },
        });
      if (path === "/api/cases") {
        caseReads++;
        return route.fulfill({
          json: {
            items: [
              {
                id: "11111111-1111-4111-8111-111111111111",
                title: "Synthetic legacy case",
                status: "completed",
                createdAt: "2026-10-10T00:00:00Z",
                updatedAt: "2026-10-10T00:00:00Z",
              },
            ],
            nextCursor: null,
          },
        });
      }
      if (path === "/api/v2/cases") {
        caseReads++;
        return route.fulfill({ json: { items: [], nextCursor: null, previews: [] } });
      }
      return route.fulfill({ status: 404, json: {} });
    });
    await page.goto("/settings");
    await expect(page.getByRole("button", { name: "google로 재인증" })).toBeEnabled();
    await expect(page.getByRole("alert")).toHaveCount(0);
    if (role === "lawyer") {
      expect(caseReads).toBe(0);
      await expect(page.getByRole("region", { name: "보관한 사건" })).toHaveCount(0);
    } else {
      expect(caseReads).toBeGreaterThanOrEqual(2);
      await expect(
        page.getByRole("link", { name: "Synthetic legacy case", exact: true }),
      ).toHaveAttribute("href", "/cases/11111111-1111-4111-8111-111111111111");
      await expect(page.getByRole("link", { name: /리포트 확인/ })).toHaveCount(0);
    }
  });
}

test("failed OAuth start clears the selected role without rewriting an existing customer session", async ({
  page,
}) => {
  let writes = 0;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/me/session")
      return route.fulfill({
        json: {
          user: { id: "synthetic-owner", name: "Synthetic", accountType: "customer" },
          needsConsent: false,
        },
      });
    if (path === "/api/me/account-type") {
      writes++;
      return route.fulfill({ json: { accountType: "lawyer" } });
    }
    if (path.includes("sign-in/social"))
      return route.fulfill({
        status: 503,
        json: { code: "PROVIDER_UNAVAILABLE", message: "Synthetic provider unavailable" },
      });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("/login");
  await page.getByRole("radio", { name: "변호사", exact: true }).check();
  await page.getByRole("button", { name: "Google로 계속하기", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("로그인을 시작하지 못했어요");
  expect(await page.evaluate(() => sessionStorage.getItem("baro-account-type"))).toBeNull();
  await page.goto("/lawyer");
  await expect(page.getByText("변호사 역할로 로그인해 주세요.", { exact: true })).toBeVisible();
  expect(writes).toBe(0);
});

test("successful OAuth return consumes its selected role once and preserves returnTo", async ({
  page,
}) => {
  let writes = 0;
  let callback = "";
  let role = "customer";
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/me/session")
      return route.fulfill({
        json: {
          user: { id: "synthetic-owner", name: "Synthetic", accountType: role },
          needsConsent: false,
        },
      });
    if (path === "/api/me/consent")
      return route.fulfill({
        json: {
          required: { ...CURRENT_POLICY_VERSIONS, over14Confirmed: true },
          consent: null,
          needsConsent: false,
        },
      });
    if (path === "/api/me/account-type") {
      writes++;
      role = route.request().postDataJSON().accountType;
      return route.fulfill({ json: { accountType: role } });
    }
    if (path.includes("sign-in/social")) {
      callback = route.request().postDataJSON().callbackURL;
      return route.fulfill({
        json: { url: new URL(callback, route.request().url()).href, redirect: true },
      });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("/login?returnTo=/settings");
  await page.getByRole("radio", { name: "변호사", exact: true }).check();
  await page.getByRole("button", { name: "Google로 계속하기", exact: true }).click();
  await expect(page).toHaveURL(/\/consent\?.*loginAttempt=/);
  await expect.poll(() => writes).toBe(1);
  expect(new URL(callback, "http://localhost").searchParams.get("returnTo")).toBe("/settings");
  expect(role).toBe("lawyer");
  expect(await page.evaluate(() => sessionStorage.getItem("baro-account-type"))).toBeNull();
  const after = writes;
  await page.reload();
  await expect(page.getByRole("link", { name: "내 화면으로 계속하기" })).toHaveAttribute(
    "href",
    "/settings",
  );
  expect(writes).toBe(after);
});

test("a temporary session lookup outage preserves report edits and explicit signout clears them", async ({
  page,
}) => {
  let outage = false;
  let failures = 0;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/me/session") {
      if (outage) {
        failures++;
        return route.fulfill({
          status: 503,
          json: {
            error: {
              code: "DEPENDENCY_UNAVAILABLE",
              message: "Synthetic session outage",
              retryable: true,
            },
          },
        });
      }
      return route.fulfill({
        json: {
          user: { id: "synthetic-owner", name: "Synthetic", accountType: "customer" },
          needsConsent: false,
        },
      });
    }
    if (path.endsWith("/files")) return route.fulfill({ json: [] });
    if (path.endsWith("/reports"))
      return route.fulfill({
        json: {
          id: "synthetic-report",
          caseId: "synthetic-report-outage",
          revision: 1,
          title: "Synthetic report",
          content: "Saved report",
          updatedAt: "2026-10-10T00:00:00Z",
          stale: false,
          excludedFileIds: [],
          maskIdentifiers: false,
          pdfAvailable: false,
        },
      });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("/cases/synthetic-report-outage/reports");
  const editor = page.getByRole("textbox", { name: "리포트 내용 편집" });
  await expect(editor).toHaveValue("Saved report");
  await editor.fill("Unsaved report correction");
  outage = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => failures).toBeGreaterThan(0);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(editor).toHaveValue("Unsaved report correction");
  await page.getByRole("button", { name: "다시 확인", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "저장 내용을 다시 불러올까요?" })).toBeVisible();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(editor).toHaveValue("Unsaved report correction");
  outage = false;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(editor).toHaveValue("Unsaved report correction");
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("baro-session-changed", { detail: { reason: "signout" } }),
    ),
  );
  await expect(editor).toHaveCount(0);
});

test("normal OAuth state/callback and SQL session apply the chosen lawyer role on return", async ({
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
    await page.goto("/login?returnTo=/settings");
    await page.getByRole("radio", { name: "변호사", exact: true }).check();
    await page.getByRole("button", { name: "Google로 계속하기", exact: true }).click();
    await expect(page).toHaveURL(/\/consent\?.*loginAttempt=/);
    await expect
      .poll(async () => {
        const response = await context.request.get(`${seed.origin}/api/me/session`, {
          headers: { cookie: `${seed.cookie.name}=${seed.cookie.value}` },
        });
        return (await response.json()).user?.accountType;
      })
      .toBe("lawyer");
    expect(await page.evaluate(() => sessionStorage.getItem("baro-account-type"))).toBeNull();
    await page.getByRole("checkbox", { name: /이용약관, 개인정보 처리방침/ }).check();
    await page.getByRole("checkbox", { name: "만 14세 이상입니다." }).check();
    await page.getByRole("button", { name: "동의하고 계속하기" }).click();
    await expect(page.getByRole("link", { name: "내 화면으로 계속하기" })).toHaveAttribute(
      "href",
      "/settings",
    );
  } finally {
    child.stdin.end();
    child.kill();
  }
});

test("a confirmed account change clears the report draft and explains why", async ({ page }) => {
  let ownerId = "synthetic-owner";
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/me/session")
      return route.fulfill({
        json: {
          user: { id: ownerId, name: "Synthetic", accountType: "customer" },
          needsConsent: false,
        },
      });
    if (path.endsWith("/files")) return route.fulfill({ json: [] });
    if (path.endsWith("/reports"))
      return route.fulfill({
        json: {
          id: "synthetic-report",
          caseId: "synthetic-report-switch",
          revision: 1,
          title: "Synthetic report",
          content: "Saved report",
          updatedAt: "2026-10-10T00:00:00Z",
          stale: false,
          excludedFileIds: [],
          maskIdentifiers: false,
          pdfAvailable: false,
        },
      });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("/cases/synthetic-report-switch/reports");
  const editor = page.getByRole("textbox", { name: "리포트 내용 편집" });
  await expect(editor).toHaveValue("Saved report");
  await editor.fill("Unsaved report correction");
  ownerId = "synthetic-next-owner";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("계정 또는 접근 상태가 변경됐어요.");
});
