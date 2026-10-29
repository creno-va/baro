import { expect, type Page, test } from "@playwright/test";

function gate() {
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { pending, release };
}
async function fixture(page: Page) {
  const state = {
    owner: "synthetic-owner",
    role: "customer",
    needsConsent: false,
    revision: 1,
    reads: [] as { file: string; after: number }[],
    writes: 0,
    next: null as ReturnType<typeof gate> | null,
    failNext: false,
    edits: {} as Record<string, { text: string; included: boolean }>,
  };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/me/session")
      return route.fulfill({
        json: {
          user: state.owner
            ? { id: state.owner, name: "합성 사용자", accountType: state.role }
            : null,
          needsConsent: state.needsConsent,
        },
      });
    if (url.pathname.endsWith("/review")) {
      const file = url.pathname.split("/").at(-2) ?? "";
      const after = Number(url.searchParams.get("afterOrdinal") ?? -1);
      state.reads.push({ file, after });
      const delay = after >= 0 ? state.next : null;
      if (delay) await delay.pending;
      if (state.failNext && after >= 0) {
        state.failNext = false;
        return route.fulfill({
          status: 503,
          json: {
            error: {
              code: "DEPENDENCY_UNAVAILABLE",
              retryable: true,
            },
          },
        });
      }
      const ordinal = after < 0 ? 0 : after + 1;
      const original = {
        id: `${file}-${ordinal}`,
        text: `${file} 합성 원본 ${ordinal}`,
        position: { kind: "document", page: ordinal + 1, paragraph: null, table: null },
        certainty: "observed",
        userEdited: false,
        included: true,
      };
      const value = { ...original, ...state.edits[original.id] };
      return route.fulfill({
        json: {
          file: { id: file, revision: state.revision, name: "합성 자료", status: "ready" },
          workspaceRevision: state.revision,
          coverage: null,
          observations: [{ ordinal, value, original }],
          nextAfterOrdinal: ordinal < 2 ? ordinal : null,
          pendingReview: null,
          recovery: null,
        },
      });
    }
    if (url.pathname.endsWith("/observations") && route.request().method() === "PATCH") {
      state.writes++;
      for (const edit of route.request().postDataJSON().edits)
        state.edits[edit.observationId] = { text: edit.text, included: edit.included };
      state.revision++;
      return route.fulfill({
        json: {
          reviewId: "synthetic-review",
          fileId: "synthetic-file-a",
          revision: state.revision,
          workspaceRevision: state.revision,
          status: "ready",
          completed: 1,
          total: 1,
        },
      });
    }
    if (route.request().method() !== "GET") state.writes++;
    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
  });
  await page.goto("/");
  await expect(page.getByLabel("확인·교정한 내용")).toHaveCount(1);
  return state;
}

test("slow next page announces loading immediately and ignores duplicate clicks", async ({
  page,
}) => {
  const state = await fixture(page);
  state.next = gate();
  const next = page.getByRole("button", { name: "추출 내용 더 보기", exact: true });
  await next.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(page.getByRole("status")).toContainText("추출 내용을 더 불러오고 있어요.");
  await expect(next).toBeDisabled();
  await expect.poll(() => state.reads.filter((r) => r.after >= 0).length).toBe(1);
  await expect(page.getByRole("region", { name: "자료 내용 검토" })).toHaveAttribute(
    "aria-busy",
    "true",
  );
  state.next.release();
  await expect(page.getByLabel("확인·교정한 내용")).toHaveCount(2);
  await expect(next).toBeEnabled();
  await expect(page.getByRole("region", { name: "자료 내용 검토" })).toHaveAttribute(
    "aria-busy",
    "false",
  );
  expect(state.reads.filter((r) => r.after >= 0)).toHaveLength(1);
});

test("focus during a pending read preserves draft edits and permits the completed-write refresh", async ({
  page,
}) => {
  const state = await fixture(page);
  state.next = gate();
  await page.getByRole("button", { name: "추출 내용 더 보기", exact: true }).click();
  const fields = page.getByLabel("확인·교정한 내용");
  await fields.first().fill("조회 중 작성한 합성 교정");
  const save = page.getByRole("button", { name: "교정 내용 저장", exact: true });
  await expect(save).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(fields.first()).toHaveValue("조회 중 작성한 합성 교정");
  await expect(page.getByRole("status")).toContainText("추출 내용을 더 불러오고 있어요.");
  state.next.release();
  await expect(fields).toHaveCount(2);
  await expect(fields.first()).toHaveValue("조회 중 작성한 합성 교정");
  await expect(save).toBeEnabled();
  expect(state.writes).toBe(0);
  expect(state.reads.filter((r) => r.after >= 0)).toHaveLength(1);
  await save.click();
  await expect(page.getByText("교정 내용을 저장했어요. 새로 접속해도 유지됩니다.")).toBeVisible();
  await expect(fields).toHaveCount(1);
  await expect(fields.first()).toHaveValue("조회 중 작성한 합성 교정");
  expect(state.writes).toBe(1);
});

test("a failed later page retries its cursor and preserves earlier rows and dirty drafts", async ({
  page,
}) => {
  const state = await fixture(page);
  const next = page.getByRole("button", { name: "추출 내용 더 보기", exact: true });
  const fields = page.getByLabel("확인·교정한 내용");
  await next.click();
  await expect(fields).toHaveCount(2);
  state.next = gate();
  state.failNext = true;
  await next.click();
  await fields.nth(1).fill("남아 있어야 하는 두 번째 교정");
  state.next.release();
  const retry = page.getByRole("button", { name: "다시 시도", exact: true });
  await expect(retry).toBeEnabled();
  await expect(fields).toHaveCount(2);
  await expect(fields.nth(1)).toHaveValue("남아 있어야 하는 두 번째 교정");
  await retry.click();
  await expect(fields).toHaveCount(3);
  await expect(fields.nth(1)).toHaveValue("남아 있어야 하는 두 번째 교정");
  expect(state.reads.map((r) => r.after)).toEqual([-1, 0, 1, 1]);
  expect(state.writes).toBe(0);
});

test("background verification retains already opened extraction pages without a loading replacement", async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole("button", { name: "추출 내용 더 보기", exact: true }).click();
  const fields = page.getByLabel("확인·교정한 내용");
  await expect(fields).toHaveCount(2);
  const first = await fields.first().elementHandle();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(fields).toHaveCount(2);
  expect(await fields.first().evaluate((node, original) => node === original, first)).toBe(true);
  await expect(page.getByText("처리 위치와 저장한 교정 내용을 다시 확인하고 있어요.")).toHaveCount(
    0,
  );
});

for (const revoked of ["owner", "role", "signout"] as const)
  test(`late page response is discarded after ${revoked} changes`, async ({ page }) => {
    const state = await fixture(page);
    state.next = gate();
    await page.getByRole("button", { name: "추출 내용 더 보기", exact: true }).click();
    await expect.poll(() => state.reads.filter((r) => r.after >= 0).length).toBe(1);
    if (revoked === "owner") state.owner = "synthetic-other-owner";
    if (revoked === "role") state.role = "lawyer";
    if (revoked === "signout") state.owner = "";
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    if (revoked === "owner" || revoked === "role") {
      await expect.poll(() => state.reads.filter((r) => r.after < 0).length).toBe(2);
      await expect(page.getByLabel("확인·교정한 내용")).toHaveCount(1);
    } else if (revoked === "signout")
      await expect(page.getByRole("link", { name: "로그인하기", exact: true })).toBeVisible();
    else await expect(page.getByRole("alert")).toBeVisible();
    state.next.release();
    await expect(page.getByText("synthetic-file-a 합성 원본 1", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("확인·교정한 내용")).toHaveCount(
      revoked === "owner" || revoked === "role" ? 1 : 0,
    );
    expect(state.writes).toBe(0);
  });

test("consent withdrawal keeps read access and drafts but cannot enable a correction write", async ({
  page,
}) => {
  const state = await fixture(page);
  state.next = gate();
  await page.getByRole("button", { name: "추출 내용 더 보기", exact: true }).click();
  const fields = page.getByLabel("확인·교정한 내용");
  await fields.first().fill("재동의 전 보존할 교정");
  state.needsConsent = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("link", { name: "최신 동의 확인", exact: true })).toBeVisible();
  state.next.release();
  await expect(fields).toHaveCount(2);
  await expect(fields.first()).toHaveValue("재동의 전 보존할 교정");
  await expect(fields.first()).toBeDisabled();
  await expect(page.getByRole("button", { name: "교정 내용 저장", exact: true })).toBeDisabled();
  expect(state.writes).toBe(0);
});

test("an old file response cannot finish the new file's loading state", async ({ page }) => {
  const state = await fixture(page);
  const old = gate(),
    nextFile = gate();
  state.next = old;
  await page.getByRole("button", { name: "추출 내용 더 보기", exact: true }).click();
  await expect.poll(() => state.reads.filter((r) => r.after >= 0).length).toBe(1);
  await page.getByRole("button", { name: "합성 두 번째 자료 열기", exact: true }).click();
  const fields = page.getByLabel("확인·교정한 내용");
  await expect(fields.first()).toHaveValue("synthetic-file-b 합성 원본 0");
  state.next = nextFile;
  const next = page.getByRole("button", { name: "추출 내용 더 보기", exact: true });
  await next.click();
  await expect
    .poll(() => state.reads.filter((r) => r.file === "synthetic-file-b" && r.after >= 0).length)
    .toBe(1);
  old.release();
  await expect(next).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("추출 내용을 더 불러오고 있어요.");
  await expect(fields).toHaveCount(1);
  nextFile.release();
  await expect(fields).toHaveCount(2);
  await expect(fields.nth(1)).toHaveValue("synthetic-file-b 합성 원본 1");
  await expect(next).toBeEnabled();
});

test("a revision conflict requires explicit replacement and keeps drafts until confirmation", async ({
  page,
}) => {
  const state = await fixture(page);
  state.next = gate();
  await page.getByRole("button", { name: "추출 내용 더 보기", exact: true }).click();
  const fields = page.getByLabel("확인·교정한 내용");
  await fields.first().fill("충돌 뒤에도 보존할 교정");
  state.revision++;
  state.next.release();
  const replace = page.getByRole("button", { name: "최신 내용 불러오기", exact: true });
  await expect(replace).toBeEnabled();
  await expect(fields.first()).toHaveValue("충돌 뒤에도 보존할 교정");
  page.once("dialog", (dialog) => dialog.dismiss());
  await replace.click();
  await expect(fields.first()).toHaveValue("충돌 뒤에도 보존할 교정");
  expect(state.reads).toHaveLength(2);
  page.once("dialog", (dialog) => dialog.accept());
  await replace.click();
  await expect(fields.first()).toHaveValue("synthetic-file-a 합성 원본 0");
  expect(state.reads.map((r) => r.after)).toEqual([-1, 0, -1]);
  expect(state.writes).toBe(0);
});
