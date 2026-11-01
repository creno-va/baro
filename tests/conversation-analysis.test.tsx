import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ConversationAnalysis } from "../src/components/workspace/ConversationAnalysis";
import { nextConversationAction } from "../src/components/workspace/conversation-state";
import { v2ConversationStateSchema } from "../src/contracts/v2";
import { conversationState, limitedConversationState } from "./helpers/conversation-state";

test("read-only analysis shows unavailable sources, the exact missing fact and current purpose without claiming completion", () => {
  const state = limitedConversationState("respond_to_claim");
  const html = renderToStaticMarkup(
    <ConversationAnalysis
      state={state}
      files={[]}
      onReviewFile={() => {
        throw new Error("Read must not execute");
      }}
    />,
  );
  expect(html).toContain("공식 근거를 확인하지 못했어요");
  expect(html).toContain("상대방 주장 대응");
  expect(html).toContain("남은 금액의 반환 약속 날짜");
  expect(html).not.toContain("조사를 완료했어요");
  expect(html).not.toContain("href=");
});

test("a retained snapshot is explicitly previous while a changed basis awaits analysis", () => {
  const state = limitedConversationState();
  state.analysis.status = "stale";
  const html = renderToStaticMarkup(
    <ConversationAnalysis state={state} files={[]} onReviewFile={() => {}} />,
  );
  expect(html).toContain("이전 조사 결과");
  expect(html).toContain("현재 사건의 분석 완료로 표시하지 않아요");
  expect(html).toContain("다시 확인해야 해요");
});

test("inline legal requirements preserve official claims, conflicting facts, gaps and file review instead of tab navigation", () => {
  const state = limitedConversationState();
  const snapshot = state.snapshot;
  if (!snapshot) throw new Error("Missing synthetic snapshot");
  state.analysis.status = "partial";
  snapshot.status = "partial";
  snapshot.citations = [
    {
      id: "statute",
      sourceId: "source",
      title: "합성 검증용 조항",
      kind: "statute",
      officialId: "synthetic",
      article: "제1조",
      effectiveDate: "2026-01-01",
      url: "https://www.law.go.kr/법령/민법",
      contentHash: "c".repeat(64),
      verifiedAt: snapshot.checkedAt,
    },
  ];
  snapshot.sourceClaims = [
    {
      id: "claim",
      kind: "quotation",
      text: "합성 공식 근거 인용",
      citationId: "statute",
      startUtf16: 0,
      endUtf16: 11,
    },
  ];
  snapshot.basedOnFactIds = ["fact", "counterfact"];
  snapshot.includedEvidence = [{ fileId: "file", fileRevision: 2, contentHash: "d".repeat(64) }];
  snapshot.issues = [
    {
      id: "issue",
      title: "반환 약정 검토",
      requirements: [
        {
          id: "requirement",
          label: "반환 약속의 내용",
          assessment: "insufficient",
          sourceClaimIds: ["claim"],
          factIds: ["fact"],
          conflictingFactIds: ["counterfact"],
          evidence: [
            {
              kind: "user_material",
              fileId: "file",
              fileRevision: 2,
              position: { kind: "document", page: 1, paragraph: 1, table: null },
            },
          ],
          gaps: ["약속한 날짜 미확인"],
        },
      ],
    },
  ];
  // This fixture checks rendering only; DTO shape is not official-source verification.
  const parsed = v2ConversationStateSchema().parse(state);
  const html = renderToStaticMarkup(
    <ConversationAnalysis
      state={parsed}
      files={[
        {
          id: "file",
          revision: 2,
          name: "계약서.txt",
          status: "ready",
          mimeType: "text/plain",
          sizeBytes: 100,
          extractedText: "",
          coverage: "1쪽",
        },
      ]}
      facts={[
        {
          id: "fact",
          text: "일부 입금이 있었다는 진술",
          attribution: "user_statement",
          certainty: "reported",
          significance: "neutral",
          references: [{ kind: "intake_narrative", intakeRevision: 1 }],
          conflictingFactIds: [],
          userEdited: false,
        },
        {
          id: "counterfact",
          text: "상대방이 미입금이라고 말한 진술",
          attribution: "user_statement",
          certainty: "reported",
          significance: "unfavorable",
          references: [{ kind: "intake_narrative", intakeRevision: 1 }],
          conflictingFactIds: [],
          userEdited: false,
        },
      ]}
      onReviewFile={() => {}}
    />,
  );
  for (const text of [
    "합성 공식 근거 인용",
    "반환 약속의 내용",
    "일부 입금이 있었다는 진술",
    "상대방이 미입금이라고 말한 진술",
    "약속한 날짜 미확인",
    "계약서.txt",
  ])
    expect(html).toContain(text);
  expect(html).toContain("https://www.law.go.kr/");
  expect(html).not.toContain("/files?");
  expect(html).not.toContain("소송 전략은 제공하지 않으며");
});

test("the next action follows authoritative readiness while unknown facts never force a question loop", () => {
  const state = conversationState();
  expect(nextConversationAction(state)).toBe("analyze_legal");
  state.summaryConfirmed = false;
  expect(nextConversationAction(state)).toBe("reconfirm_case");
  state.summaryConfirmed = true;
  state.pendingEvidenceIds = ["processing-file"];
  expect(nextConversationAction(state)).toBe("add_material");
  const limited = limitedConversationState("unconfirmed");
  expect(nextConversationAction(limited)).toBe("prepare_report");
  limited.report = {
    status: "ready",
    id: "report",
    revision: 1,
    basis: limited.analysis.basis,
    currentJobId: null,
    failure: null,
  };
  expect(nextConversationAction(limited)).toBe("resolve_followup");
});
