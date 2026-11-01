import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
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
async function stableForeground(locator: Locator) {
  await expect
    .poll(() =>
      locator.evaluate((element) => {
        for (let node: Element | null = element; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (
            Number(style.opacity) !== 1 ||
            style.filter !== "none" ||
            style.visibility !== "visible" ||
            node
              .getAnimations()
              .some((animation) => animation.playState === "running" || animation.pending)
          )
            return false;
        }
        return true;
      }),
    )
    .toBe(true);
  return locator.evaluate((element) => ({
    opacity: getComputedStyle(element).opacity,
    filter: getComputedStyle(element).filter,
    running: element.getAnimations().filter((a) => a.playState === "running").length,
    openDialogs: document.querySelectorAll("dialog[open]").length,
  }));
}
async function captureReadiness(page: Page, directory: string, phase: string) {
  const value = await page.evaluate(async () => {
    const path = "/src/client/api/index.ts";
    const { api } = (await import(path)) as typeof import("../../src/client/api/index");
    const id = decodeURIComponent(location.pathname.split("/")[2] ?? "");
    const [conversation, report, resolution] = await Promise.all([
      api.rework.getConversation(id),
      api.rework.peekReport(id),
      api.rework.getResolution(id),
    ]);
    const basis = resolution.basis;
    return {
      synthetic: true,
      workspaceRevision: conversation.workspaceRevision,
      summaryConfirmed: conversation.summaryConfirmed,
      context: {
        purpose: conversation.caseContext.casePurpose,
        kind: conversation.caseContext.procedure.kind,
        stage: conversation.caseContext.procedure.stage,
      },
      analysis: {
        id: conversation.snapshot?.id,
        status: conversation.analysis.status,
        basis: conversation.analysis.basis,
      },
      report: report && {
        id: report.id,
        revision: report.revision,
        stale: report.stale,
        basis: report.basis,
        analysisReview: report.analysisReview,
        excludedFileIds: report.excludedFileIds,
        maskIdentifiers: report.maskIdentifiers,
      },
      resolution: {
        revision: resolution.revision,
        status: resolution.status,
        selection: resolution.selection,
        selectedFileIds: resolution.selectedFileIds,
        maskIdentifiers: resolution.maskIdentifiers,
        basis: basis && {
          workspaceRevision: basis.workspaceRevision,
          researchRevision: basis.researchRevision,
          summaryRevision: basis.summaryRevision,
          analysisId: basis.analysisId,
          evidenceHash: basis.evidenceHash,
          reportId: basis.reportId,
          reportRevision: basis.reportRevision,
          purpose: basis.casePurpose,
          kind: basis.procedure.kind,
          stage: basis.procedure.stage,
        },
      },
    };
  });
  // Private diagnostic only: enums, hashes and synthetic identities, no source
  // bodies, procedure descriptions, cookies or provider errors. Not CI upload.
  await writeFile(join(directory, `${phase}-readiness.json`), JSON.stringify(value, null, 2));
}
async function preserveReport(page: Page, directory: string, fixture: Fixture) {
  const current = await page.evaluate(async () => {
    const path = "/src/client/api/index.ts";
    const { api } = (await import(path)) as typeof import("../../src/client/api/index");
    const id = decodeURIComponent(location.pathname.split("/")[2] ?? "");
    const report = await api.rework.peekReport(id);
    if (!report || report.stale) throw new Error("MISSING_CURRENT_ARTIFACT_BASIS");
    const html = await api.reports.html(report.id);
    return { id: report.id, revision: report.revision, html: await html.text() };
  });
  expect(current.html).toContain('data-baro-report="1"');
  await writeFile(join(directory, "report.html"), current.html);
  await captureReadiness(page, directory, "before-pdf");
  const responseIndex = fixture.pdfResponses.length;
  const downloaded = page.waitForEvent("download");
  const button = page
    .getByRole("region", { name: "리포트 준비와 검토", exact: true })
    .getByRole("button", { name: "PDF 다운로드", exact: true });
  await button.click();
  const artifact = await downloaded;
  const file = await artifact.path();
  if (!file) throw new Error("MISSING_UI_REPORT_ARTIFACT");
  const bytes = await readFile(file);
  expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  // Chromium can expose an empty BrowserResponse.body for a fulfilled PDF.
  // Compare the actual Hono upstream bytes, before browser transport, instead.
  const responses = fixture.pdfResponses
    .slice(responseIndex)
    .filter((r) => r.path === `/api/v2/reports/${encodeURIComponent(current.id)}/pdf`);
  expect(responses).toHaveLength(1);
  expect(bytes.equals(responses[0]!.bytes)).toBe(true);
  await artifact.saveAs(join(directory, "report.pdf"));
  await artifact.delete();
  await expect(button).toBeEnabled();
  await captureReadiness(page, directory, "after-pdf");
  await writeFile(
    join(directory, "basis.json"),
    JSON.stringify(
      {
        synthetic: true,
        reportId: current.id,
        reportRevision: current.revision,
        pdfBytes: bytes.byteLength,
        pdfSha256: createHash("sha256").update(bytes).digest("hex"),
        htmlSha256: createHash("sha256").update(current.html).digest("hex"),
      },
      null,
      2,
    ),
  );
  return { bytes, id: current.id };
}
async function addMaterial(
  page: Page,
  expectProcessingFailure = false,
  afterSend?: () => Promise<void>,
) {
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
  await afterSend?.();
  if (expectProcessingFailure) {
    await expect(materials.getByText("처리 실패 · 확인 필요", { exact: true })).toBeVisible();
    await expect(page.locator(".workspace-message-attachments")).toHaveCount(0);
    const original = materials.getByRole("button", {
      name: "synthetic-conversation-contract.txt",
      exact: true,
    });
    await expect(original).toBeVisible();
    return original;
  }
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
  await page.getByRole("button", { name: "질문 시작하기", exact: true }).click();
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

/** Failure/permission cases begin with an existing confirmed case prepared by
 * the real authenticated client. Full six journeys still exercise intake UI. */
async function openPreparedWorkspace(page: Page, f: Fixture) {
  await page.goto("/settings");
  await page.evaluate(async (id) => {
    const path = "/src/client/api/index.ts";
    const { api } = (await import(path)) as typeof import("../../src/client/api/index");
    const wait = async (count: number, complete = false) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const value = await api.cases.getQuestions(id);
        if (!value.processing && value.questions.length >= count && (!complete || value.complete))
          return value;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error("SYNTHETIC_CLIENT_PREPARATION_LIMIT");
    };
    let questions = await api.cases.getQuestions(id);
    for (let round = 0; round < 2; round++) {
      await api.cases.advance(id, { expectedRevision: questions.revision });
      questions = await wait((round + 1) * 3);
      const current = questions.questions.slice(round * 3, round * 3 + 3);
      if (current.length !== 3) throw new Error("SYNTHETIC_QUESTION_BOUND");
      questions = await api.cases.saveAnswers(id, {
        expectedRevision: questions.revision,
        answers: current.map((q) => ({ questionId: q.id, state: "unknown" as const })),
      });
    }
    await api.cases.advance(id, { expectedRevision: questions.revision });
    await wait(6, true);
    const current = await api.cases.get(id);
    await api.cases.confirmSummary(id, { expectedRevision: current.revision });
  }, f.info.caseId);
  expect((await f.control("settle", {})).ok()).toBe(true);
  await page.goto(`/cases/${encodeURIComponent(f.info.caseId)}`);
  await expect(
    page.getByRole("textbox", { name: "추가 사실 또는 질문", exact: true }),
  ).toBeEnabled();
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
    await openPreparedWorkspace(page, f);
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
    await openPreparedWorkspace(page, f);
    await reportReady(page);
    await page.getByRole("button", { name: "대화 작업 닫기", exact: true }).click();
    expect((await f.control("native", { failProcess: true })).ok()).toBe(true);
    const attachment = await addMaterial(page, true);
    await attachment.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("status")).toContainText(
      "자료 처리를 완료하지 못했어요. 원본은 보관돼요.",
    );
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
    await openPreparedWorkspace(page, f);
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
    await openPreparedWorkspace(page, f);
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
    await openPreparedWorkspace(page, f);
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
    await openPreparedWorkspace(page, f);
    await reportReady(page);
    await page.getByRole("button", { name: "대화 작업 닫기", exact: true }).click();
    await openAction(page, "사건 정리 재확인");
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
      const queuedMessages: { body: string | null; key: string | undefined }[] = [];
      const loseQueuedAck = purpose === "prepare_claim" && followup === "직접 해결";
      const f = await openReworkBrowserFixture(context, browserOrigin, purpose, {
        dropResponse: (request, response) => {
          if (
            !loseQueuedAck ||
            request.method() !== "POST" ||
            !new URL(request.url()).pathname.endsWith("/messages") ||
            !request.postDataJSON()?.selectedFileIds?.length ||
            !response.ok()
          )
            return false;
          queuedMessages.push({
            body: request.postData(),
            key: request.headers()["idempotency-key"],
          });
          return queuedMessages.length === 1;
        },
      });
      const branch = { "직접 해결": "self", "변호사와 해결": "lawyer", "리포트만 저장": "save" }[
        followup
      ];
      const directory = join(
        "/tmp/baro-625-journeys",
        String(testInfo.project.name || "chromium"),
        `${purpose}-${branch}`,
      );
      try {
        await mkdir(directory, { recursive: true });
        await page.setViewportSize({ width: 320, height: 844 });
        const path = `/cases/${encodeURIComponent(f.info.caseId)}`;
        await enterWorkspace(page, f.info.caseId, f.info.reconciliationExplanation);
        const composer = page.getByRole("textbox", { name: "추가 사실 또는 질문", exact: true });
        await expect(composer).toBeEnabled();
        const attachment = await addMaterial(
          page,
          false,
          loseQueuedAck
            ? async () => {
                await expect.poll(() => queuedMessages.length).toBe(1);
                await expect(page.locator(".workspace-error")).toBeVisible();
                await expect(composer).toBeEnabled();
                await page.getByRole("button", { name: "보내기", exact: true }).click();
              }
            : undefined,
        );
        if (loseQueuedAck) {
          expect(queuedMessages).toHaveLength(2);
          expect(queuedMessages[0]?.key).toBeTruthy();
          expect(queuedMessages[1]).toEqual(queuedMessages[0]);
          await expect(
            page.locator(".workspace-message-attachments").getByRole("link", {
              name: "synthetic-conversation-contract.txt",
              exact: true,
            }),
          ).toHaveCount(1);
        }
        await attachment.click();
        await expect(
          page.getByRole("dialog").getByRole("heading", {
            name: "synthetic-conversation-contract.txt",
            exact: true,
          }),
        ).toBeVisible();
        await expect(page.getByRole("dialog")).toHaveCount(1);
        await writeFile(
          join(directory, "materials-visual.json"),
          JSON.stringify(await stableForeground(page.getByRole("dialog")), null, 2),
        );
        await page.screenshot({ path: join(directory, "materials.png"), animations: "disabled" });
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);

        await openAction(page, "사건 정리 재확인");
        const confirmation = page.getByRole("region", { name: "사건 정리 재확인", exact: true });
        // New material/facts invalidate the earlier immutable confirmation.
        // Consume 01's explicit stale recovery rather than bypassing it.
        await expect(
          confirmation.getByRole("region", { name: "사실과 출처", exact: true }),
        ).toContainText(materialText);
        await confirmation.getByRole("button", { name: "다시 설명하기", exact: true }).click();
        await page
          .getByRole("textbox", { name: "빠진 내용을 알려주세요", exact: true })
          .fill("방금 올린 계약서의 원본은 제가 보관하고 있습니다.");
        await page.getByRole("button", { name: "변경안 요청하기", exact: true }).click();
        const confirmChange = confirmation.getByRole("button", {
          name: "변경안 확정하기",
          exact: true,
        });
        const refreshExplanation = page
          .getByRole("dialog")
          .getByRole("button", { name: "최신 내용 불러오기", exact: true });
        await expect
          .poll(
            async () => (await confirmChange.isVisible()) || (await refreshExplanation.isVisible()),
          )
          .toBe(true);
        if (await refreshExplanation.isVisible()) {
          const beforeRefresh = f.observations.filter((item) => item.method === "POST").length;
          await refreshExplanation.click();
          const explanation = page.getByRole("textbox", {
            name: "빠진 내용을 알려주세요",
            exact: true,
          });
          await expect(explanation).toHaveValue(
            "방금 올린 계약서의 원본은 제가 보관하고 있습니다.",
          );
          const requestChange = page.getByRole("button", { name: "변경안 요청하기", exact: true });
          await expect(requestChange).toBeEnabled();
          expect(f.observations.filter((item) => item.method === "POST")).toHaveLength(
            beforeRefresh,
          );
          await requestChange.click();
        }
        await expect(confirmChange).toBeVisible();
        const beforeConfirmation = (await counters(f)).models.filter(
          (phase) => phase === "workspace_legal_plan",
        ).length;
        await confirmChange.click();
        await expect(confirmation).not.toBeVisible();
        // Confirmation owns automatic admission; this action displays its
        // existing job/result and never asks the user for a search phrase.
        await expect
          .poll(
            async () =>
              (await counters(f)).models.filter((phase) => phase === "workspace_legal_plan").length,
          )
          .toBeGreaterThan(beforeConfirmation);
        await openAction(page, "법률·판례와 현재 약점 확인");
        const analysis = page.getByRole("region", { name: "법률·판례와 현재 약점", exact: true });
        await expect(
          analysis.getByText("현재 기준의 법률·판례 조사", { exact: true }),
        ).toBeVisible();
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
        await writeFile(
          join(directory, "report-visual.json"),
          JSON.stringify(await stableForeground(report), null, 2),
        );
        await page.screenshot({ path: join(directory, "report.png"), animations: "disabled" });
        const preservedPdf = await preserveReport(page, directory, f);
        const download = followup === "리포트만 저장" ? page.waitForEvent("download") : null;
        const pdfResponseIndex = f.pdfResponses.length;
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
          await captureReadiness(page, directory, "self-selected");
          const prepareDraft = report.getByRole("button", {
            name: "검토용 초안 준비",
            exact: true,
          });
          await expect(prepareDraft).toBeEnabled();
          await prepareDraft.click();
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
          await artifact.saveAs(join(directory, "reviewed-draft.txt"));
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
          const responses = f.pdfResponses
            .slice(pdfResponseIndex)
            .filter((r) => r.path === `/api/v2/reports/${encodeURIComponent(preservedPdf.id)}/pdf`);
          expect(responses).toHaveLength(1);
          expect(bytes.equals(responses[0]!.bytes)).toBe(true);
          expect(bytes.equals(preservedPdf.bytes)).toBe(true);
          await artifact.saveAs(join(directory, "downloaded-report.pdf"));
          const stored = z
            .object({
              artifacts: z.object({
                pdf: z.array(z.object({ state: z.string(), logicalBytes: z.number() })),
              }),
            })
            .parse(await (await f.control("stats")).json());
          expect(stored.artifacts.pdf).toContainEqual({
            state: "stored",
            logicalBytes: bytes.byteLength,
          });
          await artifact.delete();
        }
        await writeFile(
          join(directory, "followup-visual.json"),
          JSON.stringify(await stableForeground(report), null, 2),
        );
        await page.screenshot({ path: join(directory, "followup.png"), animations: "disabled" });
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
        try {
          await mkdir(directory, { recursive: true });
          await writeFile(
            join(directory, "protocol.json"),
            JSON.stringify(f.observations, null, 2),
          );
        } finally {
          await f.close();
        }
      }
    });

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
