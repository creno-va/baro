import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { captureCaseViewports } from "../helpers/case-ui-capture";
import { openReportEditor, openReportOptions } from "../helpers/report-controls";

// Uses the actual product pages and shared facade, with no component/API alias or injected seed.
test.skip(process.env.BARO_D_SHARED_API !== "true", "Run the explicit shared mock configuration.");
test("shared login/intake/C originals/D review downloads and deletion persist across reload", async ({
  page,
  baseURL,
  context,
}) => {
  // Two complete intakes, PDF/ZIP downloads, reloads and two deletion flows
  // share this budget; individual readiness assertions retain their 5s limit.
  test.setTimeout(60_000);
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
  const policyOpened = context.waitForEvent("page");
  await page.getByRole("link", { name: /^AI 이용 고지/ }).click();
  const policy = await policyOpened;
  await expect(policy.getByRole("heading", { name: "AI 이용 고지 초안" })).toBeVisible();
  await policy.close();
  await page
    .getByRole("checkbox", {
      name: "이용약관, 개인정보 처리방침, AI 이용 고지를 확인하고 동의합니다.",
    })
    .check();
  await page.getByRole("checkbox", { name: "만 14세 이상입니다." }).check();
  await page.getByRole("button", { name: "동의하고 계속하기" }).click();
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
  await openReportEditor(page);
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
  await openReportEditor(page);
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
  await expect(excluded.getByRole("checkbox", { name: "PDF에 근거 사진 포함" })).toBeDisabled();
  await page.getByRole("button", { name: "전달 내용 미리보기" }).click();
  await expect(page.locator(".report-html-preview")).toContainText("[전화번호 가림]");
  await expect(page.locator(".report-html-preview")).not.toContainText("010-1234-5678");
  await page.getByRole("checkbox", { name: "내용·식별정보·선택한 사진을 확인했어요" }).check();
  const pdfEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF 다운로드", exact: true }).click();
  const pdfPath = resolve(artifacts, "integrated-report.pdf");
  await (await pdfEvent).saveAs(pdfPath);
  expect((await readFile(pdfPath)).subarray(0, 5).toString()).toBe("%PDF-");
  await expect(page.getByRole("button", { name: /HTML 다운로드|선택 원본 ZIP/ })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).include(".report-review").analyze()).violations).toEqual(
    [],
  );
  await page.screenshot({ path: resolve(artifacts, "integrated-review.png"), fullPage: true });
  await page.goto("/settings");
  const removeCase = page.locator(".sidebar-desktop .sidebar-story-delete");
  await removeCase.click();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(removeCase).toHaveCount(1);
  await removeCase.click();
  await page.getByRole("textbox", { name: "삭제하려면 DELETE를 입력해 주세요." }).fill("DELETE");
  await page.getByRole("dialog").getByRole("button", { name: "사건 삭제", exact: true }).click();
  await expect(page).toHaveURL("/app");
  await expect(removeCase).toHaveCount(0);
  await page.reload();
  await expect(removeCase).toHaveCount(0);
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
  await expect(page.locator(".sidebar-desktop .sidebar-story")).toHaveCount(0);
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
  await openReportEditor(peer);
  await expect(peer.getByRole("textbox", { name: "리포트 내용 편집" })).toBeVisible();
  const previousMarker = await page.evaluate(() => localStorage.getItem("baro-session-changed"));
  await page.goto("/settings");
  const deleteAccount = page.getByRole("button", { name: "계정과 모든 사건 삭제", exact: true });
  await expect(deleteAccount).toBeEnabled({ timeout: 5000 });
  await deleteAccount.click();
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

test("oversized mock source shows first-report recovery and preserves the full original text", async ({
  page,
}) => {
  await page.goto("/login");
  await page.evaluate(() => {
    const put = (name: string, value: unknown) =>
      localStorage.setItem(`baro-api-mock-v1:${name}`, JSON.stringify(value));
    put("session", {
      user: { id: "synthetic-overflow-owner", name: "Synthetic", accountType: "customer" },
      needsConsent: false,
    });
    put("caseOwners", { "synthetic-overflow-case": "synthetic-overflow-owner" });
    put("cases", {
      "synthetic-overflow-case": {
        id: "synthetic-overflow-case",
        title: "Synthetic overflow",
        subjectContext: "individual",
        stage: "active",
        revision: 1,
        updatedAt: "2026-10-01T00:00:00Z",
        summary: "Synthetic reviewed facts",
      },
    });
    put("files", {
      "synthetic-overflow-case": [
        {
          id: "synthetic-long-file",
          name: "긴 합성 자료.txt",
          mimeType: "text/plain",
          sizeBytes: 40000,
          status: "ready",
          coverage: "Synthetic extraction",
          extractedText: `${"a".repeat(29999)}😀TAIL`,
        },
      ],
    });
    put("reports", {});
  });
  await page.goto("/cases/synthetic-overflow-case/reports");
  await expect(
    page.getByRole("heading", { name: "자료를 줄여 첫 리포트를 만들어요" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "리포트 내용 편집" })).toBeHidden();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("baro-api-mock-v1:reports") ?? "{}")),
  ).toEqual({});
  await page.getByRole("checkbox", { name: "긴 합성 자료.txt · 리포트에서 제외" }).check();
  await page.getByRole("button", { name: "선택 자료를 제외하고 생성" }).click();
  await openReportEditor(page);
  const editor = page.getByRole("textbox", { name: "리포트 내용 편집" });
  await expect(editor).toBeVisible();
  await expect(editor).toContainText("연락과 전달");
  await page.reload();
  await openReportEditor(page);
  await expect(editor).toBeVisible();
  const saved = await page.evaluate(() => {
    const files = JSON.parse(localStorage.getItem("baro-api-mock-v1:files") ?? "{}");
    const reports = JSON.parse(localStorage.getItem("baro-api-mock-v1:reports") ?? "{}");
    return {
      text: files["synthetic-overflow-case"][0].extractedText as string,
      report: reports["synthetic-overflow-case"],
    };
  });
  expect(saved.text).toBe(`${"a".repeat(29999)}😀TAIL`);
  expect(saved.report.excludedFileIds).toEqual(["synthetic-long-file"]);
  expect(saved.report.content.isWellFormed()).toBe(true);
});

test("regeneration after focus refresh cannot replace an unseen peer report", async ({ page }) => {
  await page.goto("/login");
  await page.evaluate(() => {
    const put = (name: string, value: unknown) =>
      localStorage.setItem(`baro-api-mock-v1:${name}`, JSON.stringify(value));
    put("session", {
      user: { id: "synthetic-generation-owner", name: "Synthetic", accountType: "customer" },
      needsConsent: false,
    });
    put("caseOwners", { "synthetic-generation-case": "synthetic-generation-owner" });
    put("cases", {
      "synthetic-generation-case": {
        id: "synthetic-generation-case",
        title: "Synthetic generation",
        subjectContext: "individual",
        stage: "active",
        revision: 1,
        updatedAt: "2026-10-01T00:00:00Z",
        summary: "Synthetic reviewed facts",
      },
    });
    put("files", {});
    put("reports", {});
  });
  await page.goto("/cases/synthetic-generation-case/reports");
  await openReportEditor(page);
  const editor = page.getByRole("textbox", { name: "리포트 내용 편집" });
  await expect(editor).toBeVisible();
  const displayed = await editor.inputValue();
  const peer = await page.evaluate(() => {
    const key = "baro-api-mock-v1:reports",
      reports = JSON.parse(localStorage.getItem(key) ?? "{}");
    const report = reports["synthetic-generation-case"];
    report.id = "synthetic-peer-generation";
    report.revision++;
    report.content = "Synthetic unseen peer review";
    localStorage.setItem(key, JSON.stringify(reports));
    window.dispatchEvent(new Event("focus"));
    return { id: report.id, revision: report.revision, content: report.content };
  });
  await expect(
    page.getByRole("status").filter({ hasText: "다른 곳에서 새 버전을 만든 경우" }),
  ).toBeVisible();
  await expect(editor).toHaveValue(displayed);
  await page.getByRole("button", { name: "새 버전 만들기" }).click();
  await page.getByRole("button", { name: "새 버전 생성", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(editor).toHaveValue(displayed);
  const current = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("baro-api-mock-v1:reports") ?? "{}")[
        "synthetic-generation-case"
      ],
  );
  expect(current).toMatchObject(peer);
});
