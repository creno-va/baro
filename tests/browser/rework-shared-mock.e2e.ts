import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Actual shared mock namespace, not an aliased component/client fixture. It
// explicitly has no legal provider: these tests must never assert verified law.
test.skip(process.env.BARO_REWORK_SHARED_MOCK !== "true", "Shared rework mock main gate required");

for (const purpose of ["고소·청구를 준비하고 싶어요", "상대방 주장에 대응하고 싶어요"] as const)
  test(`shared mock ${purpose}: actual intake and inline limited report preserve unavailable law`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto("/login");
    await page.getByRole("button", { name: "Google로 계속하기", exact: true }).click();
    await expect(page).toHaveURL(/\/consent$/);
    await page
      .getByLabel("이용약관, 개인정보 처리방침, AI 이용 고지를 확인하고 동의합니다.")
      .check();
    await page.getByRole("button", { name: "동의하고 계속하기", exact: true }).click();
    await page.goto("/cases/new");
    await page.getByRole("radio", { name: purpose, exact: true }).check();
    await page
      .getByLabel("지금까지 있었던 일", { exact: true })
      .fill(
        "공통 예시 모드의 합성 검증 사건입니다. 계약과 반환 약속을 정리하려고 하며 정확한 반환 날짜는 아직 확인하지 못했습니다.",
      );
    await page.getByRole("button", { name: "저장하고 계속", exact: true }).click();
    for (let index = 0; index < 6; index++) {
      await expect(
        page.getByText(`${Math.floor(index / 3) + 1}차 질문 · ${(index % 3) + 1} / 3`, {
          exact: true,
        }),
      ).toBeVisible();
      await page.getByRole("button", { name: "모름", exact: true }).click();
    }
    await expect(page).toHaveURL(/\/summary$/);
    await page.getByRole("button", { name: "맞아요", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "확인하고 계속", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "추가 사실 또는 질문", exact: true }),
    ).toBeEnabled();
    const conversationUrl = new URL(page.url()).pathname;
    const actions = page.getByRole("group", { name: "대화에서 이어갈 작업", exact: true });
    await expect(actions).toBeVisible();
    await actions.getByText("다른 작업", { exact: true }).click();
    await actions.getByRole("button", { name: "자료 추가·검토", exact: true }).click();
    const materials = page.getByRole("region", { name: "자료 추가와 검토", exact: true });
    const chooser = page.waitForEvent("filechooser");
    await materials.getByRole("button", { name: "파일 선택", exact: true }).click();
    await (await chooser).setFiles({
      name: "shared-inline.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("공통 예시 모드 합성 원본. 반환 약속 날짜는 아직 미확인입니다."),
    });
    await page
      .getByRole("checkbox", { name: "첨부한 파일의 자동 처리에 동의합니다.", exact: true })
      .check();
    await page.getByRole("button", { name: "보내기", exact: true }).click();
    const attachment = page
      .locator(".workspace-message-attachments")
      .getByRole("link", { name: "shared-inline.txt", exact: true })
      .last();
    await expect(attachment).toBeVisible();
    await attachment.click();
    await expect(
      page.getByRole("dialog").getByRole("heading", { name: "shared-inline.txt", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("textbox", { name: "추가 사실 또는 질문", exact: true }),
    ).toBeEnabled();
    await actions.getByText("다른 작업", { exact: true }).click();
    await actions.getByRole("button", { name: "사건 정리 재확인", exact: true }).click();
    const reconfirmation = page.getByRole("region", { name: "사건 정리 재확인", exact: true });
    const contextOpener = reconfirmation.getByRole("button", {
      name: "입장·절차 확인",
      exact: true,
    });
    await contextOpener.focus();
    await page.keyboard.press("Enter");
    const contextDialog = page.getByRole("dialog", { name: "입장과 절차 확인", exact: true });
    await expect(
      contextDialog.getByRole("combobox", { name: "사건 입장", exact: true }),
    ).toHaveValue(purpose.startsWith("고소") ? "prepare_claim" : "respond_to_claim");
    await expect(
      contextDialog.getByRole("combobox", { name: "사건 분야", exact: true }),
    ).toHaveValue("unconfirmed");
    await expect(
      contextDialog.getByRole("combobox", { name: "진행 단계", exact: true }),
    ).toHaveValue("unconfirmed");
    await contextDialog
      .getByRole("textbox", { name: "확인한 진행 상황 (선택)", exact: true })
      .fill("   ");
    await expect(
      contextDialog.getByRole("button", { name: "입장·절차 저장", exact: true }),
    ).toBeDisabled();
    await contextDialog
      .getByRole("combobox", { name: "진행 단계", exact: true })
      .selectOption("first_instance");
    await contextDialog
      .getByRole("combobox", { name: "사건 분야", exact: true })
      .selectOption("criminal");
    await expect(
      contextDialog.getByRole("combobox", { name: "진행 단계", exact: true }),
    ).toHaveValue("first_instance");
    await contextDialog
      .getByRole("combobox", { name: "사건 분야", exact: true })
      .selectOption("civil");
    await contextDialog
      .getByLabel("확인한 진행 상황 (선택)", { exact: true })
      .fill("사용자가 명시적으로 확인한 합성 진행 단계입니다.");
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.keyboard.press("Escape");
    await expect(
      contextDialog.getByRole("combobox", { name: "진행 단계", exact: true }),
    ).toHaveValue("first_instance");
    page.once("dialog", (dialog) => dialog.accept());
    await page.keyboard.press("Escape");
    await expect(contextDialog).not.toBeVisible();
    await expect(contextOpener).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      contextDialog.getByRole("combobox", { name: "진행 단계", exact: true }),
    ).toHaveValue("unconfirmed");
    await contextDialog
      .getByRole("combobox", { name: "사건 분야", exact: true })
      .selectOption("civil");
    await contextDialog
      .getByRole("combobox", { name: "진행 단계", exact: true })
      .selectOption("first_instance");
    await contextDialog
      .getByRole("textbox", { name: "확인한 진행 상황 (선택)", exact: true })
      .fill("사용자가 명시적으로 확인한 합성 진행 단계입니다.");
    await page.evaluate(async () => {
      const path = "/src/client/api/index.ts";
      const { api } = (await import(path)) as typeof import("../../src/client/api/index");
      const id = decodeURIComponent(location.pathname.split("/")[2] ?? "");
      const current = await api.rework.getContext(id);
      if (current.context.casePurpose === "unconfirmed")
        throw new Error("MISSING_EXPLICIT_CASE_PURPOSE");
      await api.rework.updateContext(id, {
        expectedRevision: current.workspaceRevision,
        casePurpose: current.context.casePurpose,
        subjectContext: current.context.subjectContext,
        procedure: { ...current.context.procedure, description: "다른 탭에서 기록한 합성 현재값" },
      });
    });
    await contextDialog.getByRole("button", { name: "입장·절차 저장", exact: true }).click();
    await expect(contextDialog.getByRole("alert")).toContainText("다른 곳에서 사건이 바뀌었어요");
    await expect(
      contextDialog.getByRole("textbox", { name: "확인한 진행 상황 (선택)", exact: true }),
    ).toHaveValue("사용자가 명시적으로 확인한 합성 진행 단계입니다.");
    await expect(
      contextDialog.getByRole("button", { name: "입장·절차 저장", exact: true }),
    ).toBeDisabled();
    await contextDialog.getByRole("button", { name: "최신 기준 불러오기", exact: true }).click();
    await expect(
      contextDialog.getByText("다른 탭에서 기록한 합성 현재값", { exact: true }),
    ).toBeVisible();
    if (purpose.startsWith("고소")) {
      expect(
        (await new AxeBuilder({ page }).include("dialog[open]").analyze()).violations.filter(
          (violation) => ["serious", "critical"].includes(violation.impact ?? ""),
        ),
      ).toEqual([]);
      const bounds = await contextDialog.boundingBox();
      expect(bounds?.y).toBeGreaterThanOrEqual(0);
      expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(
        await page.evaluate(() => innerHeight + 1),
      );
      await page.screenshot({ path: "/tmp/baro-625-context-320.png" });
    }
    await contextDialog
      .getByRole("checkbox", { name: "현재 저장된 값과 선택한 변경을 비교했어요.", exact: true })
      .check();
    await contextDialog.getByRole("button", { name: "입장·절차 저장", exact: true }).click();
    await expect(contextDialog).not.toBeVisible();
    await expect(
      page.getByRole("heading", { name: "법률·판례와 현재 약점", exact: true }),
    ).toBeFocused();
    await actions.getByRole("button", { name: "법률·판례와 현재 약점 확인", exact: true }).click();
    const analysis = page.getByRole("region", { name: "법률·판례와 현재 약점", exact: true });
    await expect(
      analysis.getByText("공식 근거를 확인하지 못했어요", { exact: true }),
    ).toBeVisible();
    await expect(analysis.getByRole("link", { name: /공식 원문/ })).toHaveCount(0);
    await actions.getByRole("button", { name: "리포트 준비·검토", exact: true }).click();
    const report = page.getByRole("region", { name: "리포트 준비와 검토", exact: true });
    await expect(
      report.getByRole("heading", { name: "다음으로 어떻게 진행할까요?", exact: true }),
    ).toBeVisible();
    await expect(report).toContainText(/보완 필요|확인하지 못|원문 확인/);
    if (purpose.startsWith("고소"))
      await page.screenshot({ path: "/tmp/baro-625-report-inline-320.png", fullPage: true });
    expect(new URL(page.url()).pathname).toBe(conversationUrl);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(
      page.getByRole("textbox", { name: "추가 사실 또는 질문", exact: true }),
    ).toBeInViewport();
  });
