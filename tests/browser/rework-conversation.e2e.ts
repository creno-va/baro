import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { z } from "zod";
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
type Fixture = Awaited<ReturnType<typeof openReworkBrowserFixture>>;
const materialText = "합성 검증 계약서. 반환 약속 날짜는 미확인으로 남깁니다.";
async function counters(f: Fixture) {
  const response = await f.control("stats");
  expect(response.ok()).toBe(true);
  return z
    .object({
      models: z.array(z.string()),
      sources: z.number(),
      native: z.object({ failed: z.number(), process: z.number() }).passthrough().nullable(),
    })
    .parse(await response.json());
}
async function reportReady(page: Page) {
  await openAction(page, "리포트 준비·검토");
  await expect(
    page
      .getByRole("region", { name: "리포트 준비와 검토", exact: true })
      .getByRole("heading", { name: "다음으로 어떻게 진행할까요?", exact: true }),
  ).toBeVisible();
}
async function addMaterial(page: Page) {
  const composer = page.getByRole("textbox", { name: "추가 사실 또는 질문", exact: true });
  await composer.fill("계약서 자료를 추가해서 확인하고 싶어요.");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  const materials = page.getByRole("region", { name: "자료 추가와 검토", exact: true });
  await expect(materials).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await materials.getByRole("button", { name: "파일 선택", exact: true }).click();
  await (await chooser).setFiles({
    name: "synthetic-conversation-contract.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(materialText),
  });
  await expect(page.getByRole("list", { name: "이번 메시지의 첨부 파일" })).toContainText(
    "synthetic-conversation-contract.txt",
  );
  await page.getByRole("checkbox", { name: "첨부한 파일의 자동 처리에 동의합니다." }).check();
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  const attachment = page
    .locator(".workspace-message-attachments")
    .getByRole("link", { name: "synthetic-conversation-contract.txt", exact: true })
    .last();
  await expect(attachment).toBeVisible();
  return attachment;
}

/** The central fixture starts a real new case, not a pre-confirmed report. */
async function enterWorkspace(page: Page, caseId: string, explanation?: string) {
  const path = `/cases/${encodeURIComponent(caseId)}`;
  await page.goto(`${path}/intake`);
  for (let index = 0; index < 6; index++) {
    await expect(
      page.getByText(`${Math.floor(index / 3) + 1}차 질문 · ${(index % 3) + 1} / 3`, {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "모름", exact: true }).click();
  }
  await expect(page).toHaveURL(new RegExp(`${path}/summary$`));
  if (explanation) {
    await page.getByRole("button", { name: "빠진 내용이 있어요", exact: true }).click();
    await page
      .getByRole("textbox", { name: "빠진 내용을 알려주세요", exact: true })
      .fill(explanation);
    await page.getByRole("button", { name: "변경안 요청하기", exact: true }).click();
    await page.getByRole("button", { name: "변경안 확정하기", exact: true }).click();
  } else {
    await page.getByRole("button", { name: "맞아요", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "확인하고 계속", exact: true })
      .click();
  }
  await expect(
    page.getByRole("textbox", { name: "추가 사실 또는 질문", exact: true }),
  ).toBeEnabled();
  expect(new URL(page.url()).pathname).toBe(path);
}

test("official source failure stays explicit and reload does not start another search", async ({
  page,
  context,
}, testInfo) => {
  const f = await openReworkBrowserFixture(
    context,
    new URL(String(testInfo.project.use.baseURL)).origin,
    "respond_to_claim",
  );
  try {
    expect((await f.control("sources", { mode: "failure" })).ok()).toBe(true);
    await enterWorkspace(page, f.info.caseId, f.info.reconciliationExplanation);
    await reportReady(page);
    await page.getByRole("button", { name: "대화 작업 닫기", exact: true }).click();
    await openAction(page, "법률·판례와 현재 약점 확인");
    const analysis = page.getByRole("region", { name: "법률·판례와 현재 약점", exact: true });
    await expect(
      analysis.getByText("공식 근거를 확인하지 못했어요", { exact: true }),
    ).toBeVisible();
    await expect(analysis.getByRole("link", { name: /공식 원문/ })).toHaveCount(0);
    const before = await counters(f);
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "추가 사실 또는 질문", exact: true }),
    ).toBeEnabled();
    const after = await counters(f);
    expect(after.models).toEqual(before.models);
    expect(after.sources).toBe(before.sources);
  } finally {
    await f.close();
  }
});

test("a real processing failure keeps the original and is not shown as reviewed evidence", async ({
  page,
  context,
}, testInfo) => {
  const f = await openReworkBrowserFixture(
    context,
    new URL(String(testInfo.project.use.baseURL)).origin,
    "prepare_claim",
  );
  try {
    await enterWorkspace(page, f.info.caseId, f.info.reconciliationExplanation);
    await reportReady(page);
    await page.getByRole("button", { name: "대화 작업 닫기", exact: true }).click();
    expect((await f.control("native", { failProcess: true })).ok()).toBe(true);
    const attachment = await addMaterial(page);
    await attachment.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("처리 실패", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /원본/ }).first()).toBeEnabled();
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "원본 확인 · 다운로드", exact: true }).click();
    const artifact = await download;
    const file = await artifact.path();
    if (!file) throw new Error("MISSING_FAILED_MATERIAL_ORIGINAL");
    expect(await readFile(file, "utf8")).toBe(materialText);
    await artifact.delete();
    expect((await counters(f)).native?.failed).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    expect(new URL(page.url()).pathname).toBe(`/cases/${f.info.caseId}`);
  } finally {
    await f.close();
  }
});

test("actual AI200 SQL admission rejects a new message without another model call", async ({
  page,
  context,
}, testInfo) => {
  const f = await openReworkBrowserFixture(
    context,
    new URL(String(testInfo.project.use.baseURL)).origin,
    "prepare_claim",
  );
  try {
    await enterWorkspace(page, f.info.caseId, f.info.reconciliationExplanation);
    await reportReady(page);
    const before = await counters(f);
    expect((await f.control("quota", {})).ok()).toBe(true);
    await page
      .getByRole("textbox", { name: "추가 사실 또는 질문", exact: true })
      .fill("현재 약점은?");
    await page.getByRole("button", { name: "보내기", exact: true }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    expect((await counters(f)).models).toEqual(before.models);
    await expect(
      page.getByRole("region", { name: "리포트 준비와 검토", exact: true }),
    ).toBeVisible();
  } finally {
    await f.close();
  }
});

test("consent withdrawal preserves the stored report while disabling new work", async ({
  page,
  context,
}, testInfo) => {
  const f = await openReworkBrowserFixture(
    context,
    new URL(String(testInfo.project.use.baseURL)).origin,
    "respond_to_claim",
  );
  try {
    await enterWorkspace(page, f.info.caseId, f.info.reconciliationExplanation);
    await reportReady(page);
    const before = await counters(f);
    expect((await f.control("withdraw-consent", {})).ok()).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      page.getByRole("textbox", { name: "추가 사실 또는 질문", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("region", { name: "리포트 준비와 검토", exact: true }),
    ).toBeVisible();
    expect((await counters(f)).models).toEqual(before.models);
  } finally {
    await f.close();
  }
});

test("a foreign signed account cannot retain the previous conversation report or draft", async ({
  page,
  context,
}, testInfo) => {
  const f = await openReworkBrowserFixture(
    context,
    new URL(String(testInfo.project.use.baseURL)).origin,
    "prepare_claim",
  );
  try {
    await enterWorkspace(page, f.info.caseId, f.info.reconciliationExplanation);
    await reportReady(page);
    await context.clearCookies();
    await context.addCookies([f.info.foreignCookie]);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("region", { name: "리포트 준비와 검토", exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByRole("alert").first()).toBeVisible();
  } finally {
    await f.close();
  }
});

test("a real peer context edit preserves the user's draft and requires comparison before saving", async ({
  page,
  context,
}, testInfo) => {
  const f = await openReworkBrowserFixture(
    context,
    new URL(String(testInfo.project.use.baseURL)).origin,
    "prepare_claim",
  );
  try {
    await enterWorkspace(page, f.info.caseId, f.info.reconciliationExplanation);
    await reportReady(page);
    await page.getByRole("button", { name: "대화 작업 닫기", exact: true }).click();
    await page.getByRole("button", { name: "입장·절차 확인", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "입장과 절차 확인", exact: true });
    const description = dialog.getByRole("textbox", {
      name: "확인한 진행 상황 (선택)",
      exact: true,
    });
    await description.fill("제가 별도로 확인한 합성 진행 상황");
    expect((await f.control("peer-context", {})).ok()).toBe(true);
    await dialog.getByRole("button", { name: "입장·절차 저장", exact: true }).click();
    await expect(description).toHaveValue("제가 별도로 확인한 합성 진행 상황");
    await expect(
      dialog.getByRole("button", { name: "최신 기준 불러오기", exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "최신 기준 불러오기", exact: true }).click();
    await expect(description).toHaveValue("제가 별도로 확인한 합성 진행 상황");
    await dialog
      .getByRole("checkbox", { name: "현재 저장된 값과 선택한 변경을 비교했어요.", exact: true })
      .check();
    await dialog.getByRole("button", { name: "입장·절차 저장", exact: true }).click();
    await expect(dialog).not.toBeVisible();
  } finally {
    await f.close();
  }
});

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
    await enterWorkspace(page, f.info.caseId, f.info.reconciliationExplanation);
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

test("the report's own prepare button recovers an actual committed response loss without duplicate work", async ({
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
          request.postDataJSON()?.action === "prepare_report" &&
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
    // A genuine unavailable analysis retains the explicit preparation control
    // beside its limited report; no application result is fabricated.
    expect((await f.control("sources", { mode: "failure" })).ok()).toBe(true);
    await enterWorkspace(page, f.info.caseId, f.info.reconciliationExplanation);
    await page.goto(`/cases/${encodeURIComponent(f.info.caseId)}/reports`);
    await page.getByRole("button", { name: "리포트 준비", exact: true }).click();
    const ready = page.getByRole("heading", { name: "다음으로 어떻게 진행할까요?", exact: true });
    const failure = page.locator(".report-error");
    await expect
      .poll(async () => (await ready.isVisible()) || (await failure.isVisible()))
      .toBe(true);
    await expect.poll(() => dropped).toBe(true);
    if (await failure.isVisible())
      await failure.getByRole("button", { name: "다시 확인", exact: true }).click();
    await expect(ready).toBeVisible();
    // A completed result may be recovered by GET alone. If the client retries
    // the POST, it must preserve the committed operation's entire identity.
    expect(f.actions.length).toBeGreaterThan(0);
    for (const action of f.actions) expect(action).toEqual(f.actions[0]);
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
        await enterWorkspace(page, f.info.caseId, f.info.reconciliationExplanation);
        const composer = page.getByRole("textbox", { name: "추가 사실 또는 질문", exact: true });
        await expect(composer).toBeEnabled();
        const attachment = await addMaterial(page);
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
        await confirmation.getByRole("button", { name: "빠진 내용이 있어요", exact: true }).click();
        await page
          .getByRole("textbox", { name: "빠진 내용을 알려주세요", exact: true })
          .fill("방금 올린 계약서의 원본은 제가 보관하고 있습니다.");
        await page.getByRole("button", { name: "변경안 요청하기", exact: true }).click();
        await confirmation.getByRole("button", { name: "변경안 확정하기", exact: true }).click();
        await expect(confirmation).not.toBeVisible();
        // Confirmation owns automatic admission; this action displays its
        // existing job/result and never asks the user for a search phrase.
        await expect
          .poll(
            async () =>
              (await counters(f)).models.filter((phase) => phase === "workspace_legal_plan").length,
          )
          .toBeGreaterThanOrEqual(2);
        await openAction(page, "법률·판례와 현재 약점 확인");
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
        if (purpose === "prepare_claim" && followup === "직접 해결")
          await page.screenshot({ path: "/tmp/baro-625-real-conversation-320.png" });
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
          const artifact = await download;
          expect(artifact.suggestedFilename()).toMatch(/\.pdf$/i);
          const file = await artifact.path();
          if (!file) throw new Error("MISSING_REVIEWED_REPORT_BYTES");
          const bytes = await readFile(file);
          expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
          expect(bytes.byteLength).toBeGreaterThan(100);
          await artifact.delete();
        }
        expect(new URL(page.url()).pathname).toBe(path);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await expect(composer).toBeInViewport();
        if (purpose === "prepare_claim" && followup === "직접 해결") {
          expect(
            (await new AxeBuilder({ page }).include(".workspace").analyze()).violations.filter(
              (violation) => ["serious", "critical"].includes(violation.impact ?? ""),
            ),
          ).toEqual([]);
          await page.keyboard.press("Escape");
          await expect(report).not.toBeVisible();
          expect(
            await page.evaluate(() => !!document.activeElement?.closest(".workspace-composer")),
          ).toBe(true);
        }
      } finally {
        await f.close();
      }
    });

import { readFile } from "node:fs/promises";
