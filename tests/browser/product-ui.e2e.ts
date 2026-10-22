import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { summary } from "../fixtures/contracts/v2";
import { openReportEditor } from "../helpers/report-controls";

const id = "product-review-case";
const base = `/cases/${id}`;
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
      await expect(page.locator(".app-frame--product")).toBeVisible();
      const dimensions = await page.evaluate(() => ({
        available: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      expect(dimensions.scroll, route).toBeLessThanOrEqual(dimensions.available);
      if (route === "/cases") {
        await expect(
          page.getByRole("heading", {
            name: "돌려받지 못한 보증금, 함께 정리한 이야기",
            exact: true,
          }),
        ).toBeVisible();
        const overlap = await page.evaluate(() => {
          const a = document
            .querySelector(".intake-case-card footer span")
            ?.getBoundingClientRect();
          const b = document.querySelector(".case-list-delete")?.getBoundingClientRect();
          return (
            !a ||
            !b ||
            (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top)
          );
        });
        expect(overlap).toBe(false);
      }
      if (route === base) {
        const positions = await page
          .locator(".workspace-tabs a")
          .evaluateAll((links) => links.map((e) => Math.round(e.getBoundingClientRect().top)));
        expect(new Set(positions).size).toBe(1);
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
  await expect(menu.getByRole("link", { name: "리포트 보기" })).toBeInViewport();
  await menu.getByRole("link", { name: "대화", exact: true }).click();
  await expect(page).toHaveURL(base);
  await page.locator(".case-options summary").click();
  await page.getByRole("button", { name: "사건 삭제", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
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

test("initial summary reveals structured corrections on request and saves before confirmation", async ({
  page,
}) => {
  await seed(page, false, "summary");
  await page.goto(`${base}/summary`);
  await expect(page.getByRole("textbox", { name: "요약 편집", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "사실 내용", exact: true })).toHaveCount(0);
  await page.locator(".summary-facts > summary").click();
  await page
    .getByRole("textbox", { name: "사실 내용", exact: true })
    .fill("원본에서 다시 확인한 합성 사실입니다.");
  const confirmation = page.getByRole("checkbox", {
    name: "요약이 내가 이야기한 사실과 맞는지 확인했어요.",
  });
  await expect(confirmation).toBeDisabled();
  await page.getByRole("button", { name: "수정 내용 저장", exact: true }).click();
  await expect(confirmation).toBeEnabled();
  await expect(page.getByRole("textbox", { name: "사실 내용", exact: true })).toHaveValue(
    "원본에서 다시 확인한 합성 사실입니다.",
  );
});

test("product navigation and reading surfaces support keyboard access and enlarged text", async ({
  page,
}) => {
  await seed(page, true);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of [
    "/cases",
    base,
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
  }
  await page.goto(base);
  await hydrated(page);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".wrangler/ui332/chat-390-text-200.png", fullPage: true });
});
