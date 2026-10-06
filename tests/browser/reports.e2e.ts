import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const evidence = process.env.BARO_REPORT_EVIDENCE_DIR;
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
  await page.getByRole("checkbox", { name: "전화번호·이메일·주민등록번호 가리기" }).check();
  await page.getByRole("button", { name: "검토 내용 저장" }).click();
  await expect(page.getByRole("status")).toContainText("검토 내용을 저장");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "리포트 내용 편집" })).toHaveValue(
    /합성 검토 내용/,
  );
  await expect(
    page.getByRole("checkbox", { name: "전화번호·이메일·주민등록번호 가리기" }),
  ).toBeChecked();
  await page.getByRole("button", { name: "전달 내용 미리보기" }).click();
  await expect(page.locator(".report-preview")).not.toContainText("010-1234-5678");
  await expect(page.locator(".report-preview")).toContainText("[전화번호 가림]");
  await page.getByRole("checkbox", { name: "리포트에서 제외" }).check();
  await expect(page.getByRole("checkbox", { name: "ZIP에 원본 포함" })).toBeDisabled();
  await page.getByRole("button", { name: "검토 내용 저장" }).click();
  await expect(page.getByRole("status")).toContainText("저장했어요");
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "리포트에서 제외" })).toBeChecked();
  await page.getByRole("checkbox", { name: "리포트에서 제외" }).uncheck();
  await page.getByRole("button", { name: "검토 내용 저장" }).click();
  await expect(page.getByRole("status")).toContainText("저장했어요");
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
  await page.getByRole("button", { name: "사건 삭제", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "사건 삭제", exact: true })).toBeFocused();
  await page.goto("/cases/case-demo/reports");
  await expect(page.getByRole("textbox", { name: "리포트 내용 편집" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.evaluate(() => {
    const key = "baro.reports.browser-test.v1";
    const state = JSON.parse(localStorage.getItem(key) ?? "{}");
    state.session.needsConsent = true;
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("동의");
  await page.evaluate(() => {
    const key = "baro.reports.browser-test.v1";
    const state = JSON.parse(localStorage.getItem(key) ?? "{}");
    state.session.needsConsent = false;
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.getByRole("button", { name: "다시 확인" }).click();
  await expect(page.getByRole("textbox", { name: "리포트 내용 편집" })).toBeVisible();
  if (evidence)
    await page.screenshot({ path: resolve(evidence, "report-mobile.png"), fullPage: true });
});
