/** Standalone synthetic HTTP harness; never imported by Astro or production API. */
import { resolve } from "node:path";
import {
  analysisStatusResponseSchema,
  answersForQuestionsSchema,
  caseDetailResponseSchema,
  feedbackRequestSchema,
  retryRequestSchema,
} from "../../src/contracts";
import {
  analysisId,
  caseId,
  guidance,
  outOfScope,
  questions,
  urgentRedirect,
} from "../fixtures/contracts";
import { compileProductStyles } from "./product-styles";

const root = resolve(import.meta.dir, "../..");
const identities = Array.from({ length: 6 }, (_, index) => caseId.slice(0, -1) + index);
const completed = new Set<string>();
const receipts = new Map<string, string>();
function detail(identity: string) {
  const index = identities.indexOf(identity);
  const done = completed.has(identity) || index === 0;
  return caseDetailResponseSchema.parse({
    caseId: identity,
    analysisId,
    title: "이전 버전 합성 사건 · 반환 약속과 확인할 자료",
    status: done
      ? "completed"
      : [
          "completed",
          "needs_clarification",
          "failed",
          "out_of_scope",
          "urgent_redirect",
          "analyzing",
        ][index],
    inputRevision: 3,
    questions: index === 1 && !done ? questions : [],
    result: done ? guidance : index === 3 ? outOfScope : index === 4 ? urgentRedirect : null,
    error:
      index === 2 && !done
        ? {
            code: "LEGAL_SOURCE_UNAVAILABLE",
            message: "합성 원천 응답을 확인하지 못했습니다.",
            requestId: "synthetic-v1",
            retryable: true,
            details: {},
          }
        : null,
  });
}
for (const identity of identities) detail(identity);
const bundle = await Bun.build({
  entrypoints: [resolve(import.meta.dir, "product-legacy-case-entry.tsx")],
  target: "browser",
  define: { "import.meta.env.PUBLIC_API_MODE": '"real"' },
});
if (!bundle.success) throw new Error("SYNTHETIC_LEGACY_BUNDLE_FAILED");
const script = await bundle.outputs.find((file) => file.kind === "entry-point")?.text();
if (!script) throw new Error("SYNTHETIC_LEGACY_ENTRY_MISSING");
const css = await compileProductStyles(root);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(Bun.env.BARO_LEGACY_TEST_PORT ?? 4380),
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/app.js")
      return new Response(`globalThis.__zod_globalConfig={jitless:true};\n${script}`, {
        headers: { "content-type": "text/javascript" },
      });
    if (request.method === "GET" && path === "/app.css")
      return new Response(css, { headers: { "content-type": "text/css" } });
    if (request.method === "GET" && path === "/fonts/PretendardVariable.woff2")
      return new Response(Bun.file(resolve(root, "public/fonts/PretendardVariable.woff2")));
    if (request.method === "GET" && path === "/")
      return new Response(
        '<!doctype html><html lang="ko" data-baro-ui data-product-chrome="v2" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BARO 합성 v1 검증</title><link rel="stylesheet" href="/app.css"></head><body><main id="root"></main><script type="module" src="/app.js"></script></body></html>',
        {
          headers: {
            "content-type": "text/html;charset=utf-8",
            "content-security-policy":
              "default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'",
          },
        },
      );
    const match = /^\/api\/cases\/([^/]+)(?:\/(analysis|answers|retry|feedback))?$/.exec(path);
    const identity = match?.[1];
    if (!identity || !identities.includes(identity)) return new Response(null, { status: 404 });
    const action = match?.[2];
    if (request.method === "GET" && !action) return Response.json(detail(identity));
    if (request.method === "GET" && action === "analysis")
      return Response.json(
        analysisStatusResponseSchema.parse({
          caseId: identity,
          analysisId,
          inputRevision: 3,
          status:
            detail(identity).status === "needs_clarification"
              ? "waiting_for_answers"
              : "retrieving",
          updatedAt: new Date().toISOString(),
          retryable: false,
          retryAttemptsRemaining: 0,
          error: null,
        }),
      );
    if (request.method === "PUT" && action === "feedback") {
      const body = feedbackRequestSchema.safeParse(await request.json().catch(() => null));
      return body.success
        ? Response.json({ synthetic: true })
        : new Response(null, { status: 400 });
    }
    if (request.method === "POST" && (action === "answers" || action === "retry")) {
      const body: unknown = await request.json().catch(() => null);
      const parsed =
        action === "answers"
          ? answersForQuestionsSchema(questions).safeParse(body)
          : retryRequestSchema.safeParse(body);
      const key = request.headers.get("idempotency-key");
      if (!parsed.success || !key) return new Response(null, { status: 400 });
      const signature = `${identity}:${action}:${key}`;
      const fingerprint = JSON.stringify(parsed.data);
      if (receipts.has(signature) && receipts.get(signature) !== fingerprint)
        return new Response(null, { status: 409 });
      receipts.set(signature, fingerprint);
      completed.add(identity);
      return Response.json({ synthetic: true });
    }
    return new Response(null, { status: 405 });
  },
});
console.log(`Synthetic legacy harness: ${server.url.origin}`);
