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
  await expect(page.locator(".sidebar-desktop .sidebar-story")).toHaveCount(30);
  await page.evaluate(() => document.fonts.ready);
  if (await page.getByRole("button", { name: "메뉴 열기" }).isVisible())
    await page.getByRole("button", { name: "메뉴 열기" }).click();
}
async function fits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

test("sidebar delete overlays a full-width title and stays centered on hover and focus", async ({
  page,
}) => {
  await session(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app");
  await settled(page);
  const row = page.locator(".sidebar-desktop .sidebar-story-row").first();
  const link = row.locator(".sidebar-story");
  const copy = row.locator("strong");
  const remove = row.getByRole("button");
  for (const product of [false, true]) {
    await page
      .locator(".app-frame")
      .evaluate((node, product) => node.classList.toggle("app-frame--product", product), product);
    await page.locator("main").focus();
    await page.mouse.move(800, 400);
    await expect(remove).toHaveCSS("opacity", "0");
    await expect(remove).toHaveCSS("pointer-events", "none");
    const rowBounds = await row.boundingBox();
    const copyBounds = await copy.boundingBox();
    if (!rowBounds || !copyBounds) throw new Error("Synthetic sidebar row missing");
    expect(copyBounds.width).toBeGreaterThanOrEqual(rowBounds.width - 22);
    if (product) await row.screenshot({ path: ".wrangler/sidebar-overlay-rest.png" });
    await row.hover();
    await expect(remove).toHaveCSS("opacity", "1");
    const button = await remove.boundingBox();
    const icon = await remove.locator("svg").boundingBox();
    if (!button || !icon) throw new Error("Synthetic sidebar icon missing");
    expect(
      Math.abs(button.y + button.height / 2 - rowBounds.y - rowBounds.height / 2),
    ).toBeLessThanOrEqual(0.5);
    expect(Math.abs(icon.y + icon.height / 2 - button.y - button.height / 2)).toBeLessThanOrEqual(
      0.5,
    );
    expect(Math.abs(icon.x + icon.width / 2 - button.x - button.width / 2)).toBeLessThanOrEqual(
      0.5,
    );
    expect((await copy.boundingBox())?.width).toBeCloseTo(copyBounds.width, 1);
    if (product) await row.screenshot({ path: ".wrangler/sidebar-overlay-hover.png" });
    await page.mouse.move(800, 400);
    await link.focus();
    await expect(remove).toHaveCSS("opacity", "1");
    await page.keyboard.press("Tab");
    await expect(remove).toBeFocused();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "이 사건을 삭제할까요?", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "사건 삭제", exact: true })).toBeEnabled();
    await expect(dialog.getByRole("textbox")).toHaveCount(0);
    await expect(dialog.getByText(stories[0]?.title ?? "", { exact: true })).toHaveCount(0);
    const actions = dialog.locator(".deletion-dialog-actions");
    await expect(actions.getByRole("button")).toHaveText(["사건 삭제", "취소"]);
    const geometry = await actions.evaluate((node) => {
      const buttons = node.querySelectorAll("button");
      const remove = buttons[0]?.getBoundingClientRect();
      const cancel = buttons[1]?.getBoundingClientRect();
      if (!remove || !cancel) throw new Error("Deletion actions missing");
      return {
        remove: remove.x,
        cancel: cancel.x,
        right: node.getBoundingClientRect().right - cancel.right,
      };
    });
    expect(geometry.remove).toBeLessThan(geometry.cancel);
    expect(Math.abs(geometry.right)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `.wrangler/deletion-dialog-${product ? "product" : "app"}.png` });
    await dialog.getByRole("button", { name: "취소", exact: true }).click();
  }
});

test("touch sidebar retains a visible centered overlay delete control", async ({
  browser,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Synthetic sidebar base URL missing");
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  try {
    const page = await context.newPage();
    await session(page);
    await page.goto("/app");
    await settled(page);
    const row = page.locator(".ui-sheet .sidebar-story-row").first();
    const remove = row.getByRole("button");
    await expect(remove).toHaveCSS("opacity", "1");
    await expect(remove).toHaveCSS("pointer-events", "auto");
    const bounds = await row.boundingBox();
    const button = await remove.boundingBox();
    if (!bounds || !button) throw new Error("Synthetic touch sidebar missing");
    expect(
      Math.abs(button.y + button.height / 2 - bounds.y - bounds.height / 2),
    ).toBeLessThanOrEqual(0.5);
    await remove.tap();
    await expect(
      page.getByRole("dialog", { name: "이 사건을 삭제할까요?", exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("press feedback keeps the pointer target fixed with motion enabled", async ({ page }) => {
  await session(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/cases");
  await settled(page);
  const opener = page.getByRole("button", {
    name: `${stories[0]?.title} 사건 삭제`,
    exact: true,
  });
  await opener.scrollIntoViewIfNeeded();
  const before = await opener.boundingBox();
  if (!before) throw new Error("Missing synthetic delete button");
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(opener).toHaveCSS("transform", "none");
  expect(await opener.boundingBox()).toEqual(before);
  await page.mouse.up();
  await expect(
    page.getByRole("dialog", { name: "이 사건을 삭제할까요?", exact: true }),
  ).toBeVisible();
});

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
      .locator(".sidebar-desktop")
      .getByRole("link", { name: lastStory.title, exact: true })
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
    const dialog = page.getByRole("dialog", { name: "이 사건을 삭제할까요?", exact: true });
    await expect(dialog.getByRole("textbox")).toHaveCount(0);
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
  await page.getByRole("button", { name: "메뉴 열기" }).click();
  const loading = page.locator(".ui-sheet .ui-loading");
  await expect(loading).toHaveAttribute("role", "status");
  await expect(loading.locator('[data-slot="skeleton"]')).toHaveCount(12);
  await expect(loading.locator(".ui-spinner")).toHaveCSS("animation-name", "app-spin");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(loading.locator(".ui-spinner")).toHaveCSS("animation-name", "none");
  await expect(loading.locator('[data-slot="skeleton"]').first()).toHaveCSS(
    "animation-name",
    "none",
  );
  await page.screenshot({ path: ".wrangler/ui522/loading-390.png" });
  release();
  await expect(loading).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "사건을 불러오지 못했어요" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "다시 불러오기" })).toBeVisible();
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
    if (!(await opener.isVisible())) {
      await expect(page.locator(".sidebar-desktop .sidebar-account")).toBeVisible();
      await fits(page);
      continue;
    }
    if (!(await page.getByRole("dialog", { name: "메뉴", exact: true }).isVisible()))
      await opener.click();
    const menu = page.getByRole("dialog", { name: "메뉴", exact: true });
    await expect(menu.getByRole("button", { name: "닫기", exact: true })).toBeFocused();
    await menu.getByRole("link", { name: /합성 검증 계정/ }).scrollIntoViewIfNeeded();
    await expect(menu.getByRole("link", { name: /합성 검증 계정/ })).toBeInViewport({
      ratio: 0.99,
    });
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

test("Escape cannot hide a deletion request that the dialog owner is still waiting for", async ({
  page,
}) => {
  await session(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  let release = () => {};
  let writes = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/cases/${lastStory.id}`, async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    writes++;
    await gate;
    await route.fulfill({
      status: 503,
      json: { error: { code: "UNAVAILABLE", message: "합성 요청 실패", retryable: true } },
    });
  });
  await page.goto("/cases");
  await settled(page);
  const opener = page.getByRole("button", { name: `${lastStory.title} 사건 삭제`, exact: true });
  await opener.locator("..").hover();
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "이 사건을 삭제할까요?", exact: true });
  await dialog.getByRole("button", { name: "사건 삭제", exact: true }).click();
  await expect.poll(() => writes).toBe(1);
  await expect(dialog.getByRole("button", { name: "삭제 접수 중…" })).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(dialog).toBeVisible();
  expect(writes).toBe(1);
  release();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("Escape dismisses only the top dialog and restores focus inside its parent", async ({
  page,
}) => {
  await session(page);
  await page.goto("/__design-system");
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  const opener = page.getByRole("button", { name: "검토 안내 열기", exact: true });
  await opener.click();
  const parent = page.getByRole("dialog", { name: "검토 안내", exact: true });
  const nestedOpener = parent.getByRole("button", { name: "추가 안내 열기", exact: true });
  await nestedOpener.click();
  await expect(page.getByRole("dialog", { name: "추가 안내", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "추가 안내", exact: true })).toHaveCount(0);
  await expect(parent).toBeVisible();
  await expect(nestedOpener).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(parent).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("a pending consent shows its account action without pretending to load recent cases", async ({
  page,
}) => {
  await session(page);
  await page.route("**/api/me/session", (route) =>
    route.fulfill({
      json: {
        user: { id: "synthetic-owner", name: "필수 확인 계정", accountType: "customer" },
        needsConsent: true,
      },
    }),
  );
  await page.goto("/help");
  await expect(page.locator(".sidebar-desktop .sidebar-profile")).toHaveAttribute(
    "href",
    "/consent",
  );
  await expect(page.locator(".sidebar-desktop .sidebar-recent")).toHaveCount(0);
});
