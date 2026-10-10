import { expect, type Page, test } from "@playwright/test";

async function fixture(page: Page, processing = false) {
  const state = { ready: !processing, revision: 1, reads: 0, writes: 0 };
  const id = "synthetic-material-case",
    fileId = "synthetic-material-file";
  const file = () => ({
    id: fileId,
    name: "합성 자료.txt",
    mimeType: "text/plain",
    sizeBytes: 100,
    status: state.ready ? "ready" : "processing",
    coverage: state.ready ? "문서 5쪽 중 5쪽 확인 가능" : "자료 처리 중",
    extractedText: "합성 추출 내용",
  });
  const observation = (ordinal: number) => {
    const value = {
      id: `synthetic-observation-${ordinal}`,
      text: `합성 원본 ${ordinal}`,
      position: { kind: "document", page: ordinal + 1, paragraph: null, table: null },
      certainty: "observed",
      userEdited: false,
      included: true,
    };
    return { ordinal, value, original: value };
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/me/session")
      return route.fulfill({
        json: {
          user: { id: "synthetic-owner", name: "합성 사용자", accountType: "customer" },
          needsConsent: false,
        },
      });
    if (url.pathname.endsWith("/workspace"))
      return route.fulfill({
        json: {
          case: {
            id,
            title: "합성 사건",
            subjectContext: "individual",
            stage: "active",
            revision: state.revision,
            updatedAt: "2026-10-10T00:00:00Z",
            summary: "합성 확인 요약",
            schemaVersion: "2",
          },
          messages: [],
          actions: [],
          timeline: [],
          files: [file()],
        },
      });
    if (url.pathname.endsWith("/review")) {
      state.reads++;
      const after = Number(url.searchParams.get("afterOrdinal") ?? -1);
      return route.fulfill({
        json: {
          file: { id: fileId, revision: state.revision, name: file().name, status: file().status },
          workspaceRevision: state.revision,
          coverage: state.ready
            ? {
                category: "document",
                status: "complete",
                pageCount: 5,
                pages: Array.from({ length: 5 }, (_, i) => ({ page: i + 1, status: "processed" })),
              }
            : null,
          observations: state.ready
            ? after < 0
              ? Array.from({ length: 4 }, (_, i) => observation(i))
              : [observation(4)]
            : [],
          nextAfterOrdinal: state.ready && after < 0 ? 3 : null,
          pendingReview: null,
          recovery: null,
        },
      });
    }
    if (request.method() !== "GET") state.writes++;
    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
  });
  await page.goto(`/cases/${id}/files`);
  await page.getByRole("button", { name: "자료 확인", exact: true }).click();
  return state;
}

test("material focus refresh preserves a dirty later page and still detects a peer revision", async ({
  page,
}) => {
  const state = await fixture(page);
  const fields = page.getByRole("dialog").getByLabel("확인·교정한 내용");
  await expect(fields).toHaveCount(4);
  await page.getByRole("button", { name: "다음 처리 내용 보기", exact: true }).click();
  await expect(fields).toHaveCount(5);
  await fields.nth(4).fill("저장 전 다섯 번째 교정");
  await page.evaluate(async () => {
    const path = "/src/client/api/index.ts";
    const { api } = (await import(path)) as typeof import("../../src/client/api");
    const tracker = window as unknown as Window & { materialReadsInFlight: number };
    tracker.materialReadsInFlight = 0;
    const session = api.session.get;
    api.session.get = async (...args: Parameters<typeof session>) => {
      tracker.materialReadsInFlight++;
      try {
        return await session(...args);
      } finally {
        tracker.materialReadsInFlight--;
      }
    };
    const review = api.files.review;
    api.files.review = async (...args: Parameters<typeof review>) => {
      tracker.materialReadsInFlight++;
      try {
        return await review(...args);
      } finally {
        tracker.materialReadsInFlight--;
      }
    };
    const workspace = api.workspace.get;
    api.workspace.get = async (...args: Parameters<typeof workspace>) => {
      tracker.materialReadsInFlight++;
      try {
        return await workspace(...args);
      } finally {
        tracker.materialReadsInFlight--;
      }
    };
  });
  const readsBeforeFocus = state.reads;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => state.reads).toBeGreaterThan(readsBeforeFocus);
  const pendingReads = () =>
    page.evaluate(
      () => (window as unknown as Window & { materialReadsInFlight: number }).materialReadsInFlight,
    );
  await expect.poll(pendingReads).toBe(0);
  // Complete the postflight reads and the queued React render before the next peer event.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect.poll(pendingReads).toBe(0);
  await expect(fields).toHaveCount(5);
  await expect(fields.nth(4)).toHaveValue("저장 전 다섯 번째 교정");
  state.revision++;
  const readsBeforePeerFocus = state.reads;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => state.reads).toBeGreaterThan(readsBeforePeerFocus);
  await expect(
    page.getByRole("region", { name: "자료 내용 검토" }).getByRole("alert"),
  ).toBeVisible();
  await expect(fields.nth(4)).toHaveValue("저장 전 다섯 번째 교정");
  await expect(page.getByRole("button", { name: "교정 내용 저장", exact: true })).toBeDisabled();
});

test("processing completion refreshes observations inside the already open material dialog", async ({
  page,
}) => {
  const state = await fixture(page, true);
  const fields = page.getByRole("dialog").getByLabel("확인·교정한 내용");
  await expect(page.getByText("페이지·시간별 처리 범위 (0개)", { exact: true })).toBeVisible();
  state.ready = true;
  state.revision++;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(fields).toHaveCount(4);
  await expect(fields.first()).toHaveValue("합성 원본 0");
});

for (const pressEscape of [true, false])
  test(`dirty material dismissal can be cancelled; Escape=${pressEscape}`, async ({ page }) => {
    const state = await fixture(page);
    const dialog = page.getByRole("dialog"),
      field = dialog.getByLabel("확인·교정한 내용").first();
    await field.fill("저장하지 않은 교정");
    let warnings = 0;
    page.on("dialog", async (confirmation) => {
      warnings++;
      await confirmation.dismiss();
    });
    if (pressEscape) await field.press("Escape");
    else await dialog.getByRole("button", { name: "닫기", exact: true }).first().click();
    await expect(dialog).toBeVisible();
    await expect(field).toHaveValue("저장하지 않은 교정");
    expect(warnings).toBe(1);
    expect(state.writes).toBe(0);
  });

test("partial large correction keeps its original retry baseline across focus refresh", async ({
  page,
}) => {
  const state = await fixture(page);
  const fields = page.getByRole("dialog").getByLabel("확인·교정한 내용");
  await page.getByRole("button", { name: "다음 처리 내용 보기", exact: true }).click();
  await expect(fields).toHaveCount(5);
  for (let i = 0; i < 5; i++) await fields.nth(i).fill("가".repeat(5000));
  let starts = 0,
    lost = false;
  const bodies: string[] = [];
  await page.route("**/observations", async (route) => {
    const request = route.request();
    if (request.method() !== "PATCH") return route.fallback();
    starts++;
    bodies.push(request.postData() ?? "");
    if (starts === 2 && !lost) {
      lost = true;
      await route.abort("failed");
      return;
    }
    state.revision++;
    await route.fulfill({
      json: {
        reviewId: `synthetic-batch-${starts}`,
        fileId: "synthetic-material-file",
        revision: state.revision,
        workspaceRevision: state.revision,
        status: "ready",
        completed: 1,
        total: 1,
      },
    });
  });
  const save = page.getByRole("button", { name: "교정 내용 저장", exact: true });
  await save.click();
  await expect(
    page.getByText(
      "4개 교정은 저장했어요. 남은 교정은 아직 저장하지 못했으며 입력은 그대로 남아 있어요.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(save).toBeEnabled();
  await expect(fields).toHaveCount(5);
  await expect(fields.nth(4)).toHaveValue("가".repeat(5000));
  await save.click();
  await expect(
    page.getByText("교정 내용을 저장했어요. 새로 접속해도 유지됩니다.", { exact: true }),
  ).toBeVisible();
  expect(starts).toBe(3);
  expect(bodies[1]).toBe(bodies[2]);
  expect(JSON.parse(bodies[2] ?? "{}").expectedRevision).toBe(2);
});
