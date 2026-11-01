import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { precedentHighlights } from "../src/client/precedent-highlights";
import { PrecedentDocument } from "../src/components/workspace/PrecedentDocument";
import type { V2PrecedentComparison } from "../src/contracts/v2/precedent-comparison";
import { precedentDisplayParts, precedentDocumentParts } from "../src/utils/precedent-document";

test("judgment headings gain hierarchy without changing a single original offset or byte", () => {
  const text =
    "【판시사항】\n[1] 대여금에 관한 합성 쟁점\n[판결요지]\n[1] 합성 판결 요지\n【주 문】\n주문 내용\n이 유\n이유 내용 👩🏽‍💻";
  const parts = precedentDocumentParts(text);
  expect(parts.filter((part) => part.kind === "heading").map((part) => part.text.trim())).toEqual([
    "【판시사항】",
    "[판결요지]",
    "【주 문】",
    "이 유",
  ]);
  expect(parts.map((part) => part.text).join("")).toBe(text);
  for (const part of parts) expect(text.slice(part.start, part.end)).toBe(part.text);
});

test("verified highlights survive full-text hierarchy, including an evidence quote crossing a heading", () => {
  const text = "첫 문장\n【이 유】\n대여금 반환 확인\n마지막 문장";
  const quote = "【이 유】\n대여금 반환";
  const start = text.indexOf(quote);
  const comparison = {
    source: { excerpt: { text: quote, startUtf16: start } },
    metrics: [
      {
        verdict: "yes",
        precedentEvidence: [{ text: quote, startUtf16: start, endUtf16: start + quote.length }],
      },
    ],
  } as V2PrecedentComparison;
  const rendered = precedentDocumentParts(text).flatMap((part) =>
    precedentHighlights(comparison, { text: part.text, startUtf16: part.start }),
  );
  expect(rendered.map((part) => part.text).join("")).toBe(text);
  expect(
    rendered
      .filter((part) => part.metrics.length)
      .map((part) => part.text)
      .join(""),
  ).toBe(quote);
  expect(rendered.find((part) => part.text.includes("마지막 문장"))?.metrics).toEqual([]);
});

test("party labels and judgment sections use one heading level without doubled boundary whitespace", () => {
  const text =
    "\n【원고, 피상고인】\n\n합성 원고\n\n[피고, 상고인]\n\n합성 피고\n\n【원심판결】\n합성 원심\n\n【주 문】\n\n상고를 기각한다.\n\n【이 유】\n\n1. 사안의 개요\n원문 내부 줄바꿈 유지\n";
  const html = renderToStaticMarkup(createElement(PrecedentDocument, { text }));
  expect(html.match(/<h4>/gu)).toHaveLength(5);
  expect(html).not.toContain("<h5>");
  expect(html).toContain('<p class="precedent-body">합성 원고</p>');
  expect(html).toContain("1. 사안의 개요\n원문 내부 줄바꿈 유지");
  expect(
    precedentDocumentParts(text)
      .map((part) => part.text)
      .join(""),
  ).toBe(text);
});

test("display whitespace cleanup retains exact original UTF-16 evidence locations", () => {
  const text =
    "\n\n【이 유】\n\n  합성 이유 👩🏽‍💻\n두 번째 줄\n\n【주 문】\n\n상고를 기각한다.\n\n";
  const quote = "합성 이유 👩🏽‍💻\n두 번째 줄";
  const start = text.indexOf(quote),
    offset = 200;
  const comparison = {
    source: { excerpt: { text, startUtf16: offset } },
    metrics: [
      {
        verdict: "yes",
        precedentEvidence: [
          { text: quote, startUtf16: offset + start, endUtf16: offset + start + quote.length },
        ],
      },
    ],
  } as V2PrecedentComparison;
  const parts = precedentDisplayParts(text);
  for (const part of parts) expect(text.slice(part.start, part.end)).toBe(part.text);
  const highlighted = parts
    .flatMap((part) =>
      precedentHighlights(comparison, { text: part.text, startUtf16: offset + part.start }),
    )
    .filter((part) => part.metrics.length);
  expect(highlighted.map((part) => part.text).join("")).toBe(quote);
});
