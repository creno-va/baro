import { expect, test } from "@playwright/test";
import { chooseOption, selectControl } from "../helpers/headless-controls";
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
      "사건 개요\n약속한 기한이 지나도 빌려준 돈을 돌려받지 못했습니다.\n\n당사자와 관계\n- 의뢰인 · 대여자\n- 지인 · 차용자\n\n주요 경위\n- 2026.03.12 · 송금\n- 2026.06.30 · 약속한 반환일\n\n주요 사실\n- 이용자 진술 · 반환 약속이 있었습니다.\n- 자료 기재 · 이체 금액 300만원 (증거 1 · 이미지 관찰)\n\n증거 자료\n### 증거 1 · 합성 송금 확인서.jpg\n- 자료 기재 · 이체 금액 300만원\n\n추가 확인 사항\n- 일부 변제 여부\n- 상대방 입장",
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
    if (
      path.endsWith("/photos/synthetic-inline-photo") ||
      path.endsWith("/files/synthetic-inline-photo/content")
    )
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
  const section = page
    .locator(".report-reading-section")
    .filter({ has: page.getByRole("heading", { name: "증거 자료", exact: true }) });
  const field = section.getByRole("textbox");
  await expect(page.locator(".report-format-toolbar")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "굵게", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "불릿 목록", exact: true })).toHaveCount(0);
  const checkPhotoInput = async () => {
    const text = await field.boundingBox();
    const select = await selectControl(section).boundingBox();
    const insert = await section.getByRole("button", { name: "사진 넣기" }).boundingBox();
    if (!text || !select || !insert) throw new Error("Missing synthetic report controls");
    expect(select.x).toBe(text.x);
    expect(select.y - text.y - text.height).toBe(12);
    expect(select.height).toBe(insert.height);
  };
  await checkPhotoInput();
  await field.fill(
    "### 증거 1 · 합성 송금 확인서.jpg\n- **송금 확인**\n\n사진 뒤에 이어질 내용\n\n### 증거 2 · 합성 녹취.wav\n- 12.5–19.25초 · 확인 필요 · 반환일 언급\n\n### 증거 3 · 합성 영상.mp4\n- 24초 · 프레임 48 · 장면 전환 표본 · 자료 기재 · 서류 전달 장면",
  );
  await field.evaluate((input: HTMLTextAreaElement) => {
    const position = input.value.indexOf("사진 뒤에");
    input.setSelectionRange(position, position);
  });
  await chooseOption(selectControl(section), "synthetic-inline-photo");
  await section.getByRole("button", { name: "사진 넣기" }).click();
  await expect(field).toHaveValue(/baro-photo:synthetic-inline-photo/);
  const edited = await field.inputValue();
  expect(edited.indexOf("baro-photo:")).toBeLessThan(edited.indexOf("사진 뒤에"));
  expect(await field.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(
    "rgb(243, 245, 248)",
  );
  await page.getByRole("button", { name: "수정 내용 저장", exact: true }).click();
  await expect(section.locator("strong")).toHaveText("송금 확인");
  await expect(section.getByRole("heading", { level: 4 })).toHaveCount(3);
  await expect(section).toContainText("12.5–19.25초");
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
    await checkPhotoInput();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `.wrangler/report-inline-editor-${width}.png`, fullPage: true });
    await expect(page.getByRole("button", { name: "수정 내용 저장", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "편집 취소", exact: true }).click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileOutline = page.getByRole("navigation", { name: "리포트 목차", exact: true });
  if ((await page.locator(".report-outline-toggle").getAttribute("aria-expanded")) === "false")
    await page.locator(".report-outline-toggle").click();
  const mobileNavBox = await mobileOutline.boundingBox();
  expect(mobileNavBox && mobileNavBox.height <= 844 * 0.45 + 1).toBe(true);
  const mobileLink = mobileOutline.getByRole("link", { name: "증거 자료", exact: true });
  const target = page.locator((await mobileLink.getAttribute("href")) as string);
  await mobileLink.click();
  await expect(mobileOutline).toBeHidden();
  await expect(target).toBeFocused();
  await expect(target).toBeInViewport();
  await page.getByText("현재 사건에서 더 준비하기", { exact: true }).click();
  await expect(page.getByRole("link", { name: "현재 할 일 관리", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  const outline = page.getByRole("navigation", { name: "리포트 목차", exact: true });
  const outlineToggle = page.locator(".report-outline-toggle");
  if ((await outlineToggle.getAttribute("aria-expanded")) === "true") await outlineToggle.click();
  await expect(outline).toBeHidden();
  await outlineToggle.click();
  await expect(outline).toBeVisible();
  await outline.getByRole("link", { name: "증거 자료", exact: true }).click();
  await expect(image).toBeVisible();
  await openReportEditor(page);
  const overview = page.getByRole("textbox", { name: "사건 개요 수정", exact: true });
  const originalOverview = await overview.inputValue();
  await overview.fill(`${originalOverview}\n취소할 합성 편집`);
  await page.getByRole("button", { name: "편집 취소", exact: true }).click();
  await page
    .getByRole("dialog", { name: "편집을 취소할까요?", exact: true })
    .getByRole("button", { name: "계속 편집", exact: true })
    .click();
  await expect(overview).toHaveValue(/취소할 합성 편집/);
  await page.getByRole("button", { name: "편집 취소", exact: true }).click();
  await page
    .getByRole("dialog", { name: "편집을 취소할까요?", exact: true })
    .getByRole("button", { name: "저장본으로 돌아가기", exact: true })
    .click();
  await expect(page.locator(".report-edit-toggle")).toHaveAttribute("aria-expanded", "false");
  expect(saveCount).toBe(1);
  await openReportEditor(page);
  await expect(overview).toHaveValue(originalOverview);
  await overview.fill(`${originalOverview}\n명시 저장한 합성 설명`);
  await page.getByRole("button", { name: "수정 내용 저장", exact: true }).click();
  await expect(page.locator(".report-edit-toggle")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".report-reading")).toContainText("명시 저장한 합성 설명");
  expect(saveCount).toBe(2);
  for (const [name, path] of [
    ["자료와 원본 확인", "/files"],
    ["현재 할 일 관리", "/actions"],
    ["현재 경위 정리", "/timeline"],
    ["현재 판례 탐색", "/precedents"],
    ["대화로 돌아가기", ""],
  ] as const)
    await expect(page.getByRole("link", { name, exact: true })).toHaveAttribute(
      "href",
      `/cases/synthetic-inline-case${path}`,
    );
});
