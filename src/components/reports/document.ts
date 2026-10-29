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
.baro-report {
  color-scheme: light;
  font-family: "Pretendard Variable", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Segoe UI", sans-serif;
  color: #253348;
  background: #f4f6f9;
  font-size: 14px;
  line-height: 1.85;
  padding: 32px 24px;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.baro-report * { box-sizing: border-box; }
.baro-report .sheet { max-width: 860px; margin: 0 auto; padding: 0 44px; background: #fff; }
.baro-report .masthead { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 28px 0 20px; border-bottom: 1px solid #dce3ed; }
.baro-report .brand { font-size: 18px; font-weight: 750; letter-spacing: .03em; color: #1d3556; white-space: nowrap; }
.baro-report .brand img { display: inline-block; vertical-align: middle; width: 22px; height: 25px; margin-right: 8px; }
.baro-report .masthead-note { color: #59687c; font-size: 11px; }
.baro-report .hero { padding: 28px 0; }
.baro-report .eyebrow { color: #2463b9; font-size: 11px; font-weight: 650; margin: 0 0 10px; }
.baro-report .hero h1 { font-size: 30px; line-height: 1.45; letter-spacing: -.035em; font-weight: 750; margin: 0; overflow-wrap: anywhere; }
.baro-report .hero-subtitle { font-size: 13px; color: #59687c; margin: 12px 0 18px; }
.baro-report .tags { line-height: 1.8; }
.baro-report .tag { display: inline-block; margin-right: 16px; font-size: 10px; color: #59687c; }
.baro-report .tag.dark { color: #2463b9; }
.baro-report .layout { padding-bottom: 24px; }
.baro-report .content { min-width: 0; }
.baro-report .section { padding: 22px 0; border-top: 1px solid #dce3ed; }
.baro-report .section-head { display: flex; align-items: center; margin-bottom: 14px; break-after: avoid; }
.baro-report .number { display: inline-block; flex: none; min-width: 28px; margin-right: 10px; padding: 2px 7px; border-radius: 6px; background: #edf3fe; color: #2463b9; font-size: 14px; font-weight: 650; text-align: center; line-height: 24px; }
.baro-report h2 { font-size: 17px; line-height: 1.65; margin: 0; color: #1e304a; font-weight: 700; }
.baro-report .lines p { margin: 0 0 10px; white-space: pre-wrap; overflow-wrap: anywhere; orphans: 3; widows: 3; }
.baro-report .lines p:last-child { margin-bottom: 0; }
.baro-report .lines .detail { font-size: 11px; line-height: 1.75; color: #59687c; }
.baro-report .sidebar { padding-top: 20px; border-top: 1px solid #dce3ed; }
.baro-report .sidebar h2 { font-size: 13px; margin-bottom: 14px; }
.baro-report .meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin: 0 0 16px; }
.baro-report .meta dt { font-size: 10px; color: #59687c; margin-bottom: 4px; }
.baro-report .meta dd { margin: 0; font-size: 11px; overflow-wrap: anywhere; }
.baro-report .aside-note { font-size: 11px; color: #59687c; margin: 6px 0; }
.baro-report .aside-note strong { color: #30445f; margin-right: 8px; }
.baro-report .stale { margin: 0 0 24px; padding: 12px 0; border-block: 1px solid #dce3ed; color: #59687c; font-size: 12px; }
.baro-report .footer { border-top: 1px solid #dce3ed; padding: 18px 0; display: flex; gap: 24px; justify-content: space-between; color: #59687c; font-size: 10px; }
.baro-report .footer p { margin: 0; line-height: 1.8; }
.baro-report .footer strong { color: #30445f; }
.baro-report .photo-section { padding-top: 24px; border-top: 1px solid #dce3ed; }
.baro-report .photo-section > p { margin: 8px 0 24px; font-size: 12px; color: #59687c; }
.baro-report .evidence-photo { margin: 0 0 32px; }
.baro-report .photo-heading { display: flex; align-items: baseline; margin-bottom: 14px; break-after: avoid; }
.baro-report .photo-heading span { flex: none; margin-right: 12px; color: #2463b9; font-size: 11px; font-weight: 650; }
.baro-report .photo-heading h3 { flex: 1; min-width: 0; margin: 0; font-size: 14px; line-height: 1.7; overflow-wrap: break-word; }
.baro-report .photo-frame { padding: 16px; background: #f5f7fa; border: 1px solid #e3e8f0; border-radius: 8px; break-inside: avoid; }
.baro-report .evidence-photo img { display: block; width: auto; height: auto; max-width: 100%; max-height: 150mm; object-fit: contain; margin: 0 auto; }
.baro-report .evidence-photo figcaption { margin-top: 14px; font-size: 11px; line-height: 1.8; color: #526178; overflow-wrap: anywhere; orphans: 2; widows: 2; }
.baro-report .evidence-photo figcaption p { margin: 0 0 6px; }
.baro-report .photo-copy-note { color: #6a7688; font-size: 10px; }
@media (max-width: 640px) {
  .baro-report { padding: 0; background: #fff; }
  .baro-report .sheet { padding-inline: 24px; }
  .baro-report .hero h1 { font-size: 26px; }
  .baro-report .meta { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .baro-report .footer { display: block; }
  .baro-report .footer p + p { margin-top: 10px; }
}
@media print {
  .baro-report { width: 100%; padding: 0; background: #fff; font-size: 10.5pt; }
  .baro-report .sheet { max-width: none; padding: 0; }
  .baro-report .masthead { padding: 0 0 14px; }
  .baro-report .hero { padding: 24px 0; }
  .baro-report .hero h1 { font-size: 23pt; }
  .baro-report .hero-subtitle { font-size: 10pt; }
  .baro-report .section { padding: 18px 0; }
  .baro-report .number { font-size: 11pt; line-height: 20px; min-width: 24px; }
  .baro-report h2 { font-size: 13pt; }
  .baro-report .sidebar { padding-top: 16px; }
  .baro-report .meta { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .baro-report .footer { font-size: 8pt; }
  .baro-report .photo-section { break-before: page; padding-top: 0; border-top: 0; }
  .baro-report .photo-section > h2 { break-after: avoid; }
  .baro-report .photo-section > p { break-after: avoid; margin-bottom: 20px; }
  .baro-report .evidence-photo + .evidence-photo { break-before: page; }
  .baro-report .photo-heading { break-after: avoid; }
  .baro-report .photo-frame { padding: 12px; }
  .baro-report .evidence-photo img { max-height: 145mm; }
}
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
      return `<section class="section${kind}"><div class="section-head"><span class="number">${index + 1}</span><h2>${escapeHtml(section.title)}</h2></div><div class="lines">${lines}</div></section>`;
    })
    .join("");
  const photos = report.maskIdentifiers
    ? []
    : (report.photos ?? []).filter((photo) => !report.excludedFileIds.includes(photo.id));
  const photoMarkup = photos
    .map((photo, index) => {
      if (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo.dataUrl)) return "";
      return `<figure class="evidence-photo" data-file-revision="${escapeHtml(String(photo.revision))}"><header class="photo-heading"><span>근거 사진 ${index + 1}</span><h3>${escapeHtml(photo.name)}</h3></header><div class="photo-frame"><img src="${photo.dataUrl}" alt="선택 근거 사진 ${index + 1}"/></div><figcaption>${(photo.notes ?? []).map((note) => `<p>${escapeHtml(note)}</p>`).join("")}<p class="photo-copy-note">리포트용 사진 사본 · 사실 여부는 원본과 대조해 주세요.</p></figcaption></figure>`;
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
<html lang="ko" data-baro-report="1"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)} · BARO</title><style>${fontDataUrl && /^data:font\/ttf;base64,[A-Za-z0-9+/=]+$/.test(fontDataUrl) ? `@font-face{font-family:BaroReport;src:url("${fontDataUrl}")} .baro-report{font-family:BaroReport,sans-serif!important}` : ""} body{margin:0} @page{size:A4;margin:18mm 16mm 20mm;@bottom-left{content:"BARO · 사건 상담 준비 리포트";font-family:BaroReport,sans-serif;font-size:8pt;color:#6a7688}@bottom-right{content:counter(page) " / " counter(pages);font-family:BaroReport,sans-serif;font-size:8pt;color:#6a7688}}${documentCss}</style></head><body><main>${createReportMarkup(report, true)}</main></body></html>`;
}
