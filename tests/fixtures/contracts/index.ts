import type { Citation, Question, Result, StructuredFact } from "../../../src/contracts";

export const fixtureMetadata = {
  schemaVersion: "1",
  synthetic: true,
  reviewedAt: "2026-10-05",
  purpose: "Contract validation only; not verified law or release evidence",
} as const;
export const caseId = "11111111-1111-4111-8111-111111111111";
export const analysisId = "22222222-2222-4222-8222-222222222222";
const contentHash = "a".repeat(64);
export const syntheticCitation: Citation = {
  id: "citation_1",
  sourceId: `statute:synthetic-law:2026-01-01:1:${contentHash}`,
  lawName: "합성 법령 fixture",
  article: "합성 제1조",
  effectiveDate: "2026-01-01",
  verifiedAt: "2026-10-05T00:00:00Z",
  url: "https://law.go.kr/LSW/lsInfoP.do?lsiSeq=0",
  contentHash,
};
export const questions: Question[] = [
  { id: "q1", prompt: "반환하기로 약속한 날짜를 알고 있나요?", answerType: "text", options: [] },
  {
    id: "q2",
    prompt: "송금 내역이 있나요?",
    answerType: "choice",
    options: ["있음", "없음", "확인 필요"],
  },
];
export const guidance: Extract<Result, { kind: "guidance" }> = {
  schemaVersion: "1",
  kind: "guidance",
  asOfDate: "2026-10-05",
  notices: ["합성 데이터입니다. 법률 자문이 아닙니다."],
  summary: {
    userStatements: ["합성 사용자 A는 지인에게 금전을 대여했다고 진술했습니다."],
    organizedByAi: ["반환 약정과 이행을 구분하여 정리했습니다."],
    unknowns: ["반환 약정일은 확인되지 않았습니다."],
  },
  timeline: [{ date: null, event: "금전 대여 진술", source: "user", confidence: "stated" }],
  issues: [
    {
      id: "issue_1",
      title: "반환 약정 확인",
      explanation: "당사자 진술과 보유 자료를 확인할 항목입니다.",
      uncertainty: "원자료를 확인하지 않아 약정 내용은 미확정입니다.",
      citationIds: ["citation_1"],
    },
  ],
  evidenceChecklist: [
    {
      id: "evidence_1",
      label: "송금 내역",
      why: "사용자 진술을 확인할 자료입니다.",
      status: "unknown",
    },
  ],
  nextSteps: [
    {
      id: "step_1",
      label: "보유 자료 확인",
      purpose: "약정 관련 자료를 정리합니다.",
      caution: "합성 예시로 개별 사건에 적용하지 않습니다.",
      citationIds: [],
    },
  ],
  citations: [syntheticCitation],
  noticeVersion: "2026-10-04",
};
export const outOfScope: Extract<Result, { kind: "out_of_scope" }> = {
  schemaVersion: "1",
  kind: "out_of_scope",
  asOfDate: "2026-10-05",
  notices: ["지원 범위 안내"],
  reasonCode: "UNSUPPORTED_CASE_TYPE",
  message: "개인 간 금전 대여 외의 사건 유형입니다.",
  helpLinks: [],
};
export const urgentRedirect: Extract<Result, { kind: "urgent_redirect" }> = {
  schemaVersion: "1",
  kind: "urgent_redirect",
  asOfDate: "2026-10-05",
  notices: ["안전 확인이 우선입니다."],
  reasonCode: "IMMEDIATE_DANGER",
  message: "즉각적인 안전 확인이 필요한 상황입니다.",
  helpLinks: [],
};
export const facts: StructuredFact[] = [
  { value: "10000원", originalValue: "만 원", source: "user", confidence: "stated" },
  {
    value: "금전 대여 진술로 정리",
    originalValue: null,
    source: "ai_organization",
    confidence: "inferred",
  },
  { value: null, originalValue: null, source: "user", confidence: "unknown" },
  {
    value: "합성 조문 텍스트",
    originalValue: null,
    source: "official_source",
    confidence: "verified",
  },
];
