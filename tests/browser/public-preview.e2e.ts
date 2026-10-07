import { type ChildProcess, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const origin = "http://127.0.0.1:4362";
test.use({ baseURL: origin });
let server: ChildProcess;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  server = spawn(
    "bun",
    ["run", "dev", "--", "--ignore-lock", "--host", "127.0.0.1", "--port", "4362"],
    {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      env: {
        ...process.env,
        CLOUDFLARE_ENV: "",
        BARO_UI_TEST_FIXTURE: "true",
        PUBLIC_API_MODE: "mock",
        PUBLIC_PREVIEW_TEST: "true",
        ASTRO_TELEMETRY_DISABLED: "1",
        WRANGLER_LOG_PATH: "/tmp/baro-public-preview-wrangler.log",
      },
      stdio: "ignore",
    },
  );
  let failed = false;
  server.once("error", () => {
    failed = true;
  });
  await expect
    .poll(
      async () => {
        if (failed || server.exitCode !== null) throw new Error("Public preview harness exited");
        try {
          return (await fetch(`${origin}/login`, { signal: AbortSignal.timeout(3000) })).status;
        } catch {
          return 0;
        }
      },
      { timeout: 110_000, intervals: [250, 500, 1000] },
    )
    .toBe(200);
});

test.afterAll(() => {
  server?.kill();
});

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    if (!localStorage.getItem("baro-api-mock-v1:session"))
      localStorage.setItem(
        "baro-api-mock-v1:session",
        JSON.stringify({
          user: { id: "public-preview-customer", name: "합성 체험 고객", accountType: "customer" },
          needsConsent: false,
        }),
      );
  });
});

test("launch notice shows both dates, supports Escape and CTA, and fits desktop and 320px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/app");
  const modal = page.getByRole("dialog", { name: "BARO를 먼저 만나보세요" });
  await expect(modal).toBeVisible();
  await expect(modal.locator('time[datetime="2026-11-01"]')).toHaveText("2026.11.01");
  await expect(modal.locator('time[datetime="2026-11-10"]')).toHaveText("2026.11.10");
  await expect(modal.getByText("사건 작성 · 후속 질문", { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "/tmp/baro-public-preview-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
  await expect(page.getByRole("textbox", { name: "지금까지 있었던 일" })).toBeEnabled();

  await page.setViewportSize({ width: 320, height: 800 });
  await page.reload();
  await expect(modal).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const bounds = await modal.boundingBox();
  if (!bounds) throw new Error("Launch notice has no visible bounds");
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "/tmp/baro-public-preview-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await modal.getByRole("button", { name: "체험 시작하기" }).click();
  await expect(modal).toBeHidden();
  await expect(page.getByRole("textbox", { name: "지금까지 있었던 일" })).toBeEnabled();
});

test("two intake rounds remain usable while detail actions and lawyer navigation stay disabled", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/app");
  await page.getByRole("button", { name: "체험 시작하기" }).click();
  await expect(
    page.getByRole("button", { name: "변호사 찾기 · 준비 중", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("textbox", { name: "지금까지 있었던 일" })
    .fill(
      "공개 체험 검증을 위한 합성 사건입니다. 지인에게 빌려준 돈과 반환 약속을 확인하고 싶습니다.",
    );
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  for (let index = 1; index <= 6; index++) {
    await expect(
      page.getByText(`${Math.ceil(index / 3)}차 질문 · ${((index - 1) % 3) + 1} / 3`, {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "모름", exact: true }).click();
  }
  await expect(page).toHaveURL(/\/summary$/);
  await page.getByLabel("요약이 내가 이야기한 사실과 맞는지 확인했어요.").check();
  await page.getByRole("button", { name: "요약 확인하고 계속" }).click();
  await page.getByRole("button", { name: "확인하고 사건 열기" }).click();
  await expect(page).toHaveURL(/\/cases\/[^/]+$/);
  await expect(page.getByRole("textbox", { name: "추가 사실 또는 질문" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "보내기", exact: true })).toBeDisabled();
  const tabs = page.getByRole("navigation", { name: "사건 메뉴" });
  await tabs.getByRole("link", { name: /^자료/ }).click();
  await expect(page.getByRole("button", { name: "파일 선택", exact: true })).toBeDisabled();
  await expect(page.getByLabel("업로드할 파일 선택", { exact: true })).toBeDisabled();
  await tabs.getByRole("link", { name: "타임라인", exact: true }).click();
  await expect(page.getByRole("button", { name: "일정 추가" })).toBeDisabled();
  await tabs.getByRole("link", { name: "다음 행동", exact: true }).click();
  await expect(page.getByRole("heading", { name: "다음 행동", exact: true })).toBeVisible();
  for (const checkbox of await page.locator(".workspace-action-list input").all())
    await expect(checkbox).toBeDisabled();
  await tabs.getByRole("link", { name: "리포트 보기" }).click();
  await expect(page.getByRole("button", { name: "새 버전 만들기" })).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "리포트 내용 편집" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "검토 내용 저장" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "PDF 다운로드" })).toBeDisabled();
  await expect(page.getByRole("button", { name: /선택 원본 ZIP/ })).toBeDisabled();
  await tabs.getByRole("link", { name: "대화", exact: true }).click();
  await expect(page.getByRole("button", { name: "보내기", exact: true })).toBeDisabled();
});
