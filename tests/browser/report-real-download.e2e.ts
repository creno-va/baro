import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
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
    await editor.fill(
      "사건 요약\n실제 다운로드 한글 검토 · 010-1234-5678 · synthetic@example.test\n자료와 사실은 합성 입력입니다.",
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
        "python3",
        [
          "-c",
          "import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps([(i.filename,z.read(i).decode('utf-8')) for i in z.infolist()],ensure_ascii=False))",
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
  } finally {
    server.stdin?.end();
    server.kill();
  }
});
