import { expect, type Page, test } from "@playwright/test";
import { workspace } from "../fixtures/contracts/v2";

const id = "synthetic-file-page";
const metadata = (fileId: string, processing = false, failed = false) => ({
  id: fileId,
  name: `${fileId}.pdf`,
  revision: 2,
  declaredMediaType: "application/pdf",
  byteLength: 25_842,
  status: failed ? "failed" : processing ? "queued" : "ready",
  canRetry: failed,
  failure: null,
  createdAt: workspace.createdAt,
  ...(processing
    ? { processing: { status: "running", phase: "extracting", updatedAt: workspace.updatedAt } }
    : {}),
});
async function setup(page: Page, retryFailureStatus = 503, failRetryRead = false) {
  const state = {
    session: {
      user: { id: "synthetic-owner", name: "Synthetic", accountType: "customer" },
      needsConsent: false,
    },
    files: [metadata("private-ready"), metadata("accepted-video", true)],
    revision: workspace.workspaceRevision,
    expired: false,
    failFinal: false,
    privateReads: 0,
    globalReads: 0,
    workspaceReads: 0,
    fileReads: 0,
    reviewReads: 0,
    retryCalls: 0,
    retryFails: true,
    failNextWorkspace: false,
    pauseSession: undefined as Promise<void> | undefined,
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/me/session") {
      await state.pauseSession;
      if (state.expired)
        return route.fulfill({ status: 401, json: { error: { code: "UNAUTHENTICATED" } } });
      return route.fulfill({ json: state.session });
    }
    if (path.endsWith("/workspace")) {
      state.workspaceReads++;
      if (state.failNextWorkspace) {
        state.failNextWorkspace = false;
        return route.fulfill({ status: 503, json: { error: {} } });
      }
      if (state.session.user.id !== "synthetic-owner")
        return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
      return route.fulfill({
        json: {
          ...workspace,
          id,
          workspaceRevision:
            state.revision + (state.failFinal && state.workspaceReads % 2 === 0 ? 1 : 0),
        },
      });
    }
    if (path.endsWith("/files")) {
      state.fileReads++;
      return route.fulfill({ json: state.files });
    }
    if (path.endsWith("/files/failed-material/retry")) {
      state.retryCalls++;
      if (state.retryFails) {
        state.failNextWorkspace = failRetryRead;
        return route.fulfill({ status: retryFailureStatus, json: { error: {} } });
      }
      const accepted = metadata("failed-material", true);
      state.files = state.files.map((file) => (file.id === accepted.id ? accepted : file));
      return route.fulfill({ json: accepted });
    }
    if (path.includes("/review")) {
      state.reviewReads++;
      return route.fulfill({
        json: {
          file: { id: "private-ready", revision: 2, name: "private-ready.pdf", status: "ready" },
          workspaceRevision: state.revision,
          coverage: {
            category: "document",
            status: "complete",
            pageCount: 1,
            pages: [{ page: 1, status: "processed" }],
          },
          observations: [],
          nextAfterOrdinal: null,
          pendingReview: null,
          recovery: null,
        },
      });
    }
    if (/\/files\/[^/]+$/.test(path)) state.privateReads++;
    else if (path.startsWith(`/api/v2/cases/${id}/`)) state.globalReads++;
    return route.fulfill({ status: 409, json: { error: { code: "STALE_REVISION" } } });
  });
  return state;
}

test("files route loads and polls while summary streams are unavailable, then reads coverage only in review", async ({
  page,
}) => {
  const state = await setup(page);
  await page.goto(`/cases/${id}/files`);
  await expect(
    page.getByRole("heading", { name: "accepted-video.pdf", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("처리 중 · 최근 확인 단계: 자료 추출", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("자료 확인에서 처리 범위를 확인할 수 있어요.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("확인한 요약이 아직 없어요.", { exact: true })).toHaveCount(0);
  state.files = [metadata("private-ready"), metadata("accepted-video")];
  await expect(page.getByText("결과 확인 가능", { exact: true })).toHaveCount(2);
  expect(state.globalReads).toBe(0);
  expect(state.privateReads).toBe(0);
  expect(state.reviewReads).toBe(0);
  await page.getByRole("button", { name: "자료 확인", exact: true }).first().click();
  await expect(page.getByRole("dialog")).toContainText("1쪽 · 처리됨");
  expect(state.reviewReads).toBeGreaterThan(0);
});

test("files refresh rejects a changed final revision and manual recovery performs only fresh reads", async ({
  page,
}) => {
  const state = await setup(page);
  state.failFinal = true;
  await page.goto(`/cases/${id}/files`);
  await expect(page.getByRole("alert")).toContainText("최신 자료 목록");
  await expect(page.getByText("private-ready.pdf", { exact: true })).toHaveCount(0);
  expect(state.workspaceReads).toBe(2);
  expect(state.fileReads).toBe(1);
  state.failFinal = false;
  await page.getByRole("button", { name: "새로고침 · 다시 확인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "private-ready.pdf", exact: true })).toBeVisible();
  expect(state.globalReads).toBe(0);
});

test("processing files keep polling after a focus revision failure and clear only that read error", async ({
  page,
}) => {
  const state = await setup(page);
  await page.goto(`/cases/${id}/files`);
  await expect(
    page.getByRole("heading", { name: "accepted-video.pdf", exact: true }),
  ).toBeVisible();
  state.failFinal = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("alert")).toContainText("최신 자료 목록");
  await expect(
    page.getByRole("heading", { name: "accepted-video.pdf", exact: true }),
  ).toBeVisible();
  state.failFinal = false;
  state.files = [metadata("private-ready"), metadata("accepted-video")];
  await expect(page.getByText("결과 확인 가능", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("alert")).toHaveCount(0);
  const reads = state.workspaceReads;
  await page.waitForTimeout(2000);
  expect(state.workspaceReads).toBe(reads);
  expect(state.globalReads).toBe(0);
  expect(state.retryCalls).toBe(0);
});

for (const [status, message, failRetryRead] of [
  [503, "지금 요청을 처리할 수 없어요.", false],
  [404, "사건 또는 자료를 찾을 수 없어요.", false],
  [409, "다른 화면에서 내용이 바뀌었어요.", false],
  [404, "사건 또는 자료를 찾을 수 없어요.", true],
] as const)
  test(`successful file polling restores an unresolved mutation error after a focus read failure: ${status}, classification read fails=${failRetryRead}`, async ({
    page,
  }) => {
    const state = await setup(page, status, failRetryRead);
    state.files = [metadata("failed-material", false, true), metadata("accepted-video", true)];
    await page.goto(`/cases/${id}/files`);
    const retry = page.getByRole("button", { name: "처리 다시 시도", exact: true });
    await retry.click();
    await expect(page.getByRole("alert")).toContainText(
      failRetryRead ? "지금 요청을 처리할 수 없어요." : message,
    );
    state.failFinal = true;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("alert")).toContainText("최신 자료 목록");
    state.failFinal = false;
    state.files = [metadata("failed-material", false, true), metadata("accepted-video")];
    await expect(page.getByText("결과 확인 가능", { exact: true })).toHaveCount(1);
    await expect(page.getByRole("alert")).toContainText(message);
    await expect(page.getByRole("alert")).not.toContainText("최신 자료 목록");
    await expect(page.getByRole("alert")).not.toContainText("이전 내용을 비웠어요.");
    expect(state.retryCalls).toBe(1);
    expect(state.globalReads).toBe(0);
    state.retryFails = false;
    await retry.click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(
      page.getByText("자료 처리 요청이 접수됐어요. 아래에서 처리 상태를 확인할 수 있어요."),
    ).toBeVisible();
    expect(state.retryCalls).toBe(2);
  });

test("owner replacement after a mutation and read failure purges the stored error and private files", async ({
  page,
}) => {
  const state = await setup(page);
  state.files = [metadata("failed-material", false, true), metadata("accepted-video", true)];
  await page.goto(`/cases/${id}/files`);
  await page.getByRole("button", { name: "처리 다시 시도", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("지금 요청을 처리할 수 없어요.");
  state.failFinal = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("alert")).toContainText("최신 자료 목록");
  state.session.user.id = "other-owner";
  state.failFinal = false;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("alert")).toContainText("사건 또는 자료를 찾을 수 없어요.");
  await expect(page.getByText("failed-material.pdf", { exact: true })).toHaveCount(0);
  await expect(page.getByText("accepted-video.pdf", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("alert")).not.toContainText("지금 요청을 처리할 수 없어요.");
  expect(state.retryCalls).toBe(1);
});

for (const change of ["same-owner", "owner", "role", "consent", "expired"] as const)
  test(`explicit session change hides private files until current access is known: ${change}`, async ({
    page,
  }) => {
    const state = await setup(page);
    state.files = [metadata("private-ready")];
    await page.goto(`/cases/${id}/files`);
    await expect(
      page.getByRole("heading", { name: "private-ready.pdf", exact: true }),
    ).toBeVisible();
    let release!: () => void;
    state.pauseSession = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.evaluate(() => window.dispatchEvent(new Event("baro-session-changed")));
    await expect(
      page.getByRole("heading", { name: "private-ready.pdf", exact: true }),
    ).not.toBeVisible();
    if (change === "owner") state.session.user.id = "other-owner";
    if (change === "role") state.session.user.accountType = "lawyer";
    if (change === "consent") state.session.needsConsent = true;
    if (change === "expired") state.expired = true;
    state.pauseSession = undefined;
    release();
    if (change === "owner" || change === "role" || change === "expired") {
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(page.getByText("private-ready.pdf", { exact: true })).toHaveCount(0);
    } else {
      await expect(
        page.getByRole("heading", { name: "private-ready.pdf", exact: true }),
      ).toBeVisible();
      if (change === "consent") {
        await expect(
          page.getByText("저장한 사건·자료는 읽을 수 있어요.", { exact: false }),
        ).toBeVisible();
        await expect(page.getByLabel("선택 자료의 자동 처리에 동의합니다.")).toBeDisabled();
      }
    }
    expect(state.globalReads).toBe(0);
  });
