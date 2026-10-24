import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { syntheticConsentStatus } from "../fixtures/consent-status";

const stories = Array.from({ length: 30 }, (_, index) => ({
  id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
  title: `합성 사건 ${index + 1} · 오래 보관한 자료와 약속한 날짜를 차근차근 정리하는 이야기`,
  status: "completed",
  createdAt: "2026-10-21T00:00:00.000Z",
  updatedAt: "2026-10-24T00:00:00.000Z",
}));
const lastStory = stories[29];
if (!lastStory) throw new Error("Synthetic story fixture is missing");
async function session(page: Page) {
  await page.route("**/api/me/session", (route) =>
    route.fulfill({
      json: {
        user: { id: "synthetic-owner", name: "합성 검증 계정", accountType: "customer" },
        needsConsent: false,
      },
    }),
  );
  await page.route("**/api/me/consent", (route) =>
    route.fulfill({ json: syntheticConsentStatus(false) }),
  );
  await page.route("**/api/v2/cases?*", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null, previews: [] } }),
  );
  await page.route("**/api/cases?*", (route) =>
    route.fulfill({ json: { items: stories, nextCursor: null } }),
  );
}
async function settled(page: Page) {
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await expect(page.locator(".intake-case-card")).toHaveCount(30);
  await page.evaluate(() => document.fonts.ready);
}
async function fits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

test("recent stories scroll independently while account controls stay visible at desktop heights", async ({
  page,
}) => {
  await session(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const height of [600, 720, 900]) {
    await page.setViewportSize({ width: 1440, height });
    await page.goto("/cases");
    await settled(page);
    const recent = page.locator(".sidebar-desktop .sidebar-recent__list");
    const account = page.locator(".sidebar-desktop .sidebar-account");
    await expect(account.getByRole("link", { name: /합성 검증 계정/ })).toBeInViewport({
      ratio: 1,
    });
    const before = await account.boundingBox();
    const metrics = await recent.evaluate((node) => ({
      scroll: node.scrollHeight,
      height: node.clientHeight,
    }));
    if (height === 600) expect(metrics.scroll).toBeGreaterThan(metrics.height);
    await recent.focus();
    await page.keyboard.press("End");
    if (metrics.scroll > metrics.height)
      await expect.poll(() => recent.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await page
      .getByRole("heading", { name: lastStory.title, exact: true })
      .scrollIntoViewIfNeeded();
    expect((await account.boundingBox())?.y).toBe(before?.y);
    expect(await page.locator(".sidebar-desktop").evaluate((node) => node.scrollTop)).toBe(0);
    await fits(page);
    await page.screenshot({ path: `.wrangler/ui522/sidebar-1440-${height}.png` });
  }
});

test("dialogs center, contain long content and restore focus across viewport sizes and page scroll", async ({
  page,
}) => {
  await session(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [width, height] of [
    [320, 480],
    [390, 844],
    [768, 900],
    [1024, 768],
    [1440, 900],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width: width ?? 320, height: height ?? 480 });
    await page.goto("/cases");
    await settled(page);
    const opener = page.getByRole("button", {
      name: `${lastStory.title} 사건 삭제`,
      exact: true,
    });
    await opener.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("삭제하려면 DELETE를 입력해 주세요.")).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(Math.abs((bounds?.x ?? 0) + (bounds?.width ?? 0) / 2 - (width ?? 0) / 2)).toBeLessThan(
      10,
    );
    expect(Math.abs((bounds?.y ?? 0) + (bounds?.height ?? 0) / 2 - (height ?? 0) / 2)).toBeLessThan(
      2,
    );
    await expect(dialog.getByRole("button", { name: "취소", exact: true })).toBeEnabled();
    await dialog.getByRole("button", { name: "취소", exact: true }).scrollIntoViewIfNeeded();
    await expect(dialog.getByRole("button", { name: "닫기", exact: true })).toBeInViewport({
      ratio: 1,
    });
    expect(await page.locator("html").evaluate((node) => getComputedStyle(node).overflow)).toBe(
      "hidden",
    );
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: `.wrangler/ui522/dialog-${width}.png` });
    await page.keyboard.press("Escape");
    await expect(opener).toBeFocused();
    await fits(page);
  }
});

test("pending list keeps structure, announces loading, stops motion on request and clears on failure", async ({
  page,
}) => {
  await session(page);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/cases?*", async (route) => {
    await gate;
    await route.fulfill({
      status: 503,
      json: { error: { code: "UNAVAILABLE", message: "합성 연결 실패", retryable: true } },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/cases");
  const loading = page.locator("main .ui-loading");
  await expect(loading).toHaveAttribute("role", "status");
  await expect(loading.locator('[data-slot="skeleton"]')).toHaveCount(12);
  await expect(loading.locator(".ui-spinner")).toHaveCSS("animation-name", "app-spin");
  await expect(page.getByRole("button", { name: "새로 불러오기" })).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(loading.locator(".ui-spinner")).toHaveCSS("animation-name", "none");
  await expect(loading.locator('[data-slot="skeleton"]').first()).toHaveCSS(
    "animation-name",
    "none",
  );
  await page.screenshot({ path: ".wrangler/ui522/loading-390.png" });
  release();
  await expect(loading).toHaveCount(0);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "새로 불러오기" })).not.toHaveAttribute(
    "aria-busy",
  );
  await fits(page);
});

test("mobile menu, classic scrollbars, zoom and foreground contrast stay usable", async ({
  page,
}) => {
  await session(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [width, height] of [
    [320, 760],
    [390, 844],
    [844, 390],
    [1024, 768],
    [1440, 480],
  ]) {
    await page.setViewportSize({ width: width ?? 320, height: height ?? 760 });
    await page.goto("/cases");
    await settled(page);
    const opener = page.getByRole("button", { name: "메뉴 열기" });
    await opener.click();
    const menu = page.getByRole("dialog", { name: "메뉴", exact: true });
    await expect(menu.getByRole("button", { name: "닫기", exact: true })).toBeFocused();
    await menu.getByRole("link", { name: /합성 검증 계정/ }).scrollIntoViewIfNeeded();
    await expect(menu.getByRole("link", { name: /합성 검증 계정/ })).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: `.wrangler/ui522/menu-${width}.png` });
    await page.keyboard.press("Escape");
    await expect(opener).toBeFocused();
    await page.evaluate(() => {
      document.documentElement.style.scrollbarGutter = "stable";
    });
    await fits(page);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await fits(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("directory and profile waits retain useful placeholders and search stays available", async ({
  page,
}) => {
  await session(page);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v2/lawyers/directory*", async (route) => {
    await gate;
    await route.fulfill({
      json: {
        items: [],
        nextCursor: null,
        expiresAt: "2099-01-01T00:00:00Z",
        rotation: { day: "2026-10-24", algorithm: "daily_sha256_pivot_v1" },
      },
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/lawyers");
  await expect(page.locator(".ui-loading--directory")).toBeVisible();
  await expect(page.getByRole("button", { name: "검색", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "검색", exact: true })).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await page.screenshot({ path: ".wrangler/ui522/directory-loading-1440.png" });
  release();
  await expect(page.getByText("조건에 맞는 공개 프로필이 없어요.")).toBeVisible();
  await expect(page.locator(".ui-loading--directory")).toHaveCount(0);

  let releaseProfile = () => {};
  const profileGate = new Promise<void>((resolve) => {
    releaseProfile = resolve;
  });
  await page.route("**/api/v2/lawyers/**synthetic-profile", async (route) => {
    await profileGate;
    await route.fulfill({
      status: 404,
      json: { error: { code: "NOT_FOUND", message: "합성 비공개 프로필", retryable: false } },
    });
  });
  await page.goto("/lawyers/synthetic-profile");
  await expect(page.locator(".ui-loading--detail")).toBeVisible();
  await page.screenshot({ path: ".wrangler/ui522/profile-loading-1440.png" });
  releaseProfile();
  await expect(page.getByRole("alert")).toContainText("현재 공개된 프로필이 아니에요.");
  await expect(page.locator(".ui-loading--detail")).toHaveCount(0);
});
