import { expect, test } from "@playwright/test";

for (const failSession of [false, true]) {
  test(`action optimistic UI with session preflight failure=${failSession}`, async ({ page }) => {
    await page.goto("/cases/synthetic-case?tab=actions");
    await page.getByRole("link", { name: "다음 행동", exact: true }).click();
    const checkbox = page.getByRole("checkbox").first();
    await expect(checkbox).not.toBeChecked();
    await expect(checkbox).toBeEnabled();
    await page.evaluate(async (fail) => {
      const modulePath = "/tests/helpers/workspace-client-fixture.ts";
      const { api } = (await import(
        modulePath
      )) as typeof import("../helpers/workspace-client-fixture");
      const state = window as unknown as Window & { reviewWrites: number };
      state.reviewWrites = 0;
      const write = api.workspace.setAction;
      api.workspace.setAction = async (...args: Parameters<typeof write>) => {
        state.reviewWrites++;
        return write(...args);
      };
      if (fail) {
        const original = api.session.get;
        api.session.get = async () => {
          api.session.get = original;
          throw Object.assign(new Error("합성 세션 장애"), {
            code: "UNAVAILABLE",
            retryable: true,
          });
        };
      }
    }, failSession);
    await checkbox.click();
    if (failSession) await expect(page.getByRole("alert")).toBeVisible();
    else await expect(page.getByText("완료 표시를 저장했어요.", { exact: true })).toBeVisible();
    if (failSession) await expect(checkbox).not.toBeChecked();
    else await expect(checkbox).toBeChecked();
    const stored = await page.evaluate(async () => {
      const modulePath = "/tests/helpers/workspace-client-fixture.ts";
      const { api } = (await import(
        modulePath
      )) as typeof import("../helpers/workspace-client-fixture");
      return {
        done: (await api.workspace.get("synthetic-case")).actions[0]?.done,
        writes: (window as unknown as Window & { reviewWrites: number }).reviewWrites,
      };
    });
    expect(stored).toEqual(failSession ? { done: false, writes: 0 } : { done: true, writes: 1 });
    if (failSession) {
      await page.evaluate(async () => {
        const modulePath = "/tests/helpers/workspace-client-fixture.ts";
        const { api } = (await import(
          modulePath
        )) as typeof import("../helpers/workspace-client-fixture");
        const original = api.workspace.get;
        api.workspace.get = async () => {
          api.workspace.get = original;
          throw Object.assign(new Error("합성 최신 조회 장애"), {
            code: "UNAVAILABLE",
            retryable: true,
          });
        };
      });
      await page.getByRole("button", { name: "새로고침 · 다시 확인", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("합성 최신 조회 장애");
      await expect(page.getByText("최신 내용을 불러왔어요.", { exact: true })).toHaveCount(0);
    }
  });
}
for (const closeBeforeRecovery of [false, true])
  test(`timeline creation recovers without duplication; close dialog=${closeBeforeRecovery}`, async ({
    page,
  }) => {
    await page.goto("/cases/synthetic-case");
    await page.getByRole("link", { name: "타임라인", exact: true }).click();
    await page.getByRole("button", { name: "일정 추가", exact: true }).click();
    await page.getByLabel("어떤 일이 있었나요?").fill("세션 확인 실패 후 중복되는 합성 일정");
    await page.evaluate(async () => {
      const modulePath = "/tests/helpers/workspace-client-fixture.ts";
      const { api } = (await import(
        modulePath
      )) as typeof import("../helpers/workspace-client-fixture");
      const original = api.workspace.saveTimeline;
      api.workspace.saveTimeline = async (...args: Parameters<typeof original>) => {
        api.workspace.saveTimeline = original;
        const next = await original(...args);
        const session = api.session.get;
        api.session.get = async () => {
          api.session.get = session;
          throw Object.assign(new Error("합성 저장 후 세션 장애"), {
            code: "UNAVAILABLE",
            retryable: true,
          });
        };
        return next;
      };
    });
    const save = page.getByRole("button", { name: "타임라인 저장", exact: true });
    await save.click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "합성 저장 후 세션 장애",
    );
    const count = () =>
      page.evaluate(async () => {
        const modulePath = "/tests/helpers/workspace-client-fixture.ts";
        const { api } = (await import(
          modulePath
        )) as typeof import("../helpers/workspace-client-fixture");
        return (await api.workspace.get("synthetic-case")).timeline.filter(
          (item) => item.title === "세션 확인 실패 후 중복되는 합성 일정",
        ).length;
      });
    expect(await count()).toBe(1);
    if (closeBeforeRecovery) {
      await page.getByRole("dialog").getByRole("button", { name: "취소", exact: true }).click();
      await page.getByRole("button", { name: "일정 추가", exact: true }).click();
      await page.getByLabel("어떤 일이 있었나요?").fill("복구 창을 닫은 뒤 추가한 별도 일정");
    }
    await save.click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    expect(await count()).toBe(1);
    if (closeBeforeRecovery)
      await expect(
        page.getByText("복구 창을 닫은 뒤 추가한 별도 일정", { exact: true }),
      ).toBeVisible();
  });

for (const retryImmediately of [true, false])
  test(`partial bulk upload failure; retry immediately=${retryImmediately}`, async ({ page }) => {
    await page.goto("/cases/synthetic-case/files");
    await page.getByLabel("선택 자료의 자동 처리에 동의합니다.").check();
    await page.evaluate(async () => {
      const path = "/tests/helpers/workspace-client-fixture.ts",
        { api } = (await import(path)) as typeof import("../helpers/workspace-client-fixture");
      const original = api.files.upload;
      let calls = 0;
      api.files.upload = async (...args: Parameters<typeof original>) => {
        if (++calls === 2) {
          const key = "baro-c-contract-test-state",
            state = JSON.parse(localStorage.getItem(key)!);
          state.faults = { "files.uploadPart": ["UNAVAILABLE"] };
          localStorage.setItem(key, JSON.stringify(state));
        }
        return original(...args);
      };
    });
    await page.getByLabel("업로드할 파일 선택").setInputFiles([
      {
        name: "first-success.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("First synthetic original"),
      },
      {
        name: "second-failure.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Second synthetic original"),
      },
    ]);
    const retry = page.getByRole("button", { name: "업로드 다시 시도", exact: true });
    await expect(retry).toBeVisible();
    if (retryImmediately) {
      await retry.click();
      await expect(
        page.getByText("자료를 저장했어요. 처리 상태와 확인 가능한 범위를 확인해 주세요.", {
          exact: true,
        }),
      ).toBeVisible();
      const statuses = await page.evaluate(async () => {
        const path = "/tests/helpers/workspace-client-fixture.ts",
          { api } = (await import(path)) as typeof import("../helpers/workspace-client-fixture");
        return (await api.files.list("synthetic-case")).map((f) => f.status);
      });
      expect(statuses.every((status) => status !== "uploading")).toBe(true);
    } else {
      await page.waitForTimeout(4000);
      await expect(retry).toBeVisible();
      await expect(page.getByRole("alert")).toBeVisible();
      const files = await page.evaluate(async () => {
        const path = "/tests/helpers/workspace-client-fixture.ts",
          { api } = (await import(path)) as typeof import("../helpers/workspace-client-fixture");
        return await api.files.list("synthetic-case");
      });
      expect(files.find((f) => f.name === "second-failure.txt")?.status).toBe("uploading");
      expect(files.find((f) => f.name === "first-success.txt")?.status).toBe("ready");
      await retry.click();
      await expect(
        page.getByText("자료를 저장했어요. 처리 상태와 확인 가능한 범위를 확인해 주세요.", {
          exact: true,
        }),
      ).toBeVisible();
    }
  });

for (const interrupted of [false, true])
  test(`original download on incomplete upload does not revoke the workspace; interrupted=${interrupted}`, async ({
    page,
  }) => {
    await page.goto("/cases/synthetic-case/files");
    await page.getByLabel("선택 자료의 자동 처리에 동의합니다.").check();
    if (interrupted)
      await page.evaluate(() => {
        const key = "baro-c-contract-test-state",
          state = JSON.parse(localStorage.getItem(key)!);
        state.faults = { "files.uploadPart": ["UNAVAILABLE"] };
        localStorage.setItem(key, JSON.stringify(state));
      });
    await page.getByLabel("업로드할 파일 선택").setInputFiles({
      name: "incomplete-original.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Synthetic original for local review"),
    });
    if (interrupted) {
      await expect(page.getByRole("alert")).toBeVisible();
      await page.getByRole("button", { name: "새로고침 · 다시 확인", exact: true }).click();
    }
    await expect(
      page.getByRole("heading", { name: "incomplete-original.txt", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "자료 확인", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    if (!interrupted)
      await page.getByRole("button", { name: "원본 확인 · 다운로드", exact: true }).click();
    if (interrupted) {
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "원본 확인 · 다운로드", exact: true }),
      ).toBeDisabled();
      await expect(
        page
          .getByRole("dialog")
          .getByRole("heading", { name: "incomplete-original.txt", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("계정 또는 사건 접근이 바뀌어 이전 내용을 비웠어요."),
      ).toHaveCount(0);
      const authoritative = await page.evaluate(async () => {
        const path = "/tests/helpers/workspace-client-fixture.ts",
          { api } = (await import(path)) as typeof import("../helpers/workspace-client-fixture");
        return {
          session: await api.session.get(),
          view: await api.workspace.get("synthetic-case"),
        };
      });
      expect(authoritative.session.user?.id).toBe("synthetic-owner");
      expect(authoritative.view.case.id).toBe("synthetic-case");
      expect(authoritative.view.files).toHaveLength(1);
      expect(authoritative.view.files[0]?.status).toBe("uploading");
    } else {
      await expect(
        page.getByText("원본을 내려받았어요. 파일을 열어 확인하세요.", { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("dialog")).toBeVisible();
    }
  });

for (const retryable of [false, true])
  test(`failed chat exposes only allowed retries=${retryable}`, async ({ page }) => {
    await page.goto("/cases/synthetic-case");
    await expect(page.getByRole("textbox", { name: "추가 사실 또는 질문" })).toBeVisible();
    await page.evaluate((retryable) => {
      const key = "baro-c-contract-test-state",
        state = JSON.parse(localStorage.getItem(key)!);
      state.workspace["synthetic-case"].messages.push({
        id: "synthetic-failed",
        role: "assistant",
        text: "합성 응답 실패",
        status: "failed",
        retryable,
        createdAt: new Date().toISOString(),
      });
      localStorage.setItem(key, JSON.stringify(state));
    }, retryable);
    await page.reload();
    await expect(page.getByText("합성 응답 실패", { exact: true })).toBeVisible();
    const retry = page.getByRole("button", { name: "응답 다시 시도", exact: true });
    if (retryable) await expect(retry).toBeEnabled();
    else await expect(retry).toHaveCount(0);
  });
test("deferred upload can start processing; queued file cannot start a duplicate job", async ({
  page,
}) => {
  await page.goto("/cases/synthetic-case/files");
  await expect(page.getByLabel("선택 자료의 자동 처리에 동의합니다.")).toBeVisible();
  await page.evaluate(() => {
    const key = "baro-c-contract-test-state",
      state = JSON.parse(localStorage.getItem(key)!);
    state.files["synthetic-case"].push({
      id: "synthetic-uploaded",
      name: "deferred.txt",
      mimeType: "text/plain",
      sizeBytes: 20,
      status: "waiting",
      canStartProcessing: true,
      coverage: "처리 시작 대기",
      extractedText: "",
    });
    state.files["synthetic-case"].push({
      id: "synthetic-queued",
      name: "queued.txt",
      mimeType: "text/plain",
      sizeBytes: 20,
      status: "waiting",
      canStartProcessing: false,
      coverage: "처리 대기",
      extractedText: "",
    });
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "자료 처리 시작", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "자료 처리 시작", exact: true }).click();
  await expect(page.getByRole("button", { name: "자료 처리 시작", exact: true })).toHaveCount(0);
  await expect(page.getByText("결과 확인 가능", { exact: true })).toBeVisible();
});
test("missing original keeps an authorized workspace and its editor", async ({ page }) => {
  await page.goto("/cases/synthetic-case/files");
  await page.getByLabel("선택 자료의 자동 처리에 동의합니다.").check();
  await page.getByLabel("업로드할 파일 선택").setInputFiles({
    name: "missing-original.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Synthetic original"),
  });
  await page.getByRole("button", { name: "자료 확인", exact: true }).click();
  await page.evaluate(async () => {
    const path = "/tests/helpers/workspace-client-fixture.ts",
      { api } = (await import(path)) as typeof import("../helpers/workspace-client-fixture");
    api.files.original = async () => {
      throw Object.assign(new Error("선택한 자료를 찾을 수 없어요."), { code: "NOT_FOUND" });
    };
  });
  await page.getByRole("button", { name: "원본 확인 · 다운로드", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "선택한 자료를 찾을 수 없어요.",
  );
  await expect(page.getByText("계정 또는 사건 접근이 바뀌어 이전 내용을 비웠어요.")).toHaveCount(0);
});
