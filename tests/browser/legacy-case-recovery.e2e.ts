import { expect, type Page, type Route, test } from "@playwright/test";
import { guidance } from "../fixtures/contracts";

const caseId = "11111111-1111-4111-8111-111111111111";
const analysisId = "22222222-2222-4222-8222-222222222222";
const casePath = `/cases/${caseId}`;
const problem = (message: string, code = "MODEL_UNAVAILABLE") => ({
  error: { code, message, requestId: "synthetic", retryable: true, details: {} },
});
const detail = {
  caseId,
  analysisId,
  inputRevision: 1,
  title: "합성 사건 복구",
  status: "failed",
  questions: [],
  result: null,
  ...problem("합성 분석 실패"),
};
async function wire(page: Page, handler: (route: Route, path: string) => Promise<boolean>) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    if (await handler(route, path)) return;
    if (path === "/api/me/session")
      return route.fulfill({
        json: {
          user: { id: "synthetic-owner", name: "합성 고객", accountType: "customer" },
          needsConsent: false,
        },
      });
    if (path === "/api/me/consent") return route.fulfill({ json: { needsConsent: false } });
    if (path === "/api/cases" || path === "/api/v2/cases")
      return route.fulfill({ json: { items: [], nextCursor: null } });
    if (path === `/api${casePath}`) return route.fulfill({ json: detail });
    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
  });
}
const retryButton = (page: Page) =>
  page.getByRole("button", { name: "분석 다시 시도", exact: true });

for (const lostReply of [false, true]) {
  test(`legacy retry rotates acknowledged keys and preserves lost replies: ${lostReply}`, async ({
    page,
  }) => {
    const keys: string[] = [];
    const receipts = new Set<string>();
    await wire(page, async (route, path) => {
      if (path !== `/api${casePath}/retry`) return false;
      const key = route.request().headers()["idempotency-key"] ?? "";
      expect(key).toMatch(/^[0-9a-f-]{36}$/);
      keys.push(key);
      receipts.add(key);
      if (lostReply && keys.length === 1) await route.abort("failed");
      else
        await route.fulfill({
          status: 202,
          json: { analysisId, inputRevision: 1, status: "queued" },
        });
      return true;
    });
    await page.goto(casePath);
    const count = lostReply ? 3 : 2;
    for (let i = 0; i < count; i++) {
      await expect(retryButton(page)).toBeEnabled();
      await retryButton(page).click();
      await expect.poll(() => keys.length).toBe(i + 1);
      await expect(retryButton(page)).toBeEnabled();
    }
    expect(receipts.size).toBe(2);
    if (lostReply) expect(keys[0]).toBe(keys[1]);
    expect(keys.at(-1)).not.toBe(keys[0]);
  });
}

for (const failure of ["http", "network", "invalid-json"] as const) {
  test(`superseded legacy ${failure} failure cannot overwrite a newer read`, async ({ page }) => {
    let armed = false,
      held = false,
      latest = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await wire(page, async (route, path) => {
      if (path === `/api${casePath}/retry`) {
        latest = true;
        await route.fulfill({
          status: 202,
          json: { analysisId, inputRevision: 1, status: "queued" },
        });
        return true;
      }
      if (path !== `/api${casePath}`) return false;
      if (armed) {
        armed = false;
        held = true;
        await gate;
        if (failure === "network") await route.abort("failed");
        else if (failure === "invalid-json")
          await route.fulfill({ body: "broken", contentType: "application/json" });
        else await route.fulfill({ status: 503, json: problem("이전 조회 오류") });
      } else
        await route.fulfill({
          json: latest ? { ...detail, ...problem("최신 저장 상태") } : detail,
        });
      return true;
    });
    await page.goto(casePath);
    await expect(retryButton(page)).toBeVisible();
    armed = true;
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow")));
    await expect.poll(() => held).toBe(true);
    await retryButton(page).click();
    await expect(page.getByText("최신 저장 상태", { exact: true })).toBeVisible();
    const settled =
      failure === "network"
        ? page.waitForEvent("requestfailed", {
            predicate: (request) => new URL(request.url()).pathname === `/api${casePath}`,
          })
        : page.waitForResponse(
            (response) => new URL(response.url()).pathname === `/api${casePath}`,
          );
    release();
    await settled;
    // Wait for the response body and React update, not just the network headers.
    await page.waitForTimeout(150);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByText("최신 저장 상태", { exact: true })).toBeVisible();
  });
}

test("a current read failure remains visible and can be refreshed", async ({ page }) => {
  let fail = false;
  await wire(page, async (route, path) => {
    if (path !== `/api${casePath}` || !fail) return false;
    await route.fulfill({ status: 503, json: problem("현재 조회 오류") });
    return true;
  });
  await page.goto(casePath);
  await expect(retryButton(page)).toBeVisible();
  fail = true;
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow")));
  await expect(page.getByRole("alert")).toHaveText("현재 조회 오류");
  fail = false;
  await page.getByRole("button", { name: "최신 상태 다시 확인", exact: true }).click();
  await expect(retryButton(page)).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("legacy consent recovery preserves the case destination", async ({ page }) => {
  await wire(page, async (route, path) => {
    if (path !== `/api${casePath}/retry`) return false;
    await route.fulfill({
      status: 403,
      json: problem("필수 동의를 확인해 주세요.", "CONSENT_REQUIRED"),
    });
    return true;
  });
  await page.goto(casePath);
  await retryButton(page).click();
  await expect(page.getByRole("link", { name: "필수 동의 확인", exact: true })).toHaveAttribute(
    "href",
    `/consent?returnTo=${encodeURIComponent(casePath)}`,
  );
});

for (const action of ["read", "retry", "feedback"] as const) {
  test(`legacy ${action} session recovery preserves the case destination`, async ({ page }) => {
    const target = `/api${casePath}${action === "read" ? "" : `/${action}`}`;
    let expire = action !== "read";
    await wire(page, async (route, path) => {
      if (path === target && expire) {
        await route.fulfill({ status: 401, json: problem("세션이 만료됐어요.", "UNAUTHORIZED") });
        return true;
      }
      if (action === "feedback" && path === `/api${casePath}`) {
        await route.fulfill({
          json: { ...detail, status: "completed", result: guidance, error: null },
        });
        return true;
      }
      return false;
    });
    await page.goto(casePath);
    if (action === "read") {
      await expect(retryButton(page)).toBeVisible();
      expire = true;
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow")));
    }
    if (action === "retry") await retryButton(page).click();
    if (action === "feedback")
      await page.getByRole("button", { name: "도움이 됐어요", exact: true }).click();
    await expect(page).toHaveURL(/\/login\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get("returnTo")).toBe(casePath);
    expect(url.searchParams.get("error")).toBe("session_expired");
  });
}

test("legacy answers preserve Unicode and reject over-limit drafts without sending", async ({
  page,
}) => {
  const received: string[] = [];
  await wire(page, async (route, path) => {
    if (path === "/api" + casePath + "/answers") {
      received.push(route.request().postDataJSON().answers[0].value);
      await route.fulfill({
        status: 202,
        json: { analysisId, inputRevision: 1, status: "queued" },
      });
      return true;
    }
    if (path !== "/api" + casePath) return false;
    await route.fulfill({
      json: {
        caseId,
        analysisId,
        inputRevision: 1,
        title: "합성 문자 입력",
        status: "needs_clarification",
        questions: [
          { id: "q-unicode", prompt: "설명을 입력해 주세요.", answerType: "text", options: [] },
        ],
        result: null,
        error: null,
      },
    });
    return true;
  });
  await page.goto(casePath);
  await page.getByLabel("1번 답변 방식").selectOption("answered");
  const input = page.getByLabel("1번 답변", { exact: true }),
    send = page.getByRole("button", { name: "답변 보내기", exact: true });
  await input.focus();
  await page.keyboard.insertText("😀".repeat(600));
  await expect(input).toHaveValue("😀".repeat(600));
  await input.fill("😀".repeat(1001));
  await send.click();
  await expect(page.getByRole("alert")).toContainText("1,000자 이하");
  await expect(input).toHaveValue("😀".repeat(1001));
  expect(received).toHaveLength(0);
  const text = "😀".repeat(1000);
  await input.fill("  " + text + "  ");
  await send.click();
  await expect.poll(() => received.length).toBe(1);
  expect(received[0]).toBe(text);
});
