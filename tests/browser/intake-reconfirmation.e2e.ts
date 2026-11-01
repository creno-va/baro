import { expect, type Page, test } from "@playwright/test";
import { reconfirmationCase } from "../helpers/intake-reconfirmation";

// Browser fixtures are local/synthetic and never call a model or legal provider.
async function seed(page: Page, stage: "summary" | "active" = "summary") {
  const item = reconfirmationCase(stage);
  await page.addInitScript((item) => {
    if (localStorage.getItem("synthetic-reconfirmation-seeded")) return;
    const owner = "synthetic-reconfirmation-owner";
    const values = {
      session: {
        user: { id: owner, name: "합성 사용자", accountType: "customer" },
        needsConsent: false,
      },
      cases: { [item.id]: item },
      caseOwners: { [item.id]: owner },
      files: {},
    };
    for (const [key, value] of Object.entries(values))
      localStorage.setItem(`baro-api-mock-v1:${key}`, JSON.stringify(value));
    localStorage.setItem("synthetic-reconfirmation-seeded", "true");
  }, item);
  return item;
}

for (const stage of ["summary", "active"] as const) {
  test(`${stage}: reads canonical facts and unknowns without a raw summary editor`, async ({
    page,
  }) => {
    const item = await seed(page, stage);
    await page.goto(`/cases/${item.id}/summary`);
    await expect(page.getByText(item.summary, { exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "요약 편집", exact: true })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "사실 내용", exact: true })).toHaveCount(0);
    for (const fact of item.summaryDetails?.facts ?? [])
      await expect(page.getByText(fact.text, { exact: true })).toBeVisible();
    await expect(
      page.getByText("지급일 변경에 합의했는지는 확인되지 않았습니다.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "맞아요", exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "다른 부분이 있어요", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "빠진 내용이 있어요", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("미확인 입장", { exact: true })).toBeVisible();
  });
}

test("320px: read actions fit the page and keep touch targets", async ({ page }) => {
  const item = await seed(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(`/cases/${item.id}/summary`);
  await expect(page.getByRole("button", { name: "다른 부분이 있어요", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const name of ["맞아요", "다른 부분이 있어요", "빠진 내용이 있어요"]) {
    const box = await page.getByRole("button", { name, exact: true }).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
});
