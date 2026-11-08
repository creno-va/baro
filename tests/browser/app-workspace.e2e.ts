import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function seed(page: Page, role: "customer" | "lawyer" = "customer", empty = false) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(
    ({ role, empty }) => {
      if (localStorage.getItem("shell-seeded")) return;
      localStorage.setItem("shell-seeded", "1");
      const item = {
        id: "shell-case",
        title: "보증금을 돌려받기 위해 차근차근 정리하는 아주 긴 사건 제목",
        schemaVersion: "2",
        stage: "active",
        revision: 1,
        updatedAt: new Date().toISOString(),
        summary: "합성 사건입니다.",
      };
      const values = {
        session: {
          user: { id: "shell-owner", name: "합성 이용자", accountType: role },
          needsConsent: false,
        },
        cases: empty ? {} : { "shell-case": item },
        caseOwners: { "shell-case": "shell-owner" },
      };
      for (const [key, value] of Object.entries(values))
        localStorage.setItem(`baro-api-mock-v1:${key}`, JSON.stringify(value));
    },
    { role, empty },
  );
}

test("long review sheets scroll internally, keep 44px controls and return focus through each close path", async ({
  page,
}) => {
  await seed(page);
  for (const [width, height] of [
    [320, 480],
    [390, 844],
    [1440, 900],
  ]) {
    await page.setViewportSize({ width: width ?? 320, height: height ?? 480 });
    await page.goto("/?longReview&open");
    await page.evaluate(() => document.fonts.ready);
    const panel = page.getByRole("dialog", { name: "자료", exact: true });
    const opener = panel.getByRole("button", { name: "독립 자료 검토창", exact: true });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "독립 자료 검토", exact: true });
    await expect(dialog).toBeVisible();
    await expect
      .poll(() =>
        dialog.evaluate((node) =>
          node.getAnimations().every((animation) => animation.playState === "finished"),
        ),
      )
      .toBe(true);
    const bounds = await dialog.boundingBox();
    if (!bounds) throw new Error("Synthetic long review missing");
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width ?? 320);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(height ?? 480);
    // Dialog is centred at every width; the distinct Sheet component owns edge anchoring.
    const verticalAnchor = bounds.y + bounds.height / 2 - (height ?? 480) / 2;
    expect(Math.abs(verticalAnchor)).toBeLessThan(2);
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    const close = dialog.getByRole("button", { name: "닫기", exact: true });
    const finish = dialog.getByRole("button", { name: "검토 닫기", exact: true });
    for (const button of [close, finish]) {
      const target = await button.boundingBox();
      expect(target?.width).toBeGreaterThanOrEqual(44);
      expect(target?.height).toBeGreaterThanOrEqual(44);
    }
    const headerBefore = await close.boundingBox();
    const content = dialog.locator(".ui-dialog__content");
    expect(await content.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    await content.hover();
    await page.mouse.wheel(0, 900);
    await expect.poll(() => content.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await finish.scrollIntoViewIfNeeded();
    await content.hover();
    await page.mouse.wheel(0, 100000);
    await expect
      .poll(() =>
        content.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop),
      )
      .toBe(0);
    const geometry = await finish.evaluate((node) => {
      const target = node.getBoundingClientRect();
      const scroller = node.closest(".ui-dialog__content");
      if (!scroller) throw new Error("Synthetic review scrollport missing");
      const port = scroller.getBoundingClientRect();
      // Sample the button interior: rounded border corners are intentionally
      // outside its hit shape, even when no other control overlaps it.
      const hits = [0.25, 0.5, 0.75].flatMap((x) =>
        [0.25, 0.5, 0.75].map((y) =>
          node.contains(
            document.elementFromPoint(
              target.left + target.width * x,
              target.top + target.height * y,
            ),
          ),
        ),
      );
      return {
        devicePixelRatio,
        button: target.toJSON(),
        scrollport: port.toJSON(),
        scrollTop: scroller.scrollTop,
        clientHeight: scroller.clientHeight,
        scrollHeight: scroller.scrollHeight,
        maxScroll: scroller.scrollHeight - scroller.clientHeight,
        clipped: Math.max(
          0,
          port.left - target.left,
          port.top - target.top,
          target.right - port.right,
          target.bottom - port.bottom,
        ),
        hits,
      };
    });
    await test.info().attach(`long-review-geometry-${width}`, {
      body: JSON.stringify(geometry, null, 2),
      contentType: "application/json",
    });
    await page.screenshot({ path: `.wrangler/ui01-full/long-review-end-${width}.png` });
    await expect(finish).toBeInViewport({ ratio: 1 });
    expect(geometry.clipped).toBe(0);
    expect(geometry.button.width).toBeGreaterThanOrEqual(44);
    expect(geometry.button.height).toBeGreaterThanOrEqual(44);
    expect(geometry.hits).toEqual(Array(9).fill(true));
    expect(geometry.button.left).toBeGreaterThanOrEqual(0);
    expect(geometry.button.top).toBeGreaterThanOrEqual(0);
    expect(geometry.button.right).toBeLessThanOrEqual(width ?? 320);
    expect(geometry.button.bottom).toBeLessThanOrEqual(height ?? 480);
    await expect(close).toBeInViewport({ ratio: 1 });
    expect(await close.boundingBox()).toEqual(headerBefore);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await finish.focus();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(finish).toBeFocused();
    await page.screenshot({ path: `.wrangler/ui01-full/long-review-${width}.png` });
    await page.keyboard.press("Enter");
    await expect(dialog).not.toBeVisible();
    await expect(opener).toBeFocused();
    for (const dismissal of ["finish", "close", "escape"]) {
      await opener.click();
      await expect(dialog).toBeVisible();
      if (dismissal === "finish") await finish.click();
      else if (dismissal === "close") await close.click();
      else await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(opener).toBeFocused();
      await expect(panel).toBeVisible();
    }
  }
});

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`frame keeps mounted drafts and independent scroll at ${width}px`, async ({ page }) => {
    await seed(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const composer = page.getByRole("textbox", { name: "메시지 초안" });
    await composer.fill("한글로 쓰던 메시지와 첨부 선택은 소비자가 보존합니다.");
    await page.getByRole("button", { name: "자료 열기", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "자료", exact: true });
    await expect(panel).toBeVisible();
    expect(await panel.evaluate((node) => node.matches(":modal"))).toBe(width < 1200);
    const correction = panel.getByRole("textbox", { name: "자료 교정 초안" });
    await correction.fill("작성 중인 자료 교정");
    await page.screenshot({
      path: `.wrangler/ui01/frame-panel-${width}.png`,
      animations: "disabled",
    });
    await correction.press("ArrowLeft");
    const selection = await correction.evaluate((node: HTMLInputElement) => node.selectionStart);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(panel).toBeVisible();
    await expect(correction).toHaveValue("작성 중인 자료 교정");
    expect(await correction.evaluate((node: HTMLInputElement) => node.selectionStart)).toBe(
      selection,
    );
    await page.setViewportSize({ width, height: 900 });
    await panel.getByRole("button", { name: "자료 패널 닫기" }).click();
    await expect(page.getByRole("button", { name: "자료 열기", exact: true })).toBeFocused();
    await expect(composer).toHaveValue("한글로 쓰던 메시지와 첨부 선택은 소비자가 보존합니다.");
    await page.getByRole("button", { name: "자료 열기", exact: true }).click();
    await expect(correction).toHaveValue("작성 중인 자료 교정");
    if (width < 1200) {
      await correction.press("Escape");
      await expect(panel).not.toBeVisible();
      await expect(page.getByRole("button", { name: "자료 열기", exact: true })).toBeFocused();
    } else await panel.getByRole("button", { name: "자료 패널 닫기" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    const bounds = await composer.boundingBox();
    expect(bounds?.y).toBeGreaterThan(0);
    expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(901);
    await page.screenshot({ path: `.wrangler/ui01/frame-${width}.png`, animations: "disabled" });
  });
}

test("nested modal Escape and focus stay inside the materials overlay", async ({ page }) => {
  await seed(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const opener = page.getByRole("button", { name: "자료 열기", exact: true });
  await opener.click();
  const panel = page.getByRole("dialog", { name: "자료", exact: true });
  const nestedOpener = panel.getByRole("button", { name: "자료 확인창", exact: true });
  await nestedOpener.click();
  const nested = page.getByRole("dialog", { name: "합성 자료 확인", exact: true });
  await expect(nested).toBeVisible();
  // Native close is queued after the controlled open=false update. Wait for
  // that event before starting another focus operation in the parent panel.
  await nested.evaluate((node) =>
    node.addEventListener("close", () => node.setAttribute("data-native-closed", "true"), {
      once: true,
    }),
  );
  await page.keyboard.press("Escape");
  await expect(page.locator('dialog[data-native-closed="true"]')).toHaveCount(1);
  await expect(nested).not.toBeVisible();
  await expect(panel).toBeVisible();
  await expect(nestedOpener).toBeFocused();
  const close = panel.getByRole("button", { name: "자료 패널 닫기" });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(panel.getByRole("link", { name: "리포트 열기" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel).not.toBeVisible();
  await expect(opener).toBeFocused();
});

test("four visible tasks and secondary tools retain every existing route", async ({ page }) => {
  await seed(page);
  await page.goto("/");
  await expect(page.locator(".workspace-tabs")).toHaveCount(0);
  const trigger = page.locator(".case-tools > summary");
  await trigger.focus();
  await page.keyboard.press("Enter");
  const tools = page.getByRole("navigation", { name: "사건 도구", exact: true });
  for (const [label, suffix] of [
    ["요약 보기 · 재확인", "summary"],
    ["타임라인", "timeline"],
    ["다음 행동", "actions"],
    ["유사 판례", "precedents"],
  ] as const) {
    await expect(tools.getByRole("link", { name: label, exact: label !== "자료" })).toHaveAttribute(
      "href",
      `/cases/shell-case/${suffix}`,
    );
  }
  const tasks = page.getByRole("navigation", { name: "사건 작업", exact: true });
  for (const [label, suffix] of [
    ["대화", ""],
    ["자료", "/files"],
    ["리포트", "/reports"],
    ["문서 초안", "/reports#document-drafts"],
  ]) {
    await expect(tasks.getByRole("link", { name: label, exact: label !== "자료" })).toHaveAttribute(
      "href",
      `/cases/shell-case${suffix}`,
    );
  }
  await page.keyboard.press("Escape");
  await expect(tools).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test("sidebar collapse keeps role navigation, recent management and resize focus", async ({
  page,
}) => {
  await seed(page, "lawyer");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const sidebar = page.locator(".sidebar-desktop");
  await expect(sidebar.getByRole("link", { name: "변호사 프로필", exact: true })).toHaveCount(0);
  await expect(sidebar.getByRole("link", { name: "새 사건 입력", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "변호사 찾기", exact: true })).toHaveCount(0);
  await expect(sidebar.getByRole("link", { name: "설정", exact: true })).toBeVisible();
  await expect(sidebar.locator(".sidebar-story")).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "사이드바 접기" }).click();
  await expect(page.locator(".app-header")).toHaveCSS("width", "64px");
  await sidebar.getByRole("button", { name: "최근 사건 열기" }).click();
  const drawer = page.getByRole("dialog", { name: "메뉴", exact: true });
  await expect(drawer.locator(".sidebar-story")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sidebar.getByRole("button", { name: "최근 사건 열기" })).toBeFocused();
  await page.reload();
  await expect(page.locator(".app-header")).toHaveCSS("width", "64px");
  await page.getByRole("button", { name: "사이드바 펼치기" }).focus();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "메뉴 열기" })).toBeFocused();
  await expect(page.locator(".app-frame")).toHaveCSS("padding-left", "0px");
  const menu = page.getByRole("button", { name: "메뉴 열기" });
  await menu.click();
  await expect(drawer).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(drawer).not.toBeVisible();
  await expect(page.getByRole("button", { name: "사이드바 펼치기" })).toBeFocused();
});

test("rename, deletion cancellation and owner change preserve session guards", async ({ page }) => {
  await seed(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const sidebar = page.locator(".sidebar-desktop");
  const edit = sidebar.locator(".sidebar-story-edit");
  await sidebar.locator(".sidebar-story-row").hover();
  await edit.click();
  const rename = page.getByRole("dialog", { name: "사건 제목 수정", exact: true });
  await rename.getByRole("textbox", { name: "제목", exact: true }).fill("수정한 사건 제목");
  await rename.getByRole("button", { name: "저장", exact: true }).click();
  await expect(rename).not.toBeVisible();
  await expect(sidebar.locator(".sidebar-story")).toHaveText("수정한 사건 제목");
  await sidebar.locator(".sidebar-story-row").hover();
  const remove = sidebar.locator(".sidebar-story-delete");
  await remove.click();
  await page.keyboard.press("Escape");
  await expect(remove).toBeFocused();
  await expect(sidebar.locator(".sidebar-story")).toBeVisible();
  await sidebar.locator(".sidebar-story-row").hover();
  await edit.click();
  await page.evaluate(() => {
    localStorage.setItem(
      "baro-api-mock-v1:session",
      JSON.stringify({
        user: { id: "other-owner", name: "다른 합성 이용자", accountType: "customer" },
        needsConsent: false,
      }),
    );
    window.dispatchEvent(new Event("baro-session-changed"));
  });
  await expect(rename).not.toBeVisible();
  await expect(sidebar.locator(".sidebar-story")).toHaveCount(0);
});

test("empty list, no panel and document reading remain useful and accessible", async ({ page }) => {
  await seed(page, "customer", true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?document");
  await expect(
    page.locator(".sidebar-desktop").getByText("아직 사건이 없어요.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "자료 열기", exact: true }).click();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).not.toBe(
    "hidden",
  );
  await page.evaluate(() => window.scrollTo(0, 900));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await page.goto("/?no-panel");
  await expect(page.getByRole("button", { name: "자료 열기", exact: true })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).include(".app-frame").analyze()).violations).toEqual([]);
});

test("200% zoom and keyboard focus keep compact navigation reachable", async ({ page }) => {
  await seed(page);
  await page.setViewportSize({ width: 780, height: 900 });
  await page.goto("/");
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await page.locator(".case-tools > summary").press("Enter");
  const link = page
    .getByRole("navigation", { name: "사건 작업", exact: true })
    .getByRole("link", { name: "리포트", exact: true });
  await link.focus();
  await expect(link).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});

test("recent loading and failed list allow a useful retry", async ({ page }) => {
  await seed(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?recent=loading");
  await expect(
    page.locator(".sidebar-desktop").getByText("최근 사건을 불러오는 중", { exact: true }),
  ).toBeVisible();
  await page.goto("/?recent=error");
  const sidebar = page.locator(".sidebar-desktop");
  await expect(sidebar.getByText("사건을 불러오지 못했어요.", { exact: false })).toBeVisible();
  await sidebar.getByRole("button", { name: "다시 불러오기", exact: true }).click();
  await expect(sidebar.locator(".sidebar-story")).toBeVisible();
});

test("rename conflict retains the typed title and requires explicit retry", async ({ page }) => {
  await seed(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator(".sidebar-desktop .sidebar-story-row").hover();
  await page.locator(".sidebar-desktop .sidebar-story-edit").click();
  const modal = page.getByRole("dialog", { name: "사건 제목 수정", exact: true });
  const title = modal.getByRole("textbox", { name: "제목", exact: true });
  await title.fill("내가 입력한 제목");
  await page.evaluate(() => {
    const items = JSON.parse(localStorage.getItem("baro-api-mock-v1:cases") ?? "{}");
    items["shell-case"].title = "다른 화면에서 바꾼 제목";
    localStorage.setItem("baro-api-mock-v1:cases", JSON.stringify(items));
  });
  await modal.getByRole("button", { name: "저장", exact: true }).click();
  await expect(modal.getByRole("alert")).toBeVisible();
  await expect(title).toHaveValue("내가 입력한 제목");
  await modal.getByRole("button", { name: "저장", exact: true }).click();
  await expect(modal).not.toBeVisible();
  await expect(page.locator(".sidebar-desktop .sidebar-story")).toHaveText("내가 입력한 제목");
});

test("visual viewport resize keeps the composer above the shortened viewport", async ({ page }) => {
  await seed(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "메시지 초안" });
  await composer.fill("키보드를 열어도 유지할 초안");
  await page.evaluate(() => {
    if (!visualViewport) throw new Error("Missing Chromium visualViewport");
    Object.defineProperty(visualViewport, "height", { configurable: true, value: 480 });
    // Browser/pinch zoom already reports CSS px. Do not divide by scale again.
    Object.defineProperty(visualViewport, "scale", { configurable: true, value: 2 });
    visualViewport.dispatchEvent(new Event("resize"));
  });
  await expect(page.locator(".app-frame")).toHaveCSS("--app-viewport-height", "480px");
  const bounds = await composer.boundingBox();
  expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(481);
  await expect(composer).toHaveValue("키보드를 열어도 유지할 초안");
});

for (const width of [390, 1440]) {
  test(`initially open panel uses the actual viewport mode at ${width}px`, async ({ page }) => {
    await seed(page);
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      const show = HTMLDialogElement.prototype.showModal;
      HTMLDialogElement.prototype.showModal = function () {
        this.dataset.modalOpenCount = String(Number(this.dataset.modalOpenCount ?? "0") + 1);
        return show.call(this);
      };
    });
    await page.goto("/?open&focus");
    const panel = page.getByRole("dialog", { name: "자료", exact: true });
    await expect(panel).toBeVisible();
    expect(await panel.evaluate((node) => node.matches(":modal"))).toBe(width < 1200);
    if (width >= 1200) {
      expect(await panel.getAttribute("data-modal-open-count")).toBeNull();
      await expect(page.getByRole("textbox", { name: "메시지 초안" })).toBeFocused();
    } else {
      await expect(panel).toHaveAttribute("data-modal-open-count", "1");
      await expect(panel.getByRole("button", { name: "자료 패널 닫기" })).toBeFocused();
    }
  });
}

for (const lifetime of ["mounted", "conditional"] as const) {
  for (const topology of ["sibling", "descendant"] as const) {
    for (const [from, to] of [
      [1440, 390],
      [390, 1440],
    ] as const) {
      test(`${lifetime} ${topology} review stays frontmost through ${from} to ${to} resize`, async ({
        page,
      }) => {
        await seed(page);
        await page.setViewportSize({ width: from, height: 900 });
        await page.goto(`/?open${lifetime === "conditional" ? "&conditional" : ""}`);
        const panel = page.getByRole("dialog", { name: "자료", exact: true });
        const opener = panel.getByRole("button", {
          name: topology === "sibling" ? "독립 자료 검토창" : "자료 확인창",
          exact: true,
        });
        await opener.click();
        const review = page.getByRole("dialog", {
          name: topology === "sibling" ? "독립 자료 검토" : "합성 자료 확인",
          exact: true,
        });
        const editor = review.getByRole("textbox", {
          name: topology === "sibling" ? "별도 교정 내용" : "안쪽 교정 내용",
          exact: true,
        });
        await editor.fill("화면을 바꿔도 보존할 자료 교정 초안");
        await editor.press("ArrowLeft");
        const selection = await editor.evaluate((node: HTMLInputElement) => node.selectionStart);
        await page.setViewportSize({ width: to, height: 900 });
        await expect(review).toBeVisible();
        expect(await review.evaluate((node) => node.matches(":modal"))).toBe(true);
        // Keep the panel's old mode until the active review has actually closed.
        expect(await panel.evaluate((node) => node.matches(":modal"))).toBe(from < 1200);
        await expect(editor).toBeFocused();
        await expect(editor).toHaveValue("화면을 바꿔도 보존할 자료 교정 초안");
        expect(await editor.evaluate((node: HTMLInputElement) => node.selectionStart)).toBe(
          selection,
        );
        expect(
          await editor.evaluate((node) => {
            const r = node.getBoundingClientRect();
            return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
          }),
        ).toBe(true);
        await page.screenshot({
          path: `.wrangler/ui01/followup-${topology}-${from}-${to}.png`,
          animations: "disabled",
        });
        await review.evaluate((node) =>
          node.addEventListener(
            "close",
            () =>
              document.querySelector(".app-frame")?.setAttribute("data-mode-review-closed", "true"),
            { once: true },
          ),
        );
        await page.keyboard.press("Escape");
        await expect(page.locator(".app-frame")).toHaveAttribute("data-mode-review-closed", "true");
        await expect(review).not.toBeVisible();
        await expect(panel).toBeVisible();
        expect(await panel.evaluate((node) => node.matches(":modal"))).toBe(to < 1200);
        await expect(opener).toBeFocused();
        await panel.getByRole("button", { name: "자료 패널 닫기", exact: true }).click();
        await expect(panel).not.toBeVisible();
        await expect(page.getByRole("button", { name: "자료 열기", exact: true })).toBeFocused();
        const selector = topology === "sibling" ? "#sibling-review" : "#nested-review";
        if (lifetime === "mounted")
          await expect(page.locator(selector)).toHaveValue("화면을 바꿔도 보존할 자료 교정 초안");
        else await expect(page.locator(selector)).toHaveCount(0);
      });
    }
  }
}

test("200% CSS zoom keeps the composer and overlay within the visual viewport", async ({
  page,
}) => {
  await seed(page);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "메시지 초안" });
  await composer.fill("확대 후에도 유지할 메시지");
  await page.locator(".app-frame").evaluate((node) => {
    node.setAttribute("data-viewport-writes", "0");
    new MutationObserver((records) =>
      node.setAttribute(
        "data-viewport-writes",
        String(Number(node.getAttribute("data-viewport-writes")) + records.length),
      ),
    ).observe(node, { attributes: true, attributeFilter: ["style"] });
  });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await expect(composer).toBeInViewport({ ratio: 1 });
  expect(
    await composer.evaluate(
      (node) => node.getBoundingClientRect().bottom <= (visualViewport?.height ?? innerHeight) + 1,
    ),
  ).toBe(true);
  await expect(page.locator(".app-frame")).toHaveCSS("--app-viewport-height", "450px");
  await expect(page.locator(".app-frame")).toHaveAttribute("data-viewport-writes", "1");
  await page.screenshot({
    path: ".wrangler/ui01/followup-css-zoom-200.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "자료 열기", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "자료", exact: true });
  expect(
    await panel.evaluate(
      (node) => node.getBoundingClientRect().bottom <= (visualViewport?.height ?? innerHeight) + 1,
    ),
  ).toBe(true);
  await panel.getByRole("button", { name: "자료 패널 닫기", exact: true }).click();
  await page.evaluate(() => {
    document.documentElement.style.zoom = "1";
  });
  await expect(page.locator(".app-frame")).toHaveCSS("--app-viewport-height", "900px");
  await expect(page.locator(".app-frame")).toHaveAttribute("data-viewport-writes", "2");
  await expect(composer).toBeInViewport({ ratio: 1 });
  await expect(composer).toHaveValue("확대 후에도 유지할 메시지");
});
