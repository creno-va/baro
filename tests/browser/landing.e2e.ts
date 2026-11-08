import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const title = "내 사건을 이해하고, 다음 준비를 차근차근";

test("public entry explains current preparation tasks before asking the visitor to sign in", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  for (const text of [
    "민사 준비·대응",
    "형사 고소 준비·대응",
    "이야기를 적어요",
    "대화와 자료로 정리해요",
    "리포트로 다시 확인해요",
  ])
    await expect(page.getByRole("main")).toContainText(text);
  await expect(page.getByRole("main")).toContainText("변호사 연결 기능은 제공하지 않습니다");
  await expect(page.getByRole("textbox")).toHaveCount(0);
  for (const link of await page.getByRole("link", { name: "내 사건 준비하기", exact: true }).all())
    await expect(link).toHaveAttribute("href", "/app");
  await expect(page.locator('a[href^="/lawyer"]')).toHaveCount(0);
});

test("starting from the public page preserves the protected app destination", async ({ page }) => {
  await page.route("**/api/me/session", (route) =>
    route.fulfill({ json: { user: null, needsConsent: false } }),
  );
  await page.goto("/");
  await page.getByRole("link", { name: "내 사건 준비하기", exact: true }).first().focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fapp$/);
  await expect(page.getByRole("button", { name: "Google로 계속하기", exact: true })).toBeEnabled();
});

test("all public content reflows on phones, short screens and a 200% desktop layout", async ({
  page,
}) => {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 640, height: 450 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    for (const link of await page.locator("header a").all()) {
      const bounds = await link.boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
      expect(bounds?.width).toBeGreaterThanOrEqual(44);
    }
  }
});

test("shared public navigation, skip link and help topics support keyboard navigation", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "본문으로 건너뛰기" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await page
    .getByRole("navigation", { name: "서비스 안내" })
    .getByRole("link", { name: "도움말", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/help$/);
  await page
    .getByRole("navigation", { name: "도움말 주제" })
    .getByRole("link", { name: "자료와 리포트", exact: true })
    .click();
  await expect(page).toHaveURL(/#reports$/);
  const summary = page.locator("#reports summary").first();
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(summary.locator("..")).toHaveAttribute("open", "");
});

test("reduced motion keeps the complete entry and help content available without autoplay", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const path of ["/", "/help"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("video[autoplay]")).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
});

test("visiting and reading the entry starts no private data, AI, legal or contact requests", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("**/api/**", (route) => {
    requests.push(new URL(route.request().url()).pathname);
    return route.abort();
  });
  await page.goto("/");
  await page
    .getByRole("heading", { name: "사건 준비에 필요한 내용을 한곳에서", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(page.getByRole("main")).toContainText("AI가 정리한 내용은 직접 확인해 주세요");
  expect(requests).toEqual([]);
});

test("public navigation and the actual 404 fallback remain useful without JavaScript", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 320, height: 760 },
  });
  const page = await context.newPage();
  try {
    await page.goto(baseURL ?? "http://127.0.0.1:4337");
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await page.getByRole("link", { name: "이용 방법 보기", exact: true }).click();
    await expect(page).toHaveURL(/\/help$/);
    const details = page.locator("#reports details").first();
    await details.locator("summary").click();
    await expect(details).toHaveAttribute("open", "");
    const response = await page.goto(new URL("/synthetic-missing-page", baseURL).href);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("link", { name: "홈으로", exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});
