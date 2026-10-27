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

test("new choices omit built-in unknown/skip before audit without losing substantive negative answers", async () => {
  const saved = context();
  const draft = {
    questions: [
      {
        id: "new",
        prompt: "기록을 가지고 있나요?",
        answerType: "choice",
        options: ["가지고 있음", "기록이 없음", "잘 모르겠어요", "건너뛰기"],
      },
    ],
  };
  const p = pipeline((phase, input) => {
    if (phase !== "workspace_audit") return draft;
    expect(input).toMatchObject({
      context: saved,
      draft: { questions: [{ answerType: "choice", options: ["가지고 있음", "기록이 없음"] }] },
    });
    return approved;
  });
  const result = await p.value.questions(saved, "synthetic-readable-choices");
  expect(result[0]?.options).toEqual(["가지고 있음", "기록이 없음"]);
  expect(p.calls.map((call) => call.phase)).toEqual(["workspace_questions", "workspace_audit"]);
  expect(saved.intake.batches[0]?.answers).toEqual([{ questionId: "q2", status: "unknown" }]);
});

test("reserved choices leaving fewer than two substantive answers become a valid free answer without regeneration", async () => {
  const p = pipeline((phase) =>
    phase === "workspace_audit"
      ? approved
      : {
          questions: [
            {
              id: "new",
              prompt: "돈을 받은 때가 언제쯤이었나요?",
              answerType: "choice",
              options: ["지난달 말쯤", "모름", "Skip"],
            },
          ],
        },
  );
  const result = await p.value.questions(context(), "synthetic-free-answer");
  expect(result[0]).toMatchObject({ answerType: "text", options: [] });
  expect(p.calls).toHaveLength(2);
});

function confirmedChatContext(): WorkspaceContext {
  const saved = context();
  const summary = {
    schemaVersion: "2" as const,
    revision: 1,
    intakeRevision: saved.intake.revision,
    createdAt: "2026-10-14T00:00:00.000Z",
    overview: "합성 자료 정리",
    facts: [],
    parties: [],
    unknowns: [],
    notices: ["합성 검증"],
  };
  return {
    ...saved,
    intake: { ...saved.intake, status: "confirmed", confirmedSummaryRevision: 1 },
    confirmedSummary: summary,
    latestMessage: {
      schemaVersion: "2",
      id: "synthetic_message",
      operationId: "synthetic_operation",
      workspaceRevision: 1,
      createdAt: summary.createdAt,
      role: "user",
      text: "자료 정리에 관해 알려 주세요.",
      selectedFileIds: [],
    },
  };
}

const chatText = (text: string) => ({
  text,
  references: [],
  warnings: [],
  facts: [],
  actions: [],
  parties: [],
  requestedSources: [],
  sourceClaims: [],
  timeline: [],
});

test("exact standalone strategy refusal reaches audit with its full original text", async () => {
  const safe = "소송 전략은 제공하지 않으며 사실과 자료 정리를 돕겠습니다.";
  const { value, calls } = pipeline((phase) =>
    phase === "workspace_audit" ? approved : chatText(safe),
  );
  expect((await value.chat(confirmedChatContext(), "synthetic_refusal")).text).toBe(safe);
  expect(calls.map((call) => call.phase)).toEqual(["workspace_chat", "workspace_audit"]);
  expect(calls.at(-1)?.input).toMatchObject({ draft: { text: safe } });
});

test("exact refusal opening preserves factual preparation and full audit input", async () => {
  const safe =
    "소송 전략은 제공하지 않으며 사실과 자료 정리를 돕겠습니다.\n보유 자료와 아직 확인하지 못한 사실을 구분할 수 있습니다.";
  const { value, calls } = pipeline((phase) =>
    phase === "workspace_audit" ? approved : chatText(safe),
  );
  expect((await value.chat(confirmedChatContext(), "synthetic_preparation")).text).toBe(safe);
  expect(calls.at(-1)?.input).toMatchObject({ draft: { text: safe } });
});

test("a bounded chat audits the complete generation context without replacing its stored unfavorable or conflicting facts", async () => {
  const saved = confirmedChatContext();
  if (!saved.confirmedSummary || !saved.latestMessage) throw new Error("Missing chat context");
  saved.latestMessage.text =
    "이 합성 사건에서 소송 전략을 알려 주세요. 제공 범위를 벗어나면 그 점을 명확히 말하고, 확인된 사실과 준비할 자료만 정리해 주세요.";
  const statements = [
    "처음에는 송금했다고 말했습니다.",
    "나중에는 송금하지 않았다고 말했습니다.",
    "처음에는 발송했다고 말했습니다.",
    "나중에는 발송하지 않았다고 말했습니다.",
    "처음에는 수령했다고 말했습니다.",
    "나중에는 수령하지 않았다고 말했습니다.",
  ];
  saved.intake.narrative = statements.join(" ");
  saved.facts = statements.map((text, index) => ({
    ...reportedFact(text),
    id: `saved_fact_${index + 1}`,
    certainty: "conflicting" as const,
    significance: "unfavorable" as const,
    conflictingFactIds: [`saved_fact_${index % 2 === 0 ? index + 2 : index}`],
  }));
  saved.confirmedSummary.facts = saved.facts;
  saved.confirmedSummary.unknowns = ["원본 자료는 아직 확인하지 못했습니다."];
  saved.intake.summary = saved.confirmedSummary;
  saved.contextCoverage = {
    factsPartial: true,
    partiesPartial: false,
    summaryPartial: false,
    messagesPartial: true,
    materialsPartial: true,
  };
  const before = structuredClone(saved);
  const safe =
    "소송 전략은 제공하지 않으며 사실과 자료 정리를 돕겠습니다.\n서로 다른 진술과 확인하지 못한 부분을 구분하고, 보유한 기록이 있으면 정리해 주세요.";
  const { value, calls } = pipeline((phase) =>
    phase === "workspace_audit" ? approved : chatText(safe),
  );
  const result = await value.chat(saved, "synthetic_bounded_update");
  expect(result.facts).toEqual([]);
  expect(result.text).toBe(safe);
  expect(calls).toHaveLength(2);
  expect(calls[0]?.input).toEqual({ ...before, sourceLookupPerformed: false });
  expect(calls[1]?.input).toEqual({
    phase: "workspace_chat",
    context: calls[0]?.input,
    draft: { ...chatText(safe), requestedMaterials: [], requestedTools: [] },
  });
  expect(saved).toEqual(before);
});

test.each([false, true])(
  "critical text-only unsupported facts and contradictions are withheld even with empty fact IDs and pass=%s",
  async (pass) => {
    const saved = confirmedChatContext();
    const text =
      "소송 전략은 제공하지 않으며 사실과 자료 정리를 돕겠습니다.\n상대방의 요구는 없었고 모든 자료가 확인됐습니다.";
    const findings = [
      { severity: "critical", code: "unsupported_fact" },
      { severity: "critical", code: "contradiction" },
    ];
    const { value, calls } = pipeline((phase) =>
      phase === "workspace_audit" ? { ...approved, pass, findings } : chatText(text),
    );
    await expect(value.chat(saved, "synthetic_text_contradiction")).rejects.toMatchObject({
      reason: "audit_rejected",
      auditFailure: {
        pass,
        legalClaimsSupported: true,
        strategyDetected: false,
        findings,
        unsupportedFactCount: 0,
      },
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.input).toMatchObject({
      context: { intake: { narrative: saved.intake.narrative } },
      draft: { text, facts: [] },
    });
  },
);

test.each([
  { target: "response_text", basis: "current_fact" },
  { target: "response_text", basis: "assistant_history" },
  { target: "unknown", basis: "unknown" },
])("finding location metadata never changes critical rejection: %j", async (location) => {
  const text = "보유 기록을 정리해 주세요.";
  const findings = [{ severity: "critical", code: "contradiction", ...location }];
  const { value, calls } = pipeline((phase) =>
    phase === "workspace_audit" ? { ...approved, findings } : chatText(text),
  );
  await expect(
    value.chat(confirmedChatContext(), "synthetic_audit_location"),
  ).rejects.toMatchObject({
    reason: "audit_rejected",
    auditFailure: { pass: true, findings, unsupportedFactCount: 0 },
  });
  expect(calls).toHaveLength(2);
  expect(calls[1]?.input).toMatchObject({ draft: { text } });
});

test("factual preparation without the strategy phrase reaches the independent audit", async () => {
  const safe = "법률 판단을 대신할 수는 없으며 사실과 자료 정리를 돕겠습니다.";
  const { value, calls } = pipeline((phase) =>
    phase === "workspace_audit" ? approved : chatText(safe),
  );
  expect((await value.chat(confirmedChatContext(), "synthetic_neutral")).text).toBe(safe);
  expect(calls.map((call) => call.phase)).toEqual(["workspace_chat", "workspace_audit"]);
});

test.each([
  { severity: "warning", target: "source_claim", basis: "verified_source" },
  { severity: "critical", target: "response_text", basis: "verified_source" },
  { severity: "critical", target: "source_claim", basis: "assistant_history" },
])("unrelated audit findings do not acquire source claim reasons: %j", async (location) => {
  const findings = [{ code: "wrong_reference" as const, ...location }];
  const { value, calls } = pipeline((phase) =>
    phase === "workspace_audit"
      ? {
          ...approved,
          pass: false,
          findings: findings.map((finding) => ({
            ...finding,
            sourceClaimReason: "source_freshness",
          })),
        }
      : chatText("기록을 확인합니다."),
  );
  try {
    await value.chat(confirmedChatContext(), "synthetic_unrelated_audit_reason");
    throw new Error("Synthetic audit rejection was accepted");
  } catch (error) {
    expect(error).toBeInstanceOf(WorkspaceOutputPolicyError);
    expect((error as WorkspaceOutputPolicyError).auditFailure?.findings).toEqual(findings);
  }
  expect(calls).toHaveLength(2);
});

test.each(["fact", "action"])(
  "chat refusal exception never applies to a structured %s",
  async (field) => {
    const refusal = "소송 전략은 제공하지 않으며 사실과 자료 정리를 돕겠습니다.";
    const draft = {
      ...chatText(refusal),
      facts:
        field === "fact"
          ? [
              {
                id: "synthetic_fact",
                text: refusal,
                attribution: "ai_organization",
                certainty: "uncertain",
                significance: "neutral",
                references: [],
                conflictingFactIds: [],
                userEdited: false,
              },
            ]
          : [],
      actions:
        field === "action"
          ? [
              {
                id: "synthetic_action",
                revision: 1,
                kind: "organize_materials",
                title: "자료 정리",
                instructions: refusal,
                caution: "원문을 확인해 주세요.",
                status: "todo",
                factIds: [],
                references: [],
              },
            ]
          : [],
    };
    const { value, calls } = pipeline((phase) => (phase === "workspace_audit" ? approved : draft));
    await expect(value.chat(confirmedChatContext(), "synthetic_structured")).rejects.toMatchObject({
      reason: "prohibited_content",
    });
    expect(calls.map((call) => call.phase)).toEqual(["workspace_chat"]);
  },
);

test.each([
  "소송 전략으로 상대방에게 먼저 가압류를 예고하세요.",
  "협상 전략을 세워 합의금을 높게 요구하세요.",
  "승소 확률은 90%입니다.",
  "변호사로서 반드시 승소한다고 말씀드립니다.",
  "소송 전략은 제공하지 않으며 사실과 자료 정리를 돕겠습니다. 먼저 가압류를 예고하세요.",
  "소송 전략은 제공하지 않으며 사실과 자료 정리를 돕겠습니다.\n협상 전략으로 합의금을 높게 요구하세요.",
  '"소송 전략은 제공하지 않으며 사실과 자료 정리를 돕겠습니다."',
  "‘소송 전략은 제공하지 않으며 사실과 자료 정리를 돕겠습니다.’",
  "그는 소송 전략은 제공하지 않으며 사실과 자료 정리를 돕겠습니다.",
  "소송 전략을 제공하지 않는 것은 아닙니다.",
  "소송 전략은 제공하지 않으며 사실과 자료 정리를 돕겠습니다.라는 말은 사실이 아닙니다.",
  "소송 전략은 제공하지 않으며 사실과 자료 정리를 돕겠습니다. 연락처는 synthetic@example.test입니다.",
  "소송 전략은 제공하지 않으며 사실과 자료 정리를 돕겠습니다.\n연락처는 synthetic@example.test입니다.",
  "소송 전략은 제공하지 않으며 사실과 자료 정리를 돕겠습니다.\n연락처는 010-1234-5678입니다.",
  "소송 전략은 제공하지 않으며 사실과 자료 정리를 돕겠습니다.\n반드시 승소합니다.",
])("deterministic guard withholds prohibited synthetic output: %s", async (text) => {
  const { value, calls } = pipeline((phase) =>
    phase === "workspace_audit" ? approved : chatText(text),
  );
  await expect(value.chat(confirmedChatContext(), "synthetic_unsafe")).rejects.toMatchObject({
    reason: "prohibited_content",
  });
  expect(calls.map((call) => call.phase)).toEqual(["workspace_chat"]);
});

test.each([
  "상대방에게 먼저 가압류를 예고해 합의금을 높게 요구하세요.",
  "소송 전략은 제공하지 않으며 사실과 자료 정리를 돕겠습니다.",
  "소송 전략은 제공하지 않으며 사실과 자료 정리를 돕겠습니다.\n상대방에게 먼저 가압류를 예고해 합의금을 높게 요구하세요.",
])("a refusal cannot bypass independent audit rejection: %s", async (text) => {
  const { value, calls } = pipeline((phase) =>
    phase === "workspace_audit"
      ? {
          ...approved,
          pass: false,
          strategyDetected: true,
          findings: [{ severity: "critical", code: "legal_strategy" }],
          unsupportedFactIds: ["synthetic-private-fact"],
        }
      : chatText(text),
  );
  await expect(value.chat(confirmedChatContext(), "synthetic_audit")).rejects.toMatchObject({
    reason: "audit_rejected",
    auditFailure: {
      pass: false,
      legalClaimsSupported: true,
      strategyDetected: true,
      findings: [{ severity: "critical", code: "legal_strategy" }],
      unsupportedFactCount: 1,
    },
  });
  expect(calls.map((call) => call.phase)).toEqual(["workspace_chat", "workspace_audit"]);
  expect(calls.at(-1)?.input).toMatchObject({ draft: { text } });
});

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

test("unsupported fact details distinguish missing text, altered quotations and claim references without accepting them", () => {
  const saved = context();
  const rejected = (fact: V2Fact, claims: Parameters<typeof assertWorkspaceFacts>[2] = []) => {
    try {
      assertWorkspaceFacts(saved, [fact], claims);
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceOutputPolicyError);
      expect(error).toMatchObject({ reason: "unsupported_fact", code: "POLICY_REJECTED" });
      return (error as WorkspaceOutputPolicyError).factFailure;
    }
    throw new Error("Synthetic unsupported fact was accepted");
  };
  expect(rejected(reportedFact("상대방이 합의금 500만원을 요구했습니다."))).toEqual({
    category: "source_text_mismatch",
    attribution: "user_statement",
    referenceKind: "intake_narrative",
    factCount: 1,
    referenceCount: 1,
    availableSourceCount: 1,
  });
  // Missing trusted text is distinct from a changed quote even when the ref is authorized.
  saved.references.answeredQuestionIds = ["q2"];
  expect(
    rejected({
      ...reportedFact("확인한 내용"),
      references: [{ kind: "intake_answer", questionId: "q2", intakeRevision: 3 }],
    }),
  ).toMatchObject({
    category: "source_text_unavailable",
    referenceKind: "intake_answer",
    availableSourceCount: 0,
  });
  saved.references.verifiedCitationIds = ["citation_a", "citation_b"];
  const official: V2Fact = {
    ...reportedFact("공식 자료의 합성 문장"),
    attribution: "official_source",
    references: [{ kind: "official_source", citationId: "citation_a" }],
  };
  expect(rejected(official)).toMatchObject({
    category: "claim_text_missing",
    attribution: "official_source",
    referenceKind: "official_source",
    availableSourceCount: 0,
  });
  const claim = {
    id: "synthetic_claim",
    text: official.text,
    kind: "quotation" as const,
    citationId: "citation_b",
    startUtf16: 0,
    endUtf16: official.text.length,
  };
  expect(rejected(official, [claim])).toMatchObject({
    category: "claim_reference_mismatch",
    availableSourceCount: 1,
  });
  expect(() =>
    assertWorkspaceFacts(saved, [official], [{ ...claim, citationId: "citation_a" }]),
  ).not.toThrow();
  expect(() =>
    assertWorkspaceFacts(saved, [reportedFact("상대방이 합의금 300만원을 요구했습니다.")]),
  ).not.toThrow();
});

test("summary paraphrase rejection forwards only safe source detail and audits the exact replacement", async () => {
  let generated = 0;
  const saved = context();
  const before = structuredClone(saved);
  const { value, calls } = pipeline((phase, input) => {
    if (phase === "workspace_audit") {
      expect(input).toMatchObject({ phase: "workspace_summary" });
      return approved;
    }
    generated += 1;
    expect(input).toEqual(
      generated === 1
        ? before
        : {
            ...before,
            draftCorrection: {
              reason: "unsupported_fact",
              factFailure: {
                category: "source_text_mismatch",
                referenceKind: "intake_narrative",
              },
            },
          },
    );
    return {
      overview: "상대방에게 받은 요구와 보유 자료를 확인하는 요약입니다.",
      facts: [
        reportedFact(
          generated === 1
            ? "상대방은 합의금으로 300만원을 요구했습니다."
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
  expect(saved).toEqual(before);
});

test("an answer quote cannot gain its question context and retries with the exact answer source", async () => {
  const saved = context();
  const batch = saved.intake.batches[0];
  if (!batch) throw new Error("Synthetic batch absent");
  batch.answers = [{ questionId: "q2", status: "answered", value: "지난달입니다." }];
  saved.references.answeredQuestionIds = ["q2"];
  const before = structuredClone(saved);
  let generated = 0;
  const { value, calls } = pipeline((phase, input) => {
    if (phase === "workspace_audit") return approved;
    generated++;
    if (generated === 2)
      expect(input).toEqual({
        ...before,
        draftCorrection: {
          reason: "unsupported_fact",
          factFailure: { category: "source_text_mismatch", referenceKind: "intake_answer" },
        },
      });
    return {
      overview: "사건 시점에 대한 사용자 답변을 정리합니다.",
      facts: [
        {
          ...reportedFact(generated === 1 ? "사건은 지난달입니다." : "지난달입니다."),
          references: [{ kind: "intake_answer", questionId: "q2", intakeRevision: 3 }],
        },
      ],
      parties: [],
      unknowns: [],
      notices: ["사용자 확인이 필요합니다."],
    };
  });
  expect((await value.summary(saved, "synthetic-answer")).facts[0]?.text).toBe("지난달입니다.");
  expect(calls.map((call) => call.phase)).toEqual([
    "workspace_summary",
    "workspace_summary",
    "workspace_audit",
  ]);
  expect(saved).toEqual(before);
});

test.each(["paraphrase", "official_source", "private_quote"] as const)(
  "summary %s remains rejected after its one correction and never reaches audit",
  async (kind) => {
    const saved = context();
    saved.references.verifiedCitationIds = ["synthetic_citation"];
    saved.intake.narrative += " 연락처는 synthetic@example.test입니다.";
    const fact =
      kind === "official_source"
        ? {
            ...reportedFact("공식 자료의 합성 문장"),
            attribution: "official_source" as const,
            references: [{ kind: "official_source" as const, citationId: "synthetic_citation" }],
          }
        : reportedFact(
            kind === "private_quote"
              ? "연락처는 synthetic@example.test입니다."
              : "상대방은 합의금으로 300만원을 요구했습니다.",
          );
    const { value, calls } = pipeline(() => ({
      overview: "사용자 진술을 정리합니다.",
      facts: [fact],
      parties: [],
      unknowns: [],
      notices: ["사용자 확인이 필요합니다."],
    }));
    await expect(value.summary(saved, "synthetic-invalid-summary")).rejects.toMatchObject({
      code: "POLICY_REJECTED",
      reason: kind === "private_quote" ? "prohibited_content" : "unsupported_fact",
    });
    expect(calls.map((call) => call.phase)).toEqual(["workspace_summary", "workspace_summary"]);
    const corrected = calls[1];
    if (!corrected) throw new Error("Synthetic correction absent");
    const correction = (corrected.input as { draftCorrection: unknown }).draftCorrection;
    expect(correction).toEqual(
      kind === "private_quote"
        ? { reason: "prohibited_content" }
        : {
            reason: "unsupported_fact",
            factFailure: {
              category: kind === "official_source" ? "claim_text_missing" : "source_text_mismatch",
              referenceKind: kind === "official_source" ? "official_source" : "intake_narrative",
            },
          },
    );
  },
);

test("draft correction never forwards unrecognized detail or extra error properties", async () => {
  let generated = 0;
  const saved = context();
  const { value, calls } = pipeline((phase, input) => {
    if (phase === "workspace_audit") return approved;
    generated++;
    if (generated === 1)
      throw new WorkspaceOutputPolicyError("unsupported_fact", {
        category: "synthetic-private-error",
        referenceKind: "synthetic-private-reference",
        attribution: "user_statement",
        factCount: 1,
        referenceCount: 1,
        availableSourceCount: 1,
        text: "synthetic-private-draft",
        sourceId: "synthetic-private-source",
      } as unknown as ConstructorParameters<typeof WorkspaceOutputPolicyError>[1]);
    expect(input).toEqual({
      ...saved,
      draftCorrection: {
        reason: "unsupported_fact",
        factFailure: { category: "unknown", referenceKind: "unknown" },
      },
    });
    return {
      overview: "사용자 진술을 정리합니다.",
      facts: [reportedFact("상대방이 합의금 300만원을 요구했습니다.")],
      parties: [],
      unknowns: [],
      notices: ["사용자 확인이 필요합니다."],
    };
  });
  expect((await value.summary(saved, "synthetic-allowlist")).facts).toHaveLength(1);
  expect(calls).toHaveLength(3);
});

test.each(["user_message", "user_material"] as const)(
  "chat %s facts still require exact excerpts and independently audit accepted quotes",
  async (kind) => {
    const saved = confirmedChatContext();
    const text = "계약서를 보관했습니다.";
    if (!saved.latestMessage) throw new Error("Synthetic message absent");
    saved.latestMessage.text = text;
    const reference =
      kind === "user_message"
        ? {
            kind,
            messageId: saved.latestMessage.id,
            workspaceRevision: saved.latestMessage.workspaceRevision,
          }
        : {
            kind,
            fileId: "synthetic_file",
            fileRevision: 1,
            position: { kind: "document" as const, page: 1, paragraph: null, table: null },
          };
    if (reference.kind === "user_message")
      saved.references.messages = [
        { id: reference.messageId, workspaceRevision: reference.workspaceRevision },
      ];
    else {
      saved.references.files = [
        {
          id: reference.fileId,
          revision: reference.fileRevision,
          category: "document",
          pageCount: 1,
        },
      ];
      saved.materials = [{ reference, text, coverage: {} }];
    }
    for (const exact of [false, true]) {
      const { value, calls } = pipeline((phase) =>
        phase === "workspace_audit"
          ? approved
          : {
              ...chatText("보관한 자료를 확인했습니다."),
              facts: [
                {
                  ...reportedFact(exact ? text : "사용자는 계약서를 보관했습니다."),
                  attribution: kind === "user_material" ? "user_material" : "user_statement",
                  references: [reference],
                },
              ],
            },
      );
      if (exact) {
        expect((await value.chat(saved, "synthetic-chat-exact")).facts[0]?.text).toBe(text);
        expect(calls.map((call) => call.phase)).toEqual(["workspace_chat", "workspace_audit"]);
      } else {
        await expect(value.chat(saved, "synthetic-chat-altered")).rejects.toMatchObject({
          reason: "unsupported_fact",
          factFailure: { category: "source_text_mismatch", referenceKind: kind },
        });
        expect(calls.map((call) => call.phase)).toEqual(["workspace_chat"]);
      }
    }
  },
);

test("chat generation is told the exact standalone refusal contract enforced by the guard", async () => {
  const { prompts } = await import("../src/server/modules/llm-gateway/prompts");
  expect(prompts.workspace_chat).toContain(
    "소송 전략은 제공하지 않으며 사실과 자료 정리를 돕겠습니다.",
  );
  expect(prompts.workspace_chat).toContain("entire first line");
  expect(prompts.workspace_chat).toContain("facts, actions, timeline or parties");
});

test("chat generation and audit share bounded-update semantics while audit retains full-summary and relevant-counterevidence checks", async () => {
  const { prompts, workspaceStrategyRefusal } = await import(
    "../src/server/modules/llm-gateway/prompts"
  );
  for (const prompt of [prompts.workspace_chat, prompts.workspace_audit]) {
    expect(prompt).toContain(
      "The chat response and proposed additions are a bounded update, not a replacement of the confirmed summary or stored facts.",
    );
    expect(prompt).toContain("selective omission that makes the response misleading is prohibited");
  }
  expect(prompts.workspace_audit).toContain(
    "For workspace_summary, reject omitted material contradictory/unfavorable facts, fabricated references and falsely complete coverage across the whole summary.",
  );
  expect(prompts.workspace_audit).toContain(
    `The exact standalone first line "${workspaceStrategyRefusal}"`,
  );
  expect(prompts.workspace_audit).toContain(
    "audit all following text and structured fields normally",
  );
  expect(prompts.workspace_audit).toContain(
    "Reject distorted existing facts, omitted relevant counterevidence",
  );
  expect(prompts.workspace_audit).toContain("including claims in text without a facts[] ID");
  expect(prompts.workspace_audit).toContain("If any critical issue exists, pass=false.");
});

test.each([
  "소송 전략은 알려드릴 수 없지만 확인된 사실과 자료를 정리해 드리겠습니다.",
  "**소송 전략은 제공하지 않으며 사실과 자료 정리를 돕겠습니다.**",
  "소송 전략은 제공하지 않으며 사실과 자료 정리를 돕겠습니다. 자료를 정리할 수 있습니다.",
])("a noncanonical refusal remains withheld before audit: %s", async (text) => {
  const { value, calls } = pipeline((phase) =>
    phase === "workspace_audit" ? approved : chatText(text),
  );
  await expect(value.chat(confirmedChatContext(), "synthetic_variant")).rejects.toMatchObject({
    reason: "prohibited_content",
  });
  expect(calls.map((call) => call.phase)).toEqual(["workspace_chat"]);
});

test.each([
  ["소송 전략은 알려드릴 수 없어요.", "strategy", false],
  [
    "소송 전략은 제공하지 않으며 사실과 자료 정리를 돕겠습니다.\n협상 전략을 세워야 합니다.",
    "strategy",
    true,
  ],
  [
    "소송 전략은 제공하지 않으며 사실과 자료 정리를 돕겠습니다.\n반드시 승소합니다.",
    "outcome_claim",
    true,
  ],
  [
    "소송 전략은 제공하지 않으며 사실과 자료 정리를 돕겠습니다.\n변호사로서 설명합니다.",
    "professional_role",
    true,
  ],
  [
    "소송 전략은 제공하지 않으며 사실과 자료 정리를 돕겠습니다.\n연락처는 synthetic@example.test입니다.",
    "private_identifier",
    true,
  ],
])(
  "chat policy receipt identifies only the matching text category: %s",
  async (text, category, canonical) => {
    const { value, calls } = pipeline((phase) =>
      phase === "workspace_audit" ? approved : chatText(text),
    );
    await expect(value.chat(confirmedChatContext(), "synthetic_receipt")).rejects.toMatchObject({
      reason: "prohibited_content",
      contentFailure: { field: "chat_text", category, canonicalRefusalOpening: canonical },
    });
    expect(calls.map((call) => call.phase)).toEqual(["workspace_chat"]);
  },
);

function diagnosticFirst<T>(values: T[]): T {
  const value = values[0];
  if (!value) throw new Error("Synthetic diagnostic entity absent");
  return value;
}
function diagnosticDraft() {
  const fact: V2Fact = {
    id: "private-synthetic-fact-id",
    text: "확인이 더 필요할 수 있습니다.",
    attribution: "ai_organization",
    certainty: "uncertain",
    significance: "neutral",
    references: [],
    conflictingFactIds: [],
    userEdited: false,
  };
  return {
    ...chatText("소송 전략은 제공하지 않으며 사실과 자료 정리를 돕겠습니다."),
    facts: [fact],
    actions: [
      {
        id: "private-synthetic-action-id",
        revision: 1,
        kind: "organize_materials" as const,
        title: "자료 정리",
        instructions: "보관된 자료를 확인해 주세요.",
        caution: "원본을 확인해 주세요.",
        status: "todo" as "todo" | "done",
        factIds: [] as string[],
        references: [],
      },
    ],
    timeline: [
      {
        id: "private-synthetic-timeline-id",
        revision: 1,
        date: null,
        datePrecision: "unknown" as const,
        event: "날짜가 확인되지 않았습니다.",
        certainty: "uncertain" as const,
        references: [],
        factIds: [] as string[],
        userEdited: false,
      },
    ],
    parties: [{ id: "private-synthetic-party-id", label: "상대방", role: "당사자" }],
  };
}

test.each([
  [
    "fact_relation",
    "duplicate_fact_id",
    (draft: ReturnType<typeof diagnosticDraft>, saved: WorkspaceContext) => {
      saved.facts = [structuredClone(diagnosticFirst(draft.facts))];
    },
  ],
  [
    "fact_relation",
    "unknown_conflicting_fact",
    (draft: ReturnType<typeof diagnosticDraft>) => {
      diagnosticFirst(draft.facts).certainty = "conflicting";
      diagnosticFirst(draft.facts).conflictingFactIds = ["private-missing-id"];
    },
  ],
  [
    "action_state",
    "invalid_revision",
    (draft: ReturnType<typeof diagnosticDraft>) => {
      diagnosticFirst(draft.actions).revision = 2;
    },
  ],
  [
    "action_state",
    "invalid_status",
    (draft: ReturnType<typeof diagnosticDraft>) => {
      diagnosticFirst(draft.actions).status = "done";
    },
  ],
  [
    "action_relation",
    "unknown_fact",
    (draft: ReturnType<typeof diagnosticDraft>) => {
      diagnosticFirst(draft.actions).factIds = ["private-missing-id"];
    },
  ],
  [
    "action_text",
    "strategy",
    (draft: ReturnType<typeof diagnosticDraft>) => {
      diagnosticFirst(draft.actions).instructions =
        "소송 전략은 제공하지 않으며 사실과 자료 정리를 돕겠습니다.";
    },
  ],
  [
    "timeline_state",
    "invalid_revision",
    (draft: ReturnType<typeof diagnosticDraft>) => {
      diagnosticFirst(draft.timeline).revision = 2;
    },
  ],
  [
    "timeline_state",
    "user_edited",
    (draft: ReturnType<typeof diagnosticDraft>) => {
      diagnosticFirst(draft.timeline).userEdited = true;
    },
  ],
  [
    "timeline_relation",
    "unknown_fact",
    (draft: ReturnType<typeof diagnosticDraft>) => {
      diagnosticFirst(draft.timeline).factIds = ["private-missing-id"];
    },
  ],
  [
    "timeline_event",
    "strategy",
    (draft: ReturnType<typeof diagnosticDraft>) => {
      diagnosticFirst(draft.timeline).event = "협상 전략을 세웠습니다.";
    },
  ],
  [
    "party",
    "professional_role",
    (draft: ReturnType<typeof diagnosticDraft>) => {
      diagnosticFirst(draft.parties).role = "변호사로서 설명합니다.";
    },
  ],
] as const)(
  "chat policy receipt separates %s / %s without retaining entity IDs",
  async (field, category, change) => {
    const draft = diagnosticDraft(),
      saved = confirmedChatContext();
    change(draft, saved);
    const { value, calls } = pipeline((phase) => (phase === "workspace_audit" ? approved : draft));
    let failure: WorkspaceOutputPolicyError | undefined;
    try {
      await value.chat(saved, "synthetic_structural_receipt");
    } catch (error) {
      if (error instanceof WorkspaceOutputPolicyError) failure = error;
      else throw error;
    }
    expect(failure?.reason).toBe("prohibited_content");
    expect(failure?.contentFailure).toEqual({ field, category, canonicalRefusalOpening: true });
    expect(JSON.stringify(failure?.contentFailure)).not.toContain("private-");
    expect(calls.map((call) => call.phase)).toEqual(["workspace_chat"]);
  },
);

test.each(["private_identifier", "strategy"] as const)(
  "fact receipt preserves the original %s guard",
  async (category) => {
    const draft = diagnosticDraft();
    diagnosticFirst(draft.facts).text =
      category === "strategy" ? "소송 전략을 세워야 합니다." : "synthetic@example.test";
    const { value } = pipeline((phase) => (phase === "workspace_audit" ? approved : draft));
    await expect(
      value.chat(confirmedChatContext(), "synthetic_fact_receipt"),
    ).rejects.toMatchObject({
      reason: "prohibited_content",
      contentFailure: { field: "fact_text", category, canonicalRefusalOpening: null },
    });
  },
);

test("structured preparation body gets one freshly admitted correction with unchanged content guards and final audit", async () => {
  const saved = confirmedChatContext();
  const action = {
    id: "check_record",
    revision: 1,
    kind: "organize_materials",
    title: "보유 자료 확인",
    instructions: "가지고 있는 자료가 있는지 확인해 주세요.",
    caution: "기억나지 않는 부분은 미확인으로 남겨 주세요.",
    status: "todo",
    factIds: [],
    references: [],
  };
  let generated = 0;
  const p = pipeline((phase, input) => {
    if (phase === "workspace_audit") {
      expect(input).toMatchObject({
        draft: { text: "보유 자료를 확인하는 준비 항목을 정리했어요." },
      });
      return approved;
    }
    generated++;
    if (generated === 2)
      expect(input).toMatchObject({
        draftCorrection: { contentFailure: { field: "chat_text", category: "strategy" } },
      });
    return {
      ...chatText(
        generated === 1
          ? "소송 전략은 추가하지 않고 준비 항목을 정리했어요."
          : "보유 자료를 확인하는 준비 항목을 정리했어요.",
      ),
      actions: [action],
    };
  });
  const result = await p.value.chat(saved, "synthetic_preparation_recovery");
  expect(result.actions).toHaveLength(1);
  expect(p.calls.map((call) => call.phase)).toEqual([
    "workspace_chat",
    "workspace_chat",
    "workspace_audit",
  ]);
  expect(new Set(p.calls.map((call) => call.invocation)).size).toBe(3);
});

test("a second prohibited preparation body stays private without a third generation or audit bypass", async () => {
  const p = pipeline(() => ({
    ...chatText("소송 전략을 추가하지 않고 정리했어요."),
    actions: [
      {
        id: "check_record",
        revision: 1,
        kind: "organize_materials",
        title: "자료 보유 확인",
        instructions: "보유한 자료가 있는지 확인해 주세요.",
        caution: "모르면 미확인으로 남겨 주세요.",
        status: "todo",
        factIds: [],
        references: [],
      },
    ],
  }));
  await expect(
    p.value.chat(confirmedChatContext(), "synthetic_preparation_stopped"),
  ).rejects.toMatchObject({ reason: "prohibited_content" });
  expect(p.calls.map((call) => call.phase)).toEqual(["workspace_chat", "workspace_chat"]);
});

const timelineRejection = {
  ...approved,
  pass: false,
  findings: [
    {
      severity: "critical",
      code: "unsupported_fact",
      target: "timeline",
      basis: "intake_narrative",
    },
  ],
};
function timelineRepairDraft(repaired: boolean) {
  return {
    ...chatText("약속한 기한에 관한 진술을 정리했어요."),
    timeline: [
      {
        id: "reported_deadline",
        revision: 1,
        date: null,
        datePrecision: "unknown",
        event: repaired
          ? "9월 30일까지 돌려받기로 한 약속이며 실제 반환 여부는 미확인입니다."
          : "9월 30일에 전액 반환받았습니다.",
        certainty: "reported",
        factIds: [],
        userEdited: false,
        references: [{ kind: "intake_narrative", intakeRevision: 3 }],
      },
    ],
  };
}
for (const repaired of [true, false]) {
  test(`timeline-only source rejection gets one fresh generation and full audit, repaired=${repaired}`, async () => {
    const saved = confirmedChatContext();
    saved.intake.narrative =
      "2026년 9월 1일에 돈을 빌려줬고 9월 30일까지 돌려받기로 했으나 아직 받지 못했습니다.";
    let generations = 0,
      audits = 0;
    const p = pipeline((phase, input) => {
      if (phase === "workspace_audit") {
        audits++;
        return audits === 2 && repaired ? approved : timelineRejection;
      }
      generations++;
      if (generations === 2) {
        const correction = (input as { draftCorrection: unknown }).draftCorrection;
        expect(correction).toEqual({
          reason: "audit_rejected",
          auditFailure: { code: "unsupported_fact", target: "timeline", basis: "intake_narrative" },
        });
        expect(JSON.stringify(correction)).not.toContain("전액 반환");
      }
      return timelineRepairDraft(generations === 2);
    });
    if (repaired)
      expect((await p.value.chat(saved, "synthetic_timeline_repair")).timeline[0]?.event).toContain(
        "약속",
      );
    else
      await expect(p.value.chat(saved, "synthetic_timeline_repair")).rejects.toMatchObject({
        reason: "audit_rejected",
      });
    expect(p.calls.map((call) => call.phase)).toEqual([
      "workspace_chat",
      "workspace_audit",
      "workspace_chat",
      "workspace_audit",
    ]);
    expect(new Set(p.calls.map((call) => call.invocation)).size).toBe(4);
    expect(generations).toBe(2);
  });
}

test("mixed critical audit findings cannot enter timeline correction", async () => {
  const p = pipeline((phase) =>
    phase === "workspace_audit"
      ? {
          ...timelineRejection,
          findings: [
            ...timelineRejection.findings,
            { severity: "critical", code: "privacy", target: "response_text", basis: "policy" },
          ],
        }
      : timelineRepairDraft(false),
  );
  await expect(p.value.chat(confirmedChatContext(), "synthetic_mixed_audit")).rejects.toMatchObject(
    { reason: "audit_rejected" },
  );
  expect(p.calls.map((call) => call.phase)).toEqual(["workspace_chat", "workspace_audit"]);
});

test("timeline correction cannot request new lookup side effects", async () => {
  let generations = 0;
  const p = pipeline((phase) =>
    phase === "workspace_audit"
      ? timelineRejection
      : {
          ...timelineRepairDraft(++generations === 2),
          requestedTools: generations === 2 ? ["thecheat"] : [],
        },
  );
  await expect(
    p.value.chat(confirmedChatContext(), "synthetic_repair_lookup"),
  ).rejects.toMatchObject({ reason: "unauthorized_reference" });
  expect(p.calls.map((call) => call.phase)).toEqual([
    "workspace_chat",
    "workspace_audit",
    "workspace_chat",
  ]);
});

test("body and timeline rejection share the same single correction ceiling", async () => {
  let generations = 0;
  const p = pipeline((phase) =>
    phase === "workspace_audit"
      ? timelineRejection
      : {
          ...timelineRepairDraft(false),
          text:
            ++generations === 1
              ? "소송 전략을 추가하지 않고 정리했어요."
              : "약속된 기한을 정리했어요.",
        },
  );
  await expect(
    p.value.chat(confirmedChatContext(), "synthetic_shared_repair_limit"),
  ).rejects.toMatchObject({ reason: "audit_rejected" });
  expect(p.calls.map((call) => call.phase)).toEqual([
    "workspace_chat",
    "workspace_chat",
    "workspace_audit",
  ]);
});
