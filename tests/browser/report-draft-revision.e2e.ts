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

// Synthetic HTTP fixtures exercise the actual page and real client factory.
test("focus refresh preserves unsaved text and generation refreshes material choices", async ({
  page,
}) => {
  let revision = 1;
  let stale = false;
  let peerFile = false;
  const saved = () => ({
    id: `report-${revision}`,
    caseId: "synthetic-refresh",
    revision,
    title: "합성 리포트",
    content: `저장된 합성 본문 ${revision}`,
    updatedAt: "2026-10-10T00:00:00Z",
    stale,
    maskIdentifiers: false,
    excludedFileIds: [],
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/me/session")
      return route.fulfill({
        json: {
          user: { id: "synthetic-owner", name: "Synthetic", accountType: "customer" },
          needsConsent: false,
        },
      });
    if (path.endsWith("/files"))
      return route.fulfill({
        json: peerFile
          ? [
              {
                id: "peer-file",
                name: "추가 합성 원본.txt",
                mimeType: "text/plain",
                sizeBytes: 12,
                status: "ready",
                coverage: "합성 전체",
                extractedText: "합성 원본",
              },
            ]
          : [],
      });
    if (path.endsWith("/reports")) {
      if (request.method() === "POST") {
        revision++;
        stale = false;
      }
      return route.fulfill({ json: saved() });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("/cases/synthetic-refresh/reports");
  const editor = page.getByRole("textbox", { name: "리포트 내용 편집" });
  await expect(editor).toHaveValue("저장된 합성 본문 1");
  await editor.fill("저장하지 않은 독립 상담 질문");
  stale = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText(/사건이나 자료가 변경됐어요/)).toBeVisible();
  await expect(editor).toHaveValue("저장하지 않은 독립 상담 질문");
  await expect(page.getByRole("button", { name: "검토 내용 저장", exact: true })).toBeDisabled();
  peerFile = true;
  await page.getByRole("button", { name: "새 버전 만들기", exact: true }).click();
  await page.getByRole("button", { name: "새 버전 생성", exact: true }).click();
  await expect(editor).toHaveValue("저장된 합성 본문 2");
  await page.locator("summary").filter({ hasText: "개인정보·자료 설정" }).click();
  await expect(page.locator(".report-material")).toContainText("추가 합성 원본.txt");
  await expect(page.getByRole("checkbox", { name: "ZIP에 원본 포함", exact: true })).toBeEnabled();
});

test("initial report limit allows exclusions before any report exists", async ({ page }) => {
  let created = false;
  let exclusions: string[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/me/session")
      return route.fulfill({
        json: {
          user: { id: "synthetic-owner", name: "Synthetic", accountType: "customer" },
          needsConsent: false,
        },
      });
    if (path.endsWith("/files"))
      return route.fulfill({
        json: [
          {
            id: "large-file",
            name: "큰 합성 자료.txt",
            mimeType: "text/plain",
            sizeBytes: 25000,
            status: "ready",
            coverage: "합성 전체",
            extractedText: "합성 원본",
          },
        ],
      });
    if (path.endsWith("/reports")) {
      if (request.method() === "POST") {
        exclusions = request.postDataJSON().excludedFileIds;
        created = exclusions.includes("large-file");
      }
      if (!created)
        return route.fulfill({
          status: 413,
          json: {
            error: {
              code: "EXPORT_LIMIT_EXCEEDED",
              message: "합성 리포트 한도 초과",
              retryable: false,
            },
          },
        });
      return route.fulfill({
        json: {
          id: "report-recovered",
          caseId: "synthetic-limit",
          revision: 1,
          title: "합성 리포트",
          content: "제외 후 생성한 합성 리포트",
          updatedAt: "2026-10-10T00:00:00Z",
          stale: false,
          maskIdentifiers: false,
          excludedFileIds: exclusions,
        },
      });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("/cases/synthetic-limit/reports");
  await expect(
    page.getByRole("heading", { name: "자료를 줄여 첫 리포트를 만들어요" }),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: /큰 합성 자료/ }).check();
  await page.getByRole("button", { name: "선택 자료를 제외하고 생성" }).click();
  await expect(page.getByRole("textbox", { name: "리포트 내용 편집" })).toHaveValue(
    "제외 후 생성한 합성 리포트",
  );
  expect(exclusions).toEqual(["large-file"]);
});
