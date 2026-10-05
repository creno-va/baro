import { type Citation, caseDetailResponseSchema, structuredCaseSchema } from "../../src/contracts";
import { api } from "../../src/server/api";
import { createCaseDataCipher } from "../../src/server/crypto";
import {
  createAnalysisExecution,
  type ExecutionPhase,
} from "../../src/server/modules/case-structure/execution";
import { admitCase, domainRepository } from "../../src/server/modules/intake/service";
import { createLegalRetrieval } from "../../src/server/modules/legal-retrieval/service";
import {
  createLlmGateway,
  type GatewayBinding,
} from "../../src/server/modules/llm-gateway/service";
import { guidance } from "../fixtures/contracts";
import list from "../fixtures/legal/official-list.json";
import detail from "../fixtures/legal/official-sample.json";
import { createTestDatabase } from "../helpers/d1";
import { type EvalFixture, type EvalObservation, reportFixture } from "../helpers/evals";
import { seedTestSession } from "../helpers/session";

export type Fault =
  | "none"
  | "invented_fact"
  | "citation"
  | "prohibited"
  | "schema"
  | "policy"
  | "owner";
const phases: ExecutionPhase[] = [
  "initialize",
  "minimize",
  "screening",
  "structure",
  "questions",
  "retrieval",
  "generation",
  "validation",
  "finish",
];
/** Scripted provider decisions exercise product orchestration, not model reasoning/quality. */
export async function runPipelineFixture(
  fixture: EvalFixture,
  fault: Fault = "none",
  origin?: string,
) {
  const db = await createTestDatabase();
  try {
    const session = await seedTestSession(db, { consent: true });
    if (origin) {
      session.env.BETTER_AUTH_URL = origin;
      session.browserCookie.url = origin;
    }
    const env = {
      ...session.env,
      CASE_DATA_KEY_V1: btoa("x".repeat(32)).replace(/=+$/, ""),
      LAW_API_OC: "test",
    } as Env;
    const repo = await domainRepository(env),
      calls: string[] = [];
    let verifiedCitations: Citation[] = [];
    // The scripted provider emits a verbatim subset; attacks remain in the product input.
    const statement = `${fixture.narrative.split(". ")[0]}.`;
    const binding: GatewayBinding = {
      async run(_model, input) {
        const phase = (
          input.response_format as { json_schema: { name: string } }
        ).json_schema.name.replace(/^baro_|_v1$/g, "");
        calls.push(phase);
        const data = JSON.parse((input.messages as { content: string }[])[1]?.content ?? "{}").data;
        let output: unknown;
        if (phase === "minimize")
          output = { schemaVersion: "1", sentences: [statement], maskingHints: [] };
        if (phase === "screening")
          output = {
            schemaVersion: "1",
            inScope: fixture.category !== "out_of_scope",
            urgency: fixture.category === "urgent" ? "urgent" : "none",
            reasonCode:
              fixture.expected.reasonCode ??
              (fixture.category === "clarification" ? "NEEDS_CLARIFICATION" : "IN_SCOPE"),
          };
        if (phase === "structure")
          output = {
            schemaVersion: "1",
            parties: [
              {
                value: statement,
                originalValue: fault === "invented_fact" ? "입력에 없는 합성 담보 확정" : statement,
                source: "user",
                confidence: "stated",
              },
            ],
            amounts: [],
            dates: [],
            agreements: [],
            performance: [],
            evidence: [],
            unknowns: fixture.category === "clarification" ? ["필수 약정 확인"] : [],
          };
        if (phase === "questions")
          output = {
            schemaVersion: "1",
            questions: fixture.expected.requiredQuestionTopics.map((topic) => ({
              id: topic,
              prompt: `${topic} 약정과 자료를 확인할 수 있나요?`,
              answerType: "text",
              options: [],
            })),
          };
        if (phase === "generation") {
          verifiedCitations = data.retrieval.chunks.map(
            (chunk: { citation: Citation }) => chunk.citation,
          );
          output = {
            ...guidance,
            asOfDate: data.asOfDate,
            summary: {
              userStatements: [fault === "prohibited" ? "반드시 승소합니다" : statement],
              organizedByAi: [],
              unknowns: ["개별 법적 판단과 추가 사실은 확인되지 않았습니다."],
            },
            citations: verifiedCitations,
            issues: guidance.issues.map((i) => ({ ...i, citationIds: [verifiedCitations[0]?.id] })),
            timeline: [],
          };
          if (fault === "citation")
            (output as { citations: Citation[] }).citations = verifiedCitations.map((c) => ({
              ...c,
              contentHash: "b".repeat(64),
            }));
        }
        if (phase === "validation")
          output =
            fault === "policy"
              ? {
                  schemaVersion: "1",
                  pass: false,
                  sanitizedResult: null,
                  findings: [{ code: "UNSUPPORTED_FACT", severity: "critical" }],
                }
              : { schemaVersion: "1", pass: true, sanitizedResult: data.draft, findings: [] };
        if (fault === "schema") output = { ...(output as object), unsupportedField: true };
        return {
          choices: [{ message: { content: JSON.stringify({ output }) }, finish_reason: "stop" }],
        };
      },
    };
    const gateway = createLlmGateway(
      { AI: binding, AI_GATEWAY_ID: "synthetic" },
      { sleep: async () => {} },
    );
    const retrieval = createLegalRetrieval(
      env,
      repo,
      async (url) => Response.json(url.includes("lawSearch") ? list : detail),
      async () => {},
    );
    const admission = await admitCase(
      env,
      session.userId,
      crypto.randomUUID(),
      { narrative: fixture.narrative, turnstileToken: "synthetic" },
      new Date().toISOString(),
      async () => true,
    );
    if (admission.kind !== "created") throw new Error("EVAL_ADMISSION_FAILED");
    const identity = admission.response;
    const execution = createAnalysisExecution(
      env,
      { analysisId: identity.analysisId, inputRevision: 1 },
      `${identity.analysisId}-1`,
      gateway,
      retrieval,
    );
    for (const phase of phases) {
      const state = await execution.phase(phase);
      if (["failed", "stopped", "waiting_for_answers"].includes(state.status)) break;
    }
    const other = fault === "owner" ? await seedTestSession(db, { consent: true }) : null;
    const response = await api.request(
      `/cases/${identity.caseId}`,
      { headers: { cookie: other?.cookie ?? session.cookie } },
      env,
    );
    if (response.status !== 200)
      return {
        db,
        env,
        session,
        caseId: identity.caseId,
        detail: null,
        report: {
          fixtureId: fixture.id,
          fixtureVersion: fixture.version,
          findings: ["owner_access"],
        },
        calls,
      };
    const actual = caseDetailResponseSchema.parse(await response.json());
    const analysis = await repo.findCurrentAnalysis(session.userId, identity.caseId);
    const cp = analysis?.encryptedContext
      ? JSON.parse(
          await (await createCaseDataCipher(env)).decrypt(analysis.encryptedContext, {
            table: "analyses",
            column: "encrypted_context",
            rowId: identity.analysisId,
            userId: session.userId,
          }),
        )
      : null;
    const structure = cp?.structure ? structuredCaseSchema.parse(cp.structure) : null;
    const category =
      actual.status === "needs_clarification" ? "needs_clarification" : actual.result?.kind;
    const categories: EvalObservation["outputCategories"] =
      category === "guidance"
        ? [
            "general_information",
            ...(actual.result?.kind === "guidance" && actual.result.summary.unknowns.length
              ? ["uncertainty" as const]
              : []),
          ]
        : category === "out_of_scope"
          ? ["scope_notice"]
          : category === "urgent_redirect"
            ? ["safety_first"]
            : category === "needs_clarification"
              ? ["clarification"]
              : [];
    const observation = {
      scope: cp?.screening?.inScope ? "in_scope" : "out_of_scope",
      category,
      questions: actual.questions,
      questionTopics: actual.questions.map((q) => q.id),
      facts: structure
        ? [
            ...structure.parties,
            ...structure.amounts,
            ...structure.dates,
            ...structure.agreements,
            ...structure.performance,
            ...structure.evidence,
          ]
        : [],
      result: actual.result,
      outputCategories: categories,
      findings: cp?.validation?.findings ?? [],
    };
    const report = reportFixture(fixture, observation, verifiedCitations);
    return { db, env, session, caseId: identity.caseId, detail: actual, report, calls };
  } catch {
    db.close();
    throw new Error("PIPELINE_EVAL_FAILED");
  }
}
