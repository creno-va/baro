import { expect, test } from "@playwright/test";

test("embedded report preserves stale edits before generating a new snapshot and clears all content on account change", async ({
  page,
}) => {
  let owner = "synthetic-report-owner";
  let report = {
    id: "synthetic-original-report",
    caseId: "synthetic-rework-case",
    revision: 1,
    title: "합성 사건 리포트",
    content: "사건 개요\n이전 분석으로 생성한 합성 리포트입니다.",
    stale: false,
    updatedAt: "2026-11-01T00:00:00Z",
    excludedFileIds: [],
    maskIdentifiers: false,
    basis: { workspaceRevision: 4, summaryRevision: 1, generatedAt: "2026-11-01T00:00:00Z" },
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/me/session")
      return route.fulfill({
        json: { user: { id: owner, name: "합성", accountType: "customer" }, needsConsent: false },
      });
    if (path.endsWith("/files")) return route.fulfill({ json: [] });
    if (path.endsWith("/reports")) {
      if (route.request().method() === "POST")
        report = {
          ...report,
          id: "synthetic-new-report",
          revision: 2,
          stale: false,
          content: "사건 개요\n최신 사건으로 생성한 새로운 합성 리포트입니다.",
        };
      return route.fulfill({ json: report });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("/cases/synthetic-rework-case/reports?embedded=true");
  await expect(page.getByRole("heading", { name: "전달할 리포트를 준비해요" })).toHaveCount(0);
  await expect(page.locator(".case-navigation")).toHaveCount(0);
  await page.getByRole("button", { name: "수정하기", exact: true }).click();
  await page
    .getByRole("textbox", { name: "사건 개요 수정" })
    .fill("저장 전이지만 유실하면 안 되는 직접 편집입니다.");
  await expect(page.locator("html")).toHaveAttribute("data-report-dirty", "true");
  report = { ...report, stale: true };
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("과거 기준의 리포트", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "사건 개요 수정" })).toHaveValue(
    "저장 전이지만 유실하면 안 되는 직접 편집입니다.",
  );
  await expect(page.getByRole("button", { name: "PDF 다운로드", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "새 버전 만들기", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "새 버전 생성", exact: true }).click();
  await expect(
    page.getByText("최신 사건으로 생성한 새로운 합성 리포트입니다.", { exact: true }),
  ).toBeVisible();
  await page.getByText("새 버전을 만들기 전의 편집 내용 보관", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "보관한 리포트 편집 내용" })).toHaveValue(
    /유실하면 안 되는 직접 편집/,
  );
  await expect(page.locator("html")).toHaveAttribute("data-report-dirty", "true");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "보관한 편집 내용 저장", exact: true }).click();
  expect((await download).suggestedFilename()).toContain("편집보관.txt");
  await expect(page.locator("html")).toHaveAttribute("data-report-dirty", "false");
  owner = "synthetic-another-owner";
  await page.evaluate(() => window.dispatchEvent(new Event("baro-session-changed")));
  await expect(page.locator(".report-reading")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "보관한 리포트 편집 내용" })).toHaveCount(0);
});
