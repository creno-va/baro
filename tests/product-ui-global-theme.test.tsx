import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { GlobalProductTheme } from "../src/product-ui/GlobalTheme";
import { ProductUIProvider } from "../src/product-ui/Provider";
import { ProductTheme, ProductThemeScope, useProductTheme } from "../src/product-ui/Theme";

function ThemeProbe() {
  const theme = useProductTheme();
  return <span>{theme}</span>;
}

test("the existing product theme bridge renders without browser storage or a new UI provider", () => {
  const render = () =>
    renderToString(
      <GlobalProductTheme>
        <ThemeProbe />
      </GlobalProductTheme>,
    );
  expect(render()).toBe(render());
  expect(render()).toContain('data-theme="light"');
  expect(render()).toContain("<span>light</span>");
  expect(render()).not.toMatch(/<script|\sstyle=|localStorage/i);
});

test("resolved theme scopes supply descendants without leaking between islands", () => {
  const dark = renderToString(
    <ProductThemeScope theme="dark">
      <ThemeProbe />
    </ProductThemeScope>,
  );
  const outside = renderToString(<ThemeProbe />);
  const light = renderToString(
    <GlobalProductTheme>
      <ThemeProbe />
    </GlobalProductTheme>,
  );
  expect(dark).toContain('data-theme="dark"');
  expect(dark).toContain("<span>dark</span>");
  expect(outside).toBe("<span>light</span>");
  expect(light).toContain("<span>light</span>");
});

test("the independent foundation catalogue retains its explicit validated theme seed", () => {
  const markup = renderToString(
    <ProductUIProvider initialState={{ theme: "dark" }}>
      <ProductTheme>
        <ThemeProbe />
      </ProductTheme>
    </ProductUIProvider>,
  );
  expect(markup).toContain('data-theme="dark"');
  expect(markup).toContain("<span>dark</span>");
});
