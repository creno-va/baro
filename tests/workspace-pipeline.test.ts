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

test("factual preparation without the strategy phrase reaches the independent audit", async () => {
  const safe = "법률 판단을 대신할 수는 없으며 사실과 자료 정리를 돕겠습니다.";
  const { value, calls } = pipeline((phase) =>
    phase === "workspace_audit" ? approved : chatText(safe),
  );
  expect((await value.chat(confirmedChatContext(), "synthetic_neutral")).text).toBe(safe);
  expect(calls.map((call) => call.phase)).toEqual(["workspace_chat", "workspace_audit"]);
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
