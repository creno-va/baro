import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, test } from "@playwright/test";

const heroTitle = /막막했던 법률 문제,\s*이제 정리부터 가볍게\./;
const landingSections = [
  "how-it-works",
  "our-beginning",
  "blue-app-reveal",
  "logo-experience",
  "try-baro",
  "clarity",
  "phone-story",
  "time-experience",
  "everyday",
  "principles",
  "everyday-future",
  "faq",
  "from-our-ceo",
  "start-with-baro",
];

async function scrollScene(scene: Locator, pinSelector: string, progress: number) {
  await scene.evaluate(
    (element, options) => {
      const pin = element.querySelector<HTMLElement>(options.pinSelector);
      if (!(element instanceof HTMLElement) || !pin) throw new Error("Scroll scene is missing");
      const stickyTop = Number.parseFloat(getComputedStyle(pin).top) || 0;
      const distance = Math.max(1, element.offsetHeight - pin.offsetHeight);
      window.scrollTo({
        top:
          scrollY + element.getBoundingClientRect().top - stickyTop + distance * options.progress,
        behavior: "instant",
      });
    },
    { pinSelector, progress },
  );
}

async function expectLocalImage(image: Locator, pathname: string) {
  await expect
    .poll(() =>
      image.evaluate(
        (element, path) =>
          element instanceof HTMLImageElement &&
          element.complete &&
          element.naturalWidth > 1 &&
          new URL(element.currentSrc).origin === location.origin &&
          new URL(element.currentSrc).pathname === path,
        pathname,
      ),
    )
    .toBe(true);
}

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
  for (const section of landingSections) await expect(page.locator(`#${section}`)).toBeVisible();
  await login.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Google로 계속하기" })).toBeVisible();
});

test("fresh home entries and reloads start at the hero while same-page chapter links still work", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#our-beginning");
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expect(page.getByRole("heading", { level: 1, name: heroTitle })).toBeInViewport();
  await page
    .getByRole("navigation", { name: "메인 메뉴", exact: true })
    .getByRole("link", { name: "BARO의 시작", exact: true })
    .click();
  await expect(page).toHaveURL(/#our-beginning$/);
  await expect(page.locator("[data-origin-story]")).toBeInViewport();
  await page.reload();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expect(page.getByRole("heading", { level: 1, name: heroTitle })).toBeInViewport();
});

test("landing fits narrow screens while retaining its photographs and content", async ({
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
    const decorations = page.locator(
      ".journey-film-stage, .everyday-photo-stage, .future-photo-window, .origin-photo-stage, .time-clock-stage",
    );
    expect(await decorations.count()).toBeGreaterThan(0);
    for (const decoration of await decorations.all()) await expect(decoration).toBeVisible();
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

test("shared landing navigation supports desktop chapters and a keyboard-operated mobile menu", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const navigation = page.getByRole("navigation", { name: "메인 메뉴", exact: true });
  await expect(navigation.getByRole("link", { name: "BARO의 시작", exact: true })).toHaveAttribute(
    "href",
    "#our-beginning",
  );
  await expect(navigation.getByRole("link", { name: "앱 둘러보기", exact: true })).toHaveAttribute(
    "href",
    "#blue-app-reveal",
  );
  await expect(
    navigation.getByRole("link", { name: "우리가 바꾸는 일상", exact: true }),
  ).toHaveAttribute("href", "#everyday-future");
  const chapter = page
    .getByRole("navigation", { name: "페이지 구간", exact: true })
    .getByRole("link", {
      name: "로고 속 기능 구간으로 이동",
      exact: true,
    });
  await chapter.click();
  await expect(page).toHaveURL(/#logo-experience$/);
  await expect(chapter).toHaveAttribute("aria-current", "location");
  for (const [label, id] of [
    ["BARO의 시작", "our-beginning"],
    ["당신의 시간", "time-experience"],
    ["CEO 인사말", "from-our-ceo"],
    ["더 간단한 시작", "start-with-baro"],
  ] as const) {
    const link = page
      .getByRole("navigation", { name: "페이지 구간", exact: true })
      .getByRole("link", { name: `${label} 구간으로 이동`, exact: true });
    await link.click();
    await expect(page).toHaveURL(new RegExp(`#${id}$`));
    await expect(link).toHaveAttribute("aria-current", "location");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const trigger = page.locator("[data-landing-menu-trigger]");
  await expect(trigger).toHaveAccessibleName("페이지 메뉴");
  const menu = page.getByRole("dialog", { name: "BARO 전체 메뉴", exact: true });
  await expect(page.locator("details[data-landing-menu]")).toBeHidden();
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(menu).toHaveAttribute("open", "");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  expect(
    (await new AxeBuilder({ page }).include("[data-landing-menu-dialog]").analyze()).violations,
  ).toEqual([]);
  await menu.getByRole("link", { name: "직접 체험하기", exact: true }).click();
  await expect(page).toHaveURL(/#try-baro$/);
  await expect(menu).toBeHidden();
  await expect(page.locator("#try-baro")).toBeInViewport();
  await expect(navigation.getByRole("link", { name: "로그인", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 640, height: 360 });
  for (const [label, id] of [
    ["당신의 시간", "time-experience"],
    ["더 간단한 시작", "start-with-baro"],
  ] as const) {
    await trigger.click();
    const link = menu.getByRole("link", { name: label, exact: true });
    await link.focus();
    await expect(link).toBeInViewport({ ratio: 1 });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`#${id}$`));
    await expect(menu).toBeHidden();
    await expect(page.locator(`#${id}`)).toBeInViewport();
  }
});

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 640, height: 360 },
]) {
  test(`full mobile navigation contains focus and scrolling at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.scrollTo({ top: 700, behavior: "instant" }));
    const beforeOpen = await page.evaluate(() => scrollY);
    const trigger = page.locator("[data-landing-menu-trigger]");
    await expect(trigger).toHaveAccessibleName("페이지 메뉴");
    const menu = page.getByRole("dialog", { name: "BARO 전체 메뉴", exact: true });
    await trigger.click();
    await expect(menu).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect.poll(() => menu.evaluate((element) => element.matches(":modal"))).toBe(true);
    await expect
      .poll(() =>
        menu.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return (
            Math.abs(bounds.x) <= 1 &&
            Math.abs(bounds.y) <= 1 &&
            bounds.width >= innerWidth - 1 &&
            bounds.width <= innerWidth + 1 &&
            bounds.height >= innerHeight - 1 &&
            bounds.height <= innerHeight + 1
          );
        }),
      )
      .toBe(true);
    await expect
      .poll(() => menu.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);
    const focusable = menu.locator("a[href], button:enabled");
    await focusable.last().focus();
    await page.keyboard.press("Tab");
    await expect(focusable.first()).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(focusable.last()).toBeFocused();
    const lockedScroll = await page.evaluate(() => scrollY);
    await page.mouse.move(viewport.width / 2, viewport.height - 30);
    await page.mouse.wheel(0, 1_000);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(Math.abs((await page.evaluate(() => scrollY)) - lockedScroll)).toBeLessThanOrEqual(1);
    await menu.getByRole("button", { name: "메뉴 닫기", exact: true }).click();
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(Math.abs((await page.evaluate(() => scrollY)) - beforeOpen)).toBeLessThanOrEqual(1);
    await trigger.click();
    await expect(menu).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(menu).toBeHidden();
    await expect(trigger).toBeHidden();
    await expect(page.locator("[data-landing-menu-trigger]")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    const afterResize = await page.evaluate(() => scrollY);
    await page.mouse.move(900, 500);
    await page.mouse.wheel(0, 400);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(afterResize + 100);
    const login = page
      .getByRole("navigation", { name: "메인 메뉴", exact: true })
      .getByRole("link", { name: "로그인", exact: true });
    await login.focus();
    await expect(login).toBeFocused();
    await page.setViewportSize(viewport);
    await expect(trigger).toBeVisible();
    await expect(menu).toBeHidden();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });
}

test("desktop visual progress follows scrolling and honors a changed motion preference", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator(".landing-motion-ready")).toHaveCount(1);
  const scene = page.locator("#how-it-works");
  await scene.evaluate((element) => {
    window.scrollTo({
      top: scrollY + element.getBoundingClientRect().top - 600,
      behavior: "instant",
    });
  });
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
  await page.evaluate(() => window.scrollBy({ top: 350, behavior: "instant" }));
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

test("hero footage plays continuously while idle, scroll changes only the framing, and pause persists", async ({
  page,
}) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const scene = page.locator("[data-journey-hero]");
  const heroFilm = page.locator("video[data-scroll-film]");
  const toggle = page.locator("[data-journey-toggle]");
  await expect(scene).toHaveClass(/journey-ready/);
  await expect
    .poll(
      () =>
        heroFilm.evaluate(
          (video) =>
            video instanceof HTMLVideoElement &&
            video.readyState >= 3 &&
            !video.paused &&
            video.currentTime > 0,
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
  await expect(toggle).toHaveAccessibleName("첫 화면 영상 일시정지");
  expect(
    await heroFilm.evaluate(
      (video) =>
        video instanceof HTMLVideoElement &&
        video.autoplay &&
        video.muted &&
        video.playsInline &&
        video.loop,
    ),
  ).toBe(true);
  await expect(heroFilm).toHaveAttribute("src", "/landing/hero-continuous.mp4");
  const playback = await heroFilm.evaluate(async (element) => {
    if (!(element instanceof HTMLVideoElement)) throw new Error("Missing hero film");
    const first = { time: element.currentTime, wall: performance.now() };
    const samples = [first];
    // Observe longer than two old 1.6-second reset periods without seeking the video ourselves.
    while (performance.now() - first.wall < 3_400) {
      await new Promise((resolve) => window.setTimeout(resolve, 60));
      samples.push({ time: element.currentTime, wall: performance.now() });
    }
    const discontinuities: number[] = [];
    let advanced = 0;
    let before = first;
    for (const after of samples.slice(1)) {
      let elapsed = after.time - before.time;
      // A native end-of-file loop is expected; a reset in the middle of the clip is not.
      if (before.time > element.duration - 0.6 && after.time < 0.6) elapsed += element.duration;
      if (elapsed < -0.15 || elapsed > (after.wall - before.wall) / 1_000 + 0.5)
        discontinuities.push(elapsed);
      advanced += Math.max(0, elapsed);
      before = after;
    }
    return { discontinuities, advanced, paused: element.paused };
  });
  expect(playback.discontinuities).toEqual([]);
  expect(playback.advanced).toBeGreaterThan(2.5);
  expect(playback.paused).toBe(false);
  for (const film of await page.locator("video[data-film]:not([data-scroll-film])").all())
    await expect(film).not.toHaveAttribute("src");
  await scrollScene(scene, ".journey-pin", 0.32);
  await expect(scene).toHaveAttribute("data-stage", "film");
  await expect
    .poll(() => heroFilm.evaluate((video) => video instanceof HTMLVideoElement && !video.paused))
    .toBe(true);
  await expect(page.locator(".journey-opening")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("[data-journey-app]")).toHaveAttribute("aria-hidden", "true");
  await scrollScene(scene, ".journey-pin", 0.7);
  await expect
    .poll(() => heroFilm.evaluate((video) => video instanceof HTMLVideoElement && video.paused))
    .toBe(true);
  await expect(page.locator(".journey-film-stage")).toHaveCSS("opacity", "0");
  await scrollScene(scene, ".journey-pin", 0.96);
  await expect(scene).toHaveAttribute("data-stage", "app");
  await expect(page.locator("[data-journey-app]")).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator("[data-journey-message].is-shown")).toHaveCount(6);
  await expect(
    page.locator("[data-journey-app]").getByRole("link", { name: "이 화면 직접 체험하기" }),
  ).toBeVisible();
  await expect(page.locator(".journey-pin")).toHaveCSS("position", "sticky");
  await page.locator("#phone-story").evaluate((element) => {
    window.scrollTo({ top: scrollY + element.getBoundingClientRect().top, behavior: "instant" });
  });
  await expect
    .poll(() => heroFilm.evaluate((video) => video instanceof HTMLVideoElement && video.paused))
    .toBe(true);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect(toggle).toHaveAccessibleName("첫 화면 영상 일시정지");
  await expect
    .poll(() => heroFilm.evaluate((video) => video instanceof HTMLVideoElement && !video.paused))
    .toBe(true);
  const beforePauseScroll = await page.evaluate(() => scrollY);
  await toggle.click();
  await expect(toggle).toHaveAccessibleName("첫 화면 영상 재생하기");
  await expect(toggle).toHaveAttribute("data-paused", "true");
  expect(Math.abs((await page.evaluate(() => scrollY)) - beforePauseScroll)).toBeLessThanOrEqual(1);
  await scrollScene(scene, ".journey-pin", 0.32);
  await expect
    .poll(() => heroFilm.evaluate((video) => video instanceof HTMLVideoElement && video.paused))
    .toBe(true);
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
  await expect
    .poll(() => heroFilm.evaluate((video) => video instanceof HTMLVideoElement && !video.paused))
    .toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(toggle).toBeVisible();
  await expect
    .poll(() => heroFilm.evaluate((video) => video instanceof HTMLVideoElement && !video.paused))
    .toBe(true);
});

test("data-saving entry leaves the hero unloaded until the visitor explicitly starts it", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { saveData: true },
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const hero = page.locator("video[data-scroll-film]");
  const toggle = page.locator("[data-journey-toggle]");
  await expect(toggle).toHaveAccessibleName("첫 화면 영상 재생하기");
  await expect(hero).not.toHaveAttribute("src");
  await toggle.click();
  await expect
    .poll(
      () =>
        hero.evaluate(
          (video) => video instanceof HTMLVideoElement && video.readyState >= 2 && !video.paused,
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(toggle).toBeHidden();
  await expect
    .poll(() => hero.evaluate((video) => video instanceof HTMLVideoElement && video.paused))
    .toBe(true);
});

test("the blue opening expands into selectable app features and hands the selected flow to the demo", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const scene = page.locator("[data-blue-reveal]");
  await expect(scene).toHaveClass(/blue-reveal-motion/);
  await scrollScene(scene, ".blue-reveal-pin", 0);
  const circle = scene.locator(".blue-reveal-circle");
  await expect(circle).toBeVisible();
  const initialCircle = await circle.boundingBox();
  expect(initialCircle).not.toBeNull();
  await scrollScene(scene, ".blue-reveal-pin", 0.4);
  await expect(scene).toHaveClass(/blue-reveal-open/);
  await expect(scene.locator(".blue-reveal-pin")).toHaveCSS("position", "sticky");
  await expect
    .poll(async () => (await circle.boundingBox())?.width ?? 0)
    .toBeGreaterThan((initialCircle?.width ?? 80) * 10);
  for (const [index, progress] of [0.4, 0.57, 0.75, 0.94].entries()) {
    await scrollScene(scene, ".blue-reveal-pin", progress);
    await expect(scene).toHaveAttribute("data-blue-selected", String(index));
    await expect(scene.locator(`[data-blue-tab="${index}"]`)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(scene.locator(`[data-blue-panel="${index}"]`)).toBeVisible();
    await expect(scene.locator("[data-blue-panel]:not([hidden])")).toHaveCount(1);
  }
  await scrollScene(scene, ".blue-reveal-pin", 0.57);
  await expect(scene).toHaveAttribute("data-blue-selected", "1");
  await scene.locator('[data-blue-tab="1"]').focus();
  await page.keyboard.press("End");
  await expect(scene.locator('[data-blue-tab="3"]')).toBeFocused();
  await expect(scene.locator('[data-blue-panel="3"]')).toBeVisible();
  await expect(scene.locator(".blue-reveal-pin")).toHaveJSProperty("scrollTop", 0);
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await expect(scene).toHaveAttribute("data-blue-selected", "3");
  await scene.locator('[data-blue-demo="report"]').click();
  await expect(page.locator('[data-demo-tab="report"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-demo-panel="report"]')).toBeVisible();
});

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  test(`the founding note keeps both original handwritten layers while zooming into a working app entry at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    const origin = page.locator("[data-origin-story]");
    await expect(origin).toHaveClass(/origin-motion/);
    await scrollScene(origin, ".origin-pin", 0);
    await expectLocalImage(
      origin.locator(".origin-clean-background img"),
      "/landing/origin-notes-clean.webp",
    );
    const originals = origin.locator(".origin-original-note");
    await expect(originals).toHaveCount(2);
    for (const layer of await originals.all()) {
      await expectLocalImage(layer.locator("img"), "/landing/origin-notes-original.webp");
      await expect(layer).not.toHaveCSS("clip-path", "none");
    }
    const photo = origin.locator("[data-origin-photo]");
    const openingWidth = (await photo.boundingBox())?.width ?? 0;
    expect(openingWidth).toBeGreaterThan(0);
    await scrollScene(origin, ".origin-pin", 0.43);
    await expect
      .poll(async () => (await photo.boundingBox())?.width ?? 0)
      .toBeGreaterThan(openingWidth * 1.25);
    for (const layer of await originals.all())
      await expectLocalImage(layer.locator("img"), "/landing/origin-notes-original.webp");
    expect((await photo.boundingBox())?.width ?? 0).toBeLessThan(openingWidth * 2.2);
    await scrollScene(origin, ".origin-pin", 0.56);
    await expect(origin.locator(".origin-photo-window")).not.toHaveCSS("filter", "blur(0px)");
    await scrollScene(origin, ".origin-pin", 0);
    await origin.getByRole("button", { name: "BARO로 들어가기" }).click();
    await expect(origin.locator(".origin-arrival")).toHaveCSS("opacity", "1");
    const entry = origin.getByRole("link", { name: "BARO 안으로" });
    await expect(entry).toBeInViewport({ ratio: 1 });
    await entry.click();
    await expect(page).toHaveURL(/#blue-app-reveal$/);
    await expect(page.locator("[data-blue-reveal]")).toBeInViewport();
  });
}

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  test(`the real watch zooms into a full blue message and its demo action remains usable at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    const time = page.locator("[data-time-experience]");
    await expect(time).toHaveClass(/time-experience-motion/);
    await scrollScene(time, "[data-time-pin]", 0);
    await expectLocalImage(time.locator(".time-watch-image"), "/landing/time-watch.webp");
    await expect(time.locator(".time-clock-drawing")).toHaveCount(0);
    await expect(time.locator("[data-time-message]")).toHaveCSS("opacity", "0");
    const clock = time.locator("[data-time-clock]");
    const openingWidth = (await clock.boundingBox())?.width ?? 0;
    expect(openingWidth).toBeGreaterThan(0);
    await scrollScene(time, "[data-time-pin]", 0.42);
    await expect
      .poll(async () => (await clock.boundingBox())?.width ?? 0)
      .toBeGreaterThan(openingWidth * 1.25);
    expect((await clock.boundingBox())?.width ?? 0).toBeLessThan(openingWidth * 2.2);
    await scrollScene(time, "[data-time-pin]", 0.56);
    await expect(time.locator(".time-clock-stage")).not.toHaveCSS("filter", "blur(0px)");
    await scrollScene(time, "[data-time-pin]", 0.99);
    await expect(time.locator("[data-time-message]")).toHaveCSS("opacity", "1");
    await expect(time.locator(".time-clock-stage")).toHaveCSS("opacity", "0");
    const pin = await time.locator("[data-time-pin]").boundingBox();
    const wipe = await time.locator("[data-time-wipe]").boundingBox();
    expect(pin).not.toBeNull();
    expect(wipe?.width ?? 0).toBeGreaterThanOrEqual(pin?.width ?? 1);
    expect(wipe?.height ?? 0).toBeGreaterThanOrEqual(pin?.height ?? 1);
    await expect(time.locator("[data-time-wipe]")).toHaveCSS("opacity", "1");
    await expect(
      time.getByRole("heading", { name: /법률 문제에서,\s*시간은 중요하니까\./ }),
    ).toBeVisible();
    await expect(time.locator(".time-promise")).toHaveText("당신의 시간을 지켜드립니다.");
    for (const benefit of await time.locator("[data-time-benefit]").all())
      await expect(benefit).toHaveCSS("opacity", "1");
    await expect(time.getByRole("link", { name: "내 이야기 시작하기" })).toHaveAttribute(
      "href",
      "/app",
    );
    await time.getByRole("link", { name: "직접 체험하기" }).click();
    await expect(page).toHaveURL(/#try-baro$/);
    await expect(page.locator("[data-baro-demo]")).toBeInViewport();

    // Reverse the scene, then reach the initially transparent action with the keyboard.
    await scrollScene(time, "[data-time-pin]", 0);
    const action = time.getByRole("link", { name: "직접 체험하기" });
    await page.keyboard.press("Tab");
    await action.focus();
    await expect(action).toBeFocused();
    await expect(time.locator("[data-time-message]")).toHaveCSS("opacity", "1");
    await expect(action).toBeInViewport({ ratio: 1 });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#try-baro$/);
  });
}

test("the ending gathers four features into the app, shows the final message and can replay or start", async ({
  page,
}) => {
  await page.route("**/api/me/session", (route) =>
    route.fulfill({ json: { user: null, needsConsent: false } }),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const finale = page.locator("[data-finale]");
  const features = finale.locator("[data-finale-feature]");
  const action = finale.getByRole("link", { name: "내 이야기로 시작하기", exact: true });
  await expect(finale).toHaveClass(/finale-motion-ready/);
  await scrollScene(finale, "[data-finale-pin]", 0);
  await expect(features).toHaveCount(4);
  for (const feature of await features.all()) await expect(feature).toHaveCSS("opacity", "1");
  await expect(action).toBeInViewport({ ratio: 1 });
  const spread = await features.evaluateAll((elements) => {
    const first = elements[0]?.getBoundingClientRect();
    const second = elements[1]?.getBoundingClientRect();
    return first && second ? Math.abs(first.x + first.width / 2 - second.x - second.width / 2) : 0;
  });
  expect(spread).toBeGreaterThan(200);
  await scrollScene(finale, "[data-finale-pin]", 0.26);
  await expect
    .poll(() =>
      features.evaluateAll((elements) => {
        const first = elements[0]?.getBoundingClientRect();
        const second = elements[1]?.getBoundingClientRect();
        return first && second
          ? Math.abs(first.x + first.width / 2 - second.x - second.width / 2)
          : 0;
      }),
    )
    .toBeLessThan(spread * 0.6);
  await expect(action).toBeInViewport({ ratio: 1 });
  await scrollScene(finale, "[data-finale-pin]", 0.74);
  await expect(finale.locator("[data-finale-app]")).toHaveCSS("opacity", "1");
  for (const step of await finale.locator("[data-finale-step]").all())
    await expect(step).toHaveCSS("opacity", "1");
  await expect(finale.locator("[data-finale-app]")).toContainText("다음으로 확인할 질문");
  await expect(action).toBeInViewport({ ratio: 1 });
  await scrollScene(finale, "[data-finale-pin]", 0.99);
  await expect(finale.locator("[data-finale-app]")).toHaveCSS("opacity", "0");
  await expect(finale.locator("[data-finale-message]")).toHaveCSS("opacity", "1");
  await expect(finale.getByRole("heading", { level: 2 })).toHaveText(
    /법률 문제의 시작을,\s*더 간단하게\./,
  );
  await expect(action).toBeInViewport({ ratio: 1 });
  await finale.getByRole("button", { name: "처음부터 다시 보기" }).click();
  await expect(features.first()).toHaveCSS("opacity", "1");
  await expect(finale.locator("[data-finale-message]")).toHaveCSS("opacity", "0");
  await action.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Google로 계속하기" })).toBeVisible();
});

test("short screens and reduced motion retain the photos and readable origin, time and ending", async ({
  page,
}) => {
  for (const viewport of [
    { width: 320, height: 480, reducedMotion: "no-preference" as const },
    { width: 900, height: 500, reducedMotion: "no-preference" as const },
    { width: 1440, height: 900, reducedMotion: "reduce" as const },
  ]) {
    await page.goto("about:blank");
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: viewport.reducedMotion });
    await page.goto("/");
    const origin = page.locator("[data-origin-story]");
    const time = page.locator("[data-time-experience]");
    const finale = page.locator("[data-finale]");
    await expect(origin).not.toHaveClass(/origin-motion/);
    await expect(time).not.toHaveClass(/time-experience-motion/);
    await expect(finale).not.toHaveClass(/finale-motion-ready/);
    await expect(origin.locator("[data-origin-open]")).toBeHidden();
    await expect(finale.locator("[data-finale-replay]")).toBeHidden();
    await expect(origin.locator(".origin-arrival")).toHaveCSS("opacity", "1");
    await expect(time.locator("[data-time-message]")).toHaveCSS("opacity", "1");
    await expect(finale.locator("[data-finale-message]")).toHaveCSS("opacity", "1");
    for (const card of await finale.locator("[data-finale-feature]").all()) {
      await expect(card).toBeVisible();
      await expect(card).toHaveCSS("transform", "none");
    }
    await time.getByRole("link", { name: "직접 체험하기" }).click();
    await expect(page).toHaveURL(/#try-baro$/);
    await expect(finale.getByRole("link", { name: "내 이야기로 시작하기" })).toHaveAttribute(
      "href",
      "/app",
    );
    await expect(origin.locator(".origin-photo-stage")).toBeVisible();
    await expect(time.locator(".time-clock-stage")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  }
});

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
]) {
  test(`mobile app scenes remain interactive and reach their final message at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    const phone = page.locator("[data-phone-story]");
    await expect(phone).toHaveClass(/phone-story-ready/);
    await scrollScene(phone, ".phone-story-sticky", 0.995);
    await expect(phone.locator("[data-phone-arrival]")).toHaveCSS("opacity", "1");
    await expect(phone.locator("[data-phone-arrival]")).toContainText("어떤 일이 있었나요?");
    for (const service of await phone.locator("[data-phone-service]").all())
      await expect(service).toHaveCSS("opacity", "0");
    await scrollScene(phone, ".phone-story-sticky", 0.12);
    for (const service of await phone.locator("[data-phone-service]").all())
      await expect(service).toHaveCSS("opacity", "1");
    const clarity = page.locator("[data-clarity]");
    await expect(clarity).toHaveClass(/clarity-motion-ready/);
    await scrollScene(clarity, "[data-clarity-pin]", 0.97);
    await clarity.locator('[data-clarity-topic="work"]').click();
    await expect(clarity.locator('[data-clarity-result="0"]')).toContainText("일이 있었던 날짜");
    const finale = page.locator("[data-finale]");
    await expect(finale).toHaveClass(/finale-motion-ready/);
    await scrollScene(finale, "[data-finale-pin]", 0.74);
    await expect(finale.locator("[data-finale-app]")).toHaveCSS("opacity", "1");
    await scrollScene(finale, "[data-finale-pin]", 0.99);
    await expect(finale.locator("[data-finale-message]")).toHaveCSS("opacity", "1");
    const action = finale.getByRole("link", { name: "내 이야기로 시작하기", exact: true });
    await expect(action).toHaveAttribute("href", "/app");
    await expect(action).toBeInViewport({ ratio: 1 });
    await finale.getByRole("button", { name: "처음부터 다시 보기" }).click();
    await expect(finale.locator("[data-finale-message]")).toHaveCSS("opacity", "0");
    await expect(finale.locator("[data-finale-feature]").first()).toHaveCSS("opacity", "1");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });
}

test("mobile and reduced-motion blue previews keep keyboard tabs and working demo links", async ({
  page,
}) => {
  for (const viewport of [
    { width: 320, height: 844, reducedMotion: "no-preference" as const },
    { width: 1440, height: 900, reducedMotion: "reduce" as const },
  ]) {
    await page.goto("about:blank");
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: viewport.reducedMotion });
    await page.goto("/");
    const scene = page.locator("[data-blue-reveal]");
    await expect(scene).toHaveClass(/blue-reveal-enhanced/);
    if (viewport.reducedMotion === "reduce") {
      await expect(scene).not.toHaveClass(/blue-reveal-motion/);
      await expect(scene.locator(".blue-reveal-circle")).toBeHidden();
    } else {
      await expect(scene).toHaveClass(/blue-reveal-motion/);
      await scrollScene(scene, ".blue-reveal-pin", 0.4);
    }
    await scene.getByRole("tab", { name: /편한 대화/ }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(scene.locator('[data-blue-tab="1"]')).toBeFocused();
    await expect(scene.locator('[data-blue-panel="1"]')).toContainText("계좌 이체 내역.pdf");
    await expect(scene.locator('[data-blue-panel="0"]')).toBeHidden();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await scene.locator('[data-blue-demo="files"]').click();
    await expect(page.locator('[data-demo-tab="files"]')).toHaveAttribute("aria-selected", "true");
  }
});

test("the everyday story moves with scroll and its films play only while visible without overriding pause", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const future = page.locator("[data-everyday-future]");
  await expect(future).toHaveClass(/future-motion-ready/);
  const collage = future.locator(".future-collage");
  await collage.evaluate((element) => {
    window.scrollTo({
      top: scrollY + element.getBoundingClientRect().top - 450,
      behavior: "instant",
    });
  });
  const photo = collage.locator("[data-future-layer]").first();
  await expect
    .poll(() => photo.evaluate((element) => getComputedStyle(element).transform))
    .not.toBe("none");
  const initialTransform = await photo.evaluate((element) => getComputedStyle(element).transform);
  await page.evaluate(() => window.scrollBy({ top: 220, behavior: "instant" }));
  await expect
    .poll(() => photo.evaluate((element) => getComputedStyle(element).transform))
    .not.toBe(initialTransform);
  for (const name of ["future-everyday", "future-conversation"]) {
    const film = future.locator(`video[data-film="${name}"]`);
    const toggle = future.locator(`[data-film-toggle="${name}"]`);
    const showFilm = () =>
      film.evaluate((element) => {
        const container = element.closest("[data-film-container]");
        if (!container) throw new Error("Missing film container");
        window.scrollTo({
          top: scrollY + container.getBoundingClientRect().top - 100,
          behavior: "instant",
        });
      });
    await showFilm();
    await expect
      .poll(
        () => film.evaluate((element) => element instanceof HTMLVideoElement && !element.paused),
        { timeout: 15_000 },
      )
      .toBe(true);
    await expect(toggle).toHaveAttribute("data-playing", "true");
    expect(
      await film.evaluate(
        (element) =>
          element instanceof HTMLVideoElement &&
          element.muted &&
          element.loop &&
          element.playsInline,
      ),
    ).toBe(true);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await expect
      .poll(() => film.evaluate((element) => element instanceof HTMLVideoElement && element.paused))
      .toBe(true);
    await showFilm();
    await expect
      .poll(() =>
        film.evaluate((element) => element instanceof HTMLVideoElement && !element.paused),
      )
      .toBe(true);
    await toggle.click();
    await expect(toggle).toHaveAttribute("data-playing", "false");
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await showFilm();
    await expect
      .poll(() => film.evaluate((element) => element instanceof HTMLVideoElement && element.paused))
      .toBe(true);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(future).not.toHaveClass(/future-motion-ready/);
  for (const layer of await future.locator("[data-future-layer]").all())
    await expect(layer).toHaveCSS("transform", "none");
  for (const copy of await future.locator("[data-future-reveal]").all())
    await expect(copy).toHaveCSS("opacity", "1");
});

test("mobile everyday photos and films remain available and respect manual pause", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const future = page.locator("[data-everyday-future]");
  await expect(future).toHaveClass(/future-motion-ready/);
  const photo = future.locator(".future-photo-home img");
  await photo.scrollIntoViewIfNeeded();
  await expectLocalImage(photo, "/landing/future-home.webp");
  const film = future.locator('video[data-film="future-everyday"]');
  const toggle = future.locator('[data-film-toggle="future-everyday"]');
  const showFilm = () =>
    film.evaluate((element) => {
      const container = element.closest("[data-film-container]");
      if (!container) throw new Error("Missing mobile film");
      window.scrollTo({
        top: scrollY + container.getBoundingClientRect().top - 100,
        behavior: "instant",
      });
    });
  await showFilm();
  await expect(toggle).toBeInViewport();
  await expect
    .poll(
      () =>
        film.evaluate(
          (element) =>
            element instanceof HTMLVideoElement && element.readyState >= 2 && !element.paused,
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
  await toggle.click();
  await expect(toggle).toHaveAttribute("data-playing", "false");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await showFilm();
  await expect
    .poll(() => film.evaluate((element) => element instanceof HTMLVideoElement && element.paused))
    .toBe(true);
  await expect(future.getByRole("link", { name: "내 이야기로 시작하기" })).toHaveAttribute(
    "href",
    "/app",
  );
  await expect(future.getByRole("link", { name: "변호사 살펴보기" })).toHaveAttribute(
    "href",
    "/lawyers",
  );
});

test("reduced-motion entry keeps all phone chapters readable and does not autoplay films", async ({
  page,
}) => {
  const videoRequests: string[] = [];
  page.on("request", (request) => {
    if (/\.mp4(?:\?|$)/.test(request.url())) videoRequests.push(request.url());
  });
  for (const width of [390, 1440]) {
    await page.goto("about:blank");
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.locator("[data-journey-hero]")).not.toHaveClass(/journey-ready/);
    await expect(page.locator("[data-journey-toggle]")).toBeHidden();
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
    for (const photo of await page.locator(".everyday-photo-stage").all())
      await expect(photo).toBeVisible();
    await expect(page.locator(".journey-film-stage")).toBeVisible();
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
  const services = story.locator("[data-phone-service]");
  await expect(services).toHaveCount(4);
  await scrollScene(story, ".phone-story-sticky", 0.54);
  await expect(services.first()).toHaveCSS("opacity", "0");
  await expect(services.last()).toHaveCSS("opacity", "1");
  await scrollScene(story, ".phone-story-sticky", 0.995);
  for (const service of await services.all()) await expect(service).toHaveCSS("opacity", "0");
  const arrival = story.locator("[data-phone-arrival]");
  await expect(arrival).toHaveCSS("opacity", "1");
  await expect(arrival).toContainText("어떤 일이 있었나요?");
  await expect(story.getByRole("link", { name: "내 이야기 정리해 보기" })).toHaveAttribute(
    "href",
    "/app",
  );
  await scrollScene(story, ".phone-story-sticky", 0.12);
  await expect(arrival).toHaveCSS("opacity", "0");
  for (const service of await services.all()) await expect(service).toHaveCSS("opacity", "1");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(story).not.toHaveClass(/phone-story-ready/);
  for (const chapter of await page.locator("[data-phone-chapter]").all())
    await expect(chapter).toBeVisible();
});

test("the brand turns, separates, and reveals selectable features that open the matching demo", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const scene = page.locator("[data-logo-experience]");
  const buttons = scene.locator("[data-logo-feature]");
  await expect(scene).toHaveClass(/logo-experience-motion/);
  await scrollScene(scene, ".logo-experience-sticky", 0);
  await expect(scene).toHaveCSS("--logo-turn", "0.00deg");
  const initialPiece = await scene
    .locator("[data-logo-piece]")
    .first()
    .evaluate((element) => getComputedStyle(element).transform);
  await scrollScene(scene, ".logo-experience-sticky", 0.27);
  await expect(scene).toHaveCSS("--logo-turn", "360.00deg");
  await scrollScene(scene, ".logo-experience-sticky", 0.37);
  await expect
    .poll(() =>
      scene
        .locator("[data-logo-piece]")
        .first()
        .evaluate((element) => getComputedStyle(element).transform),
    )
    .not.toBe(initialPiece);
  await expect(scene.locator("[data-logo-piece]")).toHaveCount(3);
  await scrollScene(scene, ".logo-experience-sticky", 0.56);
  await expect(scene).toHaveAttribute("data-logo-selected", "1");
  await expect(buttons).toHaveCount(6);
  await expect(buttons.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(scene.locator('[data-logo-panel="1"]')).toContainText("계좌 이체 내역.pdf");
  await expect(scene.locator('[data-logo-panel="0"]')).toBeHidden();

  await buttons.nth(4).click();
  await expect(scene).toHaveAttribute("data-logo-selected", "4");
  await expect(scene.locator(".logo-experience-sticky")).toHaveJSProperty("scrollTop", 0);
  await expect(scene.locator('[data-logo-panel="4"]')).toBeVisible();
  await expect(scene.locator('[data-logo-panel="4"] a')).toHaveAttribute("href", "/lawyers");
  // A non-scroll redraw must not override the visitor's chosen feature.
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await expect(scene).toHaveAttribute("data-logo-selected", "4");
  await page.keyboard.press("End");
  await expect(buttons.nth(5)).toBeFocused();
  await expect(scene.locator('[data-logo-panel="5"]')).toBeVisible();
  await scrollScene(scene, ".logo-experience-sticky", 0.72);
  await expect(scene).toHaveAttribute("data-logo-selected", "5");
  await page.mouse.wheel(0, 24);
  await expect(scene).toHaveAttribute("data-logo-selected", "2");
  await buttons.nth(1).click();
  await scene.locator('[data-logo-panel="1"] a').click();
  await expect(page.locator('[data-demo-tab="files"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-demo-panel="files"]')).toBeVisible();
});

test("mobile logo motion keeps keyboard feature selection and reduces to a static preview", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const scene = page.locator("[data-logo-experience]");
  await expect(scene).toHaveClass(/logo-experience-enhanced/);
  await expect(scene).toHaveClass(/logo-experience-motion/);
  await scrollScene(scene, ".logo-experience-sticky", 0);
  await expect(scene.locator(".logo-experience-mark")).toBeVisible();
  await scene.locator('[data-logo-feature="0"]').focus();
  await page.keyboard.press("ArrowRight");
  await expect(scene.locator('[data-logo-feature="1"]')).toBeFocused();
  await expect(scene.locator('[data-logo-panel="1"]')).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(scene).not.toHaveClass(/logo-experience-motion/);
  await scene.locator('[data-logo-feature="3"]').click();
  await expect(scene.locator('[data-logo-panel="3"]')).toBeVisible();
  await expect(scene.locator('[data-logo-panel="3"]')).toContainText("나의 상담 준비 리포트");
});

test("the demo connects the chosen scenario, materials and timeline and requires a fresh report review", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const demo = page.locator("[data-baro-demo]");
  await expect(demo).toHaveClass(/demo-lab-ready/);
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (!["GET", "HEAD"].includes(request.method())) mutations.push(request.url());
  });
  await demo.getByRole("radio", { name: "돌려받을 보증금", exact: true }).check();
  await expect(demo.locator("[data-demo-case-title]")).toHaveText("돌려받을 보증금");
  await demo.locator("[data-demo-answer-button]").click();
  await expect(demo.locator("[data-demo-answer-group]")).toBeVisible();
  await expect(demo.locator("[data-demo-fact]")).toContainText("2,000만 원");
  await demo.locator("[data-demo-conversation-next]").click();
  await demo.locator('[data-demo-file="0"]').uncheck();
  await demo.locator('[data-demo-file="2"]').check();
  await expect(demo.locator("[data-demo-file-count]")).toContainText("2개");
  await demo.locator('[data-demo-panel="files"] [data-demo-next="timeline"]').click();
  await expect(demo.locator('[data-demo-date="0"]')).toHaveAttribute("datetime", "2024-07-01");
  await demo.locator(".demo-timeline details").first().locator("summary").click();
  await expect(demo.locator('[data-demo-event-source="0"]')).toContainText("보증금 이체 내역.pdf");
  await demo.locator(".demo-timeline details").last().locator("summary").click();
  await expect(demo.locator('[data-demo-event-source="2"]')).toContainText(
    "자료를 선택하지 않았어요",
  );
  await demo.locator('[data-demo-panel="timeline"] [data-demo-next="report"]').click();
  const summary = demo.locator("[data-demo-report-summary]");
  const facts = demo.locator('[data-demo-confirm="facts"]');
  const files = demo.locator('[data-demo-confirm="files"]');
  const finish = demo.locator("[data-demo-finish]");
  await expect(summary).toHaveValue(/보증금은 2,000만 원/);
  await expect(demo.locator("[data-demo-report-files]")).toContainText("집주인과 나눈 대화.png");
  await expect(demo.locator("[data-demo-report-files]")).not.toContainText("임대차 계약서.pdf");
  await expect(finish).toBeDisabled();
  await summary.fill("   ");
  await facts.check();
  await files.check();
  await expect(finish).toBeDisabled();
  await summary.fill("가상 사례: 계약 종료 후 보증금과 대화 내용을 함께 확인했습니다.");
  await expect(facts).not.toBeChecked();
  await expect(files).not.toBeChecked();
  await facts.check();
  await expect(finish).toBeDisabled();
  await files.check();
  await finish.click();
  await expect(demo.locator("[data-demo-complete]")).toBeVisible();
  await expect(demo.locator("[data-demo-case-state]")).toHaveText("예시 체험 완료");
  await summary.fill("가상 사례: 새로운 사실을 더해 다시 검토할 예시입니다.");
  await expect(demo.locator("[data-demo-complete]")).toBeHidden();
  await expect(finish).toBeDisabled();
  await expect(facts).not.toBeChecked();
  await facts.check();
  await files.check();
  await demo.getByRole("tab", { name: "자료", exact: true }).click();
  await demo.locator('[data-demo-file="1"]').uncheck();
  await demo.getByRole("tab", { name: "상담 준비", exact: true }).click();
  await expect(facts).not.toBeChecked();
  await expect(files).not.toBeChecked();
  await expect(demo.locator("[data-demo-report-files]")).not.toContainText(
    "집주인과 나눈 대화.png",
  );
  await expect(demo.locator('input[type="file"]')).toHaveCount(0);
  expect(mutations).toEqual([]);
});

test("switching and restarting a demo resets answers, materials, review and keyboard tabs", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const demo = page.locator("[data-baro-demo]");
  await demo.getByRole("radio", { name: "받지 못한 급여", exact: true }).check();
  await demo.locator("[data-demo-answer-button]").click();
  await expect(demo.locator("[data-demo-answer]")).toContainText("240만 원");
  await demo.getByRole("tab", { name: "대화", exact: true }).focus();
  await page.keyboard.press("End");
  await expect(demo.getByRole("tab", { name: "상담 준비", exact: true })).toBeFocused();
  await expect(demo.locator('[data-demo-panel="report"]')).toBeVisible();
  await demo.locator("[data-demo-report-summary]").fill("가상 내용 변경");
  await demo.locator('[data-demo-confirm="facts"]').check();
  await demo.locator("[data-demo-restart]").click();
  await expect(demo.locator("[data-demo-case-title]")).toHaveText("받지 못한 급여");
  await expect(demo.locator("[data-demo-answer-group]")).toBeHidden();
  await expect(demo.locator("[data-demo-answer-button]")).toBeVisible();
  await expect(demo.locator("[data-demo-progress]")).toHaveAttribute("value", "1");
  await demo.getByRole("tab", { name: "자료", exact: true }).click();
  await expect(demo.locator('[data-demo-file="0"]')).toBeChecked();
  await expect(demo.locator('[data-demo-file="1"]')).toBeChecked();
  await expect(demo.locator('[data-demo-file="2"]')).not.toBeChecked();
  await expect(demo.locator('[data-demo-file-title="0"]')).toHaveText("근로 계약서.pdf");
  await demo.getByRole("tab", { name: "상담 준비", exact: true }).click();
  await expect(demo.locator("[data-demo-report-summary]")).toHaveValue(/급여 240만 원/);
  await expect(demo.locator('[data-demo-confirm="facts"]')).not.toBeChecked();
  await demo.getByRole("radio", { name: "빌려준 돈", exact: true }).check();
  await expect(demo.locator('[data-demo-panel="conversation"]')).toBeVisible();
  await expect(demo.locator("[data-demo-case-title]")).toHaveText("돌려받지 못한 돈");
});

test("clarity topics change the actual story while scrolling gathers and then opens the results", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const scene = page.locator("[data-clarity]");
  await expect(scene).toHaveClass(/clarity-motion-ready/);
  await scrollScene(scene, "[data-clarity-pin]", 0);
  await scene.locator('[data-clarity-topic="money"]').click();
  await expect(scene.locator('[data-clarity-topic="money"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(scene.locator('[data-clarity-file="0"]')).toHaveText("계좌 이체 내역.pdf");
  const initialInput = await scene
    .locator("[data-clarity-input]")
    .first()
    .evaluate((element) => getComputedStyle(element).transform);
  await scrollScene(scene, "[data-clarity-pin]", 0.49);
  await expect
    .poll(() =>
      scene.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).getPropertyValue("--clarity-converge")),
      ),
    )
    .toBeGreaterThan(0.98);
  await expect
    .poll(() =>
      scene
        .locator("[data-clarity-input]")
        .first()
        .evaluate((element) => getComputedStyle(element).transform),
    )
    .not.toBe(initialInput);
  await scrollScene(scene, "[data-clarity-pin]", 0.97);
  await expect(scene.locator("[data-clarity-phase-number]")).toHaveText("03");
  await expect(scene.locator('[data-clarity-output="2"]')).toHaveCSS("opacity", "1");
  await expect(scene.locator('[data-clarity-result="0"]')).toContainText("돈을 보낸 날");
  await scene.locator('[data-clarity-topic="work"]').click();
  await expect(scene.locator('[data-clarity-result="0"]')).toContainText("일이 있었던 날짜");
  await scene.locator("[data-clarity-play]").click();
  await expect(scene.locator("[data-clarity-phase-number]")).toHaveText("01");
  await expect(scene.locator("[data-clarity-input]").first()).toHaveCSS("opacity", "1");
});

test("reduced-motion mobile clarity keeps its photo and working before/after controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const scene = page.locator("[data-clarity]");
  await expect(scene).toHaveClass(/clarity-static-ready/);
  await expect(scene).not.toHaveClass(/clarity-motion-ready/);
  await expect(scene.locator(".clarity-help")).toBeVisible();
  await scene.locator('[data-clarity-topic="work"]').click();
  await expect(scene.locator('[data-clarity-file="0"]')).toHaveText("근로 계약서.pdf");
  await scene.locator("[data-clarity-play]").click();
  await expect(scene).toHaveAttribute("data-clarity-view", "after");
  await expect(scene.locator("[data-clarity-results]")).toBeVisible();
  await expect(scene.locator('[data-clarity-result="1"]')).toContainText("직접 겪은 일");
  await expect(scene.locator(".clarity-help")).toBeVisible();
  await scene.locator("[data-clarity-play]").click();
  await expect(scene).toHaveAttribute("data-clarity-view", "before");
  await expect(scene.locator("[data-clarity-results]")).toBeHidden();
  await scene.locator(".clarity-help").scrollIntoViewIfNeeded();
  await expectLocalImage(scene.locator(".clarity-help img"), "/landing/help-clarity.webp");
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  test(`CEO portraits and greetings follow scrolling and accessible selection at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    const ceo = page.locator("[data-ceo-greeting]");
    await expect(ceo).toHaveClass(/ceo-motion-ready/);
    const stage = ceo.locator("[data-ceo-scroll]");
    await scrollScene(stage, "[data-ceo-visual]", 0.05);
    await expectLocalImage(ceo.locator('[data-ceo-photo="suit"] img'), "/landing/ceo-suit.webp");
    await expectLocalImage(
      ceo.locator('[data-ceo-photo="crenova"] img'),
      "/landing/ceo-crenova.webp",
    );
    await expect(ceo.locator('[data-ceo-message="suit"]')).toHaveAttribute("aria-hidden", "false");
    const chooseCrenova = ceo.locator('[data-ceo-show="crenova"]').first();
    await chooseCrenova.focus();
    await page.keyboard.press("Enter");
    for (const button of await ceo.locator('[data-ceo-show="crenova"]').all())
      await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(ceo.locator('[data-ceo-photo="crenova"]')).toHaveAttribute("aria-hidden", "false");
    await expect(ceo.locator('[data-ceo-message="crenova"]')).toHaveAttribute(
      "aria-hidden",
      "false",
    );
    await expect(ceo.locator('[data-ceo-message="suit"]')).toHaveAttribute("inert", "");
    await ceo.locator('[data-ceo-show="suit"]').first().click();
    await expect(ceo.locator('[data-ceo-message="suit"]')).not.toHaveAttribute("inert");
    await scrollScene(stage, "[data-ceo-visual]", 0.9);
    await expect(ceo.locator('[data-ceo-message="crenova"]')).toHaveAttribute(
      "aria-hidden",
      "false",
    );
    await scrollScene(stage, "[data-ceo-visual]", 0.05);
    await expect(ceo.locator('[data-ceo-message="suit"]')).toHaveAttribute("aria-hidden", "false");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(ceo).not.toHaveClass(/ceo-motion-ready/);
    await ceo.locator('[data-ceo-show="crenova"]').last().click();
    await expect(ceo.locator('[data-ceo-message="crenova"]')).not.toHaveAttribute("inert");
    await expect(ceo.getByRole("link", { name: "BARO에서 시작하기" })).toHaveAttribute(
      "href",
      "/app",
    );
  });
}

test("the simplicity page presents the focused explanation and preserves its login entry", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const response = await page.goto("/simplicity");
  expect(response?.status()).toBe(200);
  for (const id of ["our-beginning", "time-experience", "from-our-ceo", "start-with-baro"])
    await expect(page.locator(`#${id}`)).toBeVisible();
  await expect(page.locator(".origin-photo-stage")).toBeVisible();
  await expect(page.locator(".time-clock-stage")).toBeVisible();
  await expect(page.locator("[data-finale-replay]")).toBeHidden();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const scene = page.locator("[data-clarity]");
  await expect(scene).toHaveCount(1);
  await scene.locator('[data-clarity-topic="money"]').click();
  await scene.locator("[data-clarity-play]").click();
  await expect(scene.locator('[data-clarity-result="0"]')).toContainText("돈을 보낸 날");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  const login = page.getByRole("link", { name: "로그인", exact: true });
  await expect(login).toHaveAttribute("href", "/login");
  await login.click();
  await expect(page).toHaveURL(/\/login$/);
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
    for (const section of landingSections) await expect(page.locator(`#${section}`)).toBeVisible();
    for (const chapter of await page.locator("[data-phone-chapter]").all())
      await expect(chapter).toBeVisible();
    await expect(page.locator(".phone-story-controls")).toBeHidden();
    await expect(page.locator("[data-journey-toggle]")).toBeHidden();
    for (const letter of await page.locator("[data-ceo-message]").all())
      await expect(letter).toBeVisible();
    for (const portrait of await page.locator("[data-ceo-photo]").all())
      await expect(portrait).toBeVisible();
    for (const controls of await page.locator("[data-ceo-controls]").all())
      await expect(controls).toBeHidden();
    await expect(page.locator("[data-demo-fallback]")).toBeVisible();
    await expect(page.locator("[data-demo-interactive]")).toBeHidden();
    await expect(page.locator("[data-blue-tabs]")).toBeHidden();
    await expect(page.locator("[data-blue-panel]")).toHaveCount(4);
    for (const panel of await page.locator("[data-blue-panel]").all())
      await expect(panel).toBeVisible();
    await expect(page.locator("#future-vision-title")).toBeVisible();
    await expect(page.locator(".origin-arrival")).toBeVisible();
    await expect(page.locator("[data-origin-open]")).toBeHidden();
    await expect(page.locator("[data-time-pin]")).not.toHaveCSS("position", "sticky");
    await expect(page.locator("[data-time-message]")).toHaveCSS("opacity", "1");
    await expect(page.locator("[data-finale-replay]")).toBeHidden();
    await expect(page.locator("[data-finale-message]")).toHaveCSS("opacity", "1");
    for (const feature of await page.locator("[data-finale-feature]").all())
      await expect(feature).toBeVisible();
    await expect(
      page.locator("[data-finale]").getByRole("link", { name: "내 이야기로 시작하기" }),
    ).toHaveAttribute("href", "/app");
    await expect(page.locator("[data-logo-panel]")).toHaveCount(6);
    for (const panel of await page.locator("[data-logo-panel]").all())
      await expect(panel).toBeVisible();
    for (const output of await page.locator("[data-clarity-output]").all())
      await expect(output).toBeVisible();
    for (const toggle of await page.locator("[data-film-toggle]").all())
      await expect(toggle).toBeHidden();
    for (const film of await page.locator("video[data-film]").all())
      await expect(film).not.toHaveAttribute("src");
    const disclosure = page.locator("#faq details").first();
    await disclosure.locator("summary").click();
    await expect(disclosure).toHaveAttribute("open", "");
    await page.setViewportSize({ width: 390, height: 844 });
    const menu = page.locator("[data-landing-menu]");
    await menu.locator("summary").click();
    await expect(menu).toHaveAttribute("open", "");
    await menu.getByRole("link", { name: "앱 둘러보기", exact: true }).click();
    await expect(page).toHaveURL(/#blue-app-reveal$/);
    await menu.locator("summary").click();
    await expect(menu).not.toHaveAttribute("open", "");
    await page
      .getByRole("navigation", { name: "메인 메뉴", exact: true })
      .getByRole("link", { name: "로그인", exact: true })
      .click();
    await expect(page).toHaveURL(/\/login$/);
  } finally {
    await context.close();
  }
});
