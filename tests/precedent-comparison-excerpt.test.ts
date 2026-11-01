import { expect, test } from "bun:test";
import { v2PrecedentExcerptSchema } from "../src/contracts/v2/precedent-research";
import { comparisonExcerpt } from "../src/server/modules/legal-retrieval/research/comparison-excerpt";

for (const title of ["1. 사안의 개요", "가. 인정 사실", "【기초사실】", "[사실관계]"]) {
  test(`comparison reads the actual case facts after long legal text: ${title}`, () => {
    const legal = "일반 법리와 다른 판례에 관한 설명입니다. ".repeat(250);
    const facts = "돈을 빌려달라는 요청을 받고 구두로 수락한 후 계좌로 송금했다. 😀\n";
    const body = `【판시사항】\n${legal}\n【이 유】\n${title}\n${facts}${"후속 사건 경위입니다. ".repeat(500)}`;
    const excerpt = v2PrecedentExcerptSchema.parse(comparisonExcerpt(body));
    expect(excerpt.text).toContain(facts.trim());
    expect(excerpt.text).not.toContain("일반 법리와 다른 판례");
    expect(excerpt.startUtf16).toBeGreaterThan(4000);
    expect(excerpt.text).toBe(body.slice(excerpt.startUtf16, excerpt.endUtf16));
    expect(excerpt.text.length).toBeLessThanOrEqual(4000);
    expect(excerpt.fullLengthUtf16).toBe(body.length);
    expect(excerpt.truncated).toBe(true);
  });
}

test("short originals keep all context and unstructured long originals keep bounded exact coverage", () => {
  for (const body of [
    "  합성 당사자와 계약 사실입니다. 😀  ",
    "합성 사실입니다. 😀\n".repeat(600),
  ]) {
    const excerpt = v2PrecedentExcerptSchema.parse(comparisonExcerpt(body));
    expect(excerpt.text).toBe(body.slice(excerpt.startUtf16, excerpt.endUtf16));
    expect(excerpt.text.length).toBeLessThanOrEqual(4000);
    expect(excerpt.text).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/,
    );
  }
});

test("an abstract mentioning facts does not displace the reason section", () => {
  const body = `【판결요지】\n이 사건의 사실관계와 일반 법리 설명\n${"긴 법리 설명 ".repeat(900)}\n【이유】\n원고는 피고에게 송금하고 반환을 요청했다.\n${"이유 본문 ".repeat(900)}`;
  const excerpt = v2PrecedentExcerptSchema.parse(comparisonExcerpt(body));
  expect(excerpt.text).toContain("원고는 피고에게 송금하고 반환을 요청했다.");
  expect(excerpt.text).not.toContain("이 사건의 사실관계와 일반 법리 설명");
});
