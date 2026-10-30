import { expect, test } from "@playwright/test";
import { openReportEditor } from "../helpers/report-controls";

test("report edits Markdown and photos inline, saves placement and uses one equal-width document on desktop/mobile", async ({
  page,
}) => {
  let report = {
    id: "synthetic-inline-report",
    caseId: "synthetic-inline-case",
    revision: 1,
    title: "대여금 반환 상담 리포트",
    updatedAt: "2026-10-31T00:00:00Z",
    stale: false,
    content:
      "사건 개요\n약속한 기한이 지나도 빌려준 돈을 돌려받지 못했습니다.\n\n당사자와 관계\n- 의뢰인 · 대여자\n- 지인 · 차용자\n\n주요 경위\n- 2026.03.12 · 송금\n- 2026.06.30 · 약속한 반환일\n\n주요 사실과 자료\n- 이용자 진술 · 반환 약속이 있었습니다.\n- 자료 기재 · 이체 금액 300만원\n\n추가 확인 사항\n- 일부 변제 여부\n- 상대방 입장",
    excludedFileIds: [],
    maskIdentifiers: false,
    includedPhotoIds: [] as string[],
    photoCandidates: [{ id: "synthetic-inline-photo", name: "합성 송금 확인서.jpg", revision: 2 }],
  };
  let saveCount = 0;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/me/session")
      return route.fulfill({
        json: {
          user: { id: "synthetic-owner", name: "합성", accountType: "customer" },
          needsConsent: false,
        },
      });
    if (path.endsWith("/photos/synthetic-inline-photo"))
      return route.fulfill({
        path: "tests/fixtures/media/image-markers.jpg",
        contentType: "image/jpeg",
      });
    if (path.endsWith("/reports")) {
      if (route.request().method() === "PATCH") {
        saveCount++;
        report = { ...report, ...route.request().postDataJSON(), revision: report.revision + 1 };
      }
      return route.fulfill({ json: report });
    }
    if (path.endsWith("/files"))
      return route.fulfill({
        json: [
          {
            id: "synthetic-inline-photo",
            name: "合成 송금 확인서.jpg",
            mimeType: "image/jpeg",
            sizeBytes: 1024,
            status: "ready",
            coverage: "전체",
            extractedText: "합성",
          },
        ],
      });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("/cases/synthetic-inline-case/reports");
  await expect(page.getByRole("heading", { name: "사건 개요", exact: true })).toBeVisible();
  await expect(page.locator(".report-output-options,.report-export-notice")).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "식별정보 가리기" })).toHaveCount(0);
  await openReportEditor(page);
  const section = page.locator(".report-reading-section").first();
  const field = section.getByRole("textbox");
  await field.fill("- **송금 확인**\n\n사진 뒤에 이어질 내용");
  await field.evaluate((input: HTMLTextAreaElement) => {
    const position = input.value.indexOf("사진 뒤에");
    input.setSelectionRange(position, position);
  });
  await section.getByRole("combobox").selectOption("synthetic-inline-photo");
  await section.getByRole("button", { name: "사진 넣기" }).click();
  await expect(field).toHaveValue(/baro-photo:synthetic-inline-photo/);
  const edited = await field.inputValue();
  expect(edited.indexOf("baro-photo:")).toBeLessThan(edited.indexOf("사진 뒤에"));
  expect(await field.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(
    "rgb(243, 245, 248)",
  );
  await page.getByRole("button", { name: "수정 마치기", exact: true }).click();
  await expect(section.locator("strong")).toHaveText("송금 확인");
  const image = section.locator("figure img");
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
    .toBeGreaterThan(0);
  expect(saveCount).toBe(1);
  expect(report.includedPhotoIds).toEqual(["synthetic-inline-photo"]);
  await page.reload();
  await expect(page.locator(".report-inline-photo img")).toBeVisible();
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    const widths = await page
      .locator(".report-reading-section")
      .evaluateAll((sections) => sections.map((node) => node.getBoundingClientRect().width));
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `.wrangler/report-inline-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "새 버전 만들기", exact: true }).click();
    const modal = page.getByRole("dialog");
    await expect(modal.getByRole("heading")).toHaveText("새 버전을 만들까요?");
    const generate = await modal.getByRole("button", { name: "새 버전 생성" }).boundingBox();
    const cancel = await modal.getByRole("button", { name: "취소" }).boundingBox();
    expect(generate && cancel && generate.x + generate.width <= cancel.x).toBe(true);
    expect(
      await modal
        .getByRole("button", { name: "새 버전 생성" })
        .evaluate((node) => getComputedStyle(node).backgroundColor),
    ).not.toBe("rgb(255, 255, 255)");
    await page.screenshot({ path: `.wrangler/report-inline-modal-${width}.png` });
    await modal.getByRole("button", { name: "취소" }).click();
    await openReportEditor(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `.wrangler/report-inline-editor-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "수정 마치기", exact: true }).click();
  }
});
