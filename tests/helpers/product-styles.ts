import { resolve } from "node:path";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";

/** Standalone browser harnesses render the actual migrated components and must
 * compile their real Astro stylesheet instead of omitting Tailwind utilities. */
export async function compileProductStyles(root: string) {
  const productEntry = resolve(root, "src/product-ui/product.css");
  const compiler = await compile(await Bun.file(productEntry).text(), {
    base: resolve(root, "src/product-ui"),
    from: productEntry,
    onDependency: () => {},
  });
  const scanner = new Scanner({
    sources: [
      { base: root, pattern: "src/**/*.{astro,ts,tsx}", negated: false },
      { base: root, pattern: "tests/helpers/*.tsx", negated: false },
    ],
  });
  return compiler.build(scanner.scan());
}
