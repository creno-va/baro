import { expect, test } from "bun:test";
import type { V2Summary } from "../src/contracts/v2";
import { createPrecedentRelevance } from "../src/server/modules/legal-retrieval/research/relevance";
import type { PrecedentCandidate } from "../src/server/modules/legal-retrieval/v2/precedents";
import { summary } from "./fixtures/contracts/v2";

const loan: V2Summary = {
  ...summary,
  overview: "지인에게 구두로 돈을 빌려주고 계좌 이체했다. 반환 약속 이후 돌려받지 못했다.",
  facts: [],
};
const candidate = (id: string, title: string, date = "2026-01-01"): PrecedentCandidate => ({
  판례일련번호: id,
  사건명: title,
  사건번호: `2026다${id}`,
  선고일자: date,
  법원명: "합성 법원",
});

test("a directly relevant older loan judgment ranks above a recent construction case mentioning loans", () => {
  const relevance = createPrecedentRelevance(loan);
  expect(
    relevance.candidates(
      [
        candidate("1", "공사대금청구의소·건물철거등청구", "2026-10-01"),
        candidate("2", "결정(조서)결정", "2026-09-01"),
        candidate("3", "대여금 반환"),
      ],
      "대여금",
    ),
  ).toEqual(["3", "1", "2"]);
  expect(
    relevance.score(
      "공사대금청구의소·건물철거등청구",
      "다른 사건의 대여금 판례를 인용했다. 계좌이체와 구두 약속이 언급된다.",
      ["loan"],
    ).relevant,
  ).toBe(false);
  expect(
    relevance.score("결정(조서)결정", "채무자에 대한 대여금 청구를 인용했다.", ["loan"]).score,
  ).toBeLessThanOrEqual(0);
});

test("shared supplied factual patterns improve discovery order without becoming a similarity percentage", () => {
  const relevance = createPrecedentRelevance(loan);
  const direct = relevance.score(
    "대여금 반환",
    "지인에게 계좌 이체한 내역과 구두 반환 약속을 확인했다.",
    ["loan"],
  );
  const generic = relevance.score("대여금 반환", "이자 약정의 해석에 관한 사건이다.", ["loan"]);
  expect(direct.score).toBeGreaterThan(generic.score);
  expect(direct.relevant).toBe(true);
  expect(direct).not.toHaveProperty("percentage");
  expect(
    createPrecedentRelevance({
      ...loan,
      overview: "건설 공사 관계에서 빌려준 돈을 정리한다.",
    }).score("공사대금청구의소", "대여금 반환 약정이 쟁점이다.", ["loan"]).relevant,
  ).toBe(true);
});

test("unrelated judgments and late reference-only mentions are not substantive matches", () => {
  const relevance = createPrecedentRelevance(loan);
  expect(relevance.score("소유권 확인", "당사자가 자료를 보유했다.", ["loan"]).relevant).toBe(
    false,
  );
  expect(
    relevance.score("기타 청구", "가".repeat(12000) + "참조판례: 대여금 반환", ["loan"]).relevant,
  ).toBe(false);
});

test("official explanations and uncertain material facts cannot boost case pattern matching", () => {
  const base = summary.facts[0];
  if (!base) throw new Error("Missing synthetic fact");
  const mixed = createPrecedentRelevance({
    ...loan,
    overview: "빌려준 돈",
    facts: [
      { ...base, attribution: "official_source", text: "건설 공사" },
      {
        ...base,
        id: "uncertain",
        attribution: "user_material",
        certainty: "uncertain",
        text: "건설 공사",
      },
    ],
  });
  expect(mixed.score("공사대금청구의소", "대여금 반환", ["loan"]).relevant).toBe(false);
});
