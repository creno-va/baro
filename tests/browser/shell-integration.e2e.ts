import { expect, test } from "@playwright/test";

test("customer login consent logout share the product shell without external API requests", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("**/api/**", (route) => {
    if (!new URL(route.request().url()).pathname.startsWith("/api/")) return route.continue();
    requests.push(route.request().url());
    return route.abort();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login?error=access_denied");
  await expect(page.getByRole("alert")).toContainText("로그인을 취소");
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await page.getByRole("radio", { name: /고객/ }).check();
  await page.getByRole("button", { name: "Naver로 계속하기" }).click();
  await expect(page).toHaveURL(/\/consent$/);
  await expect(page.getByRole("button", { name: "동의하고 계속하기" })).toBeDisabled();
  await page.getByRole("checkbox", { name: /이용약관, 개인정보/ }).check();
  await page.getByRole("checkbox", { name: "만 14세 이상입니다." }).check();
  await page.getByRole("button", { name: "동의하고 계속하기" }).click();
  await page.getByRole("link", { name: "내 화면으로 계속하기" }).click();
  await expect(page).toHaveURL(/\/cases$/);
  await expect(page.getByRole("heading", { name: "내 사건", exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("radio", { name: /고객/ })).toBeVisible();
  expect(requests).toEqual([]);
});
