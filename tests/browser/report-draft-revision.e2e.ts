import { expect, test } from "@playwright/test";
import { openReportEditor } from "../helpers/report-controls";

const progressReport = {
  id: "synthetic-progress-report",
  caseId: "synthetic-progress-case",
  revision: 1,
  title: "합성 대기 리포트",
  content: "보존할 합성 검토 본문",
  updatedAt: "2026-10-10T00:00:00Z",
  stale: false,
  excludedFileIds: [],
  maskIdentifiers: true,
};
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function progressFixture(
  page: import("@playwright/test").Page,
  handlers: {
    pdf: (route: import("@playwright/test").Route) => Promise<void>;
    report?: (route: import("@playwright/test").Route) => Promise<void>;
    session?: (route: import("@playwright/test").Route) => Promise<void>;
  },
) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    // Vite module URLs also contain /api/; only intercept application API routes.
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/me/session")
      return handlers.session
        ? handlers.session(route)
        : route.fulfill({
            json: {
              user: { id: "synthetic-owner", name: "합성", accountType: "customer" },
              needsConsent: false,
            },
          });
    if (path.endsWith("/pdf")) return handlers.pdf(route);
    if (path.endsWith("/reports"))
      return handlers.report ? handlers.report(route) : route.fulfill({ json: progressReport });
    if (path.endsWith("/files"))
      return route.fulfill({
        json: [
          {
            id: "synthetic-progress-file",
            name: "합성 원본.txt",
            mimeType: "text/plain",
            sizeBytes: 10,
            status: "ready",
            coverage: "전체",
            extractedText: "합성",
          },
        ],
      });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("/cases/synthetic-progress-case/reports");
  await openReportEditor(page);
  await expect(page.getByRole("textbox", { name: "리포트 내용 편집" })).toHaveValue(
    progressReport.content,
  );
  await page.locator("summary").filter({ hasText: "개인정보·자료 설정" }).click();
  await page
    .getByRole("checkbox", { name: "내용·식별정보·선택한 사진을 확인했어요", exact: true })
    .check();
}

test("PDF elapsed wait retains the reviewed draft and exposes PDF as the only save format", async ({
  page,
}) => {
  const response = gate();
  let calls = 0;
  await page.clock.install();
  await progressFixture(page, {
    async pdf(route) {
      calls++;
      await response.promise;
      await route.fulfill({
        contentType: "application/pdf",
        body: Buffer.from("%PDF-1.7\nsynthetic"),
      });
    },
  });
  await expect(page.getByRole("button", { name: /HTML 다운로드|선택 원본 ZIP/ })).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF 다운로드", exact: true }).click();
  await expect.poll(() => calls).toBe(1);
  await page.clock.fastForward(65000);
  await expect(page.locator(".report-progress")).toContainText("요청 시작 후 65초");
  response.release();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
  await openReportEditor(page);
  await expect(page.getByRole("textbox", { name: "리포트 내용 편집" })).toHaveValue(
    progressReport.content,
  );
  expect(calls).toBe(1);
});

test("PDF waits for the postflight owner check despite focus, and rejects a changed owner", async ({
  page,
}) => {
  const postflight = gate();
  let pdfCalls = 0,
    blocked = false,
    downloads = 0;
  page.on("download", () => downloads++);
  await progressFixture(page, {
    async pdf(route) {
      pdfCalls++;
      await route.fulfill({
        contentType: "application/pdf",
        body: Buffer.from("%PDF-1.7\nsynthetic"),
      });
    },
    async session(route) {
      const changed = pdfCalls > 0 && !blocked;
      if (changed) {
        blocked = true;
        await postflight.promise;
      }
      await route.fulfill({
        json: {
          user: {
            id: changed ? "synthetic-other-owner" : "synthetic-owner",
            name: "합성",
            accountType: "customer",
          },
          needsConsent: false,
        },
      });
    },
  });
  await page.getByRole("button", { name: /^PDF 다운로드/ }).click();
  await expect.poll(() => blocked).toBe(true);
  await expect(page.locator(".report-progress")).toContainText("접근 권한 다시 확인 중");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect(downloads).toBe(0);
  expect(pdfCalls).toBe(1);
  postflight.release();
  await expect(page.getByRole("textbox", { name: "리포트 내용 편집" })).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("계정 또는 접근 상태가 변경");
  await expect(page.locator(".report-progress")).toHaveCount(0);
  expect(downloads).toBe(0);
});

test("report generation shows the actual elapsed request inside its confirmation dialog", async ({
  page,
}) => {
  const generation = gate();
  let generations = 0;
  await page.clock.install();
  await progressFixture(page, {
    async pdf(route) {
      await route.fulfill({ status: 400, json: {} });
    },
    async report(route) {
      if (route.request().method() === "POST") {
        generations++;
        await generation.promise;
      }
      await route.fulfill({
        json: { ...progressReport, revision: generations + 1 },
      });
    },
  });
  await page.getByRole("button", { name: "새 버전 만들기", exact: true }).click();
  await page.getByRole("button", { name: "새 버전 생성", exact: true }).click();
  await expect.poll(() => generations).toBe(1);
  await page.clock.fastForward(48000);
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "새 버전 생성 중… · 요청 시작 후 48초",
  );
  await expect(page.getByRole("button", { name: "새 버전 생성", exact: true })).toBeDisabled();
  generation.release();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("새 초안을 만들었어요. 내용을 다시 확인해 주세요.")).toBeVisible();
  await expect(page.locator(".report-progress")).toHaveCount(0);
  expect(generations).toBe(1);
});

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
  await openReportEditor(page);
  const editor = page.getByRole("textbox", { name: "리포트 내용 편집" });
  await expect(editor).toHaveValue("저장된 합성 본문 1");
  await editor.fill("저장하지 않은 독립 상담 질문");
  stale = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText(/사건·자료 또는 공식 출처의 확인 상태가 바뀌었어요/)).toBeVisible();
  await expect(editor).toHaveValue("저장하지 않은 독립 상담 질문");
  await expect(page.getByRole("button", { name: "검토 내용 저장", exact: true })).toBeDisabled();
  peerFile = true;
  await page.getByRole("button", { name: "새 버전 만들기", exact: true }).click();
  await page.getByRole("button", { name: "새 버전 생성", exact: true }).click();
  await expect(editor).toHaveValue("저장된 합성 본문 2");
  await page.locator("summary").filter({ hasText: "개인정보·자료 설정" }).click();
  await expect(page.locator(".report-material")).toContainText("추가 합성 원본.txt");
  await expect(
    page.getByRole("checkbox", { name: "PDF에 근거 사진 포함", exact: true }),
  ).toBeDisabled();
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
  await openReportEditor(page);
  await expect(page.getByRole("textbox", { name: "리포트 내용 편집" })).toHaveValue(
    "제외 후 생성한 합성 리포트",
  );
  expect(exclusions).toEqual(["large-file"]);
});
