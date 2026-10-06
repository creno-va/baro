import { spawn } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";
import { guidance, outOfScope, questions, urgentRedirect } from "../fixtures/contracts";

const caseId = "11111111-1111-4111-8111-111111111111",
  analysisId = "22222222-2222-4222-8222-222222222222";
async function syntheticCustomer(page: Page) {
  await page.route("**/api/me/session", (route) =>
    route.fulfill({
      json: {
        user: { id: "synthetic-owner", name: "합성 고객", accountType: "customer" },
        needsConsent: false,
      },
    }),
  );
}
function state(status: string, result: unknown = null, revision = 1) {
  return {
    caseId,
    analysisId,
    inputRevision: revision,
    title: "금전 대여 사건",
    status,
    questions: status === "needs_clarification" ? questions : [],
    result,
    error:
      status === "failed"
        ? {
            code: "MODEL_UNAVAILABLE",
            message: "입력은 안전하게 저장됐어요.",
            requestId: "synthetic",
            retryable: true,
            details: {},
          }
        : null,
  };
}
test.beforeEach(async ({ page }) => {
  // Preserve v1 compatibility; the final test uses actual signed session/API calls.
  await page.route("**/api/v2/cases/*/workspace", (route) =>
    route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } }),
  );
});
test("questions duplicate/error/replay and stale revision restore server state, keyboard and expiry", async ({
  page,
}) => {
  await syntheticCustomer(page);
  let current = state("needs_clarification"),
    posts = 0;
  const keys: string[] = [];
  await page.route(`**/api/cases/${caseId}`, (route) => route.fulfill({ json: current }));
  await page.route(`**/api/cases/${caseId}/analysis`, (route) =>
    route.fulfill({
      json: {
        caseId,
        analysisId,
        inputRevision: current.inputRevision,
        status: current.status === "needs_clarification" ? "waiting_for_answers" : "queued",
        updatedAt: new Date().toISOString(),
        retryable: false,
        retryAttemptsRemaining: 2,
        error: null,
      },
    }),
  );
  await page.route(`**/api/cases/${caseId}/answers`, async (route) => {
    posts++;
    keys.push(route.request().headers()["idempotency-key"] ?? "");
    await new Promise((r) => setTimeout(r, 100));
    if (posts === 1)
      await route.fulfill({
        status: 503,
        json: {
          error: {
            code: "INTERNAL_ERROR",
            message: "같은 답변으로 다시 시도해 주세요.",
            requestId: "synthetic",
            retryable: true,
            details: {},
          },
        },
      });
    else {
      current = state("queued", null, 2);
      await route.fulfill({
        status: 202,
        json: { caseId, analysisId, inputRevision: 2, status: "queued" },
      });
    }
  });
  await page.goto(`/cases/${caseId}`);
  await expect(page.getByText("2 / 최대 5개", { exact: false })).toBeVisible();
  await page.getByLabel("1번 답변 방식").selectOption("unknown");
  await page.getByLabel("2번 답변 방식").selectOption("skipped");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByLabel("1번 답변 방식")).toBeVisible();
  await expect(page.getByLabel("1번 답변 방식")).toHaveValue("unknown");
  await expect(page.getByLabel("2번 답변 방식")).toHaveValue("skipped");
  const submit = page.getByRole("button", { name: "답변 보내기" });
  await submit.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "같은 답변" })).toBeVisible();
  expect(posts).toBe(1);
  await submit.click();
  await expect(page.getByRole("heading", { name: "분석 대기" })).toBeVisible();
  expect(keys[0]).toBe(keys[1]);
  current = state("completed", guidance, 2);
  await page.reload();
  await expect(page.getByRole("heading", { name: "상황 정리" })).toBeVisible();
  const source = page.getByRole("link", { name: /합성 법령 fixture.*공식 원문/ });
  await expect(source).toHaveAttribute("target", "_blank");
  await source.focus();
  await expect(source).toBeFocused();
  await page.setViewportSize({ width: 320, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".wrangler/detail-320.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".wrangler/detail-zoom.png", fullPage: true });
  current = {
    ...state("failed"),
    error: {
      code: "CLARIFICATION_EXPIRED",
      message: "질문 대기 시간이 지나 새 사건을 입력해 주세요.",
      requestId: "synthetic",
      retryable: false,
      details: {},
    },
  };
  await page.reload();
  await expect(page.getByText("질문 대기 시간이 지나", { exact: false })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "새 사건 입력" })).toBeVisible();
});
test("polling delays stop while hidden or terminal; policy results and bounded retry/deletion", async ({
  page,
}) => {
  await syntheticCustomer(page);
  // Keep wall time during route/expect awaits out of the exact polling boundaries.
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  await page.addInitScript(() => {
    const browser = window as unknown as { pollSchedules: number[] };
    browser.pollSchedules = [];
    const original = window.setTimeout.bind(window);
    window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
      if ([1000, 2000, 4000, 8000, 15000].includes(delay ?? 0))
        browser.pollSchedules.push(delay ?? 0);
      return original(callback, delay, ...args);
    }) as typeof window.setTimeout;
  });
  let current = state("queued"),
    reads = 0;
  await page.route(`**/api/cases/${caseId}`, async (route) => {
    if (route.request().method() === "DELETE") {
      await route.fulfill({ status: 204 });
      return;
    }
    reads++;
    await route.fulfill({ json: current });
  });
  await page.route(`**/api/cases/${caseId}/analysis`, (route) =>
    route.fulfill({
      json: {
        caseId,
        analysisId,
        inputRevision: 1,
        status: "queued",
        updatedAt: new Date().toISOString(),
        retryable: false,
        retryAttemptsRemaining: 2,
        error: null,
      },
    }),
  );
  await page.route(`**/api/cases/${caseId}/retry`, async (route) => {
    current = state("completed", guidance);
    await route.fulfill({ status: 202, json: { analysisId, inputRevision: 1, status: "queued" } });
  });
  await page.goto(`/cases/${caseId}`);
  await expect(page.getByRole("heading", { name: "분석 대기" })).toBeVisible();
  const initial = reads;
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { pollSchedules: number[] }).pollSchedules.at(-1)),
    )
    .toBe(1000);
  await page.clock.runFor(1000);
  await expect.poll(() => reads).toBe(initial + 1);
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { pollSchedules: number[] }).pollSchedules.at(-1)),
    )
    .toBe(2000);
  await page.clock.runFor(1999);
  expect(reads).toBe(initial + 1);
  await page.clock.runFor(1);
  await expect.poll(() => reads).toBe(initial + 2);
  let schedules = 2;
  for (const delay of [4000, 8000, 15000]) {
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as { pollSchedules: number[] }).pollSchedules.at(-1),
        ),
      )
      .toBe(delay);
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { pollSchedules: number[] }).pollSchedules.length,
        ),
      )
      .toBe(++schedules);
    const before = reads;
    await page.clock.runFor(delay - 1);
    expect(reads).toBe(before);
    await page.clock.runFor(1);
    await expect.poll(() => reads).toBe(before + 1);
  }
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hidden = reads;
  await page.clock.runFor(60000);
  expect(reads).toBe(hidden);
  current = state("failed");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByRole("button", { name: "분석 다시 시도" })).toBeVisible();
  await page.getByRole("button", { name: "분석 다시 시도" }).click();
  await expect(page.getByRole("heading", { name: "상황 정리" })).toBeVisible();
  const completed = reads;
  await page.clock.runFor(60000);
  expect(reads).toBe(completed);
  for (const result of [outOfScope, urgentRedirect]) {
    current = state(result.kind, result);
    await page.reload();
    await expect(
      page.getByRole("heading", {
        name: result.kind === "out_of_scope" ? "지원 범위 안내" : "안전 확인이 우선이에요",
      }),
    ).toBeVisible();
  }
  await page.getByRole("button", { name: "사건 삭제", exact: true }).click();
  await page.getByRole("button", { name: "사건 삭제 확인" }).press("Enter");
  await expect(page.getByRole("heading", { name: "사건과 관련 분석을 삭제했어요." })).toBeFocused();
});
test("failed read retries, stale/late answers recover the latest revision and expiry", async ({
  page,
}) => {
  await syntheticCustomer(page);
  let current = state("needs_clarification"),
    failedRead = true,
    initialMetadataRead = true,
    expired = false;
  await page.route(`**/api/cases/${caseId}`, async (route) => {
    if (initialMetadataRead) {
      initialMetadataRead = false;
      await route.fulfill({ json: current });
      return;
    }
    if (failedRead) {
      failedRead = false;
      await route.fulfill({
        status: 503,
        json: {
          error: {
            code: "INTERNAL_ERROR",
            message: "상태를 불러오지 못했어요.",
            requestId: "synthetic",
            retryable: true,
            details: {},
          },
        },
      });
    } else await route.fulfill({ json: current });
  });
  await page.route(`**/api/cases/${caseId}/analysis`, (route) =>
    route.fulfill({
      json: {
        caseId,
        analysisId,
        inputRevision: current.inputRevision,
        status: "waiting_for_answers",
        updatedAt: new Date().toISOString(),
        retryable: false,
        retryAttemptsRemaining: 2,
        error: null,
      },
    }),
  );
  await page.route(`**/api/cases/${caseId}/answers`, async (route) => {
    current = expired
      ? {
          ...state("failed"),
          error: {
            code: "CLARIFICATION_EXPIRED",
            message: "질문 대기 시간이 지나 새 사건을 입력해 주세요.",
            requestId: "synthetic",
            retryable: false,
            details: {},
          },
        }
      : state("queued", null, 2);
    await route.fulfill({
      status: 409,
      json: {
        error: {
          code: expired ? "INVALID_STATE" : "REVISION_CONFLICT",
          message: "최신 상태를 다시 확인해 주세요.",
          requestId: "synthetic",
          retryable: false,
          details: {},
        },
      },
    });
  });
  await page.goto(`/cases/${caseId}`);
  await expect(page.getByRole("alert").filter({ hasText: "상태를 불러오지" })).toBeVisible();
  await page.getByRole("button", { name: "최신 상태 다시 확인" }).click();
  await expect(page.getByRole("heading", { name: "확인이 필요한 내용" })).toBeVisible();
  for (const label of ["1번 답변 방식", "2번 답변 방식"])
    await page.getByLabel(label).selectOption("unknown");
  await page.getByRole("button", { name: "답변 보내기" }).click();
  await expect(page.getByRole("heading", { name: "분석 대기" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "확인이 필요한 내용" })).toHaveCount(0);
  current = state("needs_clarification");
  expired = true;
  await page.reload();
  for (const label of ["1번 답변 방식", "2번 답변 방식"])
    await page.getByLabel(label).selectOption("skipped");
  await page.getByRole("button", { name: "답변 보내기" }).click();
  await expect(page.getByRole("main").getByRole("link", { name: "새 사건 입력" })).toBeVisible();
  await expect(page.getByText("질문 대기 시간이 지나", { exact: false })).toBeVisible();
});
test("real signed session/API/SQL legacy admission → questions → validated official result → revisit → delete", async ({
  page,
  context,
}) => {
  const child = spawn(
    "bun",
    ["tests/helpers/browser-session-server.ts", "http://127.0.0.1:4337", "analysis"],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  try {
    const metadata = await new Promise<{
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
      child.stdout.on("data", (chunk) => {
        output += String(chunk);
        if (output.includes("\n")) resolve(JSON.parse(output.split("\n")[0] ?? "{}"));
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code) reject(new Error("Synthetic harness failed"));
      });
    });
    await context.addCookies([metadata.cookie]);
    await page.route("**/api/**", async (route) => {
      const target = new URL(route.request().url());
      if (!target.pathname.startsWith("/api/")) return route.continue();
      if (target.pathname.match(/^\/api\/v2\/cases\/[^/]+\/workspace$/))
        return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
      const response = await route.fetch({
        url: metadata.origin + target.pathname + target.search,
        headers: {
          ...route.request().headers(),
          origin: "http://127.0.0.1:4337",
          "cf-connecting-ip": "192.0.2.1",
        },
      });
      await route.fulfill({ response });
    });
    await page.addInitScript(() => {
      const browser = window as unknown as { turnstile: unknown };
      browser.turnstile = {
        render: (_el: HTMLElement, opts: { callback: (value: string) => void }) => {
          opts.callback("synthetic-token");
          return "test";
        },
        reset: () => {},
        remove: () => {},
      };
    });
    await page.goto("/cases");
    await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
    await page.getByText("개인정보와 이용 설정", { exact: true }).click();
    await page.getByRole("button", { name: "사용 지표 동의", exact: true }).click();
    const admission = await page.evaluate(async () => {
      const response = await fetch("/api/cases", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          narrative: "합성 사용자 A는 지인에게 금전을 대여했다고 진술했습니다.",
          turnstileToken: "synthetic-token",
        }),
      });
      return { status: response.status, body: (await response.json()) as { caseId: string } };
    });
    expect(admission.status).toBe(201);
    await page.goto(`/cases/${admission.body.caseId}`);
    await expect(page.getByRole("heading", { name: "확인이 필요한 내용" })).toBeVisible();
    await page.getByLabel("1번 답변 방식").selectOption("unknown");
    await page.getByLabel("2번 답변 방식").selectOption("skipped");
    await page.getByRole("button", { name: "답변 보내기" }).click();
    await expect(page.getByRole("heading", { name: "상황 정리" })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("link", { name: /민법 제598조 공식 원문/ })).toBeVisible();
    await page.getByRole("heading", { name: "상황 정리" }).scrollIntoViewIfNeeded();
    const events = () =>
      page.evaluate(
        () =>
          JSON.parse(sessionStorage.getItem("baro.optional-analytics.v1") ?? '{"events":[]}')
            .events as { name: string; flowId: string; analysisIdHash: string }[],
      );
    await expect
      .poll(async () => (await events()).filter((e) => e.name === "result_viewed").length)
      .toBe(1);
    const samples = await events(),
      started = samples.find((e) => e.name === "analysis_started"),
      viewed = samples.find((e) => e.name === "result_viewed");
    expect(started?.flowId).toBe(viewed?.flowId);
    expect(started?.analysisIdHash).toBe(viewed?.analysisIdHash);
    expect(samples.some((e) => e.name === "analysis_started")).toBe(true);
    expect(samples.some((e) => e.name === "analysis_completed")).toBe(true);
    await page.getByRole("button", { name: "도움이 됐어요", exact: true }).click();
    await expect(page.getByText("도움 여부를 저장했어요", { exact: false })).toBeVisible();
    const url = page.url();
    await page.reload();
    await expect(page.getByRole("heading", { name: "상황 정리" })).toBeVisible();
    await page.getByRole("link", { name: "내 사건", exact: true }).first().click();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "상황 정리" })).toBeVisible();
    expect(page.url()).toBe(url);
    await page.getByRole("button", { name: "사건 삭제", exact: true }).click();
    await page.getByRole("button", { name: "사건 삭제 확인" }).click();
    await expect(
      page.getByRole("heading", { name: "사건과 관련 분석을 삭제했어요." }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByRole("alert")).toContainText("사건 또는 자료를 찾을 수 없어요.");
    expect(await page.evaluate(() => localStorage.length)).toBe(0);
  } finally {
    child.stdin.end();
    child.kill();
  }
});
