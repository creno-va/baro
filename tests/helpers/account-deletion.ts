import { expect, type Page } from "@playwright/test";

export async function openAccountDeletion(page: Page) {
  const dialog = page.getByRole("dialog");
  if (!(await dialog.isVisible())) {
    const open = page.getByRole("button", { name: "계정과 모든 사건 삭제", exact: true });
    await expect(open).toBeEnabled();
    await open.click();
  }
  await expect(dialog).toBeVisible();
  return dialog;
}
