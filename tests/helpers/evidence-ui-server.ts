// Synthetic component harness. No real account, original or provider is used.
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const bundle = await Bun.build({
  entrypoints: [resolve(import.meta.dir, "evidence-ui-entry.tsx")],
  target: "browser",
  define: { "import.meta.env.PUBLIC_API_MODE": '"real"' },
  plugins: [
    {
      name: "synthetic-evidence-api",
      setup(build) {
        build.onResolve({ filter: /^\.\.\/(?:\.\.\/)?client\/api$/ }, () => ({
          path: resolve(import.meta.dir, "report-real-api.ts"),
        }));
      },
    },
  ],
});
if (!bundle.success) throw new Error("Synthetic evidence bundle failed");
const script = await bundle.outputs.find((file) => file.kind === "entry-point")?.text();
if (!script) throw new Error("Synthetic evidence script missing");
const global = (await Bun.file(`${root}/src/styles/global.css`).text())
  .replace(/^@import .*;$/gm, "")
  .replace(/@theme inline\s*\{[^}]*\}/s, "");
const css = `${global}\n${await Bun.file(`${root}/src/styles/workspace.css`).text()}\n${await Bun.file(`${root}/src/styles/evidence.css`).text()}\nmain{max-width:840px;margin:auto;padding:16px}`;
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(Bun.env.BARO_EVIDENCE_TEST_PORT ?? 4364),
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/app.js")
      return new Response(script, { headers: { "content-type": "text/javascript" } });
    if (path === "/app.css") return new Response(css, { headers: { "content-type": "text/css" } });
    if (path === "/fonts/PretendardVariable.woff2")
      return new Response(Bun.file(`${root}/public/fonts/PretendardVariable.woff2`));
    return new Response(
      '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BARO 합성 자료 검증</title><link rel="stylesheet" href="/app.css"></head><body><main id="root"></main><script type="module" src="/app.js"></script></body></html>',
      {
        headers: {
          "content-type": "text/html;charset=utf-8",
          "content-security-policy":
            "default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'",
        },
      },
    );
  },
});
console.log(`Synthetic evidence harness: ${server.url.origin}`);
