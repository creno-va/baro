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

test("entry presents value and a visible desktop next action using the shared reading and form primitives", async ({
  page,
}) => {
  await setSession(page, customer);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/app");
  await expect(page.getByLabel("지금까지 있었던 일")).toBeEnabled();
  await expect(page.locator(".case-entry [data-slot='page-header']")).toContainText("준비할 일");
  expect(
    await page
      .locator(".case-entry h1")
      .evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize)),
  ).toBeLessThanOrEqual(28);
  await expect(page.locator(".conversation-emblem, .conversation-composer")).toHaveCount(0);
  await page.screenshot({ path: ".wrangler/flow02-entry-desktop.png", fullPage: true });
  await expect(page.getByRole("button", { name: "저장하고 계속", exact: true })).toBeInViewport({
    ratio: 1,
  });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    const next = page.getByRole("button", { name: "저장하고 계속", exact: true });
    await next.scrollIntoViewIfNeeded();
    await expect(next).toBeInViewport({ ratio: 1 });
    expect((await next.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `.wrangler/flow02-entry-${width}.png`, fullPage: true });
  }
});

test("case list has an honest empty state and a direct explanation entry", async ({ page }) => {
  await setSession(page, customer);
  await page.goto("/cases");
  await expect(page).toHaveURL(/\/cases$/);
  await expect(page.getByRole("heading", { name: "내 사건", exact: true })).toBeVisible();
  await expect(page.getByText("아직 정리한 사건이 없어요", { exact: true })).toBeVisible();
  await page
    .locator(".case-list")
    .getByRole("link", { name: "새 사건 만들기", exact: true })
    .click();
  await expect(page.getByLabel("지금까지 있었던 일")).toBeEnabled();
});

test("an existing lawyer account can resume its cases and explicit list deletion removes only the chosen case", async ({
  page,
}) => {
  await setSession(page, {
    ...customer,
    user: { id: "conversation-customer", name: "합성 기존 계정", accountType: "lawyer" },
  });
  await page.addInitScript(() => {
    const cases = Object.fromEntries(
      ["intake", "summary"].map((stage) => [
        stage,
        {
          id: stage,
          title: `${stage === "intake" ? "질문을 이어갈" : "요약을 확인할"} 합성 사건`,
          summary: "목록에서 현재 단계를 확인하는 합성 사건입니다.",
          stage,
          subjectContext: "individual",
          schemaVersion: "2",
          revision: 1,
          updatedAt: "2026-11-08T00:00:00.000Z",
        },
      ]),
    );
    localStorage.setItem("baro-api-mock-v1:cases", JSON.stringify(cases));
    localStorage.setItem(
      "baro-api-mock-v1:caseOwners",
      JSON.stringify({ intake: "conversation-customer", summary: "conversation-customer" }),
    );
  });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/cases");
  const list = page.locator(".case-list__rows");
  await expect(list.locator("li")).toHaveCount(2);
  await expect(list.getByRole("link", { name: /질문을 이어갈/ })).toHaveAttribute(
    "href",
    "/cases/intake/intake",
  );
  await expect(list.getByRole("link", { name: /요약을 확인할/ })).toHaveAttribute(
    "href",
    "/cases/summary/summary",
  );
  await list
    .getByRole("button", { name: "질문을 이어갈 합성 사건 사건 삭제", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", { name: "이 사건을 삭제할까요?", exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "취소", exact: true }).click();
  await expect(list.locator("li")).toHaveCount(2);
  await list
    .getByRole("button", { name: "질문을 이어갈 합성 사건 사건 삭제", exact: true })
    .click();
  await confirmation.getByRole("button", { name: "사건 삭제", exact: true }).click();
  await expect(list.locator("li")).toHaveCount(1);
  await expect(list).toContainText("요약을 확인할 합성 사건");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});

test("a customer starts directly on home and reaches adaptive questions without an intermediate list", async ({
  page,
}) => {
  await setSession(page, customer);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");
  const narrative = page.getByRole("textbox", { name: "지금까지 있었던 일" });
  await expect(narrative).toBeEnabled();
  const submit = page.getByRole("button", { name: "저장하고 계속" });
  await expect(submit).toBeEnabled();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator(".conversation-context-hint")).toHaveText("10자 이상 입력해주세요");
    await expect(page.locator(".conversation-context-hint")).toBeVisible();
    await expect(page.locator(".conversation-input-meta")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await narrative.fill("😀".repeat(9));
  await submit.click();
  await expect(page.getByRole("dialog", { name: "이야기를 조금만 더 적어주세요" })).toBeVisible();
  await expect(
    page.getByText("어떤 일이 있었는지 10자 이상 적어주세요.", { exact: false }),
  ).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("baro-api-mock-v1:cases"))).toBeNull();
  await page.getByRole("button", { name: "계속 작성하기" }).click();
  await narrative.fill(
    "합성 사건입니다. 회사 거래처에서 계약한 대금을 약속한 날짜가 지나도 지급하지 않았어요.",
  );
  await page.getByRole("combobox", { name: "준비하는 방향" }).selectOption("civil-response");
  await submit.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/cases\/[^/]+\/intake/);
  await expect(page.getByRole("heading", { name: "언제부터 어떤 일을 했나요?" })).toBeVisible();
  expect(
    await page.evaluate(() => {
      const items = JSON.parse(localStorage.getItem("baro-api-mock-v1:reworkContexts") ?? "{}");
      return (Object.values(items) as { casePurpose: string }[]).map((item) => item.casePurpose);
    }),
  ).toEqual(["respond_to_claim"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("a short account is accepted and recent-story deletion requires explicit confirmation", async ({
  page,
}) => {
  await setSession(page, customer);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app");
  await page.getByRole("textbox", { name: "지금까지 있었던 일" }).fill("폭행을 당했습니다.");
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  await expect(page).toHaveURL(/\/intake/);
  const remove = page.locator(".sidebar-desktop .sidebar-story-delete").first();
  await page.locator(".sidebar-desktop .sidebar-story-row").first().hover();
  await expect(remove).toBeVisible();
  await remove.click();
  const dialog = page.getByRole("dialog", { name: "이 사건을 삭제할까요?", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "사건 삭제", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "사건 삭제", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.locator(".sidebar-story-row")).toHaveCount(0);
});

test("help and policy preserve account access for both roles without contact profile entries", async ({
  page,
}) => {
  // Keep the chosen role across public → application navigation in this test.
  await page.addInitScript((session) => {
    if (localStorage.getItem("help-role-seeded")) return;
    localStorage.setItem("help-role-seeded", "true");
    localStorage.setItem("baro-api-mock-v1:session", JSON.stringify(session));
  }, customer);
  for (const url of ["/help", "/policies/ai"]) {
    for (const accountType of ["customer", "lawyer", "customer"] as const) {
      await page.goto(url);
      const name = accountType === "lawyer" ? "합성 기존 계정" : "합성 고객";
      await page.evaluate(
        ({ accountType, name }) => {
          const key = "baro-api-mock-v1:session";
          const session = JSON.parse(localStorage.getItem(key) ?? "{}");
          session.user.accountType = accountType;
          session.user.name = name;
          localStorage.setItem(key, JSON.stringify(session));
          window.dispatchEvent(new Event("baro-session-changed"));
        },
        { accountType, name },
      );
      const start = page
        .getByRole("navigation", { name: "서비스 안내", exact: true })
        .getByRole("link", { name: "사건 준비 시작", exact: true });
      await expect(start).toBeVisible();
      await expect(start).toHaveAttribute("href", "/app");
      await expect(
        page.locator('a[href="/lawyer"], a[href="/lawyers"], a[href^="/lawyers/"]'),
      ).toHaveCount(0);
      await start.click();
      await expect(page).toHaveURL(/\/app$/);
      await expect(page.getByLabel("지금까지 있었던 일")).toBeEnabled();
      const account = page.getByRole("link", { name: `${name} · 계정 관리`, exact: true }).first();
      await expect(account).toBeVisible();
      await expect(account).toHaveAttribute("href", "/settings");
      await expect(
        page.locator('a[href="/lawyer"], a[href="/lawyers"], a[href^="/lawyers/"]'),
      ).toHaveCount(0);
      const session = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("baro-api-mock-v1:session") ?? "{}"),
      );
      expect(session.user).toMatchObject({ id: customer.user?.id, accountType, name });
    }
  }
});

test("app redirects missing access and permits the shared composer for both account roles", async ({
  page,
}) => {
  const cases: { session: SessionView; path: string }[] = [
    { session: { user: null, needsConsent: false }, path: "/login?returnTo=%2Fapp" },
    { session: { ...customer, needsConsent: true }, path: "/consent?returnTo=%2Fapp" },
    {
      session: {
        user: { id: "conversation-lawyer", name: "합성 변호사", accountType: "lawyer" },
        needsConsent: false,
      },
      path: "/app",
    },
  ];
  for (const item of cases) {
    await page.goto("/login");
    await page.evaluate((session) => {
      localStorage.setItem("baro-api-mock-v1:session", JSON.stringify(session));
    }, item.session);
    await page.goto("/app");
    await expect(page).toHaveURL(new URL(item.path, page.url()).href);
    if (item.path === "/app") {
      await expect(page.getByRole("textbox", { name: "지금까지 있었던 일" })).toBeEnabled();
      await expect(page.getByRole("button", { name: "저장하고 계속" })).toBeVisible();
    } else {
      await expect(page.getByRole("textbox", { name: "지금까지 있었던 일" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "저장하고 계속" })).toHaveCount(0);
    }
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
  await expect(page.getByText("API 예시", { exact: true })).not.toBeVisible();
  await page.screenshot({ path: ".wrangler/ui-review/home-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "메뉴 열기" }).click();
  const menu = page.getByRole("dialog", { name: "메뉴", exact: true });
  await expect(menu).toBeVisible();
  await expect(menu.getByText("API 예시 모드 · 합성 데이터", { exact: true })).toBeVisible();
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
  await page.getByRole("button", { name: "맞아요", exact: true }).click();
  await page
    .getByRole("dialog", { name: "이 내용으로 계속할까요?", exact: true })
    .getByRole("button", { name: "확인하고 계속", exact: true })
    .click();
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
  await expect(
    page.getByRole("link", { name: "다른 합성 고객 · 계정 관리", exact: true }),
  ).toBeVisible();
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
  await expect(page.getByRole("button", { name: "저장하고 계속" })).toBeEnabled();
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
  await page.getByRole("combobox", { name: "준비하는 방향" }).selectOption("criminal-response");
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
  await expect(
    page.getByRole("link", { name: "다른 합성 고객 · 계정 관리", exact: true }),
  ).toBeVisible();
  await expect(narrative).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "준비하는 방향" })).toHaveValue(
    "unknown-prepare",
  );
  await expect(page.getByRole("button", { name: "저장하고 계속" })).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem("baro-api-mock-v1:cases"))).toBeNull();
});
