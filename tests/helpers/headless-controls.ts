import { expect, type Locator, type Page } from "@playwright/test";
export function selectControl(
  owner: Page | Locator,
  options: { name?: string | RegExp; exact?: boolean } = {},
) {
  const controls = owner.locator('[data-slot="select"]');
  return options.name === undefined ? controls : owner.getByRole("button", options).and(controls);
}
export async function chooseOption(control: Locator, value: string | number | { label: string }) {
  const page = control.page();
  await control.click();
  const option =
    typeof value === "object"
      ? page.getByRole("option", { name: value.label, exact: true })
      : page.locator('[role="option"][data-value=' + JSON.stringify(String(value)) + "]");
  await expect(option).toBeVisible();
  await option.click();
}
export async function answerDiscard(page: Page, discard: boolean) {
  const dialog = page.getByRole("dialog", { name: "작성한 내용을 확인해 주세요", exact: true });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: discard ? "변경 버리기" : "계속 작성하기", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
}
