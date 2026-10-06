import { Hono } from "hono";
import { z } from "zod";
import { createUsageService, UsageError } from "../../modules/usage/service";
import { caseAccess } from "../case-access";
import { type ApiEnvironment, errorBody } from "../errors";

/** Mounted at /v2/me by the shared router; injected options are server dependencies only. */
export function createUsageApi(
  options: Parameters<typeof createUsageService>[1] = { environment: "preview" },
) {
  return new Hono<ApiEnvironment>().get("/usage", async (c) => {
    c.header("cache-control", "no-store");
    if (c.env.APP_ENV === "production" && c.env.PUBLIC_BETA_ENABLED !== "true")
      return c.json(errorBody(c, "BETA_NOT_OPEN", "공개 베타를 준비하고 있어요."), 503);
    const access = await caseAccess(c, false, true);
    if (access.response) return access.response;
    if (!z.strictObject({}).safeParse(c.req.query()).success || (await c.req.text()).length > 0)
      return c.json(errorBody(c, "VALIDATION_ERROR", "사용량 조회 조건을 확인해 주세요."), 400);
    try {
      const service = createUsageService(c.env.DB, {
        ...options,
        environment: c.env.APP_ENV === "production" ? "production" : "preview",
      });
      return c.json(await service.account(access.ownerId));
    } catch (error) {
      if (error instanceof UsageError && error.code === "UNAUTHENTICATED")
        return c.json(errorBody(c, "UNAUTHENTICATED", "로그인이 필요해요."), 401);
      throw error;
    }
  });
}
export const usageApi = createUsageApi();
