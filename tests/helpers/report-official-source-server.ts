import { createReportHtml } from "../../src/components/reports/document";
import { officialSourceReport } from "./report-official-source-fixture";

const build = await Bun.build({
  entrypoints: ["tests/helpers/report-official-source-entry.tsx"],
  target: "browser",
});
if (!build.success || !build.outputs[0]) throw new Error("SYNTHETIC_SOURCE_BUILD_FAILED");
const script = await build.outputs[0].text();
const css =
  (await Bun.file("src/styles/global.css").text())
    .replace(/^@import .*;$/gm, "")
    .replace(/@theme inline\s*\{[^}]*\}/s, "") +
  (await Bun.file("src/styles/design-system.css").text()) +
  (await Bun.file("src/styles/reports.css").text()) +
  "body{padding:16px}h1{font-size:24px}";
Bun.serve({
  hostname: "127.0.0.1",
  port: 4436,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/report.html")
      return new Response(createReportHtml(officialSourceReport), {
        headers: { "content-type": "text/html;charset=utf-8" },
      });
    if (path === "/app.js")
      return new Response(script, { headers: { "content-type": "text/javascript" } });
    if (path === "/app.css") return new Response(css, { headers: { "content-type": "text/css" } });
    if (path === "/fonts/PretendardVariable.woff2") return new Response(Bun.file(`public${path}`));
    return new Response(
      '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><main id="root"></main><script type="module" src="/app.js"></script></body></html>',
      {
        headers: {
          "content-type": "text/html;charset=utf-8",
          "content-security-policy":
            "default-src 'self'; img-src data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'",
        },
      },
    );
  },
});
console.info("Synthetic source links: http://127.0.0.1:4436");
