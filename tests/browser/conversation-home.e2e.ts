import { expect, type Page, test } from "@playwright/test";
import type { SessionView } from "../../src/client/api/types";

test.skip(
  process.env.PUBLIC_API_MODE !== "mock" && !process.env.BARO_DESIGN_URL,
  "Use conversation.config.ts with the mock API adapter.",
);

async function setSession(page: Page, session: SessionView) {
  await page.addInitScript((value) => {
    localStorage.setItem("baro-api-mock-v1:session", JSON.stringify(value));
  }, session);
}

const customer: SessionView = {
  user: { id: "conversation-customer", name: "합성 고객", accountType: "customer" },
  needsConsent: false,
};

test("a customer starts directly on home and reaches adaptive questions without an intermediate list", async ({
  page,
}) => {
  await setSession(page, customer);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");
  const narrative = page.getByRole("textbox", { name: "지금까지 있었던 일" });
  await expect(narrative).toBeEnabled();
  const submit = page.getByRole("button", { name: "저장하고 계속" });
  await expect(submit).toBeDisabled();
  await narrative.fill("짧은 내용");
  await expect(submit).toBeDisabled();
  await narrative.fill(
    "합성 사건입니다. 회사 거래처에서 계약한 대금을 약속한 날짜가 지나도 지급하지 않았어요.",
  );
  await page.getByRole("radio", { name: "기업", exact: true }).check();
  await submit.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/cases\/[^/]+\/intake/);
  await expect(page.getByRole("heading", { name: "언제부터 어떤 일을 했나요?" })).toBeVisible();
  expect(
    await page.evaluate(() => {
      const items = JSON.parse(localStorage.getItem("baro-api-mock-v1:cases") ?? "{}");
      return (Object.values(items) as { subjectContext: string }[]).map(
        (item) => item.subjectContext,
      );
    }),
  ).toEqual(["company"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("app redirects guests, pending consent and lawyers before showing the customer composer", async ({
  page,
}) => {
  const cases: { session: SessionView; path: string }[] = [
    { session: { user: null, needsConsent: false }, path: "/login" },
    { session: { ...customer, needsConsent: true }, path: "/consent" },
    {
      session: {
        user: { id: "conversation-lawyer", name: "합성 변호사", accountType: "lawyer" },
        needsConsent: false,
      },
      path: "/lawyer",
    },
  ];
  for (const item of cases) {
    await page.goto("/login");
    await page.evaluate((session) => {
      localStorage.setItem("baro-api-mock-v1:session", JSON.stringify(session));
    }, item.session);
    await page.goto("/app");
    await expect(page).toHaveURL(new RegExp(`${item.path}$`));
    await expect(page.getByRole("textbox", { name: "지금까지 있었던 일" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "저장하고 계속" })).toHaveCount(0);
  }
  expect(await page.evaluate(() => localStorage.getItem("baro-api-mock-v1:cases"))).toBeNull();
});

test("an example only fills the composer and home remains usable at enlarged text size", async ({
  page,
}) => {
  await setSession(page, customer);
  await page.goto("/app");
  await page.setViewportSize({ width: 390, height: 844 });
  const example = page.getByRole("button", { name: "빌려준 돈을 못 받았어요" });
  await expect(example).toBeEnabled();
  const targetHeights = await page
    .locator(".conversation-home button, .conversation-context label")
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
  expect(targetHeights.every((height) => height >= 44)).toBe(true);
  await example.click();
  const narrative = page.getByRole("textbox", { name: "지금까지 있었던 일" });
  await expect(narrative).toHaveValue(/약속한 날짜/);
  await expect(narrative).toBeFocused();
  await expect(page).toHaveURL(/\/app$/);
  expect(await page.evaluate(() => localStorage.getItem("baro-api-mock-v1:cases"))).toBeNull();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("conversation screens remain accessible and responsive from home through chat", async ({
  page,
}) => {
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setSession(page, customer);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app");
  await expect(page.getByRole("textbox", { name: "지금까지 있었던 일" })).toBeEnabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: ".wrangler/ui-review/home-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 320, height: 760 });
  await expect
    .poll(() => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth)))
    .toBe(0);
  await expect(page.getByText("API 예시", { exact: true })).toBeVisible();
  await page.screenshot({ path: ".wrangler/ui-review/home-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "메뉴 열기" }).click();
  await expect(page.getByRole("dialog", { name: "메뉴", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "메뉴 열기" })).toBeFocused();
  await page
    .getByRole("textbox", { name: "지금까지 있었던 일" })
    .fill("화면 검증용 합성 사건입니다. 지인에게 빌려준 돈을 약속한 날짜에 돌려받지 못했어요.");
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  await expect(page.getByRole("heading", { name: "이 일은 언제 시작됐나요?" })).toBeVisible();
  await page.screenshot({ path: ".wrangler/ui-review/intake-mobile.png", fullPage: true });
  for (let index = 0; index < 6; index++)
    await page.getByRole("button", { name: "모름", exact: true }).click();
  await page.getByRole("checkbox", { name: "요약이 내가 이야기한 사실과 맞는지" }).check();
  await page.getByRole("button", { name: "요약 확인하고 계속" }).click();
  await page.getByRole("button", { name: "확인하고 사건 열기" }).click();
  await expect(page.getByRole("heading", { name: "이제, 하나씩 풀어가요." })).toBeVisible();
  await page
    .getByRole("textbox", { name: "추가 사실 또는 질문" })
    .fill("약속한 날짜가 지난 뒤 주고받은 메시지도 보관하고 있어요.");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.getByText("이 응답은 합성 API 예시", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({ path: ".wrangler/ui-review/chat-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: ".wrangler/ui-review/chat-desktop.png", fullPage: true });
});

test("recent case titles clear when another tab changes the active account", async ({ page }) => {
  await setSession(page, customer);
  await page.goto("/app");
  await page
    .getByRole("textbox", { name: "지금까지 있었던 일" })
    .fill("이전 사용자에게만 보여야 하는 합성 사건 제목입니다. 지인에게 돈을 빌려줬어요.");
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  const recent = page.getByRole("navigation", { name: "최근 사건" });
  await expect(recent.getByRole("link")).toHaveCount(1);
  await page.evaluate(() => {
    localStorage.setItem(
      "baro-api-mock-v1:session",
      JSON.stringify({
        user: { id: "another-synthetic-owner", name: "다른 합성 고객", accountType: "customer" },
        needsConsent: false,
      }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key: "baro-api-mock-v1:session" }));
  });
  await expect(page.getByRole("link", { name: "다른 합성 고객 나의 BARO" })).toBeVisible();
  await expect(recent).toHaveCount(0);
});

test("the legacy new-case page follows a real peer-tab login without reload", async ({
  page,
  context,
}) => {
  await page.goto("/cases/new");
  const narrative = page.getByRole("textbox", { name: "지금까지 있었던 일" });
  await expect(narrative).toBeDisabled();
  const peer = await context.newPage();
  await peer.goto("/login");
  await peer.evaluate((session) => {
    localStorage.setItem("baro-api-mock-v1:session", JSON.stringify(session));
  }, customer);
  await expect(narrative).toBeEnabled();
  await expect(page.locator("main").getByRole("link", { name: "로그인하고 시작하기" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "저장하고 계속" })).toBeDisabled();
});

test("a peer-tab owner switch clears the home draft before any case can be created", async ({
  page,
  context,
}) => {
  await setSession(page, customer);
  await page.goto("/app");
  const narrative = page.getByRole("textbox", { name: "지금까지 있었던 일" });
  await expect(narrative).toBeEnabled();
  await narrative.fill(
    "이전 고객만 입력한 합성 초안입니다. 약속한 날짜가 지나도 대금을 받지 못했어요.",
  );
  await page.getByRole("radio", { name: "기업", exact: true }).check();
  const peer = await context.newPage();
  await peer.goto("/login");
  // addInitScript seeds each page; change the session after the peer has loaded.
  await peer.evaluate(() => {
    localStorage.setItem(
      "baro-api-mock-v1:session",
      JSON.stringify({
        user: { id: "home-peer-owner", name: "다른 합성 고객", accountType: "customer" },
        needsConsent: false,
      }),
    );
  });
  await expect(page.getByRole("link", { name: "다른 합성 고객 나의 BARO" })).toBeVisible();
  await expect(narrative).toHaveValue("");
  await expect(page.getByRole("radio", { name: "개인", exact: true })).toBeChecked();
  await expect(page.getByRole("button", { name: "저장하고 계속" })).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem("baro-api-mock-v1:cases"))).toBeNull();
});
