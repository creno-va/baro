import { expect, test } from "@playwright/test";
import { summary } from "../fixtures/contracts/v2";

const caseId = "shell-app-case";
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(
    ({ caseId, summary }) => {
      if (localStorage.getItem("shell-app-seeded")) return;
      localStorage.setItem("shell-app-seeded", "1");
      const now = new Date().toISOString();
      const item = {
        id: caseId,
        title: "돌려받지 못한 보증금과 반환 약속을 함께 정리하는 긴 사건 제목",
        schemaVersion: "2",
        stage: "active",
        revision: 1,
        updatedAt: now,
        summary: "계약 종료 뒤 보증금을 돌려받지 못한 합성 사건입니다.",
        summaryDetails: summary,
        subjectContext: "individual",
      };
      const values = {
        session: {
          user: { id: "shell-app-owner", name: "합성 고객", accountType: "customer" },
          needsConsent: false,
        },
        cases: { [caseId]: item },
        caseOwners: { [caseId]: "shell-app-owner" },
        reworkContexts: {
          [caseId]: {
            casePurpose: "prepare_claim",
            subjectContext: "individual",
            procedure: { kind: "unconfirmed", stage: "unconfirmed", description: null },
          },
        },
        workspace: { [caseId]: { messages: [], timeline: [], actions: [] } },
        files: { [caseId]: [] },
      };
      for (const [key, value] of Object.entries(values))
        localStorage.setItem(`baro-api-mock-v1:${key}`, JSON.stringify(value));
    },
    { caseId, summary },
  );
});

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`actual Astro shell and direct case routes fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/new", `/cases/${caseId}`, "/settings", "/lawyers"]) {
      await page.goto(route);
      await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator(".app-frame[data-app-workspace]")).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        route,
      ).toBe(true);
      await page.screenshot({
        path: `.wrangler/ui01/app-${route === "/new" ? "new" : route.includes("cases") ? "chat" : route.slice(1)}-${width}.png`,
        animations: "disabled",
      });
    }
    await page.goto(`/cases/${caseId}`);
    await page.locator(".case-tools > summary").click();
    const tools = page.getByRole("navigation", { name: "사건 도구", exact: true });
    const link = tools.getByRole("link", { name: "유사 판례", exact: true });
    const point = await link.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    expect(
      await link.evaluate(
        (node, point) => node.contains(document.elementFromPoint(point.x, point.y)),
        point,
      ),
    ).toBe(true);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/cases/${caseId}/precedents$`));
    await expect(page.getByRole("link", { name: "대화로 돌아가기", exact: true })).toHaveAttribute(
      "href",
      `/cases/${caseId}`,
    );
    for (const suffix of ["files", "timeline", "actions", "reports"]) {
      await page.goto(`/cases/${caseId}/${suffix}`);
      await expect(page.locator(".case-header")).toBeVisible();
      await expect(page.locator(".workspace-tabs")).toHaveCount(0);
    }
  });
}

for (const width of [390, 1440]) {
  test(`captures exact-base app before images at ${width}px`, async ({ page }) => {
    test.skip(!process.env.BARO_SHELL_BASELINE_URL, "Set an isolated exact-base mock server URL.");
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/new", `/cases/${caseId}`]) {
      await page.goto(`${process.env.BARO_SHELL_BASELINE_URL}${route}`);
      await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: `.wrangler/ui01/app-${route === "/new" ? "new" : "chat"}-before-${width}.png`,
        animations: "disabled",
      });
    }
  });
}
