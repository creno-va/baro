import { expect, test } from "bun:test";
import { instrumentNumbersGrounded } from "../src/server/modules/citation/instrument-numbers";
import type { SourceClaim } from "../src/server/modules/citation/v2-validate";

const text = "합성 법령 [법률 제21454호]의 원문 확인용 문장입니다.";
const claim: SourceClaim = {
  id: "synthetic_claim",
  kind: "quotation",
  text,
  citationId: "synthetic_citation",
  startUtf16: 0,
  endUtf16: text.length,
};
const excerpts = [{ citationId: claim.citationId, text }];

test.each([
  "법률 제1706호",
  "법률 1706호",
  "법률 **제1706호**",
  "법률\n제１７０６호",
  "법률 번호: 1706",
  "대통령령 제21454호",
])("internal IDs and ungrounded instrument types cannot pass as source metadata: %s", (number) => {
  expect(
    instrumentNumbersGrounded({ text: `${text}\n공식 출처: ${number}` }, [claim], excerpts),
  ).toBe(false);
});

test("an actual type and number in its cited span can be displayed with presentation formatting", () => {
  expect(instrumentNumbersGrounded({ text: "법률 **제21,454호**" }, [claim], excerpts)).toBe(true);
  expect(instrumentNumbersGrounded({ text: "법률 제21454호" }, [], excerpts)).toBe(false);
});

test("an uncited original, unrelated span or invented explanation cannot establish a number", () => {
  const draft = { text: "법률 제21454호" };
  for (const candidate of [
    { ...claim, citationId: "another_citation" },
    { ...claim, startUtf16: text.indexOf("원문") },
    { ...claim, kind: "legal_explanation" as const, text: "법률 제1706호" },
  ])
    expect(instrumentNumbersGrounded(draft, [candidate], excerpts)).toBe(false);
});

test("numbers hidden in warnings and structured output are checked too", () => {
  for (const field of ["warnings", "facts", "actions", "timeline", "parties", "sourceClaims"])
    expect(
      instrumentNumbersGrounded({ [field]: [{ text: "법률 제1706호" }] }, [claim], excerpts),
    ).toBe(false);
});

test("ordinary article, case and source identity numbers do not become promulgation claims", () => {
  expect(
    instrumentNumbersGrounded(
      { text: "민법 제598조, 2026. 3. 17. 시행", officialId: "1706" },
      [],
      [],
    ),
  ).toBe(true);
});
