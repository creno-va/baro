import { expect, type Page, test } from "@playwright/test";
import { openReportEditor, openReportOptions } from "../helpers/report-controls";

test("long service content fits narrow screens and the menu stays closable after scrolling in landscape", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    const id = "responsive-long-case";
    const text = "SYNTHETIC-LONG-CONTENT-".repeat(9);
    const values = {
      session: {
        user: { id: "responsive-owner", name: text, accountType: "customer" },
        needsConsent: false,
      },
      cases: {
        [id]: {
          id,
          title: text.slice(0, 160),
          subjectContext: "individual",
          stage: "active",
          revision: 1,
          updatedAt: now,
          summary: text.repeat(20),
          schemaVersion: "2",
        },
      },
      caseOwners: { [id]: "responsive-owner" },
      workspace: {
        [id]: {
          messages: [
            {
              id: "long-message",
              role: "assistant",
              text: text.repeat(8),
              status: "complete",
              createdAt: now,
            },
          ],
          actions: [{ id: "long-action", title: text, detail: text.repeat(4), done: false }],
          timeline: [
            { id: "long-timeline", date: "2026-10-21", title: text, detail: text.repeat(4) },
          ],
        },
      },
      files: {
        [id]: [
          {
            id: "long-file",
            name: `${text}.txt`,
            mimeType: "text/plain",
            sizeBytes: 100,
            status: "ready",
            coverage: text,
            extractedText: text.repeat(5),
          },
        ],
      },
    };
    for (const [key, value] of Object.entries(values))
      localStorage.setItem(`baro-api-mock-v1:${key}`, JSON.stringify(value));
  });
  for (const width of [320, 901, 1024]) {
    await page.setViewportSize({ width, height: 760 });
    for (const path of [
      "/cases",
      "/settings",
      "/cases/responsive-long-case",
      "/cases/responsive-long-case/files",
      "/cases/responsive-long-case/timeline",
      "/cases/responsive-long-case/actions",
      "/cases/responsive-long-case/reports",
    ]) {
      await page.goto(path);
      await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
      if (path.startsWith("/cases/"))
        await expect(
          page
            .getByRole("main")
            .getByText(/SYNTHETIC-LONG-CONTENT-/)
            .first(),
        ).toBeVisible();
      if (path === "/cases")
        await expect(page.locator(".sidebar-desktop .sidebar-story")).toHaveCount(1);
      if (path === "/settings") {
        await expect(page.locator(".settings-refresh")).toBeVisible();
        await expect(page.locator(".settings-case-delete")).toHaveCount(0);
      }
      if (path.endsWith("/reports")) {
        const regenerate = page.getByRole("button", { name: "새 버전 만들기", exact: true });
        await expect(regenerate).toBeEnabled();
        expect((await regenerate.boundingBox())?.height).toBeLessThanOrEqual(44);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
        `${path} at ${width}`,
      ).toBe(true);
      await page.screenshot({ path: `.wrangler/ui-second-${width}-${path.split("/").at(-1)}.png` });
    }
  }
  await page.setViewportSize({ width: 720, height: 400 });
  const opener = page.getByRole("button", { name: "메뉴 열기", exact: true });
  await opener.click();
  const menu = page.getByRole("dialog", { name: "메뉴", exact: true });
  await menu.getByRole("link", { name: "도움말", exact: true }).focus();
  await page.keyboard.press("End");
  await expect
    .poll(() => menu.locator(".ui-dialog__content").evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  expect(await menu.evaluate((element) => element.scrollTop)).toBe(0);
  const close = menu.getByRole("button", { name: "닫기", exact: true });
  const bounds = await close.boundingBox();
  expect(bounds?.y).toBeGreaterThanOrEqual(0);
  expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(400);
  await page.screenshot({ path: ".wrangler/ui-302-menu-landscape.png" });
  await close.click();
  await expect(menu).not.toBeVisible();
  await expect(opener).toBeFocused();
});

test("customer login consent logout share the product shell without external API requests", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("**/api/**", (route) => {
    if (!new URL(route.request().url()).pathname.startsWith("/api/")) return route.continue();
    requests.push(route.request().url());
    return route.abort();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login?error=access_denied");
  await expect(page.getByRole("alert")).toContainText("로그인을 취소");
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.getByRole("radio", { name: /고객/ }).check();
  await page.getByRole("button", { name: "Naver로 계속하기" }).click();
  await expect(page).toHaveURL(/\/consent$/);
  await expect(page.getByRole("button", { name: "동의하고 계속하기" })).toBeDisabled();
  await page.getByRole("checkbox", { name: /이용약관, 개인정보/ }).check();
  await page.getByRole("checkbox", { name: "만 14세 이상입니다." }).check();
  await page.getByRole("button", { name: "동의하고 계속하기" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("textbox", { name: "지금까지 있었던 일" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "메뉴 열기", exact: true }).click();
  await page
    .getByRole("dialog", { name: "메뉴", exact: true })
    .getByRole("button", { name: "로그아웃", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("radio", { name: /고객/ })).toBeVisible();
  expect(requests).toEqual([]);
});

test("customer completes intake workspace original PDF report and cascading deletion on one product UI", async ({
  page,
}) => {
  test.setTimeout(120000);
  const requests: string[] = [];
  await page.route("**/api/**", (route) => {
    if (!new URL(route.request().url()).pathname.startsWith("/api/")) return route.continue();
    requests.push(route.request().url());
    return route.abort();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.getByRole("button", { name: "Google로 계속하기" }).click();
  await page.getByRole("checkbox", { name: /이용약관, 개인정보/ }).check();
  await page.getByRole("checkbox", { name: "만 14세 이상입니다." }).check();
  await page.getByRole("button", { name: "동의하고 계속하기" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page
    .getByLabel("지금까지 있었던 일")
    .fill("합성 시연 사건입니다. 지인에게 빌려준 돈을 약속한 날짜가 지나도 돌려받지 못했습니다.");
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  for (let index = 0; index < 6; index++)
    await page.getByRole("button", { name: "모름", exact: true }).click();
  await expect(page).toHaveURL(/\/summary/);
  await page.getByRole("checkbox", { name: "요약이 내가 이야기한 사실과 맞는지" }).check();
  await page.getByRole("button", { name: "요약 확인하고 계속" }).click();
  await page.getByRole("button", { name: "확인하고 사건 열기" }).click();
  await expect(page).toHaveURL(/\/cases\/[^/]+$/);
  const casePath = new URL(page.url()).pathname;
  await page
    .getByLabel("추가 사실 또는 질문")
    .fill("합성 추가 사실입니다. 반환 약속 메시지를 자료로 보관했습니다.");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.getByText("이 응답은 합성 API 예시", { exact: false })).toBeVisible();
  await page
    .getByRole("navigation", { name: "사건 메뉴" })
    .getByRole("link", { name: /^자료/ })
    .click();
  await page.getByLabel("선택 자료의 자동 처리에 동의합니다.").check();
  await page.getByLabel("업로드할 파일 선택", { exact: true }).setInputFiles({
    name: "합성증거.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("통합 시연용 합성 원본입니다. 실제 사건 자료가 아닙니다."),
  });
  await expect(page.getByRole("heading", { name: "합성증거.txt" })).toBeVisible();
  await expect(page.locator(".workspace-status--ready")).toBeVisible({ timeout: 15000 });
  await page.getByRole("link", { name: "타임라인", exact: true }).click();
  await page.getByRole("button", { name: "일정 추가" }).click();
  for (const viewport of [
    { width: 320, height: 760 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    const modal = await page.getByRole("dialog").boundingBox();
    expect(modal).not.toBeNull();
    expect(Math.abs((modal?.x ?? 0) + (modal?.width ?? 0) / 2 - viewport.width / 2)).toBeLessThan(
      2,
    );
    expect(Math.abs((modal?.y ?? 0) + (modal?.height ?? 0) / 2 - viewport.height / 2)).toBeLessThan(
      2,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("어떤 일이 있었나요?").fill("반환 약속 확인");
  await page.getByLabel("날짜 (모르면 비워 두세요)").fill("2026-10-01");
  await page.getByRole("button", { name: "타임라인 저장" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.reload();
  await expect(page.getByText("2026-10-01", { exact: true })).toBeVisible();
  await page.goto(`${casePath}/reports`);
  await openReportEditor(page);
  await expect(page.getByLabel("리포트 내용 편집")).toBeVisible();
  await openReportOptions(page);
  await expect(page.getByRole("checkbox", { name: "PDF에 근거 사진 포함" })).toBeDisabled();
  await page.getByRole("checkbox", { name: "내용·식별정보·선택한 사진을 확인했어요" }).check();
  const pdfPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF 다운로드", exact: true }).click();
  const pdf = await pdfPromise;
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  await pdf.saveAs(".wrangler/integration-synthetic.pdf");
  await expect(page.getByRole("button", { name: /HTML 다운로드|선택 원본 ZIP/ })).toHaveCount(0);
  await page.screenshot({ path: ".wrangler/customer-integration-390.png", fullPage: true });
  await page.goto("/settings");
  await page.getByRole("button", { name: "사건 삭제", exact: true }).click();
  for (const viewport of [
    { width: 320, height: 760 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    const modal = await page.getByRole("dialog").boundingBox();
    expect(modal).not.toBeNull();
    expect(Math.abs((modal?.x ?? 0) + (modal?.width ?? 0) / 2 - viewport.width / 2)).toBeLessThan(
      2,
    );
    expect(Math.abs((modal?.y ?? 0) + (modal?.height ?? 0) / 2 - viewport.height / 2)).toBeLessThan(
      2,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("삭제 확인 — DELETE 입력").fill("DELETE");
  await page.getByRole("button", { name: "삭제 요청 확인" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.goto(`${casePath}/reports`);
  await expect(page.getByRole("alert")).toBeVisible();
  expect(requests).toEqual([]);
});

test("service screens reflow at phone, tablet and desktop widths", async ({ page }) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
    localStorage.setItem(
      "baro-api-mock-v1:session",
      JSON.stringify({
        user: { id: "responsive-customer", name: "합성 고객", accountType: "customer" },
        needsConsent: false,
      }),
    );
  });
  for (const viewport of [
    { width: 320, height: 760 },
    { width: 390, height: 844 },
    { width: 900, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    for (const path of [
      "/app",
      "/cases",
      "/cases/new",
      "/lawyers",
      "/settings",
      "/help",
      "/policies/terms",
    ]) {
      await page.goto(path);
      await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
      if (path === "/app" || path === "/cases/new")
        await expect(page.getByLabel("지금까지 있었던 일")).toBeEnabled();
      if (path === "/lawyers")
        await expect(page.getByRole("link", { name: "김예시", exact: true })).toBeVisible();
      if (path === "/settings")
        await expect(page.getByRole("button", { name: "다시 확인", exact: true })).toBeEnabled();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
        `${path} at ${viewport.width}`,
      ).toBe(true);
    }
    await page.goto("/help#limits");
    if (viewport.width <= 900) {
      const target = await page.locator("#limits").boundingBox();
      const header = await page.locator(".app-header").boundingBox();
      expect(target?.y).toBeGreaterThanOrEqual((header?.y ?? 0) + (header?.height ?? 0));
    }
  }
});

async function openCustomerHome(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "baro-api-mock-v1:session",
      JSON.stringify({
        user: { id: "synthetic-logout-owner", name: "합성 고객", accountType: "customer" },
        needsConsent: false,
      }),
    );
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");
  await expect(page.getByRole("textbox", { name: "지금까지 있었던 일" })).toBeEnabled();
}
async function logoutFromMenu(page: Page) {
  await page.getByRole("button", { name: "메뉴 열기", exact: true }).click();
  await page
    .getByRole("dialog", { name: "메뉴", exact: true })
    .getByRole("button", { name: "로그아웃", exact: true })
    .click();
}

test("peer logout clears the draft and opens plain login in both tabs", async ({
  page,
  context,
}) => {
  await openCustomerHome(page);
  const draft = page.getByRole("textbox", { name: "지금까지 있었던 일" });
  await draft.fill("로그아웃하면 사라져야 하는 합성 사건 초안입니다.");
  const peer = await context.newPage();
  await peer.setViewportSize({ width: 390, height: 844 });
  await peer.goto("/app");
  await expect(peer.getByRole("textbox", { name: "지금까지 있었던 일" })).toBeEnabled();
  await logoutFromMenu(peer);
  await expect(peer).toHaveURL(/\/login$/);
  await expect(page).toHaveURL(/\/login$/);
  await expect(draft).toHaveCount(0);
  await expect(page.getByRole("radio", { name: /고객/ })).toBeVisible();
});

test("expired session retains the safe return path instead of explicit logout behavior", async ({
  page,
}) => {
  await openCustomerHome(page);
  await page.evaluate(async () => {
    localStorage.setItem(
      "baro-api-mock-v1:session",
      JSON.stringify({ user: null, needsConsent: false }),
    );
    const modulePath = "/src/client/session-events.ts";
    const { notifySessionChanged } = await import(modulePath);
    notifySessionChanged();
  });
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fapp$/);
});

test("logout invalidates pending session reads before an old authenticated result resolves", async ({
  page,
}) => {
  await openCustomerHome(page);
  const draft = page.getByRole("textbox", { name: "지금까지 있었던 일" });
  await draft.fill("늦은 세션 응답이 복원해서는 안 되는 합성 사건 초안입니다.");
  await page.evaluate(async () => {
    const modulePath = "/src/client/api/index.ts";
    const { api } = await import(modulePath);
    const oldSession = await api.session.get(),
      original = api.session.get;
    const pending: Array<(value: typeof oldSession) => void> = [];
    api.session.get = () => new Promise((resolve) => pending.push(resolve));
    window.dispatchEvent(new Event("focus"));
    if (!pending.length) throw new Error("pending session read missing");
    api.session.get = original;
    await api.session.signOut();
    for (const resolve of pending) resolve(oldSession);
  });
  await expect(draft).toHaveCount(0);
  await expect(page.getByRole("button", { name: "저장하고 계속", exact: true })).toHaveCount(0);
  await expect(
    page.getByText("늦은 세션 응답이 복원해서는 안 되는 합성 사건 초안입니다."),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("navigation", { name: "주 메뉴" })
      .getByRole("link", { name: "내 사건", exact: true }),
  ).toHaveCount(0);
});

test("failed logout keeps the session and draft without broadcasting a successful signout", async ({
  page,
}) => {
  await openCustomerHome(page);
  const draft = page.getByRole("textbox", { name: "지금까지 있었던 일" });
  await draft.fill("로그아웃 실패 시 유지할 합성 사건 초안입니다.");
  await page.evaluate(async () => {
    const modulePath = "/src/client/api/mock/runtime.ts";
    const { registerMockHandlers } = await import(modulePath);
    registerMockHandlers({
      "session.signOut": () => {
        throw new Error("synthetic unavailable");
      },
    });
  });
  await logoutFromMenu(page);
  await expect(page.getByRole("alert")).toContainText("로그아웃하지 못했어요");
  await expect(page).toHaveURL(/\/app$/);
  await expect(draft).toHaveValue("로그아웃 실패 시 유지할 합성 사건 초안입니다.");
  expect(await page.evaluate(() => localStorage.getItem("baro-session-changed"))).toBeNull();
});

test("same-tab logout still navigates when cross-tab notification storage is unavailable", async ({
  page,
}) => {
  await openCustomerHome(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "baro-session-changed") throw new Error("synthetic storage unavailable");
      return original.call(this, key, value);
    };
  });
  await logoutFromMenu(page);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("radio", { name: /고객/ })).toBeVisible();
});
