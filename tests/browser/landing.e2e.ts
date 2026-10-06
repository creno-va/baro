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
  for (const section of [
    "how-it-works",
    "phone-story",
    "everyday",
    "organize",
    "principles",
    "faq",
  ])
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
  // A 1280px display at 200% browser zoom has a 640 CSS-pixel layout viewport.
  await page.setViewportSize({ width: 640, height: 450 });
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

test("desktop films pause offscreen and preserve an explicit pause when revisiting the hero", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const heroFilm = page.locator('video[data-film="hero"]');
  const toggle = page.locator('[data-film-toggle="hero"]');
  await expect
    .poll(() => heroFilm.evaluate((video) => video instanceof HTMLVideoElement && !video.paused), {
      timeout: 15_000,
    })
    .toBe(true);
  await expect(toggle).toHaveAccessibleName("첫 화면 영상 일시정지");
  expect(
    await heroFilm.evaluate(
      (video) =>
        video instanceof HTMLVideoElement && video.muted && video.loop && video.playsInline,
    ),
  ).toBe(true);
  await expect(page.locator('video[data-film="benefit"]')).not.toHaveAttribute("src");
  await page.locator("#phone-story").evaluate((element) => {
    window.scrollTo({ top: scrollY + element.getBoundingClientRect().top, behavior: "instant" });
  });
  await expect
    .poll(() => heroFilm.evaluate((video) => video instanceof HTMLVideoElement && video.paused))
    .toBe(true);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect(toggle).toHaveAccessibleName("첫 화면 영상 일시정지");
  await toggle.click();
  await expect(toggle).toHaveAccessibleName("첫 화면 영상 재생하기");
  await page.locator("#phone-story").evaluate((element) => {
    window.scrollTo({ top: scrollY + element.getBoundingClientRect().top, behavior: "instant" });
  });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect(toggle).toHaveAccessibleName("첫 화면 영상 재생하기");
  expect(
    await heroFilm.evaluate((video) => video instanceof HTMLVideoElement && video.paused),
  ).toBe(true);
  await toggle.click();
  await expect(toggle).toHaveAccessibleName("첫 화면 영상 일시정지");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(toggle).toBeHidden();
  await expect
    .poll(() => heroFilm.evaluate((video) => video instanceof HTMLVideoElement && video.paused))
    .toBe(true);
});

test("mobile and reduced-motion entry keep all phone chapters readable without downloading films", async ({
  page,
}) => {
  const videoRequests: string[] = [];
  page.on("request", (request) => {
    if (/\.mp4(?:\?|$)/.test(request.url())) videoRequests.push(request.url());
  });
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    await page.setViewportSize({ width: reducedMotion === "reduce" ? 1440 : 390, height: 900 });
    await page.emulateMedia({ reducedMotion });
    await page.goto("/");
    await expect(page.locator('[data-film-toggle="hero"]')).toHaveAttribute(
      "data-playing",
      "false",
    );
    await expect(page.locator(".phone-story-visual")).toBeHidden();
    await expect(page.locator(".phone-story-controls")).toBeHidden();
    await expect(page.locator("[data-phone-chapter]")).toHaveCount(4);
    for (const chapter of await page.locator("[data-phone-chapter]").all())
      await expect(chapter).toBeVisible();
    for (const film of await page.locator("video[data-film]").all()) {
      await expect(film).not.toHaveAttribute("src");
      expect(
        await film.evaluate((video) => video instanceof HTMLVideoElement && video.paused),
      ).toBe(true);
    }
    if (reducedMotion === "no-preference") {
      for (const photo of await page.locator(".everyday-photo-stage").all())
        await expect(photo).toBeHidden();
      await expect(page.locator('[data-film-toggle="hero"]')).toBeHidden();
    }
  }
  expect(videoRequests).toEqual([]);
});

test("phone chapters follow keyboard selection and reverse scrolling while the scene remains pinned", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const story = page.locator("[data-phone-story]");
  const controls = page.locator("[data-phone-step]");
  await expect(story).toHaveClass(/phone-story-ready/);
  await story.evaluate((element) => {
    const pin = element.querySelector(".phone-story-sticky");
    const top = pin ? Number.parseFloat(getComputedStyle(pin).top) : 76;
    window.scrollTo({
      top: scrollY + element.getBoundingClientRect().top - top,
      behavior: "instant",
    });
  });
  await expect(story).toHaveAttribute("data-chapter", "0");
  const startTurn = await story.evaluate((element) =>
    getComputedStyle(element).getPropertyValue("--phone-turn"),
  );
  await controls.nth(0).focus();
  await page.keyboard.press("End");
  await expect(controls.nth(3)).toBeFocused();
  await expect(controls.nth(3)).toHaveAttribute("aria-pressed", "true");
  await expect(story).toHaveAttribute("data-chapter", "3");
  await expect(page.locator('[data-phone-chapter="3"]')).toBeVisible();
  await expect(page.locator('[data-phone-chapter="0"]')).toBeHidden();
  const endTurn = await story.evaluate((element) =>
    getComputedStyle(element).getPropertyValue("--phone-turn"),
  );
  expect(Number.parseFloat(endTurn)).toBeLessThan(Number.parseFloat(startTurn) - 200);
  await expect(page.locator(".phone-story-sticky")).toHaveCSS("position", "sticky");
  expect(
    await page
      .locator(".phone-story-sticky")
      .evaluate((element) =>
        Math.abs(
          element.getBoundingClientRect().top - Number.parseFloat(getComputedStyle(element).top),
        ),
      ),
  ).toBeLessThanOrEqual(1);
  await page.keyboard.press("Home");
  await expect(controls.nth(0)).toBeFocused();
  await expect(story).toHaveAttribute("data-chapter", "0");
  await expect(controls.nth(0)).toHaveAttribute("aria-pressed", "true");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(story).not.toHaveClass(/phone-story-ready/);
  for (const chapter of await page.locator("[data-phone-chapter]").all())
    await expect(chapter).toBeVisible();
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
    for (const section of [
      "how-it-works",
      "phone-story",
      "everyday",
      "organize",
      "principles",
      "faq",
    ])
      await expect(page.locator(`#${section}`)).toBeVisible();
    for (const chapter of await page.locator("[data-phone-chapter]").all())
      await expect(chapter).toBeVisible();
    await expect(page.locator(".phone-story-controls")).toBeHidden();
    for (const toggle of await page.locator("[data-film-toggle]").all())
      await expect(toggle).toBeHidden();
    for (const film of await page.locator("video[data-film]").all())
      await expect(film).not.toHaveAttribute("src");
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
