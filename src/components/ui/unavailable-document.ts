import { designTokens } from "../../../packages/design-tokens/src";

const { color, control } = designTokens;

// This isolated guard response cannot depend on an Astro render or a stylesheet request.
// Shared colors/target size stay canonical; the fixed document has no user/private inputs.
const styles = `
*{box-sizing:border-box}
body{margin:0;min-width:0;min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:${color.text};background:${color.surface};font-size:16px;line-height:1.8}
.unavailable-brand,main{width:min(48rem,calc(100% - 32px));margin-inline:auto}
.unavailable-brand{padding-block:20px;border-bottom:1px solid ${color.border};font-size:18px;font-weight:750;letter-spacing:.02em}
main{padding-block:40px}
h1{margin:0 0 16px;font-size:clamp(24px,3vw,28px);line-height:1.5;letter-spacing:-.025em;word-break:keep-all;overflow-wrap:anywhere}
p{margin:0 0 24px;color:${color.muted}}
.unavailable-actions{display:flex;flex-wrap:wrap;gap:12px}
.unavailable-actions a{display:inline-flex;align-items:center;justify-content:center;min-width:${control.minimumSize}px;min-height:${control.minimumSize}px;max-width:100%;padding:10px 16px;border:1px solid ${color.input};border-radius:8px;color:${color.text};background:${color.surface};font-size:15px;font-weight:600;line-height:1.5;text-decoration:none;word-break:keep-all;overflow-wrap:anywhere}
.unavailable-actions .unavailable-primary{background:${color.primary};border-color:${color.primary};color:${color.onPrimary}}
a:hover{text-decoration:underline;text-underline-offset:4px}
a:focus-visible{outline:3px solid ${color.focus};outline-offset:3px}
.unavailable-skip{position:absolute;top:-100px;left:16px;padding:10px 16px;min-height:${control.minimumSize}px;background:${color.surface};color:${color.text}}
.unavailable-skip:focus{top:8px}
`;

/** Presentation only. The caller retains status, retry-after, cache and security headers. */
export function renderUnavailableDocument(betaClosed = false): string {
  const title = betaClosed ? "공개 베타를 준비하고 있어요." : "로그인 상태를 확인할 수 없어요.";
  return `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><title>잠시 후 다시 시도해 주세요 — BARO</title><style>${styles}</style></head><body><a class="unavailable-skip" href="#main-content">본문으로 건너뛰기</a><header class="unavailable-brand">BARO</header><main id="main-content" tabindex="-1"><h1>${title}</h1><p>잠시 후 다시 시도해 주세요.</p><nav class="unavailable-actions" aria-label="복구와 이동"><a class="unavailable-primary" href="/new">다시 시도하기</a><a href="/">서비스 소개로 돌아가기</a></nav></main></body></html>`;
}
