import { expect, type Locator, test } from "@playwright/test";
import { summary } from "../fixtures/contracts/v2";

const caseId = "shell-app-case";

function inspectCaseTool(node: HTMLElement | SVGElement, capturedPoint?: { x: number; y: number }) {
  const rect = node.getBoundingClientRect();
  const point = capturedPoint ?? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const menu = node.closest("nav");
  const disclosure = node.closest("details");
  if (!menu || !disclosure) throw new Error("Case tools structure missing");
  const cover = document.elementFromPoint(point.x, point.y);
  return {
    point,
    open: disclosure.open,
    ssr: node.closest("astro-island")?.hasAttribute("ssr") ?? false,
    rect: rect.toJSON(),
    menu: menu.getBoundingClientRect().toJSON(),
    inlineStyle: menu.getAttribute("style"),
    viewport: { width: innerWidth, height: innerHeight },
    hit: node.contains(cover),
    cover: cover ? { tag: cover.tagName, class: cover.getAttribute("class") } : null,
  };
}

async function expectCaseToolLinks(tools: Locator) {
  const routes = [
    ["요약 보기 · 재확인", "summary"],
    ["타임라인", "timeline"],
    ["다음 행동", "actions"],
    ["유사 판례", "precedents"],
  ] as const;
  await expect(tools.getByRole("link")).toHaveText(routes.map(([name]) => name));
  for (const [name, path] of routes) {
    const link = tools.getByRole("link", { name, exact: true });
    await expect(link).toHaveAttribute("href", `/cases/${caseId}/${path}`);
    const point = await link.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    const state = await link.evaluate(inspectCaseTool, point);
    expect(state.open, JSON.stringify(state)).toBe(true);
    expect(state.hit, JSON.stringify(state)).toBe(true);
    expect(state.rect.width).toBeGreaterThanOrEqual(44);
    expect(state.rect.height).toBeGreaterThanOrEqual(44);
    expect(state.menu.left).toBeGreaterThanOrEqual(0);
    expect(state.menu.top).toBeGreaterThanOrEqual(0);
    expect(state.menu.right).toBeLessThanOrEqual(state.viewport.width);
    expect(state.menu.bottom).toBeLessThanOrEqual(state.viewport.height);
    await link.click({ trial: true });
  }
}
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
    for (const route of ["/app", `/cases/${caseId}`, "/settings", "/lawyers"]) {
      const response = await page.goto(route);
      await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      if (route === "/lawyers") {
        expect(response?.status()).toBe(410);
        await expect(page.locator(".public-layout")).toBeVisible();
        await expect(
          page.getByRole("heading", { name: "기능 이용 안내", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText("현재 변호사 연결 기능은 제공하지 않습니다.", { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText("기존 계정의 본인 사건·자료·리포트는 계속 이용할 수 있어요.", {
            exact: false,
          }),
        ).toBeVisible();
        await expect(page.getByRole("link", { name: "내 사건으로", exact: true })).toHaveAttribute(
          "href",
          "/app",
        );
        await expect(
          page.getByRole("main").getByRole("link", { name: "도움말", exact: true }),
        ).toHaveAttribute("href", "/help");
      } else {
        await expect(page.locator(".app-frame[data-app-workspace]")).toBeVisible();
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        route,
      ).toBe(true);
      await page.screenshot({
        path: `.wrangler/ui01/app-${route === "/app" ? "new" : route.includes("cases") ? "chat" : route.slice(1)}-${width}.png`,
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
    const hit = await link.evaluate(
      (node, point) => node.contains(document.elementFromPoint(point.x, point.y)),
      point,
    );
    if (!hit) {
      await test.info().attach("first-case-tool-hit", {
        body: JSON.stringify(await link.evaluate(inspectCaseTool, point)),
        contentType: "application/json",
      });
    }
    expect(hit).toBe(true);
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

test.describe("short viewport at the native 200% layout size", () => {
  test.use({ deviceScaleFactor: 4 });

  test("reopening case tools keeps every link below navigation and preserves writing", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const title = "합성 형사 대응에서 자료와 사실을 구분하며 사건 준비를 이어가는 긴 제목";
    expect(title).toHaveLength(40);
    await page.addInitScript(
      ({ caseId, title }) => {
        const key = "baro-api-mock-v1:cases";
        const cases = JSON.parse(localStorage.getItem(key) ?? "{}");
        cases[caseId].title = title;
        localStorage.setItem(key, JSON.stringify(cases));
      },
      { caseId, title },
    );
    await page.setViewportSize({ width: 600, height: 350 });
    await page.goto(`/cases/${caseId}`);
    await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        zoom: getComputedStyle(document.documentElement).zoom,
        dpr: devicePixelRatio,
      })),
    ).toEqual({ width: 600, height: 350, zoom: "1", dpr: 4 });
    const composer = page.getByPlaceholder("메시지", { exact: true });
    await composer.fill("도구를 다시 열어도 보존할 합성 작성 내용");
    const header = page.getByRole("region", { name: "사건 제목과 작업", exact: true });
    const trigger = header.locator(".case-tools > summary");
    const tools = header.getByRole("navigation", { name: "사건 도구", exact: true });
    const names = ["요약 보기 · 재확인", "타임라인", "다음 행동", "유사 판례"] as const;
    const paths = ["summary", "timeline", "actions", "precedents"] as const;
    const openTools = async () => {
      const bounds = await trigger.boundingBox();
      if (!bounds) throw new Error("Case tools trigger missing");
      // Match a physical pointer: locator.click would first scroll the header to the trigger.
      await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await expect(tools).toBeVisible();
    };
    const expectActionable = async (stage: string) => {
      await expect(tools.getByRole("link")).toHaveText(names);
      for (const [index, name] of names.entries()) {
        const link = tools.getByRole("link", { name, exact: true });
        await expect(link).toHaveAttribute("href", `/cases/${caseId}/${paths[index]}`);
        const scroll = await link.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          const menu = node.closest("nav")?.getBoundingClientRect();
          if (!menu) throw new Error("Case tools menu missing");
          if (rect.top < menu.top + 1) return rect.top - menu.top - 1;
          return Math.max(0, rect.bottom - menu.bottom + 1);
        });
        if (index === 0 && (stage === "first-open" || stage === "reopen")) expect(scroll).toBe(0);
        if (scroll) {
          await tools.hover();
          await page.mouse.wheel(0, scroll);
        }
        await test.info().attach(`${stage}-${name}`, {
          body: JSON.stringify(
            await link.evaluate((node) => {
              const menu = node.closest("nav");
              return {
                link: node.getBoundingClientRect().toJSON(),
                menu: menu?.getBoundingClientRect().toJSON(),
                scrollTop: menu?.scrollTop,
                scrollHeight: menu?.scrollHeight,
                clientHeight: menu?.clientHeight,
                headerScroll: node.closest(".case-workspace__header")?.scrollTop,
              };
            }),
          ),
          contentType: "application/json",
        });
        await expect
          .poll(
            () =>
              link.evaluate((node) => {
                const bounds = node.getBoundingClientRect();
                const menu = node.closest("nav")?.getBoundingClientRect();
                const topbar = document.querySelector(".app-header")?.getBoundingClientRect();
                if (!menu || !topbar) throw new Error("Case tools bounds missing");
                return {
                  belowNavigation: menu.top >= topbar.bottom,
                  insideViewport:
                    menu.left >= 0 && menu.right <= innerWidth && menu.bottom <= innerHeight,
                  fullLink: bounds.top >= menu.top && bounds.bottom <= menu.bottom,
                  target: bounds.height >= 44,
                  hit: node.contains(
                    document.elementFromPoint(
                      bounds.x + bounds.width / 2,
                      bounds.y + bounds.height / 2,
                    ),
                  ),
                };
              }),
            { message: `${stage}: ${name} must remain fully actionable` },
          )
          .toEqual({
            belowNavigation: true,
            insideViewport: true,
            fullLink: true,
            target: true,
            hit: true,
          });
        await link.click({ trial: true });
      }
      await test.info().attach(stage, {
        body: JSON.stringify(
          await tools.evaluate((node) => ({
            menu: node.getBoundingClientRect().toJSON(),
            scrollHeight: node.scrollHeight,
            clientHeight: node.clientHeight,
            trigger: node
              .closest("details")
              ?.querySelector("summary")
              ?.getBoundingClientRect()
              .toJSON(),
            headerScroll: node.closest(".case-workspace__header")?.scrollTop,
            links: [...node.querySelectorAll("a")].map((link) => ({
              name: link.textContent,
              bounds: link.getBoundingClientRect().toJSON(),
            })),
          })),
        ),
        contentType: "application/json",
      });
    };
    await header.focus();
    await header.press("End");
    await expect.poll(() => header.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await openTools();
    await expectActionable("first-open");
    await trigger.focus();
    await page.keyboard.press("Tab");
    await expect(tools.getByRole("link", { name: names[0], exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(tools).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await expect.poll(() => header.evaluate((node) => node.scrollTop)).toBe(0);
    await openTools();
    await expectActionable("reopen");
    expect(await tools.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    const expectFocusedActionable = async (link: Locator) => {
      await expect(link).toBeFocused();
      await expect
        .poll(() =>
          link.evaluate((node) => {
            const rect = node.getBoundingClientRect();
            const menu = node.closest("nav")?.getBoundingClientRect();
            return Boolean(
              menu &&
                rect.top >= menu.top &&
                rect.bottom <= menu.bottom &&
                node.contains(
                  document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
                ),
            );
          }),
        )
        .toBe(true);
    };
    for (const height of [350, 250, 200]) {
      await page.setViewportSize({ width: 600, height });
      await expect(page.locator(".app-frame")).toHaveCSS("--app-viewport-height", `${height}px`);
      await expect
        .poll(() => tools.evaluate((node) => node.getBoundingClientRect().bottom))
        .toBeLessThanOrEqual(height - 16);
      if (height !== 350) await expectFocusedActionable(tools.getByRole("link").last());
      await expectActionable(`reflow-${height}`);
      await trigger.focus();
      for (const name of names) {
        await page.keyboard.press("Tab");
        const link = tools.getByRole("link", { name, exact: true });
        await expectFocusedActionable(link);
      }
    }
    const lastLink = tools.getByRole("link").last();
    await page.setViewportSize({ width: 600, height: 350 });
    await expectFocusedActionable(lastLink);
    for (const zoom of ["2", "1"]) {
      await page.evaluate((zoom) => {
        document.documentElement.style.zoom = zoom;
      }, zoom);
      await expect(page.locator(".app-frame")).toHaveCSS(
        "--app-viewport-height",
        `${350 / Number(zoom)}px`,
      );
      await expectFocusedActionable(lastLink);
      await header.evaluate((node) => {
        node.scrollTop = node.scrollHeight;
      });
      await expectFocusedActionable(lastLink);
      await header.evaluate((node) => {
        node.scrollTop = 0;
      });
      await expectFocusedActionable(lastLink);
    }
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(composer).toHaveValue("도구를 다시 열어도 보존할 합성 작성 내용");
    await expect(page).toHaveURL(new RegExp(`/cases/${caseId}$`));
    await page.setViewportSize({ width: 600, height: 350 });
    await openTools();
    await expectActionable("final-reopen");
    await page.screenshot({
      path: ".wrangler/ui01/tools-reopen-short-viewport.png",
      animations: "disabled",
    });
    expect(pageErrors).toEqual([]);
  });
});

test.describe("native case tools before hydration", () => {
  test.use({ javaScriptEnabled: false });
  for (const width of [320, 1440]) {
    test(`server-rendered tools keep four native links actionable at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/cases/${caseId}`);
      const trigger = page.locator(".case-tools > summary");
      const details = page.locator(".case-tools");
      const tools = page.getByRole("navigation", { name: "사건 도구", exact: true });
      expect(await details.evaluate((node) => (node as HTMLDetailsElement).open)).toBe(false);
      await trigger.press("Enter");
      const state = await tools.getByRole("link").last().evaluate(inspectCaseTool);
      expect(state.ssr).toBe(true);
      expect(state.inlineStyle).toBeNull();
      await expectCaseToolLinks(tools);
      await trigger.press("Space");
      expect(await details.evaluate((node) => (node as HTMLDetailsElement).open)).toBe(false);
      await trigger.click();
      await expectCaseToolLinks(tools);
      await tools.getByRole("link", { name: "유사 판례", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/cases/${caseId}/precedents$`));
    });
  }
});

test("the first native target and open state survive delayed hydration", async ({ page }) => {
  let resume = () => {};
  const released = new Promise<void>((resolve) => {
    resume = () => resolve();
  });
  let held = false;
  await page.route(/\/src\/components\/workspace\/Workspace\.tsx(?:\?|$)/, async (route) => {
    held = true;
    await released;
    await route.continue();
  });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/cases/${caseId}`, { waitUntil: "domcontentloaded" });
    // Hold the real client module, rather than waiting for readiness before opening.
    await expect.poll(() => held).toBe(true);
    const trigger = page.locator(".case-tools > summary");
    const tools = page.getByRole("navigation", { name: "사건 도구", exact: true });
    expect(
      await page.locator(".case-tools").evaluate((node) => (node as HTMLDetailsElement).open),
    ).toBe(false);
    await trigger.click();
    const link = tools.getByRole("link", { name: "유사 판례", exact: true });
    const point = await link.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    const before = await link.evaluate(inspectCaseTool, point);
    await test.info().attach("before-hydration", {
      body: JSON.stringify(before),
      contentType: "application/json",
    });
    expect(before.open).toBe(true);
    expect(before.ssr).toBe(true);
    expect(before.hit, JSON.stringify(before)).toBe(true);
    resume();
    await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
    await expect
      .poll(() => tools.evaluate((node) => node.style.getPropertyValue("--case-tools-left")))
      .not.toBe("");
    const after = await link.evaluate(inspectCaseTool, point);
    await test
      .info()
      .attach("after-hydration", { body: JSON.stringify(after), contentType: "application/json" });
    expect(after.open).toBe(true);
    expect(after.ssr).toBe(false);
    // Keep the original point: a fresh point would hide an initial target moving away.
    expect(after.hit, JSON.stringify(after)).toBe(true);
    await expectCaseToolLinks(tools);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/cases/${caseId}/precedents$`));
  } finally {
    resume();
  }
});

for (const width of [390, 1440]) {
  test(`captures exact-base app before images at ${width}px`, async ({ page }) => {
    test.skip(!process.env.BARO_SHELL_BASELINE_URL, "Set an isolated exact-base mock server URL.");
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/app", `/cases/${caseId}`]) {
      await page.goto(`${process.env.BARO_SHELL_BASELINE_URL}${route}`);
      await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: `.wrangler/ui01/app-${route === "/app" ? "new" : "chat"}-before-${width}.png`,
        animations: "disabled",
      });
    }
  });
}
