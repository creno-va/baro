import { expect, test } from "bun:test";
import { exactMaterialQuote } from "../src/server/modules/workspace/material-quotes";

test("material quote repair preserves the exact source whitespace and original financial digits", () => {
  const source = "송금일시 : 2026. 10. 01.\n플랫폼 : 합성페이\n금액 : 3,000,000 원";
  expect(exactMaterialQuote("송금일시:2026.10.01.", [source])).toBe("송금일시 : 2026. 10. 01.");
  expect(exactMaterialQuote("금액:3,000,000원", [source])).toBe("금액 : 3,000,000 원");
  expect(exactMaterialQuote("합성페이", [source])).toBe("합성페이");
});

test("material quote repair cannot change dates, amounts, qualifiers or join separate observations", () => {
  const sources = ["송금일시:2026.10.01.", "금액:3,000,000원", "송금 예정"];
  for (const text of [
    "송금일시:2026.10.02.",
    "금액:30,000,000원",
    "2026년 10월 1일 송금했다",
    "송금일시:2026.10.01. 금액:3,000,000원",
    "송금 완료",
  ])
    expect(exactMaterialQuote(text, sources)).toBeNull();
});

test("Unicode positions survive whitespace repair without splitting supplementary characters", () => {
  expect(exactMaterialQuote("🧾거래일자:2026-10-01", ["메모\n🧾 거래일자 : 2026-10-01\n끝"])).toBe(
    "🧾 거래일자 : 2026-10-01",
  );
});
