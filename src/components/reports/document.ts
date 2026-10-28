import { reportSections } from "../../utils/report-sections";
import { maskReportText } from "./download";

export type ReportDocument = {
  photos?:
    | { id: string; name: string; revision: number; dataUrl: string; notes?: string[] }[]
    | undefined;
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
const documentCss = `
.baro-report{color-scheme:light;font-family:"Pretendard Variable",-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Segoe UI",sans-serif;color:#253348;background:#f4f6f9;font-size:14px;line-height:1.85;padding:32px 24px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.baro-report *{box-sizing:border-box}.baro-report .sheet{max-width:860px;margin:0 auto;background:#fff;border:1px solid #dce3ed;border-radius:8px;overflow:hidden}.baro-report .masthead{display:flex;align-items:center;justify-content:space-between;gap:20px;margin:0 44px;padding:28px 0 20px;border-bottom:2px solid #2463b9}.baro-report .brand{display:flex;gap:10px;align-items:center;font-size:20px;font-weight:750;letter-spacing:.04em;color:#1d3556}.baro-report .brand img{width:25px;height:29px}.baro-report .masthead-note{color:#59687c;font-size:11px}.baro-report .hero{padding:32px 44px 28px}.baro-report .eyebrow{color:#2463b9;font-size:11px;font-weight:650;margin:0 0 12px}.baro-report .hero h1{font-size:32px;line-height:1.4;letter-spacing:-.04em;font-weight:750;margin:0;overflow-wrap:anywhere}.baro-report .hero-subtitle{font-size:13px;color:#59687c;margin:12px 0 20px}.baro-report .tags{display:flex;gap:8px;flex-wrap:wrap}.baro-report .tag{font-size:10px;border:1px solid #e2e7ef;color:#526178;padding:4px 8px;border-radius:4px}.baro-report .tag.dark{border-color:#bfd3f1;color:#2463b9}.baro-report .tag.warm{background:#fff6e7;color:#854d0e}.baro-report .layout{display:block;padding:0 44px 32px}.baro-report .content{min-width:0}.baro-report .section{padding:24px 0;border-top:1px solid #dce3ed;break-inside:auto}.baro-report .section-head{display:flex;gap:12px;align-items:baseline;margin-bottom:14px;break-after:avoid}.baro-report .number{color:#2463b9;font-size:11px;font-weight:650;min-width:20px}.baro-report h2{font-size:17px;line-height:1.6;margin:0;color:#1e304a;font-weight:700}.baro-report .lines p{margin:0 0 12px;white-space:pre-wrap;overflow-wrap:anywhere;orphans:3;widows:3}.baro-report .lines p:last-child{margin-bottom:0}.baro-report .lines .detail{font-size:11px;line-height:1.7;color:#59687c}.baro-report .section.caution .lines{background:#f5f7fa;border-left:2px solid #bac7d9;padding:14px 16px}.baro-report .section.timeline .lines{border-left:1px solid #bfd3f1;padding-left:16px}.baro-report .sidebar{padding-top:24px;border-top:1px solid #dce3ed}.baro-report .sidebar h2{font-size:13px;margin-bottom:16px}.baro-report .meta{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin:0 0 20px}.baro-report .meta dt{font-size:10px;color:#59687c;margin-bottom:4px}.baro-report .meta dd{margin:0;font-size:11px;overflow-wrap:anywhere}.baro-report .aside-note{font-size:11px;color:#59687c;margin:8px 0}.baro-report .aside-note strong{color:#30445f;margin-right:8px}.baro-report .stale{margin:0 44px 24px;padding:12px 16px;background:#fff6e7;color:#854d0e;font-size:12px;border-left:2px solid #c99536}.baro-report .footer{border-top:1px solid #dce3ed;padding:20px 44px;display:flex;gap:24px;justify-content:space-between;color:#59687c;font-size:10px}.baro-report .footer p{margin:0;line-height:1.8}.baro-report .footer strong{color:#30445f}.baro-report .photo-section{padding:0 44px 28px}.baro-report .photo-section>p{font-size:12px;color:#59687c}.baro-report .evidence-photo{margin:20px 0;padding:12px;border:1px solid #dce3ed;break-inside:avoid}.baro-report .evidence-photo img{display:block;max-width:100%;max-height:180mm;object-fit:contain;margin:auto}.baro-report .evidence-photo figcaption{font-size:11px;color:#59687c;margin-top:12px}
@media(max-width:640px){.baro-report{padding:0;background:#fff}.baro-report .sheet{border:0;border-radius:0}.baro-report .masthead{margin-inline:24px;padding-top:24px}.baro-report .hero{padding:24px}.baro-report .hero h1{font-size:26px}.baro-report .layout{padding:0 24px 24px}.baro-report .meta{grid-template-columns:repeat(2,minmax(0,1fr))}.baro-report .footer{padding:20px 24px;display:block}.baro-report .footer p+p{margin-top:12px}.baro-report .stale{margin-inline:24px}.baro-report .photo-section{padding-inline:24px}}
@media print{.baro-report{width:100%;max-width:178mm;padding:0;background:#fff;font-size:10pt}.baro-report .sheet{border:0;max-width:none;overflow:visible}.baro-report .masthead{margin:0;padding:0 0 14px}.baro-report .hero{padding:24px 0}.baro-report .hero h1{font-size:24pt}.baro-report .hero-subtitle{font-size:10pt}.baro-report .layout{padding:0}.baro-report .section{padding:18px 0}.baro-report h2{font-size:13pt}.baro-report .content,.baro-report .section,.baro-report .lines{max-width:178mm}.baro-report .sidebar{display:block;break-inside:avoid;padding-top:16px}.baro-report .meta{grid-template-columns:repeat(2,minmax(0,1fr))}.baro-report .footer{padding:14px 0;font-size:8pt}.baro-report .stale{margin:0 0 20px}.baro-report .photo-section{padding:0}.baro-report .tag{font-size:8pt}}
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
  const body = reportSections(content)
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
  const photos = report.maskIdentifiers
    ? []
    : (report.photos ?? []).filter((photo) => !report.excludedFileIds.includes(photo.id));
  const photoMarkup = photos
    .map((photo, index) => {
      if (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo.dataUrl)) return "";
      return `<figure class="evidence-photo" data-file-revision="${escapeHtml(String(photo.revision))}"><img src="${photo.dataUrl}" alt="선택 근거 사진 ${index + 1}"/><figcaption><strong>근거 사진 ${index + 1} · ${escapeHtml(photo.name)}</strong><br>${(photo.notes ?? []).map((note) => escapeHtml(note)).join("<br>")}<br>리포트용 사진 사본 · 사실 여부는 원본과 대조해 주세요.</figcaption></figure>`;
    })
    .join("");
  const photoSection = photoMarkup
    ? `<section class="photo-section"><h2>선택한 근거 사진</h2><p>직접 선택한 사진과 관련 내용을 함께 표시합니다. 문서 기재나 사진의 모습만으로 원인·촬영 시점·의학적 판단·진정성을 확인할 수 없습니다.</p>${photoMarkup}</section>`
    : "";
  return `<div class="baro-report"><article class="sheet"><header class="masthead"><div class="brand"><img src="${embedded ? embeddedLogo : "/brand/logo.svg"}" alt="바로 로고" width="31" height="36"><span>BARO</span></div><div class="masthead-note">사건 상담 준비 리포트</div></header><div class="hero"><p class="eyebrow">사건 상담 준비 · 검토본 ${report.revision}</p><h1>${escapeHtml(title)}</h1><p class="hero-subtitle">확인한 사실과 자료, 앞으로 준비할 내용을 한곳에 정리했어요.</p><div class="tags"><span class="tag dark">리포트 ${report.revision}</span><span class="tag">${escapeHtml(date)}</span><span class="tag">${report.maskIdentifiers ? "식별정보 자동 가림 적용" : "식별정보 검토 필요"}</span>${report.stale ? '<span class="tag warm">이전 생성 기준</span>' : ""}</div></div>${report.stale ? '<p class="stale">사건·자료 또는 공식 출처의 확인 상태가 바뀌었습니다. 이 문서는 아래 생성 기준의 저장된 리포트이며, 최신 내용은 새 버전에서 확인하세요.</p>' : ""}<div class="layout"><div class="content">${body}</div><aside class="sidebar"><h2>생성 기준</h2><dl class="meta"><div><dt>리포트 버전</dt><dd>${report.revision}</dd></div>${report.basis ? `<div><dt>요약 · 사건 버전</dt><dd>${report.basis.summaryRevision} · ${report.basis.workspaceRevision}</dd></div>` : ""}<div><dt>작성 시각</dt><dd>${escapeHtml(date)}</dd></div><div><dt>리포트 제외 자료</dt><dd>${report.excludedFileIds.length}개</dd></div></dl><p class="aside-note"><strong>전달 전 확인해 주세요</strong>내용과 출처, 미확인 사항을 원본과 비교해 주세요. 자동 가림 외에 남아 있는 식별정보도 직접 확인해야 합니다.</p><p class="aside-note"><strong>자료 관찰과 사실은 다릅니다</strong>교정한 내용과 AI의 정리는 원본의 진정성이나 법적 효력을 증명하지 않습니다.</p></aside></div>${photoSection}<footer class="footer"><p><strong>상담을 준비하는 자료입니다.</strong><br>법률 판단과 사건의 결과를 보장하지 않습니다. 전달할 내용과 상대는 사용자가 직접 결정합니다.</p><p>BARO · 검토본 ${report.revision}</p></footer></article></div>`;
}

export function createReportHtml(report: ReportDocument, fontDataUrl?: string) {
  const title = report.maskIdentifiers ? maskReportText(report.title) : report.title;
  return `<!doctype html>
<html lang="ko" data-baro-report="1"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)} · BARO</title><style>${fontDataUrl && /^data:font\/ttf;base64,[A-Za-z0-9+/=]+$/.test(fontDataUrl) ? `@font-face{font-family:BaroReport;src:url("${fontDataUrl}")} .baro-report{font-family:BaroReport,sans-serif!important}` : ""} body{margin:0} @page{size:A4;margin:16mm}${documentCss}</style></head><body><main>${createReportMarkup(report, true)}</main></body></html>`;
}
