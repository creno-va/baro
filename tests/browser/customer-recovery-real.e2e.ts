import { spawn } from "node:child_process";
import { expect, test } from "@playwright/test";

for (const operation of ["save", "confirm"] as const)
  for (const loseSession of [false, true]) {
    test(`real summary ${operation}; final session failure=${loseSession}`, async ({
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
        await context.route("**/api/**", async (route) => {
          const req = route.request(),
            url = new URL(req.url()),
            path = url.pathname;
          if (!path.startsWith("/api/")) {
            await route.continue();
            return;
          }
          if (path === "/api/me/session" && committed && loseSession && !failed) {
            failed = true;
            await route.abort("failed");
            return;
          }
          const response = await context.request.fetch(
            new URL(path + url.search, info.origin).href,
            {
              method: req.method(),
              headers: req.headers(),
              data: req.postDataBuffer() ?? undefined,
            },
          );
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
        await page.goto(`/cases/${info.id}/summary`);
        if (operation === "save") {
          const editor = page.getByLabel("요약 편집");
          await editor.fill("저장 후 세션 확인 실패를 검증하는 합성 요약입니다.");
          await page.getByRole("button", { name: "수정 내용 저장" }).click();
          if (!loseSession) {
            await expect(page.getByText("수정한 요약이 저장됐어요.")).toBeVisible();
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
        } else {
          await page.getByLabel("요약이 내가 이야기한 사실과 맞는지 확인했어요.").check();
          await page.getByRole("button", { name: "요약 확인하고 계속" }).click();
          await page.getByRole("button", { name: "확인하고 사건 열기" }).click();
          if (!loseSession) {
            await expect(page).toHaveURL(new RegExp(`/cases/${info.id}$`));
            return;
          }
          await expect(page.getByRole("alert")).toContainText("연결하지 못했어요");
          const saved = await page.evaluate(
            async (id) =>
              ((await (await fetch(`/api/v2/cases/${id}/workspace`)).json()) as { status: string })
                .status,
            info.id,
          );
          expect(saved).toBe("active");
          await page.getByRole("button", { name: "다시 시도", exact: true }).click();
          await expect(page.getByRole("alert")).toHaveCount(0);
          await expect(page.getByRole("link", { name: "사건 열기", exact: true })).toBeVisible();
        }
      } finally {
        server.stdin.end();
        server.kill();
      }
    });
  }
