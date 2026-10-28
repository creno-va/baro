import { expect, type Page, test } from "@playwright/test";
import { summary } from "../fixtures/contracts/v2";

const id = "synthetic-human-review";
async function seed(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(
    ({ id, summary }) => {
      if (localStorage.getItem("synthetic-human-seeded")) return;
      localStorage.setItem("synthetic-human-seeded", "true");
      const facts = [0, 1].map((n) => ({
        ...summary.facts[0],
        id: `human-fact-${n}`,
        text: n ? "두 번째 합성 사실입니다." : "첫 번째 합성 사실입니다.",
        attribution: "user_statement",
        certainty: "reported",
        significance: "neutral",
        references: [{ kind: "intake_narrative", intakeRevision: 1 }],
        conflictingFactIds: [],
        userEdited: false,
      }));
      const values = {
        session: {
          user: { id: "human-owner", name: "합성 검증 사용자", accountType: "customer" },
          needsConsent: false,
        },
        cases: {
          [id]: {
            id,
            title: "휴먼 리뷰 합성 사건",
            subjectContext: "individual",
            stage: "active",
            revision: 1,
            updatedAt: new Date().toISOString(),
            summary: "검토한 합성 요약입니다.",
            schemaVersion: "2",
            summaryDetails: { ...summary, overview: "검토한 합성 요약입니다.", facts },
          },
        },
        caseOwners: { [id]: "human-owner" },
        workspace: { [id]: { messages: [], actions: [], timeline: [] } },
        files: {
          [id]: [
            {
              id: "human-file",
              revision: 1,
              name: "추가한 합성 자료.txt",
              mimeType: "text/plain",
              sizeBytes: 40,
              status: "ready",
              coverage: "합성 추출",
              extractedText: "합성 원본에서 확인한 내용입니다.",
            },
          ],
        },
      };
      for (const [key, value] of Object.entries(values))
        localStorage.setItem(`baro-api-mock-v1:${key}`, JSON.stringify(value));
    },
    { id, summary },
  );
}

test("active summary shows materials, visible conflict choices, saves and returns to its workspace tab", async ({
  page,
}) => {
  await seed(page);
  await page.goto(`/cases/${id}/summary?from=files`);
  await expect(page.getByRole("heading", { name: "사건 요약을 확인해요" })).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "추가한 자료" })
      .getByRole("link", { name: "추가한 합성 자료.txt" }),
  ).toBeVisible();
  await page.getByLabel("확인 상태", { exact: true }).first().selectOption("conflicting");
  await page.getByRole("checkbox", { name: "두 번째 합성 사실입니다." }).check();
  await expect(page.getByText("모순되는 사실 선택 · 1개 선택")).toBeVisible();
  await page.screenshot({ path: ".wrangler/ui-human-summary-desktop.png", fullPage: true });
  await page.getByLabel("요약 편집", { exact: true }).fill("수정하고 적용한 합성 요약입니다.");
  await page.getByRole("button", { name: "수정 내용 저장하고 적용", exact: true }).click();
  await expect(page.getByText("수정한 요약이 저장됐어요.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "사건 요약을 확인해요" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("요약 편집", { exact: true })).toHaveValue(
    "수정하고 적용한 합성 요약입니다.",
  );
  await expect(page.getByRole("checkbox", { name: "두 번째 합성 사실입니다." })).toBeChecked();
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    await expect(page.getByLabel("요약 편집", { exact: true })).toBeVisible();
    if (width === 320)
      await page.screenshot({ path: ".wrangler/ui-human-summary-320.png", fullPage: true });
  }
  await page.getByRole("link", { name: "작업 공간으로 돌아가기", exact: true }).last().click();
  await expect(page).toHaveURL(new RegExp(`/cases/${id}/files$`));
  await expect(
    page.getByRole("heading", { name: "휴먼 리뷰 합성 사건", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "사건 자료", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 760 });
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll("body *")]
          .filter((node) => {
            const r = node.getBoundingClientRect();
            return (
              r.width > 0 &&
              r.right > innerWidth + 1 &&
              getComputedStyle(node).position !== "fixed" &&
              // Case destinations intentionally scroll inside the bounded navigation row.
              !node.closest(".workspace-tabs")
            );
          })
          .map((node) => ({
            tag: node.tagName,
            class: node.className,
            width: node.getBoundingClientRect().width,
          })),
      ),
    )
    .toEqual([]);
  await page.screenshot({ path: ".wrangler/ui-human-files-320.png", fullPage: true });
});

test("slow foreground authentication preserves editor DOM, draft and scroll", async ({ page }) => {
  await seed(page);
  await page.goto(`/cases/${id}/summary`);
  const editor = page.getByLabel("요약 편집", { exact: true });
  await expect(editor).toBeVisible();
  await editor.fill("포커스 복귀 중에도 남아야 하는 합성 입력");
  const original = await editor.elementHandle();
  await editor.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => scrollY);
  await page.evaluate(async () => {
    const path = "/src/client/api/index.ts";
    const { api } = await import(/* @vite-ignore */ path);
    const get = api.session.get;
    const state = window as typeof window & {
      releaseHumanSession?: () => void;
      humanSessionReads?: number;
    };
    state.humanSessionReads = 0;
    const wait = new Promise<void>((resolve) => {
      state.releaseHumanSession = resolve;
    });
    api.session.get = async () => {
      state.humanSessionReads = (state.humanSessionReads ?? 0) + 1;
      await wait;
      api.session.get = get;
      return get();
    };
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
  });
  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue("포커스 복귀 중에도 남아야 하는 합성 입력");
  expect(await editor.evaluate((node, original) => node === original, original)).toBe(true);
  expect(await page.evaluate(() => scrollY)).toBe(before);
  await page.evaluate(() =>
    (window as typeof window & { releaseHumanSession?: () => void }).releaseHumanSession?.(),
  );
  await expect(editor).toHaveValue("포커스 복귀 중에도 남아야 하는 합성 입력");
});

test("a saved active-summary edit retries only its failed confirmation", async ({ page }) => {
  await seed(page);
  await page.route("**/src/client/api/cases.ts*", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({
      response,
      body: `${body}\nconst originalHumanConfirmation = casesApi.confirmSummary;\nlet failHumanConfirmation = true;\ncasesApi.confirmSummary = async (...args) => { if (failHumanConfirmation) { failHumanConfirmation = false; throw new ApiError('UNAVAILABLE', '합성 확인 요청 실패', true); } return originalHumanConfirmation(...args); };\n`,
    });
  });
  await page.goto(`/cases/${id}/summary?from=files`);
  const editor = page.getByLabel("요약 편집", { exact: true });
  await expect(editor).toBeVisible();
  await editor.fill("확인 요청 실패 후에도 저장된 합성 요약입니다.");
  await page.getByRole("button", { name: "수정 내용 저장하고 적용", exact: true }).click();
  const retry = page.getByRole("button", { name: "다시 시도", exact: true });
  await expect(retry).toBeEnabled();
  await expect(page.getByRole("heading", { name: "사건 요약을 확인해요" })).toBeVisible();
  await expect(page.getByLabel("요약이 내가 이야기한 사실과 맞는지 확인했어요.")).toHaveCount(0);
  const revision = () =>
    page.evaluate(
      (id) => JSON.parse(localStorage.getItem("baro-api-mock-v1:cases") ?? "{}")[id].revision,
      id,
    );
  expect(await revision()).toBe(2);
  await retry.click();
  await expect(page).toHaveURL(new RegExp(`/cases/${id}/files$`));
  expect(await revision()).toBe(3);
  await page.goto(`/cases/${id}/summary`);
  await expect(editor).toHaveValue("확인 요청 실패 후에도 저장된 합성 요약입니다.");
  await expect(page.getByRole("heading", { name: "사건 요약을 확인해요" })).toBeVisible();
});

test("correction is saved before an explicit material reflection request", async ({ page }) => {
  await seed(page);
  await page.goto(`/cases/${id}/files?file=human-file`);
  const dialog = page.getByRole("dialog");
  const editor = dialog.getByLabel("확인·교정한 내용", { exact: true });
  await expect(editor).toBeVisible();
  await editor.fill("합성 인명과 금액을 확인해 교정한 내용입니다.");
  const reflect = dialog.getByRole("button", { name: "자료 내용 반영하기" });
  await expect(reflect).toBeDisabled();
  await dialog.getByRole("button", { name: "교정 내용 저장", exact: true }).click();
  await expect(reflect).toBeEnabled();
  await expect(editor).toHaveValue("합성 인명과 금액을 확인해 교정한 내용입니다.");
  await page.screenshot({ path: ".wrangler/ui-human-review-desktop.png" });
  await reflect.click();
  await expect(page).toHaveURL(new RegExp(`/cases/${id}$`));
  await expect(
    page.getByText(/^선택한 자료의 포함된 교정 내용을 기존 사실과 대조해/),
  ).toBeVisible();
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("baro-api-mock-v1:fileReviews") ?? "{}"),
  );
  expect(stored["human-file"].observations[0].value.text).toBe(
    "합성 인명과 금액을 확인해 교정한 내용입니다.",
  );
  await expect(page.getByText("이 응답은 합성 API 예시", { exact: false })).toBeVisible();
  await page.goto(`/cases/${id}/summary`);
  await expect(
    page
      .getByRole("region", { name: "추가한 자료" })
      .getByText("사실에 연결된 자료", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("사실 내용", { exact: true }).last()).toHaveValue(
    "합성 인명과 금액을 확인해 교정한 내용입니다.",
  );
});

test("case deletion is reachable from the list and survives reload", async ({ page }) => {
  await seed(page);
  await page.goto("/cases");
  await page.getByRole("button", { name: "휴먼 리뷰 합성 사건 사건 삭제", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const remove = dialog.getByRole("button", { name: "사건 삭제", exact: true });
  await expect(remove).toBeDisabled();
  await dialog.getByLabel("삭제하려면 DELETE를 입력해 주세요.").fill("DELETE");
  await remove.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("link", { name: /휴먼 리뷰 합성 사건/ })).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".sidebar-desktop .sidebar-story")).toHaveCount(0);
});

test("an uploaded synthetic recording can be played while correcting and is removed on sign-out", async ({
  page,
}) => {
  await seed(page);
  await page.goto(`/cases/${id}/files`);
  await page.getByLabel("선택 자료의 자동 처리에 동의합니다.").check();
  const wav = Buffer.alloc(32044);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(32000, 40);
  await page
    .getByLabel("업로드할 파일 선택", { exact: true })
    .setInputFiles({ name: "synthetic-silence.wav", mimeType: "audio/wav", buffer: wav });
  const row = page.locator(".workspace-file-list li").filter({ hasText: "synthetic-silence.wav" });
  await expect(row.getByText("결과 확인 가능", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "자료 확인", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "원본 확인 · 다운로드", exact: true }).click();
  await expect(dialog.locator("audio")).toBeVisible();
  await expect(dialog.locator("audio")).toHaveAttribute("src", /^data:audio\/wav;base64,/);
  await expect(dialog.getByLabel("확인·교정한 내용", { exact: true })).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("baro-session-changed", { detail: { reason: "signout" } }),
    ),
  );
  await expect(page.locator("audio")).toHaveCount(0);
});
