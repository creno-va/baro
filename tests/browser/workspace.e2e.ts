import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { captureCaseViewports } from "../helpers/case-ui-capture";

// This isolated C contract suite also runs before A's shared facade is available.
// Enable with: BARO_C_TEST_API=true bunx playwright test --config tests/helpers/workspace.playwright.config.ts
// It renders the same product routes/components and persists the API mock, including real upload bytes.
test.skip(
  process.env.BARO_C_TEST_API !== "true",
  "Run with the isolated workspace contract configuration.",
);
const key = "baro-c-contract-test-state";
const base = "/cases/synthetic-case";

for (const remainder of [false, true])
  test(`permanent file rejection requires a changed file and preserves only unattempted selections: ${remainder}`, async ({
    page,
  }) => {
    await page.goto(`${base}/files`);
    await expect(page.getByRole("heading", { name: "아직 자료가 없어요" })).toBeVisible();
    await page.evaluate(async () => {
      const fixturePath = "/tests/helpers/workspace-client-fixture.ts";
      const { api } = (await import(
        fixturePath
      )) as typeof import("../helpers/workspace-client-fixture");
      const responsePath = "/src/client/api/workspace.ts";
      const { workspaceResponse } = (await import(
        responsePath
      )) as typeof import("../../src/client/api/workspace");
      const upload = api.files.upload;
      const state = window as unknown as { rejectedUploadNames: string[] };
      state.rejectedUploadNames = [];
      api.files.upload = async (...args: Parameters<typeof upload>) => {
        state.rejectedUploadNames.push(args[1].name);
        if (args[1].name === "protected.xls")
          await workspaceResponse(
            Response.json(
              {
                error: {
                  code: "FILE_REJECTED",
                  retryable: false,
                  message: "UNTRUSTED_PROVIDER_DETAIL",
                },
              },
              { status: 400 },
            ),
          );
        return upload(...args);
      };
    });
    await page.getByLabel("선택 자료의 자동 처리에 동의합니다.").check();
    const names = remainder ? ["accepted.txt", "protected.xls", "later.txt"] : ["protected.xls"];
    await page.getByLabel("업로드할 파일 선택", { exact: true }).setInputFiles(
      names.map((name) => ({
        name,
        mimeType: "text/plain",
        buffer: Buffer.from("Synthetic selected bytes"),
      })),
    );
    const alert = page.getByRole("alert");
    await expect(alert).toContainText(
      "암호·보호를 해제하거나 지원하는 형식으로 저장한 뒤 다시 추가해 주세요.",
    );
    await expect(alert).not.toContainText("UNTRUSTED_PROVIDER_DETAIL");
    await expect(page.getByText(/업로드 시작 후/)).toHaveCount(0);
    const retry = page.getByRole("button", { name: "업로드 다시 시도", exact: true });
    if (remainder) {
      await expect(retry).toBeEnabled();
      await retry.click();
      await expect(page.getByRole("heading", { name: "later.txt", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "accepted.txt", exact: true })).toBeVisible();
    }
    await expect(retry).toHaveCount(0);
    if (!remainder) {
      await page.getByLabel("업로드할 파일 선택", { exact: true }).setInputFiles({
        name: "corrected.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Synthetic corrected original bytes"),
      });
      await expect(page.getByRole("heading", { name: "corrected.txt", exact: true })).toBeVisible();
      names.push("corrected.txt");
    }
    expect(
      await page.evaluate(
        () => (window as unknown as { rejectedUploadNames: string[] }).rejectedUploadNames,
      ),
    ).toEqual(names);
  });

async function prepareFileRetry(page: Page) {
  await page.goto(`${base}/files`);
  await expect(page.getByRole("heading", { name: "아직 자료가 없어요" })).toBeVisible();
  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key) ?? "{}");
    state.caseOwners = { "synthetic-case": state.session.user.id };
    state.files["synthetic-case"] = ["first", "selected"].map((id) => ({
      id,
      name: `${id}-private.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 10,
      status: "failed",
      coverage: "private synthetic coverage",
      extractedText: "",
      failure: "FILE_PROCESSING_FAILED",
      canRetry: true,
      createdAt: "2026-10-15T00:00:00.000Z",
    }));
    localStorage.setItem(key, JSON.stringify(state));
  }, key);
  await page.reload();
  const retry = page.getByRole("button", { name: "처리 다시 시도", exact: true }).nth(1);
  await expect(retry).toBeVisible();
  await page.evaluate(async (key) => {
    const path = "/tests/helpers/workspace-client-fixture.ts";
    const { api } = (await import(path)) as typeof import("../helpers/workspace-client-fixture");
    const owner = await api.session.get();
    const pending: { resolve: (value: typeof owner) => void; reject: (reason: Error) => void }[] =
      [];
    const state = window as unknown as {
      retryIds: string[];
      releaseFileFocus: (result?: string) => void;
    };
    state.retryIds = [];
    api.session.get = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
    state.releaseFileFocus = (result = "same-owner") => {
      if (!owner.user) throw new Error("Missing synthetic owner");
      const next = {
        ...owner,
        user:
          result === "signed-out"
            ? null
            : {
                ...owner.user,
                id: result === "other-owner" ? "other-owner" : owner.user.id,
                accountType: result === "lawyer" ? ("lawyer" as const) : ("customer" as const),
              },
        needsConsent: result === "consent",
      };
      const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
      saved.session = next;
      localStorage.setItem(key, JSON.stringify(saved));
      api.session.get = async () => next;
      for (const check of pending)
        if (result === "unavailable") check.reject(new Error("Synthetic session outage"));
        else check.resolve(next);
    };
    const execute = api.files.retry;
    api.files.retry = async (...args: Parameters<typeof execute>) => {
      state.retryIds.push(args[1]);
      return execute(...args);
    };
  }, key);
  return retry;
}

test("non-format upload validation preserves the unchanged file for explicit recovery", async ({
  page,
}) => {
  await page.goto(`${base}/files`);
  await expect(page.getByRole("heading", { name: "아직 자료가 없어요" })).toBeVisible();
  await page.evaluate(async () => {
    const fixturePath = "/tests/helpers/workspace-client-fixture.ts";
    const { api } = (await import(
      fixturePath
    )) as typeof import("../helpers/workspace-client-fixture");
    const responsePath = "/src/client/api/workspace.ts";
    const { workspaceResponse } = (await import(
      responsePath
    )) as typeof import("../../src/client/api/workspace");
    const upload = api.files.upload;
    const state = window as unknown as { partRetryFiles: File[] };
    state.partRetryFiles = [];
    api.files.upload = async (...args: Parameters<typeof upload>) => {
      state.partRetryFiles.push(args[1]);
      if (state.partRetryFiles.length === 1)
        await workspaceResponse(
          Response.json({ error: { code: "VALIDATION_ERROR", retryable: false } }, { status: 400 }),
        );
      return upload(...args);
    };
  });
  await page.getByLabel("선택 자료의 자동 처리에 동의합니다.").check();
  await page.getByLabel("업로드할 파일 선택", { exact: true }).setInputFiles({
    name: "same-original.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Synthetic interrupted original"),
  });
  await expect(page.getByRole("alert")).toContainText("입력 또는 파일 형식·크기를 확인해 주세요.");
  await page.getByRole("button", { name: "업로드 다시 시도", exact: true }).click();
  await expect(page.getByRole("heading", { name: "same-original.txt", exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => {
      const files = (window as unknown as { partRetryFiles: File[] }).partRetryFiles;
      return files.length === 2 && files[0] === files[1];
    }),
  ).toBe(true);
});
async function releaseFileFocus(page: Page, result = "same-owner") {
  await page.evaluate(
    (result) =>
      (window as unknown as { releaseFileFocus: (result: string) => void }).releaseFileFocus(
        result,
      ),
    result,
  );
}
async function retryIds(page: Page) {
  return page.evaluate(() => (window as unknown as { retryIds: string[] }).retryIds);
}
for (const scenario of [
  "normal",
  "focus",
  "other-owner",
  "lawyer",
  "consent",
  "signed-out",
  "unavailable",
  "revoked",
  "double",
  "drag",
  "pointer-cancel",
] as const)
  test(`file retry pointer preserves selected target and security: ${scenario}`, async ({
    page,
  }) => {
    const retry = await prepareFileRetry(page);
    if (scenario !== "normal")
      await retry.evaluate((button) =>
        button.addEventListener(
          "pointerdown",
          () => {
            window.dispatchEvent(new Event("focus"));
          },
          { once: true },
        ),
      );
    await retry.scrollIntoViewIfNeeded();
    const bounds = await retry.boundingBox();
    if (!bounds) throw new Error("Missing synthetic retry button");
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    if (scenario !== "normal") {
      await expect(page.getByRole("heading", { name: "사건을 불러오는 중" })).toBeVisible();
      await expect(retry).toBeVisible();
      await expect(page.getByText("selected-private.pdf", { exact: true }).first()).toBeHidden();
      await expect(page.getByText("first-private.pdf", { exact: true }).first()).toBeHidden();
      await expect(page.getByRole("heading", { name: "selected-private.pdf" })).toBeHidden();
      await expect(page.getByText("private synthetic coverage").first()).toBeHidden();
      expect(await retry.getAttribute("title")).toBeNull();
      expect(await retry.getAttribute("aria-label")).toBeNull();
      expect(await retry.boundingBox()).toEqual(bounds);
    }
    expect(await retryIds(page)).toEqual([]);
    if (scenario === "drag" || scenario === "pointer-cancel") {
      if (scenario === "pointer-cancel") await retry.dispatchEvent("pointercancel");
      await page.mouse.move(0, 0);
    }
    await page.mouse.up();
    if (scenario === "double")
      await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    if (scenario === "revoked")
      await page.evaluate(() =>
        window.dispatchEvent(
          new CustomEvent("baro-session-changed", { detail: { reason: "signout" } }),
        ),
      );
    expect(await retryIds(page)).toEqual([]);
    await releaseFileFocus(
      page,
      ["other-owner", "lawyer", "consent", "signed-out", "unavailable"].includes(scenario)
        ? scenario
        : "same-owner",
    );
    const accepted = ["normal", "focus", "double"].includes(scenario);
    if (accepted) {
      await expect.poll(() => retryIds(page)).toEqual(["selected"]);
      await expect(
        page.getByText("자료 처리 요청이 접수됐어요. 아래에서 처리 상태를 확인할 수 있어요.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "처리 다시 시도", exact: true })).toHaveCount(
        1,
      );
    } else {
      if (["consent", "signed-out", "unavailable", "lawyer", "revoked"].includes(scenario))
        await expect(page.getByRole("alert")).toBeVisible();
      else
        await expect(
          page.getByRole("heading", {
            name: scenario === "other-owner" ? "사건을 불러오는 중" : "대여금 반환 관련 자료 정리",
          }),
        ).toBeVisible();
      expect(await retryIds(page)).toEqual([]);
      if (["other-owner", "lawyer", "signed-out", "revoked"].includes(scenario))
        await expect(page.getByText("selected-private.pdf", { exact: true })).toHaveCount(0);
    }
  });

test("file retry ACK survives readback failure and recovers by reading without resending", async ({
  page,
}) => {
  const retry = await prepareFileRetry(page);
  await releaseFileFocus(page);
  await page.evaluate(async () => {
    const path = "/tests/helpers/workspace-client-fixture.ts";
    const { api } = (await import(path)) as typeof import("../helpers/workspace-client-fixture");
    const execute = api.files.retry;
    api.files.retry = async (...args: Parameters<typeof execute>) => {
      await execute(...args);
      throw Object.assign(new Error("Synthetic readback failure"), { code: "UNAVAILABLE" });
    };
  });
  await retry.click();
  await expect(
    page.getByText(
      "자료 처리 요청은 접수됐지만 최신 상태를 확인하지 못했어요. 새로고침으로 확인해 주세요.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("자료 처리 요청은 이미 접수됐어요.");
  await expect(retry).toBeDisabled();
  expect(await retryIds(page)).toEqual(["selected"]);
  await page.getByRole("button", { name: "새로고침 · 다시 확인", exact: true }).click();
  await expect(page.getByRole("button", { name: "처리 다시 시도", exact: true })).toHaveCount(1);
  expect(await retryIds(page)).toEqual(["selected"]);
});

test("file retry ACK is retained when the files-page read fails", async ({ page }) => {
  const retry = await prepareFileRetry(page);
  await releaseFileFocus(page);
  await page.evaluate(async () => {
    const path = "/tests/helpers/workspace-client-fixture.ts";
    const { api } = (await import(path)) as typeof import("../helpers/workspace-client-fixture");
    const read = api.workspace.getFiles;
    api.workspace.getFiles = async () => {
      api.workspace.getFiles = read;
      throw Object.assign(new Error("Synthetic workspace read failure"), { code: "UNAVAILABLE" });
    };
  });
  await retry.click();
  await expect(
    page.getByText(
      "자료 처리 요청은 접수됐지만 최신 상태를 확인하지 못했어요. 새로고침으로 확인해 주세요.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("자료 처리 요청은 이미 접수됐어요.");
  await expect(retry).toBeDisabled();
  expect(await retryIds(page)).toEqual(["selected"]);
  await page.getByRole("button", { name: "새로고침 · 다시 확인", exact: true }).click();
  await expect(page.getByRole("button", { name: "처리 다시 시도", exact: true })).toHaveCount(1);
  expect(await retryIds(page)).toEqual(["selected"]);
});

test("upload progress shows distinct stages and elapsed time, then retains failure recovery", async ({
  page,
}) => {
  const now = new Date("2026-10-15T00:00:00.000Z");
  await page.clock.setFixedTime(now);
  await page.goto(`${base}/files`);
  await expect(page.getByRole("heading", { name: "아직 자료가 없어요" })).toBeVisible();
  await page.evaluate(async () => {
    const path = "/tests/helpers/workspace-client-fixture.ts";
    const { api } = (await import(path)) as typeof import("../helpers/workspace-client-fixture");
    const state = window as unknown as {
      uploadStage: (stage: "uploading" | "checking" | "confirming") => void;
      failUpload: () => void;
    };
    api.files.upload = async (_id, file, onProgress) =>
      new Promise((_resolve, reject) => {
        onProgress?.({ stage: "hashing", completedBytes: 0, totalBytes: file.size });
        state.uploadStage = (stage) =>
          onProgress?.({
            stage,
            completedBytes: stage === "uploading" ? 0 : file.size,
            totalBytes: file.size,
          });
        state.failUpload = () =>
          reject(Object.assign(new Error("합성 업로드 연결 오류"), { code: "UNAVAILABLE" }));
      });
  });
  await page.getByLabel("선택 자료의 자동 처리에 동의합니다.").check();
  await page.getByLabel("업로드할 파일 선택", { exact: true }).setInputFiles({
    name: "progress.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("합성 자료"),
  });
  await expect(page.getByText("원본 파일 확인 중", { exact: true })).toBeVisible();
  await page.clock.setFixedTime(new Date(now.getTime() + 65_000));
  await expect(page.getByText("업로드 시작 후 1분 5초", { exact: true })).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { uploadStage: (stage: string) => void }).uploadStage("uploading"),
  );
  await expect(page.getByText("원본 파일 전송 중", { exact: true })).toBeVisible();
  await expect(page.getByText(/저장 확인된 전송량 0 \/ /)).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { uploadStage: (stage: string) => void }).uploadStage("checking"),
  );
  await expect(
    page.getByText("서버에서 파일 형식과 저장 내용 확인 중", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { uploadStage: (stage: string) => void }).uploadStage("confirming"),
  );
  await expect(page.getByText("접수 결과 확인 중", { exact: true })).toBeVisible();
  await page.evaluate(() => (window as unknown as { failUpload: () => void }).failUpload());
  await expect(page.getByRole("alert")).toContainText("합성 업로드 연결 오류");
  await expect(page.getByRole("button", { name: "업로드 다시 시도", exact: true })).toBeVisible();
  await expect(page.getByText(/업로드 시작 후/)).toHaveCount(0);
});

test("accepted upload keeps refresh recovery after files-page readback fails", async ({ page }) => {
  await page.goto(`${base}/files`);
  await expect(page.getByRole("heading", { name: "아직 자료가 없어요" })).toBeVisible();
  await page.evaluate(async () => {
    const path = "/tests/helpers/workspace-client-fixture.ts";
    const { api } = (await import(path)) as typeof import("../helpers/workspace-client-fixture");
    const state = window as unknown as { uploadedNames: string[] };
    state.uploadedNames = [];
    const upload = api.files.upload;
    api.files.upload = async (...args: Parameters<typeof upload>) => {
      state.uploadedNames.push(args[1].name);
      const result = await upload(...args);
      const get = api.workspace.getFiles;
      api.workspace.getFiles = async () => {
        api.workspace.getFiles = get;
        throw Object.assign(new Error("합성 최신 목록 조회 실패"), { code: "UNAVAILABLE" });
      };
      return result;
    };
  });
  await page.getByLabel("선택 자료의 자동 처리에 동의합니다.").check();
  await page.getByLabel("업로드할 파일 선택", { exact: true }).setInputFiles({
    name: "accepted-once.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("synthetic accepted file"),
  });
  await expect(page.getByRole("alert")).toContainText("합성 최신 목록 조회 실패");
  await expect(
    page.getByText("자료는 접수됐지만 최신 목록을 확인하지 못했어요. 새로고침으로 확인해 주세요.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "아직 자료가 없어요" })).toBeVisible();
  await expect(page.getByRole("button", { name: "업로드 다시 시도", exact: true })).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText(
    "이미 접수된 자료는 다시 업로드하지 않아도 돼요",
  );
  await page.getByRole("button", { name: "새로고침 · 다시 확인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "accepted-once.txt", exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { uploadedNames: string[] }).uploadedNames),
  ).toEqual(["accepted-once.txt"]);
});

test("partial upload readback failure retries only the unaccepted remainder", async ({ page }) => {
  await page.goto(`${base}/files`);
  await expect(page.getByRole("heading", { name: "아직 자료가 없어요" })).toBeVisible();
  await page.evaluate(async () => {
    const path = "/tests/helpers/workspace-client-fixture.ts";
    const { api } = (await import(path)) as typeof import("../helpers/workspace-client-fixture");
    const state = window as unknown as { uploadedNames: string[] };
    state.uploadedNames = [];
    const upload = api.files.upload;
    api.files.upload = async (...args: Parameters<typeof upload>) => {
      state.uploadedNames.push(args[1].name);
      if (state.uploadedNames.length === 2)
        throw Object.assign(new Error("합성 두 번째 전송 실패"), { code: "UNAVAILABLE" });
      const result = await upload(...args);
      if (state.uploadedNames.length === 1) {
        const get = api.workspace.getFiles;
        api.workspace.getFiles = async () => {
          api.workspace.getFiles = get;
          throw Object.assign(new Error("합성 최신 목록 조회 실패"), { code: "UNAVAILABLE" });
        };
      }
      return result;
    };
  });
  await page.getByLabel("선택 자료의 자동 처리에 동의합니다.").check();
  await page.getByLabel("업로드할 파일 선택", { exact: true }).setInputFiles([
    { name: "accepted-first.txt", mimeType: "text/plain", buffer: Buffer.from("synthetic first") },
    {
      name: "unaccepted-second.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("synthetic second"),
    },
  ]);
  await expect(page.getByRole("alert")).toContainText("합성 두 번째 전송 실패");
  await expect(page.getByRole("alert")).toContainText(
    "이미 접수된 자료는 다시 업로드하지 않아도 돼요",
  );
  await page.getByRole("button", { name: "업로드 다시 시도", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "accepted-first.txt", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "unaccepted-second.txt", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { uploadedNames: string[] }).uploadedNames),
  ).toEqual(["accepted-first.txt", "unaccepted-second.txt", "unaccepted-second.txt"]);
});

for (const changed of ["other-owner", "lawyer", "signed-out"] as const)
  test(`accepted upload readback cannot restore revoked private content: ${changed}`, async ({
    page,
  }) => {
    await page.goto(`${base}/files`);
    await expect(page.getByRole("heading", { name: "아직 자료가 없어요" })).toBeVisible();
    await page.evaluate(async (key) => {
      const path = "/tests/helpers/workspace-client-fixture.ts";
      const { api } = (await import(path)) as typeof import("../helpers/workspace-client-fixture");
      const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
      saved.caseOwners = { "synthetic-case": saved.session.user.id };
      localStorage.setItem(key, JSON.stringify(saved));
      const state = window as unknown as {
        uploadCount: number;
        releaseUploadReadback?: () => void;
      };
      state.uploadCount = 0;
      const upload = api.files.upload;
      api.files.upload = async (...args: Parameters<typeof upload>) => {
        state.uploadCount++;
        const result = await upload(...args);
        const get = api.workspace.getFiles;
        api.workspace.getFiles = async (...read: Parameters<typeof get>) => {
          api.workspace.getFiles = get;
          const oldView = await get(...read);
          return new Promise((resolve) => {
            state.releaseUploadReadback = () => resolve(oldView);
          });
        };
        return result;
      };
    }, key);
    await page.getByLabel("선택 자료의 자동 처리에 동의합니다.").check();
    await page.getByLabel("업로드할 파일 선택", { exact: true }).setInputFiles({
      name: "accepted-private.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("synthetic private content"),
    });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            !!(window as unknown as { releaseUploadReadback?: () => void }).releaseUploadReadback,
        ),
      )
      .toBe(true);
    await page.evaluate(
      ({ key, changed }) => {
        const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
        if (changed === "signed-out") saved.session.user = null;
        else if (changed === "lawyer") saved.session.user.accountType = "lawyer";
        else saved.session.user.id = "other-owner";
        localStorage.setItem(key, JSON.stringify(saved));
        window.dispatchEvent(new Event("focus"));
      },
      { key, changed },
    );
    await expect(page.getByRole("alert")).toBeVisible();
    await page.evaluate(() =>
      (window as unknown as { releaseUploadReadback: () => void }).releaseUploadReadback(),
    );
    await expect(page.getByText("accepted-private.txt", { exact: true })).toHaveCount(0);
    await expect(
      page.getByText("자료를 저장했어요. 처리 상태와 확인 가능한 범위를 확인해 주세요.", {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "접수 상태 다시 확인", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "업로드 다시 시도", exact: true })).toHaveCount(
      0,
    );
    expect(
      await page.evaluate(() => (window as unknown as { uploadCount: number }).uploadCount),
    ).toBe(1);
  });

test("accepted upload recovery stays read-only after consent withdrawal", async ({ page }) => {
  await page.goto(`${base}/files`);
  await expect(page.getByRole("heading", { name: "아직 자료가 없어요" })).toBeVisible();
  await page.evaluate(async (key) => {
    const path = "/tests/helpers/workspace-client-fixture.ts";
    const { api } = (await import(path)) as typeof import("../helpers/workspace-client-fixture");
    const state = window as unknown as { uploadCount: number };
    state.uploadCount = 0;
    const upload = api.files.upload;
    api.files.upload = async (...args: Parameters<typeof upload>) => {
      state.uploadCount++;
      const result = await upload(...args);
      const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
      saved.session.needsConsent = true;
      localStorage.setItem(key, JSON.stringify(saved));
      const get = api.workspace.getFiles;
      api.workspace.getFiles = async () => {
        api.workspace.getFiles = get;
        throw Object.assign(new Error("합성 최신 목록 조회 실패"), { code: "UNAVAILABLE" });
      };
      return result;
    };
  }, key);
  await page.getByLabel("선택 자료의 자동 처리에 동의합니다.").check();
  await page.getByLabel("업로드할 파일 선택", { exact: true }).setInputFiles({
    name: "accepted-before-consent.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("synthetic consent boundary"),
  });
  await expect(page.getByRole("alert")).toContainText(
    "이미 접수된 자료는 다시 업로드하지 않아도 돼요",
  );
  await expect(page.getByRole("button", { name: "업로드 다시 시도", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "파일 선택", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "새로고침 · 다시 확인", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "accepted-before-consent.txt", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "파일 선택", exact: true })).toBeDisabled();
  expect(
    await page.evaluate(() => (window as unknown as { uploadCount: number }).uploadCount),
  ).toBe(1);
});

test("an old owner upload cannot clear the next owner's progress", async ({ page }) => {
  await page.goto(`${base}/files`);
  await expect(page.getByRole("heading", { name: "아직 자료가 없어요" })).toBeVisible();
  await page.evaluate(async () => {
    const path = "/tests/helpers/workspace-client-fixture.ts";
    const { api } = (await import(path)) as typeof import("../helpers/workspace-client-fixture");
    const state = window as unknown as { uploadFailures: (() => void)[] };
    state.uploadFailures = [];
    api.files.upload = async (_id, file, onProgress) =>
      new Promise((_resolve, reject) => {
        onProgress?.({ stage: "hashing", completedBytes: 0, totalBytes: file.size });
        state.uploadFailures.push(() =>
          reject(Object.assign(new Error("합성 연결 오류"), { code: "UNAVAILABLE" })),
        );
      });
  });
  await page.getByLabel("선택 자료의 자동 처리에 동의합니다.").check();
  await page.getByLabel("업로드할 파일 선택", { exact: true }).setInputFiles({
    name: "first.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("첫 합성 자료"),
  });
  await expect(page.getByText("first.txt · 1/1개", { exact: true })).toBeVisible();
  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key) ?? "{}");
    state.session.user.id = "another-customer";
    localStorage.setItem(key, JSON.stringify(state));
    window.dispatchEvent(new Event("focus"));
  }, key);
  await expect(page.getByLabel("선택 자료의 자동 처리에 동의합니다.")).not.toBeChecked();
  await page.getByLabel("선택 자료의 자동 처리에 동의합니다.").check();
  await page.getByLabel("업로드할 파일 선택", { exact: true }).setInputFiles({
    name: "second.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("다음 합성 자료"),
  });
  await expect(page.getByText("second.txt · 1/1개", { exact: true })).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { uploadFailures: (() => void)[] }).uploadFailures[0]?.(),
  );
  await expect(page.getByText("second.txt · 1/1개", { exact: true })).toBeVisible();
  await expect(page.getByText(/업로드 시작 후/)).toHaveCount(1);
  await page.evaluate(() =>
    (window as unknown as { uploadFailures: (() => void)[] }).uploadFailures[1]?.(),
  );
  await expect(page.getByRole("button", { name: "업로드 다시 시도", exact: true })).toBeVisible();
});

test("pending server timestamps survive reload and terminal file/chat states remove elapsed timers", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-15T00:01:05.000Z"));
  await page.goto(`${base}/files`);
  await expect(page.getByRole("heading", { name: "아직 자료가 없어요" })).toBeVisible();
  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key) ?? "{}");
    state.files["synthetic-case"] = [
      {
        id: "progress-file",
        name: "progress.txt",
        mimeType: "text/plain",
        sizeBytes: 10,
        status: "processing",
        coverage: "처리 결과는 아직 확인할 수 없어요.",
        extractedText: "",
        createdAt: "2026-10-15T00:00:00.000Z",
      },
    ];
    state.workspace["synthetic-case"].messages = [
      {
        id: "progress-chat",
        role: "assistant",
        text: "공식 법률 자료를 확인하고 있어요.",
        status: "pending",
        createdAt: "2026-10-15T00:00:00.000Z",
        statusUpdatedAt: "2026-10-15T00:00:00.000Z",
      },
    ];
    localStorage.setItem(key, JSON.stringify(state));
  }, key);
  await page.reload();
  await expect(page.getByText("자료 등록 후 1분 5초", { exact: true })).toBeVisible();
  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key) ?? "{}");
    Object.assign(state.files["synthetic-case"][0], {
      status: "failed",
      failure: "JOB_TIMEOUT",
      canRetry: true,
    });
    localStorage.setItem(key, JSON.stringify(state));
    window.dispatchEvent(new Event("focus"));
  }, key);
  await expect(page.getByText(/자료 처리가 제한 시간 안에 끝나지 않았어요/)).toBeVisible();
  await expect(page.getByRole("button", { name: "처리 다시 시도", exact: true })).toBeVisible();
  await expect(page.getByText(/자료 등록 후/)).toHaveCount(0);
  await page.goto(base);
  await expect(page.getByText("공식 법률 자료를 확인하고 있어요.", { exact: true })).toBeVisible();
  await expect(page.getByText("· 마지막 상태 변경 후 1분 5초", { exact: true })).toBeVisible();
  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key) ?? "{}");
    Object.assign(state.workspace["synthetic-case"].messages[0], {
      status: "failed",
      retryable: true,
    });
    localStorage.setItem(key, JSON.stringify(state));
    window.dispatchEvent(new Event("focus"));
  }, key);
  await expect(page.getByRole("button", { name: "응답 다시 시도", exact: true })).toBeVisible();
  await expect(page.getByText(/마지막 상태 변경 후/)).toHaveCount(0);
});

test("chat retry 503 remains visible after focus refresh and clears after a successful retry", async ({
  page,
}) => {
  await page.goto(base);
  await expect(page.getByRole("heading", { name: "이제, 하나씩 풀어가요." })).toBeVisible();
  await page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
    saved.faults = { "workspace.sendMessage": ["chat_failed"] };
    localStorage.setItem(key, JSON.stringify(saved));
  }, key);
  await page.getByLabel("추가 사실 또는 질문").fill("재시도 오류 표시를 확인할 합성 질문입니다.");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  const retry = page.getByRole("button", { name: "응답 다시 시도", exact: true });
  await expect(retry).toBeVisible();
  await page.evaluate(async () => {
    const path = "/tests/helpers/workspace-client-fixture.ts";
    const { api } = (await import(path)) as typeof import("../helpers/workspace-client-fixture");
    const execute = api.workspace.retryMessage;
    api.workspace.retryMessage = async () => {
      api.workspace.retryMessage = execute;
      throw Object.assign(new Error("AI 설정을 확인한 뒤 다시 시도해 주세요."), {
        code: "UNAVAILABLE",
        status: 503,
      });
    };
  });
  await retry.click();
  await expect(page.getByRole("alert")).toContainText("AI 설정을 확인한 뒤 다시 시도해 주세요.");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("heading", { name: "대여금 반환 관련 자료 정리" })).toBeVisible();
  await expect(page.getByRole("log", { name: "사건 대화" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("AI 설정을 확인한 뒤 다시 시도해 주세요.");
  await retry.click();
  await expect(page.getByText("이 응답은 합성 API 예시", { exact: false })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

for (const result of ["same-owner", "other-owner", "consent", "unavailable"] as const)
  test(`chat retry click waits for focus verification: ${result}`, async ({ page }) => {
    await page.goto(base);
    await expect(page.getByRole("heading", { name: "이제, 하나씩 풀어가요." })).toBeVisible();
    await page.evaluate((key) => {
      const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
      saved.faults = { "workspace.sendMessage": ["chat_failed"] };
      localStorage.setItem(key, JSON.stringify(saved));
    }, key);
    await page.getByLabel("추가 사실 또는 질문").fill("초점 확인 중 재시도할 합성 질문입니다.");
    await page.getByRole("button", { name: "보내기", exact: true }).click();
    const retry = page.getByRole("button", { name: "응답 다시 시도", exact: true });
    await expect(retry).toBeVisible();
    await page.evaluate(async () => {
      const path = "/tests/helpers/workspace-client-fixture.ts";
      const { api } = (await import(path)) as typeof import("../helpers/workspace-client-fixture");
      const original = api.session.get;
      const owner = await original();
      if (!owner.user) throw new Error("Missing synthetic owner");
      const customer = owner.user;
      const pending: { resolve: (value: typeof owner) => void; reject: (error: Error) => void }[] =
        [];
      const state = window as unknown as {
        retryCalls: number;
        releaseRetryCheck: (result: string) => void;
      };
      state.retryCalls = 0;
      api.session.get = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
      state.releaseRetryCheck = (result) => {
        const next =
          result === "other-owner"
            ? { ...owner, user: { ...customer, id: "another-customer" } }
            : { ...owner, needsConsent: result === "consent" };
        api.session.get = async () => next;
        for (const check of pending)
          if (result === "unavailable") check.reject(new Error("합성 세션 확인 장애"));
          else check.resolve(next);
      };
      const execute = api.workspace.retryMessage;
      api.workspace.retryMessage = async (...args: Parameters<typeof execute>) => {
        state.retryCalls++;
        return execute(...args);
      };
    });
    // The operating system may focus Safari during a pointer gesture. No private
    // workspace content or paid request may escape the pending session check.
    await retry.evaluate((button) =>
      button.addEventListener(
        "pointerdown",
        () => {
          window.dispatchEvent(new Event("focus"));
        },
        { once: true },
      ),
    );
    await retry.scrollIntoViewIfNeeded();
    const bounds = await retry.boundingBox();
    if (!bounds) throw new Error("Missing synthetic retry button");
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await expect(page.getByRole("heading", { name: "사건을 불러오는 중" })).toBeVisible();
    await expect(page.getByRole("log", { name: "사건 대화" })).toBeHidden();
    await page.mouse.up();
    expect(
      await page.evaluate(() => (window as unknown as { retryCalls: number }).retryCalls),
    ).toBe(0);
    await page.evaluate(
      (result) =>
        (window as unknown as { releaseRetryCheck: (result: string) => void }).releaseRetryCheck(
          result,
        ),
      result,
    );
    if (result === "same-owner")
      await expect(page.getByText("이 응답은 합성 API 예시", { exact: false })).toBeVisible();
    else if (result !== "other-owner") await expect(page.getByRole("alert")).toBeVisible();
    expect(
      await page.evaluate(() => (window as unknown as { retryCalls: number }).retryCalls),
    ).toBe(result === "same-owner" ? 1 : 0);
  });

test("chat retry survives overlapping focus, pageshow and visibility checks", async ({ page }) => {
  await page.goto(base);
  await expect(page.getByRole("heading", { name: "이제, 하나씩 풀어가요." })).toBeVisible();
  await page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
    saved.faults = { "workspace.sendMessage": ["chat_failed"] };
    localStorage.setItem(key, JSON.stringify(saved));
  }, key);
  await page.getByLabel("추가 사실 또는 질문").fill("동시 세션 확인 중 재시도할 합성 질문입니다.");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.getByRole("button", { name: "응답 다시 시도" })).toBeVisible();
  await page.evaluate(async () => {
    const path = "/tests/helpers/workspace-client-fixture.ts";
    const { api } = (await import(path)) as typeof import("../helpers/workspace-client-fixture");
    const original = api.session.get;
    const owner = await original();
    const state = window as unknown as {
      chatSessionChecks: number;
      chatRetryCalls: number;
      finishChatPreflight: () => void;
    };
    state.chatSessionChecks = 0;
    state.chatRetryCalls = 0;
    api.session.get = () => {
      if (++state.chatSessionChecks === 1)
        return new Promise((resolve) => {
          state.finishChatPreflight = () => resolve(owner);
        });
      return original();
    };
    const retry = api.workspace.retryMessage;
    api.workspace.retryMessage = async (...args: Parameters<typeof retry>) => {
      state.chatRetryCalls++;
      return retry(...args);
    };
  });
  await page.getByRole("button", { name: "응답 다시 시도" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { chatSessionChecks: number }).chatSessionChecks),
    )
    .toBe(1);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new PageTransitionEvent("pageshow"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { chatSessionChecks: number }).chatSessionChecks),
    )
    .toBe(4);
  await page.evaluate(() =>
    (window as unknown as { finishChatPreflight: () => void }).finishChatPreflight(),
  );
  await expect(page.getByText("이 응답은 합성 API 예시", { exact: false })).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { chatRetryCalls: number }).chatRetryCalls),
  ).toBe(1);
});

for (const order of ["foreground-first", "background-first"] as const)
  for (const result of [
    "same-owner",
    "other-owner",
    "revoked",
    "consent",
    "signout",
    "unavailable",
  ] as const)
    test(`overlapping session checks preserve upload authorization: ${result}, ${order}`, async ({
      page,
    }) => {
      await page.goto(`${base}/files`);
      await page.getByLabel("선택 자료의 자동 처리에 동의합니다.").check();
      await page.evaluate(async () => {
        const path = "/tests/helpers/workspace-client-fixture.ts";
        const { api } = (await import(
          path
        )) as typeof import("../helpers/workspace-client-fixture");
        const original = api.session.get;
        const originalSession = await original();
        const pending: {
          resolve: (value: Awaited<ReturnType<typeof original>>) => void;
          reject: (cause: Error) => void;
        }[] = [];
        const state = window as unknown as {
          overlapCalls: number;
          overlapChecks: () => number;
          prepareOverlap: (result: string) => void;
          releaseOverlap: (index: number) => void;
        };
        state.overlapCalls = 0;
        const upload = api.files.upload;
        api.files.upload = async (...args: Parameters<typeof upload>) => {
          state.overlapCalls++;
          return upload(...args);
        };
        api.session.get = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
        state.overlapChecks = () => pending.length;
        let result = "same-owner";
        let latestSession = originalSession;
        state.prepareOverlap = (next) => {
          result = next;
          const key = "baro-c-contract-test-state";
          const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
          saved.caseOwners = { "synthetic-case": "synthetic-owner" };
          saved.session = structuredClone(originalSession);
          if (next === "other-owner") saved.session.user.id = "other-owner";
          if (next === "revoked") saved.session.user = null;
          if (next === "consent") saved.session.needsConsent = true;
          latestSession = saved.session;
          localStorage.setItem(key, JSON.stringify(saved));
          api.session.get = original;
          if (next === "signout")
            window.dispatchEvent(
              new CustomEvent("baro-session-changed", { detail: { reason: "signout" } }),
            );
        };
        state.releaseOverlap = (index) => {
          const check = pending[index];
          if (!check) throw new Error("Synthetic pending session check is missing");
          if (index === 1 && result === "unavailable")
            check.reject(Object.assign(new Error("합성 세션 확인 장애"), { code: "UNAVAILABLE" }));
          else check.resolve(index === 0 ? originalSession : latestSession);
        };
      });
      await page.getByLabel("업로드할 파일 선택", { exact: true }).setInputFiles({
        name: "동시 계정 확인.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("동일 고객 사전 확인과 focus가 겹치는 합성 자료"),
      });
      await expect
        .poll(() =>
          page.evaluate(() =>
            (window as unknown as { overlapChecks: () => number }).overlapChecks(),
          ),
        )
        .toBe(1);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect
        .poll(() =>
          page.evaluate(() =>
            (window as unknown as { overlapChecks: () => number }).overlapChecks(),
          ),
        )
        .toBe(2);
      await page.evaluate(
        (result) =>
          (window as unknown as { prepareOverlap: (result: string) => void }).prepareOverlap(
            result,
          ),
        result,
      );
      for (const index of order === "foreground-first" ? [0, 1] : [1, 0])
        await page.evaluate(
          (index) =>
            (window as unknown as { releaseOverlap: (index: number) => void }).releaseOverlap(
              index,
            ),
          index,
        );
      if (result === "same-owner") {
        await expect(page.getByText("결과 확인 가능", { exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "업로드 다시 시도" })).toHaveCount(0);
      } else if (result === "signout" || result === "revoked" || result === "other-owner") {
        await expect(page.getByLabel("선택 자료의 자동 처리에 동의합니다.")).toHaveCount(0);
        await expect(page.getByRole("button", { name: "업로드 다시 시도" })).toHaveCount(0);
      } else {
        await expect(page.getByRole("alert")).toBeVisible();
        if (result === "unavailable")
          await expect(page.getByRole("alert")).toContainText("합성 세션 확인 장애");
      }
      expect(
        await page.evaluate(() => (window as unknown as { overlapCalls: number }).overlapCalls),
      ).toBe(result === "same-owner" ? 1 : 0);
    });

for (const result of ["same-owner", "other-owner", "unavailable"] as const)
  test(`native file selection survives focus verification: ${result}`, async ({ page }) => {
    await page.goto(`${base}/files`);
    await page.getByLabel("선택 자료의 자동 처리에 동의합니다.").check();
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "파일 선택", exact: true }).click();
    const chooser = await chooserPromise;

    // Safari resumes focus verification before the native chooser delivers change.
    // Hold that verification while delivering the choice to the original input node.
    await page.evaluate(async () => {
      const path = "/tests/helpers/workspace-client-fixture.ts";
      const { api } = (await import(path)) as typeof import("../helpers/workspace-client-fixture");
      const session = api.session.get;
      const pending: {
        resolve: (value: Awaited<ReturnType<typeof session>>) => void;
        reject: (cause: Error) => void;
      }[] = [];
      const state = window as unknown as {
        materialUploadCalls: number;
        releaseMaterialCheck: (result: string) => Promise<void>;
      };
      state.materialUploadCalls = 0;
      const upload = api.files.upload;
      api.files.upload = async (...args: Parameters<typeof upload>) => {
        state.materialUploadCalls++;
        return upload(...args);
      };
      api.session.get = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
      state.releaseMaterialCheck = async (result) => {
        api.session.get = session;
        if (result === "other-owner") {
          const key = "baro-c-contract-test-state";
          const saved = localStorage.getItem(key);
          if (!saved) throw new Error("Synthetic owner state is missing");
          const value = JSON.parse(saved);
          value.caseOwners = { "synthetic-case": "synthetic-owner" };
          value.session.user.id = "other-owner";
          localStorage.setItem(key, JSON.stringify(value));
        }
        const value = await session();
        for (const check of pending)
          if (result === "unavailable")
            check.reject(Object.assign(new Error("합성 세션 확인 장애"), { code: "UNAVAILABLE" }));
          else check.resolve(value);
      };
      window.dispatchEvent(new Event("focus"));
    });
    await expect(page.getByRole("heading", { name: "사건을 불러오는 중" })).toBeVisible();
    const original = Buffer.from("파일 선택창 복귀 중에도 보존할 합성 원본");
    await chooser.setFiles({ name: "선택 복귀.txt", mimeType: "text/plain", buffer: original });
    expect(
      await page.evaluate(
        () => (window as unknown as { materialUploadCalls: number }).materialUploadCalls,
      ),
    ).toBe(0);
    await page.evaluate(
      (result) =>
        (
          window as unknown as { releaseMaterialCheck: (result: string) => Promise<void> }
        ).releaseMaterialCheck(result),
      result,
    );

    if (result === "other-owner") {
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(page.getByRole("button", { name: "업로드 다시 시도" })).toHaveCount(0);
      expect(
        await page.evaluate(
          () => (window as unknown as { materialUploadCalls: number }).materialUploadCalls,
        ),
      ).toBe(0);
      return;
    }
    if (result === "unavailable") {
      await expect(page.getByRole("alert")).toContainText("합성 세션 확인 장애");
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.getByRole("button", { name: "업로드 다시 시도", exact: true }).click();
    }
    await expect(page.getByText("결과 확인 가능", { exact: true })).toBeVisible();
    const stored = await page.evaluate(async () => {
      const path = "/tests/helpers/workspace-client-fixture.ts";
      const { api } = (await import(path)) as typeof import("../helpers/workspace-client-fixture");
      const files = await api.files.list("synthetic-case");
      return {
        count: files.length,
        name: files[0]?.name,
        text: files[0]
          ? await (await api.files.original("synthetic-case", files[0].id)).text()
          : null,
        calls: (window as unknown as { materialUploadCalls: number }).materialUploadCalls,
      };
    });
    expect(stored).toEqual({
      count: 1,
      name: "선택 복귀.txt",
      text: original.toString(),
      calls: 1,
    });
  });

test("chat failure/retry, reload, action checks and timeline editing on actual case routes", async ({
  page,
}) => {
  await page.goto(base);
  await expect(page.getByRole("heading", { name: "이제, 하나씩 풀어가요." })).toBeVisible();
  await page.evaluate((storageKey) => {
    const state = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    state.faults = { "workspace.sendMessage": ["chat_failed"] };
    localStorage.setItem(storageKey, JSON.stringify(state));
  }, key);
  await page.getByLabel("추가 사실 또는 질문").fill("확인이 필요한 합성 추가 사실입니다.");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.getByRole("button", { name: "응답 다시 시도" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "응답 다시 시도" }).click();
  await expect(page.getByText("이 응답은 합성 API 예시", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "다음 행동", exact: true }).click();
  const first = page.getByRole("checkbox").first();
  await first.check();
  await expect(first).toBeChecked();
  await expect(page.getByText("완료 표시를 저장했어요.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("checkbox").first()).toBeChecked();
  await page.getByRole("link", { name: "타임라인", exact: true }).click();
  await page.getByRole("button", { name: "일정 추가" }).click();
  await page.getByLabel("어떤 일이 있었나요?").fill("반환 약속 날짜 확인");
  await page.getByLabel("상세 내용").fill("원본 메시지를 검토할 예정입니다.");
  await page.getByRole("button", { name: "타임라인 저장" }).click();
  await page.getByRole("button", { name: "편집", exact: true }).click();
  await page.getByLabel("날짜 정밀도").selectOption("day");
  await page.getByLabel("날짜 (모르면 비워 두세요)").fill("2026-10-01");
  await page.getByRole("button", { name: "타임라인 저장" }).click();
  await expect(page.getByText("타임라인을 저장했어요.", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.reload();
  await expect(page.getByText("2026-10-01", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/workspace-desktop.png", fullPage: true });
  await expect(page.getByRole("link", { name: "리포트 보기" }).first()).toHaveAttribute(
    "href",
    `${base}/reports`,
  );
  await expect(page.getByRole("link", { name: /변호사 탐색/ }).first()).toHaveAttribute(
    "href",
    "/lawyers",
  );
});
test("file processing failure, retry, extracted text, original bytes, cancellation and deletion persist", async ({
  page,
}) => {
  await page.goto(`${base}/files`);
  await expect(page.getByRole("heading", { name: "아직 자료가 없어요" })).toBeVisible();
  await page.evaluate((storageKey) => {
    const state = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    state.faults = {
      "files.upload": ["file_failed"],
      "files.uploadPart": ["UNAVAILABLE", "UNAVAILABLE"],
    };
    localStorage.setItem(storageKey, JSON.stringify(state));
  }, key);
  await page.getByLabel("선택 자료의 자동 처리에 동의합니다.").check();
  const text = "브라우저 검증용 합성 자료입니다. 실제 사건 정보가 아닙니다.";
  await page
    .getByLabel("업로드할 파일 선택", { exact: true })
    .setInputFiles({ name: "synthetic.txt", mimeType: "text/plain", buffer: Buffer.from(text) });
  await page.getByRole("button", { name: "업로드 다시 시도" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "synthetic.txt" })).toBeVisible();
  await page.getByLabel("선택 자료의 자동 처리에 동의합니다.").check();
  await page.getByLabel("업로드할 파일 선택", { exact: true }).setInputFiles({
    name: "synthetic.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(text),
  });
  await expect(page.getByRole("heading", { name: "synthetic.txt" })).toHaveCount(1);
  await expect(page.getByText("처리 실패", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "처리 다시 시도" }).click();
  await expect(page.getByText("결과 확인 가능", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "자료 확인" }).click();
  await page.getByText("원본 추출 내용", { exact: true }).click();
  await expect(
    page.getByRole("dialog").locator("details p").filter({ hasText: text }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "원본 확인 · 다운로드" }).click();
  expect((await download).suggestedFilename()).toBe("synthetic.txt");
  await page.getByRole("dialog").getByRole("button", { name: "닫기", exact: true }).last().click();
  await page.getByRole("button", { name: "삭제", exact: true }).click();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.getByRole("heading", { name: "synthetic.txt" })).toBeVisible();
  await page.getByRole("button", { name: "삭제", exact: true }).click();
  await page.getByRole("button", { name: "자료 삭제 확인" }).click();
  await expect(page.getByText("자료를 삭제했어요.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "아직 자료가 없어요" })).toBeVisible();
});
test("mobile keyboard dialog, empty state, quota, stale input and safe image preview", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await expect(page.getByRole("heading", { name: "이제, 하나씩 풀어가요." })).toBeVisible();
  await page.evaluate((storageKey) => {
    const state = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    state.faults = { "workspace.sendMessage": ["QUOTA_EXCEEDED"] };
    localStorage.setItem(storageKey, JSON.stringify(state));
  }, key);
  await page.getByLabel("추가 사실 또는 질문").fill("합성 한도 요청");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.getByRole("link", { name: "사용량 확인" })).toBeVisible();
  await expect(page.getByLabel("추가 사실 또는 질문")).toHaveValue("합성 한도 요청");
  await page.getByRole("link", { name: "타임라인", exact: true }).click();
  await page.getByRole("button", { name: "일정 추가" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "일정 추가" })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole("link", { name: "자료 0", exact: true }).click();
  await page.getByLabel("선택 자료의 자동 처리에 동의합니다.").check();
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=",
    "base64",
  );
  await page
    .getByLabel("업로드할 파일 선택", { exact: true })
    .setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: bytes });
  await expect(page.getByText("결과 확인 가능", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "자료 확인" }).click();
  await page.getByRole("button", { name: "원본 확인 · 다운로드" }).click();
  await expect(page.getByAltText("synthetic.png 원본 미리보기")).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "원본 다운로드", exact: true }).click();
  const downloaded = await downloadEvent;
  expect(downloaded.suggestedFilename()).toBe("synthetic.png");
  const downloadedPath = await downloaded.path();
  expect(downloadedPath).not.toBeNull();
  expect(await readFile(downloadedPath!)).toEqual(bytes);
  await page.screenshot({ path: "test-results/workspace-mobile-preview.png", fullPage: true });
});

test("changing the shared mock owner hides the previous workspace and open editor", async ({
  page,
}) => {
  await page.goto(`${base}/timeline`);
  await page.getByRole("button", { name: "일정 추가" }).click();
  await page.getByLabel("어떤 일이 있었나요?").fill("공개하지 않을 합성 초안");
  await page.evaluate((storageKey) => {
    const state = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    state.caseOwners = { "synthetic-case": "synthetic-owner" };
    state.session.user = { id: "other-owner", name: "다른 합성 사용자", accountType: "customer" };
    localStorage.setItem(storageKey, JSON.stringify(state));
    window.dispatchEvent(new Event("focus"));
  }, key);
  await expect(page.getByRole("alert")).toContainText("사건 또는 자료를 찾을 수 없어요.");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "대여금 반환 관련 자료 정리" })).not.toBeVisible();
  await expect(page.getByLabel("어떤 일이 있었나요?")).not.toBeVisible();
});

test("workspace panels keep their navigation, readable layouts and accessible controls on desktop and mobile", async ({
  page,
}) => {
  await page.goto(base);
  await expect(page.getByRole("heading", { name: "이제, 하나씩 풀어가요." })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "사건 메뉴" }).getByRole("link")).toHaveCount(
    5,
  );
  await captureCaseViewports(page, "chat-welcome");
  await page
    .getByLabel("추가 사실 또는 질문")
    .fill("합성 자료의 날짜와 반환 약속을 차근차근 확인하고 싶어요.");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.getByText("이 응답은 합성 API 예시", { exact: false })).toBeVisible();
  await captureCaseViewports(page, "chat");
  await page.getByRole("link", { name: "자료 0", exact: true }).click();
  await page.getByLabel("선택 자료의 자동 처리에 동의합니다.").check();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "파일 선택", exact: true }).click();
  await (await chooser).setFiles({
    name: "반환 약속 메시지.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("반환 약속 날짜를 확인하는 합성 자료입니다."),
  });
  await expect(page.getByText("결과 확인 가능", { exact: true })).toBeVisible();
  await captureCaseViewports(page, "files");
  await page.getByRole("link", { name: "타임라인", exact: true }).click();
  await page.getByRole("button", { name: "일정 추가" }).click();
  await page.getByLabel("어떤 일이 있었나요?").fill("반환 약속 메시지를 받음");
  await page.getByLabel("날짜 정밀도").selectOption("day");
  await page.getByLabel("날짜 (모르면 비워 두세요)").fill("2026-10-01");
  await page.getByLabel("상세 내용").fill("메시지 원본의 날짜와 내용을 확인할 예정입니다.");
  await page.getByRole("button", { name: "타임라인 저장" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("heading", { name: "사건의 흐름" })).toBeVisible();
  await captureCaseViewports(page, "timeline");
  await page.getByRole("link", { name: "다음 행동", exact: true }).click();
  await page.getByRole("checkbox").first().check();
  await expect(page.getByRole("progressbar", { name: "다음 행동 완료 현황" })).toHaveAttribute(
    "value",
    "1",
  );
  await captureCaseViewports(page, "actions");
});

for (const canRetry of [true, false])
  test(`failed materials expose processing retry only when permitted: ${canRetry}`, async ({
    page,
  }) => {
    await page.goto(`${base}/files`);
    await expect(page.getByRole("heading", { name: "아직 자료가 없어요" })).toBeVisible();
    await page.evaluate(
      ({ storageKey, permission }) => {
        const state = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
        state.files["synthetic-case"] = [
          {
            id: "synthetic-failed-file",
            name: "synthetic-failed.txt",
            mimeType: "text/plain",
            sizeBytes: 8,
            status: "failed",
            coverage: "합성 처리 실패",
            extractedText: "",
            canRetry: permission,
          },
        ];
        localStorage.setItem(storageKey, JSON.stringify(state));
      },
      { storageKey: key, permission: canRetry },
    );
    await page.reload();
    await expect(page.getByText("처리 실패", { exact: true })).toBeVisible();
    const retry = page.getByRole("button", { name: "처리 다시 시도", exact: true });
    if (canRetry) await expect(retry).toBeEnabled();
    else await expect(retry).toHaveCount(0);
    await expect(page.getByRole("button", { name: "자료 확인", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "삭제", exact: true })).toBeEnabled();
  });

test("current file checkpoint and status update survive reload and reset on explicit retry", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-15T00:02:05.000Z"));
  await page.goto(`${base}/files`);
  await expect(page.getByRole("heading", { name: "아직 자료가 없어요" })).toBeVisible();
  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key) ?? "{}");
    state.files["synthetic-case"] = [
      {
        id: "checkpoint-file",
        name: "checkpoint.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        status: "waiting",
        coverage: "처리 결과는 아직 확인할 수 없어요.",
        extractedText: "",
        createdAt: "2026-10-14T23:15:00.000Z",
        processing: { status: "queued", phase: "admission", updatedAt: "2026-10-15T00:01:00.000Z" },
      },
    ];
    localStorage.setItem(key, JSON.stringify(state));
  }, key);
  await page.reload();
  await expect(
    page.getByText("자료 처리 요청이 접수되어 시작을 기다리고 있어요.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("마지막 상태 갱신 후 1분 5초", { exact: true })).toBeVisible();
  await expect(page.getByText(/자료 등록 후/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "처리 다시 시도", exact: true })).toHaveCount(0);
  for (const phase of [
    "admission",
    "extracting",
    "observing",
    "assembling",
    "retrieving",
  ] as const) {
    await page.evaluate(
      ({ key, phase }) => {
        const state = JSON.parse(localStorage.getItem(key) ?? "{}");
        Object.assign(state.files["synthetic-case"][0], {
          status: "processing",
          processing: { status: "running", phase, updatedAt: "2026-10-15T00:02:00.000Z" },
        });
        localStorage.setItem(key, JSON.stringify(state));
        window.dispatchEvent(new Event("focus"));
      },
      { key, phase },
    );
    const labels = {
      admission: "자료를 처리하고 있어요.",
      extracting: "처리 중 · 최근 확인 단계: 자료 추출",
      observing: "처리 중 · 최근 확인 단계: 내용 확인",
      assembling: "처리 중 · 최근 확인 단계: 결과 정리",
      retrieving: "자료를 처리하고 있어요.",
    };
    await expect(page.getByText(labels[phase], { exact: true })).toBeVisible();
    await expect(page.getByText("마지막 상태 갱신 후 5초", { exact: true })).toBeVisible();
  }
  await page.reload();
  await expect(page.getByText("자료를 처리하고 있어요.", { exact: true })).toBeVisible();
  await expect(page.getByText("마지막 상태 갱신 후 5초", { exact: true })).toBeVisible();
  await page.evaluate(async (key) => {
    const state = JSON.parse(localStorage.getItem(key) ?? "{}");
    Object.assign(state.files["synthetic-case"][0], {
      status: "failed",
      processing: undefined,
      failure: "FILE_PROCESSING_FAILED",
      canRetry: true,
    });
    localStorage.setItem(key, JSON.stringify(state));
    const path = "/tests/helpers/workspace-client-fixture.ts";
    const { api } = (await import(path)) as typeof import("../helpers/workspace-client-fixture");
    api.files.retry = async (_caseId, id) => {
      const next = JSON.parse(localStorage.getItem(key) ?? "{}");
      const file = next.files["synthetic-case"].find((file: { id: string }) => file.id === id);
      Object.assign(file, {
        status: "waiting",
        canRetry: false,
        failure: null,
        processing: { status: "queued", phase: "admission", updatedAt: "2026-10-15T00:02:00.000Z" },
      });
      localStorage.setItem(key, JSON.stringify(next));
      return file;
    };
    window.dispatchEvent(new Event("focus"));
  }, key);
  await expect(page.getByText(/저장된 원본으로 처리를 다시 시도/)).toBeVisible();
  await expect(page.getByText(/마지막 상태 갱신 후/)).toHaveCount(0);
  await page.getByRole("button", { name: "처리 다시 시도", exact: true }).click();
  await expect(
    page.getByText("자료 처리 요청이 접수되어 시작을 기다리고 있어요.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("마지막 상태 갱신 후 5초", { exact: true })).toBeVisible();
  await expect(page.getByText(/자료 등록 후/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "처리 다시 시도", exact: true })).toHaveCount(0);
  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key) ?? "{}");
    Object.assign(state.files["synthetic-case"][0], { status: "ready", processing: undefined });
    localStorage.setItem(key, JSON.stringify(state));
    window.dispatchEvent(new Event("focus"));
  }, key);
  await expect(page.getByText("결과 확인 가능", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/마지막 상태 갱신 후|최근 확인 단계|자료 등록 후/)).toHaveCount(0);
});
