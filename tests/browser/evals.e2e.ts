import { spawn } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("all 50 pipeline fixtures render actual owner-scoped details with zero automated WCAG A/AA findings", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const child = spawn("bun", ["tests/helpers/eval-browser-server.ts", baseURL ?? ""], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  try {
    const metadata = await new Promise<{
      origin: string;
      cases: {
        id: string;
        version: string;
        category: string;
        caseId: string;
        cookie: {
          name: string;
          value: string;
          url: string;
          httpOnly: boolean;
          secure: boolean;
          sameSite: "Lax";
        };
      }[];
    }>((resolve, reject) => {
      let output = "";
      const timeout = setTimeout(() => reject(new Error("EVAL_HARNESS_TIMEOUT")), 30_000);
      child.once("error", () => {
        clearTimeout(timeout);
        reject(new Error("EVAL_HARNESS_UNAVAILABLE"));
      });
      child.once("exit", () => {
        clearTimeout(timeout);
        reject(new Error("EVAL_HARNESS_EXIT"));
      });
      child.stdout.on("data", (chunk) => {
        output += String(chunk);
        if (output.includes("\n")) {
          clearTimeout(timeout);
          resolve(JSON.parse(output.split("\n")[0] ?? "{}"));
        }
      });
    });
    expect(metadata.cases).toHaveLength(50);
    await page.route("**/api/**", async (route) => {
      const response = await route.fetch({
        url: metadata.origin + new URL(route.request().url()).pathname,
        headers: await route.request().allHeaders(),
      });
      await route.fulfill({ response });
    });
    const headings: Record<string, string> = {
      guidance: "상황 정리",
      needs_clarification: "확인이 필요한 내용",
      out_of_scope: "지원 범위 안내",
      urgent_redirect: "안전 확인이 우선이에요",
    };
    const reports = [];
    for (const entry of metadata.cases) {
      // End the previous owner's polling before replacing its session cookie.
      // Otherwise its 401 redirect can abort the next owner's navigation.
      await page.goto("about:blank");
      await context.clearCookies();
      await context.addCookies([entry.cookie]);
      await page.setViewportSize({ width: 320, height: 800 });
      await page.goto(`/cases/${entry.caseId}`);
      await expect(
        page.getByRole("heading", {
          name: headings[entry.category] ?? "INVALID_CATEGORY",
          exact: true,
        }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
        entry.id,
      ).toBe(true);
      if (entry.category === "guidance") {
        const source = page.getByRole("link", { name: /공식 원문/ }).first();
        await expect(source).toHaveAttribute("href", /^https:\/\/(?:www\.)?law\.go\.kr\//);
        await source.focus();
        await expect(source).toBeFocused();
      }
      const audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const findings = audit.violations.map((v) => v.id);
      reports.push({ fixtureId: entry.id, fixtureVersion: entry.version, findings });
      expect(findings, entry.id).toEqual([]);
    }
    // Only fixture IDs, versions and rule IDs; no page HTML, text, cookies or traces.
    await writeReport(reports);
  } finally {
    child.stdin.end();
    child.kill();
  }
});
async function writeReport(reports: unknown) {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(".wrangler/eval", { recursive: true });
  await writeFile(
    ".wrangler/eval/ui.json",
    JSON.stringify(
      {
        mode: "deterministic-detail-ui",
        candidateSha: process.env.EVAL_CANDIDATE_SHA ?? "local",
        reports,
      },
      null,
      2,
    ),
  );
}
