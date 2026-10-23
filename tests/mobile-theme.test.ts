import { expect, test } from "bun:test";
import { designTokens } from "@baro/design-tokens";
import { nativePagePadding, tokens } from "../apps/mobile/src/theme/tokens";
import { contrastRatio } from "../scripts/design-tokens";

test("native consumes canonical web meaning with its own target/density and no fixed text height", () => {
  for (const key of ["primary", "text", "muted", "surface", "onPrimary", "danger", "line"] as const)
    expect(tokens.color[key]).toBe(designTokens.color[key]);
  expect(tokens.radius.card).toBe(designTokens.radius.card);
  expect(tokens.control.minimumSize).toBeGreaterThanOrEqual(48);
  expect(nativePagePadding(320)).toBe(16);
  expect(nativePagePadding(390)).toBe(20);
  expect(nativePagePadding(768)).toBe(32);
});
test("readable button/pressed/disabled/choice/input labels and sole control boundaries retain required contrast", () => {
  for (const [text, surface] of [
    [tokens.color.text, tokens.color.surface],
    [tokens.color.text, tokens.color.background],
    [tokens.color.onPrimary, tokens.color.primary],
    [tokens.color.onPrimary, tokens.color.primaryPressed],
    [tokens.color.danger, tokens.color.surface],
    [tokens.color.danger, tokens.color.subtle],
    [tokens.color.muted, tokens.color.subtle],
    [tokens.color.primary, tokens.color.surface],
  ] as const)
    expect(contrastRatio(text, surface)).toBeGreaterThanOrEqual(4.5);
  for (const surface of [tokens.color.surface, tokens.color.subtle])
    expect(contrastRatio(tokens.color.controlBorder, surface)).toBeGreaterThanOrEqual(3);
});
