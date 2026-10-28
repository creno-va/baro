import { expect, test } from "bun:test";
import { precedentHighlights } from "../src/client/precedent-highlights";
import type { V2PrecedentComparison } from "../src/contracts/v2/precedent-comparison";

function comparison() {
  const text = "👩🏽‍💻 계약 종료 후 보증금 반환";
  const start = text.indexOf("계약");
  return {
    source: { excerpt: { text, startUtf16: 17 } },
    metrics: [
      {
        verdict: "yes",
        precedentEvidence: [
          { text: "계약 종료 후", startUtf16: 17 + start, endUtf16: 17 + start + 7 },
        ],
      },
      {
        verdict: "yes",
        precedentEvidence: [
          { text: "종료 후 보증금", startUtf16: 17 + start + 3, endUtf16: 17 + start + 11 },
        ],
      },
      {
        verdict: "no",
        precedentEvidence: [
          { text: "반환", startUtf16: 17 + text.indexOf("반환"), endUtf16: 17 + text.length },
        ],
      },
    ],
  } as V2PrecedentComparison;
}
test("overlapping verified ranges retain every original byte and all matching reasons", () => {
  const value = comparison();
  const parts = precedentHighlights(value);
  expect(parts.map((part) => part.text).join("")).toBe(value.source.excerpt.text);
  expect(parts.find((part) => part.text === "종료 후")?.metrics).toEqual([0, 1]);
  expect(parts.find((part) => part.text.includes("반환"))?.metrics).toEqual([]);
  expect(parts[0]?.text).toBe("👩🏽‍💻 ");
});
test("invalid or changed quote ranges never gain a highlight", () => {
  const value = comparison();
  const first = value.metrics[0]?.precedentEvidence[0];
  const second = value.metrics[1]?.precedentEvidence[0];
  if (!first || !second) throw new Error("Missing synthetic evidence");
  first.text = "조작한 인용";
  second.endUtf16 = 99999;
  expect(precedentHighlights(value).every((part) => !part.metrics.length)).toBe(true);
});
