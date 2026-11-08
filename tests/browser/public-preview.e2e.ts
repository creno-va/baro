import { type ChildProcess, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { goToCaseTool, returnToCaseConversation } from "../helpers/case-navigation";
import { openReportEditor } from "../helpers/report-controls";

const origin = "http://127.0.0.1:4362";
test.use({ baseURL: origin });
let server: ChildProcess;

async function expectNoLawyerNavigation(page: Page) {
  await expect(
    page.locator(
      'a[href="/lawyer"], a[href^="/lawyer/"], a[href="/lawyers"], a[href^="/lawyers/"]',
    ),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: /변호사 찾기|변호사 등록|프로필 관리/ })).toHaveCount(
    0,
  );
}

async function expectCurrentNavigation(menu: Locator) {
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("link")).toHaveCount(2);
  const newCase = menu.getByRole("link", { name: "새 사건 입력", exact: true });
  await expect(newCase).toBeVisible();
  await expect(newCase).toHaveAttribute("href", "/app");
  await expect(newCase).toHaveAttribute("aria-current", "page");
  const cases = menu.getByRole("link", { name: "내 사건", exact: true });
  await expect(cases).toBeVisible();
  await expect(cases).toHaveAttribute("href", "/cases");
}

async function expectEntryDirections(page: Page) {
  const direction = page.getByRole("combobox", { name: "준비하는 방향", exact: true });
  await expect(direction).toBeEnabled();
  await expect(direction.locator("option")).toHaveText([
    "민사 준비",
    "민사 대응",
    "형사 고소 준비",
    "형사 대응",
    "분야는 아직 모름 · 요구 준비",
    "분야는 아직 모름 · 받은 주장에 대응",
  ]);
  for (const label of ["민사 준비", "민사 대응", "형사 고소 준비", "형사 대응"]) {
    await direction.selectOption({ label });
    await expect(direction.locator("option:checked")).toHaveText(label);
  }
  await direction.selectOption({ label: "민사 준비" });
}

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

test("app opens directly without launch notice on desktop and 320px", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/app");
  const modal = page.getByRole("dialog", { name: "BARO를 먼저 만나보세요" });
  await expect(page.getByRole("textbox", { name: "지금까지 있었던 일" })).toBeEnabled();
  await expect(modal).toHaveCount(0);
  await expect(page.getByText(/2026\.11\.(01|10)/)).toHaveCount(0);
  await expectNoLawyerNavigation(page);
  await expectCurrentNavigation(page.getByRole("navigation", { name: "주 메뉴", exact: true }));
  await expectEntryDirections(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "/tmp/baro-public-preview-desktop.png",
    fullPage: true,
    animations: "disabled",
  });

  await page.setViewportSize({ width: 320, height: 800 });
  await page.reload();
  await expect(page.getByRole("textbox", { name: "지금까지 있었던 일" })).toBeEnabled();
  await expect(modal).toHaveCount(0);
  await expectNoLawyerNavigation(page);
  await expectEntryDirections(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const menuTrigger = page.getByRole("button", { name: "메뉴 열기", exact: true });
  await menuTrigger.focus();
  await page.keyboard.press("Enter");
  const mobileMenu = page.getByRole("dialog", { name: "메뉴", exact: true });
  await expect(mobileMenu).toBeVisible();
  await expectCurrentNavigation(
    mobileMenu.getByRole("navigation", { name: "모바일 주 메뉴", exact: true }),
  );
  await expectNoLawyerNavigation(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(mobileMenu).not.toBeVisible();
  await expect(menuTrigger).toBeFocused();
  await page.screenshot({
    path: "/tmp/baro-public-preview-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("intake opens an active workspace with four case tasks and report controls", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/app");
  await expect(page.getByRole("textbox", { name: "지금까지 있었던 일" })).toBeEnabled();
  await expectNoLawyerNavigation(page);
  await expectCurrentNavigation(page.getByRole("navigation", { name: "주 메뉴", exact: true }));
  await expectEntryDirections(page);
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
  await expect(page.getByRole("textbox", { name: "요약 편집", exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "사실 내용", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "맞아요", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "이 내용으로 계속할까요?", exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "확인하고 계속", exact: true }).click();
  await expect(page).toHaveURL(/\/cases\/[^/]+$/);
  await expect(page.getByRole("textbox", { name: "추가 사실 또는 질문" })).toBeEnabled();
  // Empty input still prevents submission; only the launch restriction is removed.
  await expect(page.getByRole("button", { name: "보내기", exact: true })).toBeDisabled();
  await page.getByRole("textbox", { name: "추가 사실 또는 질문" }).fill("합성 추가 사실입니다.");
  await expect(page.getByRole("button", { name: "보내기", exact: true })).toBeEnabled();
  const casePath = new URL(page.url()).pathname;
  const tasks = page.getByRole("navigation", { name: "사건 작업", exact: true });
  await expect(tasks.getByRole("link")).toHaveCount(4);
  for (const [name, path] of [
    ["대화", ""],
    [/^자료(?:\s*\d+개)?$/, "/files"],
    ["리포트", "/reports"],
    ["문서 초안", "/reports#document-drafts"],
  ] as const) {
    const link = tasks.getByRole("link", { name, exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", `${casePath}${path}`);
  }
  await expect(tasks.getByRole("link", { name: "대화", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expectNoLawyerNavigation(page);
  await tasks.getByRole("link", { name: /^자료/ }).click();
  await expect(page).toHaveURL(`${casePath}/files`);
  await expect(tasks.getByRole("link", { name: /^자료/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: /^(파일 선택|파일 추가)$/ })).toBeEnabled();
  await expect(page.getByLabel("업로드할 파일 선택", { exact: true })).toBeEnabled();
  await tasks.getByRole("link", { name: "대화", exact: true }).click();
  await expect(page).toHaveURL(casePath);
  await expect(page.getByRole("textbox", { name: "추가 사실 또는 질문" })).toHaveValue(
    "합성 추가 사실입니다.",
  );
  await page.getByRole("textbox", { name: "추가 사실 또는 질문" }).fill("");
  await expect(page.getByRole("button", { name: "보내기", exact: true })).toBeDisabled();
  await goToCaseTool(page, "timeline");
  await expect(page).toHaveURL(`${casePath}/timeline`);
  await expect(page.getByRole("button", { name: "일정 추가" })).toBeEnabled();
  await goToCaseTool(page, "actions");
  await expect(page).toHaveURL(`${casePath}/actions`);
  await expect(page.getByRole("heading", { name: "다음 행동", exact: true })).toBeVisible();
  await expect(page.locator(".workspace-action-list input").first()).toBeEnabled();
  await tasks.getByRole("link", { name: "리포트", exact: true }).click();
  await expect(page).toHaveURL(`${casePath}/reports?mode=conversation`);
  await expect(tasks.getByRole("link", { name: "리포트", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const preparation = page.getByRole("region", { name: "리포트 준비 상태", exact: true });
  await expect(preparation).toBeVisible();
  await preparation.getByRole("button", { name: "리포트 준비", exact: true }).click();
  await expect(page.getByRole("button", { name: "새 버전 만들기" })).toBeEnabled();
  await openReportEditor(page);
  const reportEditor = page.getByRole("textbox", { name: / 수정$/ }).first();
  await expect(reportEditor).toBeEnabled();
  const saveReport = page.getByRole("button", { name: "수정 내용 저장", exact: true });
  await expect(saveReport).toBeDisabled();
  const editedReport = `${await reportEditor.inputValue()}\n합성 검증에서 확인한 추가 내용입니다.`;
  await reportEditor.fill(editedReport);
  await expect(saveReport).toBeEnabled();
  await saveReport.click();
  await expect(page.locator(".report-edit-toggle")).toBeEnabled();
  await openReportEditor(page);
  await expect(saveReport).toBeDisabled();
  await expect(reportEditor).toHaveValue(editedReport);
  await expect(page.getByRole("button", { name: "검토 내용 저장" })).toHaveCount(0);
  await expect(page.getByLabel("내용·식별정보·선택한 사진을 확인했어요")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "PDF 다운로드" })).toBeEnabled();
  await expect(page.getByRole("button", { name: /HTML 다운로드|선택 원본 ZIP/ })).toHaveCount(0);
  await tasks.getByRole("link", { name: "문서 초안", exact: true }).click();
  await expect(page).toHaveURL(`${casePath}/reports?mode=conversation#document-drafts`);
  await expect(tasks.getByRole("link", { name: "문서 초안", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("heading", { name: "문서 초안", exact: true })).toBeVisible();
  await expectNoLawyerNavigation(page);
  await returnToCaseConversation(page);
  await expect(page).toHaveURL(casePath);
  await expect(page.getByRole("textbox", { name: "추가 사실 또는 질문" })).toBeEnabled();
});
