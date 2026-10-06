// Standalone test server: actual SQLite, AES, signed cookies, Hono routes and
// R2 byte adapter. No source material, credentials or synthetic sessions in artifacts.
import { resolve } from "node:path";
import { reportHttpFixture } from "./report-http-fixture";

if (Bun.env.BARO_SYNTHETIC_REPORT_SERVER !== "true")
  throw new Error("Explicit synthetic test composition required");
const f = await reportHttpFixture();
const root = resolve(import.meta.dir, "../..");
const bundle = await Bun.build({
  entrypoints: [resolve(import.meta.dir, "report-real-entry.tsx")],
  target: "browser",
  define: { "import.meta.env.PUBLIC_API_MODE": '"real"' },
  plugins: [
    {
      name: "real-report-adapters",
      setup(build) {
        build.onResolve({ filter: /^\.\.\/\.\.\/client\/api$/ }, () => ({
          path: resolve(import.meta.dir, "report-real-api.ts"),
        }));
      },
    },
  ],
});
if (!bundle.success) throw new Error("Report browser bundle unavailable");
const script = await bundle.outputs[0]?.text();
const globalCss = (await Bun.file(`${root}/src/styles/global.css`).text())
  .replace(/^@import .*;$/gm, "")
  .replace(/@theme inline\s*\{[^}]*\}/s, "");
const css =
  globalCss +
  (await Bun.file(`${root}/src/styles/shell.css`).text()) +
  (await Bun.file(`${root}/src/styles/reports.css`).text());
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/api/")) return f.app.fetch(request, f.env);
    if (path === "/app.js")
      return new Response(script, { headers: { "content-type": "text/javascript" } });
    if (path === "/app.css") return new Response(css, { headers: { "content-type": "text/css" } });
    if (path === "/fonts/PretendardVariable.woff2")
      return new Response(Bun.file(`${root}/public/fonts/PretendardVariable.woff2`));
    return new Response(
      '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BARO 합성 SQL 리포트 검증</title><link rel="stylesheet" href="/app.css"></head><body><main id="root" style="padding:20px"></main><script type="module" src="/app.js"></script></body></html>',
      { headers: { "content-type": "text/html;charset=utf-8" } },
    );
  },
});
f.env.BETTER_AUTH_URL = server.url.origin;
const separator = f.cookie.indexOf("=");
console.log(
  JSON.stringify({
    origin: server.url.origin,
    caseId: f.workspaceId,
    selectedFileId: f.selectedFileId,
    original: f.original,
    cookie: {
      name: f.cookie.slice(0, separator),
      value: f.cookie.slice(separator + 1),
      url: server.url.origin,
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  }),
);
process.stdin.resume();
process.stdin.on("end", () => {
  server.stop(true);
  f.db.close();
  process.exit(0);
});
