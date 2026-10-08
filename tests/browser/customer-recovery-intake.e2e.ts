import { expect, test } from "@playwright/test";

for (const state of ["unknown", "skipped"] as const)
  for (const errorRetry of [false, true])
    test(`edit answer after failed ${state}; error retry=${errorRetry}`, async ({ page }) => {
      await page.addInitScript(() =>
        localStorage.setItem(
          "baro-api-mock-v1:session",
          JSON.stringify({
            user: { id: "answer-retry-owner", name: "합성 검증 고객", accountType: "customer" },
            needsConsent: false,
          }),
        ),
      );
      await page.goto("/cases/new");
      await page
        .getByLabel("지금까지 있었던 일")
        .fill(
          "질문 답변의 실패 후 수정과 재시도를 검증하는 합성 사건입니다. 거래 날짜를 확인합니다.",
        );
      await page.getByRole("button", { name: "저장하고 계속" }).click();
      const answer = page.getByRole("textbox", { name: "답변", exact: true });
      await answer.fill("저장하기 전 합성 답변입니다.");
      await page.evaluate(async () => {
        const path = "/src/client/api/cases.ts",
          core = "/src/client/api/core.ts";
        const { casesApi } = await import(path),
          { ApiError } = await import(core);
        const original = casesApi.saveAnswers;
        casesApi.saveAnswers = async () => {
          casesApi.saveAnswers = original;
          throw new ApiError("UNAVAILABLE", "합성 저장 장애", true);
        };
      });
      await page
        .getByRole("button", { name: state === "unknown" ? "모름" : "건너뛰기", exact: true })
        .click();
      await expect(page.getByRole("alert")).toContainText("합성 저장 장애");
      const replacement = "오류 뒤 새로 입력한 실제 저장 대상 합성 답변입니다.";
      await answer.fill(replacement);
      if (errorRetry) await page.getByRole("button", { name: "다시 시도", exact: true }).click();
      else await page.getByRole("button", { name: "저장하고 다음 질문", exact: true }).click();
      await expect(page.getByText("1차 질문 · 2 / 3", { exact: true })).toBeVisible();
      const saved = await page.evaluate(async () => {
        const path = "/src/client/api/index.ts",
          { api } = await import(path);
        return (await api.cases.getQuestions(location.pathname.split("/")[2])).questions[0];
      });
      expect(saved.answerState).toBe("answered");
      expect(saved.answer).toBe(replacement);
    });

test("previous question navigation preserves the unsaved current answer", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "baro-api-mock-v1:session",
      JSON.stringify({
        user: { id: "more-review-customer", name: "합성 검증 고객", accountType: "customer" },
        needsConsent: false,
      }),
    ),
  );
  await page.goto("/cases/new");
  await page
    .getByLabel("지금까지 있었던 일")
    .fill("이전 질문 이동을 검토하는 합성 사건입니다. 거래 날짜와 약속 내용을 정리합니다.");
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  await page.getByRole("button", { name: "모름", exact: true }).click();
  await expect(page.getByText("1차 질문 · 2 / 3", { exact: true })).toBeVisible();
  const editor = page.getByRole("textbox", { name: "답변", exact: true });
  await editor.fill("아직 저장하지 않은 두 번째 질문의 합성 초안입니다.");
  await page.getByText("답변 관리", { exact: true }).click();
  await page.getByRole("button", { name: "이전 질문", exact: true }).click();
  await expect(page.getByText("1차 질문 · 1 / 3", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "모름", exact: true }).click();
  await expect(page.getByText("1차 질문 · 2 / 3", { exact: true })).toBeVisible();
  await expect(editor).toHaveValue("아직 저장하지 않은 두 번째 질문의 합성 초안입니다.");
});

for (const focus of [false, true]) {
  test(`peer summary edit with local draft; background refresh=${focus}`, async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem(
        "baro-api-mock-v1:session",
        JSON.stringify({
          user: { id: "summary-recheck-customer", name: "합성 검증 고객", accountType: "customer" },
          needsConsent: false,
        }),
      ),
    );
    await page.goto("/cases/new");
    await page
      .getByLabel("지금까지 있었던 일")
      .fill(
        "요약 충돌을 재검토하기 위한 합성 사건입니다. 서로 다른 화면에서 준비할 내용을 정리합니다.",
      );
    await page.getByRole("button", { name: "저장하고 계속" }).click();
    for (let i = 0; i < 6; i++)
      await page.getByRole("button", { name: "모름", exact: true }).click();
    await expect(page).toHaveURL(/\/summary$/);
    const editor = page.getByLabel("요약 편집");
    const mine = "현재 탭에서 아직 저장하지 않은 합성 요약";
    await editor.fill(mine);
    await page.evaluate(async () => {
      const modulePath = "/src/client/api/index.ts";
      const { api } = await import(modulePath);
      const id = location.pathname.split("/")[2];
      const item = await api.cases.get(id);
      await api.cases.saveSummary(id, {
        expectedRevision: item.revision,
        summary: "다른 탭이 먼저 저장한 합성 요약",
      });
    });
    if (focus) {
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(editor).toBeVisible();
      await expect(page.getByRole("alert")).toContainText("다른 화면에서 요약이 바뀌었어요");
    }
    await expect(editor).toHaveValue(mine);
    if (!focus) await page.getByRole("button", { name: "수정 내용 저장" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    const saved = await page.evaluate(async () => {
      const p = "/src/client/api/index.ts",
        { api } = await import(p);
      return (await api.cases.get(location.pathname.split("/")[2])).summary;
    });
    expect(saved).toBe("다른 탭이 먼저 저장한 합성 요약");
    await page.getByRole("button", { name: "최신 내용 불러오기", exact: true }).click();
    await expect(editor).toHaveValue("다른 탭이 먼저 저장한 합성 요약");
  });
}
