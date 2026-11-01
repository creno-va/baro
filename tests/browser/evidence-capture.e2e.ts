import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const photo = {
  name: "합성-영수증.jpg",
  mimeType: "image/jpeg",
  buffer: readFileSync(new URL("../fixtures/media/image-markers.jpg", import.meta.url)),
};
const positions = [
  "[문서 기재] 합성 금액 12,000원",
  "[보이는 상태] 화면에 말풍선이 보여요",
  "[확인 필요] 날짜 글자가 흐려요",
];
async function fixture(page: Page, partial = false) {
  const state = {
    owner: "synthetic-owner",
    needsConsent: false,
    revision: 1,
    writes: [] as string[],
    files: [] as Record<string, unknown>[],
    failPart: false,
    reject: false,
    withdrawOnComplete: false,
    pause: null as Promise<void> | null,
    edits: {} as Record<string, { text: string; included: boolean }>,
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (path === "/api/me/session")
      return route.fulfill({
        json: {
          user: state.owner
            ? { id: state.owner, accountType: "customer", name: "합성 사용자" }
            : null,
          needsConsent: state.needsConsent,
        },
      });
    if (request.method() !== "GET") state.writes.push(`${request.method()} ${path}`);
    if (path.endsWith("/review"))
      return route.fulfill({
        json: {
          file: {
            id: "synthetic-photo",
            revision: state.revision,
            name: "합성 사진",
            status: "ready",
          },
          workspaceRevision: state.revision,
          coverage: {
            category: "image",
            status: partial ? "partial" : "complete",
            observation: partial ? "low_quality" : "processed",
          },
          observations: positions.map((text, ordinal) => {
            const original = {
              id: `synthetic-${ordinal}`,
              text,
              position: {
                kind: "image",
                region: ordinal ? { x: 0.1, y: 0.2, width: 0.5, height: 0.3 } : null,
              },
              certainty: "uncertain",
              userEdited: false,
              included: true,
            };
            return {
              ordinal,
              original,
              value: {
                ...original,
                ...state.edits[original.id],
                userEdited: !!state.edits[original.id],
              },
            };
          }),
          nextAfterOrdinal: null,
          pendingReview: null,
          recovery: null,
        },
      });
    if (path.endsWith("/observations") && request.method() === "PATCH") {
      for (const edit of request.postDataJSON().edits)
        state.edits[edit.observationId] = { text: edit.text, included: edit.included };
      state.revision++;
      return route.fulfill({
        json: {
          reviewId: "synthetic-review",
          fileId: "synthetic-photo",
          revision: state.revision,
          workspaceRevision: state.revision,
          status: "ready",
          completed: 1,
          total: 1,
        },
      });
    }
    if (path.endsWith("/workspace"))
      return route.fulfill({ json: { workspaceRevision: state.revision } });
    if (path.endsWith("/files") && request.method() === "GET")
      return route.fulfill({ json: state.files });
    if (path.endsWith("/files") && request.method() === "POST") {
      const body = request.postDataJSON();
      const id = `synthetic-upload-${state.files.length + 1}`;
      state.files.push({
        id,
        revision: 1,
        name: body.name,
        declaredMediaType: body.mediaType,
        byteLength: body.byteLength,
        contentHash: body.contentHash,
        status: "reserved",
      });
      return route.fulfill({
        json: {
          schemaVersion: "2",
          fileId: id,
          uploadSession: "synthetic-upload-session",
          chunkBytes: 8388608,
          reservedBytes: body.byteLength,
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
      });
    }
    if (path.includes("/parts/")) {
      await state.pause;
      if (state.failPart) {
        state.failPart = false;
        return route.fulfill({
          status: 503,
          json: { error: { code: "DEPENDENCY_UNAVAILABLE", retryable: true } },
        });
      }
      return route.fulfill({ json: { accepted: true } });
    }
    if (path.endsWith("/complete")) {
      const item = state.files.find((file) => file.id === path.split("/").at(-2));
      if (!item) throw new Error("Synthetic upload missing");
      if (state.reject) {
        item.uploadRejection = "FILE_REJECTED";
        return route.fulfill({
          status: 400,
          json: { error: { code: "FILE_REJECTED", retryable: false } },
        });
      }
      item.status = "uploaded";
      item.revision = 2;
      state.revision++;
      if (state.withdrawOnComplete) state.needsConsent = true;
      return route.fulfill({
        json: { fileId: item.id, revision: 2, status: "uploaded", processingQueued: false },
      });
    }
    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "촬영해서 추가", exact: true })).toBeEnabled();
  await expect(page.getByLabel("확인·교정한 내용")).toHaveCount(3);
  return state;
}
async function choose(page: Page, capture = false, source = photo) {
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: capture ? "촬영해서 추가" : "파일 선택", exact: true })
    .click();
  await (await chooser).setFiles(source);
  if (!source.name.endsWith(".svg"))
    await expect(page.getByRole("list", { name: "이번 메시지의 첨부 파일" })).toContainText(
      source.name,
    );
}
async function upload(page: Page) {
  await page.getByLabel("추가한 자료의 자동 처리에 동의합니다.", { exact: true }).check();
  await page.getByRole("button", { name: "새 증거 업로드", exact: true }).click();
}

test("photo observations retain stated text, visible state, uncertainty, revision, coverage and review edits", async ({
  page,
}) => {
  const state = await fixture(page, true);
  await expect(
    page.getByRole("heading", { name: "사진 분석 결과 확인", exact: true }),
  ).toBeVisible();
  for (const label of ["사진 속 기재 내용", "화면에서 관찰한 내용", "불확실한 해석·확인 필요"])
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  await expect(page.getByText(/파일 v1/)).toHaveCount(3);
  await expect(page.getByText(/원본 진정성/)).toBeVisible();
  await expect(page.getByText(/일부만 분석/)).toBeVisible();
  expect(state.writes).toHaveLength(0);
  await page.getByLabel("확인·교정한 내용").first().fill("사용자가 확인한 합성 금액 13,000원");
  await page.getByLabel("사건 정리와 새 리포트에 포함").first().uncheck();
  await page.getByRole("button", { name: "교정 내용 저장", exact: true }).click();
  await expect(page.getByTestId("changed")).toHaveText("1");
  await expect(page.getByText(/파일 v2/)).toHaveCount(3);
  await expect(page.getByLabel("사건 정리와 새 리포트에 포함").first()).not.toBeChecked();
  await expect(page.getByText("사용자 교정 · 확인 필요", { exact: true })).toBeVisible();
  await expect(page.getByText(positions[0] ?? "", { exact: true })).toBeAttached();
  expect(state.writes).toHaveLength(1);
});

test("capture is a click-only hint; cancellation and a blocked picker keep the file alternative", async ({
  page,
}) => {
  const state = await fixture(page);
  expect(state.writes).toHaveLength(0);
  await expect(page.locator('input[type="file"][capture="environment"]')).toHaveAttribute(
    "accept",
    "image/*",
  );
  await choose(page, true);
  await expect(page.getByRole("list", { name: "이번 메시지의 첨부 파일" })).toContainText(
    photo.name,
  );
  await page.locator('input[type="file"][capture]').dispatchEvent("cancel");
  await expect(
    page.getByText("선택을 취소했어요. 파일 선택으로도 추가할 수 있어요."),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "이번 메시지의 첨부 파일" })).toContainText(
    photo.name,
  );
  await page.locator('input[type="file"][capture]').evaluate((input) => {
    (input as HTMLInputElement).click = () => {
      throw new DOMException("Synthetic blocked picker", "SecurityError");
    };
  });
  await page.getByRole("button", { name: "촬영해서 추가", exact: true }).click();
  await expect(
    page.getByText("촬영 창을 열지 못했어요. 파일 선택으로 추가해 주세요."),
  ).toBeVisible();
  await choose(page);
  expect(state.writes).toHaveLength(0);
  await expect(
    page.getByRole("list", { name: "이번 메시지의 첨부 파일" }).locator("li"),
  ).toHaveCount(1);
});

test("unsupported selection never uploads; a failed upload resumes the same reservation without duplicate sends", async ({
  page,
}) => {
  const state = await fixture(page);
  await choose(page, false, {
    name: "unsupported.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from("<svg/>"),
  });
  await expect(page.getByRole("alert")).toBeVisible();
  expect(state.writes).toHaveLength(0);
  await choose(page);
  state.failPart = true;
  await upload(page);
  await expect(page.getByRole("button", { name: "새 증거 업로드", exact: true })).toBeEnabled();
  await expect(page.getByRole("list", { name: "이번 메시지의 첨부 파일" })).toContainText(
    photo.name,
  );
  let release = () => {};
  state.pause = new Promise<void>((resolve) => {
    release = resolve;
  });
  const button = page.getByRole("button", { name: "새 증거 업로드", exact: true });
  await button.evaluate((node: HTMLButtonElement) => {
    node.click();
    node.click();
  });
  await expect(button).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  release();
  await expect(page.getByTestId("received")).toHaveText("synthetic-upload-1");
  expect(state.writes.filter((path) => path.endsWith("/files"))).toHaveLength(1);
  expect(state.writes.filter((path) => path.endsWith("/complete"))).toHaveLength(1);
  await expect(page.getByText("처리 대기", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "새 증거 업로드", exact: true })).toBeDisabled();
});

test("account change drops a late upload and local previews; consent withdrawal preserves selection without writing", async ({
  page,
}) => {
  const state = await fixture(page);
  await choose(page);
  state.needsConsent = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("button", { name: "새 증거 업로드", exact: true })).toBeDisabled();
  await expect(page.getByRole("list", { name: "이번 메시지의 첨부 파일" })).toContainText(
    photo.name,
  );
  state.needsConsent = false;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  let release = () => {};
  state.pause = new Promise<void>((resolve) => {
    release = resolve;
  });
  await upload(page);
  await expect.poll(() => state.writes.some((path) => path.includes("/parts/"))).toBe(true);
  state.owner = "synthetic-other-owner";
  state.files = [];
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("list", { name: "이번 메시지의 첨부 파일" })).toHaveCount(0);
  release();
  await expect(page.getByTestId("received")).toBeEmpty();
  expect(state.writes.filter((path) => path.endsWith("/complete"))).toHaveLength(0);
});

test("a rejected file requires a fresh selection while existing uploads recover after reload", async ({
  page,
}) => {
  const state = await fixture(page);
  await choose(page);
  state.reject = true;
  await upload(page);
  await expect(page.getByRole("list", { name: "이번 메시지의 첨부 파일" })).toHaveCount(0);
  await expect(page.getByText("등록 거절", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("등록 거절", { exact: true })).toBeVisible();
  await choose(page, false, {
    ...photo,
    name: "수정한-합성사진.jpg",
    buffer: Buffer.from([255, 216, 1, 255, 217]),
  });
  state.reject = false;
  await upload(page);
  await expect(page.getByTestId("received")).toHaveText("synthetic-upload-2");
  expect(state.writes.filter((path) => path.endsWith("/files"))).toHaveLength(2);
});

test("consent withdrawn after upload commit preserves the ACK without offering to resend the accepted file", async ({
  page,
}) => {
  const state = await fixture(page);
  await choose(page);
  state.withdrawOnComplete = true;
  await upload(page);
  await expect(page.getByTestId("received")).toHaveText("synthetic-upload-1");
  await expect(page.getByRole("list", { name: "이번 메시지의 첨부 파일" })).toHaveCount(0);
  await expect(
    page
      .getByRole("region", { name: "새 증거 추가", exact: true })
      .getByRole("link", { name: "최신 동의 확인", exact: true }),
  ).toBeVisible();
  state.needsConsent = false;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("button", { name: "새 증거 업로드", exact: true })).toBeDisabled();
  expect(state.writes.filter((path) => path.endsWith("/files"))).toHaveLength(1);
});

test("320px preview list scrolls within its area and keeps 44px controls and fallback selection", async ({
  page,
  browserName,
}) => {
  await fixture(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await choose(page);
  await expect(page.getByRole("button", { name: "파일 선택", exact: true })).toBeVisible();
  for (const name of ["파일 선택", "촬영해서 추가", "새 증거 업로드"]) {
    const bounds = await page.getByRole("button", { name, exact: true }).boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: `.wrangler/evidence-624-${browserName}-320.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: `.wrangler/evidence-624-${browserName}-1440.png`, fullPage: true });
});

test("a same-name selection is deduplicated by content without dropping a corrected file of the same size", async ({
  page,
}) => {
  await fixture(page);
  await choose(page);
  await choose(page);
  const list = page.getByRole("list", { name: "이번 메시지의 첨부 파일" });
  await expect(list.locator("li")).toHaveCount(1);
  const corrected = Buffer.from(photo.buffer);
  corrected[corrected.length - 1] = (corrected[corrected.length - 1] ?? 0) ^ 1;
  await choose(page, false, { ...photo, buffer: corrected });
  await expect(list.locator("li")).toHaveCount(2);
});

test("a slow duplicate check cannot race an upload or restore an already accepted selection", async ({
  page,
}) => {
  const state = await fixture(page);
  await choose(page);
  await page.getByLabel("추가한 자료의 자동 처리에 동의합니다.", { exact: true }).check();
  await page.evaluate(() => {
    const original = File.prototype.stream;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    Reflect.set(window, "releaseEvidenceHash", release);
    File.prototype.stream = function () {
      const reader = original.call(this).getReader();
      return new ReadableStream({
        async pull(controller) {
          await gate;
          const value = await reader.read();
          if (value.done) controller.close();
          else controller.enqueue(value.value);
        },
      });
    };
  });
  await choose(page);
  await expect(page.getByText("선택한 자료를 확인하고 있어요.", { exact: true })).toBeVisible();
  const submit = page.getByRole("button", { name: "새 증거 업로드", exact: true });
  await expect(submit).toBeDisabled();
  expect(state.writes).toHaveLength(0);
  await page.evaluate(() => Reflect.get(window, "releaseEvidenceHash")());
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByTestId("received")).toHaveText("synthetic-upload-1");
  await expect(page.getByRole("list", { name: "이번 메시지의 첨부 파일" })).toHaveCount(0);
  expect(state.writes.filter((path) => path.endsWith("/files"))).toHaveLength(1);
});

test("a chooser result opened under the old account is discarded after an account transition", async ({
  page,
}) => {
  const state = await fixture(page);
  const pending = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "촬영해서 추가", exact: true }).click();
  const chooser = await pending;
  state.owner = "synthetic-other-owner";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await chooser.setFiles(photo);
  await choose(page, false, { ...photo, name: "새-계정에서-선택한-합성사진.jpg" });
  const list = page.getByRole("list", { name: "이번 메시지의 첨부 파일" });
  await expect(list.locator("li")).toHaveCount(1);
  await expect(list).not.toContainText(photo.name);
  expect(state.writes).toHaveLength(0);
});

test("foreground refresh recovers processing files and removes deleted files without sending selected drafts", async ({
  page,
}) => {
  const state = await fixture(page);
  await choose(page);
  state.files.push({
    id: "synthetic-existing",
    revision: 2,
    name: "기존 합성 증거.jpg",
    declaredMediaType: "image/jpeg",
    byteLength: 4,
    status: "processing",
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const stored = page.getByRole("list", { name: "사건에 추가한 증거" });
  await expect(stored).toContainText("기존 합성 증거.jpg");
  await expect(stored).toContainText("분석 중");
  await expect(page.getByRole("list", { name: "이번 메시지의 첨부 파일" })).toContainText(
    photo.name,
  );
  state.files[0] = { ...state.files[0], status: "ready" };
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(stored).toContainText("내용 확인 후 반영 가능");
  state.files = [];
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(stored).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
});
