import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { seedMaterialsScenario } from "../helpers/workspace-materials-scenario";

async function ready(page: Page) {
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
}
async function theme(page: Page, mode: "light" | "dark") {
  await page.getByRole("button", { name: "화면 테마 변경", exact: true }).first().click();
  await page
    .getByRole("menuitem", { name: mode === "light" ? "라이트 모드" : "다크 모드", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
}
async function token(page: Page, name: string) {
  return page.evaluate((name) => {
    const probe = document.createElement("i");
    probe.hidden = true;
    probe.style.color = `var(${name})`;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, name);
}
async function contrast(page: Page) {
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(scan.violations.filter((item) => item.id === "color-contrast")).toEqual([]);
}

test("enabled entry, selected purpose and example controls use the current surface palette", async ({
  page,
}) => {
  await seedMaterialsScenario(page);
  await page.goto("/new");
  await expect(page.getByRole("textbox", { name: "지금까지 있었던 일" })).toBeEnabled();
  for (const mode of ["light", "dark"] as const) {
    await theme(page, mode);
    await page.getByRole("textbox", { name: "지금까지 있었던 일" }).fill("");
    const card = await token(page, "--card");
    await expect(page.locator(".conversation-composer")).toHaveCSS("background-color", card);
    await expect(page.locator(".conversation-context label.selected")).toHaveCSS(
      "background-color",
      card,
    );
    const examples = page.locator(".conversation-examples .ui-button");
    await expect(examples).toHaveCount(3);
    for (const example of await examples.all())
      await expect(example).toHaveCSS("background-color", card);
    await page
      .getByRole("textbox", { name: "지금까지 있었던 일" })
      .fill("색상 검증용 합성 사건입니다. 지인에게 빌려준 돈을 돌려받지 못했어요.");
    const submit = page.getByRole("button", { name: "저장하고 계속", exact: true });
    await expect(submit).toBeEnabled();
    await submit.hover();
    await expect(submit).toHaveCSS("background-color", await token(page, "--primary-hover"));
    await expect(submit).toHaveCSS("color", await token(page, "--primary-foreground"));
    await page.mouse.move(0, 0);
    await contrast(page);
  }
});

test("status badges, error and limit icons pair their foreground and surface in both themes", async ({
  page,
}) => {
  await seedMaterialsScenario(page);
  await page.goto("/__design-system");
  await ready(page);
  await expect(page.locator(".ui-badge")).toHaveCount(4);
  for (const mode of ["light", "dark"] as const) {
    await theme(page, mode);
    for (const [tone, ink, surface] of [
      ["primary", "--accent-foreground", "--accent"],
      ["success", "--success", "--success-soft"],
      ["warning", "--warning", "--warning-soft"],
      ["danger", "--destructive", "--danger-soft"],
    ] as const) {
      const badge = page.locator(`.ui-badge--${tone}`);
      await expect(badge).toHaveCSS("color", await token(page, ink));
      await expect(badge).toHaveCSS("background-color", await token(page, surface));
    }
    await expect(page.locator(".ui-state--error .ui-state__icon")).toHaveCSS(
      "background-color",
      await token(page, "--danger-soft"),
    );
    await expect(page.locator(".ui-state--limit .ui-state__icon")).toHaveCSS(
      "background-color",
      await token(page, "--warning-soft"),
    );
    await expect(page.locator(".ui-state--partial .ui-state__icon")).toHaveCSS(
      "background-color",
      await token(page, "--warning-soft"),
    );
    await expect(page.locator(".ui-state--success .ui-state__icon")).toHaveCSS(
      "background-color",
      await token(page, "--success-soft"),
    );
    const danger = page.getByRole("button", { name: "삭제 동작 예시", exact: true });
    await expect(danger).toHaveCSS("color", await token(page, "--destructive-foreground"));
    await danger.hover();
    await expect(danger).toHaveCSS("background-color", await token(page, "--destructive-hover"));
    await page.mouse.move(0, 0);
    await contrast(page);
  }
});

test("dark questions and summary remain readable after answering and confirming", async ({
  page,
}) => {
  await seedMaterialsScenario(page);
  await page.addInitScript(() => localStorage.setItem("baro-theme", "dark"));
  await page.goto("/new");
  await page
    .getByRole("textbox", { name: "지금까지 있었던 일" })
    .fill("색상 검증용 합성 사건입니다. 지인에게 빌려준 돈을 약속한 날짜에 돌려받지 못했어요.");
  await page.getByRole("button", { name: "저장하고 계속", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "이 일은 언제 시작됐나요?", exact: true }),
  ).toBeVisible();
  await contrast(page);
  for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "모름", exact: true }).click();
  await expect(page.getByRole("button", { name: "맞아요", exact: true })).toBeVisible();
  await contrast(page);
  await page.getByRole("button", { name: "맞아요", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "이 내용으로 계속할까요?", exact: true });
  await expect(dialog).toBeVisible();
  await contrast(page);
  await dialog.getByRole("button", { name: "확인하고 계속", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "추가 사실 또는 질문" })).toBeEnabled();
  await contrast(page);
});

test("saved document paper colors stay independent from the surrounding application theme", async ({
  page,
}) => {
  await seedMaterialsScenario(page);
  await page.goto("/cases/synthetic-case/reports");
  await ready(page);
  await page.evaluate(() => {
    const paper = document.createElement("article");
    paper.className = "baro-report";
    const sheet = document.createElement("div");
    sheet.className = "sheet";
    sheet.textContent = "합성 저장 문서의 출력 팔레트";
    paper.appendChild(sheet);
    document.querySelector("main")!.appendChild(paper);
  });
  for (const mode of ["light", "dark"] as const) {
    await theme(page, mode);
    const paper = page.locator(".baro-report");
    await expect(paper).toHaveCSS("color-scheme", "light");
    await expect(paper).toHaveCSS("color", "rgb(25, 31, 40)");
    await expect(paper.locator(".sheet")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  }
});

test("report primary download keeps paired colors on hover in both themes", async ({ page }) => {
  await seedMaterialsScenario(page);
  await page.goto("/new");
  await page
    .getByRole("textbox", { name: "지금까지 있었던 일" })
    .fill(
      "리포트 색상 검증용 합성 사건입니다. 반환 약속과 자료를 정리하며 확인하지 못한 내용은 모른다고 남깁니다.",
    );
  await page.getByRole("button", { name: "저장하고 계속", exact: true }).click();
  for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "모름", exact: true }).click();
  await page.getByRole("button", { name: "맞아요", exact: true }).click();
  await page
    .getByRole("dialog", { name: "이 내용으로 계속할까요?", exact: true })
    .getByRole("button", { name: "확인하고 계속", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "추가 사실 또는 질문" })).toBeEnabled();
  await page.goto(new URL(page.url()).pathname + "/reports");
  await ready(page);
  await expect(page.locator(".report-review")).toHaveAttribute("aria-busy", "false");
  const prepare = page.getByRole("button", { name: "리포트 준비", exact: true });
  if (await prepare.isVisible()) await prepare.click();
  const download = page.getByRole("button", { name: "PDF 다운로드", exact: true });
  await expect(download).toBeEnabled();
  for (const mode of ["light", "dark"] as const) {
    await theme(page, mode);
    await download.hover();
    await expect(download).toHaveCSS("background-color", await token(page, "--primary-hover"));
    await expect(download).toHaveCSS("color", await token(page, "--primary-foreground"));
    await contrast(page);
  }
});

test("social login actions keep equal heights on narrow phones in both themes", async ({
  page,
}) => {
  await page.goto("/login");
  const providers = page.locator(".login-provider");
  await expect(providers).toHaveCount(3);
  for (const provider of await providers.all()) await expect(provider).toBeEnabled();
  for (const mode of ["light", "dark"] as const) {
    await theme(page, mode);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const heights = await providers.evaluateAll((buttons) =>
        buttons.map((button) => Math.round(button.getBoundingClientRect().height)),
      );
      expect(new Set(heights).size).toBe(1);
      expect(heights[0]).toBeGreaterThanOrEqual(44);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
        .toBeLessThanOrEqual(0);
    }
  }
});

test("case navigation remains reachable across the tablet breakpoint in both themes", async ({
  page,
}) => {
  await seedMaterialsScenario(page);
  await page.goto("/new");
  await ready(page);
  for (const mode of ["light", "dark"] as const) {
    await theme(page, mode);
    for (const width of [767, 768, 844, 900, 901]) {
      await page.setViewportSize({ width, height: 900 });
      const menu = page.getByRole("button", { name: "메뉴 열기", exact: true });
      const profile = page.locator(".sidebar-desktop .sidebar-profile");
      if (width === 767) {
        await expect(profile).toBeHidden();
        await expect(menu).toBeVisible();
        await menu.click();
        await expect(
          page.getByRole("dialog", { name: "메뉴", exact: true }).locator(".sidebar-profile"),
        ).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(menu).toBeFocused();
      } else {
        await expect(menu).toBeHidden();
        await expect(profile).toBeVisible();
        await expect(
          page.locator(".sidebar-desktop").getByRole("link", { name: "새 사건 입력", exact: true }),
        ).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  }
});
