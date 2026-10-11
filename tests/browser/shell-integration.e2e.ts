import { expect, type Page, test } from "@playwright/test";
import { openReportOptions } from "../helpers/report-controls";

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
  await page.getByRole("link", { name: "내 화면으로 계속하기" }).click();
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

test("customer completes intake workspace original ZIP report and cascading deletion on one product UI", async ({
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
  await page.getByRole("link", { name: "내 화면으로 계속하기" }).click();
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
  await page.getByLabel("어떤 일이 있었나요?").fill("반환 약속 확인");
  await page.getByLabel("날짜 (모르면 비워 두세요)").fill("2026-10-01");
  await page.getByRole("button", { name: "타임라인 저장" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.reload();
  await expect(page.getByText("2026-10-01", { exact: true })).toBeVisible();
  await page.goto(`${casePath}/reports`);
  await expect(page.getByLabel("리포트 내용 편집")).toBeVisible();
  await openReportOptions(page);
  await page.getByRole("checkbox", { name: "ZIP에 원본 포함" }).check();
  await page.getByRole("checkbox", { name: "내용·식별정보·선택한 원본을 확인했어요" }).check();
  const pdfPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF 다운로드", exact: true }).click();
  const pdf = await pdfPromise;
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  await pdf.saveAs(".wrangler/integration-synthetic.pdf");
  const zipPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "선택 원본 ZIP (1)" }).click();
  const zip = await zipPromise;
  await zip.saveAs(".wrangler/integration-synthetic.zip");
  await page.screenshot({ path: ".wrangler/customer-integration-390.png", fullPage: true });
  await page.goto("/settings");
  await page.getByRole("button", { name: "사건 삭제", exact: true }).click();
  await page.getByLabel("삭제 확인 — DELETE 입력").fill("DELETE");
  await page.getByRole("button", { name: "삭제 요청 확인" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.goto(`${casePath}/reports`);
  await expect(page.getByRole("alert")).toBeVisible();
  expect(requests).toEqual([]);
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
