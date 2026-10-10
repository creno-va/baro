import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { captureCaseViewports } from "../helpers/case-ui-capture";
import { openReportOptions } from "../helpers/report-controls";

// Uses the actual product pages and shared facade, with no component/API alias or injected seed.
test.skip(process.env.BARO_D_SHARED_API !== "true", "Run the explicit shared mock configuration.");
test("shared login/intake/C originals/D review downloads and deletion persist across reload", async ({
  page,
  baseURL,
  context,
}) => {
  const apiRequests: string[] = [],
    externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) apiRequests.push(url.pathname);
    if (url.origin !== baseURL) externalRequests.push(url.origin);
  });
  const artifacts = resolve(process.env.BARO_REPORT_EVIDENCE ?? "test-results/reports-integrated");
  await mkdir(artifacts, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.locator('astro-island[component-export="AuthButtons"]:not([ssr])').waitFor();
  await page.getByRole("radio", { name: /^고객/ }).check();
  await page.getByRole("button", { name: "Google로 계속하기" }).click();
  await expect(page).toHaveURL(/\/consent$/);
  await page.getByRole("link", { name: "AI 이용 고지", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AI 이용 고지 초안" })).toBeVisible();
  await page.goBack();
  await page
    .getByRole("checkbox", {
      name: "이용약관, 개인정보 처리방침, AI 이용 고지를 확인하고 동의합니다.",
    })
    .check();
  await page.getByRole("checkbox", { name: "만 14세 이상입니다." }).check();
  await page.getByRole("button", { name: "동의하고 계속하기" }).click();
  await page.getByRole("link", { name: "내 화면으로 계속하기" }).click();
  const ownerId = await page.evaluate(
    () => JSON.parse(localStorage.getItem("baro-api-mock-v1:session") ?? "{}").user.id as string,
  );
  await expect(page).toHaveURL(/\/app$/);
  async function completeIntake(narrative: string) {
    await page.getByRole("textbox", { name: "지금까지 있었던 일" }).fill(narrative);
    await page.getByRole("button", { name: "저장하고 계속" }).click();
    for (let index = 0; index < 6; index++)
      await page.getByRole("button", { name: "모름", exact: true }).click();
    await expect(page).toHaveURL(/\/summary$/);
    await page.getByRole("checkbox", { name: /요약이 내가 이야기한 사실과 맞는지/ }).check();
    await page.getByRole("button", { name: "요약 확인하고 계속" }).click();
    await page.getByRole("button", { name: "확인하고 사건 열기" }).click();
    await expect(page.getByRole("heading", { name: "이제, 하나씩 풀어가요." })).toBeVisible();
    return new URL(page.url()).pathname;
  }
  const casePath = await completeIntake(
    "합성 사건입니다. 지인에게 빌려준 돈을 돌려받지 못했습니다. 연락처는 010-1234-5678입니다.",
  );
  await page.goto(`${casePath}/files`);
  const originalText = "합성 원본 · PDF에서 가린 전화번호 010-1234-5678도 원본에는 남습니다.";
  for (const name of ["선택 원본.txt", "제외 원본.txt"]) {
    await page.getByLabel("선택 자료의 자동 처리에 동의합니다.").check();
    await page
      .getByLabel("업로드할 파일 선택", { exact: true })
      .setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(originalText) });
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  await expect(page.getByText("결과 확인 가능", { exact: true })).toHaveCount(2);
  await page.goto(`${casePath}/reports`);
  const editor = page.getByRole("textbox", { name: "리포트 내용 편집" });
  await expect(editor).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "전화번호·이메일·주민등록번호 가리기" }),
  ).toBeHidden();
  await captureCaseViewports(page, "reports", ".report-review");
  await editor.fill(
    "사용자가 검토한 합성 사실입니다. 연락처 010-1234-5678, synthetic@example.test는 전달 전에 가립니다.",
  );
  await openReportOptions(page);
  await page.getByRole("checkbox", { name: "전화번호·이메일·주민등록번호 가리기" }).check();
  const excluded = page.locator(".report-material").filter({ hasText: "제외 원본.txt" });
  await openReportOptions(page);
  await excluded.getByRole("checkbox", { name: "리포트에서 제외" }).check();
  await page.getByRole("button", { name: "본문 편집 먼저 저장" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "본문 편집을 먼저 저장했어요." }),
  ).toBeVisible();
  await expect(editor).toHaveValue(/사용자가 검토한 합성 사실/);
  await expect(excluded.getByRole("checkbox", { name: "리포트에서 제외" })).toBeChecked();
  await page.getByRole("button", { name: "검토 내용 저장" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "검토 내용을 저장했어요." }),
  ).toBeVisible();
  await page.reload();
  await expect(editor).toHaveValue(/합성 API 예시/);
  await expect(editor).not.toHaveValue(/제외 원본.txt/);
  await expect(editor).not.toHaveValue(/사용자가 검토한 합성 사실/);
  await openReportOptions(page);
  await expect(
    page.getByRole("checkbox", { name: "전화번호·이메일·주민등록번호 가리기" }),
  ).toBeChecked();
  await openReportOptions(page);
  await expect(excluded.getByRole("checkbox", { name: "리포트에서 제외" })).toBeChecked();
  await openReportOptions(page);
  await expect(excluded.getByRole("checkbox", { name: "ZIP에 원본 포함" })).toBeDisabled();
  await page
    .locator(".report-material")
    .filter({ hasText: "선택 원본.txt" })
    .getByRole("checkbox", { name: "ZIP에 원본 포함" })
    .check();
  await page.getByRole("button", { name: "전달 내용 미리보기" }).click();
  await expect(page.locator(".report-html-preview")).toContainText("[전화번호 가림]");
  await expect(page.locator(".report-html-preview")).not.toContainText("010-1234-5678");
  await page.getByRole("checkbox", { name: "내용·식별정보·선택한 원본을 확인했어요" }).check();
  const pdfEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF 다운로드", exact: true }).click();
  const pdfPath = resolve(artifacts, "integrated-report.pdf");
  await (await pdfEvent).saveAs(pdfPath);
  expect((await readFile(pdfPath)).subarray(0, 5).toString()).toBe("%PDF-");
  const zipEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: /선택 원본 ZIP/ }).click();
  const zipPath = resolve(artifacts, "integrated-originals.zip");
  await (await zipEvent).saveAs(zipPath);
  const zip = await readFile(zipPath);
  expect(zip.readUInt32LE(0)).toBe(0x04034b50);
  expect(zip.subarray(30, 30 + zip.readUInt16LE(26)).toString("utf8")).toBe("001-선택 원본.txt");
  const payload = 30 + zip.readUInt16LE(26) + zip.readUInt16LE(28);
  expect(zip.subarray(payload, payload + zip.readUInt32LE(18)).toString("utf8")).toBe(originalText);
  expect(zip.readUInt16LE(zip.length - 12)).toBe(1);
  expect((await new AxeBuilder({ page }).include(".report-review").analyze()).violations).toEqual(
    [],
  );
  await page.screenshot({ path: resolve(artifacts, "integrated-review.png"), fullPage: true });
  await page.goto("/settings");
  await page.getByRole("button", { name: "사건 삭제", exact: true }).click();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.getByRole("button", { name: "사건 삭제", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "사건 삭제", exact: true }).click();
  await page.getByRole("textbox", { name: "삭제 확인 — DELETE 입력" }).fill("DELETE");
  await page.getByRole("button", { name: "삭제 요청 확인", exact: true }).click();
  await expect(page.getByRole("button", { name: "사건 삭제", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "사건 삭제", exact: true })).toHaveCount(0);
  const originalCount = () =>
    page.evaluate(
      () =>
        new Promise<number>((done, reject) => {
          const request = indexedDB.open("baro-workspace-originals-v1", 1);
          request.onsuccess = () => {
            const db = request.result,
              tx = db.transaction("originals", "readonly"),
              query = tx.objectStore("originals").count();
            query.onsuccess = () => {
              done(query.result);
              db.close();
            };
            query.onerror = () => reject(new Error("Synthetic original inventory failed"));
          };
          request.onerror = () => reject(new Error("Synthetic original inventory failed"));
        }),
    );
  expect(await originalCount()).toBe(0);
  await page.goto(`${casePath}/reports`);
  await expect(page.getByRole("alert")).toContainText("찾을 수 없어요");
  await page.goto("/cases");
  await expect(page.getByRole("heading", { name: "아직 정리한 사건이 없어요" })).toBeVisible();
  await page.goto("/cases/new");
  const accountCasePath = await completeIntake(
    "계정 삭제를 확인하기 위해 보관한 합성 사건입니다. 실제 개인정보가 아닙니다.",
  );
  await page.goto(`${accountCasePath}/files`);
  await page.getByLabel("선택 자료의 자동 처리에 동의합니다.").check();
  await page.getByLabel("업로드할 파일 선택", { exact: true }).setInputFiles({
    name: "계정 삭제 원본.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(originalText),
  });
  await expect(page.getByText("결과 확인 가능", { exact: true })).toBeVisible();
  expect(await originalCount()).toBeGreaterThan(0);
  const peer = await context.newPage();
  await peer.goto(`${accountCasePath}/reports`);
  await expect(peer.getByRole("textbox", { name: "리포트 내용 편집" })).toBeVisible();
  const previousMarker = await page.evaluate(() => localStorage.getItem("baro-session-changed"));
  await page.goto("/settings");
  await page.getByRole("button", { name: "계정과 모든 사건 삭제", exact: true }).click();
  await page.getByRole("textbox", { name: "삭제 확인 — DELETE 입력" }).fill("DELETE");
  await page.getByRole("button", { name: "삭제 요청 확인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "계정 삭제를 접수했어요" })).toBeVisible();
  const deletedMarker = await page.evaluate(() => localStorage.getItem("baro-session-changed"));
  expect(deletedMarker).toMatch(/^[0-9a-f-]{36}$/);
  expect(deletedMarker).not.toBe(previousMarker);
  await peer.bringToFront();
  await expect(peer.getByRole("textbox", { name: "리포트 내용 편집" })).toHaveCount(0);
  await expect(peer.getByRole("button", { name: "PDF 다운로드" })).toHaveCount(0);
  await expect(peer.getByRole("link", { name: "로그인", exact: true })).toBeVisible();
  await page.reload();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("baro-api-mock-v1:session") ?? "{}").user,
    ),
  ).toBeNull();
  expect(
    await page.evaluate(
      (id) => JSON.parse(localStorage.getItem("baro-api-mock-v1:consents") ?? "{}")[id],
      ownerId,
    ),
  ).toBeUndefined();
  expect(await originalCount()).toBe(0);
  expect(
    await page.evaluate(() =>
      Object.keys(JSON.parse(localStorage.getItem("baro-api-mock-v1:cases") ?? "{}")),
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(() =>
      Object.keys(JSON.parse(localStorage.getItem("baro-api-mock-v1:files") ?? "{}")),
    ),
  ).toEqual([]);
  expect(apiRequests).toEqual([]);
  expect(externalRequests).toEqual([]);
});
