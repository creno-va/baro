import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { summary } from "../fixtures/contracts/v2";
import syntheticSearch from "../fixtures/legal/research/synthetic-search.json" with {
  type: "json",
};

const id = "synthetic-precedent-research";
async function seed(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(
    ({ id, summary }) => {
      if (localStorage.getItem("synthetic-research-seeded")) return;
      localStorage.setItem("synthetic-research-seeded", "true");
      const values = {
        session: {
          user: { id: "research-owner", name: "합성 검증 사용자", accountType: "customer" },
          needsConsent: false,
        },
        cases: {
          [id]: {
            id,
            title: "보증금 반환에 관한 합성 사건",
            subjectContext: "individual",
            stage: "active",
            revision: 1,
            updatedAt: new Date().toISOString(),
            summary: "합성 사건 요약",
            schemaVersion: "2",
            summaryDetails: { ...summary, overview: "보증금 반환에 관한 합성 사건" },
          },
        },
        caseOwners: { [id]: "research-owner" },
        workspace: { [id]: { messages: [], actions: [], timeline: [] } },
        files: { [id]: [] },
      };
      for (const [key, value] of Object.entries(values))
        localStorage.setItem(`baro-api-mock-v1:${key}`, JSON.stringify(value));
    },
    { id, summary },
  );
  await page.goto(`/cases/${id}/precedents`);
  await expect(page.getByRole("button", { name: "판례 찾기", exact: true })).toBeEnabled();
}

test("desktop and mobile complete topic, result and original flow without overflow or nested scrollbars", async ({
  page,
}) => {
  await seed(page);
  await expect(page.getByRole("link", { name: "판례", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("checkbox", { name: /임대차.*추천/ })).toBeChecked();
  await page.getByRole("button", { name: "판례 찾기", exact: true }).click();
  const list = page.getByRole("list", { name: "관련 판례 목록" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await list
    .getByRole("button", { name: /판례 내용 보기/ })
    .first()
    .click();
  const original = page.getByRole("link", { name: /국가법령정보센터에서 전체 원문 보기/ });
  await expect(original).toHaveAttribute(
    "href",
    "https://www.law.go.kr/LSW/precInfoP.do?precSeq=90000000201",
  );
  await expect(original).toHaveAttribute("target", "_blank");
  const selected = page.getByRole("region", { name: "선택한 판례" });
  await expect(selected.getByText(/브라우저 검증용 합성 판례입니다/)).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(original).toBeVisible();
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".precedent-topic").first()).toHaveCSS("margin-top", "0px");
    await expect(page.locator(".precedent-topic").first()).toHaveCSS(
      "display",
      width < 768 ? "grid" : "flex",
    );
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            [...document.querySelectorAll(".precedent-workspace *")].filter((node) => {
              const style = getComputedStyle(node);
              return (
                /auto|scroll/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1
              );
            }).length,
        ),
      )
      .toBe(0);
    if ([1440, 390, 320].includes(width))
      await page.screenshot({ path: `.wrangler/precedent-${width}.png`, fullPage: true });
  }
  await list
    .getByRole("button", { name: /판례 내용 보기/ })
    .first()
    .click();
  await expect(selected.getByRole("heading")).toBeFocused();
  await expect
    .poll(async () => (await selected.getByRole("heading").boundingBox())?.y ?? -1)
    .toBeGreaterThanOrEqual(80);
  const scan = await new AxeBuilder({ page }).include(".precedent-workspace").analyze();
  expect(scan.violations).toEqual([]);
});

test("empty, partial, unavailable and failed requests show actionable states", async ({ page }) => {
  await seed(page);
  for (const status of ["empty", "partial", "unavailable", "error"] as const) {
    await page.evaluate(
      async ({ status, fixture }) => {
        const { registerMockHandlers, ApiError } = await import(
          `${location.origin}/src/client/api/core.ts`
        );
        registerMockHandlers({
          "precedents.search": ({
            body,
          }: {
            body: { expectedRevision: number; summaryRevision: number; topics: string[] };
          }) => {
            if (status === "error") throw new ApiError("UNAVAILABLE", "합성 연결 실패");
            return {
              ...fixture,
              workspaceRevision: body.expectedRevision,
              summaryRevision: body.summaryRevision,
              topics: body.topics,
              checkedAt: new Date().toISOString(),
              status,
              items:
                status === "partial"
                  ? [{ ...fixture.items[0], matchedTopics: [body.topics[0]] }]
                  : [],
              unavailableTopics: status === "empty" ? [] : [body.topics[1]],
            };
          },
        });
      },
      { status, fixture: syntheticSearch },
    );
    await page.getByRole("button", { name: "판례 찾기", exact: true }).click();
    if (status === "empty")
      await expect(
        page.getByText("선택한 주제로 확인된 판례가 없어요. 다른 주제로 다시 찾아보세요."),
      ).toBeVisible();
    if (status === "partial")
      await expect(page.getByText(/주제를 일부 확인하지 못했어요/)).toBeVisible();
    if (status === "unavailable")
      await expect(
        page.getByText("공식 판례를 지금 확인할 수 없어요. 잠시 후 다시 검색해 주세요."),
      ).toBeVisible();
    if (status === "error") await expect(page.getByRole("alert")).toContainText("합성 연결 실패");
  }
});

test("peer sign-out removes case and rejects delayed search while focus preserves selection", async ({
  page,
}) => {
  await seed(page);
  await page.evaluate(async () => {
    const { registerMockHandlers } = await import(`${location.origin}/src/client/api/core.ts`);
    registerMockHandlers({
      "precedents.search": () =>
        new Promise((resolve) => {
          (window as unknown as { finishResearch: (value: unknown) => void }).finishResearch =
            resolve;
        }),
    });
  });
  await page.getByRole("button", { name: "판례 찾기", exact: true }).click();
  await expect(page.getByRole("button", { name: "검색 취소" })).toBeVisible();
  await page.evaluate(
    ({ fixture }) => {
      localStorage.setItem(
        "baro-api-mock-v1:session",
        JSON.stringify({ user: null, needsConsent: false }),
      );
      window.dispatchEvent(
        new CustomEvent("baro-session-changed", { detail: { reason: "sign-out" } }),
      );
      (window as unknown as { finishResearch: (value: unknown) => void }).finishResearch(fixture);
    },
    { fixture: syntheticSearch },
  );
  await expect(
    page.getByRole("heading", { name: "보증금 반환에 관한 합성 사건", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("list", { name: "관련 판례 목록" })).toHaveCount(0);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("link", { name: "로그인 확인", exact: true })).toHaveAttribute(
    "href",
    `/login?returnTo=%2Fcases%2F${id}%2Fprecedents`,
  );
});

test("changed case revision clears old results on focus and exposes fresh search", async ({
  page,
}) => {
  await seed(page);
  await page.getByRole("button", { name: "판례 찾기", exact: true }).click();
  await expect(page.getByRole("list", { name: "관련 판례 목록" })).toBeVisible();
  await page.evaluate((id) => {
    const cases = JSON.parse(localStorage.getItem("baro-api-mock-v1:cases") ?? "{}");
    cases[id].revision++;
    localStorage.setItem("baro-api-mock-v1:cases", JSON.stringify(cases));
    window.dispatchEvent(new Event("focus"));
  }, id);
  await expect(page.getByRole("list", { name: "관련 판례 목록" })).toHaveCount(0);
  await page.getByRole("button", { name: "판례 찾기", exact: true }).click();
  await expect(page.getByRole("list", { name: "관련 판례 목록" })).toBeVisible();
});
