import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { DirectoryItem, DirectoryPage } from "../../src/contracts/v2";
import { publicLawyer } from "../fixtures/contracts/v2";

const directoryLawyer: DirectoryItem = {
  id: publicLawyer.id,
  revision: publicLawyer.approvedRevision,
  name: publicLawyer.content.name,
  officeName: publicLawyer.content.office.name,
  introduction: publicLawyer.content.introduction,
  region: publicLawyer.content.office.region,
  practiceAreas: publicLawyer.content.legalFields,
  photoUrl: `/api/v2/lawyers/${publicLawyer.id}/assets/${publicLawyer.content.photoAssetId}`,
  photoAssetId: publicLawyer.content.photoAssetId,
  verificationStatus: "verified",
};
const directoryPage = (items: DirectoryItem[] = []): DirectoryPage => ({
  items,
  nextCursor: null,
  expiresAt: "2099-01-01T00:00:00Z",
  rotation: { day: "2026-10-14", algorithm: "daily_sha256_pivot_v1" },
});

test("profile round trip retains applied search filters after reload and ignores unrelated return parameters", async ({
  page,
}) => {
  await page.route("**/api/v2/lawyers**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/api/v2/lawyers/self-service/"))
      return route.fulfill({ status: 404, json: {} });
    if (path === "/api/v2/lawyers/directory")
      return route.fulfill({ json: directoryPage([directoryLawyer]) });
    if (path.includes("/assets/")) return route.fulfill({ status: 404 });
    return route.fulfill({ json: publicLawyer });
  });
  const filters = new URLSearchParams({
    name: directoryLawyer.name,
    region: "seoul",
    legalField: "company",
  });
  const listPath = `/lawyers?${filters}`;
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 760 });
    await page.goto(listPath);
    const profile = page.getByRole("link", { name: "프로필과 연락처 보기" });
    await expect(profile).toBeVisible();
    await expect(page.getByText("Preview 환경 · 실제 API에 연결합니다.")).toHaveCount(0);
    const controls = await page
      .getByRole("form", { name: "변호사 검색" })
      .locator("input, select, button[type=submit]")
      .evaluateAll((elements) =>
        elements.map((element) => {
          const { height, bottom } = element.getBoundingClientRect();
          return { height, bottom };
        }),
      );
    expect(controls).toHaveLength(4);
    const button = controls[3];
    if (!button) throw new Error("Search button is missing");
    for (const field of controls.slice(0, 3)) {
      expect(Math.abs(field.height - button.height)).toBeLessThanOrEqual(1);
    }
    expect(controls.slice(0, 3).some((field) => Math.abs(field.bottom - button.bottom) <= 1)).toBe(
      true,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    if (width === 390 || width === 1440) {
      await page.screenshot({ path: `.wrangler/directory-controls-${width}.png`, fullPage: true });
    }
    await page.getByLabel("이름 또는 사무실", { exact: true }).fill("검색하지 않은 입력");
    await expect(profile).toHaveAttribute("href", `/lawyers/${directoryLawyer.id}?${filters}`);
    await profile.click();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: publicLawyer.content.name, exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Preview 환경 · 실제 API에 연결합니다.")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "변호사 목록으로", exact: true })).toHaveAttribute(
      "href",
      listPath,
    );
    await page.getByRole("link", { name: "변호사 목록으로", exact: true }).click();
    await expect(page.getByLabel("이름 또는 사무실", { exact: true })).toHaveValue(
      directoryLawyer.name,
    );
    await expect(page.getByRole("combobox", { name: "지역", exact: true })).toHaveValue("seoul");
    await expect(page.getByRole("combobox", { name: "분야", exact: true })).toHaveValue("company");
  }
  await page.goto(
    `/lawyers/${directoryLawyer.id}?region=seoul&returnTo=https://example.com&unknown=secret&legalField=invalid`,
  );
  await expect(page.getByRole("link", { name: "변호사 목록으로", exact: true })).toHaveAttribute(
    "href",
    "/lawyers?region=seoul",
  );
});

test("directory filters, empty supply, approved detail and office-only contact work at 320px", async ({
  page,
}) => {
  const profileFixture = {
    ...publicLawyer,
    content: {
      ...publicLawyer.content,
      contact: { ...publicLawyer.content.contact, email: "synthetic-profile@example.test" },
    },
  };
  const seen: URL[] = [];
  await page.route("**/api/v2/lawyers**", (route) => {
    const url = new URL(route.request().url());
    seen.push(url);
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
    if (url.pathname === "/api/v2/lawyers/directory")
      return route.fulfill({
        json: directoryPage(url.searchParams.get("region") === "jeju" ? [] : [directoryLawyer]),
      });
    return route.fulfill({ json: profileFixture });
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
  await expect(page.getByText("공개 프로필", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "소개", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /소개와 분야|직접 연락/ })).toHaveCount(0);
  const contact = page.getByRole("button", { name: "연락처 보기", exact: true });
  await contact.click();
  const dialog = page.getByRole("dialog", { name: "연락처", exact: true });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: profileFixture.content.contact.phone ?? "", exact: true }),
  ).toHaveAttribute("href", `tel:${profileFixture.content.contact.phone?.replace(/[^+0-9]/g, "")}`);
  await expect(
    dialog.getByRole("link", { name: "synthetic-profile@example.test", exact: true }),
  ).toHaveAttribute("href", "mailto:synthetic-profile%40example.test");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(contact).toBeFocused();
  const cardStyles = await page
    .locator(".lawyer-profile > .ui-card")
    .first()
    .evaluate((card) => ({
      radius: Number.parseFloat(getComputedStyle(card).borderRadius),
      padding: Number.parseFloat(
        getComputedStyle(card.querySelector(".ui-card__content")!).paddingLeft,
      ),
    }));
  expect(cardStyles.radius).toBeGreaterThanOrEqual(16);
  expect(cardStyles.padding).toBeGreaterThanOrEqual(20);
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
  await page.route("**/api/v2/lawyers/directory?*", (route) =>
    route.fulfill(fail ? { status: 503, json: {} } : { json: directoryPage() }),
  );
  await page.goto("/lawyers");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "다시 검색", exact: true }).click();
  await expect(page.getByText("조건에 맞는 공개 프로필이 없어요.")).toBeVisible();
});

test("URL restores before input; a slow initial response cannot erase fast edits and back/forward filters", async ({
  page,
}) => {
  let releaseModule: () => void = () => {};
  const moduleGate = new Promise<void>((resolve) => {
    releaseModule = resolve;
  });
  await page.route("**/src/components/lawyers/Directory.tsx*", async (route) => {
    await moduleGate;
    await route.continue();
  });
  let releaseInitial: () => void = () => {};
  const initialGate = new Promise<void>((resolve) => {
    releaseInitial = resolve;
  });
  await page.route("**/api/v2/lawyers/directory?*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("name") === "URL 초기 조건") await initialGate;
    return route.fulfill({ json: directoryPage() });
  });
  await page.goto("/lawyers?name=URL%20초기%20조건&region=busan&legalField=civil", {
    waitUntil: "commit",
  });
  const name = page.getByLabel("이름 또는 사무실", { exact: true });
  await expect(name).toBeVisible();
  await expect(name).toBeDisabled();
  releaseModule();
  await expect(name).toBeEnabled();
  await expect(name).toHaveValue("URL 초기 조건");
  await name.fill("빠른 입력 유지");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  releaseInitial();
  await expect(name).toHaveValue("빠른 입력 유지");
  await expect(page).toHaveURL(/name=.*&region=busan&legalField=civil/);
  await expect(page.getByText("조건에 맞는 공개 프로필이 없어요.")).toBeVisible();
  await page.goBack();
  await expect(name).toHaveValue("URL 초기 조건");
  await expect(page.getByRole("combobox", { name: "지역", exact: true })).toHaveValue("busan");
  await page.goForward();
  await expect(name).toHaveValue("빠른 입력 유지");
  await page.getByRole("button", { name: "조건 초기화" }).focus();
  await page.keyboard.press("Enter");
  await expect(name).toHaveValue("");
  await expect(page).toHaveURL(/\/lawyers$/);
});
