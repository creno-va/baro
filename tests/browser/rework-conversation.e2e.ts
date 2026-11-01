import { expect, type Page, test } from "@playwright/test";
import { openReworkBrowserFixture } from "../helpers/rework-browser-proxy";

// Enabled only when the central real runtime composition has passed CI/main.
// This suite forwards HTTP; it never fulfills a fabricated analysis/report DTO.
test.skip(
  process.env.BARO_REWORK_BROWSER_INTEGRATED !== "true",
  "Central runtime composition required",
);

async function openAction(page: Page, name: string) {
  const group = page.getByRole("group", { name: "대화에서 이어갈 작업", exact: true });
  const button = group.getByRole("button", { name, exact: true });
  if (!(await button.isVisible())) await group.getByText("다른 작업", { exact: true }).click();
  await button.click();
}

test("an actual action ACK lost after commit replays the identical input and idempotency key", async ({
  page,
  context,
}, testInfo) => {
  let dropped = false;
  const f = await openReworkBrowserFixture(
    context,
    new URL(String(testInfo.project.use.baseURL)).origin,
    "prepare_claim",
    {
      dropResponse: (request, response) => {
        if (
          !dropped &&
          request.method() === "POST" &&
          new URL(request.url()).pathname.endsWith("/rework/actions") &&
          response.ok()
        ) {
          dropped = true;
          return true;
        }
        return false;
      },
    },
  );
  try {
    await page.goto(`/cases/${encodeURIComponent(f.info.caseId)}`);
    await openAction(page, "법률·판례와 현재 약점 확인");
    const retry = page.getByRole("button", { name: "같은 요청 결과 확인", exact: true });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(
      page.getByRole("region", { name: "법률·판례와 현재 약점", exact: true }),
    ).toBeVisible();
    expect(f.actions).toHaveLength(2);
    expect(f.actions[1]).toEqual(f.actions[0]);
  } finally {
    await f.close();
  }
});

for (const purpose of ["prepare_claim", "respond_to_claim"] as const)
  for (const followup of ["직접 해결", "변호사와 해결", "리포트만 저장"] as const)
    test(`${purpose}: material → confirmation → automatic law/precedent → report → ${followup}, one conversation URL`, async ({
      page,
      context,
    }, testInfo) => {
      const browserOrigin = new URL(String(testInfo.project.use.baseURL)).origin;
      const f = await openReworkBrowserFixture(context, browserOrigin, purpose);
      try {
        await page.setViewportSize({ width: 320, height: 844 });
        const path = `/cases/${encodeURIComponent(f.info.caseId)}`;
        await page.goto(path);
        const composer = page.getByRole("textbox", { name: "추가 사실 또는 질문", exact: true });
        await expect(composer).toBeEnabled();
        await composer.fill("계약서 자료를 추가해서 확인하고 싶어요.");
        await page.getByRole("button", { name: "보내기", exact: true }).click();
        const materials = page.getByRole("region", { name: "자료 추가와 검토", exact: true });
        await expect(materials).toBeVisible();
        const chooser = page.waitForEvent("filechooser");
        await materials.getByRole("button", { name: "파일 선택", exact: true }).click();
        await (await chooser).setFiles({
          name: "synthetic-conversation-contract.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("합성 검증 계약서. 반환 약속 날짜는 미확인으로 남깁니다."),
        });
        await expect(page.getByRole("list", { name: "이번 메시지의 첨부 파일" })).toContainText(
          "synthetic-conversation-contract.txt",
        );
        await page.getByRole("checkbox", { name: "첨부한 파일의 자동 처리에 동의합니다." }).check();
        await page.getByRole("button", { name: "보내기", exact: true }).click();
        const attachment = page
          .locator(".workspace-message-attachments")
          .getByRole("link", {
            name: "synthetic-conversation-contract.txt",
            exact: true,
          })
          .last();
        await expect(attachment).toBeVisible();
        await attachment.click();
        await expect(
          page.getByRole("dialog").getByRole("heading", {
            name: "synthetic-conversation-contract.txt",
            exact: true,
          }),
        ).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);

        await openAction(page, "사건 정리 재확인");
        const confirmation = page.getByRole("region", { name: "사건 정리 재확인", exact: true });
        await confirmation.getByRole("button", { name: "맞아요", exact: true }).click();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "확인하고 계속", exact: true })
          .click();
        const analysis = page.getByRole("region", { name: "법률·판례와 현재 약점", exact: true });
        await expect(
          analysis.getByText("관련 판례와 우리 사건 비교", { exact: true }),
        ).toBeVisible();
        await expect(analysis.getByText("법 조항·요건과 사건 근거", { exact: true })).toBeVisible();
        await expect(analysis.getByRole("link", { name: /공식 원문/ }).first()).toBeVisible();
        expect(new URL(page.url()).pathname).toBe(path);

        await composer.fill("현재 확인한 내용으로 보고서를 준비해 주세요.");
        await page.getByRole("button", { name: "보내기", exact: true }).click();
        const report = page.getByRole("region", { name: "리포트 준비와 검토", exact: true });
        await expect(
          report.getByRole("heading", { name: "다음으로 어떻게 진행할까요?", exact: true }),
        ).toBeVisible();
        const download = followup === "리포트만 저장" ? page.waitForEvent("download") : null;
        await report.getByRole("button", { name: new RegExp(`^${followup}`) }).click();
        if (followup === "직접 해결") {
          await expect(
            report.getByRole("heading", { name: "준비 순서와 확인할 안내", exact: true }),
          ).toBeVisible();
          await report
            .getByRole("checkbox", {
              name: "현재 리포트의 사실과 사용할 자료를 확인했어요.",
              exact: true,
            })
            .check();
          await report.getByRole("button", { name: "검토용 초안 준비", exact: true }).click();
          const draft = report.getByRole("textbox", { name: "초안 검토·수정", exact: true });
          await expect(draft).toBeEnabled();
          await expect(draft).toHaveValue(/\S+/);
          const reviewedText = await draft.inputValue();
          await report
            .getByRole("checkbox", {
              name: "사실·증거·미입력 항목과 수정한 내용을 검토했어요.",
              exact: true,
            })
            .check();
          await report.getByRole("button", { name: "검토한 초안 저장", exact: true }).click();
          const draftDownload = page.waitForEvent("download");
          await report.getByRole("button", { name: "초안 다운로드", exact: true }).click();
          const artifact = await draftDownload;
          const file = await artifact.path();
          if (!file) throw new Error("MISSING_REVIEWED_DRAFT_BYTES");
          expect(await readFile(file, "utf8")).toBe(reviewedText);
          await artifact.delete();
        } else if (followup === "변호사와 해결")
          await expect(
            report.getByRole("heading", { name: "상담 준비와 공유 범위", exact: true }),
          ).toBeVisible();
        else {
          if (!download) throw new Error("MISSING_REVIEWED_REPORT_DOWNLOAD");
          expect((await download).suggestedFilename()).toMatch(/\.pdf$/i);
        }
        expect(new URL(page.url()).pathname).toBe(path);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await expect(composer).toBeInViewport();
      } finally {
        await f.close();
      }
    });

import { readFile } from "node:fs/promises";
