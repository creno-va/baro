import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { summary } from "../fixtures/contracts/v2";
import { openReportEditor } from "../helpers/report-controls";

const id = "product-review-case";
const base = `/cases/${id}`;
test("settings usage disclosure stacks content below its summary and toggles accessibly", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/settings");
  await expect(page.getByRole("navigation", { name: "설정 바로가기" })).toHaveCount(0);
  await expect(page.locator("#settings-usage-title")).toBeVisible();
  await expect(page.locator("#settings-help-title")).toBeVisible();
  await expect(page.locator("#settings-danger-title")).toBeVisible();
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
    const heading = await summary.boundingBox();
    const body = await content.boundingBox();
    const link = await help.boundingBox();
    if (!heading || !body || !link) throw new Error("Synthetic usage disclosure missing");
    expect(body.y).toBeGreaterThanOrEqual(heading.y + heading.height - 1);
    expect(link.y).toBeGreaterThanOrEqual(body.y + body.height - 1);
    expect(Math.abs(body.x - heading.x)).toBeLessThanOrEqual(1);
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
  await expect(page.getByRole("textbox", { name: "리포트 내용 편집" })).toHaveCount(0);
  await openReportEditor(page);
  const editor = page.getByRole("textbox", { name: "리포트 내용 편집" });
  await editor.fill("수정 중인 합성 리포트입니다. 날짜와 사실을 확인하고 있어요.");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue("수정 중인 합성 리포트입니다. 날짜와 사실을 확인하고 있어요.");
  await expect(page.getByRole("button", { name: "PDF 다운로드", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "검토 내용 저장", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("저장");
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
