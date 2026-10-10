import { expect, test } from "@playwright/test";

test("ZIP metadata refresh preserves the displayed draft revision", async ({ page }) => {
  let latest = 1;
  let expectedRevision: number | undefined;
  const report = (revision: number) => ({
    id: `synthetic-report-${revision}`,
    caseId: "synthetic-report-race",
    revision,
    title: "Synthetic report",
    content: revision === 1 ? "Original screen content" : "Peer correction",
    updatedAt: "2026-10-10T00:00:00Z",
    stale: false,
    excludedFileIds: [],
    maskIdentifiers: false,
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/me/session")
      return route.fulfill({
        json: {
          user: { id: "synthetic-owner", name: "Synthetic", accountType: "customer" },
          needsConsent: false,
        },
      });
    if (url.pathname.endsWith("/files"))
      return route.fulfill({
        json: [
          {
            id: "synthetic-file",
            name: "Synthetic original.txt",
            mimeType: "text/plain",
            sizeBytes: 10,
            status: "ready",
            coverage: "Synthetic",
            extractedText: "Synthetic",
          },
        ],
      });
    if (url.pathname.endsWith("/zip")) {
      latest = 2;
      return route.fulfill({
        contentType: "application/zip",
        body: Buffer.from([0x50, 0x4b, 3, 4, 0]),
      });
    }
    if (url.pathname.endsWith("/reports")) {
      if (request.method() === "PATCH") {
        expectedRevision = request.postDataJSON().expectedRevision;
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: "STALE_REVISION",
              message: "다른 화면에서 리포트가 변경되었어요.",
              retryable: false,
            },
          },
        });
      }
      return route.fulfill({ json: report(latest) });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("/cases/synthetic-report-race/reports");
  const editor = page.getByRole("textbox", { name: "리포트 내용 편집" });
  await expect(editor).toHaveValue("Original screen content");
  await page.locator("summary").filter({ hasText: "개인정보·자료 설정" }).click();
  await page.getByRole("checkbox", { name: "ZIP에 원본 포함", exact: true }).check();
  await page
    .getByRole("checkbox", { name: "내용·식별정보·선택한 원본을 확인했어요", exact: true })
    .check();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /^선택 원본 ZIP/ }).click();
  await download;
  await expect(page.getByText("ZIP 다운로드를 시작했어요.", { exact: true })).toBeVisible();
  await expect(editor).toHaveValue("Original screen content");
  await editor.fill("Correction from old screen");
  await page.getByRole("button", { name: "검토 내용 저장", exact: true }).click();
  await expect.poll(() => expectedRevision).toBe(1);
  await expect(editor).toHaveValue("Correction from old screen");
});
