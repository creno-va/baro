import { expect, type Page, test } from "@playwright/test";

async function openInvalidNarrative(page: Page, keepFieldFocus = false) {
  const session = {
    user: { id: "dialog-focus-owner", name: "합성 고객", accountType: "customer" },
    needsConsent: false,
  };
  await page.addInitScript((session) => {
    localStorage.setItem("baro-api-mock-v1:session", JSON.stringify(session));
  }, session);
  await page.route("**/api/me/session", (route) => route.fulfill({ json: session }));
  for (const path of ["**/api/cases?*", "**/api/v2/cases?*"])
    await page.route(path, (route) => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/new");
  const field = page.getByRole("textbox", { name: "지금까지 있었던 일", exact: true });
  const submit = page.getByRole("button", { name: "저장하고 계속", exact: true });
  await expect(field).toBeEnabled();
  await field.fill("😀".repeat(9));
  if (keepFieldFocus) {
    await field.focus();
    await submit.evaluate((button) =>
      button.addEventListener("mousedown", (event) => event.preventDefault(), { once: true }),
    );
  }
  await submit.click();
  const dialog = page.getByRole("dialog", {
    name: "이야기를 조금만 더 적어주세요",
    exact: true,
    includeHidden: true,
  });
  await expect(dialog).toBeVisible();
  return { field, submit, dialog };
}

test("Headless validation dismissal restores the field and retains the narrative", async ({
  page,
}) => {
  const { field, dialog } = await openInvalidNarrative(page);
  await dialog.getByRole("button", { name: "계속 작성하기", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("😀".repeat(9));
  await expect(field).toHaveAttribute("aria-invalid", "false");
  expect(await page.evaluate(() => localStorage.getItem("baro-api-mock-v1:cases"))).toBeNull();
});

test("late modal restoration respects a newly selected submit target", async ({ page }) => {
  const { field, submit, dialog } = await openInvalidNarrative(page, true);
  await dialog.getByRole("button", { name: "계속 작성하기", exact: true }).evaluate((button) => {
    button.addEventListener(
      "click",
      () => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const action = document.querySelector<HTMLButtonElement>(
              '.conversation-entry button[type="submit"]',
            );
            if (!action) throw new Error("Synthetic submit target missing");
            action.focus();
            document.documentElement.dataset.pickedSubmit = String(
              document.activeElement === action,
            );
          }),
        );
      },
      { once: true },
    );
  });
  await dialog.getByRole("button", { name: "계속 작성하기", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("html")).toHaveAttribute("data-picked-submit", "true");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(submit).toBeFocused();
  const value = await field.inputValue();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(page.locator("#narrative")).toHaveValue(value);
  expect(await page.evaluate(() => localStorage.getItem("baro-api-mock-v1:cases"))).toBeNull();
});
