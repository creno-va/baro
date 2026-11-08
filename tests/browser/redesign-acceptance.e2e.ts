import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  closeMaterials,
  openMaterials,
  openRedesignConversation,
  prepareRedesignReport,
  redesignResolution,
  seedRedesignCase,
  syntheticCaseId,
  unsentMessage,
} from "../helpers/redesign-fixture";

test.beforeEach(async ({ page }) => {
  await seedRedesignCase(page);
});

test("reading the report route does not generate or save a report", async ({ page }) => {
  await page.goto(`/cases/${syntheticCaseId}/reports?mode=conversation`);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "리포트 준비", exact: true })).toBeVisible();
  const stored = await page.evaluate(() => ({
    reports: localStorage.getItem("baro-api-mock-v1:reports"),
    receipts: localStorage.getItem("baro-api-mock-v1:reworkReceipts"),
  }));
  expect(stored.reports === null || stored.reports === "{}").toBe(true);
  expect(stored.receipts === null || stored.receipts === "{}").toBe(true);
});

test("lawyer action only opens the exact unsupported modal and preserves selection", async ({
  page,
}, info) => {
  await prepareRedesignReport(page);
  const resolution = redesignResolution(page);
  const self = resolution.getByRole("button", { name: /^직접 해결/ });
  await self.click();
  await expect(self).toHaveAttribute("aria-pressed", "true");
  const readSelection = () =>
    page.evaluate((id) => {
      const state = JSON.parse(localStorage.getItem("baro-api-mock-v1:reworkResolutions") ?? "{}")[
        id
      ];
      return state
        ? {
            revision: state.revision,
            selection: state.selection,
            selectedFileIds: state.selectedFileIds,
            maskIdentifiers: state.maskIdentifiers,
            draft: state.draft,
          }
        : null;
    }, syntheticCaseId);
  const before = {
    stored: await readSelection(),
    selfPressed: await self.getAttribute("aria-pressed"),
  };
  const requests: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() !== "GET" ||
      !new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/)
    )
      requests.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  const lawyer = resolution.getByRole("button", { name: /^변호사와 해결/ });
  await lawyer.focus();
  await page.keyboard.press("Enter");
  await expect
    .poll(
      async () =>
        (await page
          .getByRole("dialog", { name: "아직 지원하지 않는 기능이에요", exact: true })
          .isVisible()) || (await lawyer.getAttribute("aria-pressed")) === "true",
    )
    .toBe(true);
  const after = {
    stored: await readSelection(),
    selfPressed: await self.getAttribute("aria-pressed"),
  };
  await info.attach("selection-before-after", {
    body: JSON.stringify({ before, after, requests }),
    contentType: "application/json",
  });
  await info.attach("lawyer-action", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  const dialog = page.getByRole("dialog", { name: "아직 지원하지 않는 기능이에요", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("현재 변호사 연결 기능은 제공하지 않습니다.");
  await dialog.getByRole("button", { name: "확인", exact: true }).click();
  await expect(lawyer).toBeFocused();
  expect({
    stored: await readSelection(),
    selfPressed: await self.getAttribute("aria-pressed"),
  }).toEqual(before);
  expect(after).toEqual(before);
  expect(requests).toEqual([]);
});

test("all four case tasks remain discoverable with materials closed", async ({ page }) => {
  await openRedesignConversation(page);
  await closeMaterials(page);
  for (const name of ["대화", "자료", "리포트", "문서 초안"]) {
    const task = page
      .getByRole("link", { name, exact: true })
      .or(page.getByRole("button", { name, exact: true }));
    await expect(task, `${name} must be a directly available case task`).toBeVisible();
  }
});

test("switching case tasks keeps unsent text and unuploaded bytes", async ({ page }) => {
  await openRedesignConversation(page);
  await closeMaterials(page);
  const input = page.getByRole("textbox", { name: "추가 사실 또는 질문", exact: true });
  await input.fill(unsentMessage);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "사진·파일 첨부", exact: true }).click();
  await (await chooser).setFiles({
    name: "전환-전-선택한-합성파일.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("복구했다고 표시하려면 이 바이트를 실제로 유지해야 합니다."),
  });
  const warnings: string[] = [];
  page.on("dialog", async (dialog) => {
    warnings.push(dialog.type());
    await dialog.dismiss();
  });
  for (const name of ["자료", "리포트", "문서 초안", "대화"]) {
    await page
      .getByRole("link", { name, exact: true })
      .or(page.getByRole("button", { name, exact: true }))
      .click();
  }
  expect(warnings).toEqual([]);
  await expect(input).toHaveValue(unsentMessage);
  await expect(page.locator(".workspace-composer")).toContainText("전환-전-선택한-합성파일.txt");
  await expect(page.locator(".workspace-message--user")).toHaveCount(0);
  const files = await page.evaluate(
    (id) => JSON.parse(localStorage.getItem("baro-api-mock-v1:files") ?? "{}")[id] ?? [],
    syntheticCaseId,
  );
  expect(files).toHaveLength(0);
});

for (const width of [320, 390, 768, 1024, 1440, 1920]) {
  test(`actual pages remain operable at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await openRedesignConversation(page);
    await closeMaterials(page);
    const input = page.getByRole("textbox", { name: "추가 사실 또는 질문", exact: true });
    await input.fill(unsentMessage);
    const panel = await openMaterials(page);
    await expect(panel.getByRole("button", { name: "파일 선택", exact: true })).toBeEnabled();
    await closeMaterials(page);
    await expect(input).toHaveValue(unsentMessage);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await expect(input).toBeInViewport();
    await info.attach(`conversation-${width}`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await input.fill("");
    await page.goto(`/cases/${syntheticCaseId}/reports?mode=conversation`);
    await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await info.attach(`report-state-${width}`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });
}

test("unuploaded attachment and unsent message survive material-panel round trip without submission", async ({
  page,
}) => {
  await openRedesignConversation(page);
  await closeMaterials(page);
  const input = page.getByRole("textbox", { name: "추가 사실 또는 질문", exact: true });
  await input.fill(unsentMessage);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /첨부/ }).first().click();
  await (await chooser).setFiles({
    name: "합성-아직-업로드하지-않은-원문.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("실제 인물이 없는 검수용 원문입니다."),
  });
  await openMaterials(page);
  await closeMaterials(page);
  await expect(input).toHaveValue(unsentMessage);
  await expect(page.locator(".workspace-composer")).toContainText(
    "합성-아직-업로드하지-않은-원문.txt",
  );
  await expect(page.locator(".workspace-message--user")).toHaveCount(0);
  const files = await page.evaluate(
    (id) => JSON.parse(localStorage.getItem("baro-api-mock-v1:files") ?? "{}")[id] ?? [],
    syntheticCaseId,
  );
  expect(files).toHaveLength(0);
});

test("cancelled page navigation preserves the unsent message", async ({ page }) => {
  await openRedesignConversation(page);
  await closeMaterials(page);
  const input = page.getByRole("textbox", { name: "추가 사실 또는 질문", exact: true });
  await input.fill(unsentMessage);
  let warnings = 0;
  page.on("dialog", async (dialog) => {
    warnings++;
    await dialog.dismiss();
  });
  await page.getByRole("link", { name: "설정", exact: true }).click({ noWaitAfter: true });
  await expect(input).toHaveValue(unsentMessage);
  expect(warnings).toBe(1);
  await expect(page).toHaveURL(new RegExp(`/cases/${syntheticCaseId}$`));
});

test("conversation entry has no serious accessibility violations", async ({ page }) => {
  await openRedesignConversation(page);
  await closeMaterials(page);
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? ""))).toEqual(
    [],
  );
});

test("existing lawyer account can use its own ordinary case", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await seedRedesignCase(page, "lawyer");
  await openRedesignConversation(page);
  await page.getByRole("textbox", { name: "추가 사실 또는 질문", exact: true }).fill(unsentMessage);
  await expect(page.getByRole("button", { name: "보내기", exact: true })).toBeEnabled();
  await context.close();
});
