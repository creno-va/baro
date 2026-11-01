import { resolve } from "node:path";
import { resolutionHarness, resolutionSource } from "./resolution-fixture";

const root = resolve(import.meta.dir, "../..");
const bundle = await Bun.build({
  entrypoints: [resolve(import.meta.dir, "resolution-entry.tsx")],
  target: "browser",
  define: { "import.meta.env.PUBLIC_API_MODE": '"real"' },
  plugins: [
    {
      name: "isolated-resolution-client",
      setup(build) {
        build.onResolve({ filter: /^\.\.\/\.\.\/client\/api$/ }, () => ({
          path: resolve(import.meta.dir, "resolution-default-api.ts"),
        }));
      },
    },
  ],
  minify: false,
});
if (!bundle.success) throw Error("resolution fixture build failed");
const script = await bundle.outputs.find((file) => file.path.endsWith(".js"))?.text();
if (!script) throw Error("fixture script missing");
const css =
  (await Bun.file(`${root}/src/styles/global.css`).text())
    .replace(/^@import .*;$/gm, "")
    .replace(/@theme inline\s*\{[^}]*\}/s, "") +
  (await Bun.file(`${root}/src/styles/resolution.css`).text()) +
  "main{max-width:840px;margin:auto;padding:20px}nav{display:flex;gap:20px;align-items:center}nav button{min-height:44px}";
let h = resolutionHarness(),
  ownerId = "owner",
  needsConsent = false,
  failDownload = false,
  delayDraft = 0;
let calls = { get: 0, update: 0, draft: 0, saveReport: 0, files: 0 };
Bun.serve({
  hostname: "127.0.0.1",
  port: Number(Bun.env.BARO_RESOLUTION_TEST_PORT ?? "4376"),
  async fetch(request) {
    const path = new URL(request.url).pathname
      .replace("/api/v2/cases/case/rework/resolution/draft", "/fixture/draft")
      .replace("/api/v2/cases/case/rework/resolution", "/fixture/resolution");
    if (path === "/fixture/control" && request.method === "POST") {
      const input = (await request.json()) as {
        reset?: boolean;
        purpose?: "prepare_claim" | "respond_to_claim";
        owner?: string;
        needsConsent?: boolean;
        failDownload?: boolean;
        delayDraft?: number;
        stale?: boolean;
      };
      if (input.reset) {
        h = resolutionHarness();
        ownerId = "owner";
        needsConsent = false;
        failDownload = false;
        delayDraft = 0;
        calls = { get: 0, update: 0, draft: 0, saveReport: 0, files: 0 };
      }
      if (input.purpose) {
        const source = resolutionSource();
        source.context.casePurpose = input.purpose;
        if (source.basis) source.basis.casePurpose = input.purpose;
        h = resolutionHarness(source);
      }
      if (input.owner) {
        ownerId = input.owner;
        h.setAccess(ownerId === "owner");
      }
      if (input.needsConsent !== undefined) {
        needsConsent = input.needsConsent;
        h.setConsent(!needsConsent);
      }
      if (input.failDownload !== undefined) failDownload = input.failDownload;
      if (input.delayDraft !== undefined) delayDraft = input.delayDraft;
      if (input.stale && h.source.basis)
        h.source = {
          ...h.source,
          basis: { ...h.source.basis, researchRevision: h.source.basis.researchRevision + 1 },
        };
      return Response.json({ ok: true });
    }
    if (path === "/fixture/counts") return Response.json(calls);
    if (path === "/fixture/session") return Response.json({ ownerId, needsConsent });
    try {
      if (path === "/fixture/files") {
        calls.files++;
        return Response.json(h.source.files.map(({ id, name }) => ({ id, name })));
      }
      if (path === "/fixture/report")
        return Response.json({
          id: "report",
          revision: 1,
          stale: false,
          excludedFileIds: ["excluded-file"],
          maskIdentifiers: true,
        });
      if (path === "/fixture/save-report") {
        calls.saveReport++;
        if (failDownload) return Response.json({ code: "STORAGE_UNAVAILABLE" }, { status: 503 });
        return Response.json(null);
      }
      if (path === "/fixture/resolution" || path === "/fixture/draft") {
        if (request.headers.get("x-fixture-owner") !== ownerId)
          throw Object.assign(new Error("owner changed"), { code: "NOT_FOUND" });
        if (path === "/fixture/draft") {
          calls.draft++;
          if (delayDraft) await Bun.sleep(delayDraft);
          return Response.json(await h.service.prepareDraft(ownerId, "case", await request.json()));
        }
        if (request.method === "PATCH") {
          calls.update++;
          return Response.json(await h.service.update(ownerId, "case", await request.json()));
        }
        calls.get++;
        return Response.json(await h.service.get(ownerId, "case"));
      }
    } catch (error) {
      return Response.json(
        { code: (error as { code?: string }).code ?? "VALIDATION_ERROR" },
        { status: 409 },
      );
    }
    if (path === "/app.js")
      return new Response(script, { headers: { "content-type": "text/javascript" } });
    if (path === "/app.css") return new Response(css, { headers: { "content-type": "text/css" } });
    if (path === "/fonts/PretendardVariable.woff2")
      return new Response(Bun.file(`${root}/public/fonts/PretendardVariable.woff2`));
    return new Response(
      '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BARO 합성 후속 해결 검증</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
      {
        headers: {
          "content-type": "text/html;charset=utf-8",
          "content-security-policy":
            "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'",
        },
      },
    );
  },
});
console.log("Synthetic resolution component/service harness ready");
