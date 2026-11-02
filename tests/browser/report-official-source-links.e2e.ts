import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { officialReportUrls } from "../helpers/report-official-source-fixture";

for (const path of ["/", "/report.html"])
  test(`official source navigation is bounded, explicit and unchanged in ${path}`, async ({
    page,
    context,
  }, info) => {
    const requests: string[] = [];
    await context.route("**/*", async (route) => {
      if (new URL(route.request().url()).origin === "http://127.0.0.1:4436")
        return route.continue();
      requests.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: "text/html;charset=utf-8",
        body: '<!doctype html><html><head><meta charset="utf-8"></head><body><p>합성 클릭 도착 · 실제 공급자 호출 없음</p></body></html>',
      });
    });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(path);
    const links = page.locator("a.report-official-source");
    await expect(links).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      await expect(links.nth(i)).toHaveAttribute("href", officialReportUrls[i]!);
      await expect(links.nth(i)).toHaveAttribute("target", "_blank");
      await expect(links.nth(i)).toHaveAttribute("rel", "noopener noreferrer");
      await expect(links.nth(i)).toHaveAttribute("referrerpolicy", "no-referrer");
    }
    await expect(
      page.getByText("보완 필요 · 사용자가 수정한 리포트입니다.", { exact: false }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(requests).toEqual([]);
    expect(await page.locator("script:not([src])").count()).toBe(0);
    await links.first().focus();
    await expect(links.first()).toBeFocused();
    if (path === "/")
      expect((await links.first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const out = process.env.BARO_REPORT_SOURCE_ARTIFACT_DIR;
    if (out) {
      await mkdir(out, { recursive: true });
      await page.screenshot({
        path: `${out}/${info.project.name}-${path === "/" ? "web" : "html"}.png`,
        fullPage: true,
      });
    }
    const popupPromise = context.waitForEvent("page");
    await links.first().press("Enter");
    const popup = await popupPromise;
    await popup.waitForLoadState();
    await expect(popup.getByText("합성 클릭 도착 · 실제 공급자 호출 없음")).toBeVisible();
    expect(requests).toEqual([officialReportUrls[0]]);
    expect(await popup.evaluate(() => window.opener === null)).toBe(true);
    await popup.close();
  });
