import { spawn } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";

const originalSummary = "사용자의 거래 자료 확인 준비를 정리했습니다.";
const peerSummary = "다른 화면에서 수정한 새로운 합성 요약입니다.";

async function summarySnapshot(page: Page, id: string) {
  return page.evaluate(async (id) => {
    const [workspace, intake, summary] = await Promise.all([
      fetch(`/api/v2/cases/${id}/workspace`).then((response) => response.json()) as Promise<{
        status: string;
        workspaceRevision: number;
      }>,
      fetch(`/api/v2/cases/${id}/intake`).then((response) => response.json()) as Promise<{
        status: string;
        confirmedSummaryRevision: number | null;
        summary: { revision: number };
      }>,
      fetch(`/api/v2/cases/${id}/summary`).then((response) => response.json()) as Promise<{
        overview: string;
        revision: number;
      }>,
    ]);
    return {
      workspaceStatus: workspace.status,
      workspaceRevision: workspace.workspaceRevision,
      intakeStatus: intake.status,
      confirmedSummaryRevision: intake.confirmedSummaryRevision,
      summaryRevision: summary.revision,
      intakeSummaryRevision: intake.summary.revision,
      overview: summary.overview,
    };
  }, id);
}

async function expectConfirmedWorkspace(page: Page, id: string) {
  await expect(page).toHaveURL(new RegExp(`/cases/${id}$`));
  const panel = page.getByRole("complementary", { name: "사건 요약 및 준비 현황" });
  await expect(panel).toBeVisible();
  const disclosure = panel.getByText("사건 요약과 준비 현황", { exact: true });
  if (!(await disclosure.evaluate((element) => element.closest("details")?.hasAttribute("open"))))
    await disclosure.click();
  await expect(panel.getByText(originalSummary, { exact: true })).toBeVisible();
}

type Recovery = "same" | "other-owner" | "deleted" | "revision" | "files";
const scenarios: { operation: "save" | "confirm"; loseSession: boolean; recovery: Recovery }[] = [];
for (const operation of ["save", "confirm"] as const)
  for (const loseSession of [false, true])
    scenarios.push({ operation, loseSession, recovery: "same" });
for (const recovery of ["other-owner", "deleted", "revision", "files"] as const)
  scenarios.push({ operation: "confirm", loseSession: true, recovery });

for (const { operation, loseSession, recovery } of scenarios) {
  test(`real summary ${operation}; final session failure=${loseSession}${recovery === "same" ? "" : `; recovery=${recovery}`}`, async ({
    page,
    context,
  }) => {
    const browserOrigin = "http://127.0.0.1:4355";
    const server = spawn("bun", ["tests/helpers/customer-browser-server.ts", browserOrigin], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const info: {
      origin: string;
      id: string;
      ownerCookie: Parameters<typeof context.addCookies>[0][number];
      foreignCookie: Parameters<typeof context.addCookies>[0][number];
    } = await new Promise((resolve, reject) => {
      let out = "";
      server.stdout.on("data", (chunk) => {
        out += String(chunk);
        if (out.includes("\n")) resolve(JSON.parse(out.split("\n")[0]!));
      });
      server.on("error", reject);
      server.on("exit", (code) => {
        if (code) reject(new Error("Synthetic API failed"));
      });
    });
    try {
      await context.addCookies([info.ownerCookie]);
      let committed = false,
        failed = false;
      let saveWrites = 0,
        confirmWrites = 0;
      let caseUnavailable = false;
      await context.route("**/api/**", async (route) => {
        const req = route.request(),
          url = new URL(req.url()),
          path = url.pathname;
        if (!path.startsWith("/api/")) {
          await route.continue();
          return;
        }
        if (caseUnavailable && path.startsWith(`/api/v2/cases/${info.id}/`)) {
          await route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
          return;
        }
        if (path === "/api/me/session" && committed && loseSession && !failed) {
          failed = true;
          await route.abort("failed");
          return;
        }
        if (req.method() === "PUT" && path.endsWith("/summary")) saveWrites++;
        if (req.method() === "POST" && path.endsWith("/summary/confirm")) confirmWrites++;
        const response = await context.request.fetch(new URL(path + url.search, info.origin).href, {
          method: req.method(),
          headers: req.headers(),
          data: req.postDataBuffer() ?? undefined,
        });
        if (
          response.ok() &&
          ((operation === "save" && req.method() === "PUT" && path.endsWith("/summary")) ||
            (operation === "confirm" &&
              req.method() === "POST" &&
              path.endsWith("/summary/confirm")))
        )
          committed = true;
        await route.fulfill({ response });
      });
      const summaryUrl = `/cases/${info.id}/summary${recovery === "files" ? "?from=files" : ""}`;
      await page.goto(summaryUrl);
      if (operation === "save") {
        const editor = page.getByLabel("요약 편집");
        await editor.fill("저장 후 세션 확인 실패를 검증하는 합성 요약입니다.");
        await page.getByRole("button", { name: "수정 내용 저장" }).click();
        if (!loseSession) {
          await expect(page.getByText("수정한 요약이 저장됐어요.")).toBeVisible();
          await expect(page).toHaveURL(new RegExp(`/cases/${info.id}/summary$`));
          expect(saveWrites).toBe(1);
          expect(confirmWrites).toBe(0);
          return;
        }
        await expect(page.getByRole("alert")).toContainText("연결하지 못했어요");
        const saved = await page.evaluate(
          async (id) =>
            ((await (await fetch(`/api/v2/cases/${id}/summary`)).json()) as { overview: string })
              .overview,
          info.id,
        );
        expect(saved).toBe("저장 후 세션 확인 실패를 검증하는 합성 요약입니다.");
        await page.getByRole("button", { name: "다시 시도", exact: true }).click();
        await expect(page.getByRole("alert")).toHaveCount(0);
        await expect(editor).toHaveValue(saved);
        await expect(page).toHaveURL(new RegExp(`/cases/${info.id}/summary$`));
        await page.reload();
        await expect(editor).toHaveValue(saved);
        expect(saveWrites).toBe(1);
        expect(confirmWrites).toBe(0);
      } else {
        await page.getByLabel("요약이 내가 이야기한 사실과 맞는지 확인했어요.").check();
        await page.getByRole("button", { name: "요약 확인하고 계속" }).click();
        await page.getByRole("button", { name: "확인하고 사건 열기" }).click();
        let accepted: Awaited<ReturnType<typeof summarySnapshot>> | undefined;
        if (loseSession) {
          await expect(page.getByRole("alert")).toContainText("연결하지 못했어요");
          const saved = await page.evaluate(
            async (id) =>
              ((await (await fetch(`/api/v2/cases/${id}/workspace`)).json()) as { status: string })
                .status,
            info.id,
          );
          expect(saved).toBe("active");
          accepted = await summarySnapshot(page, info.id);
          expect(accepted.overview).toBe(originalSummary);
          expect(accepted.intakeStatus).toBe("confirmed");
          expect(accepted.confirmedSummaryRevision).toBe(accepted.summaryRevision);
          expect(confirmWrites).toBe(1);
          if (recovery === "other-owner") await context.addCookies([info.foreignCookie]);
          // A deleted/inaccessible case's authoritative read denies scope. This
          // transport fixture does not claim to run the deletion workflow.
          if (recovery === "deleted") caseUnavailable = true;
          if (recovery === "revision")
            await page.evaluate(
              async ({ id, revision, summary }) => {
                const path = "/src/client/api/index.ts";
                const { api } = (await import(path)) as typeof import("../../src/client/api");
                await api.cases.saveSummary(id, { expectedRevision: revision, summary });
              },
              { id: info.id, revision: accepted.workspaceRevision, summary: peerSummary },
            );
          await page.getByRole("button", { name: "다시 시도", exact: true }).click();
          if (recovery === "other-owner" || recovery === "deleted") {
            await expect(page.getByRole("alert")).toBeVisible();
            await expect(page.getByLabel("요약 편집")).not.toBeVisible();
            await expect(page.getByText(originalSummary, { exact: true })).toHaveCount(0);
            await expect(page).toHaveURL(new RegExp(`/cases/${info.id}/summary$`));
            expect(confirmWrites).toBe(1);
            if (recovery === "other-owner") {
              await context.addCookies([info.ownerCookie]);
              await page.evaluate(() => window.dispatchEvent(new Event("focus")));
              await expect(page.getByLabel("요약 편집")).toHaveValue(originalSummary);
              await expect(page).toHaveURL(new RegExp(`/cases/${info.id}/summary$`));
              expect(confirmWrites).toBe(1);
            }
            return;
          }
          await expect(page.getByRole("alert")).toHaveCount(0);
          if (recovery === "revision") {
            await expect(page).toHaveURL(new RegExp(`/cases/${info.id}/summary$`));
            await expect(page.getByLabel("요약 편집")).toHaveValue(peerSummary);
            await expect(
              page.getByLabel("요약이 내가 이야기한 사실과 맞는지 확인했어요."),
            ).not.toBeChecked();
            const changed = await summarySnapshot(page, info.id);
            expect(changed.confirmedSummaryRevision).toBeNull();
            expect(changed.summaryRevision).toBeGreaterThan(accepted.summaryRevision);
            expect(confirmWrites).toBe(1);
            expect(saveWrites).toBe(1);
            return;
          }
        }
        if (recovery === "files") {
          await expect(page).toHaveURL(new RegExp(`/cases/${info.id}/files$`));
          await expect(page.getByRole("heading", { name: "사건 자료", exact: true })).toBeVisible();
        } else await expectConfirmedWorkspace(page, info.id);
        const confirmed = await summarySnapshot(page, info.id);
        expect(confirmed.workspaceStatus).toBe("active");
        expect(confirmed.intakeStatus).toBe("confirmed");
        expect(confirmed.overview).toBe(originalSummary);
        expect(confirmed.summaryRevision).toBeGreaterThan(0);
        expect(confirmed.confirmedSummaryRevision).toBe(confirmed.summaryRevision);
        expect(confirmed.intakeSummaryRevision).toBe(confirmed.summaryRevision);
        if (accepted) expect(confirmed).toEqual(accepted);
        await page.reload();
        if (recovery !== "files") await expectConfirmedWorkspace(page, info.id);
        expect(await summarySnapshot(page, info.id)).toEqual(confirmed);
        expect(confirmWrites).toBe(1);
        expect(saveWrites).toBe(0);
        if (loseSession && recovery === "same") {
          await page.goto(summaryUrl);
          await page
            .getByLabel("요약 편집")
            .fill("작업 공간에서 직접 편집한 활성 사건의 합성 요약입니다.");
          await page.getByRole("button", { name: "수정 내용 저장하고 적용", exact: true }).click();
          await expect(page.getByText("수정한 요약이 저장됐어요.")).toBeVisible();
          await expect(page).toHaveURL(new RegExp(`/cases/${info.id}/summary$`));
          const edited = await summarySnapshot(page, info.id);
          expect(edited.overview).toBe("작업 공간에서 직접 편집한 활성 사건의 합성 요약입니다.");
          expect(edited.confirmedSummaryRevision).toBe(edited.summaryRevision);
          expect(confirmWrites).toBe(2);
          expect(saveWrites).toBe(1);
        }
      }
    } finally {
      try {
        // Stop new page requests, then drain active routes before shutting down the API.
        await page.close();
        await context.unrouteAll({ behavior: "wait" });
      } finally {
        server.stdin.end();
        server.kill();
      }
    }
  });
}

test("chat additions require the new summary confirmation in the real customer UI", async ({
  page,
  context,
}) => {
  const browserOrigin = "http://127.0.0.1:4355";
  const server = spawn(
    "bun",
    ["tests/helpers/customer-browser-server.ts", browserOrigin, "pending-chat-summary"],
    {
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const info: {
    origin: string;
    id: string;
    ownerCookie: Parameters<typeof context.addCookies>[0][number];
  } = await new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error("Synthetic API startup timed out")), 15000);
    server.stdout.on("data", (chunk) => {
      out += String(chunk);
      if (out.includes("\n")) {
        clearTimeout(timer);
        resolve(JSON.parse(out.split("\n")[0]!));
      }
    });
    server.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.once("exit", (code) => {
      clearTimeout(timer);
      if (code) reject(new Error("Synthetic API failed"));
    });
  });
  try {
    await context.addCookies([info.ownerCookie]);
    await context.route("**/api/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (!url.pathname.startsWith("/api/")) {
        await route.continue();
        return;
      }
      const response = await context.request.fetch(
        new URL(url.pathname + url.search, info.origin).href,
        {
          method: req.method(),
          headers: req.headers(),
          data: req.postDataBuffer() ?? undefined,
        },
      );
      await route.fulfill({ response });
    });
    await page.goto(`/cases/${info.id}`);
    await expect(
      page.getByText("요약이 변경되어 다시 확인이 필요해요. 확인한 뒤 대화를 이어갈 수 있어요.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByLabel("추가 사실 또는 질문")).toBeDisabled();
    await page.getByRole("link", { name: "요약 확인하기", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/cases/${info.id}/summary$`));
    await expect(page.getByText("새로운 자료를 찾았습니다.", { exact: true })).toBeVisible();
    await page.getByLabel("요약이 내가 이야기한 사실과 맞는지 확인했어요.").check();
    await page.getByRole("button", { name: "요약 확인하고 계속" }).click();
    await page.getByRole("button", { name: "확인하고 사건 열기" }).click();
    await expect(page).toHaveURL(new RegExp(`/cases/${info.id}$`));
    await expect(page.getByLabel("추가 사실 또는 질문")).toBeEnabled();
    const intake = await page.evaluate(
      async (id) =>
        (await (await fetch(`/api/v2/cases/${id}/intake`)).json()) as {
          confirmedSummaryRevision: number;
          summary: { revision: number };
        },
      info.id,
    );
    expect(intake.summary.revision).toBe(2);
    expect(intake.confirmedSummaryRevision).toBe(2);
  } finally {
    try {
      await page.close();
      await context.unrouteAll({ behavior: "wait" });
    } finally {
      server.stdin.end();
      server.kill();
    }
  }
});
