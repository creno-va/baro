import { spawn } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";
import { CURRENT_POLICY_VERSIONS } from "../../src/contracts/consent";
import { openReportEditor } from "../helpers/report-controls";

async function trackSessionReads(page: Page) {
  await page.evaluate(async () => {
    const path = "/src/client/api/session.ts";
    const { sessionApi } = (await import(path)) as typeof import("../../src/client/api/session");
    const tracker = window as unknown as {
      accountSessionReads: { calls: number; settled: number };
    };
    tracker.accountSessionReads = { calls: 0, settled: 0 };
    const get = sessionApi.get;
    sessionApi.get = async (...args: Parameters<typeof get>) => {
      tracker.accountSessionReads.calls++;
      try {
        return await get(...args);
      } finally {
        tracker.accountSessionReads.settled++;
      }
    };
  });
  return () =>
    page.evaluate(() => {
      const { calls, settled } = (
        window as unknown as { accountSessionReads: { calls: number; settled: number } }
      ).accountSessionReads;
      return { calls, pending: calls - settled };
    });
}

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
  // A returnTo=/settings query also ends with /settings. Wait for the actual
  // destination pathname before reloading so callback navigation can finish.
  await page.waitForURL((url) => url.pathname === "/settings", { waitUntil: "load" });
  await expect(page).toHaveURL((url) => url.pathname === "/settings");
  await expect.poll(() => writes).toBe(1);
  expect(new URL(callback, "http://localhost").searchParams.get("returnTo")).toBe("/settings");
  expect(role).toBe("lawyer");
  expect(await page.evaluate(() => sessionStorage.getItem("baro-account-type"))).toBeNull();
  const after = writes;
  await page.reload();
  await expect(page).toHaveURL((url) => url.pathname === "/settings");
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
  await openReportEditor(page);
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
    await expect(page).toHaveURL(/\/settings$/);
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
  await openReportEditor(page);
  const editor = page.getByRole("textbox", { name: "리포트 내용 편집" });
  await expect(editor).toHaveValue("Saved report");
  await editor.fill("Unsaved report correction");
  ownerId = "synthetic-next-owner";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("계정 또는 접근 상태가 변경됐어요.");
});

for (const lateResponse of ["failure", "signed-out"] as const) {
  test(`a superseded ${lateResponse} focus response preserves the current report draft`, async ({
    page,
  }) => {
    let phase: "ready" | "late" | "current" = "ready";
    let ownerId = "synthetic-owner";
    let held = 0;
    let settled = 0;
    let fresh = 0;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (!path.startsWith("/api/")) return route.continue();
      if (path === "/api/me/session") {
        if (phase === "late") {
          held++;
          await gate;
          if (lateResponse === "failure") {
            await route.fulfill({
              status: 503,
              json: {
                error: {
                  code: "DEPENDENCY_UNAVAILABLE",
                  message: "Synthetic old outage",
                  retryable: true,
                },
              },
            });
          } else {
            await route.fulfill({ json: { user: null, needsConsent: false } });
          }
          settled++;
          return;
        }
        if (phase === "current") fresh++;
        return route.fulfill({
          json: {
            user: { id: ownerId, name: "Synthetic", accountType: "customer" },
            needsConsent: false,
          },
        });
      }
      if (path.endsWith("/files")) return route.fulfill({ json: [] });
      if (path.endsWith("/reports"))
        return route.fulfill({
          json: {
            id: "synthetic-report",
            caseId: "synthetic-report-late",
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
    try {
      await page.goto("/cases/synthetic-report-late/reports");
      await openReportEditor(page);
      const editor = page.getByRole("textbox", { name: "리포트 내용 편집" });
      await expect(editor).toHaveValue("Saved report");
      await editor.fill("Unsaved current report correction");
      const sessionReads = await trackSessionReads(page);
      phase = "late";
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      // Shell and report must both verify, while sharing one pending HTTP read.
      await expect.poll(async () => (await sessionReads()).calls).toBeGreaterThanOrEqual(2);
      await expect.poll(() => held).toBe(1);
      const firstWave = await sessionReads();
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect
        .poll(async () => (await sessionReads()).calls)
        .toBeGreaterThanOrEqual(firstWave.calls + 2);
      expect(held).toBe(1);
      expect(fresh).toBe(0);
      await expect(page.getByRole("main").getByRole("status")).toContainText(
        "계정 접근 상태 확인 중…",
      );
      // Foreground revalidation preserves the known owner's draft read-only.
      // Explicit owner revocation below must still purge it completely.
      await expect(editor).toHaveValue("Unsaved current report correction");
      await expect(editor).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "검토 내용 저장", exact: true }),
      ).toBeDisabled();
      phase = "current";
      // An explicit peer invalidation bypasses the old pending read. Focus alone
      // cannot create a newer authoritative response while that read is pending.
      await page.evaluate(() =>
        window.dispatchEvent(
          new StorageEvent("storage", {
            key: "baro-session-changed",
            newValue: "synthetic-report-session-invalidation",
          }),
        ),
      );
      await expect.poll(() => fresh).toBeGreaterThan(0);
      await expect(page.getByRole("button", { name: "검토 내용 저장", exact: true })).toBeEnabled();
      release();
      await expect.poll(() => settled).toBe(1);
      await expect.poll(async () => (await sessionReads()).pending).toBe(0);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(editor).toHaveValue("Unsaved current report correction");
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "검토 내용 저장", exact: true })).toBeEnabled();
      const recoveredReads = fresh;
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect.poll(() => fresh).toBeGreaterThan(recoveredReads);
      await expect.poll(async () => (await sessionReads()).pending).toBe(0);
      await expect(editor).toHaveValue("Unsaved current report correction");
      await expect(page.getByRole("button", { name: "검토 내용 저장", exact: true })).toBeEnabled();
      // Sharing is limited to in-flight reads: a later real owner change still
      // revokes the editor rather than reusing the recovered owner's permission.
      ownerId = "synthetic-next-owner";
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(editor).toHaveCount(0);
      await expect(page.getByRole("alert")).toContainText("계정 또는 접근 상태가 변경됐어요.");
      await expect(page.getByRole("button", { name: "검토 내용 저장", exact: true })).toHaveCount(
        0,
      );
    } finally {
      release();
    }
  });
}

for (const failure of ["http", "network", "invalid-json"] as const) {
  test(
    "obsolete settings session failure preserves the recovered view: " + failure,
    async ({ page }) => {
      let fresh = 0;
      let deletionReads = 0,
        held = false,
        settled = false,
        release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      await page.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (!path.startsWith("/api/")) return route.continue();
        if (path === "/api/me/deletion") {
          deletionReads++;
          return route.fulfill({
            json: {
              ownerTag: "a".repeat(64),
              recentOAuth: false,
              authenticatedAt: null,
              providers: ["google"],
            },
          });
        }
        if (path === "/api/me/session") {
          if (deletionReads > 0 && !held) {
            held = true;
            await gate;
            if (failure === "network") await route.abort("failed");
            else if (failure === "invalid-json")
              await route.fulfill({ body: "broken", contentType: "application/json" });
            else
              await route.fulfill({
                status: 503,
                json: { error: { code: "INTERNAL_ERROR", retryable: true } },
              });
            settled = true;
            return;
          }
          if (held) fresh++;
          return route.fulfill({
            json: {
              user: { id: "synthetic-owner", name: "Synthetic", accountType: "customer" },
              needsConsent: false,
            },
          });
        }
        if (path.endsWith("/usage"))
          return route.fulfill({
            json: {
              newCases: { used: 0, limit: 3 },
              aiResponses: { used: 0, limit: 200 },
              mediaMinutes: { used: 0, limit: 60 },
              storageBytes: { used: 0, limit: 10000000000 },
            },
          });
        if (path === "/api/cases")
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
        if (path === "/api/v2/cases")
          return route.fulfill({ json: { items: [], nextCursor: null, previews: [] } });
        return route.fulfill({ status: 404, json: {} });
      });
      try {
        await page.goto("/settings");
        await expect.poll(() => held).toBe(true);
        const sessionReads = await trackSessionReads(page);
        await page.evaluate(() => {
          window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
          window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
        });
        // Restoring the page participates in session verification but shares the
        // held HTTP request until an explicit account invalidation arrives.
        await expect.poll(async () => (await sessionReads()).calls).toBeGreaterThan(0);
        expect(fresh).toBe(0);
        const sharedReads = await sessionReads();
        await page.evaluate(() => {
          window.dispatchEvent(
            new StorageEvent("storage", {
              key: "baro-session-changed",
              newValue: "synthetic-settings-session-invalidation",
            }),
          );
          window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
          window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
        });
        await expect
          .poll(async () => (await sessionReads()).calls)
          .toBeGreaterThan(sharedReads.calls);
        await expect.poll(() => fresh).toBeGreaterThan(0);
        const link = page.getByRole("link", { name: "Synthetic legacy case", exact: true });
        await expect(link).toBeVisible();
        await expect(page.getByRole("button", { name: "google로 재인증" })).toBeEnabled();
        release();
        await expect.poll(() => settled).toBe(true);
        await expect.poll(async () => (await sessionReads()).pending).toBe(0);
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        await expect(link).toBeVisible();
        await expect(page.getByRole("alert")).toHaveCount(0);
        await expect(page.getByRole("button", { name: "google로 재인증" })).toBeEnabled();
        const recoveredReads = fresh;
        await page.evaluate(() => {
          window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
          window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
        });
        await expect.poll(() => fresh).toBeGreaterThan(recoveredReads);
        await expect(link).toBeVisible();
        await expect(page.getByRole("alert")).toHaveCount(0);
        await expect(page.getByRole("button", { name: "google로 재인증" })).toBeEnabled();
      } finally {
        release();
      }
    },
  );
}

for (const failedRead of ["initial", "recheck", "parallel-owner"] as const) {
  test(`current settings access failure stays visible and permits retry: ${failedRead}`, async ({
    page,
  }) => {
    let failing = true,
      reads = 0;
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
      if (path === "/api/me/deletion") {
        reads++;
        if (failing && reads === (failedRead === "initial" ? 1 : failedRead === "recheck" ? 3 : -1))
          return route.fulfill({
            status: 503,
            json: { error: { code: "INTERNAL_ERROR", retryable: true } },
          });
        return route.fulfill({
          json: {
            ownerTag: (failing && failedRead === "parallel-owner" && reads === 2
              ? "b"
              : "a"
            ).repeat(64),
            recentOAuth: false,
            authenticatedAt: null,
            providers: ["google"],
          },
        });
      }
      if (path.endsWith("/usage"))
        return route.fulfill({
          json: {
            newCases: { used: 0, limit: 3 },
            aiResponses: { used: 0, limit: 200 },
            mediaMinutes: { used: 0, limit: 60 },
            storageBytes: { used: 0, limit: 10000000000 },
          },
        });
      if (path === "/api/cases") return route.fulfill({ json: { items: [], nextCursor: null } });
      if (path === "/api/v2/cases")
        return route.fulfill({ json: { items: [], nextCursor: null, previews: [] } });
      return route.fulfill({ status: 404, json: {} });
    });
    await page.goto("/settings");
    await expect(page.getByRole("alert")).toContainText("계정 상태를 확인하지 못했어요.");
    await expect(
      page.getByRole("button", { name: "계정과 모든 사건 삭제", exact: true }),
    ).toBeDisabled();
    const retry = page.getByRole("button", { name: "다시 확인", exact: true });
    await expect(retry).toBeEnabled();
    failing = false;
    await retry.click();
    await expect(page.getByRole("button", { name: "google로 재인증" })).toBeEnabled();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
}
