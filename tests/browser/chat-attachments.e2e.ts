import { expect, type Page, test } from "@playwright/test";

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
  await attach(page);
  await page.getByLabel("첨부한 파일의 자동 처리에 동의합니다.").check();
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
  await page.getByRole("list", { name: "메시지 첨부 파일" }).getByRole("link").click();
  await expect(page).toHaveURL(/\/files\?file=/);
  await expect(page.getByRole("dialog")).toContainText(file.name);
});

test("upload failure preserves draft and same file retry without duplicate reservation", async ({
  page,
}) => {
  await seed(page, { "files.uploadPart": ["UNAVAILABLE"] });
  await attach(page);
  await page.getByLabel("추가 사실 또는 질문").fill("재시도할 합성 질문");
  await page.getByLabel("첨부한 파일의 자동 처리에 동의합니다.").check();
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
  await page.getByLabel("첨부한 파일의 자동 처리에 동의합니다.").check();
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await page.getByRole("button", { name: "전송 대기 취소" }).click();
  await expect(page.getByLabel("추가 사실 또는 질문")).toBeEnabled();
  await expect(page.getByText("처리 실패 · 자료에서 확인", { exact: true })).toBeVisible();
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

test("only actual assistant references appear in evidence materials; selected unused files remain attachments", async ({
  page,
}) => {
  await seed(page);
  await page.evaluate((id) => {
    const files = ["used", "unused"].map((name) => ({
      id: `synthetic-${name}`,
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
  await page.getByRole("link", { name: "자료 탭에서 확인하기" }).click();
  await expect(page).toHaveURL(/files\?evidence=1$/);
  await expect(page.locator(".workspace-file-list")).toContainText("used.txt");
  await expect(page.locator(".workspace-file-list")).not.toContainText("unused.txt");
  await expect(page.getByText("근거로 활용됨", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "전체 첨부 파일", exact: true }).click();
  await expect(page.locator(".workspace-file-list")).toContainText("unused.txt");
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
