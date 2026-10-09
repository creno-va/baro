import { expect, type Page, test } from "@playwright/test";
import type { QuestionsResult } from "../../src/client/api/cases";
import type { CaseView, WorkspaceView } from "../../src/client/api/types";

test("peer answer changes preserve the unsaved draft until explicit conflict recovery", async ({
  page,
}) => {
  await page.goto("/cases/new");
  await page
    .getByLabel("지금까지 있었던 일")
    .fill("합성 초안 충돌 검증입니다. 다른 탭에서 저장한 답변을 확인합니다.");
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  const editor = page.getByRole("textbox", { name: "답변", exact: true });
  await editor.fill("현재 탭에서 아직 저장하지 않은 답변");
  await page.evaluate(async () => {
    const modulePath = "/src/client/api/index.ts";
    const { api } = await import(modulePath);
    const id = location.pathname.split("/")[2];
    const questions = await api.cases.getQuestions(id);
    await api.cases.saveAnswers(id, {
      expectedRevision: questions.revision,
      answers: [
        {
          questionId: questions.questions[0].id,
          state: "answered",
          value: "다른 탭에서 저장한 답변",
        },
      ],
    });
    window.dispatchEvent(new Event("focus"));
  });
  await expect(page.getByRole("alert")).toContainText("작성 중인 답변은 남겨뒀어요");
  await expect(editor).toHaveValue("현재 탭에서 아직 저장하지 않은 답변");
  await expect(page.getByRole("button", { name: "저장하고 다음 질문" })).toBeDisabled();
  await page.getByRole("button", { name: "최신 내용 불러오기" }).click();
  await expect(editor).toHaveValue("다른 탭에서 저장한 답변");
  await expect(page.getByRole("button", { name: "저장하고 다음 질문" })).toBeEnabled();
});

async function recoveryWorkspace(page: Page) {
  await page.goto("/cases/new");
  await page
    .getByLabel("지금까지 있었던 일")
    .fill("합성 사건 복구 검증입니다. 계약 날짜와 준비할 자료를 정리합니다.");
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "모름", exact: true }).click();
  await page.getByLabel("요약이 내가 이야기한 사실과 맞는지 확인했어요.").check();
  await page.getByRole("button", { name: "요약 확인하고 계속" }).click();
  await page.getByRole("button", { name: "확인하고 사건 열기" }).click();
  await expect(page.getByRole("textbox", { name: "추가 사실 또는 질문" })).toBeVisible();
}

type CustomerReadRace = {
  reads: number;
  holdingSession: boolean;
  sessionHeld: boolean;
  oldDelivered: boolean;
  releaseOld: () => void;
  releaseNew: () => void;
};
for (const kind of ["list", "workspace"] as const) {
  test(`${kind} keeps the latest snapshot when an older read arrives during session verification`, async ({
    page,
  }) => {
    await recoveryWorkspace(page);
    if (kind === "list") {
      await page.goto("/cases");
      await expect(page.locator(".intake-case-card")).toHaveCount(1);
    }
    await page.evaluate(async (kind) => {
      const modulePath = "/src/client/api/index.ts";
      const { api } = await import(modulePath);
      const state: CustomerReadRace = {
        reads: 0,
        holdingSession: false,
        sessionHeld: false,
        oldDelivered: false,
        releaseOld: () => {},
        releaseNew: () => {},
      };
      (window as unknown as { customerReadRace: CustomerReadRace }).customerReadRace = state;
      // AppNavigation also reads cases/session; schedule only the screen under test.
      const owner = kind === "list" ? "CaseList.tsx" : "Workspace.tsx";
      const session = api.session.get.bind(api.session);
      api.session.get = async () => {
        const owned = new Error().stack?.includes(owner);
        const value = await session();
        if (owned && state.holdingSession) {
          state.holdingSession = false;
          state.sessionHeld = true;
          await new Promise<void>((resolve) => {
            state.releaseNew = resolve;
          });
        }
        return value;
      };
      const wrap = async <T>(read: () => Promise<T>, update: (value: T) => T) => {
        const owned = new Error().stack?.includes(owner);
        const value = await read();
        if (!owned) return value;
        const ordinal = ++state.reads;
        if (ordinal === 1) {
          await new Promise<void>((resolve) => {
            state.releaseOld = resolve;
          });
          state.oldDelivered = true;
          return value;
        }
        if (ordinal === 2) {
          state.holdingSession = true;
          return update(value);
        }
        return value;
      };
      if (kind === "list") {
        const original = api.cases.list.bind(api.cases);
        api.cases = {
          ...api.cases,
          list: () =>
            wrap<CaseView[]>(original, (items) =>
              items.map((item) => ({ ...item, title: "최신 조회 복구 결과" })),
            ),
        };
      } else {
        const original = api.workspace.get.bind(api.workspace);
        api.workspace = {
          ...api.workspace,
          get: (id: string) =>
            wrap<WorkspaceView>(
              () => original(id),
              (view) => ({ ...view, case: { ...view.case, title: "최신 조회 복구 결과" } }),
            ),
        };
      }
      window.dispatchEvent(new Event("focus"));
    }, kind);
    const state = () =>
      page.evaluate(() => {
        const s = (window as unknown as { customerReadRace: CustomerReadRace }).customerReadRace;
        return { reads: s.reads, sessionHeld: s.sessionHeld, oldDelivered: s.oldDelivered };
      });
    await expect.poll(async () => (await state()).reads).toBe(1);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(async () => (await state()).sessionHeld).toBe(true);
    await page.evaluate(() =>
      (window as unknown as { customerReadRace: CustomerReadRace }).customerReadRace.releaseOld(),
    );
    await expect.poll(async () => (await state()).oldDelivered).toBe(true);
    await page.evaluate(() =>
      (window as unknown as { customerReadRace: CustomerReadRace }).customerReadRace.releaseNew(),
    );
    await expect(
      page.getByRole("main").getByText("최신 조회 복구 결과", { exact: true }),
    ).toBeVisible();
  });
}

test("pending workspace files keep polling after a transient failure and stop on completion", async ({
  page,
}) => {
  await recoveryWorkspace(page);
  await page.getByRole("link", { name: "자료 0", exact: true }).click();
  await expect(page.getByRole("heading", { name: "사건 자료", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const modulePath = "/src/client/api/index.ts";
    const { api } = await import(modulePath);
    const original = api.workspace.get.bind(api.workspace);
    const state = { reads: 0 };
    (window as unknown as { customerPoll: typeof state }).customerPoll = state;
    api.workspace = {
      ...api.workspace,
      get: async (id: string) => {
        const owned = new Error().stack?.includes("Workspace.tsx");
        if (!owned) return original(id);
        const ordinal = ++state.reads;
        if (ordinal === 2)
          throw Object.assign(new Error("합성 일시 조회 실패"), {
            code: "UNAVAILABLE",
            retryable: true,
          });
        const value = await original(id);
        return {
          ...value,
          files: [
            {
              id: "synthetic-processing-file",
              name: "합성 처리 자료.txt",
              mimeType: "text/plain",
              sizeBytes: 12,
              status: ordinal === 1 ? "processing" : "ready",
              coverage: "합성 처리 범위",
              extractedText: "합성 추출 내용",
            },
          ],
        };
      },
    };
    window.dispatchEvent(new Event("focus"));
  });
  const reads = () =>
    page.evaluate(
      () => (window as unknown as { customerPoll: { reads: number } }).customerPoll.reads,
    );
  await expect.poll(reads).toBe(2);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect.poll(reads, { timeout: 6000 }).toBe(3);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("합성 처리 자료.txt", { exact: true })).toBeVisible();
  await expect(page.getByText("결과 확인 가능", { exact: true })).toBeVisible();
  // Two polling periods pass without any further workspace read after completion.
  await page.waitForTimeout(3800);
  expect(await reads()).toBe(3);
});

async function capture(page: Page, name: string) {
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({
    path: `/tmp/baro-simple-intake-${name}.png`,
    fullPage: true,
    animations: "disabled",
  });
}

async function openAnswerTools(page: Page) {
  const tools = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "답변 관리" }) });
  await expect(tools).toBeVisible();
  if (!(await tools.evaluate((element) => element.hasAttribute("open"))))
    await tools.locator("summary").click();
}

async function holdGeneration(page: Page, stage: "questions" | "summary", failed = false) {
  await page.evaluate(
    async ({ processingStage, failed }) => {
      const modulePath = "/src/client/api/core.ts";
      const fixturePath = "/src/client/api/mock/cases.ts";
      const { registerMockHandlers } = await import(modulePath);
      const { casesMockHandlers } = await import(fixturePath);
      const state = { ready: false, polls: 0 };
      (window as unknown as { intakeGeneration: typeof state }).intakeGeneration = state;
      let pending = false;
      let delivered = false;
      registerMockHandlers({
        "cases.advance": (raw: unknown, context: { key: string }) => {
          if (delivered) return casesMockHandlers["cases.advance"](raw, context);
          pending = true;
          return {
            ...casesMockHandlers["cases.getQuestions"](raw),
            processing: true,
            processingStage,
          };
        },
        "cases.getQuestions": (raw: unknown) => {
          const current = casesMockHandlers["cases.getQuestions"](raw);
          if (!pending)
            return {
              ...current,
              failed: failed && !delivered,
              retryable: failed && !delivered,
              processingStage,
            };
          state.polls++;
          if (!state.ready) return { ...current, processing: true, processingStage };
          pending = false;
          delivered = true;
          return casesMockHandlers["cases.advance"](
            { id: (raw as { id: string }).id, expectedRevision: current.revision },
            { key: "synthetic-summary-completion" },
          );
        },
      });
    },
    { processingStage: stage, failed },
  );
}

async function finishGeneration(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { intakeGeneration: { ready: boolean } }).intakeGeneration.ready = true;
  });
}

type InitialGenerationState = {
  ready: boolean;
  polls: number;
  advances: number;
  postflightPending: boolean;
  sessionReads: number;
  releasePostflight?: () => void;
};

async function initialGeneration(
  page: Page,
  options: { failFirstPoll?: boolean; pausePostflight?: boolean } = {},
) {
  await page.goto("/cases/new");
  await page
    .getByRole("textbox", { name: "지금까지 있었던 일" })
    .fill("합성 첫 질문 테스트입니다. 지인에게 빌려준 돈을 돌려받지 못했어요.");
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  await expect(page.getByRole("heading", { name: "이 일은 언제 시작됐나요?" })).toBeVisible();
  const published: QuestionsResult = await page.evaluate(async () => {
    const modulePath = "/src/client/api/mock/cases.ts";
    const { casesMockHandlers } = await import(modulePath);
    const id = location.pathname.split("/")[2];
    if (!id) throw new Error("Synthetic intake case id is missing");
    const questions = casesMockHandlers["cases.getQuestions"]({ id });
    const key = "baro-api-mock-v1:intake";
    const records = JSON.parse(localStorage.getItem(key) ?? "{}");
    records[id].questions = [];
    records[id].rounds = [];
    localStorage.setItem(key, JSON.stringify(records));
    return questions;
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "질문 시작하기" })).toBeVisible();
  await page.evaluate(
    async ({ published, options }) => {
      const corePath = "/src/client/api/core.ts";
      const mockPath = "/src/client/api/mock/cases.ts";
      const { registerMockHandlers, ApiError } = await import(corePath);
      const { casesMockHandlers } = await import(mockPath);
      const state: InitialGenerationState = {
        ready: false,
        polls: 0,
        advances: 0,
        postflightPending: false,
        sessionReads: 0,
      };
      (window as unknown as { initialGeneration: InitialGenerationState }).initialGeneration =
        state;
      let started = false;
      registerMockHandlers({
        "cases.advance": (input: unknown) => {
          state.advances++;
          started = true;
          return { ...casesMockHandlers["cases.getQuestions"](input), processing: true };
        },
        "cases.getQuestions": (input: unknown) => {
          const current = casesMockHandlers["cases.getQuestions"](input);
          if (!started) return current;
          state.polls++;
          if (options.failFirstPoll && state.polls === 1)
            throw new ApiError("UNAVAILABLE", "합성 질문 조회 연결 실패", true);
          return state.ready ? published : { ...current, processing: true };
        },
        "session.get": () => {
          const session = JSON.parse(localStorage.getItem("baro-api-mock-v1:session") ?? "{}");
          if (started) state.sessionReads++;
          if (started && options.pausePostflight && !state.postflightPending) {
            state.postflightPending = true;
            return new Promise((resolve) => {
              state.releasePostflight = () => resolve(session);
            });
          }
          return session;
        },
      });
    },
    { published, options },
  );
}

async function initialGenerationState(page: Page) {
  return page.evaluate(() => {
    const state = (window as unknown as { initialGeneration: InitialGenerationState })
      .initialGeneration;
    return { polls: state.polls, advances: state.advances, sessionReads: state.sessionReads };
  });
}

async function publishInitialQuestions(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { initialGeneration: InitialGenerationState }).initialGeneration.ready =
      true;
  });
  await expect(page.getByRole("heading", { name: "이 일은 언제 시작됐나요?" })).toBeVisible({
    timeout: 8000,
  });
  await expect(page.getByRole("textbox", { name: "답변", exact: true })).toBeEnabled();
  expect((await initialGenerationState(page)).advances).toBe(1);
}

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

test("initial question generation stays pending and appears without refreshing", async ({
  page,
}) => {
  await initialGeneration(page);
  await page.getByRole("button", { name: "질문 시작하기" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "다음 질문을 준비하고 있어요" }),
  ).toBeVisible();
  await expect.poll(async () => (await initialGenerationState(page)).polls).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "질문 시작하기" })).toHaveCount(0);
  await publishInitialQuestions(page);
});

test("initial question generation resumes after a transient polling failure without refreshing", async ({
  page,
}) => {
  await initialGeneration(page, { failFirstPoll: true });
  await page.getByRole("button", { name: "질문 시작하기" }).click();
  await expect(page.getByRole("alert")).toContainText("합성 질문 조회 연결 실패");
  await publishInitialQuestions(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect((await initialGenerationState(page)).polls).toBeGreaterThan(1);
});

test("initial question generation recovers when focus supersedes its session check", async ({
  page,
}) => {
  await initialGeneration(page, { pausePostflight: true });
  await page.getByRole("button", { name: "질문 시작하기" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { initialGeneration: InitialGenerationState }).initialGeneration
            .postflightPending,
      ),
    )
    .toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect
    .poll(async () => (await initialGenerationState(page)).sessionReads)
    .toBeGreaterThan(1);
  await page.evaluate(() => {
    (
      window as unknown as { initialGeneration: InitialGenerationState }
    ).initialGeneration.releasePostflight?.();
  });
  await publishInitialQuestions(page);
});

test("initial question recovery never reveals the previous account after a session switch", async ({
  page,
}) => {
  await initialGeneration(page, { pausePostflight: true });
  await page.getByRole("button", { name: "질문 시작하기" }).click();
  await expect.poll(async () => (await initialGenerationState(page)).sessionReads).toBe(1);
  await page.evaluate(() => {
    localStorage.setItem(
      "baro-api-mock-v1:session",
      JSON.stringify({
        user: { id: "other-synthetic-customer", name: "다른 합성 고객", accountType: "customer" },
        needsConsent: false,
      }),
    );
    window.dispatchEvent(new Event("focus"));
  });
  await expect(page.getByRole("alert")).toBeVisible();
  await page.evaluate(() => {
    const state = (window as unknown as { initialGeneration: InitialGenerationState })
      .initialGeneration;
    state.ready = true;
    state.releasePostflight?.();
  });
  await expect(page.getByRole("heading", { name: "이 일은 언제 시작됐나요?" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "질문 시작하기" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "답변", exact: true })).toHaveCount(0);
  expect((await initialGenerationState(page)).advances).toBe(1);
});

test("initial question completion respects a case archived in another tab", async ({ page }) => {
  await initialGeneration(page);
  await page.getByRole("button", { name: "질문 시작하기" }).click();
  await expect.poll(async () => (await initialGenerationState(page)).polls).toBeGreaterThan(0);
  await page.evaluate(() => {
    const id = location.pathname.split("/")[2];
    if (!id) throw new Error("Synthetic intake case id is missing");
    const key = "baro-api-mock-v1:cases";
    const records = JSON.parse(localStorage.getItem(key) ?? "{}");
    records[id].stage = "archived";
    localStorage.setItem(key, JSON.stringify(records));
    (window as unknown as { initialGeneration: InitialGenerationState }).initialGeneration.ready =
      true;
  });
  await expect(page.getByRole("link", { name: "사건 열기", exact: true })).toBeVisible({
    timeout: 8000,
  });
  await expect(page.getByRole("heading", { name: "이 일은 언제 시작됐나요?" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "답변", exact: true })).toHaveCount(0);
  expect((await initialGenerationState(page)).advances).toBe(1);
});

test("two-round mobile flow saves/reloads/resumes/back edits/skips and reaches workspace", async ({
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
  await expect(page.locator("#main-content")).toHaveCSS("view-transition-name", "none");
  await page.getByRole("link", { name: "첫 사건 만들기" }).click();
  await expect(page.locator(".conversation-home")).toHaveCSS("view-transition-name", "intake-page");
  const narrative = page.getByRole("textbox", { name: "지금까지 있었던 일" });
  await narrative.fill(
    "합성 사건입니다. 지난달 지인에게 빌려준 돈을 약속한 날짜가 지나도 돌려받지 못했습니다.",
  );
  await capture(page, "input-mobile");
  await page.getByRole("button", { name: "저장하고 계속" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/intake/);
  await expect(page.getByRole("heading", { name: "이 일은 언제 시작됐나요?" })).toBeVisible();
  await expect(page.locator("#main-content")).toHaveCSS("view-transition-name", "none");
  await expect(page.locator(".intake-flow")).toHaveCSS("view-transition-name", "intake-page");
  await capture(page, "question-mobile");
  await page.setViewportSize({ width: 1280, height: 900 });
  await capture(page, "question-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "답변 저장", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "나중에 이어하기" })).toBeHidden();
  await page.getByRole("textbox", { name: "답변", exact: true }).fill("2026년 9월");
  await openAnswerTools(page);
  await page.getByRole("button", { name: "답변 저장", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "답변이 저장됐어요" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "답변", exact: true })).toHaveValue("2026년 9월");
  await page.getByRole("button", { name: "저장하고 다음 질문" }).click();
  await expect(page.getByRole("heading", { name: "얼마의 금액이 관련되어 있나요?" })).toBeVisible();
  await openAnswerTools(page);
  await page.getByRole("button", { name: "이전 질문" }).click();
  await page.getByRole("textbox", { name: "답변", exact: true }).fill("2026년 8월");
  await page.getByRole("button", { name: "저장하고 다음 질문" }).click();
  await openAnswerTools(page);
  const resumeLater = page.getByRole("button", { name: "나중에 이어하기" });
  await resumeLater.click();
  const exitDialog = page.getByRole("dialog", { name: "내 사건에서 다시 이어갈 수 있어요" });
  await expect(exitDialog).toBeVisible();
  await expect(exitDialog).toHaveJSProperty("open", true);
  await expect(exitDialog.getByRole("button", { name: "닫기", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(exitDialog.getByRole("button", { name: "계속 답하기" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(exitDialog.getByRole("button", { name: "닫기", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(exitDialog).toBeHidden();
  await expect(resumeLater).toBeFocused();
  await resumeLater.press("Enter");
  await page.getByRole("link", { name: "목록으로 이동" }).click();
  await page.getByRole("link").filter({ hasText: "이어 답하기" }).click();
  await expect(
    page.getByRole("heading", {
      name: "얼마의 금액이 관련되어 있나요?",
    }),
  ).toBeVisible();
  await openAnswerTools(page);
  await page.getByRole("button", { name: "이전 질문" }).click();
  await expect(page.getByRole("textbox", { name: "답변", exact: true })).toHaveValue("2026년 8월");
  await page.getByRole("button", { name: "저장하고 다음 질문" }).click();
  await page.getByRole("button", { name: "건너뛰기", exact: true }).click();
  await expect(page.getByText("1차 질문 · 3 / 3", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => {
      const records = JSON.parse(localStorage.getItem("baro-api-mock-v1:intake") ?? "{}");
      return (Object.values(records) as { questions: unknown[] }[]).map(
        (item) => item.questions.length,
      );
    }),
  ).toEqual([3]);
  await page
    .getByRole("textbox", { name: "답변", exact: true })
    .fill("약속한 돈을 돌려받고 싶어요.");
  await page.getByRole("button", { name: "저장하고 2차 질문 보기" }).click();
  await expect(page.getByText("2차 질문 · 1 / 3", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "모름", exact: true }).click();
  await page.getByRole("radio", { name: "문자·메신저·녹음이 있어요" }).check();
  await page.getByRole("button", { name: "저장하고 다음 질문" }).click();
  await expect(page.getByText("2차 질문 · 3 / 3", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "건너뛰기", exact: true }).click();
  await expect(page).toHaveURL(/\/summary/);
  const summary = page.getByRole("textbox", { name: "요약 편집" });
  await expect(summary).toHaveValue(/2026년 8월/);
  await expect(summary).toHaveValue(/건너뛰기/);
  await expect(page.getByRole("button", { name: "수정 내용 저장" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "수정 취소", exact: true })).toHaveCount(0);
  await capture(page, "summary-mobile");
  await page.setViewportSize({ width: 1280, height: 900 });
  await capture(page, "summary-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => {
      const records = JSON.parse(localStorage.getItem("baro-api-mock-v1:intake") ?? "{}");
      return (Object.values(records) as { questions: unknown[] }[]).map(
        (item) => item.questions.length,
      );
    }),
  ).toEqual([6]);
  const old = await summary.inputValue();
  await summary.fill(`${old}\n수정 취소 확인`);
  await page.getByRole("button", { name: "수정 취소", exact: true }).click();
  await expect(summary).toHaveValue(old);
  await expect(page.getByRole("button", { name: "수정 내용 저장" })).toHaveCount(0);
  await summary.fill(`${old}\n합성 추가 사실입니다.`);
  await page.getByRole("button", { name: "수정 내용 저장" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "수정한 요약이 저장됐어요" }),
  ).toBeVisible();
  const confirmation = page.getByRole("checkbox", { name: "요약이 내가 이야기한 사실과 맞는지" });
  await expect(confirmation).toBeFocused();
  await page.reload();
  await expect(summary).toHaveValue(/합성 추가 사실입니다/);
  await confirmation.check();
  const reviewSummary = page.getByRole("button", { name: "요약 확인하고 계속" });
  await reviewSummary.click();
  const confirmDialog = page.getByRole("dialog", { name: "이제 사건 정리를 시작할까요?" });
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog.getByRole("button", { name: "닫기", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(confirmDialog.getByRole("button", { name: "취소", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmDialog).toBeHidden();
  await expect(reviewSummary).toBeFocused();
  await reviewSummary.press("Enter");
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(reviewSummary).toBeFocused();
  await reviewSummary.press("Enter");
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
  await page.getByRole("button", { name: "저장하고 계속" }).click();
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
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "모름", exact: true }).click();
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
  await page.getByRole("checkbox", { name: "요약이 내가 이야기한 사실과 맞는지" }).focus();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("checkbox", { name: "요약이 내가 이야기한 사실과 맞는지" }),
  ).toBeChecked();
});

test("summary returns to editable questions and regenerates after a prior answer changes", async ({
  page,
}) => {
  await page.goto("/cases/new");
  await page
    .getByRole("textbox", { name: "지금까지 있었던 일" })
    .fill("합성 수정 테스트입니다. 질문에 답한 뒤 요약에서 이전 답변을 고쳐 봅니다.");
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "모름", exact: true }).click();
  await expect(page).toHaveURL(/\/summary/);
  await page.getByRole("link", { name: "이전 답변 수정하기" }).click();
  await page.getByRole("textbox", { name: "답변", exact: true }).fill("2026년 7월로 수정");
  for (let index = 0; index < 5; index++)
    await page.getByRole("button", { name: /^저장하고 (다음 질문|2차 질문 보기)$/ }).click();
  await page.getByRole("button", { name: "저장하고 요약 보기" }).click();
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
    await page.getByRole("button", { name: "저장하고 계속" }).click();
    await expect(page).toHaveURL(/\/intake/);
    ids.push(page.url().split("/")[4] ?? "");
  }
  expect(ids[0]).not.toBe(ids[1]);
  await page.goto("/cases");
  await expect(page.locator(".intake-case-card")).toHaveCount(2);
});

test("new follow-up generation retains the submitted answer and polls past the stale question URL", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/cases/new");
  await page
    .getByRole("textbox", { name: "지금까지 있었던 일" })
    .fill("합성 비동기 테스트입니다. 지인에게 빌려준 돈을 아직 돌려받지 못했어요.");
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  for (let index = 0; index < 2; index++)
    await page.getByRole("button", { name: "모름", exact: true }).click();
  const first = page.getByRole("heading", { name: "이번 일을 어떻게 정리하고 싶나요?" });
  const answer = page.getByRole("textbox", { name: "답변", exact: true });
  await expect(first).toBeVisible();
  await holdGeneration(page, "questions");
  await answer.fill("2026년 8월에 시작했어요.");
  await page.getByRole("button", { name: "저장하고 2차 질문 보기" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "다음 질문을 준비하고 있어요" }),
  ).toBeVisible();
  await expect(first).toBeVisible();
  await expect(answer).toHaveValue("2026년 8월에 시작했어요.");
  await expect(answer).toBeDisabled();
  await capture(page, "pending-mobile");
  await openAnswerTools(page);
  await expect(page.getByRole("button", { name: "이전 질문" })).toBeDisabled();
  await expect(page).toHaveURL(/question=2/);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { intakeGeneration: { polls: number } }).intakeGeneration.polls,
      ),
    )
    .toBeGreaterThan(0);
  await expect(first).toBeVisible();
  await expect(answer).toHaveValue("2026년 8월에 시작했어요.");
  await finishGeneration(page);
  await expect(page.getByRole("heading", { name: "상대방과 어떤 약속을 했나요?" })).toBeVisible({
    timeout: 10000,
  });
  await expect(page).toHaveURL(/question=3/);
  await expect(answer).toBeEnabled();
  await expect(answer).toHaveValue("");
  for (let index = 0; index < 3; index++)
    await page.getByRole("button", { name: "모름", exact: true }).click();
  await expect(page).toHaveURL(/\/summary/);
  await expect(page.getByRole("textbox", { name: "요약 편집" })).toHaveValue(/2026년 8월/);
});

for (const editing of [false, true]) {
  test(`${editing ? "edited" : "new"} summary generation stays on the final answer and opens the summary when ready`, async ({
    page,
  }) => {
    await page.goto("/cases/new");
    await page
      .getByRole("textbox", { name: "지금까지 있었던 일" })
      .fill("합성 요약 대기 테스트입니다. 지인에게 빌려준 돈과 약속 날짜를 정리해요.");
    await page.getByRole("button", { name: "저장하고 계속" }).click();
    for (let index = 0; index < 5; index++)
      await page.getByRole("button", { name: "모름", exact: true }).click();
    if (editing) {
      await page.getByRole("button", { name: "모름", exact: true }).click();
      await expect(page).toHaveURL(/\/summary/);
      await page.getByRole("link", { name: "이전 답변 수정하기" }).click();
      await expect(page).toHaveURL(/edit=1/);
      for (let index = 0; index < 5; index++)
        await page.getByRole("button", { name: /^저장하고 (다음 질문|2차 질문 보기)$/ }).click();
    }
    const second = page.getByRole("heading", {
      name: "내 입장에 불리하거나, 서로 다르게 기억하는 내용이 있나요?",
    });
    const answer = page.getByRole("textbox", { name: "답변", exact: true });
    await expect(second).toBeVisible();
    await holdGeneration(page, "summary");
    await answer.fill("100만 원을 빌려줬어요.");
    await page.getByRole("button", { name: "저장하고 요약 보기" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "사건 요약을 정리하고 있어요" }),
    ).toBeVisible();
    await expect(second).toBeVisible();
    await expect(answer).toHaveValue("100만 원을 빌려줬어요.");
    await expect(answer).toBeDisabled();
    await capture(page, "summary-pending-desktop");
    await expect(page.getByRole("heading", { name: "이 일은 언제 시작됐나요?" })).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { intakeGeneration: { polls: number } }).intakeGeneration.polls,
        ),
      )
      .toBeGreaterThan(0);
    await expect(second).toBeVisible();
    await expect(page).toHaveURL(/question=5/);
    await expect(page).not.toHaveURL(/edit=1/);
    await finishGeneration(page);
    await expect(page).toHaveURL(/\/summary/, { timeout: 10000 });
    await expect(page.getByRole("textbox", { name: "요약 편집" })).toHaveValue(/100만 원/);
  });
}

test("returning to the tab preserves a draft on a previous question", async ({ page }) => {
  await page.goto("/cases/new");
  await page
    .getByRole("textbox", { name: "지금까지 있었던 일" })
    .fill("합성 포커스 복귀 테스트입니다. 지난달에 빌려준 돈과 약속 날짜를 확인합니다.");
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  const answer = page.getByRole("textbox", { name: "답변", exact: true });
  await answer.fill("2026년 8월");
  await page.getByRole("button", { name: "저장하고 다음 질문" }).click();
  await openAnswerTools(page);
  await page.getByRole("button", { name: "이전 질문" }).click();
  await answer.fill("아직 저장하지 않은 2026년 9월 답변");
  await page.evaluate(async () => {
    const corePath = "/src/client/api/core.ts";
    const fixturePath = "/src/client/api/mock/cases.ts";
    const { registerMockHandlers } = await import(corePath);
    const { casesMockHandlers } = await import(fixturePath);
    const state = { calls: 0 };
    (window as unknown as { intakeRefresh: typeof state }).intakeRefresh = state;
    registerMockHandlers({
      "cases.getQuestions": (raw: unknown) => {
        state.calls++;
        return casesMockHandlers["cases.getQuestions"](raw);
      },
    });
    window.dispatchEvent(new Event("focus"));
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { intakeRefresh: { calls: number } }).intakeRefresh.calls,
      ),
    )
    .toBeGreaterThan(0);
  await expect(page.getByRole("heading", { name: "이 일은 언제 시작됐나요?" })).toBeVisible();
  await expect(answer).toHaveValue("아직 저장하지 않은 2026년 9월 답변");
  await expect(page).toHaveURL(/question=0/);
});

test("retrying a failed summary saves the edited answer before generation", async ({ page }) => {
  await page.goto("/cases/new");
  await page
    .getByRole("textbox", { name: "지금까지 있었던 일" })
    .fill("합성 재시도 테스트입니다. 지인에게 빌려준 돈을 정리하다가 요약 준비에 실패했어요.");
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  for (let index = 0; index < 5; index++)
    await page.getByRole("button", { name: "모름", exact: true }).click();
  const answer = page.getByRole("textbox", { name: "답변", exact: true });
  await answer.fill("처음에는 100만 원이라고 적었어요.");
  await openAnswerTools(page);
  await page.getByRole("button", { name: "답변 저장", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "답변이 저장됐어요" })).toBeVisible();
  await holdGeneration(page, "summary", true);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("button", { name: "다시 준비하기", exact: true })).toBeVisible();
  await answer.fill("확인해 보니 200만 원이에요.");
  await page.getByRole("button", { name: "답변 저장하고 다시 준비하기", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "사건 요약을 정리하고 있어요" }),
  ).toBeVisible();
  await expect(answer).toHaveValue("확인해 보니 200만 원이에요.");
  await finishGeneration(page);
  await expect(page).toHaveURL(/\/summary/, { timeout: 10000 });
  await expect(page.getByRole("textbox", { name: "요약 편집" })).toHaveValue(/200만 원/);
  await expect(page.getByRole("textbox", { name: "요약 편집" })).not.toHaveValue(/100만 원/);
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`question transition waits for the saved response with ${reducedMotion} motion`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    await page.goto("/cases/new");
    await page
      .getByRole("textbox", { name: "지금까지 있었던 일" })
      .fill("합성 전환 테스트입니다. 지인에게 빌려준 돈과 약속 날짜를 차분히 정리하고 싶어요.");
    await page.getByRole("button", { name: "저장하고 계속" }).click();
    const first = page.getByRole("heading", { name: "이 일은 언제 시작됐나요?" });
    const second = page.getByRole("heading", { name: "얼마의 금액이 관련되어 있나요?" });
    const answer = page.getByRole("textbox", { name: "답변", exact: true });
    await expect(first).toBeVisible();
    const scene = page.locator(".intake-scene");
    const content = page.locator(".intake-scene-content");
    if (reducedMotion === "reduce") {
      await expect(content).toHaveCSS("animation-name", "none");
    } else {
      expect(
        await content.evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).animationDuration),
        ),
      ).toBeGreaterThan(0);
    }
    await page.evaluate(async () => {
      const corePath = "/src/client/api/core.ts";
      const fixturePath = "/src/client/api/mock/cases.ts";
      const { registerMockHandlers } = await import(corePath);
      const { casesMockHandlers } = await import(fixturePath);
      const state = { started: false, release: () => {} };
      (window as unknown as { intakeSave: typeof state }).intakeSave = state;
      registerMockHandlers({
        "cases.saveAnswers": async (raw: unknown, context: { key: string }) => {
          state.started = true;
          await new Promise<void>((resolve) => {
            state.release = resolve;
          });
          return casesMockHandlers["cases.saveAnswers"](raw, context);
        },
      });
    });
    await answer.fill("2026년 9월부터예요.");
    await page.getByRole("button", { name: "저장하고 다음 질문" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { intakeSave: { started: boolean } }).intakeSave.started,
        ),
      )
      .toBe(true);
    await expect(first).toBeVisible();
    await expect(second).toHaveCount(0);
    await expect(answer).toHaveValue("2026년 9월부터예요.");
    await expect(answer).toBeDisabled();
    await expect(page).toHaveURL(/question=0/);
    await expect(scene).not.toHaveAttribute("data-transition", "leaving");
    await page.evaluate(() => {
      (window as unknown as { intakeSave: { release: () => void } }).intakeSave.release();
    });
    await expect(second).toBeVisible();
    await expect(second).toBeFocused();
    await expect(page).toHaveURL(/question=1/);
    await expect(answer).toBeEnabled();
    await expect(answer).toHaveValue("");
    if (reducedMotion === "reduce") await expect(content).toHaveCSS("animation-name", "none");
  });
}
async function lastQuestion(page: Page) {
  await page.goto("/cases/new");
  await page
    .getByRole("textbox", { name: "지금까지 있었던 일" })
    .fill("합성 복구 테스트입니다. 답변 저장 후 다음 질문을 준비하다 멈춘 상황입니다.");
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  for (let index = 0; index < 5; index++)
    await page.getByRole("button", { name: "모름", exact: true }).click();
  await page.getByRole("textbox", { name: "답변", exact: true }).fill("보존할 합성 답변");
}

for (const action of ["refresh", "save"] as const) {
  for (const outcome of ["success", "failure"] as const) {
    test(`summary ${action} ignores an older ${outcome} after a newer snapshot`, async ({
      page,
    }) => {
      await lastQuestion(page);
      await page.getByRole("button", { name: "저장하고 요약 보기" }).click();
      const editor = page.getByRole("textbox", { name: "요약 편집" });
      await expect(editor).toHaveValue(/보존할 합성 답변/);
      await page.evaluate(async (outcome) => {
        const corePath = "/src/client/api/core.ts";
        const mockPath = "/src/client/api/mock/cases.ts";
        const { registerMockHandlers, ApiError } = await import(corePath);
        const { casesMockHandlers: handlers } = await import(mockPath);
        const state = { reads: 0, release: undefined as (() => void) | undefined };
        (window as unknown as { summaryReadRace: typeof state }).summaryReadRace = state;
        registerMockHandlers({
          "cases.get": (input: unknown) => {
            const snapshot = handlers["cases.get"](input);
            if (++state.reads !== 1) return snapshot;
            return new Promise((resolve, reject) => {
              state.release = () =>
                outcome === "success"
                  ? resolve(snapshot)
                  : reject(new ApiError("UNAVAILABLE", "합성 이전 조회 실패", true));
            });
          },
        });
      }, outcome);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              !!(window as unknown as { summaryReadRace: { release?: () => void } }).summaryReadRace
                .release,
          ),
        )
        .toBe(true);
      if (action === "save") {
        await editor.fill("다른 탭에서 저장한 최신 합성 요약입니다.");
        await page.getByRole("button", { name: "수정 내용 저장" }).click();
        await expect(page.getByText("수정한 요약이 저장됐어요.")).toBeVisible();
      } else {
        // A peer tab saves a newer revision while the first read is still pending.
        await page.evaluate(async () => {
          const mockPath = "/src/client/api/mock/cases.ts";
          const { casesMockHandlers: handlers } = await import(mockPath);
          const id = location.pathname.split("/")[2];
          const item = handlers["cases.get"]({ id });
          handlers["cases.saveSummary"](
            {
              id,
              expectedRevision: item.revision,
              summary: "다른 탭에서 저장한 최신 합성 요약입니다.",
            },
            { key: "synthetic-peer-summary-save" },
          );
          window.dispatchEvent(new Event("focus"));
        });
      }
      await expect(editor).toHaveValue("다른 탭에서 저장한 최신 합성 요약입니다.");
      const confirmation = page.getByRole("checkbox", {
        name: "요약이 내가 이야기한 사실과 맞는지",
      });
      await confirmation.check();
      await page.evaluate(async () => {
        (
          window as unknown as { summaryReadRace: { release?: () => void } }
        ).summaryReadRace.release?.();
        // Let the old response and its React updates settle before asserting absence.
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      });
      await expect(editor).toHaveValue("다른 탭에서 저장한 최신 합성 요약입니다.");
      await expect(confirmation).toBeChecked();
      await expect(page.getByRole("alert")).toHaveCount(0);
    });
  }
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
  await page.getByRole("button", { name: "저장하고 요약 보기" }).click();
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
  ).toEqual({ saves: 1, advances: 2, reads: 0, revisions: [8, 8] });
});

for (const recovery of [
  { retryable: true, canPrepareSummary: false },
  { retryable: false, canPrepareSummary: false },
  { retryable: false, canPrepareSummary: true },
]) {
  const { retryable, canPrepareSummary } = recovery;
  test(`output rejection preserves answers and offers only available recovery (retryable=${retryable}, summary=${canPrepareSummary})`, async ({
    page,
  }) => {
    await lastQuestion(page);
    await page.evaluate(async ({ retryable, canPrepareSummary }) => {
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
              canPrepareSummary,
              failure: "POLICY_REJECTED",
            };
          }
          return handlers["cases.advance"](input, context);
        },
      });
    }, recovery);
    await page.getByRole("button", { name: "저장하고 요약 보기" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "AI가 다음 질문이나 요약을 준비하지 못했어요",
    );
    await expect(page.getByRole("alert")).toContainText("저장한 답변은 그대로 남아 있어요");
    await expect(page.getByRole("alert")).not.toContainText("POLICY_REJECTED");
    await expect(page.getByRole("link", { name: "나중에 이어하기" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "답변", exact: true })).toHaveValue(
      "보존할 합성 답변",
    );
    if (canPrepareSummary) {
      await expect(page.getByRole("button", { name: "다시 준비하기", exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "저장한 답변으로 요약 보기" }).click();
    } else if (retryable) {
      await page.getByRole("button", { name: "다시 준비하기" }).click();
    } else {
      await expect(page.getByRole("button", { name: "다시 준비하기" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "저장하고 요약 보기" })).toBeDisabled();
      await page.getByRole("button", { name: "저장한 답변 확인·수정" }).click();
      await expect(page.getByRole("textbox", { name: "답변", exact: true })).toHaveValue(
        "보존할 합성 답변",
      );
      await page.getByRole("textbox", { name: "답변", exact: true }).fill("수정한 합성 답변");
      await page.getByRole("button", { name: "답변 저장하고 다시 준비하기" }).click();
    }
    await expect(page).toHaveURL(/\/summary/);
    await expect(page.getByRole("textbox", { name: "요약 편집" })).toHaveValue(
      retryable || canPrepareSummary ? /보존할 합성 답변/ : /수정한 합성 답변/,
    );
  });
}
