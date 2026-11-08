import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function openFoundation(page: Page) {
  await page.route("**/api/me/session", (route) =>
    route.fulfill({
      json: {
        user: { id: "synthetic-owner", name: "합성 계정", accountType: "lawyer" },
        needsConsent: false,
      },
    }),
  );
  for (const pattern of ["**/api/cases?*", "**/api/v2/cases?*"])
    await page.route(pattern, (route) => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.goto("/__design-foundation");
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "사건 작업", exact: true })).toBeVisible();
}

test("retained task navigation preserves unsent text, local File selection and draft edits without requests", async ({
  page,
}) => {
  await openFoundation(page);
  const nav = page.getByRole("navigation", { name: "사건 작업", exact: true });
  const requests: string[] = [];
  page.on("request", (request) => {
    // File-picker focus can refresh the shell's session/list reads. Tasks must
    // never generate, upload, save or call their own API when merely opened.
    const path = new URL(request.url()).pathname;
    const shellRead =
      request.method() === "GET" &&
      ["/api/me/session", "/api/cases", "/api/v2/cases"].includes(path);
    if (path.startsWith("/api/") && !shellRead) requests.push(`${request.method()} ${path}`);
  });
  await nav.getByRole("link", { name: "대화", exact: true }).click();
  await page.getByLabel("이어서 설명할 내용").fill("유지할 미전송 합성 문장");
  await page.getByLabel("보내기 전 첨부 선택").setInputFiles({
    name: "합성자료.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("synthetic only"),
  });
  await nav.getByRole("link", { name: "문서 초안", exact: true }).click();
  await page.getByLabel("초안 본문").fill("아직 저장하지 않은 합성 초안");
  await nav.getByRole("link", { name: "리포트", exact: true }).click();
  await expect(page.getByLabel("초안 본문")).not.toBeVisible();
  await nav.getByRole("link", { name: "대화", exact: true }).click();
  await expect(page.getByLabel("이어서 설명할 내용")).toHaveValue("유지할 미전송 합성 문장");
  expect(
    await page
      .getByLabel("보내기 전 첨부 선택")
      .evaluate((input: HTMLInputElement) => input.files?.[0]?.name),
  ).toBe("합성자료.txt");
  await nav.getByRole("link", { name: "문서 초안", exact: true }).click();
  await expect(page.getByLabel("초안 본문")).toHaveValue("아직 저장하지 않은 합성 초안");
  expect(requests).toEqual([]);
  await expect(nav.getByRole("link", { name: "문서 초안", exact: true })).toHaveAttribute(
    "href",
    "/cases/synthetic-foundation/reports#document-drafts",
  );
});

test("single acknowledgement dialog has one action, keyboard containment and focus restoration", async ({
  page,
}) => {
  await openFoundation(page);
  const opener = page.getByRole("button", { name: "변호사와 해결", exact: true });
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "아직 지원하지 않는 기능이에요", exact: true });
  await expect(dialog.getByRole("button")).toHaveCount(1);
  const confirm = dialog.getByRole("button", { name: "확인", exact: true });
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(confirm).toBeFocused();
  await expect(dialog).toContainText("현재 변호사 연결 기능은 제공하지 않습니다.");
  await confirm.click();
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
  await opener.press("Enter");
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
});

test("evidence panel preserves its field across inline and modal resize and closes to opener", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openFoundation(page);
  const opener = page.getByRole("button", { name: "근거 열기", exact: true });
  await opener.click();
  const panel = page.getByRole("dialog", { name: "근거 확인", exact: true });
  await expect(panel).toBeVisible();
  await page.getByLabel("근거 메모").fill("자료의 위치를 검토 중");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel).toBeVisible();
  expect(await panel.evaluate((node) => node.matches(":modal"))).toBe(true);
  await expect(page.getByLabel("근거 메모")).toHaveValue("자료의 위치를 검토 중");
  await page.keyboard.press("Escape");
  await expect(panel).not.toBeVisible();
  await expect(opener).toBeFocused();
});

for (const width of [320, 390, 768, 1024, 1440, 1920]) {
  test(`long Korean content reflows at ${width}px with accessible controls`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openFoundation(page);
    const title = page.getByRole("heading", { level: 1 });
    expect(
      await title.evaluate(
        (node) =>
          node.scrollHeight <= node.clientHeight + 1 &&
          getComputedStyle(node).whiteSpace !== "nowrap",
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    const nav = page.getByRole("navigation", { name: "사건 작업", exact: true });
    await expect(nav.getByRole("link")).toHaveCount(4);
    expect(await nav.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await nav.getByRole("link", { name: /자료/ }).click();
    const table = page.getByRole("region", { name: "합성 자료 비교" });
    await table.focus();
    await expect(table).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await expect(page.getByRole("link", { name: "변호사 찾기" })).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `.wrangler/design-foundation-${width}.png`, fullPage: true });
  });
}

test("200% zoom, sidebar preference and reduced motion remain supported", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openFoundation(page);
  await page.getByRole("button", { name: "사이드바 접기", exact: true }).click();
  await page.reload();
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await expect(page.locator("[data-app-workspace]")).toHaveAttribute(
    "data-sidebar-collapsed",
    "true",
  );
  await page.getByRole("button", { name: "사이드바 펼치기", exact: true }).click();
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator(".ui-button")
      .first()
      .evaluate((node) => Number.parseFloat(getComputedStyle(node).transitionDuration)),
  ).toBeLessThan(0.01);
  await page.screenshot({ path: ".wrangler/design-foundation-200.png", fullPage: true });
});
