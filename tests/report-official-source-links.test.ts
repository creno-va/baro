import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createReportHtml } from "../src/components/reports/document";
import { ReportReading } from "../src/components/reports/ReportReading";
import { reportMarkdownHtml, reportOfficialSourceUrl } from "../src/utils/report-markdown";
import {
  officialReportUrls,
  officialSourceReport,
  rejectedReportUrls,
} from "./helpers/report-official-source-fixture";

test("only exact official canonical source IDs become navigation, preserving the literal URL", () => {
  for (const url of officialReportUrls)
    expect(reportOfficialSourceUrl(`공식 원문 · ${url}`)).toBe(url);
  for (const url of rejectedReportUrls)
    expect(reportOfficialSourceUrl(`공식 원문 · ${url}`)).toBeUndefined();
  for (const control of ["\n", "\r", "\t", "\0"])
    expect(
      reportOfficialSourceUrl(`공식 원문 · ${officialReportUrls[0]}${control}`),
    ).toBeUndefined();
  for (const value of [
    officialReportUrls[0],
    `공식 원문 · ${officialReportUrls[0]} 설명`,
    `[출처](${officialReportUrls[0]})`,
  ])
    expect(reportOfficialSourceUrl(value)).toBeUndefined();
});

test("web and saved HTML limit links to source sections and retain edited/uncertain text without verification promotion", () => {
  const html = createReportHtml(officialSourceReport);
  const web = renderToStaticMarkup(
    createElement(ReportReading, { content: officialSourceReport.content }),
  );
  for (const value of [web, html]) {
    expect((value.match(/<a /g) ?? []).length).toBe(3);
    expect(value).toContain("원문을 다시 확인해 주세요.");
    expect(value).not.toContain("<script");
    expect(value).not.toContain('href="https://evil');
    for (const url of officialReportUrls) {
      const escaped = url.replaceAll("&", "&amp;");
      expect(value).toContain(
        `href="${escaped}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${escaped}</a>`,
      );
    }
  }
  expect(html).toContain("default-src &#39;none&#39;".replaceAll("&#39;", "'"));
  expect(reportMarkdownHtml(`공식 원문 · ${officialReportUrls[0]}`)).not.toContain("<a");
  expect(reportMarkdownHtml(`공식 원문 · ${officialReportUrls[0]}`, [], true)).toContain("<a");
});
