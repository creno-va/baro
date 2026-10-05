import { Hono } from "hono";
import { idempotencyKeySchema, retryRequestSchema, uuidSchema } from "../../contracts";
import { canRetry } from "../modules/cases/service";
import { reconcileDispatch } from "../modules/dispatch/service";
import { domainRepository, requestHash } from "../modules/intake/service";
import { abuseAllowed, caseAccess } from "./case-access";
import { type ApiEnvironment, errorBody } from "./errors";
export const retryApi = new Hono<ApiEnvironment>().post("/:caseId/retry", async (c) => {
  const access = await caseAccess(c, true, true);
  if (access.response) return access.response;
  const id = uuidSchema.safeParse(c.req.param("caseId")),
    key = idempotencyKeySchema.safeParse(c.req.header("idempotency-key")),
    body = retryRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!id.success || !key.success || !body.success)
    return c.json(errorBody(c, "VALIDATION_ERROR", "요청을 확인해 주세요."), 400);
  if (!(await abuseAllowed(c, access.ownerId, false)))
    return c.json(errorBody(c, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.", true), 429);
  const repo = await domainRepository(c.env),
    now = new Date().toISOString(),
    route = `/api/cases/${id.data}/retry`,
    hash = await requestHash(body.data);
  const replay = async () => {
    const saved = await repo.findIdempotency(access.ownerId, "POST", route, key.data, now);
    return saved
      ? saved.requestHash === hash
        ? c.json(JSON.parse(saved.responseJson), 202)
        : c.json(errorBody(c, "IDEMPOTENCY_CONFLICT", "다른 요청에 사용된 키예요."), 409)
      : null;
  };
  const saved = await replay();
  if (saved) return saved;
  const analysis = await repo.findCurrentAnalysis(access.ownerId, id.data);
  if (!analysis) return c.json(errorBody(c, "CASE_NOT_FOUND", "사건을 찾을 수 없어요."), 404);
  if (analysis.inputRevision !== body.data.inputRevision)
    return c.json(errorBody(c, "REVISION_CONFLICT", "최신 상태를 확인해 주세요."), 409);
  if (analysis.status !== "failed" || !canRetry(analysis.failureCode, analysis.attempt))
    return c.json(errorBody(c, "INVALID_STATE", "재시도할 수 없는 상태예요."), 409);
  // A missing/unreachable instance is ambiguous. Only a confirmed terminal instance permits reuse.
  const status = await c.env.ANALYSIS_WORKFLOW.get(analysis.workflowInstanceId)
    .then((i) => i.status())
    .catch(() => null);
  if (!status || !["complete", "errored", "terminated"].includes(status.status))
    return c.json(
      errorBody(c, "INVALID_STATE", "이전 분석이 종료되기를 기다려 주세요.", true),
      409,
    );
  let committed = false;
  try {
    committed = await repo.retryAnalysis(
      access.ownerId,
      id.data,
      analysis.id,
      analysis.inputRevision,
      analysis.attempt,
      key.data,
      hash,
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
    return c.json(errorBody(c, "REVISION_CONFLICT", "최신 상태를 확인해 주세요."), 409);
  }
  await reconcileDispatch(c.env).catch(() => undefined);
  return c.json(
    { analysisId: analysis.id, inputRevision: analysis.inputRevision, status: "queued" },
    202,
  );
});
