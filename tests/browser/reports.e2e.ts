import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { openReportOptions } from "../helpers/report-controls";

// Dedicated D port under either the main browser config or the standalone config.
test.use({ baseURL: "http://127.0.0.1:4343" });
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

const evidence = process.env.BARO_REPORT_EVIDENCE_DIR;
test("peer account switch clears dirty report, selected originals, confirmation and open dialog", async ({
  page,
  context,
}) => {
  await page.goto("/cases/case-demo/reports");
  const editor = page.getByRole("textbox", { name: "리포트 내용 편집" });
  await expect(editor).toBeVisible();
  await editor.fill("이전 계정의 저장하지 않은 합성 편집");
  await openReportOptions(page);
  await page.getByRole("checkbox", { name: "ZIP에 원본 포함" }).check();
  await page.evaluate(() => {
    const key = "baro.reports.browser-test.v1",
      state = JSON.parse(localStorage.getItem(key) ?? "{}");
    state.reports["case-demo"].revision++;
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.getByRole("button", { name: "검토 내용 저장" }).click();
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
  await expect(page.getByRole("checkbox", { name: "ZIP에 원본 포함" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "PDF 다운로드" })).toHaveCount(0);
  await expect(page.getByText("이전 계정의 저장하지 않은 합성 편집")).toHaveCount(0);
});
test("same owner role change purges report edits and exports after peer-tab notification", async ({
  page,
  context,
}) => {
  await page.goto("/cases/case-demo/reports");
  const editor = page.getByRole("textbox", { name: "리포트 내용 편집" });
  await expect(editor).toBeVisible();
  await editor.fill("역할 변경 전에 남겨진 합성 편집");
  await openReportOptions(page);
  await page.getByRole("checkbox", { name: "ZIP에 원본 포함" }).check();
  const peer = await context.newPage();
  await peer.goto("/settings");
  await peer.evaluate(() => {
    const key = "baro.reports.browser-test.v1",
      state = JSON.parse(localStorage.getItem(key) ?? "{}");
    state.session.user.accountType = "lawyer";
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.bringToFront();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole("button", { name: "PDF 다운로드" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "ZIP에 원본 포함" })).toHaveCount(0);
  await expect(page.getByText("역할 변경 전에 남겨진 합성 편집")).toHaveCount(0);
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
test("review, masking, exclusions, actual PDF/ZIP downloads and persistent cascading deletion", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:"))
      external.push(new URL(request.url()).origin);
  });
  await page.goto("/cases/case-demo/reports");
  await expect(page.getByRole("textbox", { name: "리포트 내용 편집" })).toBeVisible();
  await page
    .getByRole("textbox", { name: "리포트 내용 편집" })
    .fill(
      "사건의 사실과 주장\n합성 검토 내용: 010-1234-5678 / demo@example.test\n미확인 사항: 반환 날짜를 원본과 확인하세요.",
    );
  await openReportOptions(page);
  await page.getByRole("checkbox", { name: "전화번호·이메일·주민등록번호 가리기" }).check();
  await page.getByRole("button", { name: "검토 내용 저장" }).click();
  await expect(page.getByRole("status")).toContainText("검토 내용을 저장");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "리포트 내용 편집" })).toHaveValue(
    /합성 검토 내용/,
  );
  await openReportOptions(page);
  await expect(
    page.getByRole("checkbox", { name: "전화번호·이메일·주민등록번호 가리기" }),
  ).toBeChecked();
  await page.getByRole("button", { name: "전달 내용 미리보기" }).click();
  await expect(page.locator(".report-html-preview")).not.toContainText("010-1234-5678");
  await expect(page.locator(".report-html-preview")).toContainText("[전화번호 가림]");
  await openReportOptions(page);
  await page.getByRole("checkbox", { name: "리포트에서 제외" }).check();
  await openReportOptions(page);
  await expect(page.getByRole("checkbox", { name: "ZIP에 원본 포함" })).toBeDisabled();
  await page.getByRole("button", { name: "검토 내용 저장" }).click();
  await expect(page.getByRole("status")).toContainText("저장했어요");
  await page.reload();
  await openReportOptions(page);
  await expect(page.getByRole("checkbox", { name: "리포트에서 제외" })).toBeChecked();
  await openReportOptions(page);
  await page.getByRole("checkbox", { name: "리포트에서 제외" }).uncheck();
  await page.getByRole("button", { name: "검토 내용 저장" }).click();
  await expect(page.getByRole("status")).toContainText("저장했어요");
  await openReportOptions(page);
  await page.getByRole("checkbox", { name: "ZIP에 원본 포함" }).check();
  await page.getByRole("checkbox", { name: "내용·식별정보·선택한 원본을 확인했어요" }).check();
  const pdfPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF 다운로드" }).click();
  const pdf = await pdfPromise;
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  const pdfPath = await pdf.path();
  expect(pdfPath).toBeTruthy();
  const pdfBytes = await readFile(pdfPath as string);
  expect(pdfBytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdfBytes.toString()).toContain("/Subtype /Image");
  const zipPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /선택 원본 ZIP/ }).click();
  const zip = await zipPromise;
  const zipPath = await zip.path();
  const zipBytes = await readFile(zipPath as string);
  expect([...zipBytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 3, 4]);
  expect(zipBytes.toString()).toContain("합성 원본");
  if (evidence) {
    await mkdir(evidence, { recursive: true });
    await pdf.saveAs(resolve(evidence, "synthetic-report.pdf"));
    await zip.saveAs(resolve(evidence, "selected-originals.zip"));
    await page.screenshot({ path: resolve(evidence, "report-review.png"), fullPage: true });
  }
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "설정과 사용량" })).toBeVisible();
  await page.getByRole("button", { name: "사건 삭제", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "합성 대여금 사건" })).toBeVisible();
  await page.getByRole("button", { name: "사건 삭제", exact: true }).click();
  await page.getByRole("textbox", { name: "삭제 확인 — DELETE 입력" }).fill("DELETE");
  await page.getByRole("button", { name: "삭제 요청 확인" }).click();
  await expect(page.locator(".settings-success")).toContainText("사건 삭제를 접수");
  await page.reload();
  await expect(page.getByText("보관한 사건이 없어요.")).toBeVisible();
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
  await page.getByRole("button", { name: "사건 삭제", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect((await new AxeBuilder({ page }).include(".report-modal").analyze()).violations).toEqual(
    [],
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "사건 삭제", exact: true })).toBeFocused();
  await page.goto("/cases/case-demo/reports");
  await expect(page.getByRole("textbox", { name: "리포트 내용 편집" })).toBeVisible();
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
  await expect(page.getByRole("textbox", { name: "리포트 내용 편집" })).toBeDisabled();
  await page.evaluate(() => {
    const key = "baro.reports.browser-test.v1";
    const state = JSON.parse(localStorage.getItem(key) ?? "{}");
    state.session.needsConsent = false;
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload();
  await expect(page.getByRole("textbox", { name: "리포트 내용 편집" })).toBeVisible();
  const editor = page.getByRole("textbox", { name: "리포트 내용 편집" });
  await editor.fill("저장되지 않은 검토 내용");
  await page.evaluate(() => {
    const key = "baro.reports.browser-test.v1";
    const state = JSON.parse(localStorage.getItem(key) ?? "{}");
    state.reports["case-demo"].revision++;
    state.reports["case-demo"].content = "다른 화면에서 저장한 내용";
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.getByRole("button", { name: "검토 내용 저장" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "다시 확인" }).click();
  await expect(page.getByRole("dialog")).toContainText("저장하지 않은 편집");
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(editor).toHaveValue("저장되지 않은 검토 내용");
  await page.getByRole("button", { name: "다시 확인" }).click();
  await page.getByRole("button", { name: "편집을 버리고 다시 불러오기" }).click();
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
    const open = page.getByRole("button", { name: "계정과 모든 사건 삭제", exact: true });
    await expect(open).toBeDisabled();
    await page.getByRole("button", { name: "google로 재인증" }).click();
    await expect(open).toBeEnabled();
    await open.click();
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
