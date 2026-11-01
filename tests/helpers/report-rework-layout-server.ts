const build = await Bun.build({
  entrypoints: ["tests/helpers/report-rework-layout-entry.tsx"],
  target: "browser",
});
if (!build.success || !build.outputs[0]) throw new Error("REPORT_REWORK_LAYOUT_BUILD_FAILED");
const script = await build.outputs[0].text();
const css =
  (await Bun.file("src/styles/global.css").text())
    .replace(/^@import .*;$/gm, "")
    .replace(/@theme inline\s*\{[^}]*\}/s, "") + (await Bun.file("src/styles/reports.css").text());
Bun.serve({
  hostname: "127.0.0.1",
  port: 4377,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/app.js")
      return new Response(script, { headers: { "content-type": "text/javascript" } });
    if (path === "/app.css") return new Response(css, { headers: { "content-type": "text/css" } });
    if (path.startsWith("/fonts/")) return new Response(Bun.file(`public${path}`));
    if (path.endsWith("/photos/synthetic-rework-photo"))
      return new Response(Bun.file("tests/fixtures/media/image-markers.jpg"), {
        headers: { "content-type": "image/jpeg" },
      });
    return new Response(
      '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><title>합성 리포트 조판 검증</title></head><body><main id="root"></main><script type="module" src="/app.js"></script></body></html>',
      { headers: { "content-type": "text/html;charset=utf-8" } },
    );
  },
});
console.info("Synthetic report layout: http://127.0.0.1:4377");
