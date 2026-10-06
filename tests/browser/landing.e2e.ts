import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const heroTitle = /막막했던 법률 문제,\s*이제 정리부터 가볍게\./;

test("public landing explains BARO and exposes the login and protected app entry points", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: heroTitle })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "메인 메뉴", exact: true });
  const login = navigation.getByRole("link", { name: "로그인", exact: true });
  await expect(login).toBeVisible();
  await expect(login).toHaveAttribute("href", "/login");
  await expect(
    page.getByRole("link", { name: "내 상황 정리하기", exact: true }).first(),
  ).toHaveAttribute("href", "/app");
  await expect(page.getByRole("textbox", { name: "지금까지 있었던 일" })).toHaveCount(0);
  for (const section of ["how-it-works", "organize", "principles", "faq"])
    await expect(page.locator(`#${section}`)).toBeVisible();
  await login.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Google로 계속하기" })).toBeVisible();
});

test("landing fits narrow screens and omits decorative scenes without removing the content", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  for (const width of [320, 390, 767, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("heading", { level: 1, name: heroTitle })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "메인 메뉴", exact: true }).getByRole("link", {
        name: "로그인",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
      `Landing must fit a ${width}px viewport`,
    ).toBe(true);
    const decorations = page.locator(".landing-decoration");
    expect(await decorations.count()).toBeGreaterThan(0);
    if (width <= 767)
      for (const decoration of await decorations.all()) await expect(decoration).toBeHidden();
    else await expect(decorations.first()).toBeVisible();
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await expect(page.getByRole("heading", { level: 1, name: heroTitle })).toBeVisible();
});

test("desktop visual progress follows scrolling and honors a changed motion preference", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator(".landing-motion-ready")).toHaveCount(1);
  const scene = page.locator("[data-scroll-scene]").first();
  await expect
    .poll(() =>
      scene.evaluate((element) =>
        getComputedStyle(element).getPropertyValue("--scene-progress").trim(),
      ),
    )
    .not.toBe("");
  const initialProgress = await scene.evaluate((element) =>
    getComputedStyle(element).getPropertyValue("--scene-progress").trim(),
  );
  expect(initialProgress).not.toBe("");
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect
    .poll(() =>
      scene.evaluate((element) =>
        getComputedStyle(element).getPropertyValue("--scene-progress").trim(),
      ),
    )
    .not.toBe(initialProgress);
  expect(await page.locator("[data-parallax]").count()).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() =>
      page
        .locator("[data-parallax]")
        .evaluateAll((elements) =>
          elements.every((element) => getComputedStyle(element).transform === "none"),
        ),
    )
    .toBe(true);
});

test("landing supports keyboard disclosures and remains accessible with reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "본문으로 건너뛰기" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".landing-main")).toBeFocused();
  const disclosure = page.locator("#faq details").first();
  const summary = disclosure.locator("summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(disclosure).toHaveAttribute("open", "");
  await page.keyboard.press("Space");
  await expect(disclosure).not.toHaveAttribute("open", "");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("core landing content, login and FAQs work when JavaScript is unavailable", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    ...(baseURL ? { baseURL } : {}),
    javaScriptEnabled: false,
  });
  const page = await context.newPage();
  try {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: heroTitle })).toBeVisible();
    for (const section of ["how-it-works", "organize", "principles", "faq"])
      await expect(page.locator(`#${section}`)).toBeVisible();
    const disclosure = page.locator("#faq details").first();
    await disclosure.locator("summary").click();
    await expect(disclosure).toHaveAttribute("open", "");
    await page
      .getByRole("navigation", { name: "메인 메뉴", exact: true })
      .getByRole("link", { name: "로그인", exact: true })
      .click();
    await expect(page).toHaveURL(/\/login$/);
  } finally {
    await context.close();
  }
});
