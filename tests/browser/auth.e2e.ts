import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { syntheticConsentStatus } from "../fixtures/consent-status";

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
    ["oauth&error=account_not_linked", "이메일 소유 확인이 없어 계정을 연결하지 못했어요."],
    ["oauth&error=unable_to_link_account", "계정 연결을 완료하지 못했어요."],
    ["oauth&error=access_denied", "로그인을 취소했어요."],
  ] as const) {
    await page.goto(`/login?error=${error}&error_description=untrusted-raw-detail`);
    await expect(page.getByRole("alert")).toContainText(message);
    await expect(page.locator("body")).not.toContainText("untrusted-raw-detail");
    const descriptionBounds = await page.locator(".login-panel__description").boundingBox();
    const errorBounds = await page.getByRole("alert").boundingBox();
    const roleBounds = await page
      .getByRole("group", { name: "소셜 계정으로 계속하기" })
      .boundingBox();
    if (!descriptionBounds || !errorBounds || !roleBounds) {
      throw new Error("Login instructions, error and provider choices must remain visible.");
    }
    expect(errorBounds.y).toBeGreaterThanOrEqual(descriptionBounds.y + descriptionBounds.height);
    expect(roleBounds.y).toBeGreaterThanOrEqual(errorBounds.y + errorBounds.height);
  }
});

test("branded social login stays accessible on narrow phones and desktop", async ({ page }) => {
  for (const viewport of [
    { width: 320, height: 760 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
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
    await expect(page.getByRole("radio")).toHaveCount(0);
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
    const form = await page.locator(".login-options").boundingBox();
    expect(form?.width).toBeLessThanOrEqual(448);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    if (viewport.width === 1366 || viewport.width === 390) {
      await page.getByRole("heading", { name: "로그인 · 회원가입", exact: true }).click();
      await page.screenshot({ path: `.wrangler/ui-302-login-${viewport.width}.png` });
    }
  }
});

for (const [accountType, returnTo, destination] of [
  ["customer", "/cases/synthetic-case/files", "/cases/synthetic-case/files"],
  ["lawyer", "/settings", "/settings"],
  ["customer", "https://example.com/evil", "/new"],
  ["lawyer", "/cases/private-case", "/cases/private-case"],
] as const) {
  test(`current consent continues automatically: ${accountType} ${returnTo}`, async ({ page }) => {
    await page.route("**/api/me/session", (route) =>
      route.fulfill({
        json: {
          user: { id: "synthetic-owner", name: "합성 이용자", accountType },
          needsConsent: false,
        },
      }),
    );
    let writes = 0;
    await page.route("**/api/me/consent", (route) => {
      if (route.request().method() !== "GET") writes++;
      return route.fulfill({ json: syntheticConsentStatus(false) });
    });
    const content = await page.request.get(`/consent?returnTo=${encodeURIComponent(returnTo)}`);
    expect(await content.text()).not.toContain("시작 전에");
    await page.goto(`/consent?returnTo=${encodeURIComponent(returnTo)}`);
    await expect(page).toHaveURL(new RegExp(`${destination}$`));
    expect(writes).toBe(0);
    await expect(page.getByRole("button", { name: "동의하고 계속하기" })).toHaveCount(0);
  });
}

test("required consent fits desktop and phone and policy links preserve the form", async ({
  page,
}) => {
  await page.route("**/api/me/consent", (route) =>
    route.fulfill({ json: syntheticConsentStatus(true) }),
  );
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 320, height: 760 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/consent?returnTo=%2Fsettings");
    const save = page.getByRole("button", { name: "동의하고 계속하기" });
    await expect(save).toBeDisabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole("checkbox").first().check();
    const links = page.getByRole("navigation", { name: "정책 원문" }).getByRole("link");
    await expect(links).toHaveCount(3);
    for (const link of await links.all()) await expect(link).toHaveAttribute("target", "_blank");
    await expect(page.getByRole("checkbox").first()).toBeChecked();
    await expect(page.getByRole("link", { name: "취소하고 돌아가기" })).toHaveCount(0);
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
  await expect(page.getByRole("radio")).toHaveCount(0);
  release?.();
  await expect(page.getByRole("alert")).toContainText("로그인을 시작하지 못했어요.");
  await expect(page.getByRole("button", { name: "Google로 계속하기" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Naver로 계속하기" })).toBeFocused();
});

for (const accountType of ["customer", "lawyer"] as const) {
  test(`common keyboard login preserves existing ${accountType} owner without a role write`, async ({
    page,
  }) => {
    let writes = 0;
    await page.route("**/api/me/session", (route) =>
      route.fulfill({
        json: {
          user: { id: "synthetic-existing-owner", name: "합성 기존 이용자", accountType },
          needsConsent: false,
        },
      }),
    );
    await page.route("**/api/me/account-type", (route) => {
      writes++;
      return route.abort();
    });
    await page.route("**/api/auth/sign-in/social", (route) =>
      route.fulfill({
        json: {
          redirect: true,
          url: new URL(route.request().postDataJSON().callbackURL, route.request().url()).href,
        },
      }),
    );
    await page.route("**/api/me/consent", (route) =>
      route.fulfill({ json: syntheticConsentStatus(false) }),
    );
    await page.goto("/login?returnTo=%2Fsettings");
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Kakao로 계속하기", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Kakao로 계속하기", exact: true }).focus();
    const signIn = page.waitForRequest("**/api/auth/sign-in/social");
    await page.keyboard.press("Enter");
    const initiation = (await signIn).postDataJSON();
    expect(initiation).toMatchObject({
      provider: "kakao",
      errorCallbackURL: "/login?returnTo=%2Fsettings&error=oauth",
    });
    const callback = new URL(initiation.callbackURL, page.url());
    expect(callback.pathname).toBe("/consent");
    expect(callback.searchParams.get("returnTo")).toBe("/settings");
    expect(callback.searchParams.has("loginAttempt")).toBe(false);
    await expect(page).toHaveURL(/\/settings$/);
    expect(writes).toBe(0);
    expect(await page.evaluate(() => sessionStorage.getItem("baro-account-type"))).toBeNull();
  });
}

test("provider errors are recoverable and a synthetic redirect reaches consent", async ({
  page,
}) => {
  let attempts = 0;
  await page.route("**/api/auth/sign-in/social", async (route) => {
    attempts++;
    await route.fulfill(
      attempts === 1
        ? { status: 400, json: { code: "SYNTHETIC_PROVIDER_ERROR", message: "synthetic" } }
        : {
            status: 200,
            json: {
              redirect: true,
              url: new URL(route.request().postDataJSON().callbackURL, route.request().url()).href,
            },
          },
    );
  });
  await page.route("**/api/me/consent", (route) =>
    route.fulfill({ json: syntheticConsentStatus(true) }),
  );
  await page.goto("/login");
  await page.locator("astro-island[ssr]").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Kakao로 계속하기" }).click();
  await expect(page.getByRole("alert")).toContainText("로그인을 시작하지 못했어요.");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/consent$/);
});

test("consent loading failure retries; keyboard checks gate save, failure recovers and continues automatically", async ({
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
      await route.fulfill({ json: syntheticConsentStatus(true) });
      return;
    }
    writes++;
    if (writes === 1) {
      await pending;
      await route.abort("failed");
    } else await route.fulfill({ json: syntheticConsentStatus(false) });
  });
  await page.goto("/consent");
  await expect(page.getByRole("alert")).toContainText("동의 상태를 불러오지 못했어요.");
  await page.getByRole("button", { name: "다시 불러오기" }).focus();
  await page.keyboard.press("Enter");
  const boxes = page.getByRole("checkbox");
  const save = page.getByRole("button", { name: "동의하고 계속하기" });
  await expect(boxes).toHaveCount(1);
  await expect(save).toBeDisabled();
  await boxes.nth(0).focus();
  await page.keyboard.press("Space");
  await expect(save).toBeEnabled();
  await page.keyboard.press("Space");
  await expect(save).toBeDisabled();
  await page.keyboard.press("Space");
  await expect(save).toBeEnabled();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("navigation", { name: "정책 원문" }).getByRole("link", { name: /이용약관/ }),
  ).toBeFocused();
  await save.focus();
  await expect(save).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "저장 중…" })).toBeDisabled();
  await expect(boxes.nth(0)).toBeDisabled();
  release?.();
  await expect(page.getByRole("alert")).toContainText("동의를 저장하지 못했어요.");
  await expect(save).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/new$/);
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
  await page.goto("/new");
  await expect(page.getByRole("main").getByRole("status")).toContainText("로그인 상태를 확인");
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
  await page.goto("/new");
  const narrative = page.getByRole("textbox", { name: "지금까지 있었던 일" });
  await narrative.fill("세션 만료 전 합성 초안입니다. 이전 입력이 로그인 화면에 남으면 안 됩니다.");
  await page.route("**/api/me/session", (route) =>
    route.fulfill({ json: { user: null, needsConsent: false } }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fnew$/);
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
        : { json: syntheticConsentStatus(true) },
    ),
  );
  await page.goto("/consent");
  await expect(page.getByRole("checkbox")).toHaveCount(1);
  await page.getByRole("checkbox").nth(0).check();
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
