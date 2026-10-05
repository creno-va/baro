import { Hono } from "hono";
import {
  answersForQuestionsSchema,
  answersRequestSchema,
  idempotencyKeySchema,
  uuidSchema,
} from "../../contracts";
import { createCaseDataCipher } from "../crypto";
import { reconcileDispatch } from "../modules/dispatch/service";
import { domainRepository, requestHash } from "../modules/intake/service";
import { abuseAllowed, caseAccess } from "./case-access";
import { type ApiEnvironment, errorBody } from "./errors";

export const answersApi = new Hono<ApiEnvironment>().post("/:caseId/answers", async (c) => {
  const access = await caseAccess(c, true, true);
  if (access.response) return access.response;
  const id = uuidSchema.safeParse(c.req.param("caseId"));
  const key = idempotencyKeySchema.safeParse(c.req.header("idempotency-key"));
  const body = answersRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!id.success || !key.success || !body.success)
    return c.json(errorBody(c, "VALIDATION_ERROR", "답변과 요청 키를 확인해 주세요."), 400);
  if (!(await abuseAllowed(c, access.ownerId, false)))
    return c.json(errorBody(c, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.", true), 429);
  const repo = await domainRepository(c.env);
  const now = new Date().toISOString(),
    route = `/api/cases/${id.data}/answers`,
    hash = await requestHash(body.data);
  const replay = async () => {
    const saved = await repo.findIdempotency(access.ownerId, "POST", route, key.data, now);
    return saved
      ? saved.requestHash === hash
        ? c.json(JSON.parse(saved.responseJson), 202)
        : c.json(errorBody(c, "IDEMPOTENCY_CONFLICT", "다른 답변에 사용된 요청 키예요."), 409)
      : null;
  };
  const saved = await replay();
  if (saved) return saved;
  const record = await repo.findCase(access.ownerId, id.data),
    analysis = await repo.findCurrentAnalysis(access.ownerId, id.data);
  if (!record || !analysis)
    return c.json(errorBody(c, "CASE_NOT_FOUND", "사건을 찾을 수 없어요."), 404);
  if (record.inputRevision !== body.data.inputRevision)
    return c.json(errorBody(c, "REVISION_CONFLICT", "최신 질문을 다시 확인해 주세요."), 409);
  if (
    analysis.status !== "waiting_for_answers" ||
    !analysis.encryptedContext ||
    !analysis.clarificationExpiresAt ||
    analysis.clarificationExpiresAt <= now
  )
    return c.json(errorBody(c, "INVALID_STATE", "답변 가능한 상태가 아니에요."), 409);
  const cipher = await createCaseDataCipher(c.env);
  const checkpoint = JSON.parse(
    await cipher.decrypt(analysis.encryptedContext, {
      table: "analyses",
      column: "encrypted_context",
      rowId: analysis.id,
      userId: access.ownerId,
    }),
  );
  if (!answersForQuestionsSchema(checkpoint.questions).safeParse(body.data).success)
    return c.json(errorBody(c, "VALIDATION_ERROR", "모든 질문에 한 번씩 답해 주세요."), 400);
  const previous = await repo.readInput(access.ownerId, id.data);
  if (!previous) return c.json(errorBody(c, "CASE_NOT_FOUND", "사건을 찾을 수 없어요."), 404);
  const nextId = crypto.randomUUID();
  let committed = false;
  try {
    committed = await repo.advanceRevision(
      {
        ownerId: access.ownerId,
        caseId: id.data,
        analysisId: analysis.id,
        inputRevision: analysis.inputRevision,
        attempt: analysis.attempt,
        expectedStatus: "waiting_for_answers",
      },
      {
        analysisId: nextId,
        outboxId: crypto.randomUUID(),
        input: JSON.stringify({
          narrative: previous,
          answers: body.data.answers,
          questions: checkpoint.questions,
        }),
        answers: JSON.stringify(body.data.answers),
        idempotency: { key: key.data, requestHash: hash },
      },
      now,
    );
  } catch {
    const winner = await replay();
    if (winner) return winner;
    throw new Error("DB_OPERATION_FAILED");
  }
  if (!committed) {
    const winner = await replay();
    if (winner) return winner;
    return c.json(errorBody(c, "REVISION_CONFLICT", "최신 상태를 다시 확인해 주세요."), 409);
  }
  await c.env.ANALYSIS_WORKFLOW.get(analysis.workflowInstanceId)
    .then((instance) =>
      instance.sendEvent({
        type: "answers",
        payload: { analysisId: nextId, inputRevision: analysis.inputRevision + 1 },
      }),
    )
    .catch(() => undefined);
  await reconcileDispatch(c.env).catch(() => undefined);
  return c.json(
    {
      caseId: id.data,
      analysisId: nextId,
      inputRevision: analysis.inputRevision + 1,
      status: "queued",
    },
    202,
  );
});
