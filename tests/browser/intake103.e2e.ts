import { expect, type Page, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("baro-api-mock-v1:session"))
      localStorage.setItem(
        "baro-api-mock-v1:session",
        JSON.stringify({
          user: { id: "example-customer", name: "예시 고객", accountType: "customer" },
          needsConsent: false,
        }),
      );
  });
});
test("mobile keyboard flow saves/reloads/resumes/back edits/unknown/skip/summary and reaches workspace", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const external: string[] = [];
  const localOrigin = new URL(test.info().project.use.baseURL ?? "http://127.0.0.1:4341").origin;
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== localOrigin) external.push(request.url());
  });
  await page.goto("/cases");
  await expect(page.getByRole("heading", { name: "아직 정리한 사건이 없어요" })).toBeVisible();
  await page.getByRole("link", { name: "첫 사건 만들기" }).click();
  const narrative = page.getByRole("textbox", { name: "지금까지 있었던 일" });
  await narrative.fill(
    "합성 사건입니다. 지난달 지인에게 빌려준 돈을 약속한 날짜가 지나도 돌려받지 못했습니다.",
  );
  await page.getByRole("button", { name: "저장하고 질문 시작" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/intake/);
  await expect(page.getByRole("heading", { name: "이 일은 언제 시작됐나요?" })).toBeVisible();
  await page.getByRole("textbox", { name: "답변", exact: true }).fill("2026년 9월");
  await page.getByRole("button", { name: "답변 저장", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "답변이 저장됐어요" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "답변", exact: true })).toHaveValue("2026년 9월");
  await page.getByRole("button", { name: "저장하고 다음 질문" }).click();
  await expect(page.getByRole("heading", { name: "얼마의 금액이 관련되어 있나요?" })).toBeVisible();
  await page.getByRole("button", { name: "이전 질문" }).click();
  await page.getByRole("textbox", { name: "답변", exact: true }).fill("2026년 8월");
  await page.getByRole("button", { name: "저장하고 다음 질문" }).click();
  await page.getByRole("button", { name: "모름", exact: true }).click();
  await expect(page.getByRole("heading", { name: "확인할 수 있는 자료가 있나요?" })).toBeVisible();
  await page.getByRole("radio", { name: "문자·메신저·녹음이 있어요" }).check();
  await page.getByRole("button", { name: "답변 저장", exact: true }).click();
  await page.getByRole("button", { name: "나중에 이어하기" }).click();
  await page.getByRole("link", { name: "목록으로 이동" }).click();
  await page.getByRole("link").filter({ hasText: "이어 답하기" }).click();
  await expect(
    page.getByRole("heading", {
      name: "내 입장에 불리하거나, 서로 다르게 기억하는 내용이 있나요?",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "이전 질문" }).click();
  await expect(page.getByRole("radio", { name: "문자·메신저·녹음이 있어요" })).toBeChecked();
  await page.getByRole("button", { name: "저장하고 다음 질문" }).click();
  await page.getByRole("button", { name: "건너뛰기", exact: true }).click();
  await expect(page).toHaveURL(/\/summary/);
  const summary = page.getByRole("textbox", { name: "요약 편집" });
  await expect(summary).toHaveValue(/2026년 8월/);
  await expect(summary).toHaveValue(/모름/);
  await expect(summary).toHaveValue(/건너뛰기/);
  const old = await summary.inputValue();
  await summary.fill(`${old}\n수정 취소 확인`);
  await page.getByRole("button", { name: "수정 취소", exact: true }).click();
  await expect(summary).toHaveValue(old);
  await summary.fill(`${old}\n합성 추가 사실입니다.`);
  await page.getByRole("button", { name: "수정 내용 저장" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "수정한 요약이 저장됐어요" }),
  ).toBeVisible();
  await page.reload();
  await expect(summary).toHaveValue(/합성 추가 사실입니다/);
  await page.getByRole("checkbox", { name: "저장한 요약을 읽고" }).check();
  await page.getByRole("button", { name: "요약 확인하고 계속" }).click();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.getByRole("button", { name: "요약 확인하고 계속" })).toBeVisible();
  await page.getByRole("button", { name: "요약 확인하고 계속" }).click();
  await page.getByRole("button", { name: "확인하고 사건 열기" }).click();
  await expect(page).toHaveURL(/\/cases\/[^/]+$/);
  await page.goto("/cases");
  await expect(page.getByText("정리 진행 중", { exact: true })).toBeVisible();
  expect(external).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test("storage failure retains form input and retry completes exactly one creation", async ({
  page,
}) => {
  await page.goto("/cases/new");
  await page
    .getByRole("textbox", { name: "지금까지 있었던 일" })
    .fill("합성 오류 테스트입니다. 저장 공간이 잠시 부족한 상황을 확인합니다.");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "baro-api-mock-v1:cases")
        throw new DOMException("synthetic", "QuotaExceededError");
      return original.call(this, key, value);
    };
    (window as unknown as { restoreStorage: () => void }).restoreStorage = () => {
      Storage.prototype.setItem = original;
    };
  });
  await page.getByRole("button", { name: "저장하고 질문 시작" }).click();
  await expect(page.getByText("예시 저장 공간이 부족해요", { exact: false })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "지금까지 있었던 일" })).toHaveValue(
    /합성 오류 테스트/,
  );
  await page.evaluate(() => (window as unknown as { restoreStorage: () => void }).restoreStorage());
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(page).toHaveURL(/\/intake/);
  await page.goto("/cases");
  await expect(page.locator(".intake-case-card")).toHaveCount(1);
});
test("stale summary cannot overwrite newer content; keyboard and 200 percent layout work", async ({
  page,
}) => {
  await page.goto("/cases/new");
  await page
    .getByRole("textbox", { name: "지금까지 있었던 일" })
    .fill("합성 충돌 테스트입니다. 서로 다른 화면에서 요약을 수정하는 상황입니다.");
  await page.getByRole("button", { name: "저장하고 질문 시작" }).click();
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "모름", exact: true }).click();
  await expect(page).toHaveURL(/\/summary/);
  const summary = page.getByRole("textbox", { name: "요약 편집" });
  await summary.fill("현재 화면에서 수정한 합성 요약");
  await page.evaluate(() => {
    const key = "baro-api-mock-v1:cases",
      items = JSON.parse(localStorage.getItem(key) ?? "{}");
    for (const item of Object.values(items) as { revision: number; summary: string }[]) {
      item.revision++;
      item.summary = "다른 화면에서 저장한 합성 요약";
    }
    localStorage.setItem(key, JSON.stringify(items));
  });
  await page.getByRole("button", { name: "수정 내용 저장" }).click();
  await expect(page.getByRole("alert")).toContainText("다른 화면에서 내용이 바뀌었어요");
  await expect(summary).toHaveValue("현재 화면에서 수정한 합성 요약");
  await page.getByRole("button", { name: "최신 내용 불러오기" }).click();
  await expect(summary).toHaveValue("다른 화면에서 저장한 합성 요약");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole("checkbox", { name: "저장한 요약을 읽고" }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("checkbox", { name: "저장한 요약을 읽고" })).toBeChecked();
});

test("summary returns to editable questions and regenerates after a prior answer changes", async ({
  page,
}) => {
  await page.goto("/cases/new");
  await page
    .getByRole("textbox", { name: "지금까지 있었던 일" })
    .fill("합성 수정 테스트입니다. 질문에 답한 뒤 요약에서 이전 답변을 고쳐 봅니다.");
  await page.getByRole("button", { name: "저장하고 질문 시작" }).click();
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "모름", exact: true }).click();
  await expect(page).toHaveURL(/\/summary/);
  await page.getByRole("link", { name: "질문으로 돌아가기" }).click();
  await page.getByRole("textbox", { name: "답변", exact: true }).fill("2026년 7월로 수정");
  await page.getByRole("button", { name: "저장하고 다음 질문" }).click();
  for (let i = 0; i < 2; i++)
    await page.getByRole("button", { name: "저장하고 다음 질문" }).click();
  await page.getByRole("button", { name: "저장하고 다음 단계" }).click();
  await expect(page).toHaveURL(/\/summary/);
  await expect(page.getByRole("textbox", { name: "요약 편집" })).toHaveValue(/2026년 7월로 수정/);
});

test("a new form with identical input creates a new case after the previous request completed", async ({
  page,
}) => {
  const narrative =
    "합성 반복 입력 테스트입니다. 새 사건으로 같은 상황을 다시 입력하는 경우입니다.";
  const ids: string[] = [];
  for (let index = 0; index < 2; index++) {
    await page.goto("/cases/new");
    await page.getByRole("textbox", { name: "지금까지 있었던 일" }).fill(narrative);
    await page.getByRole("button", { name: "저장하고 질문 시작" }).click();
    await expect(page).toHaveURL(/\/intake/);
    ids.push(page.url().split("/")[4] ?? "");
  }
  expect(ids[0]).not.toBe(ids[1]);
  await page.goto("/cases");
  await expect(page.locator(".intake-case-card")).toHaveCount(2);
});

test("pending intake keeps polling until the API exposes a completed summary", async ({ page }) => {
  await page.goto("/cases/new");
  await page
    .getByRole("textbox", { name: "지금까지 있었던 일" })
    .fill("합성 비동기 테스트입니다. 질문과 요약을 준비하는 API 상태를 확인합니다.");
  await page.getByRole("button", { name: "저장하고 질문 시작" }).click();
  await expect(page).toHaveURL(/\/intake/);
  await page.getByRole("textbox", { name: "답변", exact: true }).fill("합성 답변");
  await page.evaluate(async () => {
    const key = "baro-api-mock-v1:cases",
      items = JSON.parse(localStorage.getItem(key) ?? "{}");
    for (const item of Object.values(items) as { revision: number }[]) item.revision++;
    localStorage.setItem(key, JSON.stringify(items));
    const modulePath = "/src/client/api/core.ts";
    const { registerMockHandlers } = await import(modulePath);
    let calls = 0;
    registerMockHandlers({
      "cases.getQuestions": () => {
        calls++;
        return { questions: [], revision: 2, complete: calls >= 3, processing: calls < 3 };
      },
    });
  });
  await page.getByRole("button", { name: "답변 저장", exact: true }).click();
  await page.getByRole("button", { name: "최신 내용 불러오기" }).click();
  await expect(
    page.getByText("저장한 답변으로 다음 내용을 준비하고 있어요.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "요약 확인하기" })).toBeVisible({ timeout: 10000 });
});

async function lastQuestion(page: Page) {
  await page.goto("/cases/new");
  await page
    .getByRole("textbox", { name: "지금까지 있었던 일" })
    .fill("합성 복구 테스트입니다. 답변 저장 후 다음 질문을 준비하다 멈춘 상황입니다.");
  await page.getByRole("button", { name: "저장하고 질문 시작" }).click();
  for (let index = 0; index < 3; index++)
    await page.getByRole("button", { name: "모름", exact: true }).click();
  await page.getByRole("textbox", { name: "답변", exact: true }).fill("보존할 합성 답변");
}

test("generation transport retry keeps the saved answer and never saves it twice", async ({
  page,
}) => {
  await lastQuestion(page);
  await page.evaluate(async () => {
    const corePath = "/src/client/api/core.ts";
    const mockPath = "/src/client/api/mock/cases.ts";
    const { registerMockHandlers, ApiError } = await import(corePath);
    const { casesMockHandlers: handlers } = await import(mockPath);
    const counts = { saves: 0, advances: 0, reads: 0, revisions: [] as number[] };
    registerMockHandlers({
      "cases.saveAnswers": (input: unknown, context: { key: string }) => {
        counts.saves++;
        localStorage.setItem("synthetic-recovery-counts", JSON.stringify(counts));
        return handlers["cases.saveAnswers"](input, context);
      },
      "cases.advance": (input: { expectedRevision: number }, context: { key: string }) => {
        counts.advances++;
        counts.revisions.push(input.expectedRevision);
        localStorage.setItem("synthetic-recovery-counts", JSON.stringify(counts));
        if (counts.advances === 1) throw new ApiError("UNAVAILABLE", "합성 연결 실패", true);
        return handlers["cases.advance"](input, context);
      },
      "cases.getQuestions": (input: unknown) => {
        counts.reads++;
        localStorage.setItem("synthetic-recovery-counts", JSON.stringify(counts));
        return handlers["cases.getQuestions"](input);
      },
    });
  });
  await page.getByRole("button", { name: "저장하고 다음 단계" }).click();
  await expect(page.getByRole("alert")).toContainText("합성 연결 실패");
  await expect(page.getByRole("textbox", { name: "답변", exact: true })).toHaveValue(
    "보존할 합성 답변",
  );
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(page).toHaveURL(/\/summary/);
  await expect(page.getByRole("textbox", { name: "요약 편집" })).toHaveValue(/보존할 합성 답변/);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("synthetic-recovery-counts") ?? "{}"),
    ),
  ).toEqual({ saves: 1, advances: 2, reads: 0, revisions: [5, 5] });
});

for (const retryable of [true, false]) {
  test(`output rejection preserves answers and offers only available recovery (retryable=${retryable})`, async ({
    page,
  }) => {
    await lastQuestion(page);
    await page.evaluate(async (retryable) => {
      const corePath = "/src/client/api/core.ts";
      const mockPath = "/src/client/api/mock/cases.ts";
      const { registerMockHandlers } = await import(corePath);
      const { casesMockHandlers: handlers } = await import(mockPath);
      let advances = 0;
      registerMockHandlers({
        "cases.advance": (input: { id: string }, context: { key: string }) => {
          if (++advances === 1) {
            // Admission and terminal failure each advance the real workspace.
            // A user retry therefore starts from the failed job's new revision.
            const key = "baro-api-mock-v1:cases";
            const items = JSON.parse(localStorage.getItem(key) ?? "{}");
            items[input.id].revision += 2;
            localStorage.setItem(key, JSON.stringify(items));
            return {
              ...handlers["cases.getQuestions"](input),
              failed: true,
              retryable,
              failure: "POLICY_REJECTED",
            };
          }
          return handlers["cases.advance"](input, context);
        },
      });
    }, retryable);
    await page.getByRole("button", { name: "저장하고 다음 단계" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "AI가 다음 질문이나 요약을 준비하지 못했어요",
    );
    await expect(page.getByRole("alert")).toContainText("저장한 답변은 그대로 남아 있어요");
    await expect(page.getByRole("alert")).not.toContainText("POLICY_REJECTED");
    await expect(page.getByRole("link", { name: "나중에 이어하기" })).toBeVisible();
    if (retryable) {
      await page.getByRole("button", { name: "다시 준비하기" }).click();
    } else {
      await expect(page.getByRole("button", { name: "다시 준비하기" })).toHaveCount(0);
      await page.getByRole("button", { name: "저장한 답변 확인·수정" }).click();
      await expect(page.getByRole("textbox", { name: "답변", exact: true })).toHaveValue(
        "보존할 합성 답변",
      );
      await page.getByRole("textbox", { name: "답변", exact: true }).fill("수정한 합성 답변");
      await page.getByRole("button", { name: "저장하고 다음 단계" }).click();
    }
    await expect(page).toHaveURL(/\/summary/);
    await expect(page.getByRole("textbox", { name: "요약 편집" })).toHaveValue(
      retryable ? /보존할 합성 답변/ : /수정한 합성 답변/,
    );
  });
}
