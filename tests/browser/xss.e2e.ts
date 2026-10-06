import { expect, test } from "@playwright/test";
import { guidance } from "../fixtures/contracts";

test("untrusted HTML and script URLs fail strict detail schema without execution or result display", async ({
  page,
}) => {
  await page.route("**/api/me/session", (route) =>
    route.fulfill({
      json: {
        user: { id: "synthetic-owner", name: "합성 고객", accountType: "customer" },
        needsConsent: false,
      },
    }),
  );
  await page.route("**/api/v2/cases/*/workspace", (route) =>
    route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } }),
  );
  const id = "11111111-1111-4111-8111-111111111111";
  await page.addInitScript(() => {
    (window as unknown as { injected: number }).injected = 0;
  });
  for (const malicious of [
    {
      ...guidance,
      summary: { ...guidance.summary, userStatements: ['<img src=x onerror="window.injected=1">'] },
    },
    {
      ...guidance,
      citations: guidance.citations.map((citation) => ({
        ...citation,
        url: "javascript:window.injected=1",
      })),
    },
  ]) {
    await page.route(`**/api/cases/${id}`, (route) =>
      route.fulfill({
        json: {
          caseId: id,
          analysisId: "22222222-2222-4222-8222-222222222222",
          inputRevision: 1,
          title: "금전 대여 사건",
          status: "completed",
          questions: [],
          result: malicious,
          error: null,
        },
      }),
    );
    await page.goto(`/cases/${id}`);
    await expect(page.getByRole("alert")).toContainText("사건을 찾을 수 없어요");
    await expect(page.getByRole("heading", { name: "상황 정리" })).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { injected: number }).injected)).toBe(0);
    await page.unroute(`**/api/cases/${id}`);
  }
});
