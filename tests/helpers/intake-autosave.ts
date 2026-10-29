import { expect, type Page } from "@playwright/test";

/** Wait for the editor's unsaved-change guard to clear, without success-label coupling. */
export async function settleIntakeSave(page: Page) {
  const failure = page.locator(".intake-flow > .ui-state");
  const retry = failure.getByRole("button", { name: "다시 시도", exact: true });
  if (await retry.isVisible()) await retry.click();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => {
          const event = new Event("beforeunload", { cancelable: true });
          window.dispatchEvent(event);
          return !event.defaultPrevented;
        })) || (await failure.isVisible()),
      { timeout: 12000 },
    )
    .toBe(true);
}
