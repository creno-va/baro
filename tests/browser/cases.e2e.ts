import { spawn } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";
import { syntheticConsentStatus } from "../fixtures/consent-status";

test("a session change closes a pending challenge without admitting the old creation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      turnstile: { render: () => "synthetic-pending-widget", remove: () => {} },
    });
  });
  let signedIn = true,
    writes = 0;
  await page.route("**/api/me/session", (route) =>
    route.fulfill({
      json: {
        user: signedIn
          ? { id: "synthetic-owner", name: "합성 고객", accountType: "customer" }
          : null,
        needsConsent: false,
      },
    }),
  );
  await page.route("**/api/me/consent", (route) =>
    route.fulfill({ json: syntheticConsentStatus(false) }),
  );
  await page.route("**/api/v2/cases", (route) => {
    writes++;
    return route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE" } } });
  });
  await page.goto("/cases/new");
  await page
    .getByRole("textbox")
    .fill("세션 전환 중인 보안 확인이 새 계정의 사건을 만들지 않는지 확인하는 합성 입력입니다.");
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  await expect(page.getByRole("dialog", { name: "보안 확인" })).toBeVisible();
  signedIn = false;
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("baro-session-changed", { detail: { reason: "signout" } }),
    ),
  );
  await expect(page.getByRole("dialog", { name: "보안 확인" })).toHaveCount(0);
  await expect(page.getByRole("textbox")).toBeDisabled();
  await expect(page.getByRole("textbox")).toHaveValue("");
  expect(writes).toBe(0);
});

async function challenge(page: Page) {
  await page.addInitScript(() => {
    let callback: ((token: string) => void) | undefined;
    const browser = window as unknown as {
      turnstile: {
        render(element: HTMLElement, options: { callback: (token: string) => void }): string;
        reset(): void;
        remove(): void;
      };
    };
    browser.turnstile = {
      render: (_element: HTMLElement, options: { callback: (token: string) => void }) => {
        callback = options.callback;
        queueMicrotask(() => options.callback("synthetic-token"));
        return "synthetic-widget";
      },
      reset: () => callback?.("synthetic-token"),
      remove: () => {},
    };
  });
}
test("intake validates code points, blocks duplicates, preserves replay key and focus after errors", async ({
  page,
}) => {
  await challenge(page);
  await page.route("**/api/me/session", (route) =>
    route.fulfill({
      json: {
        user: { id: "synthetic-owner", name: "합성 고객", accountType: "customer" },
        needsConsent: false,
      },
    }),
  );
  await page.route("**/api/me/consent", (route) =>
    route.fulfill({ json: syntheticConsentStatus(false) }),
  );
  let calls = 0;
  const keys: string[] = [];
  await page.route("**/api/v2/cases", async (route) => {
    calls++;
    keys.push(route.request().headers()["idempotency-key"] ?? "");
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.fulfill(
      calls === 1
        ? {
            status: 503,
            json: {
              error: {
                code: "MODEL_UNAVAILABLE",
                message: "같은 입력으로 다시 시도해 주세요.",
                requestId: "synthetic",
                retryable: true,
                details: {},
              },
            },
          }
        : {
            status: 201,
            json: workspace,
          },
    );
  });
  const now = "2026-10-06T11:00:00.000Z";
  const workspace = {
    schemaVersion: "2",
    id: "11111111-1111-4111-8111-111111111111",
    title: "사건 작업 공간",
    subjectContext: "individual",
    jurisdiction: "KR",
    status: "intake",
    archivedFrom: null,
    workspaceRevision: 1,
    intakeRevision: 1,
    confirmedSummaryRevision: null,
    currentJobId: null,
    legacySnapshotId: null,
    createdAt: now,
    updatedAt: now,
  };
  await page.route("**/api/v2/cases/*/*", (route) =>
    route.fulfill({
      json: route.request().url().endsWith("/workspace")
        ? workspace
        : {
            schemaVersion: "2",
            revision: 1,
            status: "collecting",
            narrative: "합성 사건입니다. 지인에게 빌려준 돈을 돌려받는 상황입니다.",
            batches: [
              {
                id: "batch-one",
                ordinal: 1,
                generatedForIntakeRevision: 1,
                questions: [
                  { id: "q-one", prompt: "언제 있었나요?", answerType: "text", options: [] },
                ],
                answers: [],
              },
            ],
            confirmedSummaryRevision: null,
            currentJobId: null,
            summary: null,
          },
    }),
  );
  await page.route("**/api/v2/cases/*/workspace-jobs/latest", (route) =>
    route.fulfill({ json: null }),
  );
  await page.goto("/cases/new");
  const input = page.getByRole("textbox");
  const submit = page.getByRole("button", { name: "저장하고 계속" });
  await input.fill("😀😀");
  await expect(submit).toBeEnabled();
  await expect(page.getByText("3자만 더 적어주세요", { exact: true })).toBeVisible();
  await submit.click();
  const validation = page.getByRole("dialog", { name: "이야기를 조금만 더 적어주세요" });
  await expect(validation).toContainText("어떤 일이 있었는지 5자 이상 적어주세요.");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  expect(calls).toBe(0);
  expect(keys).toEqual([]);
  await validation.getByRole("button", { name: "계속 작성하기" }).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("😀😀");
  await submit.click();
  await expect(validation).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("aria-invalid", "false");
  expect(calls).toBe(0);
  await input.fill("합성 사건입니다. 지인에게 빌려준 돈을 돌려받는 상황입니다.");
  await submit.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText("다시 시도");
  expect(calls).toBe(1);
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(page).toHaveURL(/\/intake$/);
  await expect(page.getByRole("heading", { name: "언제 있었나요?" })).toBeVisible();
  expect(calls).toBe(2);
  expect(keys[0]).toBe(keys[1]);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  expect(page.url()).not.toContain("합성");
});
test("list empty/error/loading, auth and consent gates, refresh/back use server state", async ({
  page,
}) => {
  let fail = true;
  let present = false;
  let gate: "CONSENT_REQUIRED" | "UNAUTHENTICATED" | null = null;
  await page.route("**/api/me/session", (route) =>
    route.fulfill({
      json: {
        user: { id: "synthetic-owner", name: "합성 고객", accountType: "customer" },
        needsConsent: false,
      },
    }),
  );
  await page.route("**/api/cases?*", async (route) => {
    if (gate) {
      await route.fulfill({
        status: gate === "UNAUTHENTICATED" ? 401 : 403,
        json: { error: { code: gate } },
      });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fulfill(
      fail
        ? { status: 503, json: {} }
        : {
            json: {
              items: present
                ? [
                    {
                      id: "11111111-1111-4111-8111-111111111111",
                      title: "금전 대여 사건",
                      status: "screening",
                      createdAt: "2026-10-05T12:00:00.000Z",
                      updatedAt: "2026-10-05T12:00:00.000Z",
                    },
                  ]
                : [],
              nextCursor: null,
            },
          },
    );
  });
  await page.route("**/api/v2/cases?*", (route) =>
    route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } }),
  );
  await page.goto("/cases");
  await expect(
    page.getByRole("status").filter({ hasText: "사건을 불러오지 못했어요" }),
  ).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "다시 불러오기" }).click();
  await expect(page.locator(".sidebar-desktop .sidebar-empty")).toContainText("나누던 이야기");
  present = true;
  await page.reload();
  await expect(
    page.locator(".sidebar-desktop").getByRole("link", { name: /금전 대여 사건/ }),
  ).toBeVisible();
  gate = "UNAUTHENTICATED";
  await page.reload();
  await expect(page.locator(".sidebar-desktop .sidebar-story")).toHaveCount(0);
  gate = "CONSENT_REQUIRED";
  await page.reload();
  await expect(page.locator(".sidebar-desktop .sidebar-story")).toHaveCount(0);
  gate = null;
  await page.goto("/login");
  await page.goBack();
  await expect(
    page.locator(".sidebar-desktop").getByRole("link", { name: /금전 대여 사건/ }),
  ).toBeVisible();
});
test("real signed session submits admission into SQL and reloads owner-scoped list at 320px/200%", async ({
  page,
  context,
  baseURL,
}) => {
  const child = spawn("bun", ["tests/helpers/browser-session-server.ts", baseURL ?? "", "cases"], {
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
      let output = "";
      const timeout = setTimeout(() => reject(new Error("Synthetic harness timeout")), 15000);
      child.once("error", () => reject(new Error("Synthetic harness unavailable")));
      child.stdout.on("data", (chunk) => {
        output += String(chunk);
        if (output.includes("\n")) {
          clearTimeout(timeout);
          resolve(JSON.parse(output.slice(0, output.indexOf("\n"))));
        }
      });
    });
    await context.addCookies([seed.cookie]);
    await challenge(page);
    await page.route("**/api/**", async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (!url.pathname.startsWith("/api/")) return route.continue();
      const response = await route.fetch({
        url: `${seed.origin}${url.pathname}${url.search}`,
        headers: { ...(await req.allHeaders()), "cf-connecting-ip": "192.0.2.1" },
      });
      await route.fulfill({ response });
    });
    await page.setViewportSize({ width: 320, height: 760 });
    await page.goto("/cases");
    const admitted = await page.evaluate(async () => {
      const response = await fetch("/api/cases", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          narrative: "합성 브라우저 사건입니다. 지인에게 돈을 빌려준 뒤 반환을 기다립니다.",
          turnstileToken: "synthetic-token",
        }),
      });
      return { status: response.status, body: await response.json() };
    });
    expect(admitted.status).toBe(201);
    await page.reload();
    await page.getByRole("button", { name: "메뉴 열기" }).click();
    await expect(page.getByRole("link", { name: /금전 대여 사건/ })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "메뉴 열기" }).click();
    await expect(page.getByRole("link", { name: /금전 대여 사건/ })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: ".wrangler/cases-320.png" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: ".wrangler/cases-zoom.png" });
  } finally {
    child.stdin.end();
    child.kill();
  }
});
