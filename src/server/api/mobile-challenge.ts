import { Hono } from "hono";
import {
  MOBILE_CHALLENGE_ACTION,
  mobileChallengeQuerySchema,
} from "../../contracts/mobile-challenge";
import { type ApiEnvironment, errorBody } from "./errors";

function challengeHTML(attemptId: string, siteKey: string, nonce: string) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>보안 확인 — BARO</title>
<style nonce="${nonce}">body{margin:0;padding:16px;font:16px/1.6 system-ui,sans-serif;color:#172033;background:#fff}main{display:flex;flex-direction:column;align-items:center;gap:16px}p{margin:0;text-align:center}#status{max-width:320px}</style></head><body><main><p id="status" role="status">사건을 저장하기 전에 보안 확인을 완료해 주세요.</p><div id="widget"></div></main>
<script nonce="${nonce}">
(() => {
  "use strict";
  const attemptId = ${JSON.stringify(attemptId)};
  let secret, pending, finished = false;
  function send(type, value) {
    if (finished) return;
    if (!secret) { pending = {type, value}; return; }
    const message = {type, attemptId, secret};
    if (type === "token") message.token = value; else message.reason = value;
    window.ReactNativeWebView?.postMessage(JSON.stringify(message));
    finished = true; pending = undefined;
  }
  Object.defineProperty(window, "__baroChallengeConnect", {value(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value) || (secret && secret !== value)) return;
    secret = value;
    if (pending) send(pending.type, pending.value);
  }});
  const failed = (reason) => {
    document.getElementById("status").textContent = "보안 확인이 끝나지 않았어요. 앱에서 다시 시도해 주세요.";
    send("error", reason);
  };
  window.ReactNativeWebView?.postMessage(JSON.stringify({type:"ready", attemptId}));
  const script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.nonce = document.currentScript.nonce;
  script.async = true;
  script.onerror = () => failed("unavailable");
  script.onload = () => {
    try {
      window.turnstile.render(document.getElementById("widget"), {
        sitekey:${JSON.stringify(siteKey)}, action:${JSON.stringify(MOBILE_CHALLENGE_ACTION)},
        size:matchMedia("(max-width:384px)").matches?"compact":"normal",
        callback:token => send("token", token),
        "error-callback":() => failed("failed"), "expired-callback":() => failed("expired")
      });
    } catch { failed("unavailable"); }
  };
  document.head.append(script);
})();
</script></body></html>`;
}

/** Public proof UI only. No auth/session, fact input, supplied script or native secret is rendered. */
export function createMobileChallengeApi(options: { siteKey?: string | undefined }) {
  return new Hono<ApiEnvironment>().get("/challenge", (c) => {
    c.header("cache-control", "private, no-store");
    c.header("x-content-type-options", "nosniff");
    c.header("referrer-policy", "strict-origin-when-cross-origin");
    c.header("x-frame-options", "DENY");
    const query = Object.fromEntries(new URL(c.req.url).searchParams);
    const parsed = mobileChallengeQuerySchema.safeParse(query);
    if (!parsed.success || new URL(c.req.url).searchParams.getAll("attemptId").length !== 1)
      return c.json(errorBody(c, "VALIDATION_ERROR", "보안 확인을 다시 시작해 주세요."), 400);
    if (!options.siteKey || !/^[A-Za-z0-9_-]{1,256}$/.test(options.siteKey))
      return c.json(
        errorBody(c, "DEPENDENCY_UNAVAILABLE", "보안 확인 설정을 준비하고 있어요.", true),
        503,
      );
    const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))));
    c.header(
      "content-security-policy",
      [
        "default-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        `script-src 'nonce-${nonce}' https://challenges.cloudflare.com`,
        `style-src 'nonce-${nonce}'`,
        "frame-src 'self' https://challenges.cloudflare.com about:",
        "connect-src 'self' https://challenges.cloudflare.com",
        "img-src 'self' data: https://challenges.cloudflare.com",
      ].join("; "),
    );
    return c.html(challengeHTML(parsed.data.attemptId, options.siteKey, nonce));
  });
}
