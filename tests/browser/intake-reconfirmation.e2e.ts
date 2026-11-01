import { expect, type Page, test } from "@playwright/test";
import { reconfirmationCase } from "../helpers/intake-reconfirmation";

// Browser fixtures are local/synthetic and never call a model or legal provider.
async function seed(page: Page, stage: "summary" | "active" = "summary") {
  await page.emulateMedia({ reducedMotion: "reduce" });
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
    await page.screenshot({ path: `.wrangler/ui622/summary-${stage}-desktop.png`, fullPage: true });
  });
}

test("320px: read actions fit the page and keep touch targets", async ({ page }) => {
  const item = await seed(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(`/cases/${item.id}/summary`);
  await expect(page.getByRole("button", { name: "다른 부분이 있어요", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: ".wrangler/ui622/summary-mobile-320.png", fullPage: true });
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
  await page.screenshot({ path: ".wrangler/ui622/summary-proposal-desktop.png", fullPage: true });
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
  await expect(page.getByRole("button", { name: "최신 내용 불러오기", exact: true })).toBeVisible();
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

test("legacy purpose stays unconfirmed until the user saves; subject and procedure are preserved", async ({
  page,
}) => {
  const item = await seed(page, "active");
  await page.goto(`/cases/${item.id}/summary`);
  await page.getByRole("button", { name: "입장 확인하기", exact: true }).click();
  await expect(
    page.getByRole("radio", { name: "상대방 주장에 대응하고 싶어요", exact: true }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "나중에 확인", exact: true }).click();
  await expect(page.getByText("미확인 입장", { exact: true })).toBeVisible();
  expect((await canonical(page, item.id)).revision).toBe(12);
  await page.getByRole("button", { name: "입장 확인하기", exact: true }).click();
  await page.getByRole("radio", { name: "상대방 주장에 대응하고 싶어요", exact: true }).check();
  await page.getByRole("button", { name: "입장 저장", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "어떤 입장에서 정리하고 싶나요?" }),
  ).not.toBeVisible();
  await expect(
    page
      .getByRole("complementary", { name: "사건 입장과 맥락" })
      .getByText("상대방 주장에 대응하고 싶어요", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("기업 사건", { exact: true })).toBeVisible();
  await expect(page.getByText("절차 단계 미확인", { exact: true })).toBeVisible();
  const saved = await canonical(page, item.id);
  expect(saved.subjectContext).toBe("company");
  expect(saved.revision).toBe(13);
  expect(saved.summaryDetails).toEqual(item.summaryDetails);
  await page.reload();
  await expect(
    page
      .getByRole("complementary", { name: "사건 입장과 맥락" })
      .getByText("상대방 주장에 대응하고 싶어요", { exact: true }),
  ).toBeVisible();
});

test("320px case input separates purpose from subject context without overflow", async ({
  page,
}) => {
  await seed(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/app");
  await page.getByRole("radio", { name: "상대방 주장에 대응하고 싶어요", exact: true }).check();
  await page.getByRole("radio", { name: "기업", exact: true }).check();
  await expect(page.getByLabel("지금까지 있었던 일")).toHaveAttribute(
    "placeholder",
    /상대방의 주장/,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const name of [
    "고소·청구를 준비하고 싶어요",
    "상대방 주장에 대응하고 싶어요",
    "개인",
    "기업",
  ]) {
    const box = await page.getByRole("radio", { name, exact: true }).locator("..").boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({
    path: ".wrangler/ui622/case-input-respond-mobile-320.png",
    fullPage: true,
  });
});

for (const stage of ["summary", "active"] as const)
  test(`${stage}: agrees with the saved summary without rewriting its facts`, async ({ page }) => {
    const item = await seed(page, stage);
    await page.goto(`/cases/${item.id}/summary`);
    await page.getByRole("button", { name: "맞아요", exact: true }).click();
    await page
      .getByRole("dialog", { name: "이 내용으로 계속할까요?" })
      .getByRole("button", { name: "취소", exact: true })
      .click();
    await expect(page.getByRole("button", { name: "맞아요", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "맞아요", exact: true }).click();
    await page.getByRole("button", { name: "확인하고 계속", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/cases/${item.id}$`));
    const saved = await canonical(page, item.id);
    expect(saved.stage).toBe("active");
    expect(saved.revision).toBe(stage === "summary" ? 13 : 12);
    expect(saved.summaryDetails).toEqual(item.summaryDetails);
  });

test("a conflict retains the natural explanation while explicitly loading the latest summary", async ({
  page,
}) => {
  const item = await seed(page);
  await page.goto(`/cases/${item.id}/summary`);
  await page.getByRole("button", { name: "빠진 내용이 있어요", exact: true }).click();
  const input = page.getByRole("textbox", { name: "빠진 내용을 알려주세요", exact: true });
  await input.fill("아직 제출하지 않은 합성 설명입니다.");
  await page.evaluate((id) => {
    const cases = JSON.parse(localStorage.getItem("baro-api-mock-v1:cases") ?? "{}");
    cases[id].revision++;
    cases[id].summaryDetails.revision++;
    cases[id].summaryDetails.overview = "다른 화면에서 확인한 최신 정리";
    cases[id].summary = cases[id].summaryDetails.overview;
    localStorage.setItem("baro-api-mock-v1:cases", JSON.stringify(cases));
  }, item.id);
  await page.getByRole("button", { name: "변경안 요청하기", exact: true }).click();
  await expect(input).toHaveValue("아직 제출하지 않은 합성 설명입니다.");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "최신 내용 불러오기", exact: true })
    .click();
  await expect(input).toHaveValue("아직 제출하지 않은 합성 설명입니다.");
  await expect(page.getByRole("button", { name: "변경안 요청하기", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "변경안 요청하기", exact: true }).click();
  await expect(page.getByRole("button", { name: "변경안 확정하기", exact: true })).toBeVisible();
  expect((await canonical(page, item.id)).summary).toBe("다른 화면에서 확인한 최신 정리");
});

for (const outcome of ["success", "failure"] as const)
  test(`an older ${outcome} read cannot replace a newer summary`, async ({ page }) => {
    const item = await seed(page);
    await page.goto(`/cases/${item.id}/summary`);
    await expect(page.getByRole("button", { name: "맞아요", exact: true })).toBeEnabled();
    await page.evaluate(async (outcome) => {
      const path = "/src/client/api/cases.ts";
      const core = "/src/client/api/core.ts";
      const { casesApi } = await import(path);
      const { ApiError } = await import(core);
      const get = casesApi.get.bind(casesApi);
      let first = true;
      casesApi.get = async (id: string) => {
        const snapshot = await get(id);
        if (!first) return snapshot;
        first = false;
        return new Promise((resolve, reject) => {
          (window as unknown as { releaseSummaryRead?: () => void }).releaseSummaryRead = () =>
            outcome === "success"
              ? resolve(snapshot)
              : reject(new ApiError("UNAVAILABLE", "합성 이전 조회 실패", true));
        });
      };
      window.dispatchEvent(new Event("focus"));
    }, outcome);
    await expect
      .poll(() =>
        page.evaluate(
          () => !!(window as unknown as { releaseSummaryRead?: () => void }).releaseSummaryRead,
        ),
      )
      .toBe(true);
    await page.evaluate((id) => {
      const cases = JSON.parse(localStorage.getItem("baro-api-mock-v1:cases") ?? "{}");
      cases[id].revision++;
      cases[id].summaryDetails.revision++;
      cases[id].summaryDetails.overview = "새로 확인한 최신 합성 정리";
      cases[id].summary = cases[id].summaryDetails.overview;
      localStorage.setItem("baro-api-mock-v1:cases", JSON.stringify(cases));
      window.dispatchEvent(new Event("focus"));
    }, item.id);
    await expect(page.getByText("새로 확인한 최신 합성 정리", { exact: true })).toBeVisible();
    await page.evaluate(async () => {
      (window as unknown as { releaseSummaryRead?: () => void }).releaseSummaryRead?.();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
    await expect(page.getByText("새로 확인한 최신 합성 정리", { exact: true })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

for (const mode of ["legacy", "archived"] as const)
  test(`${mode} summary routes remain read-only without a new rework record`, async ({ page }) => {
    const item = await seed(page);
    await page.addInitScript(
      ({ id, mode }) => {
        const cases = JSON.parse(localStorage.getItem("baro-api-mock-v1:cases") ?? "{}");
        if (mode === "legacy") cases[id].schemaVersion = "1";
        else cases[id].stage = "archived";
        localStorage.setItem("baro-api-mock-v1:cases", JSON.stringify(cases));
      },
      { id: item.id, mode },
    );
    await page.goto(`/cases/${item.id}/summary`);
    await expect(page.getByText(item.summary, { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "사건 열기", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "맞아요", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "입장 확인하기", exact: true })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "요약 편집", exact: true })).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

test("an early summary bookmark returns to saved questions without requiring a summary record", async ({
  page,
}) => {
  const item = await seed(page);
  await page.addInitScript((id) => {
    const cases = JSON.parse(localStorage.getItem("baro-api-mock-v1:cases") ?? "{}");
    cases[id].stage = "intake";
    cases[id].summary = "";
    delete cases[id].summaryDetails;
    localStorage.setItem("baro-api-mock-v1:cases", JSON.stringify(cases));
  }, item.id);
  await page.goto(`/cases/${item.id}/summary`);
  await expect(page.getByRole("link", { name: "질문 이어가기", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "변경안 요청하기", exact: true })).toHaveCount(0);
});

test("a peer replacing an acknowledged request cannot clear this tab's explanation", async ({
  page,
}) => {
  const item = await seed(page);
  await page.goto(`/cases/${item.id}/summary`);
  await page.getByRole("button", { name: "빠진 내용이 있어요", exact: true }).click();
  const input = page.getByRole("textbox", { name: "빠진 내용을 알려주세요", exact: true });
  await input.fill("이 탭에서 설명한 내용을 보존해야 합니다.");
  await page.evaluate(() =>
    localStorage.setItem("synthetic-reconciliation-fault", "request-peer-after"),
  );
  await page.getByRole("button", { name: "변경안 요청하기", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "최신 내용 불러오기", exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue("이 탭에서 설명한 내용을 보존해야 합니다.");
  expect((await canonical(page, item.id)).summaryDetails).toEqual(item.summaryDetails);
});

test("a peer's new request after cancellation requires an explicit fresh read", async ({
  page,
}) => {
  const item = await seed(page);
  await page.goto(`/cases/${item.id}/summary`);
  await propose(page);
  await page.evaluate(() =>
    localStorage.setItem("synthetic-reconciliation-fault", "cancel-peer-after"),
  );
  await page.getByRole("button", { name: "변경안 취소", exact: true }).click();
  await expect(page.getByRole("button", { name: "최신 내용 불러오기", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "최신 내용 불러오기", exact: true }).click();
  await expect(
    page.getByText("다른 탭에서 요청한 합성 보완 내용입니다.", { exact: true }),
  ).toBeVisible();
  expect((await canonical(page, item.id)).summaryDetails).toEqual(item.summaryDetails);
});
