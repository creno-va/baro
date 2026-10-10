import { maskReportText } from "./download";

export type ReportDocument = {
  title: string;
  content: string;
  revision: number;
  updatedAt: string;
  stale: boolean;
  maskIdentifiers: boolean;
  excludedFileIds: readonly string[];
  basis?: { workspaceRevision: number; summaryRevision: number; generatedAt: string } | undefined;
};
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
const headings = new Set([
  "사건 요약",
  "사건의 사실과 주장",
  "당사자",
  "사실·주장·출처",
  "미확인 사항",
  "미확인·상반되는 내용",
  "타임라인",
  "공식 출처",
  "준비할 행동",
  "자료 처리 범위",
  "준비할 자료와 처리 범위",
  "연락과 전달",
  "안내",
]);
function sections(content: string) {
  const result: { title: string; lines: string[] }[] = [];
  let current = { title: "검토한 내용", lines: [] as string[] };
  for (const line of content.split(/\r?\n/)) {
    if (headings.has(line.trim())) {
      if (headings.has(current.title) || current.lines.some((value) => value.trim()))
        result.push(current);
      current = { title: line.trim(), lines: [] };
    } else current.lines.push(line);
  }
  if (headings.has(current.title) || current.lines.some((value) => value.trim()))
    result.push(current);
  return result;
}
const documentCss = `
.baro-report{color-scheme:light;--doc-ink:#202838;--doc-muted:#626d80;--doc-line:#e6eaf0;--doc-paper:#fff;--doc-accent:#226cdb;font-family:"Pretendard Variable",-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Segoe UI",sans-serif;font-size:15px;line-height:1.8;color:var(--doc-ink);background:#f4f6f9;padding:32px 24px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.baro-report *{box-sizing:border-box}.baro-report .sheet{max-width:980px;margin:0 auto;background:#fff;border:1px solid var(--doc-line);border-radius:20px;overflow:hidden}.baro-report .masthead{display:flex;align-items:center;justify-content:space-between;padding:24px 40px;border-bottom:1px solid var(--doc-line);gap:20px}.baro-report .brand{display:flex;align-items:center;gap:10px;font-size:22px;font-weight:750;letter-spacing:.085em;line-height:1;min-height:36px}.baro-report .brand img{display:block;width:31px;height:36px}.baro-report .masthead-note{font-size:12px;color:var(--doc-muted)}.baro-report .hero{padding:36px 40px 28px}.baro-report .eyebrow{font-size:12px;color:var(--doc-accent);font-weight:650;margin:0 0 12px}.baro-report .hero h1{font-size:clamp(28px,3vw,36px);font-weight:750;letter-spacing:-.035em;line-height:1.35;margin:0;text-wrap:balance;overflow-wrap:anywhere}.baro-report .hero-subtitle{color:var(--doc-muted);margin:12px 0 22px;font-size:14px}.baro-report .tags{display:flex;gap:8px;flex-wrap:wrap}.baro-report .tag{font-size:11px;padding:5px 10px;border-radius:8px;background:#f4f6f9;color:var(--doc-muted)}.baro-report .tag.dark{background:#edf4ff;color:#2463b9;font-weight:650}.baro-report .tag.warm{background:#fff6e7;color:#854d0e}.baro-report .layout{display:grid;grid-template-columns:minmax(0,1fr) 190px;padding:0 40px 36px;gap:32px}.baro-report .content{min-width:0}.baro-report .section{padding:26px 0;border-top:1px solid var(--doc-line);break-inside:avoid}.baro-report .section-head{display:flex;align-items:center;gap:10px;margin-bottom:15px}.baro-report .number{display:inline-flex;justify-content:center;align-items:center;min-width:26px;height:26px;border-radius:8px;font-size:11px;font-weight:650;background:#edf4ff;color:#2463b9}.baro-report h2{font-size:18px;line-height:1.5;letter-spacing:-.025em;margin:0;font-weight:700}.baro-report .lines p{margin:0 0 12px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.85}.baro-report .lines p:last-child{margin-bottom:0}.baro-report .lines .detail{font-size:12px;color:var(--doc-muted);line-height:1.7}.baro-report .section:first-child .lines{background:#f5f8fe;padding:18px 20px;border-radius:12px}.baro-report .section.caution .lines{background:#f4f6f9;padding:17px 19px;border-radius:12px}.baro-report .section.timeline .lines{border-left:2px solid #dce8fc;margin-left:5px;padding-left:18px}.baro-report .section.timeline .lines p{position:relative}.baro-report .section.timeline .lines p:before{content:"";position:absolute;left:-23px;top:.7em;width:8px;height:8px;border-radius:50%;background:var(--doc-accent);border:2px solid #fff}.baro-report .sidebar{padding-top:26px;border-top:1px solid var(--doc-line)}.baro-report .sidebar h2{font-size:13px;margin-bottom:18px}.baro-report .meta{margin:0 0 24px}.baro-report .meta div{margin-bottom:16px}.baro-report .meta dt{font-size:11px;color:var(--doc-muted);margin-bottom:3px}.baro-report .meta dd{margin:0;font-size:12px;font-weight:600;overflow-wrap:anywhere}.baro-report .aside-note{font-size:12px;padding-top:18px;border-top:1px solid var(--doc-line);color:var(--doc-muted);line-height:1.8}.baro-report .aside-note strong{display:block;color:var(--doc-ink);margin-bottom:6px;font-size:12px}.baro-report .stale{margin:0 40px 24px;background:#fff6e7;border-radius:10px;padding:14px 17px;font-size:13px;color:#854d0e}.baro-report .footer{border-top:1px solid var(--doc-line);padding:22px 40px;display:flex;justify-content:space-between;gap:24px;color:var(--doc-muted);font-size:11px}.baro-report .footer p{margin:0;max-width:600px;line-height:1.8}.baro-report .footer strong{font-weight:650;color:var(--doc-ink)}
@media(max-width:760px){.baro-report{padding:0;background:#fff;font-size:14px}.baro-report .sheet{border:0;border-radius:0}.baro-report .masthead{padding:22px 24px}.baro-report .masthead-note{font-size:11px}.baro-report .hero{padding:28px 24px 26px}.baro-report .hero h1{font-size:28px}.baro-report .layout{display:flex;flex-direction:column;padding:0 24px 28px;gap:0}.baro-report .sidebar{margin-top:8px}.baro-report .meta{display:grid;grid-template-columns:1fr 1fr;gap:0 20px;margin-bottom:8px}.baro-report .section{padding:23px 0}.baro-report .stale{margin:0 24px 24px}.baro-report .footer{padding:22px 24px;display:block}.baro-report .footer p+p{margin-top:12px}}
@media print{.baro-report{background:white;padding:0;font-size:10pt}.baro-report .sheet{max-width:none;border:0;border-radius:0}.baro-report .masthead{padding:0 0 15px}.baro-report .hero{padding:24px 0}.baro-report .hero h1{font-size:25pt}.baro-report .hero-subtitle{font-size:10pt}.baro-report .layout{display:block;padding:0}.baro-report .section{padding:20px 0;break-inside:auto}.baro-report .section-head{break-after:avoid}.baro-report h2{font-size:14pt}.baro-report .lines{orphans:3;widows:3}.baro-report .sidebar{display:none}.baro-report .stale{margin:0 0 20px}.baro-report .footer{padding:16px 0;font-size:8pt}.baro-report .tag{font-size:8pt}}
`;

const embeddedLogo =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJibHVlIiB4MT0iOCIgeTE9IjQiIHgyPSI1NiIgeTI9IjYwIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHN0b3Agc3RvcC1jb2xvcj0iIzUxYjFmZiIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzI4NjRmZiIvPjwvbGluZWFyR3JhZGllbnQ+PC9kZWZzPjxnIGZpbGw9InVybCgjYmx1ZSkiPjxwYXRoIGQ9Ik0yNC41IDMuOEMyOCAxLjkgMzEgNCAzMSA4djQ4YzAgNC0zIDYuMS02LjUgNC4yTDEyLjcgNTRDOC41IDUxLjggNyA0OSA3IDQ0LjV2LTI1QzcgMTUgOC41IDEyLjIgMTIuNyAxMEwyNC41IDMuOFoiLz48cGF0aCBkPSJNMzkgMTJoOGM4LjMgMCAxNSA1LjEgMTUgMTEuNVM1NS4zIDM1IDQ3IDM1aC04YTMgMyAwIDAgMS0zLTNWMTVhMyAzIDAgMCAxIDMtM1oiLz48cGF0aCBkPSJNMzkgMzhoOGM4LjMgMCAxNSA1LjEgMTUgMTEuNVM1NS4zIDYxIDQ3IDYxaC04YTMgMyAwIDAgMS0zLTNWNDFhMyAzIDAgMCAxIDMtM1oiLz48L2c+PC9zdmc+Cg==";

/** Every user-derived string is escaped; only the trusted local brand image is embedded. */
export function createReportMarkup(report: ReportDocument, embedded = false) {
  const title = report.maskIdentifiers ? maskReportText(report.title) : report.title;
  const content = report.maskIdentifiers ? maskReportText(report.content) : report.content;
  const generatedAt = report.basis?.generatedAt ?? report.updatedAt;
  const date = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(generatedAt)
    ? `${generatedAt.slice(0, 10).replaceAll("-", ".")} · ${generatedAt.slice(11, 16)} UTC`
    : generatedAt;
  const body = sections(content)
    .map((section, index) => {
      const kind = section.title.includes("미확인")
        ? " caution"
        : section.title === "타임라인"
          ? " timeline"
          : "";
      const lines = section.lines
        .filter((line) => line.trim())
        .map(
          (line) =>
            `<p${/^\[|^(출처|주의|작성 시각|검증 시각):/.test(line) ? ' class="detail"' : ""}>${escapeHtml(line)}</p>`,
        )
        .join("");
      return `<section class="section${kind}"><div class="section-head"><span class="number">${String(index + 1).padStart(2, "0")}</span><h2>${escapeHtml(section.title)}</h2></div><div class="lines">${lines}</div></section>`;
    })
    .join("");
  return `<div class="baro-report"><article class="sheet"><header class="masthead"><div class="brand"><img src="${embedded ? embeddedLogo : "/brand/logo.svg"}" alt="바로 로고" width="31" height="36"><span>BARO</span></div><div class="masthead-note">사건 상담 준비 리포트</div></header><div class="hero"><p class="eyebrow">사건 상담 준비 · 검토본 ${report.revision}</p><h1>${escapeHtml(title)}</h1><p class="hero-subtitle">확인한 사실과 자료, 앞으로 준비할 내용을 한곳에 정리했어요.</p><div class="tags"><span class="tag dark">리포트 ${report.revision}</span><span class="tag">${escapeHtml(date)}</span><span class="tag">${report.maskIdentifiers ? "식별정보 자동 가림 적용" : "식별정보 검토 필요"}</span>${report.stale ? '<span class="tag warm">이전 생성 기준</span>' : ""}</div></div>${report.stale ? '<p class="stale">사건이나 자료가 변경되었습니다. 이 문서는 아래 생성 기준의 저장된 리포트이며, 최신 내용은 새 버전에서 확인하세요.</p>' : ""}<div class="layout"><div class="content">${body}</div><aside class="sidebar"><h2>생성 기준</h2><dl class="meta"><div><dt>리포트 버전</dt><dd>${report.revision}</dd></div>${report.basis ? `<div><dt>요약 · 사건 버전</dt><dd>${report.basis.summaryRevision} · ${report.basis.workspaceRevision}</dd></div>` : ""}<div><dt>작성 시각</dt><dd>${escapeHtml(date)}</dd></div><div><dt>리포트 제외 자료</dt><dd>${report.excludedFileIds.length}개</dd></div></dl><p class="aside-note"><strong>전달 전 확인해 주세요</strong>내용과 출처, 미확인 사항을 원본과 비교해 주세요. 자동 가림 외에 남아 있는 식별정보도 직접 확인해야 합니다.</p><p class="aside-note"><strong>자료 관찰과 사실은 다릅니다</strong>교정한 내용과 AI의 정리는 원본의 진정성이나 법적 효력을 증명하지 않습니다.</p></aside></div><footer class="footer"><p><strong>상담을 준비하는 자료입니다.</strong><br>법률 판단과 사건의 결과를 보장하지 않습니다. 전달할 내용과 상대는 사용자가 직접 결정합니다.</p><p>BARO · 검토본 ${report.revision}</p></footer></article></div>`;
}

export function createReportHtml(report: ReportDocument) {
  const title = report.maskIdentifiers ? maskReportText(report.title) : report.title;
  return `<!doctype html>
<html lang="ko" data-baro-report="1"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)} · BARO</title><style>body{margin:0} @page{size:A4;margin:16mm}${documentCss}</style></head><body><main>${createReportMarkup(report, true)}</main></body></html>`;
}
