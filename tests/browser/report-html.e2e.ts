import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createReportHtml } from "../../src/components/reports/document";

test("HTML document stays readable on desktop/mobile and print with inert untrusted text", async ({
  page,
}) => {
  const content = `사건 요약
합성 사례 · 대여금 반환을 위한 상담 준비
2026년 3월 지인에게 300만원을 빌려주었다는 사용자 진술을 중심으로, 입금 자료와 대화 기록의 확인 범위를 정리했습니다.

당사자
신청인 · 돈을 빌려주었다고 진술한 사람
상대방 · 변제 여부를 확인할 사람

사실·주장·출처
사용자는 300만원을 이체했다고 진술했습니다.
[사용자 진술 · 진술됨 · 입력 버전 2]
대화 기록에는 변제일로 2026년 6월 30일이 기재되어 있습니다.
[자료 관찰 · 미확인 · 대화 기록.pdf · 2쪽 · 3번째 문단]

미확인 사항
실제 변제 여부와 상대방의 입장은 확인되지 않았습니다.
이체 자료와 대화 상대가 같은 사람인지 원본을 통해 확인해야 합니다.

타임라인
2026.03.12 · 300만원 이체를 했다는 사용자 진술
2026.06.30 · 대화에 기재된 변제 예정일
날짜 미확인 · 사용자에 따르면 이후 연락을 시도함

준비할 행동
원본 자료 정리 (todo)
이체 내역과 전체 대화 기록을 날짜순으로 보관하세요.
주의: 일부 대화만으로 전체 맥락을 단정하지 마세요.
상담에서 확인할 질문 (todo)
현재 자료로 확인할 수 있는 사실과 추가로 필요한 자료를 변호사와 검토하세요.

자료 처리 범위
대화 기록.pdf · 4쪽 중 3쪽 처리 · 확인 필요: 4쪽 품질 낮음
통화 기록.wav · 2.25–8.75초 · 사용자 교정 · 미확인
사용자가 교정한 문장입니다. 원래 전사와 구분해 보관합니다.
12.5–19.25초 누락 · 해당 구간은 원본 확인 필요

안내
이 문서는 제품 디자인 검증을 위한 합성 사례입니다.
연락처 010-1234-5678 · synthetic@example.test
입력한 <script>실행되지 않는 내용</script>도 일반 문장으로 표시합니다.`;
  const html = createReportHtml({
    title: "대여금 반환 상담 준비",
    content,
    revision: 3,
    updatedAt: "2026-10-09T03:20:00.000Z",
    stale: true,
    maskIdentifiers: true,
    excludedFileIds: ["excluded"],
    basis: { workspaceRevision: 18, summaryRevision: 2, generatedAt: "2026-10-09T03:20:00.000Z" },
  });
  const out = resolve(".wrangler/html-report-evidence");
  await mkdir(out, { recursive: true });
  await writeFile(resolve(out, "report-design.html"), html);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.setContent(html);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("대여금 반환 상담 준비");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await expect(page.getByAltText("바로 로고")).toBeVisible();
  expect(
    await page
      .getByAltText("바로 로고")
      .evaluate((image) => (image as HTMLImageElement).naturalWidth),
  ).toBeGreaterThan(0);
  expect(await page.locator("script").count()).toBe(0);
  await page.screenshot({ path: resolve(out, "desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: resolve(out, "mobile.png"), fullPage: true });
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("heading", { name: "생성 기준", exact: true })).toBeVisible();
  await expect(page.locator(".meta")).toContainText("2 · 18");
  await expect(page.locator(".meta")).toContainText("리포트 제외 자료");
  await expect(page.locator(".meta")).toContainText("1개");
  await expect(page.locator(".stale")).toBeVisible();
  await expect(page.getByRole("heading", { name: "자료 처리 범위", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
