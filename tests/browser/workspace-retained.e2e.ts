import { expect, type Page, test } from "@playwright/test";
import {
  countMaterialsRequests,
  materialsCasePath,
  seedMaterialsScenario,
} from "../helpers/workspace-materials-scenario";
import { openCaseTool } from "../helpers/workspace-navigation";

const navigation = (page: Page) => page.getByRole("navigation", { name: "사건 작업", exact: true });
const input = (page: Page) =>
  page.getByRole("textbox", { name: "추가 사실 또는 질문", exact: true });
async function task(page: Page, name: string | RegExp) {
  await navigation(page)
    .getByRole("link", { name, exact: typeof name === "string" })
    .click();
}

for (const width of [320, 390, 1440]) {
  test(`${width}px: retained tasks preserve actual File bytes, text, DOM and history without automatic execution`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await seedMaterialsScenario(page, { messages: 30 });
    await page.goto(materialsCasePath);
    await expect(input(page)).toBeEnabled();
    await input(page).fill("리포트를 읽어도 남아 있어야 하는 미전송 한글 설명입니다.");
    await input(page).evaluate((node) => node.setAttribute("data-retained", "original"));
    await page.locator("#workspace-upload").setInputFiles({
      name: "retained-original.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("합성 원본 바이트. File 객체를 유지했는지 확인합니다."),
    });
    await expect(page.getByRole("list", { name: "이번 메시지의 첨부 파일" })).toContainText(
      "retained-original.txt",
    );
    await countMaterialsRequests(page);
    await page.evaluate(async () => {
      const path = "/src/client/api/index.ts";
      const { api } = (await import(path)) as typeof import("../../src/client/api");
      const observed = window as unknown as { retainedUploads: number };
      observed.retainedUploads = 0;
      const upload = api.files.upload;
      api.files.upload = async (...args: Parameters<typeof upload>) => {
        observed.retainedUploads++;
        if (!(args[1] instanceof File)) throw new Error("File object was not retained");
        return upload(...args);
      };
    });
    await task(page, /^자료/);
    await expect(page).toHaveURL(/\/files$/);
    await expect(input(page)).toBeHidden();
    await task(page, "리포트");
    await expect(page).toHaveURL(/\/reports\?mode=conversation$/);
    await expect(page.locator(".report-review")).toBeVisible();
    await page
      .locator(".report-review")
      .evaluate((node) => node.setAttribute("data-retained", "report-original"));
    await task(page, "문서 초안");
    await expect(page).toHaveURL(/#document-drafts$/);
    await expect(page.locator(".report-review")).toHaveAttribute(
      "data-retained",
      "report-original",
    );
    await page.goBack();
    await expect(page).toHaveURL(/\/reports\?mode=conversation$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/files$/);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${materialsCasePath}$`));
    await expect(input(page)).toHaveValue(
      "리포트를 읽어도 남아 있어야 하는 미전송 한글 설명입니다.",
    );
    await expect(input(page)).toHaveAttribute("data-retained", "original");
    await expect(page.getByRole("list", { name: "이번 메시지의 첨부 파일" })).toContainText(
      "retained-original.txt",
    );
    expect(
      await page.evaluate(() => {
        const observed = window as unknown as {
          retainedUploads: number;
          materialsRequestCounts: { action: number; send: number };
        };
        return {
          uploads: observed.retainedUploads,
          action: observed.materialsRequestCounts.action,
          send: observed.materialsRequestCounts.send,
        };
      }),
    ).toEqual({ uploads: 0, action: 0, send: 0 });
    await openCaseTool(page, "타임라인");
    const warning = page.getByRole("dialog", {
      name: "작성 중인 내용을 두고 이동할까요?",
      exact: true,
    });
    await expect(warning).toContainText("retained-original.txt");
    await warning.getByRole("button", { name: "이 화면에서 계속 작성", exact: true }).click();
    await expect(input(page)).toHaveValue(/미전송 한글/);
    await task(page, /^자료/);
    await page
      .getByRole("checkbox", { name: "첨부한 파일의 자동 처리에 동의합니다.", exact: true })
      .check();
    await page.getByRole("button", { name: "선택한 자료 업로드", exact: true }).click();
    await expect(
      page
        .locator(".workspace-file-list")
        .getByRole("heading", { name: "retained-original.txt", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(async () => {
        const path = "/src/client/api/index.ts";
        const { api } = (await import(path)) as typeof import("../../src/client/api");
        const files = await api.files.list("synthetic-case");
        const file = files.find((file) => file.name === "retained-original.txt");
        if (!file) throw new Error("Uploaded retained file missing");
        return (await api.files.original("synthetic-case", file.id)).text();
      }),
    ).toBe("합성 원본 바이트. File 객체를 유지했는지 확인합니다.");
    await task(page, "대화");
    await expect(input(page)).toHaveValue(/미전송 한글/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  });
}

test("asking about a material prepares selection without overwriting or sending the draft", async ({
  page,
}) => {
  await seedMaterialsScenario(page);
  await page.goto(materialsCasePath);
  await input(page).fill("아직 다 쓰지 않은 사용자 설명");
  await countMaterialsRequests(page);
  await task(page, /^자료/);
  await page.getByRole("button", { name: "이 자료로 질문하기", exact: true }).first().click();
  await expect(input(page)).toHaveValue("아직 다 쓰지 않은 사용자 설명");
  await expect(page.locator(".workspace-evidence summary")).toContainText("1개 선택");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { materialsRequestCounts: { send: number } }).materialsRequestCounts
          .send,
    ),
  ).toBe(0);
});
