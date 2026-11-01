import { type Context, Hono } from "hono";
import { z } from "zod";
import { idempotencyKeySchema, opaqueIdSchema } from "../../../contracts";
import { v2ReworkCreateCaseRequestSchema } from "../../../contracts/v2";
import { createCaseDataCipher } from "../../crypto";
import { createV2Core, V2RepositoryError } from "../../db/v2-core";
import { reportDependencyFailure } from "../../dependency-diagnostics";
import { verifyTurnstile } from "../../modules/intake/service";
import { createReworkCaseService, ReworkError } from "../../modules/rework/case-context";
import { abuseAllowed, caseAccess } from "../case-access";
import { type ApiEnvironment, errorBody } from "../errors";

export function createReworkApi(options: { turnstile?: typeof verifyTurnstile } = {}) {
  const app = new Hono<ApiEnvironment>();
  app.use("*", async (c, next) => {
    c.header("cache-control", "private, no-store");
    c.header("x-content-type-options", "nosniff");
    if (c.env.APP_ENV === "production" && c.env.PUBLIC_BETA_ENABLED !== "true")
      return c.json(errorBody(c, "BETA_NOT_OPEN", "공개 베타를 준비하고 있어요."), 503);
    await next();
    return;
  });
  app.onError((error, c) => {
    if (
      error instanceof z.ZodError ||
      error instanceof SyntaxError ||
      (error instanceof V2RepositoryError && error.code === "REPOSITORY_INPUT_INVALID")
    )
      return c.json(errorBody(c, "VALIDATION_ERROR", "입력과 요청 조건을 확인해 주세요."), 400);
    if (error instanceof ReworkError) {
      const status =
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "CONSENT_REQUIRED"
            ? 403
            : error.code === "USER_QUOTA_EXCEEDED"
              ? 429
              : error.code === "DEPENDENCY_UNAVAILABLE"
                ? 503
                : 409;
      return c.json(
        errorBody(
          c,
          error.code,
          "사건의 현재 상태와 요청 조건을 다시 확인해 주세요.",
          status === 503,
        ),
        status,
      );
    }
    reportDependencyFailure(error);
    return c.json(errorBody(c, "DEPENDENCY_UNAVAILABLE", "사건을 불러오지 못했어요.", true), 503);
  });
  const access = (c: Context<ApiEnvironment>, mutation = false) =>
    caseAccess(c, mutation, mutation, true, { customerConsentSnapshot: true });
  const service = async (c: Context<ApiEnvironment>) =>
    createReworkCaseService(
      createV2Core(c.env.DB, await createCaseDataCipher(c.env), {
        applicationCostLimitsEnabled: c.env.APPLICATION_COST_LIMITS_ENABLED !== "false",
        monthlyBudgetCapEnabled: c.env.MONTHLY_BUDGET_CAP_ENABLED !== "false",
      }),
    );
  app.post("/rework", async (c) => {
    const a = await access(c, true);
    if (a.response) return a.response;
    z.strictObject({}).parse(c.req.query());
    const input = v2ReworkCreateCaseRequestSchema.parse(await c.req.json());
    const key = idempotencyKeySchema.parse(c.req.header("idempotency-key"));
    const s = await service(c),
      replay = await s.replayCreate(a.ownerId, key, input);
    if (replay) return c.json(replay, 201);
    if (!(await abuseAllowed(c, a.ownerId, true)))
      return c.json(errorBody(c, "RATE_LIMITED", "잠시 후 다시 시도해 주세요.", true), 429);
    if (!(await (options.turnstile ?? verifyTurnstile)(c.env, input.turnstileToken)))
      return c.json(errorBody(c, "TURNSTILE_FAILED", "보안 확인을 다시 진행해 주세요."), 403);
    return c.json(await s.create(a.ownerId, key, input), 201);
  });
  app.get("/:id/rework/context", async (c) => {
    const a = await access(c);
    if (a.response) return a.response;
    z.strictObject({}).parse(c.req.query());
    return c.json(await (await service(c)).get(a.ownerId, opaqueIdSchema.parse(c.req.param("id"))));
  });
  app.put("/:id/rework/context", async (c) => {
    const a = await access(c, true);
    if (a.response) return a.response;
    z.strictObject({}).parse(c.req.query());
    return c.json(
      await (await service(c)).update(
        a.ownerId,
        opaqueIdSchema.parse(c.req.param("id")),
        idempotencyKeySchema.parse(c.req.header("idempotency-key")),
        await c.req.json(),
      ),
    );
  });
  return app;
}
