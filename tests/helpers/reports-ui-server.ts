// Isolated browser harness for unchanged product components while A's shell is developed.
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const bundle = await Bun.build({
  entrypoints: [resolve(import.meta.dir, "reports-ui-entry.tsx")],
  target: "browser",
  define: { "import.meta.env.PUBLIC_API_MODE": '"real"' },
  minify: false,
  plugins: [
    {
      name: "reports-test-api",
      setup(build) {
        build.onResolve({ filter: /^\.\.\/(?:\.\.\/)?client\/api$/ }, () => ({
          path: resolve(import.meta.dir, "reports-ui-api.ts"),
        }));
      },
    },
  ],
});
if (!bundle.success) throw new Error("Report browser bundle failed");
const script = await bundle.outputs[0]?.text();
if (!script) throw new Error("Report bundle missing");
const globalCss = (await Bun.file(`${root}/src/styles/global.css`).text())
  .replace(/^@import .*;$/gm, "")
  .replace(/@theme inline\s*\{[^}]*\}/s, "");
const css =
  globalCss +
  (await Bun.file(`${root}/src/styles/workspace.css`).text()) +
  (await Bun.file(`${root}/src/styles/reports.css`).text()) +
  (await Bun.file(`${root}/src/styles/settings.css`).text());
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(Bun.env.BARO_REPORT_TEST_PORT ?? 4343),
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/app.js")
      return new Response(script, { headers: { "content-type": "text/javascript" } });
    if (path === "/app.css") return new Response(css, { headers: { "content-type": "text/css" } });
    if (path === "/fonts/PretendardVariable.woff2")
      return new Response(Bun.file(`${root}/public/fonts/PretendardVariable.woff2`));
    return new Response(
      '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BARO D - 합성 브라우저 검증</title><link rel="stylesheet" href="/app.css"></head><body><p style="padding:12px;background:#edf4ff">API 예시 응답으로 보기 · 독립 D 브라우저 검증</p><main id="root" style="padding:20px"></main><script type="module" src="/app.js"></script></body></html>',
      { headers: { "content-type": "text/html;charset=utf-8" } },
    );
  },
});
console.log(`D product component harness: ${server.url.origin}`);
