import { expect, type Page, test } from "@playwright/test";
import { v2SummarySchema } from "../../src/contracts/v2";
import { summary } from "../fixtures/contracts/v2";

const id = "synthetic-human-review";
async function seed(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const seededSummary = v2SummarySchema.parse({
    ...summary,
    overview: "검토한 합성 요약입니다.",
    facts: [0, 1].map((n) => ({
      ...summary.facts[0],
      id: `human-fact-${n}`,
      text: n ? "두 번째 합성 사실입니다." : "첫 번째 합성 사실입니다.",
      attribution: "user_statement",
      certainty: "reported",
      significance: "neutral",
      references: [{ kind: "intake_narrative", intakeRevision: 1 }],
      conflictingFactIds: [],
      userEdited: false,
    })),
  });
  await page.addInitScript(
    ({ id, summary }) => {
      if (localStorage.getItem("synthetic-human-seeded")) return;
      localStorage.setItem("synthetic-human-seeded", "true");
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
            summaryDetails: summary,
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
    { id, summary: seededSummary },
  );
}

test("active summary proposes a change, keeps materials and confirms before returning to its workspace tab", async ({
  page,
}) => {
  await seed(page);
  await page.goto(`/cases/${id}/summary?from=files`);
  await expect(page.getByRole("heading", { name: "이야기를 이렇게 정리했어요" })).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "추가한 자료" })
      .getByRole("link", { name: "추가한 합성 자료.txt" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "사실 내용", exact: true })).toHaveCount(0);
  await page.screenshot({ path: ".wrangler/ui-human-summary-desktop.png", fullPage: true });
  const canonical = () =>
    page.evaluate(
      (id) => JSON.parse(localStorage.getItem("baro-api-mock-v1:cases") ?? "{}")[id].summaryDetails,
      id,
    );
  const before = await canonical();
  const explanation = "금액을 일부 돌려받았지만 정확한 금액은 아직 모른다는 합성 설명입니다.";
  await page.getByRole("button", { name: "빠진 내용이 있어요", exact: true }).click();
  await page
    .getByRole("textbox", { name: "빠진 내용을 알려주세요", exact: true })
    .fill(explanation);
  await page.getByRole("button", { name: "변경안 요청하기", exact: true }).click();
  await expect(page.getByRole("button", { name: "변경안 확정하기", exact: true })).toBeVisible();
  expect(await canonical()).toEqual(before);
  await page.reload();
  await expect(page.getByRole("button", { name: "변경안 확정하기", exact: true })).toBeVisible();
  expect(await canonical()).toEqual(before);
  await expect(page.getByLabel("요약 편집", { exact: true })).toHaveCount(0);
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    await expect(page.getByRole("button", { name: "변경안 확정하기", exact: true })).toBeVisible();
    if (width === 320)
      await page.screenshot({ path: ".wrangler/ui-human-summary-320.png", fullPage: true });
  }
  await page.getByRole("button", { name: "변경안 확정하기", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/cases/${id}/files$`));
  const confirmed = await canonical();
  expect(confirmed.overview).toContain(explanation);
  expect(confirmed.facts.slice(0, before.facts.length)).toEqual(before.facts);
  await expect(page).toHaveURL(new RegExp(`/cases/${id}/files$`));
  await expect(
    page.getByRole("heading", { name: "휴먼 리뷰 합성 사건", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "사건 자료", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 760 });
  await page.evaluate(() => document.fonts.ready);
  const measureOverflow = () =>
    page.evaluate(() => ({
      fits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      overflow: [...document.querySelectorAll("body *")]
        .filter((node) => {
          const r = node.getBoundingClientRect();
          return (
            node.checkVisibility({ checkVisibilityCSS: true }) &&
            r.width > 0 &&
            r.right > innerWidth + 1 &&
            getComputedStyle(node).position !== "fixed"
          );
        })
        .map((node) => ({
          tag: node.tagName,
          class: node.className,
          width: node.getBoundingClientRect().width,
        })),
    }));
  await expect.poll(measureOverflow).toEqual({ fits: true, overflow: [] });
  const trigger = page.locator(".case-tools > summary");
  const menu = page.locator(".case-tools__menu");
  await expect(menu).not.toBeVisible();
  await expect(menu.getByRole("link", { includeHidden: true })).toHaveCount(4);
  await trigger.focus();
  await page.keyboard.press("Tab");
  await expect(
    page
      .getByRole("navigation", { name: "사건 작업", exact: true })
      .getByRole("link", { name: "대화", exact: true }),
  ).toBeFocused();
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("link")).toHaveCount(4);
  for (const name of ["요약 보기 · 재확인", "타임라인", "다음 행동", "유사 판례"]) {
    await page.keyboard.press("Tab");
    const link = menu.getByRole("link", { name, exact: true });
    await expect(link).toBeFocused();
    await expect(link).toBeInViewport({ ratio: 1 });
    const bounds = await link.boundingBox();
    if (!bounds) throw new Error("Visible case tool bounds missing");
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
    await link.click({ trial: true });
    expect(
      await link.evaluate((node) => {
        const r = node.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return hit === node || node.contains(hit);
      }),
    ).toBe(true);
  }
  await expect.poll(measureOverflow).toEqual({ fits: true, overflow: [] });
  await page.keyboard.press("Escape");
  await expect(menu).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await expect.poll(measureOverflow).toEqual({ fits: true, overflow: [] });
  await page.screenshot({ path: ".wrangler/ui-human-files-320.png", fullPage: true });
});

test("slow foreground authentication preserves explanation DOM, draft and scroll", async ({
  page,
}) => {
  await seed(page);
  await page.goto(`/cases/${id}/summary`);
  await page.getByRole("button", { name: "빠진 내용이 있어요", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "빠진 내용을 알려주세요", exact: true });
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

test("a proposed active-summary change retries only its failed confirmation", async ({ page }) => {
  await seed(page);
  await page.goto(`/cases/${id}/summary?from=files`);
  const canonical = () =>
    page.evaluate(
      (id) => JSON.parse(localStorage.getItem("baro-api-mock-v1:cases") ?? "{}")[id],
      id,
    );
  const before = await canonical();
  await expect(page.getByRole("button", { name: "빠진 내용이 있어요", exact: true })).toBeEnabled();
  await page.evaluate(async () => {
    const path = "/src/client/api/rework.ts";
    const { reworkApi } = await import(/* @vite-ignore */ path);
    const corePath = "/src/client/api/core.ts";
    const { ApiError } = await import(/* @vite-ignore */ corePath);
    const confirm = reworkApi.confirmReconciliation;
    let calls = 0;
    reworkApi.confirmReconciliation = async (...args: unknown[]) => {
      if (++calls === 1) throw new ApiError("UNAVAILABLE", "합성 확인 요청 실패", true);
      return confirm(...args);
    };
  });
  const explanation = "확인 요청 실패 후에도 변경안으로 남아야 하는 합성 설명입니다.";
  await page.getByRole("button", { name: "빠진 내용이 있어요", exact: true }).click();
  await page
    .getByRole("textbox", { name: "빠진 내용을 알려주세요", exact: true })
    .fill(explanation);
  await page.getByRole("button", { name: "변경안 요청하기", exact: true }).click();
  await page.getByRole("button", { name: "변경안 확정하기", exact: true }).click();
  const retry = page.getByRole("button", { name: "다시 시도", exact: true });
  await expect(retry).toBeEnabled();
  await expect(page.getByLabel("요약 편집", { exact: true })).toHaveCount(0);
  expect((await canonical()).revision).toBe(2);
  expect((await canonical()).summaryDetails).toEqual(before.summaryDetails);
  await retry.click();
  await expect(page).toHaveURL(new RegExp(`/cases/${id}/files$`));
  const confirmed = await canonical();
  expect(confirmed.revision).toBe(3);
  expect(confirmed.summaryDetails.facts.slice(0, before.summaryDetails.facts.length)).toEqual(
    before.summaryDetails.facts,
  );
  await page.goto(`/cases/${id}/summary`);
  await expect(page.getByText(confirmed.summary, { exact: true })).toBeVisible();
  await expect(page.getByLabel("요약 편집", { exact: true })).toHaveCount(0);
  expect((await canonical()).revision).toBe(3);
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
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("baro-api-mock-v1:fileReviews") ?? "{}"),
  );
  expect(stored["human-file"].observations[0].value.text).toBe(
    "합성 인명과 금액을 확인해 교정한 내용입니다.",
  );
  await expect(page.getByText("이 응답은 합성 API 예시", { exact: false })).toBeVisible();
  const messages = await page.evaluate(
    (id) => JSON.parse(localStorage.getItem("baro-api-mock-v1:workspace") ?? "{}")[id].messages,
    id,
  );
  expect(
    messages.findLast((message: { role: string }) => message.role === "user").selectedFileIds,
  ).toEqual(["human-file"]);
  await page.goto(`/cases/${id}/summary`);
  await expect(
    page
      .getByRole("region", { name: "추가한 자료" })
      .getByText("사실에 연결된 자료", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("사실 내용", { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("baro-api-mock-v1:cases") ?? "{}")[
          "synthetic-human-review"
        ].summaryDetails.facts.at(-1).text,
    ),
  ).toBe("합성 인명과 금액을 확인해 교정한 내용입니다.");
});

test("case deletion is reachable from the list and survives reload", async ({ page }) => {
  await seed(page);
  await page.goto("/cases");
  const list = page.getByRole("region", { name: "불러온 사건 1개", exact: true });
  const opener = list.getByRole("button", { name: "휴먼 리뷰 합성 사건 사건 삭제", exact: true });
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  const remove = dialog.getByRole("button", { name: "사건 삭제", exact: true });
  await expect(remove).toBeEnabled();
  await remove.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("link", { name: /휴먼 리뷰 합성 사건/ })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "불러온 사건 0개", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /휴먼 리뷰 합성 사건/ })).toHaveCount(0);
  await expect(page.locator(".sidebar-desktop .sidebar-story")).toHaveCount(0);
});

test("an uploaded synthetic recording can be played while correcting and is removed on sign-out", async ({
  page,
}) => {
  await seed(page);
  await page.goto(`/cases/${id}/files`);
  await expect(page.getByRole("button", { name: /^(파일 선택|파일 추가)$/ })).toBeEnabled();
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
  await expect(row).toHaveCount(0);
  const upload = page.getByRole("button", { name: "선택한 자료 업로드", exact: true });
  await expect(upload).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "첨부한 파일의 자동 처리에 동의합니다.", exact: true })
    .check();
  await expect(upload).toBeEnabled();
  await upload.click();
  await expect(row.getByText("내용 확인 후 반영 가능", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "자료 확인", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "자료 확인", exact: true });
  await dialog.getByRole("button", { name: "원본 확인 · 다운로드", exact: true }).click();
  await expect(dialog.locator("audio")).toBeVisible();
  await expect(dialog.locator("audio")).toHaveAttribute("src", /^data:audio\/wav;base64,/);
  const audio = dialog.locator("audio");
  await expect
    .poll(() => audio.evaluate((node: HTMLAudioElement) => node.readyState))
    .toBeGreaterThanOrEqual(2);
  expect(await audio.evaluate((node: HTMLAudioElement) => node.duration)).toBeCloseTo(1, 2);
  await audio.evaluate(async (node: HTMLAudioElement) => node.play());
  await expect(audio).toHaveJSProperty("paused", false);
  const editor = dialog.getByLabel("확인·교정한 내용", { exact: true });
  await expect(editor).toBeVisible();
  await editor.fill("원음을 들으며 확인한 합성 교정 내용입니다.");
  await expect(editor).toHaveValue("원음을 들으며 확인한 합성 교정 내용입니다.");
  await expect(audio).toBeVisible();
  await expect
    .poll(() => audio.evaluate((node: HTMLAudioElement) => node.currentTime))
    .toBeGreaterThan(0);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("baro-session-changed", { detail: { reason: "signout" } }),
    ),
  );
  await expect(page.locator("audio")).toHaveCount(0);
});
