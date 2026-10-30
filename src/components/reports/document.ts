import {
  escapeReportHtml,
  reportMarkdownBlocks,
  reportMarkdownHtml,
} from "../../utils/report-markdown";
import { maskReportText } from "./download";
import {
  reportReviewSections,
  reportSectionTitle,
  withInlineReportPhotos,
} from "./review-sections";
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
const documentCss = `
.baro-report { color-scheme:light; font-family:"Pretendard Variable",sans-serif; color:#253348; background:#f4f6f9; font-size:14px; line-height:1.8; padding:32px 24px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
.baro-report * { box-sizing:border-box; }
.baro-report .sheet { max-width:860px; margin:auto; padding:32px 44px; background:white; border-radius:16px; }
.baro-report .masthead { display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid #e3e8ef; padding-bottom:18px; }
.baro-report .brand { font-weight:750; font-size:17px; color:#1d3556; }
.baro-report .brand img { width:20px; height:23px; vertical-align:middle; margin-right:8px; }
.baro-report .date { font-size:11px; color:#647084; }
.baro-report .hero { padding:28px 0 24px; }
.baro-report .hero p { font-size:11px; color:#647084; margin:0 0 8px; }
.baro-report h1 { font-size:28px; font-weight:750; letter-spacing:-.035em; line-height:1.4; margin:0; overflow-wrap:anywhere; }
.baro-report .section { padding:24px 0; border-top:1px solid #e3e8ef; }
.baro-report .section-head { display:flex; align-items:center; margin-bottom:16px; break-after:avoid; }
.baro-report .number { display:inline-block; min-width:28px; padding:2px 7px; margin-right:10px; border-radius:6px; background:#edf3fe; color:#2463b9; font-size:14px; line-height:24px; text-align:center; font-weight:650; }
.baro-report h2 { margin:0; font-size:17px; line-height:1.65; font-weight:700; color:#1e304a; }
.baro-report .lines p { margin:0 0 12px; white-space:pre-wrap; overflow-wrap:anywhere; orphans:3; widows:3; }
.baro-report .lines ul,.baro-report .lines ol { margin:12px 0; padding-left:23px; }
.baro-report .lines li { margin:0 0 9px; overflow-wrap:anywhere; orphans:2; widows:2; }
.baro-report .lines h4 { margin:18px 0 10px; font-size:14px; font-weight:700; break-after:avoid; }
.baro-report blockquote { margin:16px 0; padding-left:14px; border-left:2px solid #dce3ed; }
.baro-report code { background:#f3f5f8; padding:2px 4px; border-radius:4px; }
.baro-report pre { white-space:pre-wrap; padding:12px; background:#f3f5f8; border-radius:8px; }
.baro-report .report-inline-photo { margin:20px 0; break-inside:avoid; }
.baro-report .report-inline-photo img { display:block; width:auto; height:auto; max-width:100%; max-height:90mm; object-fit:contain; border-radius:6px; }
.baro-report figcaption { margin-top:9px; font-size:10px; color:#647084; }
.baro-report .footer { margin-top:20px; padding-top:16px; border-top:1px solid #e3e8ef; color:#647084; font-size:10px; }
@media(max-width:640px) { .baro-report { padding:0; background:white; } .baro-report .sheet { padding:24px; border-radius:0; } .baro-report h1 { font-size:24px; } }
@media print { .baro-report { background:white; padding:0; font-size:10.5pt; } .baro-report .sheet { max-width:none; padding:0; border-radius:0; } .baro-report h1 { font-size:22pt; } .baro-report .section { padding:16px 0; } .baro-report .lines li { margin-bottom:6px; } .baro-report h2 { font-size:13pt; } .baro-report .number { min-width:24px; font-size:11pt; line-height:20px; } }
`;
const embeddedLogo =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJibHVlIiB4MT0iOCIgeTE9IjQiIHgyPSI1NiIgeTI9IjYwIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHN0b3Agc3RvcC1jb2xvcj0iIzUxYjFmZiIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzI4NjRmZiIvPjwvbGluZWFyR3JhZGllbnQ+PC9kZWZzPjxnIGZpbGw9InVybCgjYmx1ZSkiPjxwYXRoIGQ9Ik0yNC41IDMuOEMyOCAxLjkgMzEgNCAzMSA4djQ4YzAgNC0zIDYuMS02LjUgNC4yTDEyLjcgNTRDOC41IDUxLjggNyA0OSA3IDQ0LjV2LTI1QzcgMTUgOC41IDEyLjIgMTIuNyAxMEwyNC41IDMuOFoiLz48cGF0aCBkPSJNMzkgMTJoOGM4LjMgMCAxNSA1LjEgMTUgMTEuNVM1NS4zIDM1IDQ3IDM1aC04YTMgMyAwIDAgMS0zLTNWMTVhMyAzIDAgMCAxIDMtM1oiLz48cGF0aCBkPSJNMzkgMzhoOGM4LjMgMCAxNSA1LjEgMTUgMTEuNVM1NS4zIDYxIDQ3IDYxaC04YTMgMyAwIDAgMS0zLTNWNDFhMyAzIDAgMCAxIDMtM1oiLz48L2c+PC9zdmc+Cg==";

/** Content is escaped by the bounded local Markdown renderer; images are owned,
 * revision/hash-verified data URLs supplied by the report service, never URLs in Markdown. */
export function createReportMarkup(report: ReportDocument, _embedded = false) {
  const title = report.maskIdentifiers ? maskReportText(report.title) : report.title;
  const photos = report.maskIdentifiers
    ? []
    : (report.photos ?? []).filter((photo) => !report.excludedFileIds.includes(photo.id));
  const raw = report.maskIdentifiers ? maskReportText(report.content) : report.content;
  const content = withInlineReportPhotos(raw, photos);
  const occurrences = reportMarkdownBlocks(content).filter((block) => block.kind === "photo");
  const encodedBytes = occurrences.reduce(
    (sum, block) => sum + (photos.find((photo) => photo.id === block.id)?.dataUrl.length ?? 0),
    0,
  );
  if (occurrences.length > 12 || encodedBytes > 12_000_000)
    throw new Error("REPORT_INLINE_PHOTO_LIMIT");
  const images = photos.map((photo) => ({ id: photo.id, name: photo.name, url: photo.dataUrl }));
  const body = reportReviewSections(content)
    .map(
      (section, index) =>
        `<section class="section"><div class="section-head"><span class="number">${index + 1}</span><h2>${escapeReportHtml(reportSectionTitle(section.title))}</h2></div><div class="lines">${reportMarkdownHtml(section.text, images)}</div></section>`,
    )
    .join("");
  const date = new Date(report.updatedAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });
  return `<div class="baro-report"><article class="sheet"><header class="masthead"><div class="brand"><img src="${embeddedLogo}" alt="BARO"/>BARO</div><span class="date">${escapeReportHtml(date)}</span></header><div class="hero"><p>사건 상담 준비 리포트</p><h1>${escapeReportHtml(title)}</h1></div>${body}<footer class="footer">BARO · 리포트 ${report.revision}</footer></article></div>`;
}
export function createReportHtml(report: ReportDocument, fontDataUrl?: string) {
  const title = report.maskIdentifiers ? maskReportText(report.title) : report.title;
  const font =
    fontDataUrl && /^data:font\/ttf;base64,[A-Za-z0-9+/=]+$/.test(fontDataUrl)
      ? `@font-face{font-family:BaroReport;src:url("${fontDataUrl}")} .baro-report{font-family:BaroReport,sans-serif!important}`
      : "";
  return `<!doctype html><html lang="ko" data-baro-report="1"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>${escapeReportHtml(title)} · BARO</title><style>${font}body{margin:0}@page{size:A4;margin:18mm 16mm 20mm;@bottom-left{content:"BARO · 사건 상담 준비 리포트";font-family:BaroReport,sans-serif;font-size:8pt;color:#647084}@bottom-right{content:counter(page) " / " counter(pages);font-family:BaroReport,sans-serif;font-size:8pt;color:#647084}}${documentCss}</style></head><body><main>${createReportMarkup(report, true)}</main></body></html>`;
}
