import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { publicLawyer } from "../fixtures/contracts/v2";

test("directory filters, empty supply, approved detail and office-only contact work at 320px", async ({
  page,
}) => {
  const seen: URL[] = [];
  await page.route("**/api/v2/lawyers**", (route) => {
    const url = new URL(route.request().url());
    seen.push(url);
    if (url.pathname === "/api/v2/lawyers/self-service") return route.fulfill({ json: [] });
    if (url.pathname.startsWith("/api/v2/lawyers/self-service/"))
      return route.fulfill({ status: 404, json: {} });
    if (url.pathname.includes("/assets/"))
      return route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1kAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    if (url.pathname !== "/api/v2/lawyers") return route.fulfill({ json: publicLawyer });
    return route.fulfill({
      json: {
        schemaVersion: "2",
        snapshotId: "synthetic-directory",
        rotation: "disclosed_rotation",
        expiresAt: "2026-10-06T00:05:00Z",
        items: url.searchParams.get("region") === "jeju" ? [] : [publicLawyer],
        nextCursor: null,
      },
    });
  });
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto("/lawyers");
  await expect(page.getByRole("heading", { name: "변호사 찾기", exact: true })).toBeVisible();
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "프로필과 연락처 보기" })).toBeVisible();
  await page.getByRole("combobox", { name: "지역", exact: true }).selectOption("jeju");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page.getByText("조건에 맞는 공개 프로필이 없어요.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("combobox", { name: "지역", exact: true })).toHaveValue("jeju");
  await expect(page.getByText("조건에 맞는 공개 프로필이 없어요.")).toBeVisible();
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.getByRole("combobox", { name: "지역", exact: true }).selectOption("");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await page.getByRole("link", { name: "프로필과 연락처 보기" }).click();
  await expect(
    page.getByRole("heading", { name: publicLawyer.content.name, exact: true }),
  ).toBeVisible();
  for (const name of ["네이버 지도", "카카오맵", "Google 길찾기"]) {
    const href = await page.getByRole("link", { name, exact: true }).getAttribute("href");
    expect(decodeURIComponent(href ?? "")).toContain(publicLawyer.content.office.address);
    expect(href).not.toMatch(/caseId|narrative|token|secret/);
  }
  expect(seen.some((url) => url.searchParams.get("region") === "jeju")).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: ".wrangler/directory-profile-320.png", fullPage: true });
});
test("directory transport failure can be retried without stale results", async ({ page }) => {
  let fail = true;
  await page.route("**/api/v2/lawyers**", (route) =>
    new URL(route.request().url()).pathname === "/api/v2/lawyers/self-service"
      ? route.fulfill({ json: [] })
      : fail
        ? route.fulfill({ status: 503, json: {} })
        : route.fulfill({
            json: {
              schemaVersion: "2",
              snapshotId: "synthetic-directory",
              rotation: "disclosed_rotation",
              expiresAt: "2026-10-06T00:05:00Z",
              items: [],
              nextCursor: null,
            },
          }),
  );
  await page.goto("/lawyers");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "다시 검색", exact: true }).click();
  await expect(page.getByText("조건에 맞는 공개 프로필이 없어요.")).toBeVisible();
});
