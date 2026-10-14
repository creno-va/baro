import { expect, test } from "@playwright/test";

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
    zip: (route: import("@playwright/test").Route) => Promise<void>;
    report?: (route: import("@playwright/test").Route) => Promise<void>;
    session?: (route: import("@playwright/test").Route) => Promise<void>;
  },
) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me/session")
      return handlers.session
        ? handlers.session(route)
        : route.fulfill({
            json: {
              user: { id: "synthetic-owner", name: "합성", accountType: "customer" },
              needsConsent: false,
            },
          });
    if (path.endsWith("/zip")) return handlers.zip(route);
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
  await expect(page.getByRole("textbox", { name: "리포트 내용 편집" })).toHaveValue(
    progressReport.content,
  );
  await page.locator("summary").filter({ hasText: "개인정보·자료 설정" }).click();
  await page.getByRole("checkbox", { name: "ZIP에 원본 포함", exact: true }).check();
  await page
    .getByRole("checkbox", { name: "내용·식별정보·선택한 원본을 확인했어요", exact: true })
    .check();
}

test("ZIP elapsed wait and post-download refresh failure preserve the successful download", async ({
  page,
}) => {
  const response = gate();
  let zipCalls = 0,
    reportCalls = 0;
  await page.clock.install();
  await progressFixture(page, {
    async zip(route) {
      zipCalls++;
      await response.promise;
      await route.fulfill({
        contentType: "application/zip",
        body: Buffer.from([0x50, 0x4b, 3, 4, 0]),
      });
    },
    async report(route) {
      reportCalls++;
      if (reportCalls === 2)
        return route.fulfill({
          status: 503,
          json: { error: { code: "UNAVAILABLE", message: "합성 목록 조회 실패" } },
        });
      await route.fulfill({
        json: {
          ...progressReport,
          ...(reportCalls > 2
            ? {
                savedZip: {
                  id: "synthetic-progress-zip",
                  fileCount: 1,
                  createdAt: progressReport.updatedAt,
                },
              }
            : {}),
        },
      });
    },
  });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /^선택 원본 ZIP/ }).click();
  await expect.poll(() => zipCalls).toBe(1);
  await page.clock.fastForward(65000);
  await expect(page.locator(".report-progress")).toContainText("요청 시작 후 65초");
  await expect(page.locator(".report-progress")).toContainText("ZIP 준비 중");
  response.release();
  await download;
  await expect(page.getByText("ZIP 다운로드를 시작했어요.", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("저장된 ZIP 정보를 확인하지 못했어요");
  await expect(page.getByRole("textbox", { name: "리포트 내용 편집" })).toHaveValue(
    progressReport.content,
  );
  await expect(page.getByRole("checkbox", { name: "ZIP에 원본 포함", exact: true })).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "전화번호·이메일·주민등록번호 가리기" }),
  ).toBeChecked();
  await page.getByRole("button", { name: "저장된 ZIP 정보 다시 확인", exact: true }).click();
  await expect(page.getByRole("button", { name: /저장된 선택 원본 ZIP/ })).toBeVisible();
  await expect(page.locator(".report-progress")).toHaveCount(0);
  expect(zipCalls).toBe(1);
  expect(reportCalls).toBe(3);
});

test("ZIP waits for the postflight owner check despite focus, and rejects a changed owner", async ({
  page,
}) => {
  const postflight = gate();
  let zipCalls = 0,
    blocked = false,
    sessions = 0,
    downloads = 0;
  page.on("download", () => downloads++);
  await progressFixture(page, {
    async zip(route) {
      zipCalls++;
      await route.fulfill({
        contentType: "application/zip",
        body: Buffer.from([0x50, 0x4b, 3, 4, 0]),
      });
    },
    async session(route) {
      sessions++;
      const changed = zipCalls > 0 && !blocked;
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
  await page.getByRole("button", { name: /^선택 원본 ZIP/ }).click();
  await expect.poll(() => blocked).toBe(true);
  await expect(page.locator(".report-progress")).toContainText("접근 권한 다시 확인 중");
  const beforeFocus = sessions;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => sessions).toBeGreaterThan(beforeFocus);
  expect(downloads).toBe(0);
  expect(zipCalls).toBe(1);
  postflight.release();
  await expect(page.getByRole("textbox", { name: "리포트 내용 편집" })).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("계정 또는 접근 상태가 변경");
  await expect(page.locator(".report-progress")).toHaveCount(0);
  expect(downloads).toBe(0);
});

test("signout during ZIP metadata refresh clears the delivered report and late metadata", async ({
  page,
}) => {
  const refresh = gate();
  let reportCalls = 0;
  await progressFixture(page, {
    async zip(route) {
      await route.fulfill({
        contentType: "application/zip",
        body: Buffer.from([0x50, 0x4b, 3, 4, 0]),
      });
    },
    async report(route) {
      reportCalls++;
      if (reportCalls === 2) await refresh.promise;
      await route.fulfill({
        json: {
          ...progressReport,
          savedZip: {
            id: "synthetic-late-zip",
            fileCount: 1,
            createdAt: progressReport.updatedAt,
          },
        },
      });
    },
  });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /^선택 원본 ZIP/ }).click();
  await download;
  await expect.poll(() => reportCalls).toBe(2);
  await expect(page.getByText("ZIP 다운로드를 시작했어요.", { exact: true })).toBeVisible();
  await expect(page.locator(".report-progress")).toContainText("저장된 ZIP 정보 확인 중");
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("baro-session-changed", { detail: { reason: "signout" } }),
    ),
  );
  refresh.release();
  await expect(page.getByRole("textbox", { name: "리포트 내용 편집" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /저장된 선택 원본 ZIP/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "저장된 ZIP 정보 다시 확인" })).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("로그인 후 리포트를 다시 확인");
  await expect(page.locator(".report-progress")).toHaveCount(0);
});

for (const failure of ["download", "consent"] as const)
  test(`ZIP ${failure} failure is not reported as a successful download`, async ({ page }) => {
    let reportCalls = 0,
      downloads = 0;
    page.on("download", () => downloads++);
    await progressFixture(page, {
      async zip(route) {
        if (failure === "consent")
          return route.fulfill({
            status: 403,
            json: { error: { code: "CONSENT_REQUIRED", message: "현재 동의를 확인해 주세요." } },
          });
        await route.fulfill({
          contentType: "application/zip",
          body: Buffer.from([0x50, 0x4b, 3, 4, 0]),
        });
      },
      async report(route) {
        reportCalls++;
        await route.fulfill({ json: progressReport });
      },
    });
    if (failure === "download")
      await page.evaluate(() => {
        URL.createObjectURL = () => {
          throw new Error("합성 다운로드 전달 실패");
        };
      });
    await page.getByRole("button", { name: /^선택 원본 ZIP/ }).click();
    await expect(page.getByRole("alert")).toContainText(
      failure === "download" ? "합성 다운로드 전달 실패" : "현재 동의를 확인",
    );
    await expect(page.getByText("ZIP 다운로드를 시작했어요.", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "저장된 ZIP 정보 다시 확인" })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "리포트 내용 편집" })).toHaveValue(
      progressReport.content,
    );
    await expect(page.locator(".report-progress")).toHaveCount(0);
    if (failure === "consent")
      await expect(page.getByRole("button", { name: /^선택 원본 ZIP/ })).toBeDisabled();
    expect(downloads).toBe(0);
    expect(reportCalls).toBe(1);
  });

test("report generation shows the actual elapsed request inside its confirmation dialog", async ({
  page,
}) => {
  const generation = gate();
  let generations = 0;
  await page.clock.install();
  await progressFixture(page, {
    async zip(route) {
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
