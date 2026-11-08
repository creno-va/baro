import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { POLICY_VERSIONS, policyDrafts } from "../../src/content/policy-drafts";

// Only synthetic accounts and intercepted same-origin responses are used here.
// These checks do not establish a successful external OAuth exchange.
test("public and recovery pages share accessible navigation at 320px and 200% zoom", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const viewport of [
    { width: 320, height: 760 },
    { width: 640, height: 450 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    for (const path of ["/", "/help", "/login", "/policies/privacy", "/missing-synthetic-page"]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(path.includes("missing") ? 404 : 200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("link", { name: "BARO 홈", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      if (viewport.width === 320 || viewport.width === 1440) {
        const name = path === "/" ? "home" : path.replaceAll("/", "-").slice(1);
        await page.screenshot({
          path: `.wrangler/redesign-04-${name}-${viewport.width}.png`,
          fullPage: true,
        });
      }
    }
  }
  await page.goto("/missing-synthetic-page");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "본문으로 건너뛰기" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await page.getByRole("link", { name: "홈으로", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/$/);
});

test("policy layout renders every current paragraph and version without changing the legal content", async ({
  page,
}) => {
  for (const kind of ["terms", "privacy", "ai"] as const) {
    await page.goto(`/policies/${kind}`);
    const article = page.getByRole("article");
    await expect(article.getByRole("heading", { level: 1 })).toHaveText(policyDrafts[kind].title);
    await expect(article).toContainText(POLICY_VERSIONS[kind]);
    const sections = article.locator("section");
    await expect(sections).toHaveCount(policyDrafts[kind].sections.length);
    for (const [index, source] of policyDrafts[kind].sections.entries()) {
      const section = sections.nth(index);
      await expect(section.getByRole("heading", { level: 2 })).toHaveText(source.title);
      await expect(section.locator("p")).toHaveText(source.paragraphs);
    }
    await expect(page.locator('a[href^="/lawyer"]')).toHaveCount(0);
    await page.setViewportSize({ width: 640, height: 450 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

test("retired lawyer routes explain the unavailable feature without loading profile or contact data", async ({
  page,
}) => {
  let profileReads = 0;
  await page.route("**/api/v2/lawyers**", (route) => {
    profileReads++;
    return route.abort();
  });
  for (const path of ["/lawyer", "/lawyers", "/lawyers/synthetic-profile"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(410);
    await expect(page.getByRole("main")).toContainText("변호사 연결 기능은 제공하지 않습니다");
    await expect(page.locator('a[href^="tel:"], a[href^="mailto:"]')).toHaveCount(0);
    await expect(page.getByRole("link", { name: "내 사건으로", exact: true })).toHaveAttribute(
      "href",
      "/app",
    );
    await expect(page.getByRole("textbox")).toHaveCount(0);
  }
  expect(profileReads).toBe(0);
});
