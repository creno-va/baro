import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { openReportOptions } from "../helpers/report-controls";

test("ReportReview uses signed real SQL routes and downloads a Korean font PDF and exact selected original ZIP", async ({
  page,
  context,
}, testInfo) => {
  const server: ChildProcess = spawn("bun", ["tests/helpers/report-real-server.ts"], {
    env: { ...process.env, BARO_SYNTHETIC_REPORT_SERVER: "true" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  try {
    const seed = await new Promise<{
      origin: string;
      caseId: string;
      original: string;
      cookie: {
        name: string;
        value: string;
        url: string;
        httpOnly: boolean;
        secure: boolean;
        sameSite: "Lax";
      };
    }>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Synthetic SQL report server startup failed")),
        15000,
      );
      let output = "";
      server.stdout?.on("data", (chunk) => {
        output += String(chunk);
        if (output.includes("\n")) {
          clearTimeout(timer);
          resolve(JSON.parse(output.slice(0, output.indexOf("\n"))));
        }
      });
      server.once("error", () => {
        clearTimeout(timer);
        reject(new Error("Synthetic SQL report startup failed"));
      });
      server.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("Synthetic SQL report server exited"));
      });
    });
    await context.addCookies([seed.cookie]);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${seed.origin}/cases/${seed.caseId}/reports`);
    const editor = page.getByRole("textbox", { name: "리포트 내용 편집" });
    await expect(editor).toBeVisible();
    const paragraphs = Array.from(
      { length: 80 },
      (_, index) =>
        `합성 검증 문단 ${String(index + 1).padStart(3, "0")} · 입금 자료와 대화 기록의 확인 범위를 정리합니다. 사용자 진술과 자료 관찰을 구분하며 상대방의 입장은 원본을 확인할 때까지 미확인으로 남깁니다.`,
    );
    const longParagraph = "하나의 긴 문단도 다음 페이지까지 이어져야 합니다. ".repeat(90);
    await editor.fill(
      [
        "사건 요약",
        "실제 다운로드 한글 검토 · 010-1234-5678 · synthetic@example.test",
        "자료와 사실은 합성 입력입니다.",
        "사실·주장·출처",
        ...paragraphs,
        longParagraph,
        "자료 처리 범위",
        "대화 기록.pdf · 4쪽 중 3쪽 처리 · 확인 필요: 4쪽 품질 낮음",
        "통화 기록.wav · 2.25–8.75초 · 사용자 교정 · 미확인",
        "12.5–19.25초 누락 · 해당 구간은 원본 확인 필요",
        "출처: 대화 기록.pdf · 2쪽 · 3번째 문단 · 합성 마지막 출처",
        "안내",
        "합성 마지막 문장 · 모든 내용과 출처를 확인한 뒤 사용자가 직접 전달합니다.",
      ].join("\n"),
    );
    await openReportOptions(page);
    await page.getByRole("checkbox", { name: "전화번호·이메일·주민등록번호 가리기" }).check();
    await page.getByRole("button", { name: "검토 내용 저장" }).click();
    await expect(page.getByRole("status")).toContainText("저장했어요");
    await page.getByRole("button", { name: "전달 내용 미리보기" }).click();
    const previewDocument = page.locator(".report-html-preview");
    await expect(previewDocument.getByAltText("바로 로고")).toBeVisible();
    await expect(
      previewDocument.getByRole("heading", { name: "사건 요약", exact: true }),
    ).toBeVisible();
    await expect(previewDocument).toContainText("[전화번호 가림]");
    await expect(previewDocument).not.toContainText("010-1234-5678");
    await page
      .locator(".report-material")
      .filter({ hasText: `${Buffer.byteLength(seed.original)}바이트` })
      .getByRole("checkbox", { name: "ZIP에 원본 포함" })
      .check();
    await page.getByRole("checkbox", { name: "내용·식별정보·선택한 원본을 확인했어요" }).check();
    const htmlEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "HTML 다운로드", exact: true }).click();
    const html = await htmlEvent;
    const htmlText = await readFile((await html.path()) as string, "utf8");
    expect(htmlText).toContain('data-baro-report="1"');
    expect(htmlText).toContain("[전화번호 가림]");
    expect(htmlText).not.toContain("010-1234-5678");
    const pdfEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "PDF 다운로드" }).click();
    const pdf = await pdfEvent;
    const pdfPath = await pdf.path();
    expect(pdfPath).toBeTruthy();
    const bytes = await readFile(pdfPath as string);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.toString()).toContain("/FontFile2");
    expect(bytes.toString()).toContain("/ToUnicode");
    const zipEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: /선택 원본 ZIP/ }).click();
    const zip = await zipEvent;
    const zipPath = await zip.path();
    const parsed = JSON.parse(
      execFileSync(
        process.platform === "win32" ? "python" : "python3",
        [
          "-c",
          "import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps([(i.filename,z.read(i).decode('utf-8')) for i in z.infolist()]))",
          zipPath as string,
        ],
        { encoding: "utf8" },
      ),
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0][0]).toBe("합성💙 자료.txt");
    expect(parsed[0][1]).toBe(seed.original);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    const out = process.env.BARO_REPORT_EVIDENCE_DIR ?? testInfo.outputPath("synthetic-downloads");
    await mkdir(out, { recursive: true });
    await pdf.saveAs(resolve(out, "real-korean-report.pdf"));
    await html.saveAs(resolve(out, "real-korean-report.html"));
    await zip.saveAs(resolve(out, "real-selected-originals.zip"));
    await page.screenshot({ path: resolve(out, "real-report-mobile.png"), fullPage: true });
    // Print the actual downloaded file, rather than a second synthetic template.
    const printPage = await context.newPage();
    await printPage.goto(pathToFileURL(resolve(out, "real-korean-report.html")).href);
    await printPage.emulateMedia({ media: "print" });
    await printPage.evaluate(() => document.fonts.ready);
    const printed = await printPage.pdf({
      path: resolve(out, "real-html-printed.pdf"),
      preferCSSPageSize: true,
      printBackground: true,
    });
    expect(printed.subarray(0, 5).toString()).toBe("%PDF-");

    await expect(printPage.getByRole("heading", { name: "생성 기준", exact: true })).toBeVisible();
    await expect(printPage.locator(".meta")).toHaveText(
      (await previewDocument.locator(".meta").textContent()) ?? "",
    );
    const expectedLines = [
      "실제 다운로드 한글 검토 · [전화번호 가림] · [이메일 가림]",
      "자료와 사실은 합성 입력입니다.",
      ...paragraphs,
      longParagraph,
      "대화 기록.pdf · 4쪽 중 3쪽 처리 · 확인 필요: 4쪽 품질 낮음",
      "통화 기록.wav · 2.25–8.75초 · 사용자 교정 · 미확인",
      "12.5–19.25초 누락 · 해당 구간은 원본 확인 필요",
      "출처: 대화 기록.pdf · 2쪽 · 3번째 문단 · 합성 마지막 출처",
      "합성 마지막 문장 · 모든 내용과 출처를 확인한 뒤 사용자가 직접 전달합니다.",
    ];
    await expect(printPage.locator(".content .lines p")).toHaveText(expectedLines);
    const printedPages: string[] = JSON.parse(
      execFileSync(
        process.platform === "win32" ? "python" : "python3",
        [
          "-c",
          "import json,sys; from pypdf import PdfReader; print(json.dumps([page.extract_text() for page in PdfReader(sys.argv[1]).pages]))",
          resolve(out, "real-html-printed.pdf"),
        ],
        { encoding: "utf8" },
      ),
    );
    expect(printedPages.length).toBeGreaterThan(2);
    expect(printedPages.every((text) => text.trim().length > 0)).toBe(true);
    const compact = (text: string) => text.replace(/\s/g, "");
    const printedText = compact(printedPages.join("\n"));
    for (const line of [
      ...expectedLines,
      "생성 기준",
      ...(await previewDocument.locator(".meta div").allTextContents()),
      "내용과 출처, 미확인 사항을 원본과 비교해 주세요.",
      "교정한 내용과 AI의 정리는 원본의 진정성이나 법적 효력을 증명하지 않습니다.",
      "법률 판단과 사건의 결과를 보장하지 않습니다.",
    ]) {
      expect(printedText).toContain(compact(line));
    }
    expect(printedText).not.toContain("010-1234-5678");
    expect(printedText).not.toContain("synthetic@example.test");
    expect(await printPage.locator("script").count()).toBe(0);
    await printPage.close();
  } finally {
    server.stdin?.end();
    server.kill();
  }
});
