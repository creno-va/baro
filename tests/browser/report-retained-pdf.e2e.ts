import { type ChildProcess, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { openReportOptions } from "../helpers/report-controls";

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
    const editor = page.getByRole("textbox", { name: "리포트 내용 편집" });
    await expect(editor).toBeVisible();
    await expect(page.getByText(/생성 기준: 요약 1/)).toBeVisible();
    const originalText = await editor.inputValue();
    const reviewed = page.getByRole("checkbox", { name: "내용·식별정보·선택한 원본을 확인했어요" });
    await reviewed.check();
    await openReportOptions(page);
    await page
      .locator(".report-material")
      .filter({ hasText: `${Buffer.byteLength(seed.original)}바이트` })
      .getByRole("checkbox", { name: "ZIP에 원본 포함" })
      .check();
    await reviewed.check();
    const zipEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: /^선택 원본 ZIP/ }).click();
    const firstZip = await zipEvent,
      firstZipBytes = await readFile((await firstZip.path()) as string);
    await expect(page.getByRole("button", { name: /저장된 선택 원본 ZIP/ })).toBeVisible();
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
    await expect(editor).toHaveValue(originalText);
    await expect(editor).toBeDisabled();
    await expect(page.getByText(/새 리포트 생성과 수정은 필수 동의 후/)).toBeVisible();
    await expect(page.getByText(/이 리포트는 위 생성 기준의 내용/)).toBeVisible();
    await expect(page.getByRole("button", { name: "새 버전 만들기" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "검토 내용 저장" })).toBeDisabled();
    await reviewed.check();
    const secondEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "PDF 다운로드", exact: true }).click();
    const second = await secondEvent,
      secondPath = await second.path();
    expect(await readFile(secondPath as string)).toEqual(firstBytes);
    await expect(page.getByRole("button", { name: /^선택 원본 ZIP/ })).toBeDisabled();
    const storedZip = page.getByRole("button", { name: /저장된 선택 원본 ZIP/ });
    await expect(storedZip).toBeEnabled();
    const retainedZipEvent = page.waitForEvent("download");
    await storedZip.click();
    const retainedZip = await retainedZipEvent;
    expect(await readFile((await retainedZip.path()) as string)).toEqual(firstZipBytes);
    await page.setViewportSize({ width: 375, height: 812 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("retained-zip-mobile.png"), fullPage: true });
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
  } finally {
    server.stdin?.end();
    server.kill();
  }
});
