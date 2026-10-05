import {
  analysisStatusResponseSchema,
  caseDetailResponseSchema,
  caseListResponseSchema,
  cursorPositionSchema,
  failureCodeSchema,
  questionsSchema,
  resultSchema,
} from "../../../contracts";
import { createCaseDataCipher } from "../../crypto";
import type { createDomainRepository } from "../../db/repository";

type Repo = ReturnType<typeof createDomainRepository>;
const retryCodes = new Set([
  "DISPATCH_FAILED",
  "MODEL_UNAVAILABLE",
  "LEGAL_SOURCE_UNAVAILABLE",
  "ANALYSIS_TIMEOUT",
  "INTERNAL_ERROR",
]);
export function canRetry(code: string | null, attempt: number) {
  return !!code && retryCodes.has(code) && attempt < 3;
}
export function publicFailure(code: string | null, attempt: number, requestId: string) {
  return {
    code: failureCodeSchema.parse(code),
    message:
      code === "CLARIFICATION_EXPIRED"
        ? "질문 대기 시간이 지나 새 사건을 입력해 주세요."
        : "분석을 완료하지 못했어요. 상태를 확인해 주세요.",
    requestId,
    retryable: canRetry(code, attempt),
    details: {},
  };
}
export async function listCases(repo: Repo, ownerId: string, limit: number, cursor?: string) {
  const position = cursor
    ? cursorPositionSchema.parse(JSON.parse(atob(cursor.replaceAll("-", "+").replaceAll("_", "/"))))
    : undefined;
  const items = await repo.listCases(ownerId, limit, position);
  const last = items.at(-1);
  const nextCursor =
    items.length === limit && last
      ? btoa(JSON.stringify({ createdAt: last.createdAt, id: last.id }))
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replace(/=+$/, "")
      : null;
  return caseListResponseSchema.parse({
    items: items.map((item) => ({ ...item, title: "금전 대여 사건" })),
    nextCursor,
  });
}
export async function readCase(
  repo: Repo,
  env: Env,
  ownerId: string,
  caseId: string,
  requestId: string,
) {
  const record = await repo.findCase(ownerId, caseId);
  if (!record) return null;
  const analysis = await repo.findCurrentAnalysis(ownerId, caseId);
  if (!analysis) return null;
  const cipher = await createCaseDataCipher(env);
  const decrypt = (value: string, column: "encrypted_context" | "encrypted_result") =>
    cipher.decrypt(value, { table: "analyses", column, rowId: analysis.id, userId: ownerId });
  let questions: ReturnType<typeof questionsSchema.parse> = [];
  if (record.status === "needs_clarification" && analysis.encryptedContext) {
    const checkpoint = JSON.parse(await decrypt(analysis.encryptedContext, "encrypted_context"));
    questions = questionsSchema.parse(checkpoint.questions);
  }
  const result =
    record.status === "completed" ||
    record.status === "out_of_scope" ||
    record.status === "urgent_redirect"
      ? resultSchema.parse(
          JSON.parse(await decrypt(analysis.encryptedResult ?? "", "encrypted_result")),
        )
      : null;
  const error =
    record.status === "failed"
      ? publicFailure(analysis.failureCode, analysis.attempt, requestId)
      : null;
  // Recheck after decryption so deletion/revision changes do not publish stale plaintext.
  const current = await repo.findCase(ownerId, caseId);
  if (
    !current ||
    current.currentAnalysisId !== analysis.id ||
    current.inputRevision !== analysis.inputRevision ||
    current.status !== record.status
  )
    return null;
  return caseDetailResponseSchema.parse({
    caseId: record.id,
    title: "금전 대여 사건",
    status: record.status,
    inputRevision: record.inputRevision,
    analysisId: analysis.id,
    questions,
    startedAt: analysis.startedAt,
    completedAt: analysis.completedAt,
    questionCount: record.questionsAsked,
    result,
    error,
  });
}
export async function readAnalysis(repo: Repo, ownerId: string, caseId: string, requestId: string) {
  const analysis = await repo.findCurrentAnalysis(ownerId, caseId);
  if (!analysis) return null;
  const retryable =
    analysis.status === "failed" && canRetry(analysis.failureCode, analysis.attempt);
  return analysisStatusResponseSchema.parse({
    caseId,
    analysisId: analysis.id,
    inputRevision: analysis.inputRevision,
    status: analysis.status,
    updatedAt: analysis.updatedAt,
    retryable,
    retryAttemptsRemaining: Math.max(0, 3 - analysis.attempt),
    error:
      analysis.status === "failed"
        ? publicFailure(analysis.failureCode, analysis.attempt, requestId)
        : null,
  });
}
