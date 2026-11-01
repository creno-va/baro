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
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect(await page.evaluate(() => window.conversationFixture.calls.length)).toBe(1);
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
  await page.getByRole("button", { name: "합성 계정 전환" }).click();
  expect(await page.evaluate(() => window.conversationFixture.aborted)).toBe(true);
  await page.evaluate(() => window.conversationFixture.resolve?.());
  await expect(page.getByRole("region", { name: "리포트 준비와 검토" })).toHaveCount(0);
  await expect(page.getByLabel("검토 중인 입력")).toHaveCount(0);
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
