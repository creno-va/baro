import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { chooseOption } from "../helpers/headless-controls";
import {
  countMaterialsRequests,
  materialsCasePath,
  seedMaterialsScenario,
} from "../helpers/workspace-materials-scenario";

async function ready(page: Page) {
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
}
async function theme(page: Page, value: "light" | "dark" | "system") {
  await page.getByRole("button", { name: "화면 테마 변경", exact: true }).first().click();
  await page
    .getByRole("menuitem", {
      name: value === "light" ? "라이트 모드" : value === "dark" ? "다크 모드" : "시스템 설정",
      exact: true,
    })
    .click();
}
test("theme follows system, persists a choice, synchronizes tabs and preserves the current input", async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await seedMaterialsScenario(page);
  await page.goto("/new");
  await ready(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const input = page.getByRole("textbox", { name: "지금까지 있었던 일" });
  await input.fill("테마를 바꿔도 유지할 합성 사건 초안입니다.");
  await theme(page, "light");
  await expect(input).toHaveValue("테마를 바꿔도 유지할 합성 사건 초안입니다.");
  await page.reload();
  await ready(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const peer = await context.newPage();
  await peer.goto("/new");
  await ready(peer);
  await theme(page, "dark");
  await expect(peer.locator("html")).toHaveAttribute("data-theme", "dark");
  await theme(page, "system");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
test("theme still changes when optional preference storage is blocked", async ({ page }) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem,
      set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key === "baro-theme") throw new DOMException("blocked", "SecurityError");
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === "baro-theme") throw new DOMException("blocked", "SecurityError");
      return set.call(this, key, value);
    };
  });
  await seedMaterialsScenario(page);
  await page.goto("/new");
  await ready(page);
  await theme(page, "dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await theme(page, "light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("textbox", { name: "지금까지 있었던 일" })).toBeEnabled();
});
for (const path of [
  "/new",
  materialsCasePath,
  "/settings",
  "/help",
  "/policies/terms",
  materialsCasePath + "/reports",
]) {
  test(`custom controls, both themes and responsive accessibility: ${path}`, async ({ page }) => {
    await seedMaterialsScenario(page);
    await page.goto(path);
    await ready(page);
    for (const mode of ["light", "dark"] as const) {
      await theme(page, mode);
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
          .toBeLessThanOrEqual(0);
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(
        page.locator("select,dialog,details,progress,input[type=checkbox],input[type=radio]"),
      ).toHaveCount(0);
      const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(scan.violations).toEqual([]);
    }
  });
}
test("listbox selection uses the shared portal and returns keyboard focus without native selects", async ({
  page,
}) => {
  await seedMaterialsScenario(page);
  await page.goto(materialsCasePath + "/timeline");
  await ready(page);
  await theme(page, "dark");
  await page.getByRole("button", { name: "일정 추가", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "타임라인 추가", exact: true });
  const select = dialog.getByLabel("날짜를 얼마나 기억하시나요?");
  await chooseOption(select, "month");
  await expect(select).toHaveAttribute("data-value", "month");
  await select.click();
  const list = page.getByRole("listbox");
  await expect(list).toHaveCSS("background-color", "rgb(34, 39, 49)");
  await page.keyboard.press("Escape");
  await expect(select).toBeFocused();
  await expect(page.locator("select,dialog")).toHaveCount(0);
});
test("discard confirmation preserves edits and revokes an old owner decision without executing work", async ({
  page,
}) => {
  await seedMaterialsScenario(page);
  await page.goto(materialsCasePath);
  await ready(page);
  await countMaterialsRequests(page);
  await page.getByRole("tab", { name: /^자료/ }).click();
  await page
    .locator(".workspace-file-list > li")
    .first()
    .getByRole("button", { name: "자료 확인", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "자료 확인", exact: true });
  const field = editor.getByRole("textbox", { name: "확인·교정한 내용" });
  await field.fill("확인창 취소 뒤에도 남길 합성 교정입니다.");
  await editor.getByRole("button", { name: "자료 목록", exact: true }).click();
  const confirmation = page.getByRole("dialog", {
    name: "작성한 내용을 확인해 주세요",
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "계속 작성하기", exact: true }).click();
  await expect(field).toHaveValue("확인창 취소 뒤에도 남길 합성 교정입니다.");
  await editor.getByRole("button", { name: "자료 목록", exact: true }).click();
  await expect(confirmation).toBeVisible();
  await page.evaluate(() => {
    const key = "baro-api-mock-v1:session",
      value = JSON.stringify({
        user: { id: "headless-other-owner", name: "다른 합성 사용자", accountType: "customer" },
        needsConsent: false,
      });
    localStorage.setItem(key, value);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
  });
  await expect(confirmation).not.toBeVisible();
  await expect(page.getByRole("textbox", { name: "확인·교정한 내용" })).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { materialsRequestCounts: { action: number; send: number } })
          .materialsRequestCounts,
    ),
  ).toMatchObject({ action: 0, send: 0 });
});
test("stored dark preference leaves landing light and anonymous login usable", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("baro-theme", "dark");
    localStorage.setItem(
      "baro-api-mock-v1:session",
      JSON.stringify({ user: null, needsConsent: false }),
    );
  });
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveAttribute("data-baro-ui", "");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("막막했던 법률 문제");
  await page.goto("/login");
  await ready(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".login-provider")).toHaveCount(3);
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(scan.violations).toEqual([]);
});
