import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

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
  await expect(page.getByRole("alert")).toContainText("내용이 변경됐어요");
  await expect(page.getByLabel("초안 검토·수정")).toHaveCount(0);
  await expect(page.getByText(/이전 기준의 초안이에요/)).toBeVisible();
  await expect(page.locator("body")).not.toContainText("PRIVATE-STALE-EDIT");
});

for (const failure of ["503", "network", "invalid-response"] as const)
  test(`initial metadata ${failure} remains distinct after PDF success until explicit confirmation`, async ({
    page,
    request,
  }) => {
    await request.post("/fixture/control", { data: { noAnalysis: true } });
    let unavailable = true;
    let gets = 0,
      patches = 0;
    await page.route("**/api/v2/cases/case/rework/resolution", async (route) => {
      if (route.request().method() === "GET") {
        gets++;
        if (unavailable) {
          if (failure === "network") return route.abort("failed");
          return route.fulfill(
            failure === "503"
              ? { status: 503, json: { error: { code: "DEPENDENCY_UNAVAILABLE" } } }
              : { status: 200, json: { invalid: "synthetic metadata" } },
          );
        }
      } else if (route.request().method() === "PATCH") patches++;
      await route.continue();
    });
    await page.goto("/?default");
    await expect(page.getByRole("alert")).toContainText("후속 해결 상태를 확인하지 못했어요");
    expect(gets).toBe(1);
    await page.getByRole("button", { name: /^리포트만 저장/ }).click();
    await expect(page.getByRole("status")).toContainText("저장 요청");
    await page.getByRole("button", { name: /^변호사와 해결/ }).click();
    await page.getByRole("button", { name: /^직접 해결/ }).click();
    await expect(page.getByRole("alert")).toContainText("후속 해결 상태를 확인하지 못했어요");
    await expect(page.getByRole("alert")).not.toContainText("작업을 완료하지 못했어요");
    await expect(page.getByRole("heading", { name: "준비 순서와 확인할 안내" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "변호사 목록·프로필 보기" })).toHaveCount(0);
    expect(gets).toBe(1);
    expect(patches).toBe(0);
    const before = await (await request.get("/fixture/counts")).json();
    expect(before).toMatchObject({
      get: 0,
      update: 0,
      draft: 0,
      files: 0,
      reportReads: 0,
      saveReport: 1,
      observations: 0,
      legacyGets: 0,
    });
    unavailable = false;
    await page.getByRole("button", { name: "다시 확인", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^변호사와 해결/ })).toBeEnabled();
    expect(gets).toBe(2);
    await page.getByRole("button", { name: /^변호사와 해결/ }).click();
    await expect(page.getByRole("link", { name: "변호사 목록·프로필 보기" })).toHaveAttribute(
      "href",
      "/lawyers",
    );
    expect(patches).toBe(1);
    const after = await (await request.get("/fixture/counts")).json();
    expect(after).toMatchObject({
      update: 1,
      draft: 0,
      saveReport: 1,
      observations: 0,
      legacyGets: 0,
    });
  });

for (const purpose of ["prepare_claim", "respond_to_claim"] as const)
  test(`${purpose}: a valid basis-null limited report can select a lawyer while draft publication stays blocked`, async ({
    page,
    request,
  }) => {
    await request.post("/fixture/control", {
      data: { purpose, criminal: purpose === "respond_to_claim", noAnalysis: true },
    });
    await page.goto("/?default");
    await expect(page.getByRole("button", { name: /^리포트만 저장/ })).toBeEnabled();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.getByRole("button", { name: /^리포트만 저장/ }).click();
    await expect(page.getByRole("status")).toContainText("저장 요청");
    await page.getByRole("button", { name: /^변호사와 해결/ }).click();
    await expect(page.getByRole("link", { name: "변호사 목록·프로필 보기" })).toHaveAttribute(
      "href",
      "/lawyers",
    );
    if (purpose === "respond_to_claim") {
      await expect(
        page.getByRole("heading", { name: "국선변호·법률구조 공식 안내" }),
      ).toBeVisible();
      await expect(page.getByText(/자격·선정·선임을 보장하지 않아요/)).toBeVisible();
    }
    const headers = { "x-fixture-owner": "owner" };
    const selected = await (await request.get("/fixture/resolution", { headers })).json();
    expect(selected).toMatchObject({
      basis: null,
      status: "not_ready",
      selection: "lawyer",
      revision: 2,
      allowedDocumentKinds: ["fact_statement"],
    });
    await page.getByRole("button", { name: /^직접 해결/ }).click();
    await page.getByLabel("현재 리포트의 사실과 사용할 자료를 확인했어요.").check();
    await expect(page.getByRole("button", { name: "검토용 초안 준비" })).toBeDisabled();
    const state = await (await request.get("/fixture/resolution", { headers })).json();
    const denied = await request.post("/fixture/draft", {
      headers,
      data: {
        expectedRevision: state.revision,
        reportId: "report",
        reportRevision: 1,
        documentKind: "fact_statement",
        selectedFileIds: state.selectedFileIds,
        maskIdentifiers: state.maskIdentifiers,
        factsConfirmed: true,
      },
    });
    expect(denied.status()).toBe(409);
    expect(await denied.json()).toEqual({ code: "REVIEW_REQUIRED" });
    expect((await (await request.get("/fixture/resolution", { headers })).json()).draft).toBeNull();
  });

for (const code of ["STALE_REVISION", "REVIEW_REQUIRED", "POLICY_REJECTED"] as const)
  test(`actual facade 409 ${code} is a conflict confirmation without overwriting the saved draft`, async ({
    page,
    request,
  }) => {
    await page.goto("/?default");
    await page.getByRole("button", { name: /^직접 해결/ }).click();
    await page.getByLabel("현재 리포트의 사실과 사용할 자료를 확인했어요.").check();
    await page.getByRole("button", { name: "검토용 초안 준비" }).click();
    await page.getByLabel("초안 검토·수정").fill(`SYNTHETIC-SAVED-${code}`);
    await page.getByLabel("사실·증거·미입력 항목과 수정한 내용을 검토했어요.").check();
    await page.getByRole("button", { name: "검토한 초안 저장" }).click();
    await expect(page.getByRole("button", { name: "초안 다운로드", exact: true })).toBeEnabled();
    const headers = { "x-fixture-owner": "owner" };
    const before = await (await request.get("/fixture/resolution", { headers })).json();
    let attempts = 0;
    await page.route("**/api/v2/cases/case/rework/resolution/draft", (route) => {
      attempts++;
      return route.fulfill({ status: 409, json: { error: { code } } });
    });
    await page.getByLabel("현재 리포트의 사실과 사용할 자료를 확인했어요.").check();
    await page.getByRole("button", { name: "검토용 초안 준비" }).click();
    await expect(page.getByRole("alert")).toContainText("내용이 변경됐어요");
    await expect(page.getByRole("alert")).not.toContainText("작업을 완료하지 못했어요");
    await expect(page.getByRole("alert")).toHaveAttribute("data-action-error-code", "CONFLICT");
    await expect(page.getByRole("alert")).toHaveAttribute("data-action-error-http-status", "409");
    await expect(page.getByRole("alert")).toHaveAttribute("data-action-error-transport", "unknown");
    expect(await page.getByRole("alert").getAttribute("data-action-error-step")).toBeNull();
    expect(await page.getByRole("alert").getAttribute("data-load-error-code")).toBeNull();
    await expect(page.getByLabel("초안 검토·수정")).toHaveCount(0);
    await expect(page.getByText(/이전 기준의 초안이에요/)).toBeVisible();
    expect(attempts).toBe(1);
    const after = await (await request.get("/fixture/resolution", { headers })).json();
    expect(after).toEqual(before);
  });

test("diagnostic HTTP load/action channels clear at their own request and success boundaries", async ({
  page,
  request,
}) => {
  let failLoad = true,
    holdLoad = false,
    holdAction = false;
  let releaseLoad = () => {},
    releaseAction = () => {};
  const loadGate = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  const actionGate = new Promise<void>((resolve) => {
    releaseAction = resolve;
  });
  await page.route("**/api/v2/cases/case/rework/resolution", async (route) => {
    if (route.request().method() === "GET") {
      if (failLoad)
        return route.fulfill({
          status: 503,
          json: {
            error: { code: "DEPENDENCY_UNAVAILABLE", message: "SYNTHETIC-DIAGNOSTIC-PRIVATE" },
          },
        });
      if (holdLoad) await loadGate;
    }
    await route.continue();
  });
  await page.route("**/fixture/save-report", async (route) => {
    if (holdAction) {
      await actionGate;
      return route.fulfill({ json: null });
    }
    await route.continue();
  });
  try {
    await page.goto("/?default");
    const alert = page.getByRole("alert");
    await expect(alert).toHaveAttribute("data-load-error-code", "UNAVAILABLE");
    await expect(alert).toHaveAttribute("data-load-error-http-status", "503");
    await expect(alert).toHaveAttribute("data-load-error-transport", "unknown");
    expect(await alert.getAttribute("data-action-error-code")).toBeNull();
    await request.post("/fixture/control", { data: { failDownload: true } });
    await page.getByRole("button", { name: /^리포트만 저장/ }).click();
    await expect(alert).toHaveAttribute("data-action-error-code", "UNAVAILABLE");
    await expect(alert).toHaveAttribute("data-action-error-http-status", "503");
    await expect(alert).toHaveAttribute("data-action-error-transport", "unknown");
    await expect(alert).toHaveAttribute("data-load-error-http-status", "503");
    expect(await alert.getAttribute("data-action-error-step")).toBeNull();
    holdAction = true;
    await page.getByRole("button", { name: /^리포트만 저장/ }).click();
    await expect.poll(() => alert.getAttribute("data-action-error-code")).toBeNull();
    await expect(alert).toHaveAttribute("data-load-error-code", "UNAVAILABLE");
    releaseAction();
    await expect(page.getByRole("status")).toContainText("저장 요청");
    expect(await alert.getAttribute("data-action-error-code")).toBeNull();
    await expect(alert).toHaveAttribute("data-load-error-code", "UNAVAILABLE");
    failLoad = false;
    holdLoad = true;
    await page.getByRole("button", { name: "다시 확인", exact: true }).click();
    await expect(alert).toHaveCount(0);
    await expect(page.locator("[data-load-error-code], [data-action-error-code]")).toHaveCount(0);
    releaseLoad();
    await expect(page.getByRole("button", { name: /^변호사와 해결/ })).toBeEnabled();
    await expect(alert).toHaveCount(0);
    await page.getByRole("button", { name: /^변호사와 해결/ }).click();
    await expect(page.getByRole("link", { name: "변호사 목록·프로필 보기" })).toBeVisible();
    await expect(alert).toHaveCount(0);
    expect(await page.content()).not.toContain("SYNTHETIC-DIAGNOSTIC-PRIVATE");
  } finally {
    releaseLoad();
    releaseAction();
  }
});

for (const [mode, transport] of [
  ["timeout", "timeout"],
  ["abort", "abort"],
  ["hostile", "unknown"],
] as const)
  test(`diagnostic ${mode} never exposes arbitrary fields and is cleared after recovery and owner purge`, async ({
    page,
    request,
  }) => {
    const consoleMessages: string[] = [];
    page.on("console", (message) => {
      consoleMessages.push(message.text());
    });
    await page.goto(`/?synthetic-error=${mode}`);
    const alert = page.getByRole("alert");
    await expect(alert).toHaveAttribute("data-load-error-code", "unknown");
    await expect(alert).toHaveAttribute("data-load-error-http-status", "none");
    await expect(alert).toHaveAttribute("data-load-error-transport", transport);
    expect(await alert.getAttribute("data-action-error-code")).toBeNull();
    expect(await page.content()).not.toContain("SYNTHETIC-DIAGNOSTIC-PRIVATE");
    expect(consoleMessages.join("\n")).not.toContain("SYNTHETIC-DIAGNOSTIC-PRIVATE");
    await page.getByRole("button", { name: "다시 확인", exact: true }).click();
    await expect(page.getByRole("button", { name: /^직접 해결/ })).toBeEnabled();
    await expect(alert).toHaveCount(0);
    await request.post("/fixture/control", { data: { failDownload: true } });
    await page.getByRole("button", { name: /^리포트만 저장/ }).click();
    await expect(alert).toHaveAttribute("data-action-error-code", "UNAVAILABLE");
    await expect(alert).toHaveAttribute("data-action-error-http-status", "503");
    await expect(alert).toHaveAttribute("data-action-error-transport", "unknown");
    expect(await alert.getAttribute("data-load-error-code")).toBeNull();
    await request.post("/fixture/control", { data: { owner: "other-owner" } });
    await page.evaluate(() => window.dispatchEvent(new Event("baro-session-changed")));
    await expect(alert).toHaveAttribute("data-load-error-code", "NOT_FOUND");
    await expect(alert).toHaveAttribute("data-load-error-transport", "unknown");
    expect(await alert.getAttribute("data-action-error-code")).toBeNull();
    expect(await page.content()).not.toContain("SYNTHETIC-DIAGNOSTIC-PRIVATE");
    expect(consoleMessages.join("\n")).not.toContain("SYNTHETIC-DIAGNOSTIC-PRIVATE");
  });

for (const [mode, transport] of [
  ["TimeoutError", "timeout"],
  ["AbortError", "abort"],
  ["invalid-json", "unknown"],
] as const)
  test(`real facade ${mode} preserves finite diagnostics without exposing the original failure`, async ({
    page,
  }) => {
    await page.addInitScript((failure) => {
      const original = window.fetch.bind(window);
      let pending = true;
      window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (pending && url.includes("/rework/resolution")) {
          pending = false;
          if (failure === "invalid-json")
            return Promise.resolve(new Response("SYNTHETIC-DIAGNOSTIC-PRIVATE", { status: 200 }));
          return Promise.reject(new DOMException("SYNTHETIC-DIAGNOSTIC-PRIVATE", failure));
        }
        return original(input, init);
      }) as unknown as typeof window.fetch;
    }, mode);
    await page.goto("/?default");
    const alert = page.getByRole("alert");
    await expect(alert).toHaveAttribute("data-load-error-code", "UNAVAILABLE");
    await expect(alert).toHaveAttribute("data-load-error-http-status", "none");
    await expect(alert).toHaveAttribute("data-load-error-transport", transport);
    expect(await alert.getAttribute("data-action-error-code")).toBeNull();
    expect(await page.content()).not.toContain("SYNTHETIC-DIAGNOSTIC-PRIVATE");
    await page.getByRole("button", { name: "다시 확인", exact: true }).click();
    await expect(page.getByRole("button", { name: /^직접 해결/ })).toBeEnabled();
    await expect(alert).toHaveCount(0);
  });

async function openResolutionForStepTest(page: Page) {
  const loaded = page.waitForResponse(
    (response) =>
      response.url().endsWith("/rework/resolution") &&
      response.request().method() === "GET" &&
      response.status() === 200,
  );
  await page.goto("/?default");
  await loaded;
  await expect(page.getByRole("button", { name: "대화·리포트 보기 전환" })).toBeEnabled();
}

for (const step of ["files_read", "report_read", "resolution_read", "selection_update"] as const)
  test(`selection ${step} exposes only its failed facade step and clears on confirmation and success`, async ({
    page,
    request,
  }) => {
    if (step === "resolution_read")
      await request.post("/fixture/control", { data: { needsConsent: true } });
    await openResolutionForStepTest(page);
    let fail = true,
      failed = 0,
      patches = 0;
    const pattern =
      step === "files_read"
        ? "**/fixture/files?*"
        : step === "report_read"
          ? "**/api/v2/cases/case/rework/report"
          : "**/api/v2/cases/case/rework/resolution";
    await page.route(pattern, async (route) => {
      const method = route.request().method();
      if (method === "PATCH") patches++;
      if (fail && (step === "selection_update" ? method === "PATCH" : method === "GET")) {
        failed++;
        return route.fulfill({
          status: 503,
          json: {
            error: {
              code: "DEPENDENCY_UNAVAILABLE",
              message: "SYNTHETIC-STEP-PRIVATE",
              step: "SYNTHETIC-STEP-PRIVATE",
            },
          },
        });
      }
      await route.continue();
    });
    await page
      .getByRole("button", { name: step === "files_read" ? /^직접 해결/ : /^변호사와 해결/ })
      .click();
    const alert = page.getByRole("alert");
    await expect(alert).toHaveAttribute("data-action-error-step", step);
    await expect(alert).toHaveAttribute("data-action-error-code", "UNAVAILABLE");
    await expect(alert).toHaveAttribute("data-action-error-http-status", "503");
    await expect(alert).toHaveAttribute("data-action-error-transport", "unknown");
    expect(await alert.getAttribute("data-load-error-code")).toBeNull();
    expect(failed).toBe(1);
    expect(patches).toBe(step === "selection_update" ? 1 : 0);
    expect(await page.content()).not.toContain("SYNTHETIC-STEP-PRIVATE");
    fail = false;
    await page.getByRole("button", { name: "다시 확인", exact: true }).click();
    await expect(page.getByRole("button", { name: "대화·리포트 보기 전환" })).toBeEnabled();
    await expect(alert).toHaveCount(0);
    await expect(page.locator("[data-action-error-step]")).toHaveCount(0);
    await page.getByRole("button", { name: /^변호사와 해결/ }).click();
    await expect(page.getByRole("link", { name: "변호사 목록·프로필 보기" })).toBeVisible();
    await expect(page.locator("[data-action-error-step]")).toHaveCount(0);
    const calls = await (await request.get("/fixture/counts")).json();
    expect(calls.update).toBe(step === "resolution_read" ? 0 : 1);
    expect(calls.draft).toBe(0);
  });

test("selection session failure before any facade call has an unknown step and cannot claim a PATCH", async ({
  page,
  request,
}) => {
  await openResolutionForStepTest(page);
  const before = await (await request.get("/fixture/counts")).json();
  await page.route("**/fixture/session", (route) =>
    route.fulfill({ status: 503, json: { error: { code: "DEPENDENCY_UNAVAILABLE" } } }),
  );
  await page.getByRole("button", { name: /^변호사와 해결/ }).click();
  await expect(page.getByRole("alert")).toHaveAttribute("data-action-error-step", "unknown");
  await expect(page.getByRole("alert")).toHaveAttribute("data-action-error-code", "UNAVAILABLE");
  const after = await (await request.get("/fixture/counts")).json();
  expect(after).toEqual(before);
});

for (const next of ["success", "failure", "owner"] as const)
  test(`late parallel failure cannot overwrite the first selection step or a new ${next} outcome`, async ({
    page,
    request,
  }) => {
    await openResolutionForStepTest(page);
    let releaseFiles = () => {},
      releaseReport = () => {},
      releasePatch = () => {};
    const filesGate = new Promise<void>((resolve) => {
      releaseFiles = resolve;
    });
    const reportGate = new Promise<void>((resolve) => {
      releaseReport = resolve;
    });
    const patchGate = new Promise<void>((resolve) => {
      releasePatch = resolve;
    });
    let files = 0,
      reports = 0,
      patches = 0,
      held = 0,
      settled = 0,
      heldPatch = 0;
    await page.route("**/fixture/files?*", async (route) => {
      files++;
      if (files === 1) {
        await filesGate;
        return route.fulfill({ status: 503, json: { error: { code: "DEPENDENCY_UNAVAILABLE" } } });
      }
      await route.continue();
    });
    await page.route("**/api/v2/cases/case/rework/report", async (route) => {
      reports++;
      if (reports === 1) {
        held++;
        await reportGate;
        try {
          await route.fulfill({
            status: 503,
            json: { error: { code: "DEPENDENCY_UNAVAILABLE", message: "SYNTHETIC-STEP-PRIVATE" } },
          });
        } finally {
          settled++;
        }
        return;
      }
      await route.continue();
    });
    await page.route("**/api/v2/cases/case/rework/resolution", async (route) => {
      if (route.request().method() === "PATCH") {
        patches++;
        if (next === "failure") {
          heldPatch++;
          await patchGate;
          return route.fulfill({
            status: 503,
            json: { error: { code: "DEPENDENCY_UNAVAILABLE" } },
          });
        }
      }
      await route.continue();
    });
    try {
      await page.getByRole("button", { name: /^변호사와 해결/ }).click();
      await expect.poll(() => held).toBe(1);
      releaseFiles();
      const alert = page.getByRole("alert");
      await expect(alert).toHaveAttribute("data-action-error-step", "files_read");
      expect(patches).toBe(0);
      if (next === "owner") {
        await request.post("/fixture/control", { data: { owner: "other-owner" } });
        await page.evaluate(() => window.dispatchEvent(new Event("baro-session-changed")));
        await expect(alert).toHaveAttribute("data-load-error-code", "NOT_FOUND");
        expect(await alert.getAttribute("data-action-error-step")).toBeNull();
      } else {
        await page.getByRole("button", { name: /^변호사와 해결/ }).click();
        if (next === "success") {
          await expect(page.getByRole("link", { name: "변호사 목록·프로필 보기" })).toBeVisible();
          await expect(alert).toHaveCount(0);
        } else {
          await expect.poll(() => heldPatch).toBe(1);
          await expect(alert).toHaveCount(0);
          await expect(page.locator("[data-action-error-step]")).toHaveCount(0);
          releasePatch();
          await expect(alert).toHaveAttribute("data-action-error-step", "selection_update");
        }
      }
      releaseReport();
      await expect.poll(() => settled).toBe(1);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      if (next === "success") {
        await expect(alert).toHaveCount(0);
        await expect(page.locator("[data-action-error-step]")).toHaveCount(0);
      } else if (next === "failure") {
        await expect(alert).toHaveAttribute("data-action-error-step", "selection_update");
        await expect(alert).toHaveAttribute("data-action-error-code", "UNAVAILABLE");
      } else {
        await expect(alert).toHaveAttribute("data-load-error-code", "NOT_FOUND");
        expect(await alert.getAttribute("data-action-error-step")).toBeNull();
      }
      expect(patches).toBe(next === "owner" ? 0 : 1);
      expect(await page.content()).not.toContain("SYNTHETIC-STEP-PRIVATE");
    } finally {
      releaseFiles();
      releaseReport();
      releasePatch();
    }
  });

test("selection update facade failure does not prove that a PATCH was transmitted", async ({
  page,
  request,
}) => {
  let transmitted = 0;
  page.on("request", (event) => {
    if (event.method() === "PATCH" && event.url().endsWith("/rework/resolution")) transmitted++;
  });
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/rework/resolution") && init?.method === "PATCH")
        return Promise.reject(new DOMException("SYNTHETIC-STEP-PRIVATE", "TimeoutError"));
      return original(input, init);
    }) as unknown as typeof window.fetch;
  });
  await openResolutionForStepTest(page);
  await page.getByRole("button", { name: /^변호사와 해결/ }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toHaveAttribute("data-action-error-step", "selection_update");
  await expect(alert).toHaveAttribute("data-action-error-code", "UNAVAILABLE");
  await expect(alert).toHaveAttribute("data-action-error-http-status", "none");
  await expect(alert).toHaveAttribute("data-action-error-transport", "timeout");
  expect(transmitted).toBe(0);
  const calls = await (await request.get("/fixture/counts")).json();
  expect(calls.update).toBe(0);
  expect(calls.draft).toBe(0);
  expect(await page.content()).not.toContain("SYNTHETIC-STEP-PRIVATE");
});
