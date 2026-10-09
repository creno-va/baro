import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/me/session", (route) =>
    route.fulfill({
      json: {
        user: { id: "synthetic-owner", name: "합성 고객", accountType: "customer" },
        needsConsent: false,
      },
    }),
  );
  await page.route("**/api/me/account-type", (route) =>
    route.fulfill({ json: { accountType: "customer" } }),
  );
});

test("callback cancellation and expired sessions show safe messages", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  for (const [error, message] of [
    ["access_denied", "로그인을 취소했어요."],
    ["session_expired", "안전한 이용을 위해 다시 로그인해 주세요."],
    ["state_mismatch", "로그인이 완료되지 않았어요."],
  ] as const) {
    await page.goto(`/login?error=${error}&error_description=untrusted-raw-detail`);
    await expect(page.getByRole("alert")).toContainText(message);
    await expect(page.locator("body")).not.toContainText("untrusted-raw-detail");
    const captionBounds = await page.locator(".login-intro__caption").boundingBox();
    const errorBounds = await page.getByRole("alert").boundingBox();
    const roleBounds = await page
      .getByRole("group", { name: "어떤 목적으로 이용하시나요?" })
      .boundingBox();
    if (!captionBounds || !errorBounds || !roleBounds) {
      throw new Error("Login caption, error and account choices must remain visible.");
    }
    expect(errorBounds.y).toBeGreaterThanOrEqual(captionBounds.y + captionBounds.height);
    expect(roleBounds.y).toBeGreaterThanOrEqual(errorBounds.y + errorBounds.height);
  }
});

test("branded social login stays accessible on narrow phones and desktop", async ({ page }) => {
  for (const viewport of [
    { width: 320, height: 760 },
    { width: 390, height: 844 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/login");
    const logo = page.getByRole("link", { name: "BARO 홈" }).locator("img");
    await expect(logo).toBeVisible();
    await expect(logo).toHaveAttribute("src", "/brand/logo.svg");
    await expect
      .poll(() =>
        logo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
      )
      .toBe(true);
    await expect(page.getByRole("radio", { name: /고객/ })).toBeChecked();
    await expect(page.getByRole("radio", { name: /변호사/ })).toBeEnabled();
    for (const name of ["Kakao로 계속하기", "Naver로 계속하기", "Google로 계속하기"]) {
      const button = page.getByRole("button", { name, exact: true });
      await expect(button).toBeVisible();
      await expect(button).toBeEnabled();
      const bounds = await button.boundingBox();
      expect(bounds?.width).toBeGreaterThanOrEqual(44);
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
});

test("keyboard OAuth initiation blocks duplicates and restores focus on a network failure", async ({
  page,
}) => {
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/sign-in/social", async (route) => {
    await pending;
    await route.abort("failed");
  });
  await page.goto("/login");
  await page.locator("astro-island[ssr]").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Google로 계속하기" }).focus();
  await expect(page.getByRole("button", { name: "Google로 계속하기" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "연결 중…" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Naver로 계속하기" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Kakao로 계속하기" })).toBeDisabled();
  await expect(page.getByRole("radio", { name: /고객/ })).toBeDisabled();
  await expect(page.getByRole("radio", { name: /변호사/ })).toBeDisabled();
  release?.();
  await expect(page.getByRole("alert")).toContainText("로그인을 시작하지 못했어요.");
  await expect(page.getByRole("button", { name: "Google로 계속하기" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Naver로 계속하기" })).toBeFocused();
});

test("keyboard role selection reaches the lawyer destination after a synthetic OAuth callback", async ({
  page,
}) => {
  await page.route("**/api/auth/sign-in/social", (route) =>
    route.fulfill({
      json: { redirect: true, url: new URL("/consent", route.request().url()).href },
    }),
  );
  await page.route("**/api/me/account-type", (route) =>
    route.fulfill({ json: { accountType: "lawyer" } }),
  );
  await page.route("**/api/me/consent", (route) =>
    route.fulfill({ json: { needsConsent: false } }),
  );
  await page.goto("/login");
  const customer = page.getByRole("radio", { name: /고객/ });
  const lawyer = page.getByRole("radio", { name: /변호사/ });
  await expect(customer).toBeEnabled();
  await customer.focus();
  await page.keyboard.press("ArrowRight");
  await expect(lawyer).toBeFocused();
  await expect(lawyer).toBeChecked();
  const signIn = page.waitForRequest("**/api/auth/sign-in/social");
  const saveRole = page.waitForRequest("**/api/me/account-type");
  await page.getByRole("button", { name: "Kakao로 계속하기" }).click();
  expect((await signIn).postDataJSON()).toMatchObject({
    provider: "kakao",
    callbackURL: "/consent",
    errorCallbackURL: "/login?error=oauth",
  });
  expect((await saveRole).postDataJSON()).toEqual({ accountType: "lawyer" });
  await expect(page).toHaveURL(/\/consent$/);
  await expect(page.getByRole("link", { name: "내 화면으로 계속하기" })).toHaveAttribute(
    "href",
    "/lawyer",
  );
});

test("provider errors are recoverable and a synthetic redirect reaches consent", async ({
  page,
}) => {
  let attempts = 0;
  await page.route("**/api/auth/sign-in/social", async (route) => {
    attempts++;
    await route.fulfill(
      attempts === 1
        ? { status: 400, json: { code: "SYNTHETIC_PROVIDER_ERROR", message: "synthetic" } }
        : { status: 200, json: { redirect: true, url: "http://127.0.0.1:4337/consent" } },
    );
  });
  await page.route("**/api/me/consent", (route) => route.fulfill({ json: { needsConsent: true } }));
  await page.goto("/login");
  await page.locator("astro-island[ssr]").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Kakao로 계속하기" }).click();
  await expect(page.getByRole("alert")).toContainText("로그인을 시작하지 못했어요.");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/consent$/);
});

test("consent loading failure retries; keyboard checks gate save, failure recovers and completion focuses the link", async ({
  page,
}) => {
  let reads = 0;
  let writes = 0;
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/me/consent", async (route) => {
    if (route.request().method() === "GET") {
      reads++;
      if (reads === 1) {
        await route.abort("failed");
        return;
      }
      await route.fulfill({ json: { needsConsent: true } });
      return;
    }
    writes++;
    if (writes === 1) {
      await pending;
      await route.abort("failed");
    } else await route.fulfill({ json: { needsConsent: false } });
  });
  await page.goto("/consent");
  await expect(page.getByRole("alert")).toContainText("동의 상태를 불러오지 못했어요.");
  await page.getByRole("button", { name: "다시 불러오기" }).focus();
  await page.keyboard.press("Enter");
  const boxes = page.getByRole("checkbox");
  const save = page.getByRole("button", { name: "동의하고 계속하기" });
  await expect(save).toBeDisabled();
  await boxes.nth(0).focus();
  await page.keyboard.press("Space");
  await expect(save).toBeDisabled();
  await page.keyboard.press("Tab");
  await expect(boxes.nth(1)).toBeFocused();
  await page.keyboard.press("Space");
  await save.focus();
  await expect(save).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "저장 중…" })).toBeDisabled();
  await expect(boxes.nth(0)).toBeDisabled();
  release?.();
  await expect(page.getByRole("alert")).toContainText("동의를 저장하지 못했어요.");
  await expect(save).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("link", { name: "내 화면으로 계속하기" })).toBeFocused();
  await expect(page.getByRole("link", { name: "내 화면으로 계속하기" })).toHaveAttribute(
    "href",
    "/app",
  );
});

test("app hides the composer while session checks are pending or fail and supports retry", async ({
  page,
}) => {
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let failing = true;
  await page.route("**/api/me/session", async (route) => {
    await pending;
    if (failing) return route.abort("failed");
    return route.fulfill({
      json: {
        user: { id: "synthetic-owner", name: "합성 고객", accountType: "customer" },
        needsConsent: false,
      },
    });
  });
  await page.goto("/app");
  await expect(page.getByRole("status")).toContainText("로그인 상태를 확인");
  await expect(page.getByRole("textbox", { name: "지금까지 있었던 일" })).toHaveCount(0);
  release?.();
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "지금까지 있었던 일" })).toHaveCount(0);
  failing = false;
  await page.locator("main").getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "지금까지 있었던 일" })).toBeEnabled();
});

test("app clears an active draft and returns to login when the session expires", async ({
  page,
}) => {
  await page.goto("/app");
  const narrative = page.getByRole("textbox", { name: "지금까지 있었던 일" });
  await narrative.fill("세션 만료 전 합성 초안입니다. 이전 입력이 로그인 화면에 남으면 안 됩니다.");
  await page.route("**/api/me/session", (route) =>
    route.fulfill({ json: { user: null, needsConsent: false } }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fapp$/);
  await expect(page.getByRole("textbox", { name: "지금까지 있었던 일" })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("세션 만료 전 합성 초안");
});

for (const endpoint of ["session", "consent"] as const) {
  test(`an expired ${endpoint} read replaces consent with the login recovery page`, async ({
    page,
  }) => {
    await page.route(`**/api/me/${endpoint}`, (route) =>
      route.fulfill({ status: 401, json: { error: { code: "UNAUTHENTICATED" } } }),
    );
    await page.goto("/login?before=expired-consent");
    await page.goto("/consent");
    await expect(page).toHaveURL(/\/login\?error=session_expired$/);
    await expect(page.getByRole("alert")).toContainText("안전한 이용을 위해 다시 로그인해 주세요.");
    await expect(page.getByRole("button", { name: "다시 불러오기" })).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/\/login\?before=expired-consent$/);
  });
}

test("an expired session during consent saving returns to login", async ({ page }) => {
  await page.route("**/api/me/consent", (route) =>
    route.fulfill(
      route.request().method() === "PUT"
        ? { status: 401, json: { error: { code: "UNAUTHENTICATED" } } }
        : { json: { needsConsent: true } },
    ),
  );
  await page.goto("/consent");
  await page.getByRole("checkbox").nth(0).check();
  await page.getByRole("checkbox").nth(1).check();
  await page.getByRole("button", { name: "동의하고 계속하기" }).click();
  await expect(page).toHaveURL(/\/login\?error=session_expired$/);
  await expect(page.getByRole("alert")).toContainText("안전한 이용을 위해 다시 로그인해 주세요.");
});

test("expired consent preserves the permitted case destination and the recovery notice", async ({
  page,
}) => {
  await page.route("**/api/me/session", (route) =>
    route.fulfill({ status: 401, json: { error: { code: "UNAUTHENTICATED" } } }),
  );
  await page.goto("/consent?returnTo=%2Fcases%2Fsynthetic-case%2Ffiles");
  await expect(page).toHaveURL(
    /\/login\?returnTo=%2Fcases%2Fsynthetic-case%2Ffiles&error=session_expired$/,
  );
  await expect(page.getByRole("alert")).toContainText("안전한 이용을 위해 다시 로그인해 주세요.");
});
