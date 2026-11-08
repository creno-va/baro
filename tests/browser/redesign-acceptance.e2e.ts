import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  closeMaterials,
  openMaterials,
  openRedesignConversation,
  prepareRedesignReport,
  redesignResolution,
  redesignTask,
  seedRedesignCase,
  syntheticCaseId,
  unsentMessage,
} from "../helpers/redesign-fixture";

test.beforeEach(async ({ page }) => {
  await seedRedesignCase(page);
});

for (const entry of [
  { label: "민사 준비", purpose: "prepare_claim", kind: "civil" },
  { label: "민사 대응", purpose: "respond_to_claim", kind: "civil" },
  { label: "형사 고소 준비", purpose: "prepare_claim", kind: "criminal" },
  { label: "형사 대응", purpose: "respond_to_claim", kind: "criminal" },
]) {
  test(`${entry.label} starts from an explanation without requiring a document`, async ({
    page,
  }) => {
    await page.goto("/app");
    await page
      .getByRole("combobox", { name: "준비하는 방향", exact: true })
      .selectOption({ label: entry.label });
    await page
      .getByRole("textbox", { name: "지금까지 있었던 일", exact: true })
      .fill(
        "실제 인물이 없는 합성 검수 사건입니다. 문서는 보유하지 않았고 제가 아는 경위와 모르는 범위를 구분해 준비하려고 합니다.",
      );
    await page.getByRole("button", { name: "저장하고 계속", exact: true }).click();
    await expect(page).toHaveURL(/\/cases\/[^/]+\/intake(?:\?question=0)?$/);
    await expect(page.getByRole("button", { name: "모름", exact: true })).toBeEnabled();
    const stored = await page.evaluate(() => {
      const id = location.pathname.split("/")[2] ?? "";
      return {
        context: JSON.parse(localStorage.getItem("baro-api-mock-v1:reworkContexts") ?? "{}")[id],
        files: JSON.parse(localStorage.getItem("baro-api-mock-v1:files") ?? "{}")[id] ?? [],
      };
    });
    expect(stored.context).toMatchObject({
      casePurpose: entry.purpose,
      procedure: { kind: entry.kind },
    });
    expect(stored.files).toHaveLength(0);
  });
}

test("message formatting displays synthetic input without executing injected HTML or URLs", async ({
  page,
}) => {
  await openRedesignConversation(page);
  await closeMaterials(page);
  let alerts = 0;
  let remoteImages = 0;
  page.on("dialog", async (dialog) => {
    alerts++;
    await dialog.dismiss();
  });
  await page.route("https://example.invalid/**", async (route) => {
    remoteImages++;
    await route.abort();
  });
  await page
    .getByRole("textbox", { name: "추가 사실 또는 질문", exact: true })
    .fill(
      '<img src="https://example.invalid/synthetic.png" onerror="alert(1)">\n**합성 확인** [실행](javascript:alert(1))',
    );
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  const message = page.locator(".workspace-message--user").last();
  await expect(message).toContainText("합성 확인");
  await expect(message.locator("img,script,iframe,object,embed")).toHaveCount(0);
  await expect(message.locator('a[href^="javascript:"]')).toHaveCount(0);
  expect(alerts).toBe(0);
  expect(remoteImages).toBe(0);
});

test("reading the report route does not generate or save a report", async ({ page }) => {
  await page.goto(`/cases/${syntheticCaseId}/reports?mode=conversation`);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "리포트 준비", exact: true })).toBeVisible();
  const stored = await page.evaluate(() => ({
    reports: localStorage.getItem("baro-api-mock-v1:reports"),
    receipts: localStorage.getItem("baro-api-mock-v1:reworkReceipts"),
  }));
  expect(stored.reports === null || stored.reports === "{}").toBe(true);
  expect(stored.receipts === null || stored.receipts === "{}").toBe(true);
});

test("lawyer action only opens the exact unsupported modal and preserves selection", async ({
  page,
}, info) => {
  await prepareRedesignReport(page);
  const resolution = redesignResolution(page);
  const self = resolution.getByRole("button", { name: /^직접 해결/ });
  await self.click();
  await expect(self).toHaveAttribute("aria-pressed", "true");
  const readSelection = () =>
    page.evaluate((id) => {
      const state = JSON.parse(localStorage.getItem("baro-api-mock-v1:reworkResolutions") ?? "{}")[
        id
      ];
      return state
        ? {
            revision: state.revision,
            selection: state.selection,
            selectedFileIds: state.selectedFileIds,
            maskIdentifiers: state.maskIdentifiers,
            draft: state.draft,
          }
        : null;
    }, syntheticCaseId);
  const before = {
    stored: await readSelection(),
    selfPressed: await self.getAttribute("aria-pressed"),
  };
  const requests: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() !== "GET" ||
      !new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/)
    )
      requests.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  const lawyer = resolution.getByRole("button", { name: /^변호사와 해결/ });
  await lawyer.focus();
  await page.keyboard.press("Enter");
  await expect
    .poll(
      async () =>
        (await page
          .getByRole("dialog", { name: "아직 지원하지 않는 기능이에요", exact: true })
          .isVisible()) || (await lawyer.getAttribute("aria-pressed")) === "true",
    )
    .toBe(true);
  const after = {
    stored: await readSelection(),
    selfPressed: await self.getAttribute("aria-pressed"),
  };
  await info.attach("selection-before-after", {
    body: JSON.stringify({ before, after, requests }),
    contentType: "application/json",
  });
  await info.attach("lawyer-action", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  const dialog = page.getByRole("dialog", { name: "아직 지원하지 않는 기능이에요", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("현재 변호사 연결 기능은 제공하지 않습니다.");
  await dialog.getByRole("button", { name: "확인", exact: true }).click();
  await expect(lawyer).toBeFocused();
  expect({
    stored: await readSelection(),
    selfPressed: await self.getAttribute("aria-pressed"),
  }).toEqual(before);
  expect(after).toEqual(before);
  expect(requests).toEqual([]);
});

test("all four case tasks remain discoverable with materials closed", async ({ page }) => {
  await openRedesignConversation(page);
  await closeMaterials(page);
  for (const name of ["대화", "자료", "리포트", "문서 초안"]) {
    const task = redesignTask(page, name);
    await expect(task, `${name} must be a directly available case task`).toBeVisible();
  }
});

test("switching case tasks keeps unsent text and unuploaded bytes", async ({ page }) => {
  await openRedesignConversation(page);
  await closeMaterials(page);
  const input = page.getByRole("textbox", { name: "추가 사실 또는 질문", exact: true });
  await input.fill(unsentMessage);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "사진·파일 첨부", exact: true }).click();
  const originalBytes = Buffer.from("복구했다고 표시하려면 이 바이트를 실제로 유지해야 합니다.");
  await (await chooser).setFiles({
    name: "전환-전-선택한-합성파일.txt",
    mimeType: "text/plain",
    buffer: originalBytes,
  });
  const warnings: string[] = [];
  page.on("dialog", async (dialog) => {
    warnings.push(dialog.type());
    await dialog.dismiss();
  });
  for (const name of ["자료", "리포트", "문서 초안", "대화"]) {
    await redesignTask(page, name).click();
  }
  expect(warnings).toEqual([]);
  await expect(input).toHaveValue(unsentMessage);
  await expect(page.locator(".workspace-composer")).toContainText("전환-전-선택한-합성파일.txt");
  await expect(page.locator(".workspace-message--user")).toHaveCount(0);
  const files = await page.evaluate(
    (id) => JSON.parse(localStorage.getItem("baro-api-mock-v1:files") ?? "{}")[id] ?? [],
    syntheticCaseId,
  );
  expect(files).toHaveLength(0);
  await page
    .locator(".workspace-composer")
    .getByRole("checkbox", { name: "첨부한 파일의 자동 처리에 동의합니다.", exact: true })
    .check();
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  const attachment = page
    .locator(".workspace-message-attachments")
    .getByRole("link", { name: "전환-전-선택한-합성파일.txt", exact: true })
    .last();
  await expect(attachment).toBeVisible();
  await attachment.click();
  const original = page.waitForEvent("download");
  await page
    .getByRole("dialog", { name: "자료 확인", exact: true })
    .getByRole("button", { name: "원본 확인 · 다운로드", exact: true })
    .click();
  const downloaded = await original;
  const path = await downloaded.path();
  if (!path) throw new Error("Original download has no local bytes");
  expect(await readFile(path)).toEqual(originalBytes);
  await downloaded.delete();
});

test("opening drafts is a read and leaves self selection and generation unchanged", async ({
  page,
}) => {
  await prepareRedesignReport(page);
  const readState = () =>
    page.evaluate(
      (id) => ({
        resolution:
          JSON.parse(localStorage.getItem("baro-api-mock-v1:reworkResolutions") ?? "{}")[id] ??
          null,
        receipts: localStorage.getItem("baro-api-mock-v1:reworkReceipts"),
      }),
      syntheticCaseId,
    );
  const before = await readState();
  await redesignTask(page, "문서 초안").click();
  await expect(page.getByRole("heading", { name: "문서 초안", exact: true })).toBeVisible();
  expect(await readState()).toEqual(before);
});

test("report source section keeps its full limitation body visible", async ({ page }) => {
  await prepareRedesignReport(page);
  await expect(page.getByRole("heading", { name: "출처와 분석 기준", exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "합성 API 예시입니다. 실제 법 조항·판례와 공식 절차를 확인하지 않았습니다. 사용자 진술·자료 기재와 법률 판단을 구분해 주세요.",
      { exact: true },
    ),
  ).toBeVisible();
});

test("failed report save preserves the correction and cancelled reload before an explicit retry", async ({
  page,
}) => {
  await prepareRedesignReport(page);
  await page.getByRole("button", { name: "수정하기", exact: true }).click();
  const editor = page.locator(".report-reading-section textarea").first();
  const correction = "합성 수정: 일부 반환 사실은 진술이며 원문과 대조가 필요합니다.";
  await editor.fill(correction);
  const storedReport = () =>
    page.evaluate(
      (id) => JSON.parse(localStorage.getItem("baro-api-mock-v1:reports") ?? "{}")[id],
      syntheticCaseId,
    );
  const before = await storedReport();
  let reloadWarnings = 0;
  page.on("dialog", async (dialog) => {
    if (dialog.type() === "beforeunload") reloadWarnings++;
    await dialog.dismiss();
  });
  await page.reload({ timeout: 4000 }).catch((error: Error) => {
    if (
      !/ERR_ABORTED|Navigation.*cancel|interrupted|frame.*detached/i.test(error.message) &&
      !(reloadWarnings === 1 && /Timeout/.test(error.message))
    )
      throw error;
  });
  expect(reloadWarnings).toBe(1);
  await expect(editor).toHaveValue(correction);
  await page.evaluate(async () => {
    const path = "/src/client/api/index.ts";
    const { api } = (await import(path)) as typeof import("../../src/client/api");
    const reports = api.reports;
    let failed = false;
    api.reports = new Proxy(reports, {
      get(target, property) {
        const method = Reflect.get(target, property);
        if (property !== "save") return method;
        return async (...args: Parameters<typeof reports.save>) => {
          if (!failed) {
            failed = true;
            throw new Error("합성 검수 저장 실패: 전송 결과를 받지 못했어요.");
          }
          return target.save(...args);
        };
      },
    });
  });
  const save = page.getByRole("button", { name: "수정 내용 저장", exact: true });
  await save.click();
  await expect(page.getByRole("alert")).toContainText("합성 검수 저장 실패");
  await expect(editor).toHaveValue(correction);
  expect(await storedReport()).toEqual(before);
  await expect(save).toBeEnabled();
  await save.click();
  await expect
    .poll(async () => {
      const value = await storedReport();
      return { revision: value?.revision, includesCorrection: value?.content.includes(correction) };
    })
    .toEqual({ revision: before.revision + 1, includesCorrection: true });
  await expect(page.locator(".report-reading")).toContainText(correction);
  await page.getByRole("button", { name: "수정하기", exact: true }).click();
  await expect(editor).toHaveValue(correction);
});

for (const width of [320, 390, 768, 1024, 1440, 1920]) {
  test(`actual pages remain operable at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await openRedesignConversation(page);
    await closeMaterials(page);
    const input = page.getByRole("textbox", { name: "추가 사실 또는 질문", exact: true });
    await input.fill(unsentMessage);
    const panel = await openMaterials(page);
    await expect(panel.getByRole("button", { name: "파일 선택", exact: true })).toBeEnabled();
    await closeMaterials(page);
    await expect(input).toHaveValue(unsentMessage);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await expect(input).toBeInViewport();
    await info.attach(`conversation-${width}`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await input.fill("");
    await page.goto(`/cases/${syntheticCaseId}/reports?mode=conversation`);
    await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await info.attach(`report-state-${width}`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });
}

test("unuploaded attachment and unsent message survive material-panel round trip without submission", async ({
  page,
}) => {
  await openRedesignConversation(page);
  await closeMaterials(page);
  const input = page.getByRole("textbox", { name: "추가 사실 또는 질문", exact: true });
  await input.fill(unsentMessage);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /첨부/ }).first().click();
  await (await chooser).setFiles({
    name: "합성-아직-업로드하지-않은-원문.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("실제 인물이 없는 검수용 원문입니다."),
  });
  await openMaterials(page);
  await closeMaterials(page);
  await expect(input).toHaveValue(unsentMessage);
  await expect(page.locator(".workspace-composer")).toContainText(
    "합성-아직-업로드하지-않은-원문.txt",
  );
  await expect(page.locator(".workspace-message--user")).toHaveCount(0);
  const files = await page.evaluate(
    (id) => JSON.parse(localStorage.getItem("baro-api-mock-v1:files") ?? "{}")[id] ?? [],
    syntheticCaseId,
  );
  expect(files).toHaveLength(0);
});

test("cancelled page navigation preserves the unsent message", async ({ page }, info) => {
  await openRedesignConversation(page);
  await closeMaterials(page);
  const input = page.getByRole("textbox", { name: "추가 사실 또는 질문", exact: true });
  await input.fill(unsentMessage);
  let warnings = 0;
  page.on("dialog", async (dialog) => {
    warnings++;
    await dialog.dismiss();
  });
  await page.getByRole("link", { name: "설정", exact: true }).click({ noWaitAfter: true });
  const guard = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "작성 중인 내용을 두고 이동할까요?", exact: true }),
  });
  await expect.poll(async () => warnings > 0 || (await guard.isVisible())).toBe(true);
  if (await guard.isVisible()) {
    const label = await guard.evaluate((dialog) => {
      const labelledby = dialog.getAttribute("aria-labelledby");
      return {
        labelledby,
        labels: labelledby?.split(/\s+/).map((id) => ({
          id,
          matches: [...document.querySelectorAll(`#${CSS.escape(id)}`)].map((node) => ({
            text: node.textContent,
            hidden: (node as HTMLElement).hidden,
          })),
        })),
      };
    });
    await info.attach("leave-dialog-label", {
      body: JSON.stringify(label),
      contentType: "application/json",
    });
    await expect(guard).toHaveAccessibleName("작성 중인 내용을 두고 이동할까요?");
    await guard.getByRole("button", { name: "이 화면에서 계속 작성", exact: true }).click();
    await expect(guard).not.toBeVisible();
  } else expect(warnings).toBe(1);
  await expect(input).toHaveValue(unsentMessage);
  await expect(page).toHaveURL(new RegExp(`/cases/${syntheticCaseId}$`));
});

test("conversation entry has no serious accessibility violations", async ({ page }) => {
  await openRedesignConversation(page);
  await closeMaterials(page);
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? ""))).toEqual(
    [],
  );
});

test("existing lawyer account can use its own ordinary case", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await seedRedesignCase(page, "lawyer");
  await openRedesignConversation(page);
  await page.getByRole("textbox", { name: "추가 사실 또는 질문", exact: true }).fill(unsentMessage);
  await expect(page.getByRole("button", { name: "보내기", exact: true })).toBeEnabled();
  await context.close();
});

test("owner change removes the previous owner's unsent text from the document", async ({
  page,
}) => {
  await openRedesignConversation(page);
  await closeMaterials(page);
  await page.getByRole("textbox", { name: "추가 사실 또는 질문", exact: true }).fill(unsentMessage);
  await page.evaluate(() => {
    localStorage.setItem(
      "baro-api-mock-v1:session",
      JSON.stringify({
        user: {
          id: "redesign-different-synthetic-owner",
          name: "다른 합성 계정",
          accountType: "customer",
        },
        needsConsent: false,
      }),
    );
    window.dispatchEvent(new Event("focus"));
  });
  await expect
    .poll(() =>
      page
        .locator("textarea")
        .evaluateAll(
          (inputs, secret) =>
            inputs.some((input) => (input as HTMLTextAreaElement).value.includes(secret)),
          unsentMessage,
        ),
    )
    .toBe(false);
  await expect(
    page.getByRole("textbox", { name: "추가 사실 또는 질문", exact: true }),
  ).not.toBeVisible();
});
