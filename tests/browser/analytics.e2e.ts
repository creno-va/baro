import { expect, test } from "@playwright/test";
import { guidance } from "../fixtures/contracts";

const caseId = "11111111-1111-4111-8111-111111111111",
  analysisId = "22222222-2222-4222-8222-222222222222",
  storage = "baro.optional-analytics.v1";
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v2/cases/*/workspace", (route) =>
    route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } }),
  );
});
test("decline leaves case flow usable with no optional storage/network; feedback independent", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/analytics|telemetry|collect/.test(request.url())) requests.push(request.url());
  });
  await page.route(`**/api/cases/${caseId}`, (route) =>
    route.fulfill({
      json: {
        caseId,
        analysisId,
        inputRevision: 1,
        title: "금전 대여 사건",
        status: "completed",
        questions: [],
        result: guidance,
        error: null,
      },
    }),
  );
  let puts = 0;
  await page.route(`**/api/cases/${caseId}/feedback`, async (route) => {
    puts++;
    expect(route.request().postDataJSON()).toEqual({ helpful: true });
    await new Promise((r) => setTimeout(r, 100));
    await route.fulfill(puts === 1 ? { status: 503 } : { status: 204 });
  });
  await page.goto(`/cases/${caseId}`);
  await expect(page.getByRole("heading", { name: "상황 정리" })).toBeVisible();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), storage)).toBeNull();
  expect(await page.evaluate(() => document.cookie)).not.toContain("analytics");
  await page.getByText("개인정보와 이용 설정", { exact: true }).click();
  await page.getByRole("button", { name: "사용 지표 거부" }).click();
  await expect(page.getByText("선택 지표 수집 안 함")).toBeVisible();
  const helpful = page.getByRole("button", { name: "도움이 됐어요", exact: true });
  await helpful.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(page.getByText("도움 여부를 저장하지 못했어요", { exact: false })).toBeVisible();
  expect(puts).toBe(1);
  await helpful.click();
  await expect(page.getByText("도움 여부를 저장했어요", { exact: false })).toBeVisible();
  expect(puts).toBe(2);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), storage)).toBeNull();
  expect(
    requests.filter(
      (url) => !url.includes("/_astro/") && !url.includes("/src/") && !url.includes("node_modules"),
    ),
  ).toEqual([]);
});
test("opt-in records only hashed allowlisted events, 50%/1s view once, reload and opt-out erase", async ({
  page,
}) => {
  await page.route(`**/api/cases/${caseId}`, (route) =>
    route.fulfill({
      json: {
        caseId,
        analysisId,
        inputRevision: 1,
        title: "금전 대여 사건",
        status: "completed",
        questions: [],
        result: guidance,
        error: null,
      },
    }),
  );
  await page.route(`**/api/cases/${caseId}/feedback`, (route) => route.fulfill({ status: 204 }));
  await page.goto(`/cases/${caseId}`);
  await page.getByText("개인정보와 이용 설정", { exact: true }).click();
  await page.getByRole("button", { name: "사용 지표 동의", exact: true }).click();
  await expect(page.getByText("선택 지표 동의됨")).toBeVisible();
  await page.getByRole("heading", { name: "상황 정리" }).scrollIntoViewIfNeeded();
  const events = () =>
    page.evaluate(
      (key) =>
        JSON.parse(sessionStorage.getItem(key) ?? '{"events":[]}').events as {
          name: string;
          caseIdHash?: string;
          analysisIdHash?: string;
        }[],
      storage,
    );
  await expect
    .poll(async () => (await events()).filter((e) => e.name === "result_viewed").length)
    .toBe(1);
  const view = (await events()).find((e) => e.name === "result_viewed");
  expect(view?.caseIdHash).toMatch(/^[a-f0-9]{64}$/);
  expect(view?.analysisIdHash).toMatch(/^[a-f0-9]{64}$/);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "도움이 됐어요", exact: true }).click();
  await expect
    .poll(async () => (await events()).some((e) => e.name === "trust_answered"))
    .toBe(true);
  const persisted = await page.evaluate((key) => sessionStorage.getItem(key), storage);
  expect(persisted).not.toContain(caseId);
  expect(persisted).not.toContain(analysisId);
  expect(persisted).not.toContain("합성 사용자");
  expect(persisted).not.toContain("반환 약정");
  expect(persisted).not.toContain("better-auth");
  await page.reload();
  await page.getByText("개인정보와 이용 설정", { exact: true }).click();
  await page.getByRole("heading", { name: "상황 정리" }).scrollIntoViewIfNeeded();
  await expect
    .poll(async () => (await events()).filter((e) => e.name === "result_viewed").length)
    .toBe(1);
  await page.getByRole("button", { name: "동의 철회 및 지표 삭제" }).click();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), storage)).toBeNull();
  await expect(page.getByText("선택 지표 수집 안 함")).toBeVisible();
});
