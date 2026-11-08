import { expect, test } from "bun:test";
import { createReportHtml } from "../src/components/reports/document";
import {
  reportReviewSections,
  withInlineReportPhotos,
} from "../src/components/reports/review-sections";
import { reportMarkdownHtml, reportPhotoIds, reportPhotoToken } from "../src/utils/report-markdown";

test("bounded tables share escaped cells across renderers and keep photo, URL and official quotation text literal", () => {
  const table =
    "| 확인할 사실 | 자료 |\n| --- | --- |\n| 계약 \\| 조건 | **원본** |\n| <script>bad()</script> | ![사진](baro-photo:unselected) |\n| 공식 원문 · https://law.go.kr/LSW/lsInfoP.do?lsiSeq=284415 | [외부](javascript:bad) |";
  const html = reportMarkdownHtml(table, [], true);
  expect(html).toContain('<th scope="col">확인할 사실</th>');
  expect(html).toContain("<td>계약 | 조건</td>");
  expect(html).toContain("<strong>원본</strong>");
  expect(html).toContain("&lt;script&gt;bad()&lt;/script&gt;");
  expect(html).not.toContain("<script");
  expect(html).not.toContain("<img");
  expect(html).not.toContain("<a");
  expect(reportPhotoIds(table)).toEqual([]);
  expect(reportMarkdownHtml(`> [원문] ${table.replaceAll("\n", "\n> [원문] ")}`)).not.toContain(
    "<table",
  );
  expect(reportMarkdownHtml(`\`\`\`\n${table}\n\`\`\``)).not.toContain("<table");
  for (const invalid of [
    "| 가 | 나 |\n| --- | --- |\n| 셋 | 넷 | 다섯 |",
    `| 항목 |\n| --- |\n${Array.from({ length: 201 }, (_, i) => `| 행 ${i} |`).join("\n")}`,
  ]) {
    const rendered = reportMarkdownHtml(invalid);
    expect(rendered).not.toContain("<table");
    expect(rendered).toContain(invalid.includes("다섯") ? "다섯" : "행 200");
  }
  const separators = Array(205).fill("| --- |").join("\n");
  expect(reportMarkdownHtml(separators)).not.toContain("<table");
  expect(reportMarkdownHtml(separators).match(/<p>/gu)).toHaveLength(205);
});

test("Markdown renders lists and emphasis after editing while raw markup and remote images stay inert", () => {
  const html = reportMarkdownHtml(
    "- **송금** 확인\n- `*원본*` 보관\n\n1. 첫 확인\n2. 두 번째 확인\n<script>alert(1)</script>\n![외부](https://invalid.test/a.jpg)\n![공격](javascript:alert(1))\n<img src=x onerror=alert(1)>",
  );
  expect(html).toContain(
    "<ul><li><strong>송금</strong> 확인</li><li><code>*원본*</code> 보관</li></ul>",
  );
  expect(html).toContain("<ol><li>첫 확인</li><li>두 번째 확인</li></ol>");
  expect(html).not.toContain("<script");
  expect(html).not.toContain("<img");
  expect(html).toContain("&lt;script&gt;");
});

test("legacy span metadata has the same readable source label without altering saved or literal quotation text", () => {
  const line = "검증 시각 · 2026-11-01T00:00:00.000Z · 원문 범위 UTF-16 10–35 중 일부 발췌";
  const content = `출처와 분석 기준\n- ${line}\n> [원문] ${line}`;
  const html = reportMarkdownHtml(`- ${line}`, [], true);
  expect(html).not.toContain("UTF-16");
  expect(html).toContain("원문 확인 시각 · 2026-11-01T00:00:00.000Z · 해당 근거 중 일부 발췌");
  expect(reportMarkdownHtml(`> [원문] ${line}`, [], true)).toContain(line);
  expect(reportMarkdownHtml(line)).toContain(line);
  expect(reportReviewSections(content)[0]?.text).toContain(line);
});

test("only approved internal photo IDs become images, with escaped captions and exact body placement", () => {
  const token = reportPhotoToken("photo-1", '사진 <img onerror="bad">');
  const text = `사진 앞 내용\n\n${token}\n\n사진 뒤 내용`;
  const url = "/api/v2/reports/report-1/photos/photo-1";
  const html = reportMarkdownHtml(text, [{ id: "photo-1", name: "합성 사진", url }]);
  expect(html.indexOf("사진 앞 내용")).toBeLessThan(html.indexOf("<figure"));
  expect(html.indexOf("</figure>")).toBeLessThan(html.indexOf("사진 뒤 내용"));
  expect(html).toContain(`src="${url}"`);
  expect(html).toContain("&lt;img onerror=&quot;bad&quot;&gt;");
  for (const untrusted of [
    "https://invalid.test/a",
    "data:image/svg+xml;base64,PHN2Zz4=",
    '" onerror="bad',
  ])
    expect(
      reportMarkdownHtml(text, [{ id: "photo-1", name: "합성", url: untrusted }]),
    ).not.toContain("<img");
  expect(reportMarkdownHtml(text)).not.toContain("<img");
  expect(reportPhotoIds(`${text}\n${token}`)).toEqual(["photo-1"]);
});

test("code blocks cannot create photos or split report sections; compatibility selections move inside the document", () => {
  const content =
    "사건 개요\n```\n당사자\n![실행 금지](baro-photo:fake)\n```\n사진 앞\n\n당사자와 관계\n- 합성 의뢰인";
  expect(reportPhotoIds(content)).toEqual([]);
  expect(reportReviewSections(content).map((section) => section.title)).toEqual([
    "사건 개요",
    "당사자와 관계",
  ]);
  const positioned = withInlineReportPhotos(content, [{ id: "photo-1", name: "합성 사진" }]);
  expect(positioned.indexOf("baro-photo:photo-1")).toBeLessThan(
    positioned.indexOf("당사자와 관계"),
  );
  expect(withInlineReportPhotos(positioned, [{ id: "photo-1", name: "합성 사진" }])).toBe(
    positioned,
  );
  const observed =
    "주요 사실과 자료\n- 문서 기재\n  당사자\n  합성 문서 안의 제목\n\n추가 확인 사항\n- 일시 확인";
  expect(reportReviewSections(observed).map((section) => section.title)).toEqual([
    "주요 사실과 자료",
    "추가 확인 사항",
  ]);
});

test("PDF shares inline Markdown/photo order and rejects repeated images before HTML amplification", () => {
  const base = {
    title: "합성",
    revision: 1,
    updatedAt: "2026-10-31T00:00:00Z",
    stale: false,
    maskIdentifiers: false,
    excludedFileIds: [],
    photos: [
      { id: "photo-1", name: "합성", revision: 2, dataUrl: "data:image/jpeg;base64,/9j/2Q==" },
    ],
  };
  const token = reportPhotoToken("photo-1", "본문 사진");
  const html = createReportHtml({
    ...base,
    content: `사건 개요\n- **앞 내용**\n${token}\n- 뒤 내용\n\n당사자와 관계\n- 합성 관계`,
  });
  expect(html.indexOf("<strong>앞 내용</strong>")).toBeLessThan(
    html.indexOf('data-report-photo="photo-1"'),
  );
  expect(html.indexOf("</figure>")).toBeLessThan(html.indexOf("<li>뒤 내용</li>"));
  expect(html).not.toContain("선택한 근거 사진");
  expect(() =>
    createReportHtml({ ...base, content: `사건 개요\n${Array(13).fill(token).join("\n")}` }),
  ).toThrow("REPORT_INLINE_PHOTO_LIMIT");
});

test("compatibility photos stay inside evidence, and its headings survive shared screen/PDF rendering", () => {
  const content =
    "주요 사실\n- 송금 기록 (증거 1 · 이미지 관찰)\n\n증거 자료\n### 증거 1 · 합성 사진.jpg\n- 이미지 관찰 · 합성 내용\n\n추가 확인 사항\n- 반환 여부";
  const placed = withInlineReportPhotos(content, [{ id: "photo-1", name: "합성 사진.jpg" }]);
  const sections = reportReviewSections(placed);
  expect(sections.map((section) => section.title)).toEqual([
    "주요 사실",
    "증거 자료",
    "추가 확인 사항",
  ]);
  expect(sections[0]?.text).not.toContain("baro-photo:");
  expect(sections[1]?.text).toContain("baro-photo:photo-1");
  const html = createReportHtml({
    title: "합성 증거 리포트",
    content: placed,
    revision: 1,
    updatedAt: "2026-10-31T00:00:00Z",
    stale: false,
    maskIdentifiers: false,
    excludedFileIds: [],
    photos: [
      {
        id: "photo-1",
        name: "합성 사진.jpg",
        revision: 2,
        dataUrl: "data:image/jpeg;base64,/9j/2Q==",
      },
    ],
  });
  expect(html).toContain("<h2>증거 자료</h2>");
  expect(html).toContain("<h4>증거 1 · 합성 사진.jpg</h4>");
  expect(html.indexOf("<h2>증거 자료")).toBeLessThan(html.indexOf('data-report-photo="photo-1"'));
  expect(html.indexOf('data-report-photo="photo-1"')).toBeLessThan(
    html.indexOf("<h2>추가 확인 사항"),
  );
});
