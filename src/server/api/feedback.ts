import { Hono } from "hono";
import { feedbackRequestSchema, uuidSchema } from "../../contracts";
import { domainRepository } from "../modules/intake/service";
import { abuseAllowed, caseAccess } from "./case-access";
import { type ApiEnvironment, errorBody } from "./errors";
export const feedbackApi = new Hono<ApiEnvironment>().put("/:caseId/feedback", async (c) => {
  const access = await caseAccess(c, true);
  if (access.response) return access.response;
  const id = uuidSchema.safeParse(c.req.param("caseId")),
    body = feedbackRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!id.success || !body.success)
    return c.json(errorBody(c, "VALIDATION_ERROR", "도움 여부만 선택해 주세요."), 400);
  if (!(await abuseAllowed(c, access.ownerId, false)))
    return c.json(errorBody(c, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.", true), 429);
  const repo = await domainRepository(c.env),
    record = await repo.findCase(access.ownerId, id.data);
  if (!record) return c.json(errorBody(c, "CASE_NOT_FOUND", "사건을 찾을 수 없어요."), 404);
  if (record.status !== "completed")
    return c.json(errorBody(c, "INVALID_STATE", "결과를 확인한 뒤 선택해 주세요."), 409);
  if (
    !(await repo.saveFeedback(access.ownerId, id.data, body.data.helpful, new Date().toISOString()))
  )
    return c.json(errorBody(c, "CASE_NOT_FOUND", "사건을 찾을 수 없어요."), 404);
  return c.body(null, 204);
});
