import { spawn } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";

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
    route.fulfill({ json: { needsConsent: false } }),
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
  await page.goto("/cases/new");
  const input = page.getByRole("textbox");
  const submit = page.getByRole("button", { name: "저장하고 질문 시작" });
  await input.fill("짧은 입력");
  await expect(submit).toBeDisabled();
  await expect(page.getByText("5,000자 · 최소 20자", { exact: false })).toBeVisible();
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
  await expect(page.getByRole("alert")).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.getByRole("heading", { name: "아직 정리한 사건이 없어요" })).toBeVisible();
  present = true;
  await page.reload();
  await expect(page.getByRole("link", { name: /금전 대여 사건/ })).toBeVisible();
  gate = "UNAUTHENTICATED";
  await page.reload();
  await expect(page.getByRole("link", { name: "로그인하기", exact: true })).toBeVisible();
  gate = "CONSENT_REQUIRED";
  await page.reload();
  await expect(page.getByRole("link", { name: "동의 확인" })).toBeVisible();
  gate = null;
  await page.goto("/login");
  await page.goBack();
  await expect(page.getByRole("link", { name: /금전 대여 사건/ })).toBeVisible();
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
    await expect(page.getByRole("link", { name: /금전 대여 사건/ })).toBeVisible();
    await page.reload();
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
