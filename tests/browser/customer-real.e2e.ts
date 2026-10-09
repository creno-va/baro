import { spawn } from "node:child_process";
import { expect, test } from "@playwright/test";

// No OAuth/AI success claim: real production APIs receive signed synthetic sessions.
const modulePath = "/src/client/api/index.ts";
async function startCustomerServer(browserOrigin: string) {
  const server = spawn("bun", ["tests/helpers/customer-browser-server.ts", browserOrigin], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  type Cookie = {
    name: string;
    value: string;
    url: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Lax";
  };
  const info = await new Promise<{
    origin: string;
    id: string;
    ownerCookie: Cookie;
    foreignCookie: Cookie;
  }>((resolve, reject) => {
    let output = "";
    server.stdout.on("data", (chunk) => {
      output += String(chunk);
      if (output.includes("\n")) {
        try {
          resolve(JSON.parse(output.split("\n")[0] ?? ""));
        } catch (error) {
          reject(error);
        }
      }
    });
    server.on("error", reject);
    server.on("exit", (code) => {
      if (code) reject(new Error("Synthetic customer API harness failed"));
    });
  });
  return { server, info };
}
for (const viewport of [
  { width: 390, height: 844 },
  { width: 640, height: 450 },
  { width: 1280, height: 900 },
]) {
  test(`real summary/timeline lost responses, keyboard/reload and account purge at ${viewport.width}px`, async ({
    page,
    context,
  }, testInfo) => {
    const browserOrigin = new URL(String(testInfo.project.use.baseURL ?? "http://127.0.0.1:4355"))
      .origin;
    const { server, info } = await startCustomerServer(browserOrigin);
    try {
      // 640x450 is the CSS viewport of a 1280x900 window at 200% browser zoom.
      // Also stress CSS zoom separately; unlike browser zoom it retains media queries.
      await page.setViewportSize(viewport);
      // Invoke the customer's real periodic callback while a real session
      // response is held; no session or API result is fabricated here.
      await page.addInitScript(() => {
        const original = window.setInterval;
        window.setInterval = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
          if (delay === 15000 && typeof callback === "function")
            (window as Window & { customerSessionPoll?: () => void }).customerSessionPoll = () =>
              callback(...args);
          return original(callback, delay, ...args);
        }) as typeof window.setInterval;
      });
      if (viewport.width === 1280)
        await page.addInitScript(() =>
          document.addEventListener("DOMContentLoaded", () => {
            document.documentElement.style.zoom = "2";
          }),
        );
      await context.addCookies([info.ownerCookie]);
      let sessionUnavailable = false;
      let droppedSave = false,
        droppedConfirm = false,
        droppedTimeline = false;
      let apiInFlight = 0;
      let workspaceReads = 0;
      let holdNextSession = false;
      let releaseSession: (() => void) | undefined;
      const mutations: { path: string; body: string | null; key: string | undefined }[] = [];
      await context.route("**/api/**", async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (!path.startsWith("/api/")) {
          await route.continue();
          return;
        }
        ++apiInFlight;
        if (path.endsWith("/workspace")) ++workspaceReads;
        try {
          if (path === "/api/me/session" && holdNextSession) {
            holdNextSession = false;
            await new Promise<void>((resolve) => {
              releaseSession = resolve;
            });
          }
          if (path === "/api/me/session" && sessionUnavailable) {
            await route.abort("failed");
            return;
          }
          const response = await context.request.fetch(
            new URL(new URL(request.url()).pathname + new URL(request.url()).search, info.origin)
              .href,
            {
              method: request.method(),
              headers: { ...request.headers(), origin: browserOrigin },
              ...(request.postData() ? { data: request.postData() ?? "" } : {}),
            },
          );
          if (request.method() !== "GET")
            mutations.push({
              path,
              body: request.postData(),
              key: request.headers()["idempotency-key"],
            });
          if (
            response.ok() &&
            request.method() === "PUT" &&
            path.endsWith("/summary") &&
            !droppedSave
          ) {
            droppedSave = true;
            await route.abort("failed");
            return;
          }
          if (response.ok() && path.endsWith("/summary/confirm") && !droppedConfirm) {
            droppedConfirm = true;
            await route.abort("failed");
            return;
          }
          if (
            response.ok() &&
            request.method() === "POST" &&
            path.endsWith("/timeline") &&
            !droppedTimeline
          ) {
            droppedTimeline = true;
            await route.abort("failed");
            return;
          }
          await route.fulfill({ response });
        } finally {
          --apiInFlight;
        }
      });
      const base = `/cases/${info.id}`;
      await page.goto(`${base}/summary`);
      const editor = page.getByLabel("요약 편집");
      await expect(editor).toBeVisible();
      await editor.fill("직접 수정한 합성 브라우저 요약입니다.");
      await page.getByRole("button", { name: "수정 내용 저장" }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(editor).toHaveValue("직접 수정한 합성 브라우저 요약입니다.");
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(editor).toBeVisible();
      await page.getByRole("button", { name: "수정 내용 저장" }).click();
      await expect(page.getByText("수정한 요약이 저장됐어요.")).toBeVisible();
      const saveWrites = mutations.filter((mutation) => mutation.path.endsWith("/summary"));
      expect(saveWrites).toHaveLength(2);
      expect(saveWrites[0]).toEqual(saveWrites[1]);
      await page.reload();
      await expect(editor).toHaveValue("직접 수정한 합성 브라우저 요약입니다.");
      await editor.fill("네트워크 장애 후에도 보존할 요약 초안");
      sessionUnavailable = true;
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(editor).not.toBeVisible();
      await expect(page.getByRole("alert")).toContainText("연결하지 못했어요");
      sessionUnavailable = false;
      await expect.poll(() => apiInFlight).toBe(0);
      const readsBeforeRetry = workspaceReads;
      holdNextSession = true;
      await page.getByRole("button", { name: "다시 시도", exact: true }).click();
      await expect.poll(() => !!releaseSession).toBe(true);
      await page.evaluate(() =>
        (window as Window & { customerSessionPoll?: () => void }).customerSessionPoll?.(),
      );
      releaseSession?.();
      releaseSession = undefined;
      await expect.poll(() => workspaceReads).toBeGreaterThan(readsBeforeRetry);
      await expect(editor).toHaveValue("네트워크 장애 후에도 보존할 요약 초안");
      await editor.fill("다른 계정으로 저장되면 안 되는 요약 초안");
      // Finish the same-owner reload before replacing its signed cookie; the
      // following focus is the account-change verification being asserted.
      await expect.poll(() => apiInFlight, { timeout: 15000 }).toBe(0);
      await context.addCookies([info.foreignCookie]);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(editor).not.toBeVisible();
      await expect(page.getByRole("alert")).toContainText("요청한 내용을 찾지 못했어요.", {
        timeout: 15000,
      });
      await expect.poll(() => apiInFlight, { timeout: 15000 }).toBe(0);
      await context.addCookies([info.ownerCookie]);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(editor).toHaveValue("직접 수정한 합성 브라우저 요약입니다.");
      await expect(
        page.getByRole("checkbox", { name: /요약이 내가 이야기한 사실과 맞는지/ }),
      ).not.toBeChecked();
      await page.getByRole("checkbox", { name: /요약이 내가 이야기한 사실과 맞는지/ }).check();
      await page.getByRole("button", { name: "요약 확인하고 계속" }).click();
      await page.getByRole("button", { name: "확인하고 사건 열기" }).click();
      await expect(page.getByRole("alert")).toBeVisible();
      await page.getByRole("button", { name: "요약 확인하고 계속" }).click();
      await page.getByRole("button", { name: "확인하고 사건 열기" }).click();
      await expect(page).toHaveURL(base);
      const confirmations = mutations.filter((mutation) =>
        mutation.path.endsWith("/summary/confirm"),
      );
      expect(confirmations).toHaveLength(2);
      expect(confirmations[0]).toEqual(confirmations[1]);
      await expect(page.getByLabel("추가 사실 또는 질문")).toBeVisible();
      await page.getByRole("link", { name: "타임라인", exact: true }).click();
      await page.getByRole("button", { name: "일정 추가" }).click();
      await page.getByLabel("어떤 일이 있었나요?").fill("자료를 확인한 날");
      await page.getByLabel("상세 내용").fill("타임라인 응답 유실 합성 회귀");
      await page.getByRole("button", { name: "타임라인 저장" }).click();
      await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
      await expect(page.getByLabel("상세 내용")).toHaveValue("타임라인 응답 유실 합성 회귀");
      await page.getByRole("button", { name: "타임라인 저장" }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible();
      await page.reload();
      await expect(page.getByRole("heading", { name: "자료를 확인한 날" })).toBeVisible();
      const timelineWrites = mutations.filter((mutation) => mutation.path.endsWith("/timeline"));
      expect(timelineWrites).toHaveLength(2);
      expect(timelineWrites[0]).toEqual(timelineWrites[1]);
      await page.goto(base);
      await page.getByLabel("추가 사실 또는 질문").fill("계정 전환 후 비워야 할 이전 초안");
      sessionUnavailable = true;
      await page.getByRole("button", { name: "보내기", exact: true }).click();
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(page.getByLabel("추가 사실 또는 질문")).toHaveValue(
        "계정 전환 후 비워야 할 이전 초안",
      );
      sessionUnavailable = false;
      // Same browser cookie jar changes without a storage event: focus must revalidate.
      await context.addCookies([info.foreignCookie]);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(page.getByLabel("추가 사실 또는 질문")).not.toBeVisible();
      await expect(page.getByRole("alert")).toContainText(
        "계정 또는 사건 접근이 바뀌어 이전 내용을 비웠어요.",
      );
      await context.addCookies([info.ownerCookie]);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(page.getByLabel("추가 사실 또는 질문")).toHaveValue("");
      await page.getByLabel("추가 사실 또는 질문").fill("로그아웃 후 비워야 할 초안");
      await context.clearCookies();
      sessionUnavailable = true;
      await page.evaluate(() =>
        window.dispatchEvent(
          new StorageEvent("storage", {
            key: "better-auth.message",
            newValue: JSON.stringify({ event: "session", data: { trigger: "signout" } }),
          }),
        ),
      );
      await expect(page.getByLabel("추가 사실 또는 질문")).not.toBeVisible();
      await expect(
        page.getByRole("alert").getByRole("link", { name: "로그인", exact: true }),
      ).toBeVisible();
      sessionUnavailable = false;
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(
        page.getByRole("alert").getByRole("link", { name: "로그인", exact: true }),
      ).toBeVisible();
      await context.addCookies([info.ownerCookie]);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(page.getByLabel("추가 사실 또는 질문")).toHaveValue("");
      // The same signed owner may change roles in another tab without OAuth.
      await page.getByLabel("추가 사실 또는 질문").fill("역할 전환 전 고객 초안");
      const role = async (accountType: "customer" | "lawyer") =>
        page.evaluate(async (value) => {
          const response = await fetch("/api/me/account-type", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ accountType: value }),
          });
          return response.status;
        }, accountType);
      expect(await role("lawyer")).toBe(200);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(page.getByLabel("추가 사실 또는 질문")).not.toBeVisible();
      await expect(page.getByRole("alert")).toContainText(
        "계정 또는 사건 접근이 바뀌어 이전 내용을 비웠어요.",
      );
      expect(await role("customer")).toBe(200);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(page.getByLabel("추가 사실 또는 질문")).toHaveValue("");
      await page.screenshot({
        path: testInfo.outputPath(`customer-real-${viewport.width}.png`),
        fullPage: true,
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      const saved = await page.evaluate(
        async ({ modulePath, id }) => {
          const { api } = await import(modulePath);
          return api.workspace.get(id);
        },
        { modulePath, id: info.id },
      );
      expect(saved.timeline).toHaveLength(1);
    } finally {
      server.stdin.end();
    }
  });
}

for (const [action, outcome] of [
  ["save", "success"],
  ["save", "failure"],
  ["refresh", "failure"],
] as const) {
  test(`real intake ${action} ignores an older ${outcome} after completion`, async ({
    page,
    context,
  }, testInfo) => {
    const browserOrigin = new URL(String(testInfo.project.use.baseURL)).origin;
    const { server, info } = await startCustomerServer(browserOrigin);
    let holdNextRead = false;
    let releaseRead: (() => void) | undefined;
    let readFinished = false;
    let writes = 0;
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await context.addCookies([info.ownerCookie]);
      await context.route("**/api/**", async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (!path.startsWith("/api/")) {
          await route.continue();
          return;
        }
        const response = await context.request.fetch(new URL(path, info.origin).href, {
          method: request.method(),
          headers: { ...request.headers(), origin: browserOrigin },
          ...(request.postData() ? { data: request.postData() ?? "" } : {}),
        });
        if (request.method() === "PUT" && path.endsWith("/intake/answers")) {
          expect(response.ok()).toBe(true);
          ++writes;
        }
        // Both workspace/intake snapshots have arrived before the adapter's
        // final job lookup. Delay only delivery of this genuine server response.
        if (holdNextRead && path.endsWith("/workspace-jobs/latest")) {
          holdNextRead = false;
          await new Promise<void>((resolve) => {
            releaseRead = resolve;
          });
          if (outcome === "failure") await route.abort("failed");
          else await route.fulfill({ response });
          readFinished = true;
          return;
        }
        await route.fulfill({ response });
      });
      await page.goto(`/cases/${info.id}/intake?question=0&edit=1`);
      const answer = page.getByRole("textbox", { name: "답변", exact: true });
      await expect(answer).toBeVisible();
      holdNextRead = true;
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect.poll(() => !!releaseRead).toBe(true);
      await expect(answer).toBeVisible();
      const text = "늦은 조회 응답 이후에도 남아야 하는 합성 답변";
      await answer.fill(text);
      if (action === "save") {
        await page.locator("details > summary", { hasText: "답변 관리" }).click();
        await page.getByRole("button", { name: "답변 저장", exact: true }).click();
        await expect(page.getByRole("status")).toContainText("답변이 저장됐어요.");
        expect(writes).toBe(1);
      } else {
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect(answer).toBeVisible();
      }
      releaseRead?.();
      await expect.poll(() => readFinished).toBe(true);
      // Wait for the old load's postflight session check, if it incorrectly runs.
      await page.evaluate(async () => {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      });
      await expect(page.getByRole("alert")).not.toBeVisible();
      await expect(answer).toHaveValue(text);
      if (action === "save") {
        await page.reload();
        await expect(answer).toHaveValue(text);
        expect(writes).toBe(1);
      }
    } finally {
      releaseRead?.();
      server.stdin.end();
    }
  });
}
