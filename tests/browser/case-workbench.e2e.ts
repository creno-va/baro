import { expect, test } from "@playwright/test";
import {
  countMaterialsRequests,
  materialsCasePath,
  seedMaterialsScenario,
  setMaterialsReportRead,
} from "../helpers/workspace-materials-scenario";

test("archived cases keep report access while the new attention upload action is disabled", async ({
  page,
}) => {
  await seedMaterialsScenario(page, { files: 0 });
  await page.addInitScript(() => {
    const key = "baro-api-mock-v1:cases";
    const cases = JSON.parse(localStorage.getItem(key) ?? "{}");
    if (cases["synthetic-case"]) cases["synthetic-case"].stage = "archived";
    localStorage.setItem(key, JSON.stringify(cases));
  });
  await page.goto(materialsCasePath);
  await expect(
    page.getByRole("heading", { name: "자료와 약속을 함께 확인하는 합성 사건", exact: true }),
  ).toBeVisible();
  const open = page.getByRole("button", { name: "자료 열기", exact: true });
  if (await open.isVisible()) await open.click();
  await expect(page.getByRole("button", { name: /^첫 자료 추가하기/ })).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "추가 사실 또는 질문" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "리포트", exact: true })).toHaveAttribute(
    "href",
    /\/reports\?mode=conversation$/,
  );
});

test("a failed precedent module leaves the conversation and unsent text available", async ({
  page,
}) => {
  await seedMaterialsScenario(page, { files: 0 });
  await page.route("**/src/components/workspace/PrecedentResearch.tsx*", (route) => route.abort());
  await page.goto(materialsCasePath);
  const input = page.getByRole("textbox", { name: "추가 사실 또는 질문" });
  await expect(input).toBeEnabled();
  await input.fill("판례 도구 장애 중에도 보존할 합성 초안");
  await page.getByRole("tab", { name: "판례", exact: true }).click();
  await expect(
    page.getByText("판례 도구를 불러오지 못했어요. 작성 중인 대화는 그대로 유지돼요."),
  ).toBeVisible();
  await expect(input).toHaveValue("판례 도구 장애 중에도 보존할 합성 초안");
  await expect(page.getByRole("link", { name: "별도 화면에서 판례 보기" })).toHaveAttribute(
    "target",
    "_blank",
  );
});

test("persisted evidence gaps appear in attention without stealing the chosen tab or executing work", async ({
  page,
}) => {
  await seedMaterialsScenario(page, { files: 0 });
  await page.goto(materialsCasePath);
  await expect(page.getByRole("textbox", { name: "추가 사실 또는 질문" })).toBeEnabled();
  await setMaterialsReportRead(page, "stale");
  await page.evaluate(async () => {
    const path = "/src/client/api/index.ts";
    const { api } = await import(path);
    const client = api.rework;
    api.rework = new Proxy(client, {
      get(target, property) {
        if (property !== "getConversationProgress") return Reflect.get(target, property);
        return async (...args: Parameters<typeof client.getConversationProgress>) => {
          const result = await client.getConversationProgress(...args);
          if (result.state.snapshot)
            result.state.snapshot.evidenceRequirements = [
              {
                id: "synthetic-receipt-need",
                kind: "receipt",
                label: "합성 송금 내역",
                reason: "실제 처리 없이 필요한 자료의 표시를 검증해요.",
                fileIds: [],
              },
            ];
          return result;
        };
      },
    });
  });
  await countMaterialsRequests(page);
  await page.getByRole("tab", { name: /^자료/ }).click();
  await page.getByRole("button", { name: "리포트 상태 다시 확인", exact: true }).click();
  await expect(page.getByRole("tab", { name: /^자료/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "지금 확인", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "확인할 증거 자료" }).filter({ visible: true }),
  ).toContainText("합성 송금 내역");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { materialsRequestCounts: { action: number } }).materialsRequestCounts
          .action,
    ),
  ).toBe(0);
});

test("precedent search and full text stay beside the conversation; report remains a separate page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedMaterialsScenario(page, { files: 0 });
  await page.goto(materialsCasePath);
  const input = page.getByRole("textbox", { name: "추가 사실 또는 질문" });
  await expect(input).toBeEnabled();
  await input.fill("판례를 읽으면서 유지할 합성 초안");
  await page.getByRole("tab", { name: "판례", exact: true }).click();
  await page.getByRole("button", { name: "판례 찾기", exact: true }).click();
  await page.getByRole("list", { name: "관련 판례 목록" }).getByRole("button").first().click();
  await expect(page.locator(".case-context .precedent-full-text")).toBeVisible();
  await expect(input).toHaveValue("판례를 읽으면서 유지할 합성 초안");
  await expect(page).toHaveURL(new RegExp(`${materialsCasePath}$`));
  await page.screenshot({ path: ".wrangler/ui795/workbench-precedent.png" });
  await page.getByRole("link", { name: "리포트", exact: true }).click();
  await expect(page).toHaveURL(/\/reports\?mode=conversation$/);
  await expect(page.locator(".report-review")).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("button", { name: "리포트 준비", exact: true })).toBeEnabled();
  await expect(page.getByRole("link", { name: "대화로 돌아가기", exact: true })).toHaveAttribute(
    "href",
    materialsCasePath,
  );
  await page.screenshot({ path: ".wrangler/ui795/workbench-report.png" });
});

test("Codex workbench keeps a readable conversation, separate report action and scoped public layouts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1848, height: 1013 });
  await seedMaterialsScenario(page, { messages: 6 });
  await page.goto(materialsCasePath);
  const input = page.getByRole("textbox", { name: "추가 사실 또는 질문" });
  await expect(input).toBeEnabled();
  await expect(page.getByRole("link", { name: "리포트", exact: true })).toHaveAttribute(
    "href",
    /\/reports\?mode=conversation$/,
  );
  const bounds = await page.evaluate(() => {
    const rect = (selector: string) => {
      const node = document.querySelector(selector);
      if (!node) throw new Error(`Missing ${selector}`);
      return node.getBoundingClientRect().toJSON();
    };
    return {
      sidebar: rect(".app-header"),
      composer: rect(".workspace-composer"),
      panel: rect("#case-materials-panel"),
      width: document.documentElement.scrollWidth,
    };
  });
  expect(bounds.sidebar.width).toBeCloseTo(356, 0);
  expect(bounds.composer.x).toBeGreaterThanOrEqual(bounds.sidebar.width);
  expect(bounds.composer.x + bounds.composer.width).toBeLessThanOrEqual(bounds.panel.x + 1);
  expect(bounds.composer.y + bounds.composer.height).toBeLessThanOrEqual(1013);
  expect(bounds.width).toBeLessThanOrEqual(1848);
  await page.screenshot({ path: ".wrangler/ui795/workbench-desktop.png" });
  await page.getByRole("button", { name: "최근 사건 검색", exact: true }).click();
  await page.getByRole("textbox", { name: "사건 제목 검색" }).fill("자료와 약속");
  await expect(page.getByRole("dialog", { name: "최근 사건 검색" }).getByRole("link")).toHaveCount(
    1,
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "최근 사건 검색", exact: true })).toBeFocused();
  await page.goto("/app");
  await expect(page.getByRole("textbox", { name: "지금까지 있었던 일" })).toBeEnabled();
  await expect(page.locator("[data-workbench]")).toHaveCount(0);
});

test("plus menu mentions real material IDs without executing work, preserves input across panel and viewport changes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedMaterialsScenario(page);
  await page.goto(materialsCasePath);
  const input = page.getByRole("textbox", { name: "추가 사실 또는 질문" });
  await expect(input).toBeEnabled();
  await input.fill("전송하지 않은 합성 초안");
  await countMaterialsRequests(page);
  const plus = page.locator(".composer-add-menu > summary");
  await plus.click();
  await page.locator(".composer-add-menu").getByRole("checkbox").first().check();
  await plus.press("Escape");
  await expect(page.getByRole("region", { name: "멘션한 자료" })).toContainText("반환 약속");
  await expect(plus).toBeFocused();
  await page.getByRole("button", { name: "자료 패널 닫기", exact: true }).click();
  for (const width of [1024, 390, 320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(input).toHaveValue("전송하지 않은 합성 초안");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
  }
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { materialsRequestCounts: { action: number; send: number } })
          .materialsRequestCounts,
    ),
  ).toMatchObject({ action: 0, send: 0 });
});

test("inline material correction survives pane switching and mobile sheet conversion; discard requires a decision", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedMaterialsScenario(page);
  await page.goto(materialsCasePath);
  await expect(page.getByRole("textbox", { name: "추가 사실 또는 질문" })).toBeEnabled();
  await page.getByRole("tab", { name: /^자료/ }).click();
  await page
    .locator(".workspace-file-list > li")
    .first()
    .getByRole("button", { name: "자료 확인", exact: true })
    .click();
  const review = page.getByRole("dialog", { name: "자료 확인", exact: true });
  const correction = review.getByRole("textbox", { name: "확인·교정한 내용" });
  await correction.fill("합성 교정: 반환 약속 날짜는 확인이 필요합니다.");
  await page.getByRole("tab", { name: "지금 확인", exact: true }).click();
  await page.getByRole("tab", { name: /^자료/ }).click();
  await expect(correction).toHaveValue(/합성 교정/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(correction).toHaveValue(/합성 교정/);
  page.once("dialog", (dialog) => dialog.dismiss());
  await correction.press("Escape");
  await expect(correction).toHaveValue(/합성 교정/);
  await page.screenshot({ path: ".wrangler/ui795/workbench-mobile-review.png" });
  await review.getByRole("button", { name: "교정 내용 저장", exact: true }).click();
  await expect(review.getByText("교정 내용을 저장했어요. 새로 접속해도 유지됩니다.")).toBeVisible();
  await review.getByRole("button", { name: "자료 목록", exact: true }).click();
  await expect(page.locator(".workspace-file-list")).toBeVisible();
});
