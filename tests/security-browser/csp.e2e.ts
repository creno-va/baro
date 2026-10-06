import { expect, test } from "@playwright/test";
import { publicLawyer } from "../fixtures/contracts/v2";

test("built landing loads local footage and its interactive scenes under the Worker hash CSP", async ({
  page,
}) => {
  test.setTimeout(45_000);
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
        heroFilm.evaluate((video) => video instanceof HTMLVideoElement && video.readyState >= 2),
      { timeout: 15_000 },
    )
    .toBe(true);
  expect(
    await heroFilm.evaluate(
      (video) =>
        video instanceof HTMLVideoElement && new URL(video.currentSrc).origin === location.origin,
    ),
  ).toBe(true);
  await page.locator("[data-journey-toggle]").click();
  await expect(page.locator("[data-journey-toggle]")).toHaveAttribute("data-paused", "true");
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
        (element.offsetHeight - pin.offsetHeight) * 0.96,
      behavior: "instant",
    });
  });
  await expect(page.locator("[data-journey-hero]")).toHaveAttribute("data-stage", "app");
  await expect(page.locator("[data-journey-app]")).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator("[data-journey-message].is-shown")).toHaveCount(6);
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
  expect(
    await page.evaluate(
      () => (window as unknown as { landingCspViolations: string[] }).landingCspViolations,
    ),
  ).toEqual([]);
});

test("the built simplicity page hydrates its compact explanation under hash CSP", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const browser = window as unknown as { simplicityCspViolations: string[] };
    browser.simplicityCspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) =>
      browser.simplicityCspViolations.push(event.violatedDirective),
    );
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const response = await page.goto("/simplicity");
  expect(response?.status()).toBe(200);
  const policy = response?.headers()["content-security-policy"];
  expect(policy).toContain("sha256-");
  expect(policy).not.toMatch(/unsafe-inline|unsafe-eval/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("[data-clarity]")).toHaveClass(/clarity-static-ready/);
  await page.locator('[data-clarity-topic="money"]').click();
  await page.locator("[data-clarity-play]").click();
  await expect(page.locator('[data-clarity-result="0"]')).toContainText("돈을 보낸 날");
  await expect(page.locator(".clarity-help")).toBeHidden();
  expect(
    await page.evaluate(
      () => (window as unknown as { simplicityCspViolations: string[] }).simplicityCspViolations,
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
