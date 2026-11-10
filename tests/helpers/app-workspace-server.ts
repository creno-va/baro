// Standalone synthetic shell fixture. No application API, DB, provider or secret access.
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const bundle = await Bun.build({
  entrypoints: [resolve(import.meta.dir, "app-workspace-entry.tsx")],
  target: "browser",
  plugins: [
    {
      name: "shell-fixture-api",
      setup(build) {
        build.onResolve({ filter: /^\.\.\/\.\.\/client\/api$/ }, () => ({
          path: resolve(import.meta.dir, "app-workspace-api.ts"),
        }));
      },
    },
  ],
  define: { "import.meta.env.PUBLIC_API_MODE": '"mock"' },
});
if (!bundle.success) throw new Error("Shell fixture bundle failed");
const script = await bundle.outputs[0]?.text();
const names = [
  "global",
  "design-system",
  "shell",
  "app-focus",
  "cases",
  "workspace",
  "case-workbench",
];
const css =
  (await Promise.all(names.map((name) => Bun.file(`${root}/src/styles/${name}.css`).text())))
    .join("\n")
    .replace(/^@import .*;$/gm, "")
    .replace(/@theme inline\s*\{[^}]*\}/s, "") +
  `
.shell-fixture-chat{height:100%;min-height:0;display:grid;grid-template-rows:minmax(0,1fr) auto}
.shell-fixture-messages{overflow:auto;overscroll-behavior:contain;padding:24px;min-height:0}
.shell-fixture-messages>*{max-width:800px;margin:0 auto 24px}
.shell-fixture-composer{display:grid;gap:8px;padding:16px;max-width:832px;width:100%;margin:auto;box-sizing:border-box}
.shell-fixture-composer textarea{min-height:88px;width:100%;padding:12px;border:1px solid #e2e8f0}
.shell-fixture-materials{display:grid;gap:16px;padding:16px}
.shell-fixture-materials input{min-width:0;width:100%;min-height:44px}
.shell-fixture-materials p{margin:0}
.shell-fixture-document{max-width:820px;margin:auto;padding:24px}
`;
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(Bun.env.BARO_SHELL_FIXTURE_PORT ?? 4312),
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/app.js")
      return new Response(script, { headers: { "content-type": "text/javascript" } });
    if (path === "/app.css") return new Response(css, { headers: { "content-type": "text/css" } });
    if (path.startsWith("/brand/") || path.startsWith("/fonts/"))
      return new Response(Bun.file(`${root}/public${path}`));
    return new Response(
      '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BARO 공통 shell 합성 검증</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
      {
        headers: {
          "content-type": "text/html;charset=utf-8",
          "content-security-policy":
            "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'",
        },
      },
    );
  },
});
console.log(`Synthetic shell fixture: ${server.url.origin}`);
