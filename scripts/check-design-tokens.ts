import { extractDesignTokens, renderDesignTokens, verifyDesignTokens } from "./design-tokens";

const [product, global] = await Promise.all([
  Bun.file("src/styles/product.css").text(),
  Bun.file("src/styles/global.css").text(),
]);
const tokens = extractDesignTokens({ product, global });
verifyDesignTokens(tokens);
const output = "packages/design-tokens/src/index.ts";
const formatted = Bun.spawn(["bunx", "biome", "format", `--stdin-file-path=${output}`], {
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
});
formatted.stdin.write(renderDesignTokens(tokens));
formatted.stdin.end();
const [text, code] = await Promise.all([
  new Response(formatted.stdout).text(),
  formatted.exited,
  new Response(formatted.stderr).text(),
]);
if (code) throw new Error("DESIGN_TOKEN_FORMAT_FAILED");
if (process.argv.includes("--write")) {
  // Fixed output only. Web source is always read-only.
  await Bun.write(output, text);
} else if ((await Bun.file(output).text()) !== text) {
  throw new Error("DESIGN_TOKEN_DRIFT: run bun run design:generate and review the web handoff");
}
console.log(
  "Web design token source/portable output and required text/action contrast passed; device accessibility is separate",
);
