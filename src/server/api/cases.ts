import { Hono } from "hono";
import { caseListQuerySchema, idempotencyKeySchema, uuidSchema } from "../../contracts";
import { listCases, readAnalysis, readCase } from "../modules/cases/service";
import { domainRepository, requestHash } from "../modules/intake/service";
import { caseAccess } from "./case-access";
import { type ApiEnvironment, errorBody } from "./errors";

export const casesApi = new Hono<ApiEnvironment>()
  .get("/", async (c) => {
    const access = await caseAccess(c);
    if (access.response) return access.response;
    const query = caseListQuerySchema.safeParse(c.req.query());
    if (!query.success)
      return c.json(errorBody(c, "VALIDATION_ERROR", "목록 조건을 확인해 주세요."), 400);
    return c.json(
      await listCases(
        await domainRepository(c.env),
        access.ownerId,
        query.data.limit,
        query.data.cursor,
      ),
    );
  })
  .get("/:caseId", async (c) => {
    const access = await caseAccess(c);
    if (access.response) return access.response;
    const id = uuidSchema.safeParse(c.req.param("caseId"));
    if (!id.success) return c.json(errorBody(c, "CASE_NOT_FOUND", "사건을 찾을 수 없어요."), 404);
    const detail = await readCase(
      await domainRepository(c.env),
      c.env,
      access.ownerId,
      id.data,
      c.get("requestId"),
    );
    return detail
      ? c.json(detail)
      : c.json(errorBody(c, "CASE_NOT_FOUND", "사건을 찾을 수 없어요."), 404);
  })
  .get("/:caseId/analysis", async (c) => {
    const access = await caseAccess(c);
    if (access.response) return access.response;
    const id = uuidSchema.safeParse(c.req.param("caseId"));
    if (!id.success) return c.json(errorBody(c, "CASE_NOT_FOUND", "사건을 찾을 수 없어요."), 404);
    const status = await readAnalysis(
      await domainRepository(c.env),
      access.ownerId,
      id.data,
      c.get("requestId"),
    );
    if (!status) return c.json(errorBody(c, "CASE_NOT_FOUND", "사건을 찾을 수 없어요."), 404);
    c.header("retry-after", "2");
    return c.json(status);
  })
  .delete("/:caseId", async (c) => {
    const access = await caseAccess(c, true);
    if (access.response) return access.response;
    const id = uuidSchema.safeParse(c.req.param("caseId"));
    const key = idempotencyKeySchema.safeParse(c.req.header("idempotency-key"));
    if (!id.success) return c.json(errorBody(c, "CASE_NOT_FOUND", "사건을 찾을 수 없어요."), 404);
    if (!key.success || (await c.req.text()).trim())
      return c.json(errorBody(c, "VALIDATION_ERROR", "삭제 요청을 확인해 주세요."), 400);
    const repo = await domainRepository(c.env);
    const now = new Date().toISOString();
    const route = `/api/cases/${id.data}`;
    const hash = await requestHash({ caseId: id.data });
    const replay = async () => {
      const record = await repo.findIdempotency(access.ownerId, "DELETE", route, key.data, now);
      return record
        ? record.requestHash === hash
          ? c.body(null, 204)
          : c.json(errorBody(c, "IDEMPOTENCY_CONFLICT", "다른 요청에 사용된 키예요."), 409)
        : null;
    };
    const existing = await replay();
    if (existing) return existing;
    try {
      if (
        await repo.deleteOwnedCase(access.ownerId, id.data, crypto.randomUUID(), now, {
          key: key.data,
          requestHash: hash,
        })
      )
        return c.body(null, 204);
    } catch (error) {
      const winner = await replay();
      if (winner) return winner;
      throw error;
    }
    return (
      (await replay()) ?? c.json(errorBody(c, "CASE_NOT_FOUND", "사건을 찾을 수 없어요."), 404)
    );
  });
