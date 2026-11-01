import { z } from "zod";
import type { V2ConversationIntent, V2Fact } from "../../src/contracts/v2";
import { v2IntakeSchema, v2SummarySchema } from "../../src/contracts/v2";
import { assertReconciliationPreserves } from "../../src/server/modules/intake/summary-reconciliation";
import type { Phase } from "../../src/server/modules/llm-gateway/prompts";
import {
  summaryReconciliationOutputSchema,
  workspaceAuditOutputSchema,
  workspaceChatOutputSchema,
  workspaceQuestionsOutputSchema,
  workspaceSummaryOutputSchema,
} from "../../src/server/modules/llm-gateway/v2/schemas";
import {
  assertWorkspaceFacts,
  type WorkspaceContext,
} from "../../src/server/modules/workspace/pipeline";
import { conversationIntentCases } from "../fixtures/conversation-agent";
import { syntheticGatewayInput } from "./gateway-input";

/** Scripted EXTERNAL model replies, never an application result or an NLP
 * implementation. Product parsing, independent gateway invocation, source
 * checks, permissions, admission and publication still run unchanged. */
const prompts = [
  "추가로 기억하는 약속의 경위가 있나요?",
  "자료가 작성된 경위를 따로 알고 있나요?",
  "상대방에게 전달한 기록이 있는지 알고 있나요?",
  "별도로 확인할 수 있는 자료 보관처가 있나요?",
  "현재 약속과 다른 설명을 들은 적이 있나요?",
  "앞으로 확인할 일정이 정해져 있나요?",
];
const scriptedIntents = new Map<string, V2ConversationIntent>([
  ...conversationIntentCases.map(({ text, action }) => [text, action] as const),
  ["계약서 자료를 추가해서 확인하고 싶어요.", "add_material"],
  ["현재 확인한 내용으로 보고서를 준비해 주세요.", "prepare_report"],
]);
function context(raw: unknown): WorkspaceContext {
  // Private model context carries additional server metadata (unlike the
  // strict public DTO). Keep every known intake/lifecycle check unchanged.
  const value = z.object({ intake: v2IntakeSchema.passthrough() }).passthrough().parse(raw);
  if (!value.references || !Array.isArray(value.facts) || !Array.isArray(value.materials))
    throw new Error("SYNTHETIC_WORKSPACE_CONTEXT_MISSING");
  return value as WorkspaceContext;
}
const fact = (id: string, text: string, references: V2Fact["references"]): V2Fact => ({
  id,
  text,
  references,
  attribution: references[0]?.kind === "user_material" ? "user_material" : "user_statement",
  certainty: references[0]?.kind === "user_material" ? "uncertain" : "reported",
  significance: "neutral",
  conflictingFactIds: [],
  userEdited: false,
});
export function syntheticWorkspaceQuestions(raw: unknown) {
  const input = context(raw),
    round = input.intake.batches.length;
  if (round >= 2) throw new Error("SYNTHETIC_QUESTION_LIMIT");
  return workspaceQuestionsOutputSchema.parse({
    questions: prompts.slice(round * 3, round * 3 + 3).map((prompt, index) => ({
      id: `synthetic-question-${round}-${index}`,
      prompt,
      answerType: "text",
      options: [],
    })),
  });
}
export function syntheticWorkspaceSummary(raw: unknown) {
  const input = context(raw),
    facts: V2Fact[] = [],
    unknowns: string[] = [];
  // Each fragment is a continuous source excerpt, not a rewritten fact.
  for (let offset = 0; offset < input.intake.narrative.length; offset += 1800)
    facts.push(
      fact(`synthetic-narrative-${offset}`, input.intake.narrative.slice(offset, offset + 1800), [
        { kind: "intake_narrative", intakeRevision: input.references.intakeRevision },
      ]),
    );
  for (const batch of input.intake.batches)
    for (const answer of batch.answers) {
      if (answer.status === "answered")
        facts.push(
          fact(`synthetic-answer-${answer.questionId}`, answer.value, [
            {
              kind: "intake_answer",
              questionId: answer.questionId,
              intakeRevision: input.references.intakeRevision,
            },
          ]),
        );
      else {
        const question = batch.questions.find((q) => q.id === answer.questionId);
        if (!question) throw new Error("SYNTHETIC_ANSWER_SOURCE_MISSING");
        unknowns.push(`${question.prompt} · ${answer.status === "unknown" ? "모름" : "건너뜀"}`);
      }
    }
  const output = workspaceSummaryOutputSchema.parse({
    caseTitle: "자료와 사실 확인",
    overview: input.intake.narrative,
    facts,
    parties: [],
    unknowns,
    notices: ["합성 검증용 모델 응답이며 사용자 진술과 미확인 항목을 구분합니다."],
  });
  assertWorkspaceFacts(input, output.facts);
  return output;
}
export function syntheticWorkspaceChat(raw: unknown, intents = scriptedIntents) {
  const input = context(raw),
    message = input.latestMessage;
  const selected = !!message?.selectedFileIds.length;
  const facts = selected
    ? input.materials
        .filter((material) => message.selectedFileIds.includes(material.reference.fileId))
        .filter((material) => !input.facts.some((f) => f.text === material.text))
        .slice(0, 5)
        .map((material, index) =>
          fact(`synthetic-material-${message.id}-${index}`, material.text.slice(0, 1800), [
            material.reference,
          ]),
        )
    : [];
  const output = workspaceChatOutputSchema.parse({
    text: selected
      ? facts.length
        ? "첨부 자료에서 읽은 범위를 정리했어요. 미확인 항목은 남겨 두었어요."
        : "자료 처리 상태와 읽을 수 있는 범위를 확인해 주세요."
      : "요청한 내용을 현재 사건에서 확인할 수 있도록 준비할게요. 아직 작업이 완료된 것은 아니에요.",
    conversationIntent: input.conversation && message ? (intents.get(message.text) ?? null) : null,
    facts,
    references: facts.flatMap((f) => f.references),
    warnings: [],
    actions: [],
    actionCompletions: [],
    parties: [],
    unknowns: null,
    timeline: [],
    requestedSources: [],
    requestedTools: [],
    requestedMaterials: [],
    requestedCurrentTime: false,
    sourceClaims: [],
  });
  assertWorkspaceFacts(input, output.facts);
  return output;
}
export function syntheticWorkspaceReconciliation(raw: unknown) {
  const value = z
    .object({
      before: v2SummarySchema,
      context: z.unknown(),
      request: z.object({
        id: z.string(),
        input: z.object({ explanation: z.string(), expectedRevision: z.number() }).passthrough(),
      }),
    })
    .passthrough()
    .parse(raw);
  const input = context(value.context),
    message = input.latestMessage;
  if (
    !message ||
    message.id !== value.request.id ||
    message.text !== value.request.input.explanation ||
    message.workspaceRevision !== value.request.input.expectedRevision + 1
  )
    throw new Error("SYNTHETIC_RECONCILIATION_SOURCE_MISSING");
  const after = structuredClone(value.before);
  after.revision = value.before.revision + 1;
  after.facts.push(
    fact(`synthetic-reconciliation-${message.id}`, message.text, [
      { kind: "user_message", messageId: message.id, workspaceRevision: message.workspaceRevision },
    ]),
  );
  const output = summaryReconciliationOutputSchema.parse({
    after,
    reasons: ["기존 사실과 미확인을 보존하고 사용자가 추가로 설명한 진술을 구분했어요."],
  });
  assertReconciliationPreserves(value.before, output.after);
  assertWorkspaceFacts(input, output.after.facts);
  return output;
}
export function syntheticWorkspaceAudit(raw: unknown) {
  const value = z
    .object({
      context: z.unknown(),
      draft: z.unknown().optional(),
      before: v2SummarySchema.optional(),
      after: v2SummarySchema.optional(),
    })
    .passthrough()
    .parse(raw);
  let pass = true;
  try {
    const input = context(value.context);
    const draft = value.after ?? value.draft;
    if (draft && typeof draft === "object" && "facts" in draft)
      assertWorkspaceFacts(
        input,
        z.object({ facts: v2SummarySchema.shape.facts }).parse(draft).facts,
      );
    if (value.before && value.after) assertReconciliationPreserves(value.before, value.after);
  } catch {
    pass = false;
  }
  return workspaceAuditOutputSchema.parse({
    pass,
    findings: pass
      ? []
      : [{ severity: "critical", code: "unsupported_fact", target: "fact", basis: "unknown" }],
    unsupportedFactIds: [],
    legalClaimsSupported: true,
    strategyDetected: false,
  });
}
export function syntheticNativeResponse(output: unknown, ordinal = 1) {
  return {
    responseId: `synthetic-native-${ordinal}`,
    service_tier: "default",
    candidates: [
      {
        content: { role: "model", parts: [{ text: JSON.stringify({ output }) }] },
        finishReason: "STOP",
      },
    ],
    usageMetadata: {
      promptTokenCount: 32,
      candidatesTokenCount: 32,
      thoughtsTokenCount: 0,
      totalTokenCount: 64,
      cachedContentTokenCount: 0,
    },
  };
}
export function createReworkNativeModel(
  options: {
    /** Additional external model phases supplied by their owning fixtures. */
    respond?: (phase: Phase, data: unknown) => unknown | Promise<unknown>;
    intents?: Map<string, V2ConversationIntent>;
  } = {},
) {
  const counters: string[] = [],
    controls = {
      failPhase: null as string | null,
      rejectAudit: false,
      vision: {
        texts: ["[확인 필요] 합성 사진에서 확인할 수 없는 부분은 미확인으로 남깁니다."],
        quality: "low_quality" as "low_quality" | "processed",
      },
    };
  return {
    counters,
    controls,
    binding: {
      async run(_model: string, raw: Record<string, unknown>) {
        const image = (raw.contents as { parts?: { inlineData?: unknown }[] }[] | undefined)?.some(
          (c) => c.parts?.some((p) => p.inlineData),
        );
        const native = image ? null : syntheticGatewayInput(raw),
          phase = native?.phase ?? "vision";
        counters.push(phase);
        if (controls.failPhase === phase) throw new Error("SYNTHETIC_PROVIDER_UNAVAILABLE");
        if (image)
          return {
            candidates: [
              {
                content: { parts: [{ text: JSON.stringify(controls.vision) }] },
                finishReason: "STOP",
              },
            ],
            usageMetadata: {
              promptTokenCount: 32,
              totalTokenCount: 64,
              candidatesTokenCount: 32,
              thoughtsTokenCount: 0,
              cachedContentTokenCount: 0,
            },
            service_tier: "default",
          };
        if (!native) throw new Error("SYNTHETIC_PHASE_MISSING");
        let output: unknown;
        switch (native.phase) {
          case "workspace_questions":
            output = syntheticWorkspaceQuestions(native.data);
            break;
          case "workspace_summary":
            output = syntheticWorkspaceSummary(native.data);
            break;
          case "workspace_chat":
            output = syntheticWorkspaceChat(native.data, options.intents);
            break;
          case "workspace_summary_reconciliation":
            output = syntheticWorkspaceReconciliation(native.data);
            break;
          case "workspace_audit":
          case "workspace_summary_reconciliation_audit":
            output = syntheticWorkspaceAudit(native.data);
            if (controls.rejectAudit) output = { ...(output as object), pass: false };
            break;
          default:
            if (!options.respond) throw new Error("SYNTHETIC_PHASE_UNSUPPORTED");
            output = await options.respond(native.phase as Phase, native.data);
        }
        return syntheticNativeResponse(output, counters.length);
      },
    },
  };
}
