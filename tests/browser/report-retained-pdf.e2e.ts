import { type ChildProcess, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { openReportEditor } from "../helpers/report-controls";

test("stored real PDF and report remain readable after source change/re-consent, while mutations and deleted material are fenced", async ({
  page,
  context,
}, testInfo) => {
  const server: ChildProcess = spawn("bun", ["tests/helpers/report-real-server.ts"], {
    env: {
      ...process.env,
      BARO_SYNTHETIC_REPORT_SERVER: "true",
      BARO_REPORT_RECONSENT_TEST: "true",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  try {
    const seed = await new Promise<{
      origin: string;
      caseId: string;
      selectedFileId: string;
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
        () => reject(new Error("Synthetic SQL fixture startup timed out")),
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
        reject(new Error("Synthetic server unavailable"));
      });
      server.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("Synthetic server exited"));
      });
    });
    await context.addCookies([seed.cookie]);
    await page.goto(`${seed.origin}/cases/${seed.caseId}/reports`);
    await openReportEditor(page);
    const report = await (
      await page.request.get(`${seed.origin}/api/v2/cases/${seed.caseId}/reports`)
    ).json();
    await expect(page.locator("html")).toHaveAttribute(
      "data-report-viewed",
      JSON.stringify({ id: report.id, revision: report.revision }),
    );
    const editor = page.getByRole("textbox", { name: / 수정$/ }).first();
    await expect(editor).toBeVisible();
    const originalText = await editor.inputValue();
    // A passive metadata refresh must not certify a new body that the reader
    // has never accepted. The open editor still holds the original version.
    const reportPath = `${seed.origin}/api/v2/cases/${seed.caseId}/reports`;
    let metadataReads = 0;
    await page.route(reportPath, (route) => {
      metadataReads++;
      return route.fulfill({
        json: { ...report, revision: report.revision + 1, content: "아직 열지 않은 새 본문" },
      });
    });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => metadataReads).toBeGreaterThan(0);
    await expect(editor).toHaveValue(originalText);
    await expect(page.locator(".report-edit-toggle")).toBeEnabled();
    await expect(page.locator("html")).toHaveAttribute(
      "data-report-viewed",
      JSON.stringify({ id: report.id, revision: report.revision }),
    );
    await page.unroute(reportPath);
    await page.reload();
    await openReportEditor(page);
    await page.getByRole("button", { name: "수정 마치기", exact: true }).click();
    const firstEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "PDF 다운로드", exact: true }).click();
    const first = await firstEvent,
      firstPath = await first.path();
    const firstBytes = await readFile(firstPath as string);
    expect(firstBytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await page.request.post(`${seed.origin}/synthetic/change-and-revoke`)).status()).toBe(
      200,
    );
    await page.reload();
    await expect(page.getByRole("region", { name: "리포트 검토 본문" })).toContainText(
      originalText,
    );
    await expect(page.locator("html")).not.toHaveAttribute("data-report-viewed");
    await expect(page.locator(".report-edit-toggle")).toHaveAccessibleName("수정하기");
    await expect(page.locator(".report-edit-toggle")).toBeDisabled();
    await expect(page.getByText(/새 리포트 생성과 수정은 필수 동의 후/)).toBeVisible();
    await expect(page.getByRole("button", { name: "새 버전 만들기" })).toBeDisabled();
    await expect(page.getByRole("checkbox", { name: "식별정보 가리기", exact: true })).toHaveCount(
      0,
    );
    const secondEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "PDF 다운로드", exact: true }).click();
    const second = await secondEvent,
      secondPath = await second.path();
    expect(await readFile(secondPath as string)).toEqual(firstBytes);
    await expect(page.getByRole("button", { name: /HTML 다운로드|선택 원본 ZIP/ })).toHaveCount(0);
    await page.setViewportSize({ width: 375, height: 812 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("retained-pdf-mobile.png"), fullPage: true });
    const base = `${seed.origin}/api/v2/cases/${seed.caseId}/files/${seed.selectedFileId}`;
    const metadata = (await (await page.request.get(`${base}/review`)).json()) as {
      workspaceRevision: number;
      file: { revision: number };
    };
    const deleted = await page.request.delete(base, {
      headers: { origin: seed.origin },
      data: { expectedRevision: metadata.workspaceRevision, fileRevision: metadata.file.revision },
    });
    expect(deleted.status()).toBe(202);
    expect((await page.request.get(`${base}/review`)).status()).toBe(404);
    await page.reload();
    await expect(editor).not.toBeVisible();
    await expect(page.getByRole("button", { name: /저장된 선택 원본 ZIP/ })).not.toBeVisible();
    await expect(page.getByRole("button", { name: "PDF 다운로드", exact: true })).not.toBeVisible();
    await expect(page.locator("html")).not.toHaveAttribute("data-report-viewed");
  } finally {
    server.stdin?.end();
    server.kill();
  }
});
