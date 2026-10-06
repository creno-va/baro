import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function openInteractiveFixture(
  page: Page,
  accountType: () => "customer" | "lawyer" | null = () => "customer",
) {
  // Navigation now resolves the API session after hydration. Keep this fixture
  // deterministic without granting authority through the presentation role prop.
  await page.route("**/api/me/session", (route) => {
    const type = accountType();
    return route.fulfill({
      json: {
        user: type ? { id: "synthetic-owner", name: "합성 계정", accountType: type } : null,
        needsConsent: false,
      },
    });
  });
  await page.route("**/api/cases?*", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route("**/api/v2/cases?*", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.goto("/__design-system");
  await expect(page.getByRole("heading", { name: "공유 UI 구성 요소" })).toBeVisible();
  // SSR buttons are visible before their React handlers are attached.
  await page.locator("astro-island[ssr]").waitFor({ state: "detached" });
}

test("application, login and case screens share local brand and remain usable at 320px", async ({
  page,
}) => {
  await page.route("**/api/me/session", (route) =>
    route.fulfill({
      json: {
        user: { id: "synthetic-owner", name: "합성 고객", accountType: "customer" },
        needsConsent: false,
      },
    }),
  );
  await page.route("**/api/cases?*", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route("**/api/v2/cases?*", (route) =>
    route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } }),
  );
  await page.route("**/api/me/consent", (route) =>
    route.fulfill({ json: { needsConsent: false } }),
  );
  await page.goto("/app");
  await expect(
    page.getByRole("heading", { name: /복잡한 일도,\s*하나씩 풀어가요\./ }),
  ).toBeVisible();
  await page.screenshot({ path: ".wrangler/home-desktop.png", fullPage: true });
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Google로 계속하기" })).toBeVisible();
  await page.screenshot({ path: ".wrangler/login-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 320, height: 760 });
  for (const path of ["/app", "/login", "/cases", "/cases/new"]) {
    await page.goto(path);
    await expect(page.locator(".brand img").first()).toHaveAttribute("src", "/brand/logo.svg");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({ path: ".wrangler/intake-320.png", fullPage: true });
  await page
    .getByRole("textbox", { name: "지금까지 있었던 일" })
    .fill("공통 디자인 확인을 위한 합성 사건입니다. 약속한 날짜가 지나도 대금을 받지 못했어요.");
  await expect(page.getByRole("button", { name: "저장하고 질문 시작" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "저장하고 질문 시작" })).toHaveCSS(
    "background-color",
    "rgb(49, 130, 246)",
  );
  await page.goto("/cases");
  await expect(page.getByRole("heading", { name: "아직 정리한 사건이 없어요" })).toBeVisible();
  await page.screenshot({ path: ".wrangler/case-list-320.png", fullPage: true });
});

test("synthetic role menus omit dormant routes; form and keyboard tabs remain accessible", async ({
  page,
}) => {
  let accountType: "customer" | "lawyer" | null = "customer";
  await openInteractiveFixture(page, () => accountType);
  const navigation = page.getByRole("navigation", { name: "주 메뉴", exact: true });
  await expect(navigation.getByRole("link", { name: "내 사건", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "변호사 찾기" })).toHaveAttribute("href", "/lawyers");
  accountType = "lawyer";
  await page.getByLabel("메뉴 예시 역할").selectOption("lawyer");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(navigation.getByRole("link", { name: "내 사건", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "변호사 프로필" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "계정 설정" })).toBeVisible();
  accountType = null;
  await page.getByLabel("메뉴 예시 역할").selectOption("moderator");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(navigation.getByRole("link", { name: "계정 설정" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "검토 대기" })).toHaveCount(0);
  await expect(page.getByLabel("사건 이름")).toHaveAttribute("aria-describedby", "fixture-help");
  const overview = page.getByRole("tab", { name: "개요", exact: true });
  await overview.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "자료", exact: true })).toBeFocused();
  await expect(overview).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tabpanel", { name: "자료", exact: true })).toContainText(
    "합성 자료 목록입니다.",
  );
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "다음 행동" })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(overview).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "다음 행동" })).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("missing or disabled defaults and rerendered tabs retain a reachable selected panel", async ({
  page,
}) => {
  await openInteractiveFixture(page);
  const first = page.getByRole("tab", { name: "첫 항목", exact: true });
  await expect(first).toHaveAttribute("aria-selected", "true");
  await expect(first).toHaveAttribute("tabindex", "0");
  await expect(page.getByRole("tab", { name: "선택 가능", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("button", { name: "첫 탭 활성 상태 변경" }).click();
  await expect(first).toBeDisabled();
  await expect(first).toHaveAttribute("aria-selected", "false");
  await expect(page.getByRole("tab", { name: "둘째 항목", exact: true })).toHaveAttribute(
    "tabindex",
    "0",
  );
  await expect(page.getByRole("tabpanel", { name: "둘째 항목", exact: true })).toBeVisible();
});

test("unmounting a nested dialog retains parent scroll lock and restores valid focus", async ({
  page,
}) => {
  await openInteractiveFixture(page);
  await page.getByRole("button", { name: "검토 안내 열기" }).click();
  const parent = page.getByRole("dialog", { name: "검토 안내", exact: true });
  await expect(parent).toBeVisible();
  await parent.getByRole("button", { name: "추가 안내 열기" }).click();
  const nested = page.getByRole("dialog", { name: "추가 안내", exact: true });
  await expect(nested).toBeVisible();
  await nested.getByRole("button", { name: "추가 안내 제거" }).click();
  await expect(nested).toHaveCount(0);
  await expect(parent).toBeVisible();
  await expect(parent.getByRole("button", { name: "추가 안내 열기" })).toBeFocused();
  expect(await page.locator("html").evaluate((element) => getComputedStyle(element).overflow)).toBe(
    "hidden",
  );
  await parent.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(page.getByRole("button", { name: "검토 안내 열기" })).toBeFocused();
  expect(
    await page.locator("html").evaluate((element) => getComputedStyle(element).overflow),
  ).not.toBe("hidden");
});

test("modal traps focus, closes with Escape, restores opener and uses visible focus", async ({
  page,
}) => {
  await openInteractiveFixture(page);
  const opener = page.getByRole("button", { name: "검토 안내 열기" });
  await opener.focus();
  await opener.press("Enter");
  const dialog = page.getByRole("dialog", { name: "검토 안내", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "닫기", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "확인했어요" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "닫기", exact: true })).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
  expect(await opener.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe(
    "none",
  );
});

test("320px mobile sheet and 200% layout preserve all states and local font", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await openInteractiveFixture(page);
  await page.getByRole("button", { name: "메뉴 열기" }).click();
  const menu = page.getByRole("dialog", { name: "메뉴", exact: true });
  await expect(menu).toBeVisible();
  await page.screenshot({ path: ".wrangler/design-system-sheet-320.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "메뉴 열기" })).toBeFocused();
  for (const state of ["loading", "empty", "error", "limit", "permission", "pending"])
    await expect(page.locator(`[data-state="${state}"]`)).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('16px "Pretendard Variable"'))).toBe(true);
  await page.screenshot({ path: ".wrangler/design-system-320.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".wrangler/design-system-200.png", fullPage: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator(".ui-button")
      .first()
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).transitionDuration)),
  ).toBeLessThan(0.01);
});
