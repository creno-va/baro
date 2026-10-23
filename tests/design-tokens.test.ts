import { expect, test } from "bun:test";
import { designTokens } from "../packages/design-tokens/src";
import { contrastRatio, extractDesignTokens, verifyDesignTokens } from "../scripts/design-tokens";

const source = {
  product: await Bun.file("src/styles/product.css").text(),
  global: await Bun.file("src/styles/global.css").text(),
};
test("portable token values match the accepted web handoff, with no alternate native palette", () => {
  expect(extractDesignTokens(source)).toEqual(designTokens);
  expect(designTokens.color).toMatchObject({
    primary: "#2364e8",
    text: "#191f28",
    subtle: "#f6f8fb",
    line: "#edf0f4",
    onPrimary: "#ffffff",
  });
  expect(designTokens.radius.card).toBe(20);
  expect(designTokens.control.minimumSize).toBe(44);
  verifyDesignTokens(designTokens);
});
test("missing/duplicate/ambiguous CSS tokens and unsupported color/unit changes fail instead of silently falling back", () => {
  for (const product of [
    source.product.replace("--product-blue: #2364e8;", ""),
    source.product.replace("--product-blue: #2364e8;", "--product-blue: var(--primary);"),
    source.product.replace(
      "--product-blue: #2364e8;",
      "--product-blue: #2364e8; --product-blue: #fff;",
    ),
    source.product.replace("--product-radius: 20px;", "--product-radius: 1rem;"),
    `${source.product}\n.app-frame.app-frame--product { --product-blue: #fff; }`,
  ])
    expect(() => extractDesignTokens({ ...source, product })).toThrow();
});
test("text/action contrast uses known WCAG extrema and blocks low-contrast palette or undersized controls", () => {
  expect(contrastRatio("#000000", "#ffffff")).toBe(21);
  expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
  expect(
    contrastRatio(designTokens.color.primary, designTokens.color.onPrimary),
  ).toBeGreaterThanOrEqual(4.5);
  const parsed = extractDesignTokens(source);
  expect(() =>
    verifyDesignTokens({ ...parsed, color: { ...parsed.color, primary: "#ffffff" } }),
  ).toThrow("DESIGN_TOKEN_CONTRAST:primary");
  expect(() => verifyDesignTokens({ ...parsed, control: { minimumSize: 43 } })).toThrow(
    "DESIGN_TOKEN_TARGET",
  );
});
