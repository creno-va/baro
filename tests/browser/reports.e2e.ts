import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { openAccountDeletion } from "../helpers/account-deletion";
import { chooseOption, selectControl } from "../helpers/headless-controls";
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
async function savedHtml(page: import("@playwright/test").Page, reportId?: string) {
  return page.evaluate(async (id) => {
    const api = (
      window as unknown as { baroReportTestApi: typeof import("../helpers/reports-ui-api").api }
    ).baroReportTestApi;
    const idToRead = id ?? (await api.reports.get("case-demo")).id;
    return (await api.reports.html(idToRead)).text();
  }, reportId);
}

async function storedReport(page: import("@playwright/test").Page, reportId?: string) {
  return page.evaluate((id) => {
    const state = JSON.parse(localStorage.getItem("baro.reports.browser-test.v1") ?? "{}");
    const report = id ? state.reportHistory[id] : state.reports["case-demo"];
    return {
      id: report.id as string,
      revision: report.revision as number,
      content: report.content as string,
      includedPhotoIds: report.includedPhotoIds as string[],
    };
  }, reportId);
}

const evidence = process.env.BARO_REPORT_EVIDENCE_DIR;
test("report review applies the system dark palette to its content and editing surfaces", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/cases/case-demo/reports");
  await expect(page.getByRole("button", { name: "PDF 다운로드", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".report-review")).toHaveCSS("color", "rgb(237, 241, 248)");
  await openReportEditor(page);
  const field = page.locator(".report-reading-section").first().getByRole("textbox");
  await expect(field).toHaveCSS("color", "rgb(237, 241, 248)");
  await expect(field).toHaveCSS("background-color", "rgb(25, 29, 37)");
});
test("report review saves before a compact desktop and full-width mobile PDF download", async ({
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
  await expect(report.getByRole("heading", { name: "추가 확인 사항", exact: true })).toBeVisible();
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

  await expect(report.getByRole("checkbox", { name: "식별정보 가리기", exact: true })).toHaveCount(
    0,
  );
  await openReportEditor(page);
  await report
    .getByRole("textbox", { name: "사건 개요 수정", exact: true })
    .fill("다운로드에 반영할 수정한 합성 요약");
  const download = page.waitForEvent("download");
  await report.getByRole("button", { name: "PDF 다운로드", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/u);
  await expect(report.getByRole("button", { name: "PDF 다운로드", exact: true })).toBeEnabled();
  const stored = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("baro.reports.browser-test.v1") ?? "{}").reports["case-demo"]
        .content,
  );
  expect(stored).toContain("다운로드에 반영할 수정한 합성 요약");
  expect(stored).toContain("보존할 합성 근거");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    // Resize/scroll anchoring can move the viewport between separate RPCs.
    // Read every rectangle in one frame; retain the exact geometry assertions.
    const { bounds, footer, body, button } = await report.evaluate((root) => {
      const measure = (selector: string) => {
        const element = root.querySelector(selector);
        if (!element) return null;
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      };
      return {
        bounds: measure(".report-canvas"),
        footer: measure(".report-export"),
        body: measure(".report-read-content"),
        button: measure(".report-export .primary"),
      };
    });
    if (!bounds || !footer || !body || !button) throw new Error("Missing report download controls");
    expect(button.height).toBeGreaterThanOrEqual(44);
    expect(button.x).toBeGreaterThanOrEqual(bounds.x);
    expect(button.x + button.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
    expect(button.y).toBeGreaterThanOrEqual(footer.y);
    expect(footer.y).toBeGreaterThanOrEqual(body.y + body.height);
    expect(Math.abs(button.x + button.width - footer.x - footer.width)).toBeLessThan(2);
    if (width < 768) {
      expect(Math.abs(footer.width - button.width)).toBeLessThan(2);
      expect(Math.abs(footer.x - button.x)).toBeLessThan(2);
    } else {
      expect(button.width).toBeGreaterThanOrEqual(170);
      expect(button.width).toBeLessThan(footer.width);
    }
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
  await page.evaluate(() => {
    const key = "baro.reports.browser-test.v1",
      state = JSON.parse(localStorage.getItem(key) ?? "{}");
    state.reports["case-demo"].revision++;
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.getByRole("button", { name: "수정 내용 저장", exact: true }).click();
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
test("manual review and PDF-only download preserve exact saved content and cascading deletion", async ({
  page,
  baseURL,
}) => {
  const external: string[] = [];
  const localOrigin = new URL(baseURL as string).origin;
  page.on("request", (request) => {
    const origin = new URL(request.url()).origin;
    if (origin !== localOrigin) external.push(origin);
  });
  await page.goto("/cases/case-demo/reports");
  await openReportEditor(page);
  // This legacy fixture has no verified legal analysis. The leading editor is
  // its synthetic/unverified notice; manual redaction belongs to the overview.
  const overview = page.getByRole("textbox", { name: "내 사건 한눈에 수정", exact: true });
  await expect(overview).toHaveValue("합성 사실: 010-1234-5678, demo@example.test");
  const before = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("baro.reports.browser-test.v1") ?? "{}");
    return { summary: state.cases["case-demo"].summary, report: state.reports["case-demo"] };
  });
  const edited =
    "합성 검토 내용: [전화번호 직접 삭제] / [이메일 직접 삭제]. 반환 날짜는 미확인입니다.";
  await overview.fill(edited);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF 다운로드", exact: true }).click();
  const pdf = await downloading;
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  const pdfPath = await pdf.path();
  expect((await readFile(pdfPath as string)).subarray(0, 5).toString()).toBe("%PDF-");
  const html = await savedHtml(page);
  expect(html).toContain("[전화번호 직접 삭제]");
  expect(html).not.toContain("010-1234-5678");
  expect(html).not.toContain("demo@example.test");
  expect(html).toContain("합성 API 예시 · 실제 AI/공식 법률 조회를 실행하지 않았습니다.");
  const preserved = await page.evaluate((id) => {
    const state = JSON.parse(localStorage.getItem("baro.reports.browser-test.v1") ?? "{}");
    return { summary: state.cases["case-demo"].summary, content: state.reportHistory[id]?.content };
  }, before.report.id);
  expect(preserved).toEqual({ summary: before.summary, content: before.report.content });
  await page.reload();
  await openReportEditor(page);
  await expect(overview).toHaveValue(edited);
  await expect(page.getByRole("checkbox", { name: "식별정보 가리기", exact: true })).toHaveCount(0);
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
  await page.getByRole("button", { name: "수정 내용 저장", exact: true }).click();
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

for (const placement of ["inline", "legacy"] as const)
  test(`${placement} photo survives reload; deleting its evidence token excludes it from the next saved export`, async ({
    page,
  }, testInfo) => {
    await page.goto("/cases/case-demo/reports");
    if (placement === "legacy") {
      // The installed-client selection has no raw token. The reader inserts its
      // compatibility position without rewriting the stored historical report.
      await prepareSavedPdf(page);
    } else {
      await openReportEditor(page);
      const section = page.locator(".report-reading-section").filter({
        has: page.getByRole("heading", { name: "증거 자료", exact: true }),
      });
      await chooseOption(selectControl(section), "file-demo");
      await section.getByRole("button", { name: "사진 넣기", exact: true }).click();
      await expect(section.getByRole("textbox")).toHaveValue(/baro-photo:file-demo/);
      const positiveDownload = page.waitForEvent("download");
      await page.getByRole("button", { name: "PDF 다운로드", exact: true }).click();
      await positiveDownload;
    }
    await page.reload();
    const before = await storedReport(page);
    expect(before.includedPhotoIds).toEqual(["file-demo"]);
    expect((before.content.match(/baro-photo:file-demo/gu) ?? []).length).toBe(
      placement === "inline" ? 1 : 0,
    );
    expect((await savedHtml(page, before.id)).includes('data-report-photo="file-demo"')).toBe(true);
    await expect(page.locator('.report-inline-photo[data-report-photo="file-demo"]')).toHaveCount(
      1,
    );
    await openReportEditor(page);
    const fields = await page.locator(".report-reading-section textarea").evaluateAll((nodes) =>
      nodes.map((node) => ({
        label: node.getAttribute("aria-label") ?? "",
        text: (node as HTMLTextAreaElement).value,
      })),
    );
    const editor = page.getByRole("textbox", { name: "증거 자료 수정", exact: true });
    const evidenceText = await editor.inputValue();
    const pattern = /!\[[^\]]*\]\(baro-photo:file-demo\)/gu;
    const removedTokens = evidenceText.match(pattern) ?? [];
    expect(removedTokens).toHaveLength(1);
    const next = evidenceText.replace(pattern, "");
    expect(next).not.toBe(evidenceText);
    expect(next.includes("baro-photo:file-demo")).toBe(false);
    await editor.fill(next);
    // The existing section parser leaves trailing separators outside the
    // editable body; removing an end-position legacy photo exposes those lines.
    await expect(editor).toHaveValue(next.replace(/(?:\r?\n)+$/u, ""));
    for (const field of fields.filter((field) => field.label !== "증거 자료 수정"))
      await expect(page.getByRole("textbox", { name: field.label, exact: true })).toHaveValue(
        field.text,
      );
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "PDF 다운로드", exact: true }).click();
    const pdf = await downloading;
    const after = await storedReport(page);
    expect(after.id).not.toBe(before.id);
    expect(after.revision).toBe(before.revision + 1);
    expect(after.includedPhotoIds).toEqual([]);
    expect(after.content.includes("baro-photo:file-demo")).toBe(false);
    if (placement === "inline") {
      expect(after.content === before.content.replace(pattern, "")).toBe(true);
    } else {
      // The legacy display position adds two separator lines. Prove those are
      // the only raw-body difference, including the evidence text and sources.
      let boundary = 0;
      while (
        boundary < before.content.length &&
        before.content[boundary] === after.content[boundary]
      )
        boundary++;
      expect(after.content.slice(boundary, boundary + 2)).toBe("\n\n");
      expect(
        after.content.slice(0, boundary) + after.content.slice(boundary + 2) === before.content,
      ).toBe(true);
    }
    expect(pdf.suggestedFilename()).toBe(`BARO-${after.id}.pdf`);
    expect((await readFile((await pdf.path()) as string)).subarray(0, 5).toString()).toBe("%PDF-");
    const newHtml = await savedHtml(page, after.id);
    // Keep photo failures bounded: never print the entire data-image document.
    expect(newHtml.includes('data-report-photo="file-demo"')).toBe(false);
    expect(newHtml.includes("<figure")).toBe(false);
    expect((await savedHtml(page, before.id)).includes('data-report-photo="file-demo"')).toBe(true);
    const historical = await storedReport(page, before.id);
    expect(historical.content === before.content).toBe(true);
    expect(historical.includedPhotoIds).toEqual(["file-demo"]);
    await page.reload();
    await expect(page.locator(".report-inline-photo")).toHaveCount(0);
    await openReportEditor(page);
    await expect(editor).toHaveValue(next.replace(/(?:\r?\n)+$/u, ""));
    for (const field of fields.filter((field) => field.label !== "증거 자료 수정"))
      await expect(page.getByRole("textbox", { name: field.label, exact: true })).toHaveValue(
        field.text,
      );
    await testInfo.attach("photo-removal-trace", {
      contentType: "application/json",
      body: JSON.stringify(
        {
          placement,
          editedField: "증거 자료 수정",
          firstField: fields[0]?.label,
          firstFieldPhotoTokens: (fields[0]?.text.match(pattern) ?? []).length,
          removedTokens: removedTokens.length,
          beforeId: before.id,
          afterId: after.id,
          beforeRevision: before.revision,
          afterRevision: after.revision,
          oldRawTokens: (before.content.match(/baro-photo:file-demo/gu) ?? []).length,
          newRawTokens: 0,
          includedPhotos: after.includedPhotoIds.length,
          exportedFilename: pdf.suggestedFilename(),
          oldHtmlHasPhoto: true,
          newHtmlHasPhoto: false,
        },
        null,
        2,
      ),
    });
  });
