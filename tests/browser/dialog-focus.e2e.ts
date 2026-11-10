import { expect, type Page, test } from "@playwright/test";

async function openInvalidNarrative(page: Page) {
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
  await page.goto("/app");
  const field = page.getByRole("textbox", { name: "지금까지 있었던 일", exact: true });
  const submit = page.getByRole("button", { name: "저장하고 계속", exact: true });
  await expect(field).toBeEnabled();
  await field.fill("😀".repeat(9));
  await submit.click();
  const dialog = page.getByRole("dialog", {
    name: "이야기를 조금만 더 적어주세요",
    exact: true,
    includeHidden: true,
  });
  await expect(dialog).toBeVisible();
  return { field, submit, dialog };
}

test("a controlled validation close returns to the invalid field after its native close event", async ({
  page,
}) => {
  const { field, dialog } = await openInvalidNarrative(page);
  await dialog.evaluate((node) => {
    node.addEventListener(
      "close",
      (event) => {
        node.setAttribute("data-native-close", String(event.isTrusted));
      },
      { once: true },
    );
  });
  await dialog.getByRole("button", { name: "계속 작성하기", exact: true }).click();
  await expect(dialog).toHaveAttribute("data-native-close", "true");
  expect(await field.evaluate((node) => document.activeElement === node)).toBe(true);
  await expect(field).toHaveValue("😀".repeat(9));
  expect(await page.evaluate(() => localStorage.getItem("baro-api-mock-v1:cases"))).toBeNull();
});

test("a queued native close preserves a newly selected submit target for Enter", async ({
  page,
}) => {
  const { field, submit, dialog } = await openInvalidNarrative(page);
  await dialog.evaluate((node) => {
    node.addEventListener(
      "close",
      (event) => {
        const submit = document.querySelector<HTMLButtonElement>(
          '.conversation-entry button[type="submit"]',
        );
        if (!submit) throw new Error("Synthetic submit target missing");
        // Reproduce explicit focus chosen before the queued close handler, without
        // delaying or replacing the native close event or the product handlers.
        submit.focus();
        node.setAttribute("data-native-close", String(event.isTrusted));
        node.setAttribute("data-selected-submit", String(document.activeElement === submit));
      },
      { once: true, capture: true },
    );
  });
  await dialog.getByRole("button", { name: "계속 작성하기", exact: true }).click();
  await expect(dialog).toHaveAttribute("data-native-close", "true");
  await expect(dialog).toHaveAttribute("data-selected-submit", "true");
  expect(await submit.evaluate((node) => document.activeElement === node)).toBe(true);
  const value = await field.inputValue();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(field).toHaveValue(value);
  expect(await page.evaluate(() => localStorage.getItem("baro-api-mock-v1:cases"))).toBeNull();
});
