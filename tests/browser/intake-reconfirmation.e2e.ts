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

for (const [purpose, subject] of [
  ["고소·청구를 준비하고 싶어요", "개인"],
  ["상대방 주장에 대응하고 싶어요", "기업"],
] as const) {
  test(`${purpose}: saves a separate subject context and resumes the same purpose`, async ({
    page,
  }) => {
    await seed(page);
    await page.goto("/app");
    await page.getByRole("radio", { name: purpose, exact: true }).check();
    await page.getByRole("radio", { name: subject, exact: true }).check();
    await page
      .getByLabel("지금까지 있었던 일")
      .fill("실제 사건이 없는 합성 입력입니다. 서로 다른 입장과 기업 맥락을 따로 저장합니다.");
    await page.getByRole("button", { name: "저장하고 계속", exact: true }).click();
    await expect(page).toHaveURL(/\/intake$/);
    await expect(page.getByText(purpose, { exact: true })).toBeVisible();
    await expect(page.getByText(`${subject} 사건`, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(purpose, { exact: true })).toBeVisible();
    await expect(page.getByText(`${subject} 사건`, { exact: true })).toBeVisible();
    await expect(page.getByText("절차 단계 미확인", { exact: true })).toBeVisible();
  });
}

async function canonical(page: Page, id: string) {
  return page.evaluate(
    (id) => JSON.parse(localStorage.getItem("baro-api-mock-v1:cases") ?? "{}")[id],
    id,
  );
}
async function propose(
  page: Page,
  explanation = "상대방에게 일부 돌려받은 일이 빠졌어요. 정확한 금액은 아직 몰라요.",
) {
  await page.getByRole("button", { name: "빠진 내용이 있어요", exact: true }).click();
  await page
    .getByRole("textbox", { name: "빠진 내용을 알려주세요", exact: true })
    .fill(explanation);
  await page.getByRole("button", { name: "변경안 요청하기", exact: true }).click();
  await expect(page.getByRole("button", { name: "변경안 확정하기", exact: true })).toBeVisible();
}

test("proposal resume, cancel, explain again and confirm preserve canonical provenance", async ({
  page,
}) => {
  const item = await seed(page, "active");
  await page.goto(`/cases/${item.id}/summary`);
  await propose(page);
  expect((await canonical(page, item.id)).summaryDetails).toEqual(item.summaryDetails);
  await page.reload();
  await expect(page.getByRole("button", { name: "변경안 확정하기", exact: true })).toBeVisible();
  expect((await canonical(page, item.id)).summaryDetails).toEqual(item.summaryDetails);
  await page.getByRole("button", { name: "변경안 취소", exact: true }).click();
  await expect(page.getByRole("button", { name: "맞아요", exact: true })).toBeVisible();
  expect((await canonical(page, item.id)).summaryDetails).toEqual(item.summaryDetails);
  await propose(page);
  await page.getByRole("button", { name: "변경안 확정하기", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/cases/${item.id}$`));
  const saved = await canonical(page, item.id);
  expect(saved.summaryDetails.revision).toBe(4);
  expect(saved.summaryDetails.facts.slice(0, 3)).toEqual(item.summaryDetails?.facts);
  expect(saved.summaryDetails.unknowns).toEqual(item.summaryDetails?.unknowns);
});

test("a lost request response retries the same persisted proposal", async ({ page }) => {
  const item = await seed(page);
  await page.goto(`/cases/${item.id}/summary`);
  await page.getByRole("button", { name: "다른 부분이 있어요", exact: true }).click();
  const input = page.getByRole("textbox", { name: "다른 부분을 알려주세요", exact: true });
  await input.fill("일부 반환받은 사실을 빠뜨렸어요. 정확한 금액은 몰라요.");
  await page.evaluate(() =>
    localStorage.setItem("synthetic-reconciliation-fault", "request-lost-after"),
  );
  await page.getByRole("button", { name: "변경안 요청하기", exact: true }).click();
  await expect(input).toHaveValue("일부 반환받은 사실을 빠뜨렸어요. 정확한 금액은 몰라요.");
  await expect(page.getByRole("button", { name: "변경안 요청하기", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "변경안 요청하기", exact: true }).click();
  await expect(page.getByRole("button", { name: "변경안 확정하기", exact: true })).toBeVisible();
  expect((await canonical(page, item.id)).revision).toBe(13);
  expect((await canonical(page, item.id)).summaryDetails).toEqual(item.summaryDetails);
});

test("confirmation readback recovers a postflight outage without another mutation", async ({
  page,
}) => {
  const item = await seed(page);
  await page.goto(`/cases/${item.id}/summary`);
  await propose(page);
  await page.evaluate(() =>
    localStorage.setItem("synthetic-reconciliation-fault", "confirm-ui-postflight"),
  );
  await page.getByRole("button", { name: "변경안 확정하기", exact: true }).click();
  await expect(page.getByRole("button", { name: "다시 시도", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/cases/${item.id}$`));
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("baro-api-mock-v1:syntheticReconciliationCounts") ?? "{}")
          .confirm,
    ),
  ).toBe(1);
  expect((await canonical(page, item.id)).revision).toBe(14);
});

test("a peer tab's newer revision cannot be overwritten by a proposal", async ({ page }) => {
  const item = await seed(page);
  await page.goto(`/cases/${item.id}/summary`);
  await propose(page);
  await page.evaluate((id) => {
    const values = JSON.parse(localStorage.getItem("baro-api-mock-v1:cases") ?? "{}");
    values[id].revision++;
    values[id].summary = "다른 탭에서 저장한 정리입니다.";
    values[id].summaryDetails.overview = values[id].summary;
    values[id].summaryDetails.revision++;
    localStorage.setItem("baro-api-mock-v1:cases", JSON.stringify(values));
  }, item.id);
  await page.getByRole("button", { name: "변경안 확정하기", exact: true }).click();
  await expect(page.getByRole("button", { name: "다시 시도", exact: true })).toBeVisible();
  expect((await canonical(page, item.id)).summary).toBe("다른 탭에서 저장한 정리입니다.");
  expect((await canonical(page, item.id)).summaryDetails.facts).toEqual(item.summaryDetails?.facts);
});

test("account change purges the explanation, private summary and proposal", async ({ page }) => {
  const item = await seed(page);
  await page.goto(`/cases/${item.id}/summary`);
  await page.getByRole("button", { name: "빠진 내용이 있어요", exact: true }).click();
  await page
    .getByRole("textbox", { name: "빠진 내용을 알려주세요", exact: true })
    .fill("다른 계정에 보여서는 안 되는 합성 설명입니다.");
  await page.evaluate(() => {
    localStorage.setItem(
      "baro-api-mock-v1:session",
      JSON.stringify({
        user: { id: "synthetic-foreign", name: "다른 합성 계정", accountType: "customer" },
        needsConsent: false,
      }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key: "baro-api-mock-v1:session" }));
  });
  await expect(
    page.getByRole("textbox", { name: "빠진 내용을 알려주세요", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(item.summary, { exact: true })).toHaveCount(0);
  expect((await canonical(page, item.id)).summaryDetails).toEqual(item.summaryDetails);
});

test("keyboard Escape returns focus to the request button and leaves canonical summary untouched", async ({
  page,
}) => {
  const item = await seed(page);
  await page.goto(`/cases/${item.id}/summary`);
  const opener = page.getByRole("button", { name: "다른 부분이 있어요", exact: true });
  await opener.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "어떤 부분이 다른가요?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  expect((await canonical(page, item.id)).summaryDetails).toEqual(item.summaryDetails);
});
