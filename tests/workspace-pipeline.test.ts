import { expect, test } from "bun:test";
import type { Question } from "../src/contracts";
import type { V2Fact } from "../src/contracts/v2";
import type { Phase } from "../src/server/modules/llm-gateway/prompts";
import { ModelError } from "../src/server/modules/llm-gateway/service";
import {
  assertWorkspaceFacts,
  createWorkspacePipeline,
  type WorkspaceContext,
  WorkspaceOutputPolicyError,
} from "../src/server/modules/workspace/pipeline";

const question = (id: string, prompt: string): Question => ({
  id,
  prompt,
  answerType: "text",
  options: [],
});
const approved = {
  pass: true,
  findings: [],
  unsupportedFactIds: [],
  legalClaimsSupported: true,
  strategyDetected: false,
};
function context(): WorkspaceContext {
  return {
    intake: {
      schemaVersion: "2",
      revision: 3,
      status: "collecting",
      narrative: "상대방이 합의금 300만원을 요구했습니다. 당시 받은 자료를 정리하려고 합니다.",
      batches: [
        {
          id: "batch_1",
          ordinal: 1,
          generatedForIntakeRevision: 1,
          questions: [question("q2", "사건은 언제 발생했나요?")],
          answers: [{ questionId: "q2", status: "unknown" }],
        },
      ],
      summary: null,
      confirmedSummaryRevision: null,
      currentJobId: null,
    },
    confirmedSummary: null,
    messages: [],
    latestMessage: null,
    facts: [],
    references: {
      intakeRevision: 3,
      answeredQuestionIds: [],
      messages: [],
      files: [],
      verifiedCitationIds: [],
    },
    citations: [],
    materials: [],
  };
}
function pipeline(reply: (phase: Phase, input: unknown) => unknown | Promise<unknown>) {
  const calls: { phase: Phase; input: unknown; invocation: string | undefined }[] = [];
  return {
    calls,
    value: createWorkspacePipeline(
      {
        call: async (phase, input, _requestId, reserve, _correction, invocation) => {
          expect(await reserve()).toBe(true);
          calls.push({ phase, input, invocation });
          return reply(phase, input);
        },
      },
      { reserve: async () => true, invocation: () => crypto.randomUUID() },
    ),
  };
}

test.each(["answered", "unknown", "skipped"] as const)(
  "the second follow-up replaces a repeated %s question without changing saved answers",
  async (status) => {
    const saved = context();
    const batch = saved.intake.batches[0];
    if (!batch) throw new Error("Missing first batch");
    batch.answers = [
      status === "answered"
        ? { questionId: "q2", status, value: "지난달입니다." }
        : { questionId: "q2", status },
    ];
    saved.references.answeredQuestionIds = status === "answered" ? ["q2"] : [];
    const before = structuredClone(saved);
    let generated = 0;
    const { calls, value } = pipeline((phase, input) => {
      if (phase === "workspace_audit") {
        expect(input).toMatchObject({
          phase: "workspace_questions",
          draft: { questions: [question("new_1", "요구에 답한 기록이 있나요?")] },
        });
        return approved;
      }
      generated += 1;
      return {
        questions: [
          generated === 1
            ? question("repeat_1", "사건은  언제 발생했나요?")
            : question("new_1", "요구에 답한 기록이 있나요?"),
        ],
      };
    });
    const result = await value.questions(saved, "request-1");
    expect(result).toHaveLength(1);
    expect(result[0]?.prompt).toBe("요구에 답한 기록이 있나요?");
    expect(result[0]?.id).not.toBe("new_1");
    expect(calls.map((call) => call.phase)).toEqual([
      "workspace_questions",
      "workspace_questions",
      "workspace_audit",
    ]);
    expect(saved).toEqual(before);
  },
);

test("the two-round intake cap stops generation before any paid phase or regeneration", async () => {
  const saved = context();
  saved.intake.batches.push({
    id: "batch_2",
    ordinal: 2,
    generatedForIntakeRevision: 2,
    questions: [question("q3", "요구에 답한 기록이 있나요?")],
    answers: [{ questionId: "q3", status: "skipped" }],
  });
  const { calls, value } = pipeline(() => {
    throw new Error("No generation after the cap");
  });
  await expect(value.questions(saved, "request-limit")).rejects.toThrow("POLICY_REJECTED");
  expect(calls).toHaveLength(0);
});

test("all repeated follow-up questions regenerate once with saved answers and a sanitized reason", async () => {
  const saved = context();
  let generated = 0;
  const { value, calls } = pipeline((phase, input) => {
    if (phase === "workspace_audit") return approved;
    generated += 1;
    if (generated === 1) return { questions: [question("old", "사건은 언제 발생했나요?")] };
    expect(input).toEqual({ ...saved, draftCorrection: { reason: "question_repetition" } });
    return { questions: [question("new", "요구 내용을 확인할 수 있는 기록이 있나요?")] };
  });
  expect(await value.questions(saved, "request-2")).toHaveLength(1);
  expect(calls.map((call) => call.phase)).toEqual([
    "workspace_questions",
    "workspace_questions",
    "workspace_audit",
  ]);
  expect(new Set(calls.map((call) => call.invocation)).size).toBe(3);
});

test("audit rejection regenerates the draft and independently audits it, with a strict one-retry limit", async () => {
  const drafts: unknown[] = [];
  let generated = 0;
  const { value, calls } = pipeline((phase, input) => {
    if (phase === "workspace_audit") {
      drafts.push((input as { draft: unknown }).draft);
      return { ...approved, pass: false, findings: [{ severity: "critical", code: "privacy" }] };
    }
    generated += 1;
    return {
      questions: [question(`new_${generated}`, `자료 ${generated}의 작성일을 알고 있나요?`)],
    };
  });
  await expect(value.questions(context(), "request-3")).rejects.toMatchObject({
    code: "POLICY_REJECTED",
    reason: "audit_rejected",
  });
  expect(drafts).toHaveLength(2);
  expect(drafts[0]).not.toEqual(drafts[1]);
  expect(calls).toHaveLength(4);
});

test.each(["workspace_questions", "workspace_audit"] as const)(
  "provider refusal in %s remains terminal and is never regenerated",
  async (refusingPhase) => {
    const refusal = new ModelError("POLICY_REJECTED");
    const { value, calls } = pipeline((phase) => {
      if (phase === refusingPhase) throw refusal;
      return { questions: [question("new", "기록이 남아 있나요?")] };
    });
    await expect(value.questions(context(), "request-refusal")).rejects.toBe(refusal);
    expect(calls.filter((call) => call.phase === "workspace_questions")).toHaveLength(1);
  },
);

test("unsafe choice options fail before audit and remain private after the bounded regeneration", async () => {
  const { value, calls } = pipeline(() => ({
    questions: [
      {
        id: "unsafe",
        prompt: "어떤 내용이 있었나요?",
        answerType: "choice",
        options: ["반드시 승소합니다", "확인하지 못했습니다"],
      },
    ],
  }));
  await expect(value.questions(context(), "request-options")).rejects.toBeInstanceOf(
    WorkspaceOutputPolicyError,
  );
  expect(calls.map((call) => call.phase)).toEqual(["workspace_questions", "workspace_questions"]);
});

test("a factual question about an existing settlement demand is allowed, while advice still requires audit approval", async () => {
  const factual = "합의금 300만원을 요구받은 날짜는 언제인가요?";
  const good = pipeline((phase) =>
    phase === "workspace_audit" ? approved : { questions: [question("new", factual)] },
  );
  expect((await good.value.questions(context(), "request-demand"))[0]?.prompt).toBe(factual);
  const bad = pipeline((phase) =>
    phase === "workspace_audit"
      ? {
          ...approved,
          pass: false,
          strategyDetected: true,
          findings: [{ severity: "critical", code: "legal_strategy" }],
        }
      : { questions: [question("unsafe", "합의금 300만원을 제시하면 유리한데 제시하시겠어요?")] },
  );
  await expect(bad.value.questions(context(), "request-advice")).rejects.toMatchObject({
    reason: "audit_rejected",
  });
});

const reportedFact = (text: string): V2Fact => ({
  id: "fact_1",
  text,
  attribution: "user_statement",
  certainty: "reported",
  significance: "neutral",
  userEdited: false,
  references: [{ kind: "intake_narrative", intakeRevision: 3 }],
  conflictingFactIds: [],
});
test("reported settlement amounts and legal topics require exact sources and continue to reject privacy leaks", () => {
  const saved = context();
  saved.intake.narrative += " 상대방은 승소 확률이 높다고 주장했습니다.";
  expect(() =>
    assertWorkspaceFacts(saved, [
      reportedFact("상대방이 합의금 300만원을 요구했습니다."),
      reportedFact("상대방은 승소 확률이 높다고 주장했습니다."),
    ]),
  ).not.toThrow();
  expect(() =>
    assertWorkspaceFacts(saved, [reportedFact("상대방이 합의금 500만원을 요구했습니다.")]),
  ).toThrow(WorkspaceOutputPolicyError);
  saved.intake.narrative += " 연락처는 synthetic@example.test입니다.";
  expect(() =>
    assertWorkspaceFacts(saved, [reportedFact("연락처는 synthetic@example.test입니다.")]),
  ).toThrow(WorkspaceOutputPolicyError);
  expect(() =>
    assertWorkspaceFacts(saved, [
      {
        ...reportedFact("확인한 내용"),
        references: [{ kind: "intake_answer", questionId: "q2", intakeRevision: 3 }],
      },
    ]),
  ).toThrow(WorkspaceOutputPolicyError);
});

test("summary source failures regenerate once and retain phase-aware independent validation", async () => {
  let generated = 0;
  const saved = context();
  const { value, calls } = pipeline((phase, input) => {
    if (phase === "workspace_audit") {
      expect(input).toMatchObject({ phase: "workspace_summary" });
      return approved;
    }
    generated += 1;
    return {
      overview: "상대방에게 받은 요구와 보유 자료를 확인하는 요약입니다.",
      facts: [
        reportedFact(
          generated === 1
            ? "합의금 500만원을 요구했습니다."
            : "상대방이 합의금 300만원을 요구했습니다.",
        ),
      ],
      parties: [],
      unknowns: ["요구를 받은 날짜"],
      notices: ["사용자가 확인해야 하는 사실 정리입니다."],
    };
  });
  expect((await value.summary(saved, "request-summary")).facts[0]?.text).toContain("300만원");
  expect(calls.map((call) => call.phase)).toEqual([
    "workspace_summary",
    "workspace_summary",
    "workspace_audit",
  ]);
});
