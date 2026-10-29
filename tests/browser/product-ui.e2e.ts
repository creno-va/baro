import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { summary } from "../fixtures/contracts/v2";
import { openReportEditor } from "../helpers/report-controls";

const id = "product-review-case";
const base = `/cases/${id}`;

async function focusAudit(page: Page, keyboard: boolean) {
  if (keyboard) await page.keyboard.press("Tab");
  else await page.mouse.click(5, 85);
  return page.evaluate(() => {
    const scope = document.querySelector(".app-frame, .login-page, .consent-page");
    if (!scope) throw new Error("Focus audit scope missing");
    const failures: string[] = [];
    let count = 0;
    for (const node of scope.querySelectorAll(
      "a[href],button,input,textarea,select,summary,[tabindex]",
    )) {
      if (
        !(node instanceof HTMLElement) ||
        node.matches(":disabled") ||
        !node.getClientRects().length ||
        node.closest("dialog:not([open]),[hidden]")
      )
        continue;
      const style = getComputedStyle(node);
      if (style.visibility === "hidden") continue;
      const parents = [node, node.parentElement, node.parentElement?.parentElement].filter(
        (value): value is HTMLElement => !!value,
      );
      const before = parents.map((parent) => getComputedStyle(parent).boxShadow);
      node.focus({ preventScroll: true });
      if (document.activeElement !== node) continue;
      count++;
      parents.forEach((parent, index) => {
        const current = getComputedStyle(parent);
        const label = `${parent.tagName}.${parent.className}`;
        if (current.outlineStyle !== "none" && Number.parseFloat(current.outlineWidth) > 0)
          failures.push(`${label}: ${current.outline}`);
        if (
          current.boxShadow !== before[index] &&
          current.boxShadow !== "none" &&
          !current.boxShadow.includes("inset")
        )
          failures.push(`${label}: outer focus shadow ${current.boxShadow}`);
      });
    }
    return { count, failures: [...new Set(failures)] };
  });
}

test("focus feedback covers login roles and consent without pointer outlines", async ({ page }) => {
  await seed(page);
  await page.goto(base);
  await hydrated(page);
  await page.evaluate(() =>
    localStorage.setItem(
      "baro-api-mock-v1:session",
      JSON.stringify({ user: null, needsConsent: false }),
    ),
  );
  await page.goto("/login");
  await hydrated(page);
  const customer = page.getByRole("radio", { name: "고객", exact: true });
  await expect(customer).toBeEnabled();
  for (const keyboard of [false, true]) {
    expect((await focusAudit(page, keyboard)).failures).toEqual([]);
  }
  await page.keyboard.press("Tab");
  await customer.focus();
  await expect(customer.locator("..")).toHaveCSS("box-shadow", /inset/);
  await page.evaluate(() =>
    localStorage.setItem(
      "baro-api-mock-v1:session",
      JSON.stringify({
        user: { id: "product-ui-owner", name: "예시 고객", accountType: "customer" },
        needsConsent: true,
      }),
    ),
  );
  await page.goto("/consent");
  await hydrated(page);
  await expect(page.getByRole("checkbox").first()).toBeVisible();
  for (const keyboard of [false, true]) {
    expect((await focusAudit(page, keyboard)).failures).toEqual([]);
  }
});

test("focus feedback keeps accordion keyboard operation without a container outline", async ({
  page,
}) => {
  await seed(page, true);
  await page.goto(base);
  await hydrated(page);
  const disclosure = page.locator(".workspace-context");
  const trigger = disclosure.locator("summary");
  await page.keyboard.press("Tab");
  await trigger.focus();
  await expect(trigger).toHaveCSS("outline-style", "none");
  await expect(trigger).toHaveCSS("text-decoration-line", "underline");
  await page.keyboard.press("Enter");
  await expect(disclosure).toHaveAttribute("open", "");
  await page.keyboard.press("Space");
  await expect(disclosure).not.toHaveAttribute("open");
  await trigger.click();
  await expect(disclosure).toHaveAttribute("open", "");
  await expect(trigger).toHaveCSS("outline-style", "none");
  await page.screenshot({ path: ".wrangler/focus-accordion.png", fullPage: true });
});

for (const width of [1440, 390]) {
  test(`focus feedback audits service controls and automatic focus at ${width}px`, async ({
    page,
  }, testInfo) => {
    await seed(page, true);
    await page.setViewportSize({ width, height: 900 });
    let count = 0;
    for (const route of [
      "/app",
      base,
      `${base}/files`,
      `${base}/timeline`,
      `${base}/actions`,
      `${base}/precedents`,
      `${base}/reports`,
      `${base}/summary`,
      "/settings",
      "/lawyers",
      "/help",
      "/policies/terms",
      "/policies/privacy",
      "/policies/ai",
    ]) {
      await page.goto(route);
      await hydrated(page);
      if (route === `${base}/reports`) await openReportEditor(page);
      if (route === `${base}/precedents`) {
        await page.locator(".precedent-search details > summary").click();
        for (const keyboard of [false, true]) {
          const result = await focusAudit(page, keyboard);
          expect
            .soft(result.failures, `precedent search ${keyboard ? "keyboard" : "pointer"}`)
            .toEqual([]);
          count += result.count;
        }
        await page.getByRole("button", { name: "판례 찾기", exact: true }).click();
        await page
          .getByRole("button", { name: /판례 내용 보기/ })
          .first()
          .click();
      }
      for (const keyboard of [false, true]) {
        const result = await focusAudit(page, keyboard);
        expect.soft(result.failures, `${route} ${keyboard ? "keyboard" : "pointer"}`).toEqual([]);
        count += result.count;
      }
    }
    testInfo.annotations.push({ type: "focus-controls-checked", description: String(count) });
    expect(count).toBeGreaterThan(100);
    await page.goto("/lawyers");
    await hydrated(page);
    await page.locator("a.directory-profile").first().click();
    await hydrated(page);
    for (const keyboard of [false, true])
      expect((await focusAudit(page, keyboard)).failures).toEqual([]);
    await page.getByRole("button", { name: "연락처 보기", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "연락처", exact: true })).toBeVisible();
    for (const keyboard of [false, true])
      expect((await focusAudit(page, keyboard)).failures).toEqual([]);
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      const key = "baro-api-mock-v1:session";
      const session = JSON.parse(localStorage.getItem(key) ?? "{}");
      session.user.accountType = "lawyer";
      localStorage.setItem(key, JSON.stringify(session));
    });
    await page.goto("/lawyer");
    await hydrated(page);
    await expect(page.getByRole("textbox").first()).toBeVisible();
    for (const keyboard of [false, true])
      expect((await focusAudit(page, keyboard)).failures).toEqual([]);
  });
}

test("focus feedback covers custom intake answers without switching modality while typing", async ({
  page,
}) => {
  await seed(page);
  await page.goto(base);
  await hydrated(page);
  await page.evaluate((id) => {
    const cases = JSON.parse(localStorage.getItem("baro-api-mock-v1:cases") ?? "{}");
    cases[id].stage = "intake";
    localStorage.setItem("baro-api-mock-v1:cases", JSON.stringify(cases));
    localStorage.setItem(
      "baro-api-mock-v1:intake",
      JSON.stringify({
        [id]: {
          narrative: "합성 질문 검증",
          questions: [
            {
              id: "focus-question",
              text: "어떤 자료가 있나요?",
              kind: "choice",
              options: ["거래 내역이 있어요", "대화 기록이 있어요"],
            },
          ],
        },
      }),
    );
  }, id);
  await page.goto(`${base}/intake`);
  await hydrated(page);
  await page.getByRole("radio", { name: "직접 입력", exact: true }).check();
  const input = page.getByRole("textbox").first();
  await expect(input).toBeVisible();
  for (const keyboard of [false, true])
    expect((await focusAudit(page, keyboard)).failures).toEqual([]);
  await input.click();
  await input.pressSequentially("focus check");
  await input.press("ArrowLeft");
  await expect(page.locator(":root")).toHaveAttribute("data-focus-input", "pointer");
  await expect(input).toHaveCSS("outline-style", "none");
});

test("focus feedback handles touch and automatic focus from the mobile menu", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  try {
    const page = await context.newPage();
    await seed(page, true);
    await page.goto(base);
    await hydrated(page);
    const summary = page.locator(".workspace-context > summary");
    await summary.tap();
    await expect(summary).toHaveCSS("outline-style", "none");
    const opener = page.getByRole("button", { name: "메뉴 열기", exact: true });
    await opener.tap();
    const menu = page.getByRole("dialog", { name: "메뉴", exact: true });
    await expect(menu).toBeVisible();
    const close = menu.getByRole("button", { name: "닫기", exact: true });
    await expect(close).toHaveCSS("outline-style", "none");
    await close.tap();
    await expect(opener).toBeFocused();
    await expect(opener).toHaveCSS("outline-style", "none");
    await expect(page.locator(":root")).toHaveAttribute("data-focus-input", "pointer");
  } finally {
    await context.close();
  }
});

test("focus feedback restores modal focus after pointer and keyboard dismissal", async ({
  page,
}) => {
  await seed(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base);
  await hydrated(page);
  const opener = page.locator(".sidebar-desktop .sidebar-story-delete").first();
  for (const keyboard of [false, true]) {
    if (keyboard) {
      await page.keyboard.press("Tab");
      await opener.focus();
      await page.keyboard.press("Enter");
    } else {
      await opener.locator("..").hover();
      await opener.click();
    }
    const modal = page.getByRole("dialog", { name: "이 사건을 삭제할까요?" });
    await expect(modal).toBeVisible();
    const cancel = modal.getByRole("button", { name: "취소", exact: true });
    await expect(cancel).toBeFocused();
    await expect(cancel).toHaveCSS("outline-style", "none");
    const close = modal.getByRole("button", { name: "닫기", exact: true });
    if (keyboard) await page.keyboard.press("Tab");
    else await close.focus();
    await expect(close).toBeFocused();
    await expect(close).toHaveCSS("outline-style", "none");
    if (keyboard) await expect(close).toHaveCSS("box-shadow", /inset/);
    await page.keyboard.press("Escape");
    await expect(modal).not.toBeVisible();
    await expect(opener).toBeFocused();
    await expect(opener).toHaveCSS("outline-style", "none");
  }
});
test("settings usage disclosure stacks content below its summary and toggles accessibly", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/settings");
  await expect(page.getByRole("navigation", { name: "설정 바로가기" })).toHaveCount(0);
  await expect(page.locator("#settings-usage-title")).toBeVisible();
  await expect(page.locator("#settings-help-title")).toBeVisible();
  await expect(page.locator("#settings-danger-title")).toBeVisible();
  await expect(page.locator(".account-settings")).toHaveAttribute("aria-busy", "false");
  const disclosure = page.locator(".settings-usage-guide");
  const summary = disclosure.locator("summary");
  const content = disclosure.locator("p");
  const help = disclosure.getByRole("link", { name: "한도와 대기 도움말" });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(content).toBeHidden();
    await summary.click();
    await expect(content).toBeVisible();
    await expect(help).toBeVisible();
    // Clicking/expanding can move the document through scroll anchoring. Read
    // all rectangles in one frame so their viewport origin is identical.
    const geometry = await disclosure.evaluate((node) => {
      const heading = node.querySelector("summary")?.getBoundingClientRect();
      const body = node.querySelector("p")?.getBoundingClientRect();
      const link = node.querySelector("a")?.getBoundingClientRect();
      if (!heading || !body || !link) throw new Error("Synthetic usage disclosure missing");
      return {
        headingBottom: heading.bottom,
        bodyTop: body.top,
        bodyBottom: body.bottom,
        linkTop: link.top,
        leftDifference: Math.abs(body.left - heading.left),
      };
    });
    expect(geometry.bodyTop).toBeGreaterThanOrEqual(geometry.headingBottom - 1);
    expect(geometry.linkTop).toBeGreaterThanOrEqual(geometry.bodyBottom - 1);
    expect(geometry.leftDifference).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(content).toBeHidden();
    await expect(help).toBeHidden();
  }
});
async function seed(page: Page, messages = false, stage: "active" | "summary" = "active") {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(
    ({ id, summary, messages, stage }) => {
      if (localStorage.getItem("product-ui-seeded")) return;
      localStorage.setItem("product-ui-seeded", "true");
      const now = new Date().toISOString();
      const item = {
        id,
        title: "돌려받지 못한 보증금, 함께 정리한 이야기",
        subjectContext: "individual",
        stage,
        revision: 1,
        updatedAt: now,
        summary:
          "계약이 끝난 뒤 보증금을 돌려받지 못했어요. 계약서와 대화에서 확인한 사실을 차근차근 정리하고 있어요.",
        schemaVersion: "2",
        summaryDetails: summary,
      };
      const values = {
        session: {
          user: { id: "product-ui-owner", name: "예시 고객", accountType: "customer" },
          needsConsent: false,
        },
        cases: { [id]: item },
        caseOwners: { [id]: "product-ui-owner" },
        workspace: {
          [id]: {
            messages: messages
              ? [
                  {
                    id: "review-message",
                    role: "assistant",
                    text: "기억나는 날짜와 대화를 정리해 보세요. 확인이 필요한 내용은 질문으로 남겨둘 수 있어요.",
                    status: "complete",
                    createdAt: now,
                  },
                ]
              : [],
            timeline: [
              {
                id: "review-event",
                date: "2026-08-31",
                title: "임대차 계약 종료",
                detail: "계약서에 적힌 종료일을 확인했어요.",
              },
            ],
            actions: [
              {
                id: "review-action",
                title: "계약서 원본 보관하기",
                detail: "날짜와 서명이 보이는 원본을 준비하세요.",
                done: false,
              },
            ],
          },
        },
        files: {
          [id]: [
            {
              id: "review-file",
              revision: 1,
              name: "임대차 계약서와 반환 약속을 정리한 자료.txt",
              mimeType: "text/plain",
              sizeBytes: 160,
              status: "ready",
              coverage: "전체 내용을 확인했어요.",
              extractedText: "합성 자료입니다. 계약 종료일은 2026년 8월 31일입니다.",
            },
          ],
        },
      };
      for (const [key, value] of Object.entries(values))
        localStorage.setItem(`baro-api-mock-v1:${key}`, JSON.stringify(value));
    },
    { id, summary, messages, stage },
  );
}

async function hydrated(page: Page) {
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

for (const width of [320, 390, 768, 900, 901, 1024, 1440]) {
  test(`product layouts fit ${width}px and keep case actions separate`, async ({ page }) => {
    await seed(page);
    await page.setViewportSize({ width, height: 900 });
    for (const route of [
      "/cases",
      "/lawyers",
      "/settings",
      base,
      `${base}/files`,
      `${base}/timeline`,
      `${base}/reports`,
    ]) {
      await page.goto(route);
      await hydrated(page);
      if (route.startsWith(base))
        await expect(
          page.getByRole("heading", {
            name: "돌려받지 못한 보증금, 함께 정리한 이야기",
            exact: true,
          }),
        ).toBeVisible();
      if (route === "/lawyers") await expect(page.locator(".directory-profile")).toHaveCount(2);
      if (route === "/settings") await expect(page.locator(".usage-item")).toHaveCount(4);
      await expect(page.locator(".app-frame")).toBeVisible();
      const dimensions = await page.evaluate(() => ({
        available: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      expect(dimensions.scroll, route).toBeLessThanOrEqual(dimensions.available);
      if (route === "/cases") {
        await expect(page).toHaveURL("/app");
        await expect(page.locator(".sidebar-desktop .sidebar-story")).toHaveCount(1);
      }
      if (route === base) {
        const positions = await page
          .locator(".workspace-tabs a")
          .evaluateAll((links) => links.map((e) => Math.round(e.getBoundingClientRect().top)));
        expect(new Set(positions).size).toBe(1);
        const destinations = page.locator(".workspace-tabs a");
        await expect(destinations).toHaveCount(6);
        for (const destination of await destinations.all()) {
          await destination.scrollIntoViewIfNeeded();
          await expect(destination).toBeInViewport({ ratio: 0.99 });
        }
      }
      if ([390, 901, 1440].includes(width))
        await page.screenshot({
          path: `.wrangler/ui332/${width}-${route.replaceAll("/", "-")}.png`,
          fullPage: true,
        });
    }
  });
}

test("mobile chat keeps the composer visible and every case destination reachable", async ({
  page,
}) => {
  await seed(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await hydrated(page);
  const send = page.getByRole("button", { name: "보내기", exact: true });
  await expect(send).toBeVisible();
  const box = await send.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? 10000) + (box?.height ?? 0)).toBeLessThanOrEqual(844);
  const menu = page.getByRole("navigation", { name: "사건 메뉴", exact: true });
  await menu.getByRole("link", { name: "리포트 보기" }).click();
  await expect(page).toHaveURL(`${base}/reports`);
  const selected = menu.getByRole("link", { name: "리포트 보기" });
  await expect(selected).toBeInViewport({ ratio: 1 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(selected).toBeInViewport({ ratio: 1 });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(selected).toBeInViewport({ ratio: 1 });
  await menu.getByRole("link", { name: "대화", exact: true }).click();
  await expect(page).toHaveURL(base);
  await expect(page.locator(".case-options")).toHaveCount(0);
  await page.goto("/cases");
  await page.getByRole("button", { name: "메뉴 열기" }).click();
  const remove = page.getByRole("button", {
    name: "돌려받지 못한 보증금, 함께 정리한 이야기 사건 삭제",
    exact: true,
  });
  await remove.focus();
  await remove.click();
  await page
    .getByRole("dialog", { name: "이 사건을 삭제할까요?" })
    .getByRole("button", { name: "취소", exact: true })
    .click();
  await expect(remove).toBeFocused();
});

test("chat height stays fixed when preparation expands and the page scrolls", async ({ page }) => {
  await seed(page, true);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(base);
    await hydrated(page);
    const panel = page.locator(".workspace-main");
    const send = page.getByRole("button", { name: "보내기", exact: true });
    await expect(panel).toHaveAttribute("style", /--chat-panel-height/);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(send).toBeInViewport({ ratio: 1 });
    const initialHeight = await panel.evaluate((element) => element.clientHeight);
    const context = page.locator(".workspace-context");
    await context.locator("summary").click();
    await expect(context).toHaveAttribute("open", "");
    await context.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    await expect.poll(() => panel.evaluate((element) => element.clientHeight)).toBe(initialHeight);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(send).toBeInViewport({ ratio: 1 });
    await context.locator("summary").evaluate((element) => {
      if (element instanceof HTMLElement) element.click();
    });
    await expect(context).not.toHaveAttribute("open");
    await expect.poll(() => panel.evaluate((element) => element.clientHeight)).toBe(initialHeight);
    await expect(send).toBeInViewport({ ratio: 1 });
  }
});

test("chat replies separate source cards and wrap long titles and attachment names", async ({
  page,
}) => {
  await seed(page, true);
  await page.addInitScript((id) => {
    const key = "baro-api-mock-v1:workspace";
    const workspaces = JSON.parse(localStorage.getItem(key) ?? "{}");
    workspaces[id].messages = [
      {
        id: "long-source-reply",
        role: "assistant",
        status: "complete",
        text: "확인한 공식 출처를 함께 살펴보세요.",
        createdAt: new Date().toISOString(),
        citations: [
          {
            id: "source",
            title: "긴판례사건제목".repeat(30),
            url: "https://www.law.go.kr/precInfoP.do?precSeq=111",
          },
        ],
        references: [{ kind: "official_source", citationId: "source" }],
      },
      {
        id: "long-attachment-message",
        role: "user",
        status: "complete",
        text: "첨부 자료를 확인해 주세요.",
        createdAt: new Date().toISOString(),
        selectedFileIds: ["review-file"],
      },
    ];
    localStorage.setItem(key, JSON.stringify(workspaces));
    const filesKey = "baro-api-mock-v1:files";
    const files = JSON.parse(localStorage.getItem(filesKey) ?? "{}");
    files[id][0].name = "long_attachment_name_".repeat(30) + ".txt";
    localStorage.setItem(filesKey, JSON.stringify(files));
  }, id);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base);
    await hydrated(page);
    const reply = page.locator(".workspace-message--assistant");
    await expect(reply.locator(".workspace-source-card")).toHaveCount(1);
    await expect(page.getByText("검증한 공식 출처", { exact: true })).toHaveCount(0);
    const gap = await reply.evaluate((element) => {
      const paragraph = element.querySelector("p")?.getBoundingClientRect();
      const source = element.querySelector(".workspace-source-cards")?.getBoundingClientRect();
      if (!paragraph || !source) throw new Error("Missing synthetic reply source");
      return source.top - paragraph.bottom;
    });
    expect(gap).toBeGreaterThanOrEqual(12);
    await expect
      .poll(() =>
        page
          .locator(".workspace-message")
          .evaluateAll((messages) =>
            messages.every((message) => message.scrollWidth <= message.clientWidth + 1),
          ),
      )
      .toBe(true);
  }
});

test("mobile workspace dialogs return focus to their own opener", async ({ page }) => {
  await seed(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [route, label] of [
    [`${base}/timeline`, "일정 추가"],
    [`${base}/timeline`, "편집"],
    [`${base}/files`, "자료 확인"],
    [`${base}/files`, "삭제"],
  ] as const) {
    await page.goto(route);
    await hydrated(page);
    const opener = page.getByRole("button", { name: label, exact: true });
    await opener.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("닫기", { exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect.soft(opener, label).toBeFocused();
  }
});

test("reports start in reading mode and retain editing through a focus check", async ({ page }) => {
  await seed(page);
  await page.goto(`${base}/reports`);
  await expect(page.getByRole("region", { name: "리포트 검토 본문" })).toBeVisible();
  const heading = page.locator(".report-heading");
  await expect(heading.getByRole("button", { name: "수정하기", exact: true })).toBeVisible();
  await expect(heading.getByRole("button", { name: "새 버전 만들기", exact: true })).toBeVisible();
  await expect(page.getByText("리포트 내용 수정하기", { exact: true })).toHaveCount(0);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page
      .locator(".report-canvas")
      .screenshot({ path: `.wrangler/report-reading-${width}.png` });
  }
  await expect(page.getByRole("textbox", { name: / 수정$/ })).toHaveCount(0);
  await openReportEditor(page);
  const editor = page.getByRole("textbox", { name: / 수정$/ }).first();
  await editor.fill("수정 중인 합성 리포트입니다. 날짜와 사실을 확인하고 있어요.");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue("수정 중인 합성 리포트입니다. 날짜와 사실을 확인하고 있어요.");
  await expect(page.getByRole("button", { name: "PDF 다운로드", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "수정 마치기", exact: true }).click();
  await expect(page.getByRole("region", { name: "리포트 검토 본문" })).toContainText(
    "수정 중인 합성 리포트입니다. 날짜와 사실을 확인하고 있어요.",
  );
  await page.reload();
  await openReportEditor(page);
  await expect(editor).toHaveValue("수정 중인 합성 리포트입니다. 날짜와 사실을 확인하고 있어요.");
});

test("initial summary uses a single editor without fact controls, checkbox or previous-answer action", async ({
  page,
}) => {
  await seed(page, false, "summary");
  await page.goto(`${base}/summary`);
  const editor = page.getByRole("textbox", { name: "요약 편집", exact: true });
  const next = page.getByRole("button", { name: "요약 확인하고 계속", exact: true });
  await expect(editor).toBeVisible();
  await expect(page.locator(".summary-facts,.intake-confirm-check")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "이전 답변 수정하기", exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "사실 내용", exact: true })).toHaveCount(0);
  await expect(next).toBeEnabled();
  await editor.fill("원본에서 다시 확인한 합성 내용을 요약에 추가합니다.");
  await expect(next).toBeDisabled();
  await page.getByRole("button", { name: "수정 내용 저장", exact: true }).click();
  await expect(next).toBeEnabled();
  await expect(next).toBeFocused();
  await page.reload();
  await expect(editor).toHaveValue("원본에서 다시 확인한 합성 내용을 요약에 추가합니다.");
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    await page.screenshot({
      path: `.wrangler/summary-simple-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
  await next.click();
  await page.getByRole("dialog").getByRole("button", { name: "취소", exact: true }).click();
  await expect(next).toBeFocused();
});

test("product navigation and reading surfaces support keyboard access and enlarged text", async ({
  page,
}) => {
  await seed(page, true);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of [
    "/cases",
    base,
    `${base}/summary`,
    `${base}/files`,
    `${base}/timeline`,
    `${base}/actions`,
    `${base}/precedents`,
    `${base}/reports`,
    "/lawyers",
    "/lawyers/example-lawyer-seoul",
    "/settings",
  ]) {
    await page.goto(route);
    await hydrated(page);
    expect((await new AxeBuilder({ page }).include("main").analyze()).violations, route).toEqual(
      [],
    );
    await page.evaluate(() => {
      // Resize actual text, including pixel-based styles, without multiplying
      // inherited sizes as descendants are visited.
      const elements = [...document.querySelectorAll<HTMLElement>("main *")];
      const sizes = elements.map((element) =>
        Number.parseFloat(getComputedStyle(element).fontSize),
      );
      elements.forEach((element, index) => {
        element.style.fontSize = `${(sizes[index] ?? 16) * 2}px`;
      });
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
      route,
    ).toBe(true);
    const notice = page.locator(".case-notice");
    if (await notice.count()) {
      await notice.scrollIntoViewIfNeeded();
      await expect(notice).toBeInViewport({ ratio: 1 });
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    if (route === base)
      await page.screenshot({ path: ".wrangler/ui332/chat-390-text-200.png", fullPage: true });
  }
});

test("individual and company input differ and the saved company context appears in case detail", async ({
  page,
}) => {
  await seed(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");
  await expect(page.getByText("개인 사건은 나와 상대방의 관계", { exact: false })).toBeVisible();
  await page.getByRole("radio", { name: "기업", exact: true }).check();
  await expect(page.getByRole("button", { name: "거래처 대금을 못 받았어요" })).toBeVisible();
  await expect(page.getByRole("button", { name: "빌려준 돈을 못 받았어요" })).toHaveCount(0);
  await page.getByRole("button", { name: "거래처 대금을 못 받았어요" }).click();
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  await expect(page).toHaveURL(/\/intake$/);
  const caseId = page.url().split("/")[4];
  await page.goto(`/cases/${caseId}`);
  await expect(page.locator(".case-subject-context")).toContainText("기업 사건");
  await page.locator(".workspace-context > summary").click();
  await expect(page.getByText("회사와 상대방의 계약 관계", { exact: false })).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "보관한 사건" })).toHaveCount(0);
  await page.getByRole("button", { name: "메뉴 열기" }).click();
  const menu = page.getByRole("dialog", { name: "메뉴", exact: true });
  await expect(
    menu.getByRole("navigation", { name: "모바일 주 메뉴" }).getByRole("link"),
  ).toHaveCount(2);
  await expect(menu.getByRole("link", { name: "이용 유형 변경" })).toHaveCount(0);
  await expect(menu.getByRole("link", { name: "도움말", exact: true })).toHaveCount(0);
});
