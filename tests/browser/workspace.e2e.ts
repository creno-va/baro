import { expect, test } from "@playwright/test";
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
