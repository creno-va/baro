import { expect, type Page } from "@playwright/test";

/** Wait for the editor's acknowledged save or its explicit failure state. */
export async function settleIntakeSave(page: Page) {
  const failure = page.locator(".intake-flow > .ui-state");
  const retry = failure.getByRole("button", { name: "다시 시도", exact: true });
  if (await retry.isVisible()) await retry.click();
  await expect
    .poll(
      async () =>
        /저장됐어요/.test((await page.locator(".intake-scene-notice").textContent()) ?? "") ||
        (await failure.isVisible()),
    )
    .toBe(true);
}
