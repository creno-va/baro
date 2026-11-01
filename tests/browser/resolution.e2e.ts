import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.post("/fixture/control", { data: { reset: true } });
});
for (const late of ["failure", "signed-out"] as const)
  test(`a superseded ${late} session load cannot block fresh owner recovery`, async ({ page }) => {
    let phase: "ready" | "old" | "fresh" = "ready";
    let held = 0,
      settled = 0,
      fresh = 0;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/fixture/session", async (route) => {
      if (phase === "old") {
        held++;
        await gate;
        await route.fulfill(
          late === "failure"
            ? { status: 503, json: { code: "DEPENDENCY_UNAVAILABLE" } }
            : { json: { ownerId: null, needsConsent: false } },
        );
        settled++;
      } else {
        if (phase === "fresh") fresh++;
        await route.fulfill({ json: { ownerId: "owner", needsConsent: false } });
      }
    });
    try {
      await page.goto("/?default");
      const parentControl = page.getByRole("button", { name: "대화·리포트 보기 전환" });
      await expect(parentControl).toBeEnabled();
      phase = "old";
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect.poll(() => held).toBeGreaterThan(0);
      await expect(parentControl).toBeDisabled();
      phase = "fresh";
      await page.evaluate(() =>
        window.dispatchEvent(
          new StorageEvent("storage", {
            key: "baro-session-changed",
            newValue: "fresh-owner-epoch",
          }),
        ),
      );
      await expect.poll(() => fresh).toBeGreaterThan(0);
      await expect(parentControl).toBeEnabled();
      expect(settled).toBe(0);
      release();
      await expect.poll(() => settled).toBe(held);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(parentControl).toBeEnabled();
    } finally {
      release();
    }
  });

test("an obsolete load finally cannot clear a newer load's busy lock", async ({ page }) => {
  let phase: "ready" | "old" | "fresh" = "ready";
  let held = 0,
    settled = 0,
    freshReads = 0;
  let releaseOld = () => {},
    releaseFresh = () => {};
  const oldGate = new Promise<void>((resolve) => {
    releaseOld = resolve;
  });
  const freshGate = new Promise<void>((resolve) => {
    releaseFresh = resolve;
  });
  await page.route("**/fixture/session", async (route) => {
    if (phase === "old") {
      held++;
      await oldGate;
      settled++;
    }
    await route.fulfill({ json: { ownerId: "owner", needsConsent: false } });
  });
  await page.route("**/api/v2/cases/case/rework/resolution", async (route) => {
    if (phase === "fresh") {
      freshReads++;
      await freshGate;
    }
    await route.continue();
  });
  try {
    await page.goto("/?default");
    const parentControl = page.getByRole("button", { name: "대화·리포트 보기 전환" });
    await expect(parentControl).toBeEnabled();
    phase = "old";
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => held).toBeGreaterThan(0);
    phase = "fresh";
    await page.evaluate(() =>
      window.dispatchEvent(
        new StorageEvent("storage", { key: "baro-session-changed", newValue: "new-load-epoch" }),
      ),
    );
    await expect.poll(() => freshReads).toBe(1);
    releaseOld();
    await expect.poll(() => settled).toBe(held);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(parentControl).toBeDisabled();
    expect(freshReads).toBe(1);
    releaseFresh();
    await expect(parentControl).toBeEnabled();
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    releaseOld();
    releaseFresh();
  }
});
test("limited official guide is a reading link without a verified claim; criminal defender guidance stays separate", async ({
  page,
  request,
}) => {
  await request.post("/fixture/control", {
    data: { purpose: "respond_to_claim", criminal: true, limitedGuide: true },
  });
  await page.goto("/?default");
  await page.getByRole("button", { name: /^직접 해결/ }).click();
  const guide = page.getByRole("link", { name: "공식 안내 원문에서 확인" });
  await expect(guide).toHaveAttribute(
    "href",
    "https://www.easylaw.go.kr/CSP/CnpClsMain.laf?csmSeq=568&ccfNo=5&cciNo=2&cnpClsNo=1",
  );
  expect(await guide.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(
    44,
  );
  await expect(page.getByText("공식 근거 확인 · 사건에 맞는지 검토 필요")).toHaveCount(0);
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByText(/확인 시점: 2026-11-01T10:00:00.000Z/)).toBeVisible();
  await page.getByRole("button", { name: /^변호사와 해결/ }).click();
  await expect(page.getByRole("link", { name: "국선변호인제도 공식 안내" })).toHaveAttribute(
    "href",
    /csmSeq=538/,
  );
  await expect(page.getByRole("link", { name: "법률구조제도 공식 안내" })).toBeVisible();
  await expect(page.getByRole("link", { name: "변호사 목록·프로필 보기" })).toHaveAttribute(
    "href",
    "/lawyers",
  );
  await expect(page.getByText(/자격·선정·선임을 보장하지 않아요/)).toBeVisible();
  const calls = await (await request.get("/fixture/counts")).json();
  expect(calls).toMatchObject({ draft: 0, saveReport: 0, observations: 0 });
  await page.setViewportSize({ width: 320, height: 780 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: ".wrangler/resolution-official-mobile.png", fullPage: true });
});
for (const purpose of ["prepare_claim", "respond_to_claim"] as const)
  for (const path of ["직접 해결", "변호사와 해결", "리포트만 저장"] as const)
    test(`${purpose} → ${path}`, async ({ page, request }) => {
      await request.post("/fixture/control", { data: { purpose } });
      await page.goto("/");
      const button = page.getByRole("button", { name: new RegExp(`^${path}`) });
      await expect(button).toBeEnabled();
      await button.click();
      if (path === "직접 해결") {
        await expect(page.getByRole("heading", { name: "준비 순서와 확인할 안내" })).toBeVisible();
        await expect(page.getByText("관할", { exact: true })).toBeVisible();
        await expect(page.getByRole("option")).toHaveCount(1);
      } else if (path === "변호사와 해결") {
        await expect(page.getByRole("link", { name: "변호사 목록·프로필 보기" })).toHaveAttribute(
          "href",
          "/lawyers",
        );
        if (purpose === "respond_to_claim") {
          await expect(
            page.getByRole("heading", { name: "국선변호·법률구조 공식 안내" }),
          ).toBeVisible();
          await expect(page.getByRole("link", { name: "국선변호인제도 공식 안내" })).toHaveCount(0);
          await expect(page.getByRole("link", { name: "법률구조제도 공식 안내" })).toBeVisible();
        }
      } else {
        await expect(page.getByRole("status")).toContainText("저장 요청");
        const calls = await (await request.get("/fixture/counts")).json();
        expect(calls).toMatchObject({ draft: 0, update: 0, saveReport: 1, files: 0 });
      }
    });
test("grounded draft review/edit/save/download and reconnect across both host surfaces", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^직접 해결/ }).click();
  await page.getByLabel("현재 리포트의 사실과 사용할 자료를 확인했어요.").check();
  await page.getByRole("button", { name: "검토용 초안 준비" }).click();
  const editor = page.getByLabel("초안 검토·수정");
  await expect(editor).toContainText("[미입력: 관할]");
  await expect(editor).not.toContainText("010-1234-5678");
  await editor.fill(`${await editor.inputValue()}\n직접 검토한 수정`);
  await page.getByLabel("사실·증거·미입력 항목과 수정한 내용을 검토했어요.").check();
  await page.getByRole("button", { name: "검토한 초안 저장" }).click();
  const expectedContent = await editor.inputValue();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "초안 다운로드", exact: true }).click();
  const downloaded = await download;
  expect(downloaded.suggestedFilename().normalize("NFC")).toMatch(/검토용\.txt$/);
  expect(await readFile(await downloaded.path())).toEqual(Buffer.from(expectedContent, "utf8"));
  await page.reload();
  await expect(page.getByLabel("초안 검토·수정")).toContainText("직접 검토한 수정");
  await page.getByRole("button", { name: "대화·리포트 보기 전환" }).click();
  await expect(page.getByText("합성 대화", { exact: true })).toBeVisible();
  await expect(page.getByLabel("초안 검토·수정")).toContainText("직접 검토한 수정");
});
test("scope edits hide old drafts and dirty path switches need explicit discard", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^직접 해결/ }).click();
  await page.getByLabel("현재 리포트의 사실과 사용할 자료를 확인했어요.").check();
  await page.getByRole("button", { name: "검토용 초안 준비" }).click();
  await page.getByLabel("초안 검토·수정").fill("미저장 합성 편집");
  await page.getByRole("button", { name: /^변호사와 해결/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "계속 검토" }).click();
  await expect(page.getByLabel("초안 검토·수정")).toHaveValue("미저장 합성 편집");
  await expect(page.getByLabel("선택 자료 1", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: /^직접 해결/ }).click();
  await page.getByRole("button", { name: "수정을 버리고 경로 변경" }).click();
  await page.getByLabel("선택 자료 1", { exact: true }).uncheck();
  await expect(page.getByLabel("초안 검토·수정")).toHaveCount(0);
  await page.getByRole("button", { name: "범위 적용" }).click();
  await expect(page.getByText(/이전 기준의 초안이에요/)).toBeVisible();
});
test("account change purges dirty text and discards a delayed draft result", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^직접 해결/ }).click();
  await request.post("/fixture/control", { data: { delayDraft: 300 } });
  await page.getByLabel("현재 리포트의 사실과 사용할 자료를 확인했어요.").check();
  await page.getByRole("button", { name: "검토용 초안 준비" }).click();
  await request.post("/fixture/control", { data: { owner: "other-owner" } });
  await page.evaluate(() => window.dispatchEvent(new Event("baro-session-changed")));
  await expect(page.getByLabel("초안 검토·수정")).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("계정");
});
test("download failure remains retryable without draft generation", async ({ page, request }) => {
  await request.post("/fixture/control", { data: { failDownload: true } });
  await page.goto("/");
  await page.getByRole("button", { name: /^리포트만 저장/ }).click();
  await expect(page.getByRole("alert")).toContainText("완료하지 못했어요");
  await request.post("/fixture/control", { data: { failDownload: false } });
  await page.getByRole("button", { name: /^리포트만 저장/ }).click();
  await expect(page.getByRole("status")).toContainText("저장 요청");
  const calls = await (await request.get("/fixture/counts")).json();
  expect(calls).toMatchObject({ saveReport: 2, draft: 0, update: 0 });
});
test("320px layout keeps equal choices, touch targets and no document overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto("/");
  await page.getByRole("button", { name: /^직접 해결/ }).click();
  await expect(page.getByRole("heading", { name: "준비 순서와 확인할 안내" })).toBeVisible();
  const metrics = await page.locator(".resolution-path").evaluateAll((buttons) =>
    buttons.map((button) => ({
      height: button.getBoundingClientRect().height,
      width: button.getBoundingClientRect().width,
    })),
  );
  expect(metrics.every((m) => m.height >= 44)).toBe(true);
  expect(new Set(metrics.map((m) => m.width)).size).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: ".wrangler/resolution-mobile.png", fullPage: true });
});
test("stale revision hides previous draft and account switch clears an existing private edit", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^직접 해결/ }).click();
  await page.getByLabel("현재 리포트의 사실과 사용할 자료를 확인했어요.").check();
  await page.getByRole("button", { name: "검토용 초안 준비" }).click();
  await expect(page.getByLabel("초안 검토·수정")).toBeVisible();
  await request.post("/fixture/control", { data: { stale: true } });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByLabel("초안 검토·수정")).toHaveCount(0);
  await expect(page.getByText(/이전 기준의 초안이에요/)).toBeVisible();
  await page.getByLabel("현재 리포트의 사실과 사용할 자료를 확인했어요.").check();
  await page.getByRole("button", { name: "검토용 초안 준비" }).click();
  await page.getByLabel("초안 검토·수정").fill("PRIVATE DIRTY SYNTHETIC");
  await request.post("/fixture/control", { data: { owner: "other-owner" } });
  await page.evaluate(() => window.dispatchEvent(new Event("baro-session-changed")));
  await expect(page.getByLabel("초안 검토·수정")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("PRIVATE DIRTY SYNTHETIC");
});
test("a local draft download failure preserves reviewed save and consent loss permits historical download", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^직접 해결/ }).click();
  await page.getByLabel("현재 리포트의 사실과 사용할 자료를 확인했어요.").check();
  await page.getByRole("button", { name: "검토용 초안 준비" }).click();
  await page.getByLabel("사실·증거·미입력 항목과 수정한 내용을 검토했어요.").check();
  await page.getByRole("button", { name: "검토한 초안 저장" }).click();
  await page.evaluate(() => {
    URL.createObjectURL = () => {
      throw Error("synthetic download failure");
    };
  });
  await page.getByRole("button", { name: "초안 다운로드", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("완료하지 못했어요");
  await expect(page.getByLabel("초안 검토·수정")).toBeVisible();
  await request.post("/fixture/control", { data: { needsConsent: true } });
  await page.reload();
  await expect(page.getByLabel("초안 검토·수정")).toBeVisible();
  await expect(page.getByRole("button", { name: "검토한 초안 저장" })).toBeDisabled();
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "초안 다운로드", exact: true }).click();
  await event;
  const calls = await (await request.get("/fixture/counts")).json();
  expect(calls.draft).toBe(1);
});
test("the real default client peeks at existing reports and reads file metadata without recreating a deleted report", async ({
  page,
  request,
}) => {
  await page.goto("/?default");
  await page.getByRole("button", { name: /^직접 해결/ }).click();
  await expect(page.getByRole("heading", { name: "준비 순서와 확인할 안내" })).toBeVisible();
  await request.post("/fixture/control", { data: { missingReport: true } });
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("현재 리포트");
  const calls = await (await request.get("/fixture/counts")).json();
  expect(calls).toMatchObject({
    legacyGets: 0,
    observations: 0,
    update: 1,
    draft: 0,
    saveReport: 0,
  });
  expect(calls.reportReads).toBeGreaterThanOrEqual(2);
});

test("consent withdrawal permits local historical path browsing and paused saved download without mutations", async ({
  page,
  request,
}) => {
  await page.goto("/?default");
  await page.getByRole("button", { name: /^직접 해결/ }).click();
  await page.getByLabel("현재 리포트의 사실과 사용할 자료를 확인했어요.").check();
  await page.getByRole("button", { name: "검토용 초안 준비" }).click();
  await page.getByLabel("사실·증거·미입력 항목과 수정한 내용을 검토했어요.").check();
  await page.getByRole("button", { name: "검토한 초안 저장" }).click();
  await page.getByRole("button", { name: /^변호사와 해결/ }).click();
  await page.getByRole("button", { name: "잠시 중단" }).click();
  await expect(page.getByRole("button", { name: "이어서 진행" })).toBeEnabled();
  const before = await (await request.get("/fixture/counts")).json();
  await request.post("/fixture/control", { data: { needsConsent: true } });
  await page.reload();
  await page.getByRole("button", { name: /^직접 해결/ }).click();
  await expect(page.getByLabel("초안 검토·수정")).toBeDisabled();
  await expect(page.getByRole("button", { name: "검토용 초안 준비" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "이어서 진행" })).toBeDisabled();
  const expectedContent = await page.getByLabel("초안 검토·수정").inputValue();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "초안 다운로드", exact: true }).click();
  const downloaded = await download;
  expect(downloaded.suggestedFilename().normalize("NFC")).toMatch(/검토용\.txt$/);
  expect(await readFile(await downloaded.path())).toEqual(Buffer.from(expectedContent, "utf8"));
  await expect(page.getByLabel("초안 검토·수정")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: /^변호사와 해결/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const after = await (await request.get("/fixture/counts")).json();
  expect(after.update).toBe(before.update);
  expect(after.draft).toBe(before.draft);
  expect(after.observations).toBe(0);
});

for (const code of ["NOT_FOUND", "UNAUTHENTICATED"] as const)
  test(`server ${code} purges an existing private draft without an account-change event`, async ({
    page,
  }) => {
    await page.goto("/?default");
    await page.getByRole("button", { name: /^직접 해결/ }).click();
    await page.getByLabel("현재 리포트의 사실과 사용할 자료를 확인했어요.").check();
    await page.getByRole("button", { name: "검토용 초안 준비" }).click();
    await page.getByLabel("초안 검토·수정").fill(`PRIVATE-ACCESS-${code}`);
    await page.getByLabel("사실·증거·미입력 항목과 수정한 내용을 검토했어요.").check();
    await page.getByRole("button", { name: "검토한 초안 저장" }).click();
    await expect(page.getByRole("button", { name: "초안 다운로드", exact: true })).toBeEnabled();
    await page.route("**/api/v2/cases/case/rework/resolution", (route) =>
      route.fulfill({ status: code === "NOT_FOUND" ? 404 : 401, json: { code } }),
    );
    await page.getByRole("button", { name: "초안 다운로드", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("계정");
    await expect(page.getByLabel("초안 검토·수정")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(`PRIVATE-ACCESS-${code}`);
  });

test("a stale mutation immediately hides the previous draft before a parent refresh", async ({
  page,
}) => {
  await page.goto("/?default");
  await page.getByRole("button", { name: /^직접 해결/ }).click();
  await page.getByLabel("현재 리포트의 사실과 사용할 자료를 확인했어요.").check();
  await page.getByRole("button", { name: "검토용 초안 준비" }).click();
  await page.getByLabel("초안 검토·수정").fill("PRIVATE-STALE-EDIT");
  await page.getByLabel("사실·증거·미입력 항목과 수정한 내용을 검토했어요.").check();
  await page.route("**/api/v2/cases/case/rework/resolution", (route) =>
    route.fulfill({ status: 409, json: { code: "STALE_REVISION" } }),
  );
  await page.getByRole("button", { name: "검토한 초안 저장" }).click();
  await expect(page.getByRole("alert")).toContainText("사건이나 리포트가 바뀌었어요");
  await expect(page.getByLabel("초안 검토·수정")).toHaveCount(0);
  await expect(page.getByText(/이전 기준의 초안이에요/)).toBeVisible();
  await expect(page.locator("body")).not.toContainText("PRIVATE-STALE-EDIT");
});
