import { expect, test } from "@playwright/test";

for (const side of ["claim", "response"])
  test(`${side}: long Korean text, exact quotes and evidence remain readable in web and HTML`, async ({
    page,
  }) => {
    for (const format of ["web", "html"])
      for (const width of [1440, 375]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/?side=${side}&format=${format}`);
        await expect(page.getByText("긴 조항 검증 35", { exact: false })).toBeVisible();
        await expect(
          page.getByText("합성 판례 원문: 송금 사실과 반환 약정의 존재는 구별하여 살핀다.", {
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByRole("heading", { name: "출처와 분석 기준", exact: true }),
        ).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await expect(page.locator(".report-inline-photo img")).toHaveCount(2);
        await expect
          .poll(() =>
            page
              .locator(".report-inline-photo img")
              .evaluateAll((images) =>
                images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
              ),
          )
          .toBe(true);
        await expect(page.locator("tbody tr")).toHaveCount(55);
        await expect(page.locator("tbody tr").last()).toContainText("비교 항목 55");
        if (format === "html") {
          const ratio = await page
            .locator(".baro-report .hero")
            .evaluate(
              (hero) =>
                (hero.querySelector("h1")?.getBoundingClientRect().width ?? 0) /
                hero.getBoundingClientRect().width,
            );
          expect(ratio).toBeGreaterThan(0.95);
        }
        if (format === "web") {
          await expect(page.locator(".report-inline-photo img")).toHaveCount(2);
          const widths = await page
            .locator(".report-reading-section")
            .evaluateAll((sections) => sections.map((node) => node.getBoundingClientRect().width));
          expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1);
        }
        await page.screenshot({
          path: `.wrangler/report-rework/${side}-${format}-${width}.png`,
          fullPage: true,
        });
      }
  });
