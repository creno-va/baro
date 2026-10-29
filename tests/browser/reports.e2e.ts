import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { openAccountDeletion } from "../helpers/account-deletion";
import { openReportEditor } from "../helpers/report-controls";

// Dedicated D port under either the main browser config or the standalone config.
test.use({ baseURL: `http://127.0.0.1:${process.env.BARO_REPORT_TEST_PORT ?? 4343}` });
let server: ChildProcess;
test.beforeAll(async () => {
  server = spawn("bun", ["tests/helpers/reports-ui-server.ts"], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((done, reject) => {
    const timeout = setTimeout(() => reject(new Error("D browser harness did not start")), 15000);
    server.stdout?.on("data", (chunk) => {
      if (String(chunk).includes("D product component harness:")) {
        clearTimeout(timeout);
        done();
      }
    });
    server.once("error", () => {
      clearTimeout(timeout);
      reject(new Error("D browser harness startup failed"));
    });
    server.once("exit", (code) => {
      if (code) {
        clearTimeout(timeout);
        reject(new Error("D browser harness exited"));
      }
    });
  });
});
test.afterAll(() => {
  server?.kill();
});

async function prepareSavedPdf(page: import("@playwright/test").Page) {
  // Seed a saved selection directly for the account-boundary scenarios below.
  await page.evaluate(async () => {
    const api = (
      window as unknown as { baroReportTestApi: typeof import("../helpers/reports-ui-api").api }
    ).baroReportTestApi;
    const report = await api.reports.get("case-demo");
    await api.reports.save(
      "case-demo",
      {
        content: report.content,
        maskIdentifiers: false,
        excludedFileIds: report.excludedFileIds,
        includedPhotoIds: ["file-demo"],
      },
      report.revision,
    );
  });
  await page.reload();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF 다운로드", exact: true }).click();
  await downloaded;
  await expect(page.getByRole("button", { name: "PDF 다운로드", exact: true })).toBeEnabled();
  await openReportEditor(page);
}
async function savedHtml(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const api = (
      window as unknown as { baroReportTestApi: typeof import("../helpers/reports-ui-api").api }
    ).baroReportTestApi;
    const report = await api.reports.get("case-demo");
    return (await api.reports.html(report.id)).text();
  });
}

const evidence = process.env.BARO_REPORT_EVIDENCE_DIR;
test("selected photos persist through download and masking without leaking image pixels", async ({
  page,
}) => {
  await page.goto("/cases/case-demo/reports");
  const photo = page.getByRole("checkbox", { name: "합성 자료.jpg", exact: true });
  await expect(photo).toBeEnabled();
  await photo.check();
  await expect(page.getByText("1장 선택 · 최대 12장, 합계 8 MB", { exact: true })).toBeVisible();
  let download = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF 다운로드", exact: true }).click();
  await download;
  await expect(page.getByRole("button", { name: "PDF 다운로드", exact: true })).toBeEnabled();
  const html = await savedHtml(page);
  expect(html).toContain('class="evidence-photo"');
  expect(html).toContain('src="data:image/jpeg;base64,');
  expect(html).toContain("합성 자료.jpg");
  await page.reload();
  await expect(photo).toBeChecked();
  await page.getByRole("checkbox", { name: "식별정보 가리기", exact: true }).check();
  await expect(photo).toBeDisabled();
  download = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF 다운로드", exact: true }).click();
  await download;
  await expect(page.getByRole("button", { name: "PDF 다운로드", exact: true })).toBeEnabled();
  expect(await savedHtml(page)).not.toContain('class="evidence-photo"');
  await page.reload();
  await page.getByRole("checkbox", { name: "식별정보 가리기", exact: true }).uncheck();
  await expect(photo).toBeChecked();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      path: `.wrangler/report-photo-selection-${width}.png`,
      fullPage: true,
    });
  }
});

test("report review edits in place and saves before a full-width PDF download", async ({
  page,
}) => {
  await page.goto("/cases/case-demo/reports");
  await expect(page.locator(".report-edit-toggle")).toBeVisible();
  await page.evaluate(() => {
    const key = "baro.reports.browser-test.v1",
      state = JSON.parse(localStorage.getItem(key) ?? "{}");
    state.reports["case-demo"].content =
      "사건 요약\n합성 송금 자료와 반환 약속을 중심으로 상담을 준비합니다.\n\n당사자\n의뢰인 · 돈을 빌려준 사람\n상대방 · 반환 여부를 확인할 사람\n\n사실·주장·출처\n보존할 합성 근거\n\n미확인 사항\n반환 약속 날짜와 일부 변제 여부를 확인해야 합니다.\n\n공식 출처\n\n타임라인\n2026.03.12 · 송금 자료에 적힌 거래일\n2026.06.30 · 대화에서 정한 반환 예정일\n\n준비할 행동\n원본 송금 자료와 전체 대화 기록을 날짜순으로 보관하세요.\n\n자료 처리 범위\n합성 자료.jpg · 사진에 표시된 날짜와 금액을 확인했습니다.\n\n연락과 전달\n변호사에게 확인할 내용을 정리한 뒤 직접 전달합니다.";
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload();
  const report = page.locator(".report-review");
  await expect(report.getByRole("heading", { name: "미확인 사항", exact: true })).toBeVisible();
  await expect(report.getByRole("heading", { name: "사실·주장·출처", exact: true })).toHaveCount(0);
  await expect(report.getByRole("heading", { name: "공식 출처", exact: true })).toHaveCount(0);
  await expect(
    report.locator(
      ".report-steps,.report-options,.report-reading-section--uncertain,.report-success",
    ),
  ).toHaveCount(0);
  await expect(
    report.getByRole("button", { name: /전달 내용 미리보기|검토 내용 저장/ }),
  ).toHaveCount(0);
  await expect(report.getByRole("checkbox", { name: "합성 자료.jpg", exact: true })).toBeVisible();
  await expect(
    report.getByRole("checkbox", { name: "식별정보 가리기", exact: true }),
  ).toBeVisible();
  await openReportEditor(page);
  await report
    .getByRole("textbox", { name: "사건 요약 수정", exact: true })
    .fill("다운로드에 반영할 수정한 합성 요약");
  const download = page.waitForEvent("download");
  await report.getByRole("button", { name: "PDF 다운로드", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/u);
  const stored = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("baro.reports.browser-test.v1") ?? "{}").reports["case-demo"]
        .content,
  );
  expect(stored).toContain("다운로드에 반영할 수정한 합성 요약");
  expect(stored).toContain("보존할 합성 근거");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = await report.locator(".report-canvas").boundingBox(),
      button = await report
        .getByRole("button", { name: "PDF 다운로드", exact: true })
        .boundingBox();
    expect(Math.abs((bounds?.width ?? 0) - (button?.width ?? 0))).toBeLessThan(2);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({ path: `.wrangler/report-hierarchy-${width}.png`, fullPage: true });
  }
});
test("same-tab signout immediately clears report preview and saved ZIP", async ({ page }) => {
  await page.goto("/cases/case-demo/reports");
  await openReportEditor(page);
  const editor = page.getByRole("textbox", { name: / 수정$/ }).first();
  await expect(editor).toBeVisible();
  await prepareSavedPdf(page);
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("baro-session-changed", { detail: { reason: "signout" } }),
    );
  });
  await expect(editor).toHaveCount(0);
  await expect(page.locator(".report-html-preview")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /저장된 선택 원본 ZIP/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "PDF 다운로드", exact: true })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "PDF에 근거 사진 포함" })).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("로그인 후 리포트를 다시 확인");
});

test("peer account switch clears dirty report, selected originals, confirmation and open dialog", async ({
  page,
  context,
}) => {
  await page.goto("/cases/case-demo/reports");
  await openReportEditor(page);
  const editor = page.getByRole("textbox", { name: / 수정$/ }).first();
  await expect(editor).toBeVisible();
  await prepareSavedPdf(page);
  await editor.fill("이전 계정의 저장하지 않은 합성 편집");
  await page.getByRole("checkbox", { name: "식별정보 가리기", exact: true }).check();
  await page.evaluate(() => {
    const key = "baro.reports.browser-test.v1",
      state = JSON.parse(localStorage.getItem(key) ?? "{}");
    state.reports["case-demo"].revision++;
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.getByRole("button", { name: "수정 마치기", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "다시 확인" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const peer = await context.newPage();
  await peer.goto("/settings");
  await peer.evaluate(() => {
    const key = "baro.reports.browser-test.v1",
      state = JSON.parse(localStorage.getItem(key) ?? "{}");
    state.session.user = { id: "synthetic-peer", name: "다른 합성 계정", accountType: "customer" };
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.bringToFront();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "PDF에 근거 사진 포함" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "PDF 다운로드" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /저장된 선택 원본 ZIP/ })).toHaveCount(0);
  await expect(page.getByText("이전 계정의 저장하지 않은 합성 편집")).toHaveCount(0);
});
test("same owner selecting lawyer retains report editing and export access", async ({
  page,
  context,
}) => {
  await page.goto("/cases/case-demo/reports");
  await openReportEditor(page);
  const editor = page.getByRole("textbox", { name: / 수정$/ }).first();
  await expect(editor).toBeVisible();
  await prepareSavedPdf(page);
  await editor.fill("역할 변경 전에 남겨진 합성 편집");
  await page.getByRole("checkbox", { name: "식별정보 가리기", exact: true }).check();
  const peer = await context.newPage();
  await peer.goto("/settings");
  await peer.evaluate(() => {
    const key = "baro.reports.browser-test.v1",
      state = JSON.parse(localStorage.getItem(key) ?? "{}");
    state.session.user.accountType = "lawyer";
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.bringToFront();
  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue("역할 변경 전에 남겨진 합성 편집");
  await expect(page.getByRole("button", { name: "PDF 다운로드" })).toBeVisible();
});
test("peer account switch clears settings usage and an account deletion confirmation", async ({
  page,
  context,
}) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "계정과 모든 사건 삭제", exact: true }).click();
  await page.getByRole("textbox", { name: "삭제 확인 — DELETE 입력" }).fill("DELETE");
  const peer = await context.newPage();
  await peer.goto("/settings");
  await peer.evaluate(() => {
    const key = "baro.reports.browser-test.v1",
      state = JSON.parse(localStorage.getItem(key) ?? "{}");
    state.session.user = { id: "synthetic-peer", name: "다른 합성 계정", accountType: "customer" };
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.bringToFront();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "합성 대여금 사건" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "계정과 모든 사건 삭제", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("계정이 변경");
});
test("review masking and PDF-only download preserve exact saved content and cascading deletion", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:"))
      external.push(new URL(request.url()).origin);
  });
  await page.goto("/cases/case-demo/reports");
  await openReportEditor(page);
  await page
    .getByRole("textbox", { name: / 수정$/ })
    .first()
    .fill("합성 검토 내용: 010-1234-5678 / demo@example.test. 반환 날짜는 미확인입니다.");
  await page.getByRole("checkbox", { name: "식별정보 가리기", exact: true }).check();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF 다운로드", exact: true }).click();
  const pdf = await downloading;
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  const pdfPath = await pdf.path();
  expect((await readFile(pdfPath as string)).subarray(0, 5).toString()).toBe("%PDF-");
  const html = await savedHtml(page);
  expect(html).toContain("[전화번호 가림]");
  expect(html).not.toContain("010-1234-5678");
  await page.reload();
  await openReportEditor(page);
  await expect(page.getByRole("textbox", { name: / 수정$/ }).first()).toHaveValue(/합성 검토 내용/);
  await expect(page.getByRole("checkbox", { name: "식별정보 가리기", exact: true })).toBeChecked();
  if (evidence) {
    await mkdir(evidence, { recursive: true });
    await pdf.saveAs(resolve(evidence, "synthetic-report.pdf"));
    await page.screenshot({ path: resolve(evidence, "report-review.png"), fullPage: true });
  }
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "설정과 사용량" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "보관한 사건" })).toHaveCount(0);
  // The case-management surface owns deletion; settings only manages the account.
  await page.goto("/cases/case-demo/delete");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/cases/case-demo/delete");
  await page.getByRole("dialog").getByRole("button", { name: "사건 삭제", exact: true }).click();
  await expect(page).toHaveURL("/settings");
  await page.reload();
  const state = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("baro.reports.browser-test.v1") ?? "{}"),
  );
  expect(state.cases).toEqual({});
  expect(state.files).toEqual({});
  expect(state.workspace).toEqual({});
  expect(state.reports).toEqual({});
  expect(state.reportHistory).toEqual({});
  await page.goto("/cases/case-demo/reports");
  await expect(page.getByRole("alert")).toContainText("사건을 찾을 수 없어요");
  await page.goto("/settings");
  await page.getByRole("button", { name: "계정과 모든 사건 삭제", exact: true }).click();
  await page.getByRole("textbox", { name: "삭제 확인 — DELETE 입력" }).fill("DELETE");
  await page.getByRole("button", { name: "삭제 요청 확인" }).click();
  await expect(page.getByRole("heading", { name: "계정 삭제를 접수했어요" })).toBeVisible();
  await page.reload();
  const deleted = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("baro.reports.browser-test.v1") ?? "{}"),
  );
  expect(deleted.session.user).toBeNull();
  expect(deleted.accountDeleted).toBe(true);
  expect(deleted.lawyers).toBeUndefined();
  await expect(
    page.getByRole("button", { name: "계정과 모든 사건 삭제", exact: true }),
  ).toBeDisabled();
  expect(external).toEqual([]);
});
test("mobile layout, keyboard cancel, failure and retry use the same components", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "설정과 사용량" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(
    (await new AxeBuilder({ page }).include(".account-settings").analyze()).violations,
  ).toEqual([]);
  await page.getByRole("button", { name: "계정과 모든 사건 삭제", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect((await new AxeBuilder({ page }).include(".report-modal").analyze()).violations).toEqual(
    [],
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "계정과 모든 사건 삭제", exact: true }),
  ).toBeFocused();
  await page.goto("/cases/case-demo/reports");
  await openReportEditor(page);
  await expect(page.getByRole("textbox", { name: / 수정$/ }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect((await new AxeBuilder({ page }).include(".report-review").analyze()).violations).toEqual(
    [],
  );
  await page.evaluate(() => {
    const key = "baro.reports.browser-test.v1";
    const state = JSON.parse(localStorage.getItem(key) ?? "{}");
    state.session.needsConsent = true;
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload();
  await expect(
    page.getByRole("status").filter({ hasText: "새 리포트 생성과 수정은 필수 동의 후" }),
  ).toBeVisible();
  await expect(page.locator(".report-edit-toggle")).toBeDisabled();
  await page.evaluate(() => {
    const key = "baro.reports.browser-test.v1";
    const state = JSON.parse(localStorage.getItem(key) ?? "{}");
    state.session.needsConsent = false;
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload();
  await openReportEditor(page);
  await expect(page.getByRole("textbox", { name: / 수정$/ }).first()).toBeVisible();
  const editor = page.getByRole("textbox", { name: / 수정$/ }).first();
  await editor.fill("저장되지 않은 검토 내용");
  await page.evaluate(() => {
    const key = "baro.reports.browser-test.v1";
    const state = JSON.parse(localStorage.getItem(key) ?? "{}");
    state.reports["case-demo"].revision++;
    state.reports["case-demo"].content = "다른 화면에서 저장한 내용";
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.getByRole("button", { name: "수정 마치기", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "다시 확인" }).click();
  await expect(page.getByRole("dialog")).toContainText("저장하지 않은 편집");
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(editor).toHaveValue("저장되지 않은 검토 내용");
  await page.getByRole("button", { name: "다시 확인" }).click();
  await page.getByRole("button", { name: "편집을 버리고 다시 불러오기" }).click();
  await openReportEditor(page);
  await expect(editor).toHaveValue("다른 화면에서 저장한 내용");
  if (evidence)
    await page.screenshot({ path: resolve(evidence, "report-mobile.png"), fullPage: true });
});

test("account deletion preserves signed session, OAuth callback and SQL revoke guards in the new component", async ({
  page,
  context,
  baseURL,
}) => {
  const child = spawn(
    "bun",
    ["tests/helpers/browser-session-server.ts", baseURL ?? "", "account"],
    { cwd: fileURLToPath(new URL("../..", import.meta.url)), stdio: ["pipe", "pipe", "pipe"] },
  );
  try {
    const seed = await new Promise<{
      origin: string;
      cookie: {
        name: string;
        value: string;
        url: string;
        httpOnly: boolean;
        secure: boolean;
        sameSite: "Lax";
      };
    }>((done, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Synthetic signed-session fixture startup failed")),
        15000,
      );
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += String(chunk);
        if (!output.includes("\n")) return;
        clearTimeout(timeout);
        done(JSON.parse(output.slice(0, output.indexOf("\n"))));
      });
      child.once("error", () => {
        clearTimeout(timeout);
        reject(new Error("Synthetic signed-session fixture startup failed"));
      });
    });
    await context.addCookies([seed.cookie]);
    await page.route("**/api/**", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const response = await route.fetch({
        url: `${seed.origin}${url.pathname}${url.search}`,
        headers: await request.allHeaders(),
        maxRedirects: 0,
      });
      await route.fulfill({ response });
    });
    // Only the provider exchange is synthetic; nonce, callback, cookie and SQL execute real guards.
    await page.route("https://accounts.google.com/**", async (route) => {
      const url = new URL(route.request().url());
      const callback = `${baseURL}/api/auth/callback/google?state=${encodeURIComponent(url.searchParams.get("state") ?? "")}&code=synthetic-code`;
      await route.fulfill({
        contentType: "text/html",
        body: `<script>location.replace(${JSON.stringify(callback)})</script>`,
      });
    });
    await page.goto("/settings?real-account=true");
    await openAccountDeletion(page);
    await page.getByRole("button", { name: "Google로 재인증" }).click();
    await page.getByRole("textbox", { name: "삭제 확인 — DELETE 입력" }).fill("DELETE");
    await page.getByRole("button", { name: "삭제 요청 확인", exact: true }).click();
    await expect(page.getByRole("heading", { name: "계정 삭제를 접수했어요" })).toBeVisible();
    const revoked = await context.request.get(`${seed.origin}/api/me/deletion`, {
      headers: { cookie: `${seed.cookie.name}=${seed.cookie.value}` },
    });
    expect(revoked.status()).toBe(401);
  } finally {
    child.stdin.end();
    child.kill();
  }
});

test("saved photo selections survive reload and masking excludes them from the next saved export", async ({
  page,
}) => {
  await page.goto("/cases/case-demo/reports");
  await prepareSavedPdf(page);
  await page.reload();
  expect(await savedHtml(page)).toContain('alt="선택 근거 사진 1"');
  await page.getByRole("checkbox", { name: "식별정보 가리기", exact: true }).check();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF 다운로드", exact: true }).click();
  await downloading;
  expect(await savedHtml(page)).not.toContain('alt="선택 근거 사진 1"');
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("baro.reports.browser-test.v1") ?? "{}").reports[
          "case-demo"
        ].includedPhotoIds,
    ),
  ).toEqual([]);
});
