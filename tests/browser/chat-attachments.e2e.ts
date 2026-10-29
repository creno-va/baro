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

test("case header shows a concise title below its small subject label and deletion stays in the sidebar", async ({
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
      const label = node.querySelector(".case-subject-context");
      const heading = node.querySelector("h1");
      if (!label || !heading) throw new Error("Case heading missing");
      return {
        above: label.getBoundingClientRect().bottom <= heading.getBoundingClientRect().top,
        small:
          parseFloat(getComputedStyle(label).fontSize) <
          parseFloat(getComputedStyle(heading).fontSize),
      };
    });
    expect(layout).toEqual({ above: true, small: true });
    await expect(nav.locator(".case-subject-context")).toHaveText("기업 사건");
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

test("materials use one upload placeholder then a compact bar, aligned with the case header", async ({
  page,
}) => {
  await seed(page, { "files.uploadPart": ["UNAVAILABLE"] });
  await page.goto(`${base}/files`);
  const target = page.getByRole("button", { name: "파일 선택", exact: true });
  await expect(target).toBeEnabled();
  await expect(page.locator(".workspace-upload-types")).toHaveCount(0);
  await expect(target).toContainText("문서·이미지 100 MB");
  const context = page.locator(".workspace-context");
  const disclosure = context.locator(":scope > summary");
  const summaryLink = context.getByRole("link", { name: "요약 검토하기" });
  await expect(context).not.toHaveAttribute("open");
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
        const { left, width, height } = node.getBoundingClientRect();
        return { left, width, height };
      };
      return {
        header: box(".workspace-header"),
        tabs: box(".workspace-tabs"),
        content: box(".workspace-grid"),
        upload: box(".workspace-upload-target"),
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });
    for (const box of [geometry.tabs, geometry.content]) {
      expect(Math.abs(box.left - geometry.header.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.width - geometry.header.width)).toBeLessThanOrEqual(1);
    }
    expect(geometry.upload.height).toBeGreaterThanOrEqual(180);
    expect(geometry.overflow).toBe(false);
    if (width === 390 || width === 1440)
      await page.screenshot({ path: `.wrangler/materials-empty-${width}.png`, fullPage: true });
    await disclosure.focus();
    await disclosure.press("Enter");
    await expect(context).toHaveAttribute("open");
    await expect(summaryLink).toBeVisible();
    await expect(summaryLink).toHaveAttribute("href", `${base}/summary?from=files`);
    if (width === 390 || width === 1440)
      await page.screenshot({ path: `.wrangler/materials-context-${width}.png`, fullPage: true });
    await disclosure.press("Enter");
    await expect(context).not.toHaveAttribute("open");
  }
  const chooser = page.waitForEvent("filechooser");
  await target.click();
  await (await chooser).setFiles(file);
  const retry = page.getByRole("button", { name: "업로드 다시 시도", exact: true });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(page.getByRole("heading", { name: file.name, exact: true })).toBeVisible();
  const add = page.getByRole("button", { name: "파일 추가", exact: true });
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await expect
      .poll(async () => (await add.boundingBox())?.height ?? Infinity)
      .toBeLessThanOrEqual(80);
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

test("materials retain every attachment and mark actual evidence without filter controls", async ({
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
  await expect(page).toHaveURL(/\/files$/);
  await expect(page.locator(".workspace-file-list")).toContainText("used.txt");
  await expect(page.locator(".workspace-file-list")).toContainText("unused.txt");
  await expect(page.getByText("근거로 활용됨", { exact: true })).toBeVisible();
  await page.goto(`${base}/files?evidence=1`);
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
  const reply = page.locator(".workspace-message--assistant p[data-reply-revealing]");
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
  await expect(page.locator(".workspace-message--assistant > p")).toHaveText(text);
  await page.reload();
  await expect(page.locator(".workspace-message--assistant > p")).toHaveText(text);
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
  await expect(page.locator(".workspace-message--assistant > p")).toHaveText(text);
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
  const text = "한 문장씩 편하게 읽으실 수 있어요. 합성 검증입니다.\n".repeat(60);
  await publishSyntheticReply(page, text);
  const reply = page.locator(".workspace-message--assistant p[data-reply-revealing]");
  await expect(reply).toHaveCount(1);
  const start = (await reply.textContent())?.length ?? 0;
  await expect
    .poll(async () => (await reply.textContent())?.length ?? 0)
    .toBeGreaterThan(start + 20);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  expect(
    await page.getByRole("log", { name: "사건 대화" }).evaluate((node) => node.scrollTop),
  ).toBe(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(reply).toHaveCount(0);
  await expect(page.locator(".workspace-message--assistant > p")).toHaveText(text);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  expect(
    await page.getByRole("log", { name: "사건 대화" }).evaluate((node) => node.scrollTop),
  ).toBe(0);
});

test("long chat scrolls internally while tabs and composer stay in place across screen sizes", async ({
  page,
}) => {
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
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 650 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() => log.evaluate((node) => node.clientHeight))
      .toBeGreaterThan(Math.min(220, viewport.height / 4));
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
    const tabs = page.getByRole("navigation", { name: "사건 메뉴" });
    const before = await tabs.boundingBox();
    const composer = await page.locator(".workspace-composer").boundingBox();
    const bounds = await log.boundingBox();
    if (!before || !composer || !bounds) throw new Error("Synthetic chat layout missing");
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.wheel(0, 600);
    await expect.poll(() => log.evaluate((node) => node.scrollTop)).toBeGreaterThan(100);
    expect((await tabs.boundingBox())?.y).toBeCloseTo(before.y, 1);
    expect((await page.locator(".workspace-composer").boundingBox())?.y).toBeCloseTo(composer.y, 1);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    expect(composer.y + composer.height).toBeLessThanOrEqual(viewport.height + 1);
    const preparation = await page.locator(".workspace-sidebar").boundingBox();
    expect(preparation?.y).toBeGreaterThan(composer.y + composer.height);
    if (viewport.height >= 650) {
      await expect(page.getByLabel("추가 사실 또는 질문")).toBeInViewport();
      await expect(page.getByRole("button", { name: "보내기", exact: true })).toBeInViewport();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await log.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await page.mouse.wheel(0, 3000);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    if (viewport.width === 390 || viewport.width === 1440)
      await page.screenshot({ path: `.wrangler/chat-scroll-${viewport.width}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".workspace-sidebar").scrollIntoViewIfNeeded();
  await expect(page.locator(".workspace-sidebar")).toBeInViewport();
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await page
    .getByRole("navigation", { name: "사건 메뉴" })
    .getByRole("link", { name: /타임라인/ })
    .click();
  await expect(page).toHaveURL(/\/timeline$/);
  expect(await page.locator("body").evaluate((node) => getComputedStyle(node).overflowY)).not.toBe(
    "hidden",
  );
  await page
    .getByRole("navigation", { name: "사건 메뉴" })
    .getByRole("link", { name: "대화", exact: true })
    .click();
  await expect(log.locator("article")).toHaveCount(24);
  await expect(page.locator(".case-options")).toHaveCount(0);
});
