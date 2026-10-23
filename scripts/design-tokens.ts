/** Read the accepted web handoff without importing CSS/DOM into shared runtime code. */
function block(source: string, selector: string, names: readonly string[]) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...text.matchAll(new RegExp(`^\\s*${escaped}\\s*\\{([^{}]*)\\}`, "gm"))];
  const candidates: Map<string, string>[] = [];
  for (const match of matches) {
    const values = new Map<string, string>();
    for (const declaration of (match[1] ?? "").split(";")) {
      const pair = declaration.trim().match(/^([a-zA-Z-]+)\s*:\s*([\s\S]+)$/);
      if (!pair?.[1] || !pair[2] || !names.includes(pair[1])) continue;
      if (values.has(pair[1])) throw new Error(`DESIGN_TOKEN_DUPLICATE:${pair[1]}`);
      values.set(pair[1], pair[2].trim());
    }
    // Responsive layout-only blocks are independent; token overrides require an explicit mapping.
    if (values.size) candidates.push(values);
  }
  if (candidates.length !== 1 || !candidates[0])
    throw new Error(`DESIGN_TOKEN_SELECTOR:${selector}`);
  return candidates[0];
}
function color(values: Map<string, string>, name: string) {
  const value = values.get(name)?.toLowerCase();
  if (!value || !/^#(?:[a-f0-9]{3}|[a-f0-9]{6})$/.test(value))
    throw new Error(`DESIGN_TOKEN_COLOR:${name}`);
  return value.length === 4
    ? `#${[...value.slice(1)].map((digit) => digit.repeat(2)).join("")}`
    : value;
}
function pixels(values: Map<string, string>, name: string) {
  const value = values.get(name)?.match(/^([1-9][0-9]*)px$/);
  if (!value?.[1] || Number(value[1]) > 1000) throw new Error(`DESIGN_TOKEN_LENGTH:${name}`);
  return Number(value[1]);
}
export function extractDesignTokens(source: { product: string; global: string }) {
  const product = block(source.product, ".app-frame.app-frame--product", [
      "--product-blue",
      "--product-ink",
      "--product-subtle",
      "--product-line",
      "--product-radius",
    ]),
    root = block(source.global, ":root", [
      "--background",
      "--card",
      "--primary-foreground",
      "--muted-foreground",
      "--border",
      "--input",
      "--ring",
      "--destructive",
      "--success",
      "--warning",
    ]),
    button = block(source.product, ".app-frame.app-frame--product .ui-button", ["min-height"]);
  return {
    color: {
      primary: color(product, "--product-blue"),
      text: color(product, "--product-ink"),
      subtle: color(product, "--product-subtle"),
      line: color(product, "--product-line"),
      background: color(root, "--background"),
      surface: color(root, "--card"),
      onPrimary: color(root, "--primary-foreground"),
      muted: color(root, "--muted-foreground"),
      border: color(root, "--border"),
      input: color(root, "--input"),
      focus: color(root, "--ring"),
      danger: color(root, "--destructive"),
      success: color(root, "--success"),
      warning: color(root, "--warning"),
    },
    radius: { card: pixels(product, "--product-radius") },
    control: { minimumSize: pixels(button, "min-height") },
  };
}
export type DesignTokens = ReturnType<typeof extractDesignTokens>;

/** WCAG relative luminance. Decorative dividers are not text or sole control boundaries. */
export function contrastRatio(a: string, b: string) {
  const luminance = (hex: string) => {
    if (!/^#[a-f0-9]{6}$/i.test(hex)) throw new Error("DESIGN_TOKEN_CONTRAST_COLOR");
    const channels = [1, 3, 5].map((offset) => {
      const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722;
  };
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function verifyDesignTokens(tokens: DesignTokens) {
  const pairs = [
    ["body", tokens.color.text, tokens.color.surface],
    ["body-subtle", tokens.color.text, tokens.color.subtle],
    ["body-background", tokens.color.text, tokens.color.background],
    ["muted", tokens.color.muted, tokens.color.surface],
    ["muted-subtle", tokens.color.muted, tokens.color.subtle],
    ["primary", tokens.color.onPrimary, tokens.color.primary],
    ["danger", tokens.color.danger, tokens.color.surface],
    ["success", tokens.color.success, tokens.color.surface],
    ["warning", tokens.color.warning, tokens.color.surface],
  ] as const;
  for (const [name, foreground, background] of pairs)
    if (contrastRatio(foreground, background) < 4.5)
      throw new Error(`DESIGN_TOKEN_CONTRAST:${name}`);
  if (tokens.control.minimumSize < 44) throw new Error("DESIGN_TOKEN_TARGET");
}
export function renderDesignTokens(tokens: DesignTokens) {
  return `/** Generated from web product.css/global.css. Run bun run design:generate; do not edit. */\nexport const designTokens = ${JSON.stringify(tokens, null, 2)} as const;\nexport type DesignTokens = typeof designTokens;\n`;
}
