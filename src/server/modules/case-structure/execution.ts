import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import {
  type FailureCode,
  guidanceResultSchema,
  minimizedInputSchema,
  questionOutputSchema,
  questionsSchema,
  resultForAllowlistSchema,
  retrievalOutputSchema,
  screeningOutputSchema,
  structuredCaseSchema,
  timestampSchema,
  uuidSchema,
  validationOutputSchema,
} from "../../../contracts";
import { createCaseDataCipher } from "../../crypto";
import { type AnalysisGuard, usageDateKst } from "../../db/repository";
import * as tables from "../../db/schema";
import { hasCurrentConsent } from "../consent/service";
import { domainRepository } from "../intake/service";
import { LegalSourceError } from "../legal-retrieval/service";
import { MODEL_ID, type Phase, POLICY_VERSION, PROMPT_VERSION } from "../llm-gateway/prompts";
import { type createLlmGateway, ModelError } from "../llm-gateway/service";
import { assembleVerifiedResult } from "../response/validate";

const checkpointSchema = z.strictObject({
  schemaVersion: z.literal("1"),
  modelId: z.literal(MODEL_ID),
  promptVersion: z.literal(PROMPT_VERSION),
  policyVersion: z.literal(POLICY_VERSION),
  startedAt: timestampSchema,
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  counts: z.record(z.string(), z.number().int().min(0).max(3)),
  questions: questionsSchema,
  minimize: minimizedInputSchema.optional(),
  screening: screeningOutputSchema.optional(),
  structure: structuredCaseSchema.optional(),
  retrieval: retrievalOutputSchema.optional(),
  generation: guidanceResultSchema.optional(),
  validation: validationOutputSchema.optional(),
});
type Checkpoint = z.infer<typeof checkpointSchema>;
type Gateway = ReturnType<typeof createLlmGateway>;
type Retrieval = {
  retrieve(
    concepts: unknown,
    asOfDate: string,
    now: string,
    reserveRequest?: (key: string) => Promise<boolean>,
  ): Promise<z.infer<typeof retrievalOutputSchema>>;
};
export type ExecutionPhase = "initialize" | Phase | "retrieval" | "finish";
class StaleAnalysis extends Error {}
/** Mask common identifiers before any external call, including minimization. */
export function maskSensitive(input: string) {
  return input
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[이메일]")
    .replace(/01[016789][- ]?\d{3,4}[- ]?\d{4}/g, "[전화번호]")
    .replace(/\b\d{6}[- ]?[1-4]\d{6}\b/g, "[식별번호]")
    .replace(/(계좌\s*(번호)?\s*[:：]?\s*)[\d -]{8,30}/g, "$1[계좌]");
}
export function createAnalysisExecution(
  env: Env,
  params: { analysisId: string; inputRevision: number },
  instanceId: string,
  gateway: Gateway,
  retrieval: Retrieval,
  clock = () => new Date().toISOString(),
) {
  async function load(readCheckpoint = true) {
    uuidSchema.parse(params.analysisId);
    const identity = await env.DB.prepare(
      "SELECT c.id AS caseId,c.user_id AS ownerId FROM analyses a JOIN cases c ON c.current_analysis_id=a.id AND c.input_revision=a.input_revision WHERE a.id=? AND a.input_revision=? AND a.workflow_instance_id=?",
    )
      .bind(params.analysisId, params.inputRevision, instanceId)
      .first<{ caseId: string; ownerId: string }>();
    if (
      !identity ||
      !(await hasCurrentConsent(drizzle(env.DB, { schema: tables }), identity.ownerId))
    )
      throw new StaleAnalysis();
    const repo = await domainRepository(env),
      analysis = await repo.findCurrentAnalysis(identity.ownerId, identity.caseId);
    if (
      !analysis ||
      analysis.id !== params.analysisId ||
      ![
        "queued",
        "screening",
        "waiting_for_answers",
        "retrieving",
        "generating",
        "validating",
      ].includes(analysis.status)
    )
      throw new StaleAnalysis();
    const guard: AnalysisGuard = {
      ...identity,
      analysisId: analysis.id,
      inputRevision: analysis.inputRevision,
      attempt: analysis.attempt,
      expectedStatus: analysis.status,
    };
    const cipher = await createCaseDataCipher(env);
    const checkpoint =
      readCheckpoint && analysis.encryptedContext
        ? checkpointSchema.parse(
            JSON.parse(
              await cipher.decrypt(analysis.encryptedContext, {
                table: "analyses",
                column: "encrypted_context",
                rowId: analysis.id,
                userId: identity.ownerId,
              }),
            ),
          )
        : null;
    return { repo, analysis, guard, checkpoint };
  }
  async function mutate(change: (cp: Checkpoint) => void) {
    for (let retry = 0; retry < 3; retry++) {
      const state = await load(),
        now = clock();
      const cp = state.checkpoint ?? {
        schemaVersion: "1" as const,
        modelId: MODEL_ID,
        promptVersion: PROMPT_VERSION,
        policyVersion: POLICY_VERSION,
        startedAt: now,
        asOfDate: usageDateKst(state.analysis.createdAt),
        counts: {},
        questions: [],
      };
      change(cp);
      if (
        await state.repo.compareAndSetCheckpoint(
          state.guard,
          state.analysis.encryptedContext,
          JSON.stringify(checkpointSchema.parse(cp)),
          now,
        )
      )
        return cp;
    }
    throw new StaleAnalysis();
  }
  async function reserve(phase: string) {
    try {
      await mutate((cp) => {
        const maximumCallMs = phase.startsWith("legal:")
          ? 10000
          : phase === "retrieval" || phase.endsWith("Correction")
            ? 0
            : 60000;
        if (Date.parse(clock()) - Date.parse(cp.startedAt) + maximumCallMs >= 600_000)
          throw new Error("ANALYSIS_TIMEOUT");
        if ((cp.counts[phase] ?? 0) >= (phase.endsWith("Correction") ? 1 : 3)) {
          if (phase === "retrieval" || phase.startsWith("legal:")) throw new LegalSourceError();
          throw new ModelError(
            phase.endsWith("Correction") ? "MODEL_SCHEMA_INVALID" : "MODEL_UNAVAILABLE",
          );
        }
        cp.counts[phase] = (cp.counts[phase] ?? 0) + 1;
      });
      return true;
    } catch (error) {
      if (error instanceof StaleAnalysis) return false;
      throw error;
    }
  }
  const call = (phase: Phase, input: unknown) =>
    gateway.call(
      phase,
      input,
      params.analysisId,
      () => reserve(phase),
      () => reserve(`${phase}Correction`),
    );
  async function transition(
    status: AnalysisGuard["expectedStatus"],
    patch: Parameters<Awaited<ReturnType<typeof domainRepository>>["compareAndSetAnalysis"]>[1],
    now = clock(),
  ) {
    const state = await load();
    if (state.analysis.status !== status) throw new StaleAnalysis();
    if (!(await state.repo.compareAndSetAnalysis(state.guard, patch, now)))
      throw new StaleAnalysis();
  }
  async function phase(name: ExecutionPhase) {
    try {
      let state = await load();
      if (name === "initialize") {
        if (state.analysis.status === "queued") await transition("queued", { status: "screening" });
        await mutate(() => {});
      } else {
        const cp = state.checkpoint;
        if (!cp) throw new Error("INTERNAL_ERROR");
        if (state.analysis.status === "waiting_for_answers")
          return { analysisId: params.analysisId, status: "waiting_for_answers" as const };
        if (Date.parse(clock()) - Date.parse(cp.startedAt) >= 600_000)
          throw new Error("ANALYSIS_TIMEOUT");
        if (name === "minimize" && !cp.minimize) {
          const input = await state.repo.readInput(state.guard.ownerId, state.guard.caseId);
          if (!input) throw new StaleAnalysis();
          const value = minimizedInputSchema.parse(
            await call(name, { narrative: maskSensitive(input) }),
          );
          if (value.sentences.some((s) => maskSensitive(s) !== s))
            throw new ModelError("POLICY_REJECTED");
          await mutate((next) => {
            next.minimize = value;
          });
        }
        if (name === "screening") {
          const value = cp.screening ?? screeningOutputSchema.parse(await call(name, cp.minimize));
          if (!cp.screening)
            await mutate((next) => {
              next.screening = value;
            });
          if (value.urgency === "urgent" || !value.inScope) {
            const kind = value.urgency === "urgent" ? "urgent_redirect" : "out_of_scope";
            const result = resultForAllowlistSchema().parse({
              schemaVersion: "1",
              kind,
              asOfDate: cp.asOfDate,
              notices: ["일반 정보이며 법률 자문이 아니에요."],
              reasonCode: value.reasonCode,
              message:
                kind === "urgent_redirect"
                  ? "안전이 우선이에요. 즉각적인 위험에서는 경찰 112 또는 응급 119에 도움을 요청해 주세요."
                  : "현재 대한민국 개인 간 금전 대여 사건만 지원해요.",
              helpLinks: [],
            });
            await transition("screening", { status: "completed", result });
          }
        }
        if (name === "structure" && !cp.structure) {
          const value = structuredCaseSchema.parse(await call(name, cp.minimize));
          const original = maskSensitive(
            (await state.repo.readInput(state.guard.ownerId, state.guard.caseId)) ?? "",
          );
          if (
            [
              ...value.parties,
              ...value.amounts,
              ...value.dates,
              ...value.agreements,
              ...value.performance,
              ...value.evidence,
            ].some(
              (f) =>
                f.source === "user" && (!f.originalValue || !original.includes(f.originalValue)),
            )
          )
            throw new ModelError("POLICY_REJECTED");
          await mutate((next) => {
            next.structure = value;
          });
        }
        if (name === "questions") {
          const record = await state.repo.findCase(state.guard.ownerId, state.guard.caseId);
          const needs =
            cp.screening?.reasonCode === "NEEDS_CLARIFICATION" ||
            cp.screening?.urgency === "uncertain" ||
            !!cp.structure?.unknowns.length;
          if (needs && params.inputRevision === 1 && record?.questionsAsked === 0) {
            const value = cp.questions.length
              ? { questions: cp.questions }
              : questionOutputSchema.parse(
                  await call(name, {
                    input: cp.minimize,
                    screening: cp.screening,
                    structure: cp.structure,
                  }),
                );
            if (!value.questions.length) throw new ModelError("POLICY_REJECTED");
            await mutate((next) => {
              next.questions = value.questions;
            });
            const at = clock();
            await transition(
              "screening",
              {
                status: "waiting_for_answers",
                questionsAsked: value.questions.length,
                clarificationExpiresAt: new Date(Date.parse(at) + 86_400_000).toISOString(),
              },
              at,
            );
          } else {
            if (
              cp.screening?.urgency !== "none" ||
              !cp.screening.inScope ||
              cp.screening.reasonCode === "NEEDS_CLARIFICATION"
            )
              throw new ModelError("POLICY_REJECTED");
            if (state.analysis.status === "screening")
              await transition("screening", { status: "queued" });
            if (state.analysis.status === "queued" || state.analysis.status === "screening")
              await transition("queued", { status: "retrieving" });
          }
        }
        if (name === "retrieval") {
          if (!cp.retrieval) {
            await reserve(name);
            const value = await retrieval.retrieve(
              ["loan", "repayment"],
              cp.asOfDate,
              clock(),
              (key) => reserve(`legal:${key}`),
            );
            await mutate((next) => {
              next.retrieval = value;
            });
          }
          if (state.analysis.status === "retrieving")
            await transition("retrieving", { status: "generating" });
        }
        if (name === "generation") {
          if (!cp.generation) {
            const value = guidanceResultSchema.parse(
              await call(name, {
                input: cp.minimize,
                structure: cp.structure,
                retrieval: cp.retrieval,
                asOfDate: cp.asOfDate,
              }),
            );
            await mutate((next) => {
              next.generation = value;
            });
          }
          if (state.analysis.status === "generating")
            await transition("generating", { status: "validating" });
        }
        if (name === "validation" && !cp.validation) {
          const value = validationOutputSchema.parse(
            await call(name, {
              input: cp.minimize,
              structure: cp.structure,
              retrieval: cp.retrieval,
              draft: cp.generation,
              original: maskSensitive(
                (await state.repo.readInput(state.guard.ownerId, state.guard.caseId)) ?? "",
              ),
            }),
          );
          await mutate((next) => {
            next.validation = value;
          });
        }
        if (name === "finish") {
          const result = await assembleVerifiedResult(cp.generation, cp.validation, cp.retrieval);
          const original = maskSensitive(
            (await state.repo.readInput(state.guard.ownerId, state.guard.caseId)) ?? "",
          );
          if (
            result.kind !== "guidance" ||
            result.summary.userStatements.some((s) => !original.includes(s))
          )
            throw new ModelError("POLICY_REJECTED");
          await transition("validating", { status: "completed", result });
        }
      }
      state = await load();
      return { analysisId: params.analysisId, status: state.analysis.status };
    } catch (error) {
      if (error instanceof StaleAnalysis)
        return { analysisId: params.analysisId, status: "stopped" as const };
      const code: FailureCode =
        error instanceof ModelError
          ? error.code
          : error instanceof LegalSourceError
            ? "LEGAL_SOURCE_UNAVAILABLE"
            : error instanceof z.ZodError
              ? "MODEL_SCHEMA_INVALID"
              : error instanceof Error && error.message === "ANALYSIS_TIMEOUT"
                ? "ANALYSIS_TIMEOUT"
                : "INTERNAL_ERROR";
      await load(false)
        .then((s) =>
          s.repo.compareAndSetAnalysis(s.guard, { status: "failed", failureCode: code }, clock()),
        )
        .catch(() => undefined);
      return { analysisId: params.analysisId, status: "failed" as const };
    }
  }
  return {
    phase,
    async expire() {
      const state = await load().catch(() => null);
      if (
        state?.analysis.status === "waiting_for_answers" &&
        state.analysis.clarificationExpiresAt &&
        state.analysis.clarificationExpiresAt <= clock()
      )
        await state.repo.compareAndSetAnalysis(
          state.guard,
          { status: "failed", failureCode: "CLARIFICATION_EXPIRED" },
          clock(),
        );
      return { analysisId: params.analysisId, status: "stopped" as const };
    },
  };
}
export async function reconcileAnalysisTimeouts(env: Env, now = new Date().toISOString()) {
  const rows = await env.DB.prepare(
    "SELECT c.user_id AS ownerId,c.id AS caseId,a.id AS analysisId,a.input_revision AS inputRevision,a.attempt,a.status AS expectedStatus,a.clarification_expires_at AS expiresAt,a.started_at AS startedAt FROM analyses a JOIN cases c ON c.current_analysis_id=a.id AND c.input_revision=a.input_revision WHERE a.status IN ('screening','retrieving','generating','validating','waiting_for_answers') LIMIT 100",
  ).all<AnalysisGuard & { expiresAt: string | null; startedAt: string | null }>();
  const repo = await domainRepository(env);
  for (const row of rows.results) {
    const waiting = row.expectedStatus === "waiting_for_answers";
    if (
      waiting
        ? !!row.expiresAt && row.expiresAt <= now
        : !!row.startedAt && Date.parse(now) - Date.parse(row.startedAt) >= 600_000
    ) {
      const { expiresAt: _expires, startedAt: _started, ...guard } = row;
      await repo.compareAndSetAnalysis(
        guard,
        { status: "failed", failureCode: waiting ? "CLARIFICATION_EXPIRED" : "ANALYSIS_TIMEOUT" },
        now,
      );
    }
  }
}
