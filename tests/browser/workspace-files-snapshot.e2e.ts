import { expect, type Page, test } from "@playwright/test";
import { workspace } from "../fixtures/contracts/v2";

const id = "synthetic-file-page";
const metadata = (fileId: string, processing = false) => ({
  id: fileId,
  name: `${fileId}.pdf`,
  revision: 2,
  declaredMediaType: "application/pdf",
  byteLength: 25_842,
  status: processing ? "queued" : "ready",
  failure: null,
  createdAt: workspace.createdAt,
  ...(processing
    ? { processing: { status: "running", phase: "extracting", updatedAt: workspace.updatedAt } }
    : {}),
});
async function setup(page: Page) {
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

for (const change of ["same-owner", "owner", "role", "consent", "expired"] as const)
  test(`files focus keeps private content hidden until current access is known: ${change}`, async ({
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
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
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
