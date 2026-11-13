import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { openReportEditor } from "../helpers/report-controls";

test("ReportReview uses signed real SQL routes and saves a Korean font PDF from the reviewed HTML document", async ({
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
    await openReportEditor(page);
    const editor = page.getByRole("textbox", { name: /^(?:내 사건 한눈에|사건 개요) 수정$/ });
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
        "실제 다운로드 한글 검토 · [전화번호 직접 삭제] · [이메일 직접 삭제]",
        "자료와 사실은 합성 입력입니다.",
        "주요 사실과 자료",
        ...paragraphs,
        longParagraph,
        "추가 확인 사항",
        "대화 기록.pdf · 4쪽 중 3쪽 처리 · 확인 필요: 4쪽 품질 낮음",
        "통화 기록.wav · 2.25–8.75초 · 사용자 교정 · 미확인",
        "12.5–19.25초 누락 · 해당 구간은 원본 확인 필요",
        "상담에서 확인할 내용",
        "합성 마지막 문장 · 모든 내용과 출처를 확인한 뒤 사용자가 직접 전달합니다.",
      ].join("\n"),
    );
    await page.getByRole("button", { name: "수정 내용 저장", exact: true }).click();
    await expect(page.locator(".report-edit-toggle")).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: /HTML 다운로드|선택 원본 ZIP/ })).toHaveCount(0);
    // Compare the saved HTML endpoint with the file received through the owner-checked UI.
    const savedReport = (await (
      await page.request.get(`${seed.origin}/api/v2/cases/${seed.caseId}/reports`)
    ).json()) as { id: string };
    const htmlText = await (
      await page.request.get(`${seed.origin}/api/v2/reports/${savedReport.id}/html`)
    ).text();
    expect(htmlText).toContain('data-baro-report="1"');
    expect(htmlText).toContain("[전화번호 직접 삭제]");
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
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    const out = process.env.BARO_REPORT_EVIDENCE_DIR ?? testInfo.outputPath("synthetic-downloads");
    await mkdir(out, { recursive: true });
    await pdf.saveAs(resolve(out, "real-korean-report.pdf"));
    await writeFile(resolve(out, "real-korean-report.html"), htmlText);
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

    await expect(
      printPage.getByRole("heading", { name: "주요 사실과 자료", exact: true }),
    ).toBeVisible();
    const previewDocument = printPage.locator(".baro-report");
    const expectedLines = [
      "실제 다운로드 한글 검토 · [전화번호 직접 삭제] · [이메일 직접 삭제]",
      "자료와 사실은 합성 입력입니다.",
      ...paragraphs,
      longParagraph,
      "대화 기록.pdf · 4쪽 중 3쪽 처리 · 확인 필요: 4쪽 품질 낮음",
      "통화 기록.wav · 2.25–8.75초 · 사용자 교정 · 미확인",
      "12.5–19.25초 누락 · 해당 구간은 원본 확인 필요",
      "합성 마지막 문장 · 모든 내용과 출처를 확인한 뒤 사용자가 직접 전달합니다.",
    ];
    const actualLines = await printPage.locator(".section .lines p").allTextContents();
    for (const line of expectedLines) expect(actualLines).toContain(line);
    const extracted: { printed: string[]; downloaded: string[] } = JSON.parse(
      execFileSync(
        process.platform === "win32" ? "python" : "python3",
        [
          "-c",
          [
            "import json,sys",
            "from pypdf import PdfReader",
            "def body_pages(path, bottom, top=None):",
            "    result=[]",
            "    for page in PdfReader(path).pages:",
            "        fragments=[]",
            "        def collect(text, cm, tm, font, size):",
            "            y=tm[4]*cm[1]+tm[5]*cm[3]+cm[5]",
            "            if bottom <= y and (top is None or y <= top):",
            "                fragments.append(text)",
            "        page.extract_text(visitor_text=collect)",
            "        result.append(''.join(fragments))",
            "    return result",
            // The HTML @page bottom margin is 20mm; the native PDF body is
            // between its y=82 lower bound and y=776 header rule. Never delete
            // matching words/numbers from the report body to remove furniture.
            "print(json.dumps({'printed':body_pages(sys.argv[1],20*72/25.4), 'downloaded':body_pages(sys.argv[2],82,776)}))",
          ].join("\n"),
          resolve(out, "real-html-printed.pdf"),
          resolve(out, "real-korean-report.pdf"),
        ],
        { encoding: "utf8" },
      ),
    );
    const printedPages = extracted.printed;
    for (const pages of [printedPages, extracted.downloaded]) {
      expect(pages.length).toBeGreaterThan(2);
      expect(pages.every((text) => text.trim().length > 0)).toBe(true);
    }
    const compact = (text: string) => text.replace(/\s/g, "");
    // Chromium's embedded font maps the visible en dash between time-span
    // digits to U+00AD. Normalize only that extraction alias, without removing
    // characters or changing the HTML/source assertions or native PDF text.
    const printedText = compact(printedPages.join("\n")).replace(/(?<=\d)\u00ad(?=\d)/g, "–");
    const downloadedText = compact(extracted.downloaded.join("\n"));
    for (const line of expectedLines) expect(downloadedText).toContain(compact(line));
    for (const line of [
      ...expectedLines,
      ...(await previewDocument.locator(".section h2").allTextContents()),
    ]) {
      expect(printedText).toContain(compact(line));
    }
    expect(printedText).not.toContain("010-1234-5678");
    expect(printedText).not.toContain("synthetic@example.test");
    expect(downloadedText).not.toContain("010-1234-5678");
    expect(downloadedText).not.toContain("synthetic@example.test");
    expect(await printPage.locator("script").count()).toBe(0);
    await printPage.close();
  } finally {
    server.stdin?.end();
    server.kill();
  }
});
