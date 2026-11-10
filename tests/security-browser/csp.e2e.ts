import { expect, test } from "@playwright/test";

test("built service focus feedback works under hash CSP", async ({ page }) => {
  const violations: string[] = [];
  await page.exposeFunction("recordFocusCspViolation", (directive: string) =>
    violations.push(directive),
  );
  await page.addInitScript(() =>
    document.addEventListener("securitypolicyviolation", (event) => {
      void (
        window as unknown as { recordFocusCspViolation: (value: string) => Promise<void> }
      ).recordFocusCspViolation(event.violatedDirective);
    }),
  );
  await page.addInitScript(() => localStorage.setItem("baro-theme", "dark"));
  for (const path of ["/login", "/help"]) {
    const response = await page.goto(path);
    expect(response?.headers()["content-security-policy"]).toContain("sha256-");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator(":root")).toHaveAttribute("data-focus-input", "pointer");
    await page.keyboard.press("Tab");
    await expect(page.locator(":root")).toHaveAttribute("data-focus-input", "keyboard");
    if (path === "/help") {
      const summary = page.locator(".help-document [data-disclosure-button]").first();
      await summary.focus();
      await expect(summary).toHaveCSS("outline-style", "solid");
      await summary.click();
      await expect(page.locator(":root")).toHaveAttribute("data-focus-input", "pointer");
    }
    await page.getByRole("button", { name: "화면 테마 변경", exact: true }).first().click();
    await page.getByRole("menuitem", { name: "라이트 모드", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  }
  expect(violations).toEqual([]);
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  test(`built preparation entry and policy navigation work under hash CSP at ${viewport.width}px`, async ({
    page,
  }) => {
    const violations: string[] = [];
    await page.exposeFunction("recordPublicCspViolation", (directive: string) =>
      violations.push(directive),
    );
    await page.addInitScript(() =>
      document.addEventListener(
        "securitypolicyviolation",
        (event) =>
          void (
            window as unknown as { recordPublicCspViolation: (value: string) => Promise<void> }
          ).recordPublicCspViolation(event.violatedDirective),
      ),
    );
    await page.setViewportSize(viewport);
    const response = await page.goto("/");
    const policy = response?.headers()["content-security-policy"];
    expect(response?.status()).toBe(200);
    expect(policy).toContain("sha256-");
    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("막막했던 법률 문제");
    await expect(page.getByRole("main")).toContainText(
      "리포트는 준비하는 동안 다시 확인할 수 있어요",
    );
    await expect(page.locator('a[href^="/lawyer"]')).toHaveCount(0);
    const logo = page.getByRole("link", { name: "BARO 홈", exact: true }).first().locator("img");
    await expect
      .poll(() =>
        logo.evaluate(
          (image) =>
            image instanceof HTMLImageElement &&
            image.complete &&
            image.naturalWidth > 0 &&
            new URL(image.currentSrc).origin === location.origin,
        ),
      )
      .toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const policies = page.getByRole("navigation", { name: "하단 메뉴" });
    for (const [name, path] of [
      ["이용약관", "terms"],
      ["개인정보 처리방침", "privacy"],
      ["AI 이용 안내", "ai"],
    ] as const) {
      const link = policies.getByRole("link", { name, exact: true });
      await expect(link).toHaveAttribute("href", `/policies/${path}`);
    }
    await policies.getByRole("link", { name: "개인정보 처리방침", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("article")).toContainText("hechec3534@naver.com");
    expect(violations).toEqual([]);
  });
}

test("built recovery pages show safe errors and retain the original permitted destination under hash CSP", async ({
  page,
}) => {
  const response = await page.goto(
    "/login?error=access_denied&error_description=synthetic-untrusted-detail&returnTo=%2Fsettings",
  );
  const policy = response?.headers()["content-security-policy"];
  expect(policy).toContain("sha256-");
  expect(policy).not.toMatch(/unsafe-inline|unsafe-eval/);
  await expect(page.getByRole("alert")).toContainText("로그인을 취소했어요.");
  await expect(page.getByRole("main")).not.toContainText("synthetic-untrusted-detail");
  await expect(page.getByRole("button", { name: "Google로 계속하기", exact: true })).toBeEnabled();
  const missing = await page.goto("/synthetic-csp-missing-page");
  expect(missing?.status()).toBe(404);
  await expect(page.getByRole("link", { name: "홈으로", exact: true })).toHaveAttribute(
    "href",
    "/",
  );
});

test("built retired routes return 410 under hash CSP without reading profiles or exposing contact data", async ({
  page,
}) => {
  let reads = 0;
  await page.route("**/api/v2/lawyers**", (route) => {
    reads++;
    return route.abort();
  });
  for (const path of [
    "/lawyer",
    "/lawyers?region=seoul",
    "/lawyers/synthetic-profile?caseId=synthetic-private-id",
  ]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(410);
    const policy = response?.headers()["content-security-policy"];
    expect(policy).toContain("sha256-");
    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(response?.headers()["cache-control"]).toContain("no-transform");
    await expect(page.getByRole("main")).toContainText("변호사 연결 기능은 제공하지 않습니다");
    await expect(page.getByRole("main")).not.toContainText("synthetic-private-id");
    await expect(page.locator('a[href^="tel:"],a[href^="mailto:"],a[href*="maps"]')).toHaveCount(0);
  }
  expect(reads).toBe(0);
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
  await page.route("**/api/v2/cases/**", (route) => route.fulfill({ status: 503, json: {} }));
  await page.route("**/api/me/session", (route) =>
    route.fulfill({
      json: {
        user: { id: "synthetic-csp-customer", name: "합성 고객", accountType: "customer" },
        needsConsent: false,
      },
    }),
  );
  await page.setViewportSize({ width: 320, height: 760 });
  const casesResponse = await page.goto("/cases/10000000-0000-4000-8000-000000000001");
  expect(casesResponse?.status()).toBe(200);
  expect(casesResponse?.headers()["content-security-policy"]).toContain("media-src 'self' data:");
  expect(casesResponse?.headers()["content-security-policy"]).toContain(
    "img-src 'self' data: blob:",
  );
  await expect(page.getByRole("alert")).toContainText(
    "지금 요청을 처리할 수 없어요. 잠시 후 다시 시도해 주세요.",
  );
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.evaluate(() => {
    // macOS uses overlay scrollbars. A test-only rule in an already allowed
    // same-origin sheet gives this 15px classic-gutter regression real width.
    const sheet = [...document.styleSheets].find(
      (value) => value.href && new URL(value.href).origin === location.origin,
    );
    if (!sheet) throw new Error("Built same-origin stylesheet missing");
    sheet.insertRule(
      "html::-webkit-scrollbar { width: 15px; height: 15px; }",
      sheet.cssRules.length,
    );
    document.documentElement.style.overflowY = "scroll";
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
  await expect(dialog.getByRole("link", { name: "새 사건 입력", exact: true })).toHaveAttribute(
    "href",
    "/new",
  );
  await expect(dialog.getByRole("link", { name: "BARO 홈", exact: true })).toHaveAttribute(
    "href",
    "/new",
  );
  await page.screenshot({ path: ".wrangler/built-ui-menu-320.png" });
  await expect
    .poll(() => dialog.evaluate((node) => node.contains(document.activeElement)))
    .toBe(true);
  await dialog.getByRole("button", { name: "닫기", exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "로그아웃", exact: true })).toBeFocused();
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
  for (const path of [
    "/__design-system",
    "/__design-foundation",
    "/__legacy-lawyer",
    "/__legacy-lawyers",
    "/__legacy-lawyers/synthetic-profile",
  ]) {
    expect((await request.get(path)).status()).toBe(404);
  }
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
