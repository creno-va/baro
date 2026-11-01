import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("320px inline work stays on the conversation, protects dirty input and restores keyboard focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/__conversation-agent");
  const primary = page.getByRole("button", { name: "리포트 준비·검토", exact: true });
  await expect(primary).toBeVisible();
  expect(await page.evaluate(() => window.conversationFixture.calls)).toEqual([]);
  await primary.focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("region", { name: "리포트 준비와 검토" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "리포트 준비와 검토" })).toBeFocused();
  await panel.getByLabel("검토 중인 입력").fill("보존할 합성 초안");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.keyboard.press("Escape");
  await expect(panel.getByLabel("검토 중인 입력")).toHaveValue("보존할 합성 초안");
  page.once("dialog", (dialog) => dialog.accept());
  await page.keyboard.press("Escape");
  await expect(panel).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "이후 해결 방법 선택", exact: true }),
  ).toBeFocused();
  expect(page.url()).toContain("/__conversation-agent");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include(".workspace").analyze()).violations).toEqual([]);
  await page.screenshot({ path: "/tmp/baro-625-conversation-320.png", fullPage: true });
});

test("opening a report pane alone does not acknowledge that its current body was reviewed", async ({
  page,
}) => {
  await page.goto("/__conversation-agent");
  const primary = page.getByRole("button", { name: "리포트 준비·검토", exact: true });
  await primary.click();
  await expect(page.getByRole("region", { name: "리포트 준비와 검토", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(primary).toBeVisible();
  await primary.click();
  await page.getByLabel("검토 중인 입력").focus();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "이후 해결 방법 선택", exact: true }),
  ).toBeVisible();
});

test("a newly completed intent runs once; rereading historical intents does not execute", async ({
  page,
}) => {
  await page.goto("/__conversation-agent");
  await expect(page.getByRole("button", { name: "리포트 준비·검토", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.conversationFixture.calls.length)).toBe(0);
  await page.evaluate(() => window.conversationFixture.emitIntent("analyze_legal"));
  await expect(
    page.getByRole("region", { name: "법률·판례와 현재 약점", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => window.conversationFixture.calls.map((request) => request.action)),
  ).toEqual(["analyze_legal"]);
  await page.getByRole("button", { name: "대화 작업 닫기" }).click();
  await expect(
    page.getByRole("textbox", { name: "추가 사실 또는 질문", exact: true }),
  ).toBeFocused();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect(await page.evaluate(() => window.conversationFixture.calls.length)).toBe(1);
});

for (const focusTarget of ["removed", "outside", "modal"] as const)
  test(`completed pane controls preserve focus (${focusTarget})`, async ({ page }) => {
    await page.goto("/__conversation-agent");
    await page.getByRole("button", { name: "리포트 준비·검토", exact: true }).click();
    const panel = page.getByRole("region", { name: "리포트 준비와 검토", exact: true });
    await panel.getByRole("button", { name: "합성 비동기 작업", exact: true }).click();
    await expect(panel.getByRole("button", { name: "대화 작업 닫기", exact: true })).toBeDisabled();
    const outside = page.getByRole("button", { name: "합성 계정 전환", exact: true });
    if (focusTarget === "outside") await outside.focus();
    if (focusTarget === "modal")
      await page.evaluate(() => {
        const dialog = document.createElement("dialog");
        dialog.setAttribute("aria-label", "합성 내부 모달");
        const button = document.createElement("button");
        button.textContent = "합성 모달 내부";
        dialog.appendChild(button);
        document.querySelector(".conversation-panel")!.appendChild(dialog);
        dialog.showModal();
        button.focus();
      });
    await page.evaluate(() => window.conversationFixture.finishPaneTask());
    await expect(panel.getByRole("button", { name: "합성 비동기 작업", exact: true })).toHaveCount(
      0,
    );
    if (focusTarget === "outside") await expect(outside).toBeFocused();
    else if (focusTarget === "modal") {
      await expect(page.getByRole("button", { name: "합성 모달 내부", exact: true })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("dialog", { name: "합성 내부 모달", exact: true }),
      ).not.toBeVisible();
      await expect(panel).toBeVisible();
    } else
      await expect(
        panel.getByRole("heading", { name: "리포트 준비와 검토", exact: true }),
      ).toBeFocused();
  });

test("an ambiguous action keeps the same complete request when checking its result", async ({
  page,
}) => {
  await page.goto("/__conversation-agent");
  const primary = page.getByRole("button", { name: "리포트 준비·검토", exact: true });
  await expect(primary).toBeVisible();
  await page.evaluate(() => {
    window.conversationFixture.fail = true;
  });
  await primary.click();
  await expect(page.getByRole("alert")).toContainText("합성 timeout");
  const original = await page.evaluate(() => window.conversationFixture.calls[0]);
  await page.evaluate(() => {
    window.conversationFixture.fail = false;
    window.conversationFixture.catchUpState();
    window.conversationFixture.advanceWorkspace();
  });
  await page.getByRole("button", { name: "같은 요청 결과 확인" }).click();
  await expect(page.getByRole("region", { name: "리포트 준비와 검토" })).toBeVisible();
  expect(await page.evaluate(() => window.conversationFixture.calls[1])).toEqual(original);
});

test("a newly received intent from a previous revision cannot execute", async ({ page }) => {
  await page.goto("/__conversation-agent");
  await expect(page.getByRole("button", { name: "리포트 준비·검토", exact: true })).toBeVisible();
  await page.evaluate(() => window.conversationFixture.emitIntent("prepare_report", 7));
  await expect(page.getByRole("region", { name: "리포트 준비와 검토" })).toHaveCount(0);
  expect(await page.evaluate(() => window.conversationFixture.calls.length)).toBe(0);
  await page.evaluate(() => window.conversationFixture.emitIntent("show_preparation"));
  await expect(page.getByRole("region", { name: "사건의 흐름과 다음 행동" })).toBeVisible();
  expect(
    await page.evaluate(() => window.conversationFixture.calls.map((item) => item.action)),
  ).toEqual(["show_preparation"]);
});

for (const failure of ["unavailable", "parse"] as const)
  test(`an open analysis exposes a ${failure} read failure and stops polling until explicit recovery`, async ({
    page,
  }) => {
    await page.goto("/__conversation-agent");
    await expect(page.getByRole("button", { name: "리포트 준비·검토", exact: true })).toBeVisible();
    await page.evaluate(() => window.conversationFixture.emitIntent("analyze_legal"));
    const panel = page.getByRole("region", { name: "법률·판례와 현재 약점", exact: true });
    await expect(panel).toBeVisible();
    await page.clock.install();
    await page.evaluate((mode) => {
      window.conversationFixture.readFailure = mode;
      window.conversationFixture.advanceWorkspace();
    }, failure);
    await expect(panel.getByRole("alert")).toBeVisible();
    await expect(panel.getByRole("button", { name: "상태 다시 확인", exact: true })).toBeEnabled();
    await expect(
      panel.getByText("현재 사건 상태를 다시 확인하고 있어요.", { exact: false }),
    ).toHaveCount(0);
    const failedReads = await page.evaluate(() => window.conversationFixture.reads);
    await page.clock.fastForward(10000);
    expect(await page.evaluate(() => window.conversationFixture.reads)).toBe(failedReads);
    await page.evaluate(() => {
      window.conversationFixture.readFailure = null;
      window.conversationFixture.catchUpState();
    });
    await panel.getByRole("button", { name: "상태 다시 확인", exact: true }).click();
    await expect(panel.getByRole("alert")).toHaveCount(0);
    expect(
      await page.evaluate(() => window.conversationFixture.calls.map((x) => x.action)),
    ).toEqual(["analyze_legal"]);
  });

test("a concurrent revision change during intent preflight cannot silently rebase its action", async ({
  page,
}) => {
  await page.goto("/__conversation-agent");
  const primary = page.getByRole("button", { name: "리포트 준비·검토", exact: true });
  await expect(primary).toBeVisible();
  await page.evaluate(() => {
    window.conversationFixture.advanceAfterIntentRead = true;
    window.conversationFixture.emitIntent("prepare_report");
  });
  await expect(page.getByRole("alert")).toContainText("요청을 준비한 뒤 사건이 바뀌었어요");
  expect(await page.evaluate(() => window.conversationFixture.calls)).toEqual([]);
  await expect(primary).toBeEnabled();
  await primary.click();
  await expect(page.getByRole("region", { name: "리포트 준비와 검토" })).toBeVisible();
  const calls = await page.evaluate(() => window.conversationFixture.calls);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.expectedRevision).toBe(9);
});

test("a definitive quota rejection ends the attempt; explicit retry after recovery uses a new request", async ({
  page,
}) => {
  await page.goto("/__conversation-agent");
  const primary = page.getByRole("button", { name: "리포트 준비·검토", exact: true });
  await expect(primary).toBeVisible();
  await page.evaluate(() => {
    window.conversationFixture.fail = true;
    window.conversationFixture.failureCode = "USER_QUOTA_EXCEEDED";
  });
  await primary.click();
  await expect(page.getByRole("alert")).toContainText("합성 이용 한도");
  await expect(page.getByRole("button", { name: "같은 요청 결과 확인", exact: true })).toHaveCount(
    0,
  );
  await page.evaluate(() => {
    window.conversationFixture.fail = false;
  });
  await primary.click();
  await expect(page.getByRole("region", { name: "리포트 준비와 검토", exact: true })).toBeVisible();
  const calls = await page.evaluate(() => window.conversationFixture.calls);
  expect(calls).toHaveLength(2);
  expect(calls[1]?.requestId).not.toBe(calls[0]?.requestId);
});

test("scope revocation aborts pending actions and discards the late result", async ({ page }) => {
  await page.goto("/__conversation-agent");
  const primary = page.getByRole("button", { name: "리포트 준비·검토", exact: true });
  await expect(primary).toBeVisible();
  await page.evaluate(() => {
    window.conversationFixture.delay = true;
  });
  await primary.click();
  await expect.poll(() => page.evaluate(() => window.conversationFixture.calls.length)).toBe(1);
  const switchAccount = page.getByRole("button", { name: "합성 계정 전환", exact: true });
  await switchAccount.focus();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => window.conversationFixture.aborted)).toBe(true);
  await page.evaluate(() => window.conversationFixture.resolve?.());
  await expect(page.getByRole("region", { name: "리포트 준비와 검토" })).toHaveCount(0);
  await expect(page.getByLabel("검토 중인 입력")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "합성 계정 전환", exact: true })).toBeFocused();
});

test("a stale read after a concurrent edit preserves the draft and cannot execute another action", async ({
  page,
}) => {
  await page.goto("/__conversation-agent");
  await page.getByRole("button", { name: "리포트 준비·검토", exact: true }).click();
  const draft = page.getByLabel("검토 중인 입력");
  await draft.fill("경합 중에도 보존할 초안");
  await page.evaluate(() => window.conversationFixture.advanceWorkspace());
  await expect(page.getByRole("alert")).toContainText("최신 작업 상태");
  await expect(draft).toHaveValue("경합 중에도 보존할 초안");
  await expect(draft).toBeDisabled();
  expect(await page.evaluate(() => window.conversationFixture.calls.length)).toBe(1);
  await page.evaluate(() => window.conversationFixture.catchUpState());
  await page.getByRole("button", { name: "상태 다시 확인" }).click();
  await expect(draft).toBeEnabled();
  await expect(draft).toHaveValue("경합 중에도 보존할 초안");
  expect(await page.evaluate(() => window.conversationFixture.calls.length)).toBe(1);
});

test("consent withdrawal preserves authorized stored views without posting an action or enabling edits", async ({
  page,
}) => {
  await page.goto("/__conversation-agent");
  await expect(page.getByRole("button", { name: "리포트 준비·검토", exact: true })).toBeVisible();
  await page.evaluate(() => window.conversationFixture.withdrawConsent());
  await page.getByRole("button", { name: "리포트 준비·검토", exact: true }).click();
  const panel = page.getByRole("region", { name: "리포트 준비와 검토", exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: "기존 저장본 읽기", exact: true })).toBeEnabled();
  await expect(panel.getByLabel("검토 중인 입력")).toBeDisabled();
  expect(await page.evaluate(() => window.conversationFixture.calls)).toEqual([]);
});

test("an earlier report request resumes only its view after server completion, preserving dirty material review", async ({
  page,
}) => {
  await page.goto("/__conversation-agent");
  await expect(page.getByRole("button", { name: "리포트 준비·검토", exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.conversationFixture.reportBlocked = true;
  });
  await page.getByRole("button", { name: "리포트 준비·검토", exact: true }).click();
  const materials = page.getByRole("region", { name: "자료 추가와 검토", exact: true });
  await materials.getByLabel("검토 중인 입력").fill("저장 전 검토 의견");
  await page.evaluate(() => window.conversationFixture.finishReport());
  await expect(materials.getByLabel("검토 중인 입력")).toHaveValue("저장 전 검토 의견");
  await expect(page.getByRole("region", { name: "리포트 준비와 검토", exact: true })).toHaveCount(
    0,
  );
  await materials.getByRole("button", { name: "합성 입력 저장", exact: true }).click();
  await expect(page.getByRole("region", { name: "리포트 준비와 검토", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.conversationFixture.calls.length)).toBe(1);
});
