import { expect, type Page, test } from "@playwright/test";
import {
  reconfirmationCandidate,
  reconfirmationCase,
  reconfirmationSummary,
} from "../helpers/intake-reconfirmation";

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

test("keyboard submission and proposal cancellation keep focus in the current review controls", async ({
  page,
  browserName,
}) => {
  const item = await seed(page);
  await page.goto(`/cases/${item.id}/summary`);
  const trigger = page.getByRole("button", { name: "빠진 내용이 있어요", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("textbox", { name: "빠진 내용을 알려주세요", exact: true })
    .fill("초점 복귀를 검증하는 합성 진술입니다. 일부 금액은 아직 모릅니다.");
  await page.getByRole("button", { name: "변경안 요청하기", exact: true }).focus();
  await page.keyboard.press("Enter");
  const review = page.getByRole("region", { name: "사건 정리 확인", exact: true });
  // macOS WebKit uses Option+Tab to include buttons in native sequential navigation.
  const nextControlKey =
    browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab";
  await expect(page.getByRole("button", { name: "변경안 확정하기", exact: true })).toBeVisible();
  await expect(review).toBeFocused();
  await page.keyboard.press(nextControlKey);
  await expect(page.getByText("변경 전 전체 내용", { exact: true })).toBeFocused();
  await page.getByRole("button", { name: "변경안 취소", exact: true }).click();
  const agree = page.getByRole("button", { name: "맞아요", exact: true });
  await expect(agree).toBeEnabled();
  await expect(review).toBeFocused();
  await page.keyboard.press(nextControlKey);
  await expect(agree).toBeFocused();
  // Ordinary dismissal after an earlier successful request still returns to its own opener.
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

for (const focusInside of [true, false]) {
  test(`an async proposal ${focusInside ? "retains focus in review controls" : "does not steal focus from navigation"}`, async ({
    page,
  }) => {
    const item = await seed(page, "active");
    const before = reconfirmationSummary();
    const pending = {
      contractVersion: "conversation-report-v1",
      workspaceRevision: 13,
      status: "pending",
      request: {
        id: "synthetic-reconciliation-request",
        input: {
          expectedRevision: 12,
          summaryRevision: 3,
          kind: "addition",
          explanation: "비동기 변경안의 초점을 확인하는 합성 설명입니다.",
        },
        createdAt: before.createdAt,
      },
      proposal: null,
      currentJobId: "synthetic-focus-job",
      failure: null,
      confirmedSummaryRevision: null,
      confirmedWorkspaceRevision: null,
    };
    await page.addInitScript(
      ({ id, pending }) => {
        if (localStorage.getItem("synthetic-focus-pending")) return;
        const cases = JSON.parse(localStorage.getItem("baro-api-mock-v1:cases") ?? "{}");
        cases[id].revision = 13;
        localStorage.setItem("baro-api-mock-v1:cases", JSON.stringify(cases));
        localStorage.setItem(
          "baro-api-mock-v1:summaryReconciliations",
          JSON.stringify({ [id]: pending }),
        );
        localStorage.setItem("synthetic-focus-pending", "true");
      },
      { id: item.id, pending },
    );
    await page.goto(`/cases/${item.id}/summary`);
    const cancel = page.getByRole("button", { name: "요청 취소", exact: true });
    const navigation = page.getByRole("link", { name: "작업 공간으로 돌아가기", exact: true });
    await expect(cancel).toBeVisible();
    await (focusInside ? cancel : navigation).focus();
    await page.evaluate(async () => {
      const path = "/src/client/api/cases.ts";
      const { casesApi } = await import(path);
      const get = casesApi.get.bind(casesApi);
      let first = true;
      casesApi.get = async (id: string) => {
        const snapshot = await get(id);
        if (!first) return snapshot;
        first = false;
        return new Promise((resolve) => {
          (window as unknown as { releaseFocusPoll?: () => void }).releaseFocusPoll = () =>
            resolve(snapshot);
        });
      };
    });
    const proposed = {
      ...pending,
      workspaceRevision: 14,
      status: "proposed",
      currentJobId: null,
      proposal: {
        id: "synthetic-focus-proposal",
        requestId: pending.request.id,
        baseWorkspaceRevision: 12,
        baseIntakeRevision: 7,
        baseSummaryRevision: 3,
        before,
        after: reconfirmationCandidate(),
        reasons: ["비동기 표시를 확인하는 합성 변경안입니다."],
        createdAt: before.createdAt,
      },
    };
    await page.evaluate(
      ({ id, proposed }) => {
        const cases = JSON.parse(localStorage.getItem("baro-api-mock-v1:cases") ?? "{}");
        cases[id].revision = 14;
        localStorage.setItem("baro-api-mock-v1:cases", JSON.stringify(cases));
        localStorage.setItem(
          "baro-api-mock-v1:summaryReconciliations",
          JSON.stringify({ [id]: proposed }),
        );
      },
      { id: item.id, proposed },
    );
    await expect
      .poll(() =>
        page.evaluate(
          () => !!(window as unknown as { releaseFocusPoll?: () => void }).releaseFocusPoll,
        ),
      )
      .toBe(true);
    await expect(focusInside ? cancel : navigation).toBeFocused();
    await page.evaluate(() =>
      (window as unknown as { releaseFocusPoll?: () => void }).releaseFocusPoll?.(),
    );
    await expect(page.getByRole("button", { name: "변경안 확정하기", exact: true })).toBeVisible();
    await expect(
      focusInside ? page.getByRole("region", { name: "사건 정리 확인", exact: true }) : navigation,
    ).toBeFocused();
  });
}

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

for (const [fault, errorPanelRetry] of [
  [null, false],
  ["cancel-fail-before", false],
  ["cancel-lost-after", false],
  ["cancel-peer-after", false],
  ["cancel-fail-before", true],
  ["cancel-lost-after", true],
] as const) {
  test(`terminal job: primary explain again retires the private request (${fault ?? "success"}${errorPanelRetry ? "/error-panel-retry" : ""})`, async ({
    page,
  }) => {
    const item = await seed(page, "active");
    const explanation = "종료된 합성 작업의 추가 설명입니다. 금액은 아직 모릅니다.";
    await page.addInitScript(
      ({ item, explanation }) => {
        if (localStorage.getItem("synthetic-reconciliation-terminal-job")) return;
        const values = JSON.parse(localStorage.getItem("baro-api-mock-v1:cases") ?? "{}");
        values[item.id].revision = 13;
        localStorage.setItem("baro-api-mock-v1:cases", JSON.stringify(values));
        localStorage.setItem(
          "baro-api-mock-v1:summaryReconciliations",
          JSON.stringify({
            [item.id]: {
              contractVersion: "conversation-report-v1",
              workspaceRevision: 13,
              status: "pending",
              request: {
                id: "synthetic-terminal-request",
                input: { expectedRevision: 12, summaryRevision: 3, kind: "addition", explanation },
                createdAt: item.updatedAt,
              },
              proposal: null,
              currentJobId: "synthetic-terminal-job",
              failure: null,
              confirmedSummaryRevision: null,
              confirmedWorkspaceRevision: null,
            },
          }),
        );
        localStorage.setItem("synthetic-reconciliation-terminal-job", "true");
      },
      { item, explanation },
    );
    await page.goto(`/cases/${item.id}/summary`);
    const retry = page.getByRole("button", { name: "다시 설명하기", exact: true });
    const input = page.getByRole("textbox", { name: "빠진 내용을 알려주세요", exact: true });
    await expect(retry).toBeVisible();
    if (fault)
      await page.evaluate(
        (fault) => localStorage.setItem("synthetic-reconciliation-fault", fault),
        fault,
      );
    await retry.click();
    if (fault === "cancel-peer-after") {
      await expect(
        page.getByRole("button", { name: "최신 내용 불러오기", exact: true }),
      ).toBeVisible();
      await expect(input).toHaveCount(0);
      const state = await page.evaluate(
        (id) =>
          JSON.parse(localStorage.getItem("baro-api-mock-v1:summaryReconciliations") ?? "{}")[id],
        item.id,
      );
      expect(state.request.id).not.toBe("synthetic-terminal-request");
      expect((await canonical(page, item.id)).summaryDetails).toEqual(item.summaryDetails);
      return;
    }
    if (fault) {
      await expect(page.getByRole("button", { name: "다시 시도", exact: true })).toBeVisible();
      await expect(input).toHaveCount(0);
      // Either retry control preserves the intent. Ambiguous cancellation reuses
      // the shared client's persisted key instead of a second retirement.
      await (errorPanelRetry
        ? page.getByRole("button", { name: "다시 시도", exact: true })
        : retry
      ).click();
    }
    await expect(input).toHaveValue(explanation);
    expect(
      await page
        .getByRole("dialog", { name: "어떤 내용이 빠졌나요?", exact: true })
        .evaluate((dialog) => dialog.contains(document.activeElement)),
    ).toBe(true);
    const retired = await canonical(page, item.id);
    expect(retired.revision).toBe(14);
    expect(retired.summaryDetails).toEqual(item.summaryDetails);
    const counts = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("baro-api-mock-v1:syntheticReconciliationCounts") ?? "{}"),
    );
    expect(counts.cancel).toBe(fault ? 2 : 1);
    expect(counts.request).toBeUndefined();
    await input.fill(`${explanation} 새로운 합성 보완 진술입니다.`);
    await page.getByRole("button", { name: "변경안 요청하기", exact: true }).click();
    await expect(page.getByRole("button", { name: "변경안 확정하기", exact: true })).toBeVisible();
    const proposed = await canonical(page, item.id);
    expect(proposed.revision).toBe(15);
    expect(proposed.summaryDetails).toEqual(item.summaryDetails);
  });
}

for (const stage of ["summary", "active"] as const) {
  test(`${stage}: identical summary key order permits proposal readback, cancellation and confirmation`, async ({
    page,
  }) => {
    const item = await seed(page, stage);
    await page.goto(`/cases/${item.id}/summary`);
    await expect(
      page.getByRole("button", { name: "빠진 내용이 있어요", exact: true }),
    ).toBeEnabled();
    const reordered = await page.evaluate((id) => {
      const reorder = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(reorder);
        if (value && typeof value === "object")
          return Object.fromEntries(
            Object.entries(value)
              .reverse()
              .map(([key, value]) => [key, reorder(value)]),
          );
        return value;
      };
      const cases = JSON.parse(localStorage.getItem("baro-api-mock-v1:cases") ?? "{}");
      cases[id].summaryDetails = reorder(cases[id].summaryDetails);
      localStorage.setItem("baro-api-mock-v1:cases", JSON.stringify(cases));
      return cases[id].summaryDetails;
    }, item.id);
    expect(reordered).toEqual(item.summaryDetails);
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(item.summaryDetails));
    await propose(page);
    expect((await canonical(page, item.id)).summaryDetails).toEqual(item.summaryDetails);
    await page.reload();
    await expect(page.getByRole("button", { name: "변경안 확정하기", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "변경안 취소", exact: true }).click();
    await expect(page.getByRole("button", { name: "맞아요", exact: true })).toBeVisible();
    expect((await canonical(page, item.id)).summaryDetails).toEqual(item.summaryDetails);
    await propose(page);
    await page.getByRole("button", { name: "변경안 확정하기", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/cases/${item.id}$`));
    const confirmed = (await canonical(page, item.id)).summaryDetails;
    expect(confirmed.revision).toBe((item.summaryDetails?.revision ?? 0) + 1);
    expect(confirmed.facts.slice(0, item.summaryDetails?.facts.length)).toEqual(
      item.summaryDetails?.facts,
    );
    expect(confirmed.unknowns).toEqual(item.summaryDetails?.unknowns);
  });
}

for (const difference of ["fact-text", "reference", "summary-revision", "fact-order"]) {
  test(`a proposal with a different ${difference} is still rejected`, async ({ page }) => {
    const item = await seed(page);
    await page.goto(`/cases/${item.id}/summary`);
    await propose(page);
    const changed = await page.evaluate(
      ({ id, difference }) => {
        const cases = JSON.parse(localStorage.getItem("baro-api-mock-v1:cases") ?? "{}");
        const summary = cases[id].summaryDetails;
        if (difference === "fact-text") summary.facts[0].text = "원래 사실과 다른 합성 진술입니다.";
        if (difference === "reference")
          summary.facts[0].references[0].questionId = "different-source";
        if (difference === "summary-revision") summary.revision++;
        if (difference === "fact-order") summary.facts.reverse();
        localStorage.setItem("baro-api-mock-v1:cases", JSON.stringify(cases));
        return summary;
      },
      { id: item.id, difference },
    );
    await page.reload();
    await expect(
      page.getByRole("button", { name: "최신 내용 불러오기", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("변경안의 기준과 현재 정리가 달라요.");
    await expect(page.getByRole("button", { name: "변경안 확정하기", exact: true })).toHaveCount(0);
    expect((await canonical(page, item.id)).summaryDetails).toEqual(changed);
  });
}

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
