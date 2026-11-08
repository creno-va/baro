import { createHash } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { confirmWorkspaceUpload, openWorkspaceMaterials } from "../helpers/workspace-navigation";

const id = "synthetic-chat-attachment";
const base = `/cases/${id}`;
const file = {
  name: "합성 첨부.txt",
  mimeType: "text/plain",
  buffer: Buffer.from("합성 원본 내용입니다."),
};
async function seed(page: Page, faults: Record<string, string[]> = {}) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(
    ({ id, faults }) => {
      if (localStorage.getItem("attachment-seeded")) return;
      localStorage.setItem("attachment-seeded", "true");
      const values = {
        session: {
          user: { id: "synthetic-owner", name: "합성 사용자", accountType: "customer" },
          needsConsent: false,
        },
        cases: {
          [id]: {
            id,
            title: "합성 첨부 사건",
            subjectContext: "individual",
            stage: "active",
            revision: 1,
            updatedAt: new Date().toISOString(),
            summary: "합성 요약",
            schemaVersion: "2",
            summaryDetails: {
              schemaVersion: "2",
              revision: 1,
              intakeRevision: 1,
              createdAt: new Date().toISOString(),
              overview: "합성 요약",
              facts: [
                {
                  id: "synthetic-adverse-fact",
                  text: "사용자도 약속 날짜를 변경한 적이 있다는 합성 진술",
                  attribution: "user_statement",
                  certainty: "reported",
                  significance: "unfavorable",
                  references: [{ kind: "intake_narrative", intakeRevision: 1 }],
                  conflictingFactIds: [],
                  userEdited: false,
                },
              ],
              parties: [],
              unknowns: ["원본의 진정성은 확인하지 않았습니다."],
              notices: ["외부 모델을 호출하지 않는 합성 예시입니다."],
            },
          },
        },
        caseOwners: { [id]: "synthetic-owner" },
        workspace: { [id]: { messages: [], actions: [], timeline: [] } },
        files: { [id]: [] },
        faults,
      };
      for (const [key, value] of Object.entries(values))
        localStorage.setItem(`baro-api-mock-v1:${key}`, JSON.stringify(value));
    },
    { id, faults },
  );
  await page.goto(base);
  await expect(page.getByRole("button", { name: "사진·파일 첨부" })).toBeEnabled();
  const closePanel = page.getByRole("button", { name: "자료 패널 닫기", exact: true });
  if (await closePanel.isVisible()) await closePanel.click();
}
async function messages(page: Page) {
  return page.evaluate(
    (id) => JSON.parse(localStorage.getItem("baro-api-mock-v1:workspace") ?? "{}")[id].messages,
    id,
  );
}
async function attach(page: Page) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "사진·파일 첨부" }).click();
  await (await chooser).setFiles(file);
}

test("compact composer keeps attachment, fixed input and send on one row at phone and desktop widths", async ({
  page,
}, testInfo) => {
  await seed(page);
  const input = page.getByLabel("추가 사실 또는 질문", { exact: true });
  const attach = page.getByRole("button", { name: "사진·파일 첨부", exact: true });
  await expect(attach).toHaveText("");
  await expect(page.locator(".workspace-message-length")).toHaveCount(0);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
    await expect(input).toBeInViewport();
    const measure = () =>
      page.locator(".workspace-composer-row").evaluate((row) => {
        const input = row.querySelector("textarea");
        const attach = row.querySelector(".workspace-attach");
        const send = row.querySelector(".workspace-send");
        const surface = row.parentElement;
        if (!input || !attach || !send || !surface) throw new Error("Composer controls missing");
        const attachBox = attach.getBoundingClientRect();
        const inputBox = input.getBoundingClientRect();
        const sendBox = send.getBoundingClientRect();
        const boxes = [attachBox, inputBox, sendBox];
        const centers = boxes.map((box) => box.y + box.height / 2);
        return {
          aligned: Math.max(...centers) - Math.min(...centers) <= 1,
          ordered: attachBox.right <= inputBox.left && inputBox.right <= sendBox.left,
          height: input.getBoundingClientRect().height,
          resize: getComputedStyle(input).resize,
          surfaceHeight: surface.getBoundingClientRect().height,
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
        };
      });
    await expect.poll(measure).toEqual({
      aligned: true,
      ordered: true,
      height: 44,
      resize: "none",
      surfaceHeight: 62,
      overflow: false,
    });
    await input.fill("궁금한 내용을 적어요.\n추가 내용도 입력해요.\n세 번째 줄이에요.");
    expect((await measure()).height).toBe(44);
    await expect(page.getByRole("button", { name: "보내기", exact: true })).toBeEnabled();
    await page
      .locator(".workspace-composer-surface")
      .screenshot({ path: testInfo.outputPath(`compact-composer-${width}.png`) });
    await input.fill("");
  }
});

test("case header keeps a compact title and accessible tools while deletion stays in the sidebar", async ({
  page,
}) => {
  await seed(page);
  const title = "지인에게 빌려준 돈의 반환 문제";
  await page.evaluate(
    ({ id, title }) => {
      const key = "baro-api-mock-v1:cases";
      const cases = JSON.parse(localStorage.getItem(key) ?? "{}");
      cases[id].title = title;
      cases[id].subjectContext = "company";
      localStorage.setItem(key, JSON.stringify(cases));
    },
    { id, title },
  );
  await page.reload();
  const nav = page.locator(".case-navigation");
  await expect(nav.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(nav.getByLabel("사건 관리")).toHaveCount(0);
  await expect(nav.getByRole("button", { name: "사건 삭제", exact: true })).toHaveCount(0);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    const layout = await nav.evaluate((node) => {
      const heading = node.querySelector("h1");
      const tools = node.querySelector("summary");
      if (!tools || !heading) throw new Error("Case heading/tools missing");
      return {
        size: parseFloat(getComputedStyle(heading).fontSize),
        toolsHeight: tools.getBoundingClientRect().height,
      };
    });
    expect(layout.size).toBeLessThanOrEqual(18);
    expect(layout.toolsHeight).toBeGreaterThanOrEqual(44);
    await expect(nav.locator(".workspace-tabs")).toHaveCount(0);
    await expect(nav.locator(".case-subject-context")).toHaveCount(0);
    if (width !== 320) await page.screenshot({ path: `.wrangler/case-heading-${width}.png` });
  }
  const row = page.locator(".sidebar-desktop .sidebar-story-row").first();
  await expect(row).toContainText(title);
  await row.hover();
  await row.getByRole("button", { name: `${title} 사건 삭제`, exact: true }).click();
  const modal = page.getByRole("dialog", { name: "이 사건을 삭제할까요?", exact: true });
  await modal.getByRole("button", { name: "취소", exact: true }).click();
  await row.hover();
  await row.getByRole("button", { name: `${title} 사건 삭제`, exact: true }).click();
  await modal.getByRole("button", { name: "사건 삭제", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  expect(
    await page.evaluate(
      (id) => Boolean(JSON.parse(localStorage.getItem("baro-api-mock-v1:cases") ?? "{}")[id]),
      id,
    ),
  ).toBe(false);
});

test("materials keep one compact upload area, coverage, summary access and retries below the case header", async ({
  page,
}) => {
  await seed(page, { "files.uploadPart": ["UNAVAILABLE"] });
  await page.goto(`${base}/files`);
  const target = page.getByRole("button", { name: "파일 선택", exact: true });
  await expect(target).toBeEnabled();
  await expect(page.locator(".workspace-upload-types")).toHaveCount(0);
  await expect(target).toContainText("문서·이미지 100 MB");
  const tools = page.getByRole("navigation", { name: "사건 도구", exact: true });
  const disclosure = page.locator(".case-tools > summary");
  const summaryLink = tools.getByRole("link", { name: "요약 보기 · 재확인", exact: true });
  await expect(page.locator(".workspace-context")).toHaveCount(0);
  await expect(tools).not.toBeVisible();
  await expect(summaryLink).not.toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "전체 첨부 파일", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "근거로 활용한 자료", exact: true })).toHaveCount(0);
  await expect(page.getByText("확인된 근거 자료가 아직 없어요.", { exact: false })).toHaveCount(0);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    const geometry = await page.locator(".workspace").evaluate((workspace) => {
      const box = (selector: string) => {
        const node = workspace.querySelector(selector);
        if (!node) throw new Error(`Missing ${selector}`);
        const { left, right, width, height } = node.getBoundingClientRect();
        return { left, right, width, height };
      };
      return {
        header: box(".case-workspace__header"),
        content: box(".workspace-grid"),
        upload: box(".workspace-upload-target"),
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });
    expect(geometry.content.left).toBeGreaterThanOrEqual(geometry.header.left - 1);
    expect(geometry.content.right).toBeLessThanOrEqual(geometry.header.right + 1);
    await expect(page.locator(".workspace-tabs")).toHaveCount(0);
    expect(geometry.upload.height).toBeGreaterThanOrEqual(80);
    expect(geometry.overflow).toBe(false);
    if (width === 390 || width === 1440)
      await page.screenshot({ path: `.wrangler/materials-empty-${width}.png`, fullPage: true });
    await disclosure.focus();
    await disclosure.press("Enter");
    await expect(tools).toBeVisible();
    await expect(summaryLink).toBeVisible();
    await expect(summaryLink).toHaveAttribute("href", `${base}/summary`);
    if (width === 390 || width === 1440)
      await page.screenshot({ path: `.wrangler/materials-context-${width}.png`, fullPage: true });
    await page.keyboard.press("Escape");
    await expect(tools).not.toBeVisible();
    await expect(disclosure).toBeFocused();
  }
  const chooser = page.waitForEvent("filechooser");
  await target.click();
  await (await chooser).setFiles(file);
  await expect(page.locator(".workspace-file-list > li")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "업로드 다시 시도", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "선택한 자료 업로드", exact: true }),
  ).toBeDisabled();
  await confirmWorkspaceUpload(page);
  const retry = page.getByRole("button", { name: "업로드 다시 시도", exact: true });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(page.getByRole("heading", { name: file.name, exact: true })).toBeVisible();
  const add = page.getByRole("button", { name: "파일 추가", exact: true });
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await expect
      .poll(async () => (await add.boundingBox())?.height ?? Infinity)
      .toBeLessThanOrEqual(120);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    if (width === 390 || width === 1440)
      await page.screenshot({ path: `.wrangler/materials-list-${width}.png`, fullPage: true });
  }
  await add.evaluate((button) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["추가한 합성 내용"], "두 번째.txt", { type: "text/plain" }));
    button.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  });
  await expect(page.getByRole("list", { name: "업로드할 자료", exact: true })).toContainText(
    "두 번째.txt",
  );
  await expect(page.locator(".workspace-file-list > li")).toHaveCount(1);
  await confirmWorkspaceUpload(page);
  await expect(page.getByRole("heading", { name: "두 번째.txt", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(".workspace-file-list > li")).toHaveCount(2);
  await expect(add).toBeEnabled();
});

test("local photo preview, removal and draft survive focus at phone and desktop widths", async ({
  page,
}) => {
  await seed(page);
  await page.getByLabel("추가 사실 또는 질문").fill("이 사진을 확인해 주세요.");
  await page.getByLabel("사진 또는 파일 첨부").setInputFiles({
    name: "합성.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR5kAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  const preview = page.getByRole("img", { name: "합성.png 미리보기" });
  await expect
    .poll(() => preview.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBe(1);
  await expect(page.getByRole("button", { name: "보내기", exact: true })).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(preview).toBeVisible();
  await expect(page.getByLabel("추가 사실 또는 질문")).toHaveValue("이 사진을 확인해 주세요.");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
  }
  await page.screenshot({ path: ".wrangler/chat-attachments-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".wrangler/chat-attachments-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "합성.png 첨부 제거" }).click();
  await expect(preview).toHaveCount(0);
  expect(await messages(page)).toEqual([]);
});

test("file-only send uploads once, waits for processing, saves attachment and survives reload", async ({
  page,
}) => {
  await seed(page);
  const summaryBefore = await page.evaluate(
    (id) => JSON.parse(localStorage.getItem("baro-api-mock-v1:cases") ?? "{}")[id].summaryDetails,
    id,
  );
  await attach(page);
  await page
    .locator(".workspace-composer")
    .getByLabel("첨부한 파일의 자동 처리에 동의합니다.")
    .check();
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.getByRole("list", { name: "메시지 첨부 파일" })).toContainText(file.name);
  expect((await messages(page)).filter((m: { role: string }) => m.role === "user")).toHaveLength(1);
  const user = (await messages(page))[0];
  expect(user.selectedFileIds).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole("list", { name: "메시지 첨부 파일" })).toContainText(file.name);
  expect(
    await page.evaluate(
      (id) => JSON.parse(localStorage.getItem("baro-api-mock-v1:files") ?? "{}")[id].length,
      id,
    ),
  ).toBe(1);
  const source = page.getByRole("list", { name: "메시지 첨부 파일" }).getByRole("link");
  await expect(source).toHaveAttribute("href", `${base}/files?file=${user.selectedFileIds[0]}`);
  await source.click();
  await expect(page).toHaveURL(base);
  await expect(page.getByRole("dialog", { name: "자료 확인", exact: true })).toContainText(
    file.name,
  );
  const stored = await page.evaluate(
    async ({ id, fileId }) => {
      const path = "/src/client/api/index.ts";
      const { api } = await import(path);
      const original = await api.files.original(id, fileId);
      const item = await api.cases.get(id);
      const uploaded = (await api.files.list(id, { metadataOnly: true })).find(
        (f: { id: string; uploadContentHash?: string }) => f.id === fileId,
      );
      return {
        text: await original.text(),
        summary: item.summaryDetails,
        hash: uploaded?.uploadContentHash,
      };
    },
    { id, fileId: user.selectedFileIds[0] },
  );
  expect(stored.text).toBe(file.buffer.toString("utf8"));
  expect(stored.hash).toBe(createHash("sha256").update(file.buffer).digest("hex"));
  expect(stored.summary).toEqual(summaryBefore);
});

test("upload failure preserves draft and same file retry without duplicate reservation", async ({
  page,
}) => {
  await seed(page, { "files.uploadPart": ["UNAVAILABLE"] });
  await attach(page);
  await page.getByLabel("추가 사실 또는 질문").fill("재시도할 합성 질문");
  await page
    .locator(".workspace-composer")
    .getByLabel("첨부한 파일의 자동 처리에 동의합니다.")
    .check();
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.getByRole("button", { name: "업로드 다시 시도" })).toBeVisible();
  await expect(page.getByLabel("추가 사실 또는 질문")).toHaveValue("재시도할 합성 질문");
  expect(await messages(page)).toEqual([]);
  await page.getByRole("button", { name: "업로드 다시 시도" }).click();
  await expect(page.getByRole("button", { name: "업로드 다시 시도" })).not.toBeVisible();
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.getByRole("list", { name: "메시지 첨부 파일" })).toContainText(file.name);
  expect((await messages(page)).filter((m: { role: string }) => m.role === "user")).toHaveLength(1);
  expect(
    await page.evaluate(
      (id) => JSON.parse(localStorage.getItem("baro-api-mock-v1:files") ?? "{}")[id].length,
      id,
    ),
  ).toBe(1);
});

test("failed processing never sends the message and queued sending can be cancelled", async ({
  page,
}) => {
  await seed(page, { "files.upload": ["file_failed"] });
  await attach(page);
  await page.getByLabel("추가 사실 또는 질문").fill("실패 시 보존할 질문");
  await page
    .locator(".workspace-composer")
    .getByLabel("첨부한 파일의 자동 처리에 동의합니다.")
    .check();
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await page.getByRole("button", { name: "전송 대기 취소" }).click();
  await expect(page.getByLabel("추가 사실 또는 질문")).toBeEnabled();
  await expect(
    page
      .getByRole("list", { name: "이번 메시지의 첨부 파일" })
      .getByText("처리 실패 · 확인 필요", { exact: true }),
  ).toBeVisible();
  expect(await messages(page)).toEqual([]);
  await expect(page.getByLabel("추가 사실 또는 질문")).toHaveValue("실패 시 보존할 질문");
  await expect(page.getByRole("button", { name: "보내기", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: `${file.name} 첨부 제거` }).click();
  await expect(page.getByRole("button", { name: "보내기", exact: true })).toBeEnabled();
});

test("owner change purges local attachment and text without uploading", async ({ page }) => {
  await seed(page);
  await attach(page);
  await page.getByLabel("추가 사실 또는 질문").fill("다른 계정에 남으면 안 되는 합성 초안");
  await page.evaluate(() => {
    localStorage.setItem(
      "baro-api-mock-v1:session",
      JSON.stringify({
        user: { id: "different-owner", name: "다른 합성 사용자", accountType: "customer" },
        needsConsent: false,
      }),
    );
    window.dispatchEvent(new Event("focus"));
  });
  await expect(page.getByRole("list", { name: "이번 메시지의 첨부 파일" })).toHaveCount(0);
  await expect(page.getByText("다른 계정에 남으면 안 되는 합성 초안")).toHaveCount(0);
  expect(await messages(page)).toEqual([]);
});

test("materials retain every attachment and mark actual evidence without filter controls", async ({
  page,
}) => {
  await seed(page);
  await page.evaluate((id) => {
    const files = ["used", "unused"].map((name) => ({
      id: `synthetic-${name}`,
      revision: 1,
      name: `${name}.txt`,
      mimeType: "text/plain",
      sizeBytes: 10,
      status: "ready",
      coverage: "합성",
      extractedText: "합성 내용",
    }));
    localStorage.setItem("baro-api-mock-v1:files", JSON.stringify({ [id]: files }));
    localStorage.setItem(
      "baro-api-mock-v1:workspace",
      JSON.stringify({
        [id]: {
          actions: [],
          timeline: [],
          messages: [
            {
              id: "synthetic-user",
              role: "user",
              text: "첨부를 확인해 주세요",
              status: "complete",
              createdAt: new Date().toISOString(),
              selectedFileIds: files.map((file) => file.id),
            },
            {
              id: "synthetic-assistant",
              role: "assistant",
              text: "첫 번째 자료만 근거로 활용한 합성 응답",
              status: "complete",
              createdAt: new Date().toISOString(),
              references: [
                { kind: "intake_narrative", intakeRevision: 1 },
                ...[1, 2, 3].map((number) => ({
                  kind: "intake_answer",
                  questionId: `synthetic-question-${number}`,
                  intakeRevision: 1,
                })),
                {
                  kind: "user_material",
                  fileId: "synthetic-used",
                  fileRevision: 1,
                  position: { kind: "document", page: 1, paragraph: null, table: null },
                },
              ],
            },
          ],
        },
      }),
    );
  }, id);
  await page.reload();
  const sources = page.getByRole("list", { name: "답변에 사용한 자료", exact: true });
  await expect(sources.getByRole("listitem")).toHaveCount(1);
  await expect(sources.getByRole("link", { name: "used.txt · 1쪽", exact: true })).toHaveAttribute(
    "href",
    `${base}/files?file=synthetic-used`,
  );
  await expect(page.getByText("처음 입력한 이야기", { exact: true })).toHaveCount(0);
  await expect(page.getByText("추가 질문에 대한 답변", { exact: true })).toHaveCount(0);
  expect(
    (await messages(page)).find((message: { role: string }) => message.role === "assistant")
      .references,
  ).toHaveLength(5);
  const materialsLink = page
    .getByRole("navigation", { name: "사건 작업", exact: true })
    .getByRole("link", { name: "자료 2개", exact: true });
  await expect(materialsLink).toHaveAttribute("href", `${base}/files`);
  await openWorkspaceMaterials(page);
  await expect(page).toHaveURL(/\/files$/);
  await expect(page.locator(".workspace-file-list")).toContainText("used.txt");
  await expect(page.locator(".workspace-file-list")).toContainText("unused.txt");
  const used = page.locator(".workspace-file-list > li").filter({
    has: page.getByRole("heading", { name: "used.txt", exact: true }),
  });
  const unused = page.locator(".workspace-file-list > li").filter({
    has: page.getByRole("heading", { name: "unused.txt", exact: true }),
  });
  await expect(used).toContainText("현재 자료가 대화 근거로 연결됨");
  await expect(unused).not.toContainText("현재 자료가 대화 근거로 연결됨");
  await page.goto(`${base}/files?evidence=1`);
  await expect(page.locator(".workspace-file-list")).toContainText("unused.txt");
  await expect(page.locator(".workspace-file-list > li")).toHaveCount(2);
  await page.evaluate((id) => {
    const key = "baro-api-mock-v1:files";
    const stored = JSON.parse(localStorage.getItem(key) ?? "{}");
    stored[id][0].revision = 2;
    localStorage.setItem(key, JSON.stringify(stored));
  }, id);
  await page.reload();
  await expect(page.locator(".workspace-file-list > li")).toHaveCount(2);
  await expect(used).not.toContainText("현재 자료가 대화 근거로 연결됨");
  await expect(unused).not.toContainText("현재 자료가 대화 근거로 연결됨");
  expect(
    (await messages(page))
      .find((message: { role: string }) => message.role === "assistant")
      .references.find((reference: { kind: string }) => reference.kind === "user_material"),
  ).toMatchObject({ fileId: "synthetic-used", fileRevision: 1 });
});

test("dragged and pasted files stay local until consent and sending", async ({ page }) => {
  await seed(page);
  await page.locator(".workspace-composer").evaluate((form) => {
    const dropped = new DataTransfer();
    dropped.items.add(new File(["합성"], "끌어놓은.txt", { type: "text/plain" }));
    form.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dropped }),
    );
  });
  await expect(page.getByRole("list", { name: "이번 메시지의 첨부 파일" })).toContainText(
    "끌어놓은.txt",
  );
  await page.locator(".workspace-composer").evaluate((form) => {
    const pasted = new DataTransfer();
    pasted.items.add(new File(["합성"], "붙여넣은.txt", { type: "text/plain" }));
    form.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: pasted }),
    );
  });
  await expect(page.getByRole("list", { name: "이번 메시지의 첨부 파일" })).toContainText(
    "붙여넣은.txt",
  );
  expect(await messages(page)).toEqual([]);
});

async function publishSyntheticReply(page: Page, text: string) {
  await page.evaluate(
    ({ id, text }) => {
      const key = "baro-api-mock-v1:workspace";
      const all = JSON.parse(localStorage.getItem(key) ?? "{}");
      const data = all[id];
      const message = data.messages.findLast((m: { role: string }) => m.role === "assistant");
      message.status = "complete";
      message.text = text;
      delete data.pending?.[message.id];
      localStorage.setItem(key, JSON.stringify(all));
      window.dispatchEvent(new Event("focus"));
    },
    { id, text },
  );
}

test("new validated replies reveal whole Korean/emoji graphemes, can finish immediately and restore without replay", async ({
  page,
}) => {
  await seed(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("추가 사실 또는 질문").fill("합성 대화 표시를 확인해 주세요.");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.locator(".workspace-message--assistant")).toHaveCount(1);
  const text = "한글 👩🏽‍💻 가\u0301 🇰🇷 함께 확인해요.\n".repeat(40);
  await publishSyntheticReply(page, text);
  const reply = page.locator(".workspace-message--assistant [data-reply-revealing]");
  await expect(reply).toBeVisible();
  const visible = await reply.innerText();
  expect(visible.length).toBeGreaterThan(0);
  expect(visible.length).toBeLessThan(text.length);
  const boundaries = await page.evaluate((text) => {
    let prefix = "";
    return Array.from(
      new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(text),
      (part) => (prefix += part.segment),
    );
  }, text);
  expect(boundaries).toContain(visible);
  await page.screenshot({ path: ".wrangler/chat-progressive-390.png", fullPage: true });
  await page.getByRole("button", { name: "답변 전체 바로 보기" }).click();
  await expect(reply).toHaveCount(0);
  await expect(page.locator(".workspace-message--assistant .workspace-message-content")).toHaveText(
    text,
  );
  await page.reload();
  await expect(page.locator(".workspace-message--assistant .workspace-message-content")).toHaveText(
    text,
  );
  await expect(page.locator("[data-reply-revealing]")).toHaveCount(0);
  expect(await messages(page)).toHaveLength(2);
});

test("reduced motion shows the published answer immediately", async ({ page }) => {
  await seed(page);
  await page.getByLabel("추가 사실 또는 질문").fill("합성 모션 설정 검증입니다.");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.locator(".workspace-message--assistant")).toHaveCount(1);
  const text = "기억나는 대로 편하게 말씀해 주세요. 합성 검증용 답변입니다.";
  await publishSyntheticReply(page, text);
  await expect(page.locator(".workspace-message--assistant .workspace-message-content")).toHaveText(
    text,
  );
  await expect(page.getByRole("button", { name: "답변 전체 바로 보기" })).toHaveCount(0);
});

test("a failed pending refresh recovers once and preserves the unsent draft", async ({ page }) => {
  await seed(page);
  await page.getByLabel("추가 사실 또는 질문").fill("저장할 합성 질문입니다.");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.locator(".workspace-message--assistant")).toHaveCount(1);
  await page.getByLabel("추가 사실 또는 질문").fill("아직 보내지 않은 다음 질문");
  await page.evaluate(() => {
    localStorage.setItem(
      "baro-api-mock-v1:faults",
      JSON.stringify({ "workspace.get": ["UNAVAILABLE"] }),
    );
  });
  await expect(page.getByText("이 응답은 합성 API 예시", { exact: false })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByLabel("추가 사실 또는 질문")).toHaveValue("아직 보내지 않은 다음 질문");
  expect(
    (await messages(page)).filter((m: { role: string }) => m.role === "assistant"),
  ).toHaveLength(1);
});

test("reading earlier text keeps scroll position while the new reply grows; motion changes finish it", async ({
  page,
}) => {
  await seed(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 390, height: 650 });
  await page
    .getByLabel("추가 사실 또는 질문")
    .fill("앞서 기억한 합성 사건 내용을 적습니다. ".repeat(50));
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.locator(".workspace-message--assistant")).toHaveCount(1);
  await page.getByRole("log", { name: "사건 대화" }).evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  const documentScroll = await page.evaluate(() => scrollY);
  const text = "한 문장씩 편하게 읽으실 수 있어요. 합성 검증입니다.\n".repeat(60);
  await publishSyntheticReply(page, text);
  const reply = page.locator(".workspace-message--assistant [data-reply-revealing]");
  await expect(reply).toHaveCount(1);
  const start = (await reply.textContent())?.length ?? 0;
  await expect
    .poll(async () => (await reply.textContent())?.length ?? 0)
    .toBeGreaterThan(start + 20);
  expect(await page.evaluate(() => scrollY)).toBe(documentScroll);
  expect(
    await page.getByRole("log", { name: "사건 대화" }).evaluate((node) => node.scrollTop),
  ).toBe(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(reply).toHaveCount(0);
  await expect(page.locator(".workspace-message--assistant .workspace-message-content")).toHaveText(
    text,
  );
  expect(await page.evaluate(() => scrollY)).toBe(documentScroll);
  expect(
    await page.getByRole("log", { name: "사건 대화" }).evaluate((node) => node.scrollTop),
  ).toBe(0);
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 650 },
])
  test(`long chat keeps header and composer stable while only message history scrolls at ${viewport.width}px`, async ({
    page,
  }) => {
    // Native wheel transactions are per page; isolate each viewport so the last
    // boundary gesture cannot keep scrolling during the next geometry check.
    await page.setViewportSize(viewport);
    await seed(page);
    await page.evaluate((id) => {
      const workspace = JSON.parse(localStorage.getItem("baro-api-mock-v1:workspace") ?? "{}");
      workspace[id].messages = Array.from({ length: 24 }, (_, index) => ({
        id: `scroll-message-${index}`,
        role: index % 2 ? "assistant" : "user",
        text: `${index + 1}번째 합성 대화입니다. 사실관계와 확인할 내용을 정리합니다.\n`.repeat(5),
        status: "complete",
        createdAt: new Date().toISOString(),
      }));
      localStorage.setItem("baro-api-mock-v1:workspace", JSON.stringify(workspace));
    }, id);
    await page.reload();
    const log = page.getByRole("log", { name: "사건 대화" });
    await expect(log.locator("article")).toHaveCount(24);
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await expect(page.getByText("대화·자료 안내", { exact: true })).toHaveCount(0);

    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    // Resizing can anchor the document to the old chat boundary. Reset after
    // the resize before recording viewport-relative composer coordinates.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    await expect
      .poll(async () => {
        const panel = await page.locator(".workspace-main").boundingBox();
        return panel ? panel.y + panel.height : Infinity;
      })
      .toBeLessThanOrEqual(viewport.height);
    await expect.poll(() => log.evaluate((node) => node.clientHeight)).toBeGreaterThan(200);
    await expect
      .poll(async () => {
        const composer = await page.locator(".workspace-composer").boundingBox();
        return composer ? composer.y + composer.height : Infinity;
      })
      .toBeLessThanOrEqual(viewport.height + 1);
    await log.evaluate((node) => {
      node.scrollTop = 0;
    });
    await expect.poll(() => log.evaluate((node) => node.scrollTop)).toBe(0);
    const tabs = page.locator(".case-workspace__header");
    const before = await tabs.boundingBox();
    const composer = await page.locator(".workspace-composer").boundingBox();
    const bounds = await log.boundingBox();
    const panel = await page.locator(".workspace-main").boundingBox();
    const documentScroll = await page.evaluate(() => scrollY);
    expect(documentScroll).toBe(0);
    if (!before || !composer || !bounds || !panel) throw new Error("Synthetic chat layout missing");
    expect(bounds.width).toBeCloseTo(panel.width, 0);
    expect(composer.width).toBeLessThanOrEqual(panel.width + 1);
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.wheel(0, 600);
    await expect.poll(() => log.evaluate((node) => node.scrollTop)).toBe(600);
    expect((await tabs.boundingBox())?.y).toBeCloseTo(before.y, 1);
    expect((await page.locator(".workspace-composer").boundingBox())?.y).toBeCloseTo(composer.y, 1);
    expect(await page.evaluate(() => scrollY)).toBe(documentScroll);
    expect(composer.y + composer.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(
      await page
        .locator(".workspace-sidebar")
        .evaluate((node) => !!node.closest(".workspace-messages")),
    ).toBe(true);
    if (viewport.height >= 650) {
      await expect(page.getByLabel("추가 사실 또는 질문")).toBeInViewport();
      await expect(page.getByRole("button", { name: "보내기", exact: true })).toBeInViewport();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await log.evaluate((node) => {
      // Position near the boundary, then reach it with normal wheel movement.
      node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight - 600);
      node.dataset.scrollEndedAtBottom = "false";
      const settled = () => {
        if (node.scrollHeight - node.scrollTop - node.clientHeight > 1) return;
        node.dataset.scrollEndedAtBottom = "true";
        node.removeEventListener("scrollend", settled);
      };
      node.addEventListener("scrollend", settled);
    });
    await page.mouse.wheel(0, 600);
    await expect(log).toHaveAttribute("data-scroll-ended-at-bottom", "true");
    await expect
      .poll(() => log.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight))
      .toBeLessThanOrEqual(1);
    // The viewport frame keeps header/composer reachable at a history boundary.
    await page.mouse.wheel(0, 3000);
    expect(await page.evaluate(() => scrollY)).toBe(documentScroll);
    await expect(page.getByLabel("추가 사실 또는 질문")).toBeInViewport();
    if (viewport.width === 390 || viewport.width === 1440)
      await page.screenshot({ path: `.wrangler/chat-scroll-${viewport.width}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    const materialsClose = page.getByRole("button", { name: "자료 패널 닫기", exact: true });
    if (await materialsClose.isVisible()) await materialsClose.click();
    await page.locator(".case-tools > summary").click();
    await page
      .getByRole("navigation", { name: "사건 도구", exact: true })
      .getByRole("link", { name: /타임라인/ })
      .click();
    await expect(page).toHaveURL(/\/timeline$/);
    expect(
      await page.locator("body").evaluate((node) => getComputedStyle(node).overflowY),
    ).not.toBe("hidden");
    await page.getByRole("link", { name: "대화로 돌아가기", exact: true }).click();
    const closePanel = page.getByRole("button", { name: "자료 패널 닫기", exact: true });
    if (await closePanel.isVisible()) await closePanel.click();
    await expect(log.locator("article")).toHaveCount(24);
    await expect(page.locator(".case-options")).toHaveCount(0);
  });

test("installed mock SDK reads attachment admission progress without changing the confirmed case", async ({
  page,
}) => {
  await seed(page);
  const result = await page.evaluate(async (id) => {
    const path = "/src/client/api/index.ts";
    const { api } = await import(path);
    const before = await api.cases.get(id);
    const progress = await api.rework.getConversationProgress(id, {
      expectedOwner: "synthetic-owner",
    });
    const after = await api.cases.get(id);
    return { before, progress, after };
  }, id);
  expect(result.progress.contractVersion).toBe("conversation-report-progress-v1");
  expect(result.progress.state.workspaceRevision).toBe(result.before.revision);
  expect(result.progress.state.summaryConfirmed).toBe(true);
  expect(result.progress.state.pendingEvidenceIds).toEqual([]);
  expect(result.progress.state.analysis.status).toBe("not_started");
  expect(result.progress.state.report.status).toBe("not_started");
  expect(result.progress.reportContinuation).toBeNull();
  expect(result.after).toEqual(result.before);
  expect(await messages(page)).toEqual([]);
});
