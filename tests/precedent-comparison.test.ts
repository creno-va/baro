import { expect, test } from "bun:test";
import type { V2Fact } from "../src/contracts/v2";
import {
  PRECEDENT_COMPARISON_CRITERIA,
  type PrecedentComparisonDraft,
  precedentComparisonDraftSchema,
  precedentComparisonSourceSchema,
} from "../src/contracts/v2/precedent-comparison";
import {
  checkPrecedentComparison,
  inspectPrecedentComparison,
  precedentComparisonScore,
} from "../src/server/modules/legal-retrieval/research/comparison";
import fixture from "./fixtures/legal/research/synthetic-search.json";

const text = "대여금을 아직 돌려받지 못했다고 말했습니다.";
const facts: V2Fact[] = [
  {
    id: "synthetic_fact",
    text,
    attribution: "user_statement",
    certainty: "reported",
    significance: "neutral",
    userEdited: false,
    conflictingFactIds: [],
    references: [{ kind: "intake_narrative", intakeRevision: 1 }],
  },
];
const source = precedentComparisonSourceSchema.parse({
  citation: fixture.items[0]?.citation,
  excerpt: {
    text: "👩🏽‍💻 대여금 반환을 다투는 합성 판결문입니다.",
    startUtf16: 10,
    endUtf16: 40,
    fullLengthUtf16: 60,
    truncated: true,
  },
});
function draft(yes = 0, no = 0): PrecedentComparisonDraft {
  const start = source.excerpt.text.indexOf("대여금");
  return {
    metrics: (
      Object.keys(PRECEDENT_COMPARISON_CRITERIA) as (keyof typeof PRECEDENT_COMPARISON_CRITERIA)[]
    ).map((criterion, index) => ({
      criterion,
      verdict: index < yes ? "yes" : index < yes + no ? "no" : "unknown",
      explanation: "제공된 합성 사실과 발췌문에서 비교합니다.",
      caseEvidence: index < yes + no ? [{ factId: facts[0]?.id ?? "missing", text }] : [],
      precedentEvidence:
        index < yes + no ? [{ text: "대여금", startUtf16: 10 + start, endUtf16: 13 + start }] : [],
    })),
  };
}
test("unknowns stay in the fixed denominator; zero known evidence yields zero matches", () => {
  expect(precedentComparisonScore(draft())).toEqual({
    matchedCount: 0,
    knownCount: 0,
    percentage: 0,
  });
  expect(precedentComparisonScore(draft(2, 1))).toEqual({
    matchedCount: 2,
    knownCount: 3,
    percentage: 25,
  });
  expect(precedentComparisonScore(draft(8))).toEqual({
    matchedCount: 8,
    knownCount: 8,
    percentage: 100,
  });
});
test("every fixed indicator appears once and unsupported model score fields are rejected", () => {
  const valid = draft(2, 1);
  expect(checkPrecedentComparison(valid, facts, source)).toEqual(valid);
  expect(precedentComparisonDraftSchema.safeParse({ ...valid, percentage: 99 }).success).toBe(
    false,
  );
  for (const metrics of [
    valid.metrics.slice(0, 7),
    [...valid.metrics, valid.metrics[0]],
    valid.metrics.map((m) => ({ ...m, criterion: "relationship" })),
  ])
    expect(checkPrecedentComparison({ metrics }, facts, source)).toBeNull();
});
test("no is not inferred from missing evidence and case quotes cannot come from an unrelated fact", () => {
  for (const change of [
    { caseEvidence: [] },
    { precedentEvidence: [] },
    { caseEvidence: [{ factId: "another", text }] },
    { caseEvidence: [{ factId: "synthetic_fact", text: "임의로 덧붙인 문장" }] },
  ]) {
    const value = draft(0, 1);
    const first = value.metrics[0];
    if (!first) throw new Error("Missing synthetic metric");
    value.metrics[0] = { ...first, ...change };
    expect(checkPrecedentComparison(value, facts, source)).toBeNull();
  }
});
test("original UTF-16 spans use excerpt offsets and reject wrong quotations or a split surrogate", () => {
  const valid = draft(1);
  expect(checkPrecedentComparison(valid, facts, source)).toEqual(valid);
  for (const evidence of [
    { text: "임대차", startUtf16: 18, endUtf16: 21 },
    { text: source.excerpt.text.slice(1, 2), startUtf16: 11, endUtf16: 12 },
  ]) {
    const value = draft(1);
    const first = value.metrics[0];
    if (!first) throw new Error("Missing synthetic metric");
    first.precedentEvidence = [evidence];
    expect(checkPrecedentComparison(value, facts, source)).toBeNull();
  }
});
test("unique exact source quotes repair numeric offsets only, before semantic audit", () => {
  const value = draft(1);
  const first = value.metrics[0];
  if (!first) throw new Error("Missing synthetic metric");
  first.precedentEvidence = [{ text: "대여금", startUtf16: 1, endUtf16: 4 }];
  const result = inspectPrecedentComparison(value, facts, source);
  expect(result.observation).toEqual({ reason: "accepted", validSpans: 0, uniqueExactSpans: 1 });
  expect(result.draft).toEqual(draft(1));
  expect(value.metrics[0]?.precedentEvidence[0]?.startUtf16).toBe(1);
  first.precedentEvidence = [{ text: "👩🏽‍💻", startUtf16: 0, endUtf16: 1 }];
  expect(checkPrecedentComparison(value, facts, source)?.metrics[0]?.precedentEvidence[0]).toEqual({
    text: "👩🏽‍💻",
    startUtf16: 10,
    endUtf16: 17,
  });
});
test("ambiguous, invented or unread quotes never acquire fabricated coordinates", () => {
  const value = draft(1);
  const first = value.metrics[0];
  if (!first) throw new Error("Missing synthetic metric");
  first.precedentEvidence = [{ text: "대여금", startUtf16: 0, endUtf16: 1 }];
  const repeated = {
    ...source,
    excerpt: {
      text: "대여금과 대여금",
      startUtf16: 10,
      endUtf16: 18,
      fullLengthUtf16: 30,
      truncated: true,
    },
  };
  expect(inspectPrecedentComparison(value, facts, repeated)).toMatchObject({
    draft: null,
    observation: { reason: "source_quote_ambiguous" },
  });
  first.precedentEvidence = [{ text: "읽지 않은 뒤쪽 원문", startUtf16: 100, endUtf16: 110 }];
  expect(inspectPrecedentComparison(value, facts, source)).toMatchObject({
    draft: null,
    observation: { reason: "source_quote_missing" },
  });
  first.precedentEvidence = [{ text: "대여금을 반환할 의무가 있다", startUtf16: 0, endUtf16: 10 }];
  expect(checkPrecedentComparison(value, facts, source)).toBeNull();
  const serialized = JSON.stringify(inspectPrecedentComparison(value, facts, source).observation);
  expect(serialized).not.toContain("대여금");
  expect(serialized).not.toContain("synthetic");
});
test("uncertain/conflicting facts and official text cannot become confirmed case-side matches", () => {
  for (const changed of [
    { certainty: "uncertain" },
    { certainty: "conflicting" },
    { attribution: "official_source" },
    { attribution: "ai_organization" },
  ] as const)
    expect(
      checkPrecedentComparison(
        draft(1),
        facts.map((fact) => ({ ...fact, ...changed })),
        source,
      ),
    ).toBeNull();
});
