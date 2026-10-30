import { expect, test } from "bun:test";
import { precedentHighlights } from "../src/client/precedent-highlights";
import type { V2PrecedentComparison } from "../src/contracts/v2/precedent-comparison";
import { precedentDocumentParts } from "../src/utils/precedent-document";

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
