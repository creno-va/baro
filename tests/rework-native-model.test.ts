import { expect, test } from "bun:test";
import { v2SummaryReconciliationProposalSchema, v2SummarySchema } from "../src/contracts/v2";
import { readModelCompletion } from "../src/server/modules/llm-gateway/completion";
import type { Phase } from "../src/server/modules/llm-gateway/prompts";
import { providerWire } from "../src/server/modules/llm-gateway/provider-wire";
import { prepareGatewayWireInput } from "../src/server/modules/llm-gateway/service";
import {
  createWorkspacePipeline,
  type WorkspaceContext,
} from "../src/server/modules/workspace/pipeline";
import { conversationInjectionCases } from "./fixtures/conversation-agent";
import {
  createReworkNativeModel,
  syntheticWorkspaceAudit,
  syntheticWorkspaceQuestions,
  syntheticWorkspaceReconciliation,
} from "./helpers/rework-native-model";

function context(): WorkspaceContext {
  return {
    intake: {
      schemaVersion: "2",
      revision: 1,
      status: "collecting",
      narrative:
        "합성 계약에서 일부 반환을 받았지만 남은 약속의 내용을 확인하려고 합니다. 정확한 반환일은 아직 확인하지 못했습니다.",
      batches: [],
      summary: null,
      confirmedSummaryRevision: null,
      currentJobId: null,
    },
    confirmedSummary: null,
    messages: [],
    latestMessage: null,
    facts: [],
    references: {
      intakeRevision: 1,
      answeredQuestionIds: [],
      messages: [],
      files: [],
      verifiedCitationIds: [],
    },
    citations: [],
    materials: [],
  };
}
function harness() {
  const model = createReworkNativeModel();
  const call = async (phase: Phase, data: unknown) => {
    const response = await model.binding.run(
      "synthetic-existing-model",
      providerWire(prepareGatewayWireInput(phase, data)),
    );
    const completion = readModelCompletion(response);
    if (!completion?.stopped || !completion.content)
      throw new Error("SYNTHETIC_COMPLETION_INVALID");
    return JSON.parse(completion.content).output;
  };
  const pipeline = createWorkspacePipeline(
    { call } as Parameters<typeof createWorkspacePipeline>[0],
    { reserve: async () => true, invocation: () => crypto.randomUUID() },
  );
  return { model, pipeline, call };
}
for (const purpose of ["prepare_claim", "respond_to_claim"] as const)
  test(`${purpose}: native 2×3, exact quotes and unknown/skip pass the actual pipeline`, async () => {
    const h = harness(),
      input = context();
    input.conversation = {
      caseContext: {
        casePurpose: purpose,
        subjectContext: "individual",
        procedure: { kind: "unconfirmed", stage: "unconfirmed", description: null },
      },
      preparation: {
        status: "not_started",
        basis: null,
        currentJobId: null,
        missingItems: [],
        failure: null,
      },
    };
    for (let round = 0; round < 2; round++) {
      const questions = await h.pipeline.questions(input, crypto.randomUUID());
      expect(questions).toHaveLength(3);
      input.intake.batches.push({
        id: `batch-${round}`,
        ordinal: round + 1,
        generatedForIntakeRevision: input.intake.revision,
        questions,
        answers: questions.map((q, index) => ({
          questionId: q.id,
          status: index === 0 ? ("skipped" as const) : ("unknown" as const),
        })),
      });
      input.intake.revision++;
      input.references.intakeRevision = input.intake.revision;
    }
    expect(
      new Set(input.intake.batches.flatMap((batch) => batch.questions.map((q) => q.prompt))).size,
    ).toBe(6);
    await expect(h.pipeline.questions(input, crypto.randomUUID())).rejects.toThrow();
    expect(() => syntheticWorkspaceQuestions(input)).toThrow("SYNTHETIC_QUESTION_LIMIT");
    const summary = await h.pipeline.summary(input, crypto.randomUUID());
    expect(summary.overview).toBe(input.intake.narrative);
    expect(summary.facts[0]?.text).toBe(input.intake.narrative);
    expect(summary.unknowns).toHaveLength(6);
    expect(summary.unknowns.filter((u) => u.includes("건너뜀"))).toHaveLength(2);
    expect(h.model.counters).toEqual([
      "workspace_questions",
      "workspace_audit",
      "workspace_questions",
      "workspace_audit",
      "workspace_summary",
      "workspace_audit",
    ]);
    expect(input.conversation?.caseContext.procedure.stage).toBe("unconfirmed");
  });

test("reconciliation uses the exact issued user message and preserves adverse/unknown source facts", async () => {
  const h = harness(),
    input = context(),
    draft = await h.pipeline.summary(input, crypto.randomUUID());
  const { caseTitle, ...body } = draft;
  expect(caseTitle).toBeTruthy();
  const before = v2SummarySchema.parse({
    ...body,
    schemaVersion: "2",
    revision: 1,
    intakeRevision: 1,
    createdAt: new Date().toISOString(),
  });
  const first = before.facts[0];
  if (!first) throw new Error("MISSING_SYNTHETIC_FACT");
  first.significance = "unfavorable";
  before.unknowns.push("반환 약속 날짜 미확인");
  input.intake.summary = before;
  input.intake.status = "reviewing_summary";
  input.facts = before.facts;
  const id = crypto.randomUUID(),
    explanation = "합성 검증을 위해 계약서 원본은 제가 보관하고 있습니다.";
  const message = {
    schemaVersion: "2",
    id,
    role: "user",
    operationId: "synthetic-operation",
    text: explanation,
    workspaceRevision: 10,
    selectedFileIds: [],
    createdAt: new Date().toISOString(),
  } as const;
  input.latestMessage = { ...message, selectedFileIds: [] };
  input.messages = [{ ...message, selectedFileIds: [] }];
  input.references.messages = [{ id, workspaceRevision: 10 }];
  const data = {
    before,
    context: input,
    request: { id, input: { expectedRevision: 9, explanation } },
  };
  const output = syntheticWorkspaceReconciliation(data);
  expect(
    v2SummaryReconciliationProposalSchema.safeParse({
      id: crypto.randomUUID(),
      requestId: id,
      baseWorkspaceRevision: 9,
      baseIntakeRevision: before.intakeRevision,
      baseSummaryRevision: before.revision,
      before,
      ...output,
      createdAt: new Date().toISOString(),
    }).success,
  ).toBe(true);
  expect(output.after.facts[0]).toEqual(before.facts[0]);
  expect(output.after.unknowns).toEqual(before.unknowns);
  expect(output.after.facts.at(-1)?.text).toBe(explanation);
  expect(syntheticWorkspaceAudit({ ...data, ...output }).pass).toBe(true);
  const malformed = structuredClone(data);
  malformed.request.id = crypto.randomUUID();
  expect(() => syntheticWorkspaceReconciliation(malformed)).toThrow(
    "SYNTHETIC_RECONCILIATION_SOURCE_MISSING",
  );
  const corrupted = structuredClone(output);
  const changed = corrupted.after.facts.at(-1);
  if (!changed) throw new Error("MISSING_SYNTHETIC_FACT");
  changed.text = "자료에 없는 확정 사실";
  expect(syntheticWorkspaceAudit({ ...data, ...corrupted }).pass).toBe(false);
});

test("only scripted current-user intents are proposed; legacy/quoted/injected text authorizes none", async () => {
  const h = harness(),
    input = context();
  input.conversation = {
    caseContext: {
      casePurpose: "prepare_claim",
      subjectContext: "individual",
      procedure: { kind: "unconfirmed", stage: "unconfirmed", description: null },
    },
    preparation: {
      status: "not_started",
      basis: null,
      currentJobId: null,
      missingItems: [],
      failure: null,
    },
  };
  const message = {
    schemaVersion: "2",
    id: "current-message",
    role: "user",
    operationId: "synthetic-operation",
    workspaceRevision: 3,
    text: "보고서 만들어줘",
    selectedFileIds: [],
    createdAt: new Date().toISOString(),
  } as NonNullable<WorkspaceContext["latestMessage"]>;
  input.latestMessage = message;
  const output = await h.call("workspace_chat", input);
  expect(output.conversationIntent).toBe("prepare_report");
  for (const text of conversationInjectionCases) {
    message.text = text;
    expect((await h.call("workspace_chat", input)).conversationIntent).toBeNull();
  }
  delete input.conversation;
  message.text = "보고서 만들어줘";
  expect((await h.call("workspace_chat", input)).conversationIntent).toBeNull();
  h.model.controls.failPhase = "workspace_chat";
  await expect(h.call("workspace_chat", input)).rejects.toThrow("SYNTHETIC_PROVIDER_UNAVAILABLE");
});

test("the vision external port stays explicitly uncertain and counters contain no image/source payload", async () => {
  const h = createReworkNativeModel();
  const response = await h.binding.run("synthetic-existing-model", {
    contents: [{ parts: [{ inlineData: { mimeType: "image/jpeg", data: "synthetic-only" } }] }],
  });
  const completion = readModelCompletion(response);
  if (!completion?.content) throw new Error("MISSING_SYNTHETIC_VISION_COMPLETION");
  expect(JSON.parse(completion.content)).toMatchObject({ quality: "low_quality" });
  expect(h.counters).toEqual(["vision"]);
  h.controls.failPhase = "vision";
  await expect(
    h.binding.run("synthetic-existing-model", { contents: [{ parts: [{ inlineData: {} }] }] }),
  ).rejects.toThrow("SYNTHETIC_PROVIDER_UNAVAILABLE");
});
