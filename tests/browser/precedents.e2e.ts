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
  const response = await page.goto(`/cases/${id}/precedents`);
  // A cold Vite optimization can replace React during the first SSR request.
  // Retry only that HTTP 5xx once; persistent failures and UI assertions still fail.
  if (response && response.status() >= 500) await page.reload();
  await expect(page.getByRole("button", { name: "판례 찾기", exact: true })).toBeEnabled();
}

test("desktop and mobile complete topic, result and original flow without overflow or nested scrollbars", async ({
  page,
}) => {
  await seed(page);
  await expect(page.getByRole("link", { name: "유사 판례", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("checkbox", { name: /임대차.*추천/ })).toBeChecked();
  await page.getByRole("button", { name: "판례 찾기", exact: true }).click();
  const list = page.getByRole("list", { name: "관련 판례 목록" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(page.getByText("내 사건과 얼마나 비슷한가요?", { exact: true })).toHaveCount(0);
  await expect(page.getByText("공식 원문 확인", { exact: true })).toHaveCount(0);
  await expect(page.locator(".precedent-card .precedent-snippet")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "선택한 판례" })).toHaveCount(0);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({ path: `.wrangler/precedent-results-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await list.getByRole("button").first().click();
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
  await expect(list).toBeHidden();
  await page.getByRole("button", { name: "검색 결과로", exact: true }).click();
  await expect(list).toBeVisible();
  await expect(page.getByRole("region", { name: "유사 판례 비교" })).toHaveCount(0);
  await list.getByRole("button").first().click();
  await expect(selected.locator(".precedent-document-heading h3")).toBeFocused();
  await expect
    .poll(
      async () => (await selected.locator(".precedent-document-heading h3").boundingBox())?.y ?? -1,
    )
    .toBeGreaterThanOrEqual(80);
  const scan = await new AxeBuilder({ page }).include(".precedent-workspace").analyze();
  expect(scan.violations).toEqual([]);
});

test("five-card pages append on demand, cards clamp titles and the full judgment has section headings", async ({
  page,
}) => {
  await seed(page);
  await page.evaluate(
    async ({ fixture }) => {
      const { registerMockHandlers } = await import(`${location.origin}/src/client/api/core.ts`);
      const base = fixture.items[0];
      if (!base) throw new Error("Missing synthetic original");
      const fullText = `【판시사항】\n[1] 계약 해석과 대여금 반환의 합성 쟁점\n【판결요지】\n${"대여금 지급과 반환 약속에 관한 합성 판례 문장입니다.\n".repeat(180)}【주 문】\n판결문 맨 끝의 합성 주문`;
      const excerptText = fullText.slice(0, 4000).trimEnd();
      const items = Array.from({ length: 10 }, (_, index) => ({
        ...base,
        id: `paged-citation-${index}`,
        citation: {
          ...base.citation,
          id: `paged-citation-${index}`,
          sourceId: `paged-source-${index}`,
          title: `합성 대여금 반환 판례 ${index + 1} · ${"긴 판례 제목의 두 줄 말줄임 검증 ".repeat(10)}`,
          caseNumber: `2026다${700 + index}`,
          officialId: String(90000000700 + index),
          url: `https://www.law.go.kr/LSW/precInfoP.do?precSeq=${90000000700 + index}`,
        },
        readToken: `synthetic_read_receipt.paged_${index}`,
        excerpt: {
          text: excerptText,
          startUtf16: 0,
          endUtf16: excerptText.length,
          fullLengthUtf16: fullText.length,
          truncated: true,
        },
      }));
      registerMockHandlers({
        "precedents.search": ({
          body,
        }: {
          body: {
            expectedRevision: number;
            summaryRevision: number;
            topics: string[];
            cursor?: string;
          };
        }) => ({
          ...fixture,
          workspaceRevision: body.expectedRevision,
          summaryRevision: body.summaryRevision,
          checkedAt: new Date().toISOString(),
          topics: body.topics,
          items: items
            .slice(body.cursor ? 5 : 0, body.cursor ? 10 : 5)
            .map((item) => ({ ...item, matchedTopics: [body.topics[0]] })),
          nextCursor: body.cursor ? null : "synthetic_page_cursor.next_page",
          status: "complete",
          unavailableTopics: [],
        }),
        "precedents.read": ({
          body,
        }: {
          body: { expectedRevision: number; readToken: string };
        }) => {
          const item = items.find((item) => item.readToken === body.readToken);
          if (!item) throw new Error("Missing original");
          return {
            schemaVersion: "2",
            workspaceRevision: body.expectedRevision,
            citation: item.citation,
            excerpt: item.excerpt,
            fullText,
          };
        },
      });
    },
    { fixture: syntheticSearch },
  );
  await page.getByRole("button", { name: "판례 찾기", exact: true }).click();
  const list = page.getByRole("list", { name: "관련 판례 목록" });
  await expect(list.getByRole("listitem")).toHaveCount(5);
  await expect(
    page.locator(
      ".precedent-result-heading > p,.precedent-result-heading > div,.precedent-result-note",
    ),
  ).toHaveCount(0);
  await expect(list.getByRole("button", { name: /판례 내용 보기/ })).toHaveCount(0);
  await expect(list.locator("h4").first()).toHaveCSS("-webkit-line-clamp", "2");
  expect((await list.getByRole("button").first().boundingBox())?.height).toBeLessThan(240);
  await page.getByRole("button", { name: "더보기", exact: true }).click();
  await expect(list.getByRole("listitem")).toHaveCount(10);
  await expect(page.getByRole("button", { name: "더보기", exact: true })).toHaveCount(0);
  await expect(list.getByText(/관련 주제/)).toHaveCount(0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `.wrangler/precedent-feedback-list-${width}.png`,
      fullPage: true,
    });
  }
  await list.getByRole("button").first().click();
  const detail = page.getByRole("region", { name: "선택한 판례" });
  await expect(detail.getByRole("heading", { name: "【판시사항】" })).toBeVisible();
  await expect(detail.getByRole("heading", { name: "【판결요지】" })).toBeVisible();
  await expect(detail.locator(".precedent-full-text")).toContainText("판결문 맨 끝의 합성 주문");
  await expect(detail.getByText("원문 일부", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: ".wrangler/precedent-feedback-full-text.png" });
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
        page.getByText("선택한 주제와 가까운 판례를 찾지 못했어요. 다른 주제로 다시 찾아보세요."),
      ).toBeVisible();
    if (status === "partial")
      await expect(page.getByText(/주제를 일부 확인하지 못했어요/)).toHaveCount(0);
    if (status === "unavailable")
      await expect(
        page.getByText("판례를 확인하지 못했어요. 잠시 후 다시 검색해 주세요."),
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

test("changed case revision invalidates old result actions and exposes fresh search", async ({
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
  await expect(
    page.getByRole("list", { name: "관련 판례 목록" }).getByRole("button").first(),
  ).toBeDisabled();
  await expect(
    page.getByText("사건 내용이 바뀌었어요. 최신 내용으로 다시 검색해 주세요."),
  ).toBeVisible();
  await page.getByRole("button", { name: "판례 찾기", exact: true }).click();
  await expect(page.getByRole("list", { name: "관련 판례 목록" })).toBeVisible();
});

// Explicit browser-only synthetic transport. No provider, law or customer data is sent.
async function comparisonTransport(page: Page) {
  await page.evaluate(async (id) => {
    const {
      registerHttpMockHandler,
      request: read,
      ApiError,
    } = await import(`${location.origin}/src/client/api/core.ts`);
    const { PRECEDENT_COMPARISON_CRITERIA, v2PrecedentComparisonRequestSchema } = await import(
      `${location.origin}/src/contracts/v2/precedent-comparison.ts`
    );
    const storage = "synthetic-comparison";
    const job = (status = "running") => ({
      schemaVersion: "2",
      id: "synthetic-comparison-job",
      operationId: "synthetic-comparison-operation",
      target: { kind: "workspace", caseId: id, workspaceRevision: 2 },
      kind: "chat_response",
      status,
      phase: status === "completed" ? "finished" : "validating",
      progressPercent: status === "completed" ? 100 : 80,
      attempts: 1,
      failure: status === "failed" ? "MODEL_UNAVAILABLE" : null,
      retryable: false,
      updatedAt: new Date().toISOString(),
    });
    registerHttpMockHandler(async (request: Request) => {
      const path = new URL(request.url).pathname;
      const base = `/api/v2/cases/${id}`;
      if (path === `${base}/workspace-jobs/latest`)
        return Response.json(sessionStorage.getItem(storage) ? job() : null);
      if (path === `${base}/precedents/compare`) {
        const body = v2PrecedentComparisonRequestSchema.parse(await request.json());
        const source = await read("precedents.read", {
          id,
          body: { expectedRevision: body.expectedRevision, readToken: body.readToken },
        });
        const keys = JSON.parse(sessionStorage.getItem(`${storage}-keys`) ?? "[]");
        keys.push(request.headers.get("idempotency-key"));
        sessionStorage.setItem(`${storage}-keys`, JSON.stringify(keys));
        const value = {
          schemaVersion: "2",
          criteriaVersion: "1",
          basedOnWorkspaceRevision: body.expectedRevision,
          publishedWorkspaceRevision: body.expectedRevision + 2,
          summaryRevision: body.summaryRevision,
          checkedAt: new Date().toISOString(),
          source: { citation: source.citation, excerpt: source.excerpt },
          metrics: Object.keys(PRECEDENT_COMPARISON_CRITERIA).map((criterion, index) => ({
            criterion,
            verdict: index < 2 ? "yes" : "unknown",
            explanation:
              index < 2
                ? "양쪽 자료에서 같은 관계와 거래를 확인했어요. 합성 표시 검증입니다."
                : "자료가 부족해 확인할 수 없어요.",
            caseEvidence:
              index < 2 ? [{ factId: "synthetic-fact", text: "합성 사건의 임대차 계약" }] : [],
            precedentEvidence:
              index < 2
                ? [
                    {
                      text: source.excerpt.text,
                      startUtf16: 0,
                      endUtf16: source.excerpt.text.length,
                    },
                  ]
                : [],
          })),
          matchedCount: 2,
          knownCount: 2,
          percentage: 25,
          factsPartial: true,
        };
        sessionStorage.setItem(storage, JSON.stringify(value));
        if (sessionStorage.getItem(`${storage}-lost-ack`) === "true") {
          sessionStorage.removeItem(`${storage}-lost-ack`);
          throw new ApiError("UNAVAILABLE", "합성 응답 수신 실패");
        }
        if (sessionStorage.getItem(`${storage}-delay`) === "true")
          await new Promise<void>((resolve) => {
            (window as unknown as { finishComparisonStart: () => void }).finishComparisonStart =
              resolve;
          });
        return Response.json({
          operationId: job().operationId,
          jobId: job().id,
          status: "queued",
          retryAfter: 1,
        });
      }
      if (path === `${base}/precedents/comparisons/${job().id}`) {
        if (sessionStorage.getItem(`${storage}-read-failure`) === "true")
          throw new ApiError("UNAVAILABLE", "합성 상태 조회 실패");
        const done = sessionStorage.getItem(`${storage}-done`) === "true";
        const failed = sessionStorage.getItem(`${storage}-failed`) === "true";
        return Response.json({
          schemaVersion: "2",
          job: job(failed ? "failed" : done ? "completed" : "running"),
          comparison: done ? JSON.parse(sessionStorage.getItem(storage) ?? "null") : null,
          stale: sessionStorage.getItem(`${storage}-stale`) === "true",
        });
      }
      return null;
    });
  }, id);
}

async function selectComparison(page: Page) {
  await seed(page);
  await comparisonTransport(page);
  await page.getByRole("button", { name: "판례 찾기", exact: true }).click();
  await page.getByRole("list", { name: "관련 판례 목록" }).getByRole("button").first().click();
  await expect(page.getByRole("button", { name: "내 사건과 유사도 비교" })).toBeEnabled();
}

test("unattempted comparisons ignore failed latest jobs and legacy case-wide hints without opening a detail", async ({
  page,
}) => {
  await seed(page);
  await comparisonTransport(page);
  await page.evaluate((caseId) => {
    sessionStorage.setItem("synthetic-comparison", "{}");
    sessionStorage.setItem("synthetic-comparison-failed", "true");
    sessionStorage.setItem(`baro-precedent-comparison:${caseId}`, "synthetic-comparison-job");
    window.dispatchEvent(new Event("focus"));
  }, id);
  await expect(page.getByRole("region", { name: "선택한 판례" })).toHaveCount(0);
  await page.getByRole("button", { name: "판례 찾기", exact: true }).click();
  await page.getByRole("list", { name: "관련 판례 목록" }).getByRole("button").first().click();
  await expect(page.getByRole("button", { name: "내 사건과 유사도 비교" })).toBeEnabled();
  await expect(page.locator(".precedent-state-card")).toHaveCount(0);
  await page.getByRole("button", { name: "검색 결과로", exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("region", { name: "선택한 판례" })).toHaveCount(0);
});

test("a completed comparison survives its own revision and does not leak onto another selected original", async ({
  page,
}) => {
  await selectComparison(page);
  await page.getByRole("button", { name: "내 사건과 유사도 비교" }).click();
  await page.evaluate(() => {
    sessionStorage.setItem("synthetic-comparison-done", "true");
    window.dispatchEvent(new Event("focus"));
  });
  await expect(page.getByRole("heading", { name: "사실관계 유사도" })).toBeVisible();
  await page.getByRole("button", { name: "검색 결과로", exact: true }).click();
  await page.getByRole("list", { name: "관련 판례 목록" }).getByRole("button").nth(1).click();
  await expect(page.getByRole("button", { name: "내 사건과 유사도 비교" })).toBeEnabled();
  await expect(page.locator(".precedent-state-card,.comparison-result")).toHaveCount(0);
  await page.getByRole("button", { name: "검색 결과로", exact: true }).click();
  await page.getByRole("list", { name: "관련 판례 목록" }).getByRole("button").first().click();
  await expect(page.getByRole("heading", { name: "사실관계 유사도" })).toBeVisible();
  await page.evaluate((caseId) => {
    const cases = JSON.parse(localStorage.getItem("baro-api-mock-v1:cases") ?? "{}");
    cases[caseId].revision = 3;
    localStorage.setItem("baro-api-mock-v1:cases", JSON.stringify(cases));
    window.dispatchEvent(new Event("focus"));
  }, id);
  await expect(page.getByRole("heading", { name: "사실관계 유사도" })).toBeVisible();
  await expect(page.locator(".precedent-state-card")).toHaveCount(0);
  await page.evaluate(() => {
    sessionStorage.setItem("synthetic-comparison-read-failure", "true");
    window.dispatchEvent(new Event("focus"));
  });
  await expect(page.getByRole("heading", { name: "사실관계 유사도" })).toBeVisible();
  await expect(page.locator(".precedent-state-card")).toHaveCount(0);
});

test("failed comparison uses one recovery card and keeps the original readable", async ({
  page,
}) => {
  await selectComparison(page);
  await page.evaluate(() => sessionStorage.setItem("synthetic-comparison-failed", "true"));
  await page.getByRole("button", { name: "내 사건과 유사도 비교" }).click();
  const region = page.getByRole("region", { name: "유사 판례 비교" });
  const card = region.locator(".precedent-state-card");
  await expect(card).toHaveCount(1);
  await expect(card.getByRole("heading", { name: "비교를 완료하지 못했어요" })).toBeVisible();
  await expect(card.getByRole("button", { name: "다시 비교", exact: true })).toBeEnabled();
  await expect(region.locator(".precedent-body")).toHaveCount(1);
  await expect(region.locator(":scope > p[role=status]")).toHaveCount(0);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.mouse.move(0, 0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `.wrangler/precedent-failed-${width}.png`, fullPage: true });
  }
  expect(
    await page.evaluate(
      () => JSON.parse(sessionStorage.getItem("synthetic-comparison-keys") ?? "[]").length,
    ),
  ).toBe(1);
  await page.evaluate((id) => {
    const cases = JSON.parse(localStorage.getItem("baro-api-mock-v1:cases") ?? "{}");
    cases[id].revision++;
    localStorage.setItem("baro-api-mock-v1:cases", JSON.stringify(cases));
    window.dispatchEvent(new Event("focus"));
  }, id);
  await expect(card.getByRole("heading", { name: "판례를 다시 확인해 주세요" })).toBeVisible();
  await expect(region.locator(".precedent-state-card")).toHaveCount(1);
  await expect(region.getByText("비교를 완료하지 못했어요", { exact: true })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "판례 다시 검색", exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({ path: ".wrangler/precedent-refresh-failed-390.png", fullPage: true });
});

test("comparison survives foreground during admission, renders fixed indicators and reloads without another POST", async ({
  page,
}) => {
  await selectComparison(page);
  await page.evaluate(() => sessionStorage.setItem("synthetic-comparison-delay", "true"));
  await page.getByRole("button", { name: "내 사건과 유사도 비교" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof (window as unknown as { finishComparisonStart?: () => void })
            .finishComparisonStart,
      ),
    )
    .toBe("function");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.evaluate(() =>
    (window as unknown as { finishComparisonStart: () => void }).finishComparisonStart(),
  );
  const region = page.getByRole("region", { name: "유사 판례 비교" });
  await expect(region.getByRole("status")).toBeVisible();
  await expect(region.getByRole("button", { name: "내 사건과 유사도 비교" })).toBeDisabled();
  await page.evaluate(() => {
    sessionStorage.setItem("synthetic-comparison-done", "true");
    window.dispatchEvent(new Event("focus"));
  });
  await expect(region.getByRole("heading", { name: "사실관계 유사도" })).toBeVisible();
  await expect(region.locator("progress")).toHaveAttribute("value", "25");
  await expect(region.locator(".precedent-body")).toHaveCount(1);
  await expect(region.getByRole("button", { name: /유사 · \+12.5점/ })).toHaveCount(2);
  await expect(region.getByRole("button", { name: /확인 불가 · \+0점/ })).toHaveCount(6);
  await region.locator(".comparison-highlight").first().click();
  const reason = page.getByRole("dialog", { name: "비교 근거와 이유" });
  await expect(reason.getByRole("heading", { name: "내 사건", exact: true }).first()).toBeVisible();
  await expect(reason.getByRole("heading", { name: "판례", exact: true }).first()).toBeVisible();
  await expect(reason.locator(".comparison-reason")).toHaveCount(2);
  expect((await reason.boundingBox())?.width).toBeGreaterThan(700);
  await page.screenshot({ path: ".wrangler/comparison-reason-desktop.png" });
  await page.setViewportSize({ width: 390, height: 900 });
  expect((await reason.boundingBox())?.width).toBeLessThanOrEqual(358);
  await page.screenshot({ path: ".wrangler/comparison-reason-mobile.png" });
  await page.keyboard.press("Escape");
  await expect(reason).not.toBeVisible();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() =>
        page.evaluate(() => ({
          viewport: innerWidth,
          width: document.documentElement.scrollWidth,
        })),
      )
      .toEqual({ viewport: width, width });
    await region.scrollIntoViewIfNeeded();
    await page.mouse.click(5, 85);
    await page.mouse.move(0, 0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `.wrangler/comparison-${width}.png`, fullPage: true });
  }
  const scan = await new AxeBuilder({ page }).include(".precedent-workspace").analyze();
  expect(scan.violations).toEqual([]);
  await page.reload();
  await comparisonTransport(page);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(region).toHaveCount(0);
  await page.getByRole("button", { name: "판례 찾기", exact: true }).click();
  await page.getByRole("list", { name: "관련 판례 목록" }).getByRole("button").first().click();
  await expect(region.getByRole("heading", { name: "사실관계 유사도" })).toBeVisible();
  expect(
    await page.evaluate(
      () => JSON.parse(sessionStorage.getItem("synthetic-comparison-keys") ?? "[]").length,
    ),
  ).toBe(1);
  await page.evaluate(() => {
    sessionStorage.setItem("synthetic-comparison-stale", "true");
    window.dispatchEvent(new Event("focus"));
  });
  await expect(region.getByRole("status")).toContainText("비교 이후");
  await expect(region.locator(".precedent-state-card")).toHaveCount(1);
});

test("comparison recovers a lost receipt without another POST and preserves work on read failure", async ({
  page,
}) => {
  await selectComparison(page);
  await page.evaluate(() => sessionStorage.setItem("synthetic-comparison-lost-ack", "true"));
  const start = page.getByRole("button", { name: "내 사건과 유사도 비교" });
  await start.click();
  const region = page.getByRole("region", { name: "유사 판례 비교" });
  await expect(region.getByRole("alert")).toContainText("합성 응답 수신 실패");
  await expect(start).toBeEnabled();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(region.getByRole("status")).toBeVisible();
  const keys = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("synthetic-comparison-keys") ?? "[]"),
  );
  expect(keys).toHaveLength(1);
  expect(keys[0]).toBeTruthy();
  await page.evaluate(() => {
    sessionStorage.setItem("synthetic-comparison-read-failure", "true");
    window.dispatchEvent(new Event("focus"));
  });
  await expect(region.getByRole("alert")).toContainText("합성 상태 조회 실패");
  await expect(page.getByRole("button", { name: "내 사건과 유사도 비교" })).toBeDisabled();
  await page.evaluate(() => {
    sessionStorage.removeItem("synthetic-comparison-read-failure");
    sessionStorage.setItem("synthetic-comparison-done", "true");
    window.dispatchEvent(new Event("focus"));
  });
  await expect(region.getByRole("heading", { name: "사실관계 유사도" })).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem(
      "baro-api-mock-v1:session",
      JSON.stringify({ user: null, needsConsent: false }),
    );
    window.dispatchEvent(
      new CustomEvent("baro-session-changed", { detail: { reason: "sign-out" } }),
    );
  });
  await expect(region).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "사실관계 유사도" })).toHaveCount(0);
});

test("a delayed admission receipt cannot erase an already recovered completed comparison", async ({
  page,
}) => {
  await selectComparison(page);
  await page.evaluate(() => sessionStorage.setItem("synthetic-comparison-delay", "true"));
  await page.getByRole("button", { name: "내 사건과 유사도 비교" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof (window as unknown as { finishComparisonStart?: () => void })
            .finishComparisonStart,
      ),
    )
    .toBe("function");
  await page.evaluate(() => {
    sessionStorage.setItem("synthetic-comparison-done", "true");
    window.dispatchEvent(new Event("focus"));
  });
  const region = page.getByRole("region", { name: "유사 판례 비교" });
  await expect(region.getByRole("heading", { name: "사실관계 유사도" })).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { finishComparisonStart: () => void }).finishComparisonStart(),
  );
  await expect(page.getByRole("button", { name: "내 사건과 유사도 비교" })).toBeVisible();
  await expect(region.getByRole("heading", { name: "사실관계 유사도" })).toBeVisible();
  await expect(region.locator(".comparison-indicator")).toHaveCount(8);
  expect(
    await page.evaluate(
      () => JSON.parse(sessionStorage.getItem("synthetic-comparison-keys") ?? "[]").length,
    ),
  ).toBe(1);
});

test("an expired comparison proof requires fresh search and never automatically submits another comparison", async ({
  page,
}) => {
  await seed(page);
  await page.evaluate(
    async ({ id, fixture }) => {
      const item = fixture.items[0];
      if (!item) throw new Error("Missing synthetic precedent");
      const { registerHttpMockHandler, registerMockHandlers, ApiError } = await import(
        `${location.origin}/src/client/api/core.ts`
      );
      let searches = 0;
      const counts = window as unknown as { comparisonPosts: number };
      counts.comparisonPosts = 0;
      registerMockHandlers({
        "precedents.search": ({
          body,
        }: {
          body: { expectedRevision: number; summaryRevision: number; topics: string[] };
        }) => {
          searches++;
          return {
            ...fixture,
            workspaceRevision: body.expectedRevision,
            summaryRevision: body.summaryRevision,
            topics: body.topics,
            items: [
              {
                ...item,
                matchedTopics: [body.topics[0]],
                readToken: `synthetic_receipt_${searches}.synthetic_signature`,
              },
            ],
          };
        },
        "precedents.read": ({ body }: { body: { expectedRevision: number } }) => ({
          schemaVersion: "2",
          workspaceRevision: body.expectedRevision,
          citation: item.citation,
          excerpt: item.excerpt,
        }),
      });
      registerHttpMockHandler(async (request: Request) => {
        const path = new URL(request.url).pathname;
        if (path === `/api/v2/cases/${id}/workspace-jobs/latest`) return Response.json(null);
        if (path === `/api/v2/cases/${id}/precedents/compare`) {
          counts.comparisonPosts++;
          throw new ApiError("NOT_FOUND", "합성 조회권 만료");
        }
        return null;
      });
    },
    { id, fixture: syntheticSearch },
  );
  const search = page.getByRole("button", { name: "판례 찾기", exact: true });
  const choose = page.getByRole("list", { name: "관련 판례 목록" }).getByRole("button").first();
  const compare = page.getByRole("button", { name: "내 사건과 유사도 비교", exact: true });
  await search.click();
  await choose.click();
  await expect(compare).toBeEnabled();
  await compare.click();
  await expect(
    page.getByText(
      "판례 확인 시간이 지났거나 원문이 바뀌었어요. 다시 검색한 판례를 선택해 주세요.",
    ),
  ).toBeVisible();
  await expect(compare).toBeDisabled();
  await page.getByRole("button", { name: "판례 다시 검색", exact: true }).click();
  await choose.click();
  await expect(compare).toBeEnabled();
  expect(
    await page.evaluate(() => (window as unknown as { comparisonPosts: number }).comparisonPosts),
  ).toBe(1);
});

test("partial-source diagnostics stay out of verified results and an expired proof triggers a new search", async ({
  page,
}) => {
  await seed(page);
  await page.evaluate(async (fixture) => {
    const { registerMockHandlers, ApiError } = await import(
      `${location.origin}/src/client/api/core.ts`
    );
    const state = window as unknown as { legalSearches: number; legalReads: number };
    state.legalSearches = 0;
    state.legalReads = 0;
    registerMockHandlers({
      "precedents.search": ({
        body,
      }: {
        body: { expectedRevision: number; summaryRevision: number; topics: string[] };
      }) => {
        state.legalSearches++;
        return {
          ...fixture,
          workspaceRevision: body.expectedRevision,
          summaryRevision: body.summaryRevision,
          checkedAt: new Date().toISOString(),
          topics: body.topics,
          status: "partial",
          items: [{ ...fixture.items[0], matchedTopics: [body.topics[0]] }],
          unavailableTopics: [body.topics[0]],
          availabilityIssues: [{ topic: body.topics[0], reason: "timeout" }],
        };
      },
      "precedents.read": () => {
        state.legalReads++;
        throw new ApiError("NOT_FOUND", "합성 조회권 만료");
      },
    });
  }, syntheticSearch);
  await page.getByRole("button", { name: "판례 찾기", exact: true }).click();
  await expect(page.getByRole("list", { name: "공식 자료 확인 상태" })).toHaveCount(0);
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("list", { name: "공식 자료 확인 상태" })).toHaveCount(0);
    // Viewport changes can precede the responsive style/layout commit.
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
  }
  await page.getByRole("list", { name: "관련 판례 목록" }).getByRole("button").first().click();
  await page
    .getByRole("region", { name: "선택한 판례" })
    .getByRole("button", { name: "다시 검색", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { legalSearches: number }).legalSearches))
    .toBe(2);
  expect(await page.evaluate(() => (window as unknown as { legalReads: number }).legalReads)).toBe(
    1,
  );
  await expect(
    page.getByRole("list", { name: "관련 판례 목록" }).getByRole("listitem"),
  ).toHaveCount(1);
});
