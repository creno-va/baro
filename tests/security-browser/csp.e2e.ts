import { expect, type Locator, test } from "@playwright/test";
import { publicLawyer } from "../fixtures/contracts/v2";

async function scrollScene(scene: Locator, pinSelector: string, progress: number) {
  await scene.evaluate(
    (element, options) => {
      const pin = element.querySelector<HTMLElement>(options.pinSelector);
      if (!(element instanceof HTMLElement) || !pin) throw new Error("Missing landing scene");
      const top = Number.parseFloat(getComputedStyle(pin).top) || 0;
      window.scrollTo({
        top:
          scrollY +
          element.getBoundingClientRect().top -
          top +
          (element.offsetHeight - pin.offsetHeight) * options.progress,
        behavior: "instant",
      });
    },
    { pinSelector, progress },
  );
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  test(`built photos, transitions and complete CEO letters work under hash CSP at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const browser = window as unknown as { experienceCspViolations: string[] };
      browser.experienceCspViolations = [];
      document.addEventListener("securitypolicyviolation", (event) =>
        browser.experienceCspViolations.push(event.violatedDirective),
      );
    });
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const response = await page.goto("/#our-beginning");
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    await page.evaluate(() => document.fonts.ready);
    const policy = response?.headers()["content-security-policy"];
    expect(response?.status()).toBe(200);
    expect(policy).toContain("sha256-");
    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval/);
    const origin = page.locator("[data-origin-story]");
    await expect(origin).toHaveClass(/origin-motion/);
    await scrollScene(origin, ".origin-pin", 0);
    for (const [selector, path] of [
      [".origin-clean-background img", "/landing/origin-notes-clean.webp"],
      [".origin-original-note-left img", "/landing/origin-notes-original.webp"],
      [".origin-original-note-right img", "/landing/origin-notes-original.webp"],
    ] as const) {
      await expect
        .poll(() =>
          origin
            .locator(selector)
            .evaluate(
              (element, pathname) =>
                element instanceof HTMLImageElement &&
                element.complete &&
                element.naturalWidth > 1 &&
                new URL(element.currentSrc).origin === location.origin &&
                new URL(element.currentSrc).pathname === pathname,
              path,
            ),
        )
        .toBe(true);
    }
    await origin.getByRole("button", { name: "BARO로 들어가기" }).click();
    await expect(origin.locator(".origin-arrival")).toHaveCSS("opacity", "1");
    await origin.getByRole("link", { name: "BARO 안으로" }).click();
    await expect(page).toHaveURL(/#blue-app-reveal$/);
    const time = page.locator("[data-time-experience]");
    await expect(time).toHaveClass(/time-experience-motion/);
    await scrollScene(time, "[data-time-pin]", 0);
    await expect
      .poll(() =>
        time
          .locator(".time-watch-image")
          .evaluate(
            (element) =>
              element instanceof HTMLImageElement &&
              element.complete &&
              element.naturalWidth > 1 &&
              new URL(element.currentSrc).origin === location.origin &&
              new URL(element.currentSrc).pathname === "/landing/time-watch.webp",
          ),
      )
      .toBe(true);
    await scrollScene(time, "[data-time-pin]", 0.99);
    await expect(time.locator("[data-time-message]")).toHaveCSS("opacity", "1");
    await time.getByRole("link", { name: "직접 체험하기" }).click();
    await expect(page).toHaveURL(/#try-baro$/);
    const phone = page.locator("[data-phone-story]");
    await scrollScene(phone, ".phone-story-sticky", 0.995);
    await expect(phone.locator("[data-phone-arrival]")).toHaveCSS("opacity", "1");
    await expect(phone.locator("[data-phone-arrival]")).toContainText("어떤 일이 있었나요?");
    const ceo = page.locator("[data-ceo-greeting]");
    await expect(ceo).toHaveClass(/ceo-motion-ready/);
    await expect(ceo.locator("button")).toHaveCount(0);
    await expect(ceo.locator("[data-ceo-chapter]")).toHaveCount(2);
    for (const [face, progress] of [
      ["suit", 0],
      ["crenova", 1],
    ] as const) {
      await scrollScene(ceo.locator("[data-ceo-scroll]"), "[data-ceo-viewport]", progress);
      await expect(ceo).toHaveAttribute("data-ceo-current", face);
      for (const accessibleChapter of await ceo.locator("[data-ceo-chapter]").all()) {
        await expect(accessibleChapter).not.toHaveAttribute("inert");
        await expect(accessibleChapter).not.toHaveAttribute("aria-hidden");
        await expect(accessibleChapter.getByRole("heading", { level: 3 })).toHaveCount(1);
      }
      const chapter = ceo.locator(`[data-ceo-chapter="${face}"]`);
      const portrait = chapter.locator("[data-ceo-photo] img");
      await expect
        .poll(() =>
          portrait.evaluate(
            (element) =>
              element instanceof HTMLImageElement &&
              element.complete &&
              element.naturalWidth > 1 &&
              new URL(element.currentSrc).origin === location.origin,
          ),
        )
        .toBe(true);
      await expect(chapter.locator("[data-ceo-message]")).toBeVisible();
      await expect(chapter.locator(".ceo-signature")).toContainText("황은찬");
      if (face === "suit") await expect(chapter.locator("h3")).toBeInViewport({ ratio: 1 });
      else await expect(chapter.locator(".ceo-signature")).toBeInViewport({ ratio: 1 });
    }
    await scrollScene(ceo.locator("[data-ceo-scroll]"), "[data-ceo-viewport]", 0);
    await expect(ceo).toHaveAttribute("data-ceo-current", "suit");
    await expect(ceo.locator('[data-ceo-message="suit"] h3')).toBeInViewport({ ratio: 1 });
    const finale = page.locator("[data-finale]");
    await expect(finale).toHaveClass(/finale-motion-ready/);
    await scrollScene(finale, "[data-finale-pin]", 0.74);
    await expect(finale.locator("[data-finale-app]")).toHaveCSS("opacity", "1");
    await scrollScene(finale, "[data-finale-pin]", 0.99);
    await expect(finale.locator("[data-finale-message]")).toHaveCSS("opacity", "1");
    await expect(finale.getByRole("link", { name: "내 이야기로 시작하기" })).toHaveAttribute(
      "href",
      "/app",
    );
    expect(
      await page.evaluate(
        () => (window as unknown as { experienceCspViolations: string[] }).experienceCspViolations,
      ),
    ).toEqual([]);
  });
}

test("built landing loads local footage and its interactive scenes under the Worker hash CSP", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    const browser = window as unknown as { landingCspViolations: string[] };
    browser.landingCspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) =>
      browser.landingCspViolations.push(event.violatedDirective),
    );
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1440, height: 900 });
  const response = await page.goto("/");
  const policy = response?.headers()["content-security-policy"];
  expect(policy).toContain("sha256-");
  expect(policy).not.toMatch(/unsafe-inline|unsafe-eval/);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: /막막했던 법률 문제,\s*이제 정리부터 가볍게\./,
    }),
  ).toBeVisible();
  await expect(page.locator(".landing-motion-ready")).toHaveCount(1);
  await expect(page.locator("[data-journey-hero]")).toHaveClass(/journey-ready/);
  const artwork = page.locator(".landing-main img").first();
  await artwork.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      artwork.evaluate(
        (element) =>
          element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0,
      ),
    )
    .toBe(true);
  expect(
    await artwork.evaluate(
      (element) =>
        element instanceof HTMLImageElement &&
        new URL(element.currentSrc).origin === location.origin,
    ),
  ).toBe(true);
  const heroFilm = page.locator("video[data-scroll-film]");
  await expect
    .poll(
      () =>
        heroFilm.evaluate(
          (video) => video instanceof HTMLVideoElement && video.readyState >= 2 && !video.paused,
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
  expect(
    await heroFilm.evaluate(
      (video) =>
        video instanceof HTMLVideoElement &&
        new URL(video.currentSrc).origin === location.origin &&
        new URL(video.currentSrc).pathname === "/landing/hero-continuous.mp4" &&
        video.autoplay &&
        video.loop,
    ),
  ).toBe(true);
  const scrollBeforePause = await page.evaluate(() => scrollY);
  await page.locator("[data-journey-toggle]").click();
  await expect(page.locator("[data-journey-toggle]")).toHaveAttribute("data-paused", "true");
  expect(Math.abs((await page.evaluate(() => scrollY)) - scrollBeforePause)).toBeLessThanOrEqual(1);
  expect(
    await heroFilm.evaluate((video) => video instanceof HTMLVideoElement && video.paused),
  ).toBe(true);
  await page.locator("[data-journey-toggle]").click();
  await page.locator("[data-journey-hero]").evaluate((element) => {
    const pin = element.querySelector<HTMLElement>(".journey-pin");
    if (!(element instanceof HTMLElement) || !pin) throw new Error("Missing journey scene");
    const top = Number.parseFloat(getComputedStyle(pin).top) || 76;
    window.scrollTo({
      top:
        scrollY +
        element.getBoundingClientRect().top -
        top +
        (element.offsetHeight - pin.offsetHeight) * 0.32,
      behavior: "instant",
    });
  });
  await expect
    .poll(() => heroFilm.evaluate((video) => video instanceof HTMLVideoElement && !video.paused))
    .toBe(true);
  await page.locator("[data-journey-hero]").evaluate((element) => {
    const pin = element.querySelector<HTMLElement>(".journey-pin");
    if (!(element instanceof HTMLElement) || !pin) throw new Error("Missing journey scene");
    const top = Number.parseFloat(getComputedStyle(pin).top) || 76;
    window.scrollTo({
      top:
        scrollY +
        element.getBoundingClientRect().top -
        top +
        (element.offsetHeight - pin.offsetHeight) * 0.96,
      behavior: "instant",
    });
  });
  await expect(page.locator("[data-journey-hero]")).toHaveAttribute("data-stage", "app");
  await expect
    .poll(() => heroFilm.evaluate((video) => video instanceof HTMLVideoElement && video.paused))
    .toBe(true);
  await expect(page.locator("[data-journey-app]")).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator("[data-journey-message].is-shown")).toHaveCount(6);
  const blue = page.locator("[data-blue-reveal]");
  await expect(blue).toHaveClass(/blue-reveal-motion/);
  await blue.evaluate((element) => {
    const pin = element.querySelector<HTMLElement>(".blue-reveal-pin");
    if (!(element instanceof HTMLElement) || !pin) throw new Error("Missing blue reveal");
    const top = Number.parseFloat(getComputedStyle(pin).top) || 76;
    window.scrollTo({
      top:
        scrollY +
        element.getBoundingClientRect().top -
        top +
        (element.offsetHeight - pin.offsetHeight) * 0.75,
      behavior: "instant",
    });
  });
  await expect(blue).toHaveAttribute("data-blue-selected", "2");
  await expect(blue.locator('[data-blue-panel="2"]')).toBeVisible();
  await blue.locator('[data-blue-demo="timeline"]').click();
  await expect(page.locator('[data-demo-tab="timeline"]')).toHaveAttribute("aria-selected", "true");
  await page.locator("[data-logo-experience]").evaluate((element) => {
    const pin = element.querySelector<HTMLElement>(".logo-experience-sticky");
    if (!(element instanceof HTMLElement) || !pin) throw new Error("Missing logo scene");
    const top = Number.parseFloat(getComputedStyle(pin).top) || 76;
    window.scrollTo({
      top:
        scrollY +
        element.getBoundingClientRect().top -
        top +
        (element.offsetHeight - pin.offsetHeight) * 0.56,
      behavior: "instant",
    });
  });
  await expect(page.locator("[data-logo-experience]")).toHaveAttribute("data-logo-selected", "1");
  await page.locator('[data-logo-feature="3"]').click();
  await expect(page.locator('[data-logo-panel="3"]')).toBeVisible();
  await page.locator('[data-logo-panel="3"] a').click();
  await expect(page.locator('[data-demo-tab="report"]')).toHaveAttribute("aria-selected", "true");
  await page.locator('[data-demo-confirm="facts"]').check();
  await page.locator('[data-demo-confirm="files"]').check();
  await page.locator("[data-demo-finish]").click();
  await expect(page.locator("[data-demo-complete]")).toBeVisible();
  await page.locator("[data-clarity]").evaluate((element) => {
    const pin = element.querySelector<HTMLElement>("[data-clarity-pin]");
    if (!(element instanceof HTMLElement) || !pin) throw new Error("Missing clarity scene");
    const top = Number.parseFloat(getComputedStyle(pin).top) || 76;
    window.scrollTo({
      top:
        scrollY +
        element.getBoundingClientRect().top -
        top +
        (element.offsetHeight - pin.offsetHeight) * 0.97,
      behavior: "instant",
    });
  });
  await page.locator('[data-clarity-topic="work"]').click();
  await expect(page.locator('[data-clarity-result="0"]')).toContainText("일이 있었던 날짜");
  await expect(page.locator('[data-clarity-output="2"]')).toHaveCSS("opacity", "1");
  await page.locator("#phone-story").evaluate((element) => {
    window.scrollTo({ top: scrollY + element.getBoundingClientRect().top, behavior: "instant" });
  });
  await expect(page.locator("[data-phone-story]")).toHaveClass(/phone-story-ready/);
  await page.locator('[data-phone-step="2"]').click();
  await expect(page.locator("[data-phone-story]")).toHaveAttribute("data-chapter", "2");
  await expect(page.locator('[data-phone-screen="2"]')).toHaveClass(/is-current/);
  const future = page.locator("[data-everyday-future]");
  await expect(future).toHaveClass(/future-motion-ready/);
  const futureFilm = future.locator('video[data-film="future-everyday"]');
  await futureFilm.evaluate((element) => {
    const container = element.closest("[data-film-container]");
    if (!container) throw new Error("Missing everyday film container");
    window.scrollTo({
      top: scrollY + container.getBoundingClientRect().top - 100,
      behavior: "instant",
    });
  });
  await expect
    .poll(
      () =>
        futureFilm.evaluate(
          (video) =>
            video instanceof HTMLVideoElement &&
            video.readyState >= 2 &&
            !video.paused &&
            new URL(video.currentSrc).origin === location.origin,
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
  await future.locator('[data-film-toggle="future-everyday"]').click();
  await expect(future.locator('[data-film-toggle="future-everyday"]')).toHaveAttribute(
    "data-playing",
    "false",
  );
  expect(
    await page.evaluate(
      () => (window as unknown as { landingCspViolations: string[] }).landingCspViolations,
    ),
  ).toEqual([]);
});

test("built public directory and detail hydrate under hash CSP with no case data in map links", async ({
  page,
}) => {
  const violations: string[] = [];
  page.on("console", (entry) => {
    if (entry.type() === "error" && entry.text().includes("Content Security Policy"))
      violations.push(entry.text());
  });
  await page.route("**/api/v2/lawyers**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v2/lawyers/self-service")
      return route.fulfill({ json: { items: [], nextCursor: null } });
    if (path.startsWith("/api/v2/lawyers/self-service/"))
      return route.fulfill({ status: 404, json: {} });
    if (path.includes("/assets/")) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({
      json:
        path === "/api/v2/lawyers"
          ? {
              schemaVersion: "2",
              snapshotId: "synthetic-csp-directory",
              rotation: "disclosed_rotation",
              expiresAt: "2026-10-06T00:05:00Z",
              items: [publicLawyer],
              nextCursor: null,
            }
          : publicLawyer,
    });
  });
  const response = await page.goto("/lawyers");
  expect(response?.headers()["content-security-policy"]).toContain("sha256-");
  expect(response?.headers()["cache-control"]).toContain("no-transform");
  await expect(page.getByRole("link", { name: "프로필과 연락처 보기" })).toBeVisible();
  await page.getByRole("link", { name: "프로필과 연락처 보기" }).press("Enter");
  await expect(
    page.getByRole("heading", { name: publicLawyer.content.name, exact: true }),
  ).toBeVisible();
  expect(await page.getByRole("link", { name: "Google 길찾기" }).getAttribute("href")).not.toMatch(
    /caseId|token|narrative/,
  );
  expect(violations).toEqual([]);
});

test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

test("built Worker hash CSP blocks injected script while React and allowlisted Turnstile script work", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as { injected: number; blocked: number; challengeLoaded: boolean };
    w.injected = 0;
    w.blocked = 0;
    w.challengeLoaded = false;
    document.addEventListener("securitypolicyviolation", () => w.blocked++);
  });
  const response = await page.goto("/login");
  expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  const policy = response?.headers()["content-security-policy"];
  expect(policy).toContain("sha256-");
  expect(policy).toContain("https://challenges.cloudflare.com");
  expect(policy).not.toMatch(/unsafe-inline|unsafe-eval/);
  await page.route("**/api/auth/sign-in/social", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  const button = page.getByRole("button", { name: /Google/ });
  await button.press("Enter");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(button).toBeEnabled();
  await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.injected=1";
    document.body.appendChild(script);
  });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { blocked: number }).blocked))
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as unknown as { injected: number }).injected)).toBe(0);
  await page.route(
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
    (route) =>
      route.fulfill({ contentType: "application/javascript", body: "window.challengeLoaded=true" }),
  );
  await page.evaluate(() => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    document.body.appendChild(script);
  });
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { challengeLoaded: boolean }).challengeLoaded),
    )
    .toBe(true);
});

test("built Worker mobile menu, brand, local font and error state work without CSP violations", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const browser = window as unknown as {
      uiCspViolations: Array<{ directive: string; blockedURI: string; lineNumber: number }>;
    };
    browser.uiCspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) =>
      browser.uiCspViolations.push({
        directive: event.violatedDirective,
        blockedURI: event.blockedURI,
        lineNumber: event.lineNumber,
      }),
    );
  });
  await page.route("**/api/cases**", (route) => route.fulfill({ status: 503, json: {} }));
  await page.route("**/api/me/session", (route) =>
    route.fulfill({
      json: {
        user: { id: "synthetic-csp-customer", name: "합성 고객", accountType: "customer" },
        needsConsent: false,
      },
    }),
  );
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto("/cases");
  await expect(page.getByRole("alert")).toContainText(
    "요청을 완료하지 못했어요. 다시 시도해 주세요.",
  );
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.evaluate(() => {
    document.documentElement.style.scrollbarGutter = "stable";
    document.body.style.minHeight = "calc(100vh + 1px)";
  });
  expect(await page.evaluate(() => document.documentElement.clientWidth)).toBeLessThan(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
  const opener = page.getByRole("button", { name: "메뉴 열기" });
  await opener.press("Enter");
  const dialog = page.getByRole("dialog", { name: "메뉴", exact: true });
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: ".wrangler/built-ui-menu-320.png" });
  await expect(dialog.getByRole("button", { name: "닫기", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("link", { name: "이용 유형 변경", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "닫기", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  await page.evaluate(() => document.fonts.load('16px "Pretendard Variable"'));
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(() =>
      [...document.fonts].some(
        (font) =>
          font.family.replaceAll('"', "") === "Pretendard Variable" && font.status === "loaded",
      ),
    ),
  ).toBe(true);
  expect(await page.locator(".brand img").first().getAttribute("src")).toBe("/brand/logo.svg");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => (window as unknown as { uiCspViolations: string[] }).uiCspViolations),
  ).toEqual([]);
});

test("normal deployment bundle excludes the synthetic UI fixture", async ({ request }) => {
  test.skip(
    process.env.BARO_UI_TEST_FIXTURE === "true",
    "Fixture-specific build is explicitly enabled for local tests.",
  );
  expect((await request.get("/__design-system")).status()).toBe(404);
});

test("explicit test build hydrates shared tabs and modal under the Worker hash CSP", async ({
  page,
}) => {
  test.skip(
    process.env.BARO_UI_TEST_FIXTURE !== "true",
    "Synthetic fixture is absent from normal deployment builds.",
  );
  await page.addInitScript(() => {
    const browser = window as unknown as { uiCspViolations: string[] };
    browser.uiCspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) =>
      browser.uiCspViolations.push(event.violatedDirective),
    );
  });
  await page.goto("/__design-system");
  const overview = page.getByRole("tab", { name: "개요", exact: true });
  await overview.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tabpanel", { name: "자료", exact: true })).toContainText(
    "합성 자료 목록입니다.",
  );
  const opener = page.getByRole("button", { name: "검토 안내 열기" });
  await opener.press("Enter");
  await expect(page.getByRole("dialog", { name: "검토 안내", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  expect(
    await page.evaluate(() => (window as unknown as { uiCspViolations: string[] }).uiCspViolations),
  ).toEqual([]);
});
